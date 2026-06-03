import { getLLMConnectivityMonitorConfig, getLLMProfiles, testLLMProfileConnection } from './config.js'
import { nowTimestamp } from './time.js'
import { getWechatyDutyGroupStatus, sendWechatyDutyGroupMessage } from './social/wechaty-duty-group.js'

let monitorTimer = null
let monitorRunning = false
let lastCheckAt = ''
let lastNotifyAt = ''
let lastResults = []
let lastError = ''
let lastStatusByProfile = new Map()
let lastPeriodKey = ''
let startupPeriodKey = ''
let suppressAutoNotifyUntil = 0

function localTime(date = new Date()) {
  try {
    return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return date.toISOString().replace('T', ' ').slice(5, 16)
  }
}

function intervalPeriodKey(minutes = 60, date = new Date()) {
  const ms = Math.max(Number(minutes || 60), 5) * 60 * 1000
  return `${Math.max(Number(minutes || 60), 5)}m:${Math.floor(date.getTime() / ms)}`
}

function nextCheckIso(cfg = getLLMConnectivityMonitorConfig()) {
  if (!cfg.enabled) return ''
  const minutes = Math.max(Number(cfg.intervalMinutes || 60), 5)
  const base = lastCheckAt ? Date.parse(lastCheckAt) : Date.now()
  if (!Number.isFinite(base)) return ''
  return new Date(base + minutes * 60 * 1000).toISOString()
}

function profileLabel(profile = {}) {
  return `${profile.name || profile.providerLabel || profile.provider || 'LLM'} / ${profile.model || 'model'}`
}

async function mapWithLimit(items = [], limit = 3, worker) {
  const rows = []
  let next = 0
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, async () => {
    while (next < items.length) {
      const idx = next++
      rows[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return rows
}

function selectedProfiles(cfg = {}) {
  const all = getLLMProfiles()
  const selectedIds = Array.isArray(cfg.selectedProfileIds) ? cfg.selectedProfileIds.map(String) : []
  if (!selectedIds.length) return all
  const selected = selectedIds.map(id => all.find(profile => String(profile.id) === String(id))).filter(Boolean)
  return selected.length ? selected : all
}

function normalizeGroupKey(value = '') {
  return String(value || '').trim().replace(/^wechaty:/u, '')
}

function matchesSelectedGroup(room = {}, selected = []) {
  const rid = String(room.id || '').trim()
  const topic = String(room.topic || '').trim()
  const keys = new Set([
    rid,
    topic,
    `wechaty:${rid}`,
    normalizeGroupKey(rid),
    normalizeGroupKey(topic),
  ].filter(Boolean))
  return selected.some(item => keys.has(String(item || '').trim()) || keys.has(normalizeGroupKey(item)))
}

function notifyMentionGroupKeys(group = {}) {
  const rid = String(group.roomId || group.id || '').trim()
  const topic = String(group.groupName || group.topic || '').trim()
  return [
    rid,
    topic,
    rid ? `wechaty:${rid}` : '',
    topic ? `wechaty:${topic}` : '',
    normalizeGroupKey(rid),
    normalizeGroupKey(topic),
  ].filter(Boolean)
}

function resolveNotifyMentionIdsForGroup(cfg = {}, group = {}) {
  const map = cfg.notifyMentionsByGroup && typeof cfg.notifyMentionsByGroup === 'object'
    ? cfg.notifyMentionsByGroup
    : {}
  const keys = new Set(notifyMentionGroupKeys(group))
  const normalizedKeys = new Set([...keys].map(key => normalizeGroupKey(key)))
  const ids = []
  const seen = new Set()
  const add = (value = '') => {
    const id = String(value || '').trim()
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const [rawKey, values] of Object.entries(map)) {
    const key = String(rawKey || '').trim()
    if (!key) continue
    if (!keys.has(key) && !normalizedKeys.has(normalizeGroupKey(key))) continue
    for (const item of Array.isArray(values) ? values : []) add(item)
  }
  return ids.slice(0, 20)
}

function resolveNotifyGroups(cfg = {}) {
  const selected = Array.isArray(cfg.selectedGroups) ? cfg.selectedGroups.map(v => String(v || '').trim()).filter(Boolean) : []
  if (!selected.length) return []
  const status = getWechatyDutyGroupStatus()
  const rooms = Array.isArray(status.rooms) ? status.rooms : []
  const roomIds = status.room_ids && typeof status.room_ids === 'object' ? status.room_ids : {}
  const cachedRoomIds = status.cached_room_ids && typeof status.cached_room_ids === 'object' ? status.cached_room_ids : {}
  const rows = []
  const seen = new Set()
  const add = (roomId = '', topic = '') => {
    const rid = String(roomId || '').trim()
    const name = String(topic || '').trim()
    if (!rid || seen.has(rid)) return
    const candidate = { id: rid, topic: name }
    if (!matchesSelectedGroup(candidate, selected)) return
    seen.add(rid)
    rows.push({ roomId: rid, groupName: name || rid })
  }
  for (const room of rooms) add(room.id, room.topic)
  for (const [topic, rid] of Object.entries(roomIds)) add(rid, topic)
  for (const [topic, rid] of Object.entries(cachedRoomIds)) add(rid, topic)
  return rows
}

function statusKey(result = {}) {
  if (result.skipped) return 'skipped'
  return result.ok ? 'up' : 'down'
}

function shouldNotify(results = [], cfg = {}, { forceNotify = false } = {}) {
  if (forceNotify) return true
  const mode = cfg.notifyMode || 'changes'
  if (mode === 'all') return true
  if (mode === 'failures') return results.some(item => item.ok === false)
  if (mode === 'changes') {
    for (const item of results) {
      const key = String(item.profileId || '')
      if (!key) continue
      const before = lastStatusByProfile.get(key)
      const after = statusKey(item)
      if (before && before !== after) return true
      if (!before && after === 'down') return true
    }
    return false
  }
  return false
}

function buildNotificationText(results = [], cfg = {}) {
  const failed = results.filter(item => item.ok === false)
  const ok = results.filter(item => item.ok === true)
  const skipped = results.filter(item => item.skipped)
  const title = failed.length
    ? `⚠️ LLM 渠道连通检测：${failed.length}/${results.length} 个不通`
    : `✅ LLM 渠道连通检测：${ok.length}/${results.length} 个正常`
  const modeText = cfg.notifyMode === 'all' ? '每次通知' : cfg.notifyMode === 'failures' ? '只通知异常' : '异常/恢复变化通知'
  const lines = [
    `${title}`,
    `时间：${localTime(new Date())}；间隔：${cfg.intervalMinutes} 分钟；策略：${modeText}`,
  ]
  for (const item of results.slice(0, 10)) {
    const icon = item.skipped ? '⚪' : (item.ok ? '✅' : '❌')
    const latency = item.latencyMs ? ` ${Math.round(item.latencyMs)}ms` : ''
    const err = item.error ? ` · ${String(item.error).replace(/\s+/g, ' ').slice(0, 110)}` : ''
    lines.push(`${icon} ${item.name || item.model || item.profileId}${latency}${err}`)
  }
  if (results.length > 10) lines.push(`……还有 ${results.length - 10} 个渠道未展开`)
  if (skipped.length) lines.push(`跳过：${skipped.length} 个`)
  return lines.join('\n')
}

async function sendNotifications(results = [], cfg = {}, { forceNotify = false } = {}) {
  if (!shouldNotify(results, cfg, { forceNotify })) {
    return { ok: true, skipped: true, reason: 'notify_policy_no_change' }
  }
  const groups = resolveNotifyGroups(cfg)
  if (!groups.length) {
    return { ok: false, skipped: true, reason: 'no_notify_groups_selected_or_online' }
  }
  const text = buildNotificationText(results, cfg)
  const sent = []
  for (const group of groups) {
    const mentionIds = resolveNotifyMentionIdsForGroup(cfg, group)
    const result = await sendWechatyDutyGroupMessage(group.roomId, text, { mentionIds })
    sent.push({ ...group, mention_count: mentionIds.length, ok: !!result?.ok, result })
  }
  lastNotifyAt = nowTimestamp()
  return { ok: sent.some(item => item.ok), groups: sent, text }
}

export async function runLLMConnectivityMonitorCheck({ notify = false, forceNotify = false } = {}) {
  if (monitorRunning) return { ok: false, running: true, error: 'LLM connectivity monitor is already running' }
  monitorRunning = true
  lastError = ''
  const cfg = getLLMConnectivityMonitorConfig()
  try {
    const profiles = selectedProfiles(cfg)
    // testLLMProfileConnection 会更新每个 profile 的最近成功/失败状态并持久化 config。
    // 这里按顺序检测，避免多个渠道同时写 config.json 造成覆盖。
    const results = await mapWithLimit(profiles, 1, async (profile) => {
      const base = {
        profileId: profile.id,
        name: profileLabel(profile),
        provider: profile.providerLabel || profile.provider,
        model: profile.model,
        enabled: profile.enabled !== false,
      }
      if (!profile.configured) return { ...base, ok: false, error: '未配置 API Key 或模型参数' }
      const result = await testLLMProfileConnection(profile.id)
      return {
        ...base,
        ok: !!result.ok,
        latencyMs: result.latencyMs || 0,
        error: result.ok ? '' : (result.error || '连通失败'),
        status: result.ok ? 'up' : 'down',
      }
    })
    lastCheckAt = nowTimestamp()
    lastResults = results
    const notifyResult = notify ? await sendNotifications(results, cfg, { forceNotify }) : { skipped: true, reason: 'notify_false' }
    for (const item of results) lastStatusByProfile.set(String(item.profileId || ''), statusKey(item))
    return { ok: true, checked_at: lastCheckAt, config: cfg, results, notify: notifyResult, status: getLLMConnectivityMonitorStatus() }
  } catch (err) {
    lastError = err?.message || String(err)
    return { ok: false, error: lastError, status: getLLMConnectivityMonitorStatus() }
  } finally {
    monitorRunning = false
  }
}

export async function runLLMConnectivityMonitorTick({ force = false } = {}) {
  const cfg = getLLMConnectivityMonitorConfig()
  if (!cfg.enabled && !force) return { ok: true, skipped: true, reason: 'monitor_disabled' }
  const now = new Date()
  const key = intervalPeriodKey(cfg.intervalMinutes, now)
  if (!force) {
    if (suppressAutoNotifyUntil && Date.now() < suppressAutoNotifyUntil) return { ok: true, skipped: true, reason: 'startup_interval_no_autonotify' }
    if (startupPeriodKey && startupPeriodKey === key) return { ok: true, skipped: true, reason: 'startup_period_no_autonotify' }
    if (lastPeriodKey === key) return { ok: true, skipped: true, reason: 'period_already_checked' }
  }
  lastPeriodKey = key
  return runLLMConnectivityMonitorCheck({ notify: true, forceNotify: force })
}

export function getLLMConnectivityMonitorStatus() {
  const cfg = getLLMConnectivityMonitorConfig()
  return {
    running: monitorRunning,
    scheduler_running: !!monitorTimer,
    last_check_at: lastCheckAt,
    last_notify_at: lastNotifyAt,
    next_check_at: nextCheckIso(cfg),
    last_error: lastError,
    results: lastResults,
  }
}

export function startLLMConnectivityMonitorScheduler() {
  const cfg = getLLMConnectivityMonitorConfig()
  const intervalMinutes = Math.max(Number(cfg.intervalMinutes || 60), 5)
  startupPeriodKey = intervalPeriodKey(intervalMinutes, new Date())
  suppressAutoNotifyUntil = Date.now() + intervalMinutes * 60 * 1000
  if (monitorTimer) return { ok: true, already_running: true, status: getLLMConnectivityMonitorStatus() }
  monitorTimer = setInterval(() => {
    runLLMConnectivityMonitorTick().catch(err => {
      lastError = err?.message || String(err)
      console.warn(`[LLMMonitor] 定时连通检测失败：${lastError}`)
    })
  }, 60 * 1000)
  return { ok: true, status: getLLMConnectivityMonitorStatus() }
}

export function stopLLMConnectivityMonitorScheduler() {
  if (monitorTimer) clearInterval(monitorTimer)
  monitorTimer = null
  startupPeriodKey = ''
  return { ok: true, status: getLLMConnectivityMonitorStatus() }
}
