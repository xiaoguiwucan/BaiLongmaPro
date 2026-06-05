import crypto from 'crypto'
import { getHotspotAlertConfig } from './config.js'
import { getHotspots } from './hotspots.js'
import { nowTimestamp } from './time.js'
import { getWechatyDutyGroupStatus, sendWechatyDutyGroupMessage } from './social/wechaty-duty-group.js'
import { renderHotspotAlertPosterPng } from './hotspot-alert-renderer.js'

const PLATFORM_LABELS = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  wechat: '微信热点',
  weibo: '微博',
}

let monitorTimer = null
let monitorRunning = false
let lastCheckAt = ''
let lastNotifyAt = ''
let lastError = ''
let lastEvents = []
let lastSnapshot = new Map()
let sentAtByEvent = new Map()
let lastPeriodKey = ''
let startupPeriodKey = ''
let suppressAutoNotifyUntil = 0

function intervalPeriodKey(minutes = 10, date = new Date()) {
  const ms = Math.max(Number(minutes || 10), 5) * 60 * 1000
  return `${Math.max(Number(minutes || 10), 5)}m:${Math.floor(date.getTime() / ms)}`
}

function nextCheckIso(cfg = getHotspotAlertConfig()) {
  if (!cfg.enabled) return ''
  const minutes = Math.max(Number(cfg.intervalMinutes || 10), 5)
  const base = lastCheckAt ? Date.parse(lastCheckAt) : Date.now()
  if (!Number.isFinite(base)) return ''
  return new Date(base + minutes * 60 * 1000).toISOString()
}

function localTime(date = new Date()) {
  try {
    return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return date.toISOString().replace('T', ' ').slice(5, 16)
  }
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
  const map = cfg.notifyMentionsByGroup && typeof cfg.notifyMentionsByGroup === 'object' ? cfg.notifyMentionsByGroup : {}
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

function itemTitle(item = {}) {
  return String(item.title || item.name || item.keyword || item.word || '').replace(/\s+/g, ' ').trim()
}

function itemRank(item = {}, fallback = 0) {
  const n = Number(item.rank ?? item.index ?? item.position)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback + 1
}

function itemHeat(item = {}) {
  return String(item.heat || item.hot || item.value || item.score || '').trim()
}

function eventId(platform = '', title = '') {
  const hash = crypto.createHash('sha1').update(`${platform}:${title.toLowerCase()}`).digest('hex').slice(0, 12)
  return `hotspot_alert_${hash}`
}

function flattenHotspots(data = {}, cfg = {}) {
  const platforms = Array.isArray(cfg.platforms) && cfg.platforms.length ? cfg.platforms : Object.keys(data.platforms || {})
  const rows = []
  for (const platform of platforms) {
    const items = Array.isArray(data.platforms?.[platform]) ? data.platforms[platform] : []
    items.forEach((item, index) => {
      const title = itemTitle(item)
      if (!title) return
      const rank = itemRank(item, index)
      rows.push({
        id: eventId(platform, title),
        platform,
        platformLabel: PLATFORM_LABELS[platform] || platform,
        title,
        rank,
        heat: itemHeat(item),
        url: String(item.url || item.link || '').trim(),
        source: String(item.source || data.status?.[platform]?.source || '').trim(),
      })
    })
  }
  return rows
}

function matchKeywords(title = '', keywords = []) {
  const value = String(title || '').toLowerCase()
  return (Array.isArray(keywords) ? keywords : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => value.includes(item.toLowerCase()))
}

function shouldDedupe(event = {}, cfg = {}, now = Date.now()) {
  const last = sentAtByEvent.get(event.id)
  if (!last) return false
  const ttl = Math.max(Number(cfg.dedupeHours || 6), 1) * 3600 * 1000
  return now - last < ttl
}

function detectEvents(rows = [], cfg = {}, { baselineOnly = false, forceNotify = false } = {}) {
  const now = Date.now()
  const nextSnapshot = new Map()
  const events = []
  for (const row of rows) {
    const previous = lastSnapshot.get(row.id)
    nextSnapshot.set(row.id, { rank: row.rank, seenAt: now, title: row.title, platform: row.platform })
    if (baselineOnly) continue
    const keywords = matchKeywords(row.title, cfg.keywords)
    const newTop = !previous && row.rank <= Number(cfg.topN || 10)
    const rankRise = previous && previous.rank - row.rank >= Number(cfg.rankRiseThreshold || 5)
    const keywordMatch = keywords.length > 0
    const includeAll = forceNotify && row.rank <= Number(cfg.topN || 10)
    if (!newTop && !rankRise && !keywordMatch && !includeAll) continue
    const type = keywordMatch ? 'keyword' : rankRise ? 'rank_rise' : newTop ? 'new_top' : 'top'
    const event = {
      ...row,
      type,
      previousRank: previous?.rank || 0,
      keywords,
      detectedAt: new Date(now).toISOString(),
    }
    if (!forceNotify && shouldDedupe(event, cfg, now)) continue
    events.push(event)
  }
  lastSnapshot = nextSnapshot
  return events
    .sort((a, b) => {
      const priority = { keyword: 0, rank_rise: 1, new_top: 2, top: 3 }
      return (priority[a.type] ?? 9) - (priority[b.type] ?? 9) || a.rank - b.rank
    })
    .slice(0, Math.max(Number(cfg.maxAlertsPerRun || 8), 1))
}

function eventLine(event = {}) {
  const typeText = event.type === 'keyword'
    ? `关键词命中：${event.keywords.join('、')}`
    : event.type === 'rank_rise'
      ? `排名上升 ${event.previousRank}→${event.rank}`
      : event.type === 'new_top'
        ? `新进 Top${event.rank}`
        : `Top${event.rank}`
  const heat = event.heat ? ` · 热度 ${event.heat}` : ''
  return `- ${event.platformLabel} #${event.rank} ${event.title}（${typeText}${heat}）`
}

function buildNotificationText(events = [], cfg = {}) {
  const lines = [
    `舆情变动提醒：${events.length} 条`,
    `时间：${localTime(new Date())}；规则：Top${cfg.topN} / 上升 ${cfg.rankRiseThreshold} 位 / 关键词 ${cfg.keywords.length || 0} 个`,
    ...events.map(eventLine),
  ]
  return lines.join('\n').slice(0, 1800)
}

async function sendNotifications(events = [], cfg = {}, { forceNotify = false } = {}) {
  if (!events.length && !forceNotify) return { ok: true, skipped: true, reason: 'no_alert_events' }
  const groups = resolveNotifyGroups(cfg)
  if (!groups.length) return { ok: false, skipped: true, reason: 'no_notify_groups_selected_or_online' }
  const text = buildNotificationText(events, cfg)
  let poster = null
  let posterError = ''
  try {
    poster = await renderHotspotAlertPosterPng(events, cfg)
  } catch (err) {
    posterError = err?.message || String(err)
    console.warn(`[HotspotAlert] 舆情海报渲染失败，回退文字：${posterError}`)
  }
  const sent = []
  for (const group of groups) {
    const mentionIds = resolveNotifyMentionIdsForGroup(cfg, group)
    let result = null
    let mode = 'text'
    if (poster?.ok && poster.filePath) {
      mode = 'image'
      result = await sendWechatyDutyGroupMessage(group.roomId, '', {
        mentionIds,
        imageFilePaths: [poster.filePath],
        timeoutMs: 45000,
      })
      if (!result?.ok) {
        console.warn(`[HotspotAlert] 舆情海报发送失败，回退文字 group="${group.groupName}" reason="${result?.reason || result?.error || 'unknown'}"`)
        mode = 'text_fallback'
        result = await sendWechatyDutyGroupMessage(group.roomId, text, { mentionIds })
      }
    } else {
      result = await sendWechatyDutyGroupMessage(group.roomId, text, { mentionIds })
    }
    sent.push({ ...group, mention_count: mentionIds.length, ok: !!result?.ok, mode, result })
  }
  const now = Date.now()
  for (const event of events) sentAtByEvent.set(event.id, now)
  lastNotifyAt = nowTimestamp()
  return { ok: sent.some(item => item.ok), groups: sent, text, poster: poster?.ok ? poster : null, poster_error: posterError }
}

export async function runHotspotAlertCheck({ notify = false, forceNotify = false } = {}) {
  if (monitorRunning) return { ok: false, running: true, error: 'hotspot alert monitor is already running' }
  monitorRunning = true
  lastError = ''
  const cfg = getHotspotAlertConfig()
  const shouldForceNotify = forceNotify || cfg.notifyMode === 'all'
  try {
    const data = await getHotspots({ force: true })
    const rows = flattenHotspots(data, cfg)
    const baselineOnly = !lastSnapshot.size && !shouldForceNotify
    const events = detectEvents(rows, cfg, { baselineOnly, forceNotify: shouldForceNotify })
    lastCheckAt = nowTimestamp()
    lastEvents = events
    const notifyResult = notify ? await sendNotifications(events, cfg, { forceNotify: shouldForceNotify }) : { skipped: true, reason: 'notify_false' }
    return {
      ok: true,
      checked_at: lastCheckAt,
      baseline_only: baselineOnly,
      count: rows.length,
      events,
      notify: notifyResult,
      status: getHotspotAlertStatus(),
    }
  } catch (err) {
    lastError = err?.message || String(err)
    return { ok: false, error: lastError, status: getHotspotAlertStatus() }
  } finally {
    monitorRunning = false
  }
}

export async function runHotspotAlertTick({ force = false } = {}) {
  const cfg = getHotspotAlertConfig()
  if (!cfg.enabled && !force) return { ok: true, skipped: true, reason: 'hotspot_alert_disabled' }
  const now = new Date()
  const key = intervalPeriodKey(cfg.intervalMinutes, now)
  if (!force) {
    if (suppressAutoNotifyUntil && Date.now() < suppressAutoNotifyUntil) return { ok: true, skipped: true, reason: 'startup_interval_no_autonotify' }
    if (startupPeriodKey && startupPeriodKey === key) return { ok: true, skipped: true, reason: 'startup_period_no_autonotify' }
    if (lastPeriodKey === key) return { ok: true, skipped: true, reason: 'period_already_checked' }
  }
  lastPeriodKey = key
  return runHotspotAlertCheck({ notify: true, forceNotify: force })
}

export function getHotspotAlertStatus() {
  const cfg = getHotspotAlertConfig()
  return {
    running: monitorRunning,
    scheduler_running: !!monitorTimer,
    last_check_at: lastCheckAt,
    last_notify_at: lastNotifyAt,
    next_check_at: nextCheckIso(cfg),
    last_error: lastError,
    last_events: lastEvents,
    snapshot_size: lastSnapshot.size,
    sent_cache_size: sentAtByEvent.size,
  }
}

export function startHotspotAlertScheduler() {
  const cfg = getHotspotAlertConfig()
  if (!cfg.enabled) {
    stopHotspotAlertScheduler()
    return { ok: true, skipped: true, reason: 'hotspot_alert_disabled', status: getHotspotAlertStatus() }
  }
  const intervalMinutes = Math.max(Number(cfg.intervalMinutes || 10), 5)
  startupPeriodKey = intervalPeriodKey(intervalMinutes, new Date())
  suppressAutoNotifyUntil = Date.now() + intervalMinutes * 60 * 1000
  if (monitorTimer) return { ok: true, already_running: true, status: getHotspotAlertStatus() }
  monitorTimer = setInterval(() => {
    runHotspotAlertTick().catch(err => {
      lastError = err?.message || String(err)
      console.warn(`[HotspotAlert] 定时舆情监测失败：${lastError}`)
    })
  }, 60 * 1000)
  return { ok: true, status: getHotspotAlertStatus() }
}

export function stopHotspotAlertScheduler() {
  if (monitorTimer) clearInterval(monitorTimer)
  monitorTimer = null
  startupPeriodKey = ''
  return { ok: true, status: getHotspotAlertStatus() }
}
