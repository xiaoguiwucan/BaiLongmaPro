import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDB } from '../db.js'
import { paths } from '../paths.js'
import { nowTimestamp } from '../time.js'
import { config, getSkillImageVisionCredentials, getSkillImageVisionRuntimeCandidates, getWeChatGroupArchiveConfig } from '../config.js'

let schemaReady = false
let pendingDescribeJob = null
const mediaDescribeJobs = new Map()

function ensureSchema() {
  if (schemaReady) return
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_group_media_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      sender_id TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      message_type TEXT NOT NULL DEFAULT '',
      relative_path TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      base64 TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      labels_json TEXT NOT NULL DEFAULT '[]',
      vision_status TEXT NOT NULL DEFAULT 'pending',
      vision_provider TEXT NOT NULL DEFAULT '',
      vision_model TEXT NOT NULL DEFAULT '',
      vision_error TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL DEFAULT '',
      described_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(group_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_wg_media_group_time ON wechat_group_media_items(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_wg_media_status ON wechat_group_media_items(vision_status, updated_at);
  `)
  schemaReady = true
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeSearchText(value = '') {
  try {
    return normalizeText(value)
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .toLowerCase()
  } catch {
    return normalizeText(value).toLowerCase()
  }
}

function compactSearchText(value = '') {
  return normalizeSearchText(value).replace(/[\s\p{P}\p{S}_-]+/gu, '')
}

function normalizeArchiveGroupKey(value = '') {
  return String(value || '').trim().replace(/^wechaty:/iu, '')
}

function archiveGroupMatchesSelection({ groupId = '', groupName = '' } = {}, selected = []) {
  const gid = normalizeArchiveGroupKey(groupId)
  const name = String(groupName || '').trim()
  return (Array.isArray(selected) ? selected : []).some(item => {
    const value = String(item || '').trim()
    if (!value) return false
    const normalized = normalizeArchiveGroupKey(value)
    return value === groupId
      || value === gid
      || normalized === gid
      || (!!name && (value === name || name.includes(value) || value.includes(name)))
  })
}

function getImageParseArchiveRuntimeForGroup({ groupId = '', groupName = '' } = {}) {
  const cfg = getWeChatGroupArchiveConfig()
  const enabled = cfg.enabled !== false
    && cfg.recordMedia !== false
    && cfg.parseImages !== false
    && archiveGroupMatchesSelection({ groupId, groupName }, cfg.effectiveParseImageGroupNames)
  return { config: cfg, enabled }
}

function appendImageParseScopeFilter(filters = [], params = []) {
  const cfg = getWeChatGroupArchiveConfig()
  if (cfg.enabled === false || cfg.recordMedia === false || cfg.parseImages === false) {
    filters.push('0 = 1')
    return
  }
  const selected = Array.isArray(cfg.effectiveParseImageGroupNames) ? cfg.effectiveParseImageGroupNames.map(v => String(v || '').trim()).filter(Boolean) : []
  if (!selected.length) {
    filters.push('0 = 1')
    return
  }
  const clauses = []
  for (const item of selected.slice(0, 300)) {
    const key = normalizeArchiveGroupKey(item)
    clauses.push('(group_id = ? OR group_id = ? OR group_name = ? OR group_name LIKE ?)')
    params.push(item, key, item, `%${item}%`)
  }
  filters.push(`(${clauses.join(' OR ')})`)
}

function hasWechatActivityColumn(db, columnName = '') {
  try {
    return db.prepare(`PRAGMA table_info(wechat_group_activity)`).all()
      .some(row => String(row?.name || '') === String(columnName || ''))
  } catch {
    return false
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toLocalIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function endOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function parseDateOnlyFromQuery(text = '', now = new Date()) {
  const value = String(text || '')
  let base = null
  let label = ''

  const explicitYmd = value.match(/(20\d{2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})\s*(?:日|号)?/u)
  if (explicitYmd) {
    base = new Date(Number(explicitYmd[1]), Number(explicitYmd[2]) - 1, Number(explicitYmd[3]))
    label = `${explicitYmd[1]}-${pad2(explicitYmd[2])}-${pad2(explicitYmd[3])}`
  }

  if (!base) {
    const explicitMd = value.match(/(?:^|[^\d])(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/u)
    if (explicitMd) {
      base = new Date(now.getFullYear(), Number(explicitMd[1]) - 1, Number(explicitMd[2]))
      label = `${pad2(explicitMd[1])}月${pad2(explicitMd[2])}日`
    }
  }

  if (!base) {
    const slashMd = value.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})(?:$|[^\d])/u)
    if (slashMd) {
      base = new Date(now.getFullYear(), Number(slashMd[1]) - 1, Number(slashMd[2]))
      label = `${pad2(slashMd[1])}-${pad2(slashMd[2])}`
    }
  }

  if (!base) {
    const daysAgo = value.match(/(\d{1,2})\s*天前/u)
    const offsetDays = daysAgo ? Number(daysAgo[1])
      : /大前天/u.test(value) ? 3
        : /前天/u.test(value) ? 2
          : /昨天|昨日/u.test(value) ? 1
            : /今天|今日|本日/u.test(value) ? 0
              : null
    if (offsetDays !== null) {
      base = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays)
      label = offsetDays === 0 ? '今天' : offsetDays === 1 ? '昨天' : offsetDays === 2 ? '前天' : `${offsetDays}天前`
    }
  }

  return base ? { date: base, label } : null
}

function parseTimeOfDayFromQuery(text = '') {
  const value = String(text || '')
  const period = (() => {
    if (/凌晨/u.test(value)) return { start: 0, end: 6, label: '凌晨' }
    if (/早上|早晨|上午/u.test(value)) return { start: 6, end: 12, label: '上午' }
    if (/中午/u.test(value)) return { start: 11, end: 14, label: '中午' }
    if (/下午/u.test(value)) return { start: 12, end: 18, label: '下午' }
    if (/傍晚/u.test(value)) return { start: 17, end: 20, label: '傍晚' }
    if (/晚上|夜里|夜晚|晚间/u.test(value)) return { start: 18, end: 24, label: '晚上' }
    return null
  })()

  const hm = value.match(/(?:^|[^\d])([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?:$|[^\d])/u)
  const hourWord = value.match(/(?:^|[^\d])([01]?\d|2[0-3])\s*(?:点|时)(半|[0-5]?\d分?)?(?:左右|前后|多)?/u)
  let hour = null
  let minute = 0
  let exact = false
  if (hm) {
    hour = Number(hm[1])
    minute = Number(hm[2])
    exact = true
  } else if (hourWord) {
    hour = Number(hourWord[1])
    const rawMinute = String(hourWord[2] || '')
    minute = rawMinute === '半' ? 30 : Number(rawMinute.replace(/[^\d]/g, '') || 0)
    exact = true
  }
  if (hour !== null && period?.label === '下午' && hour >= 1 && hour <= 11) hour += 12
  if (hour !== null && period?.label === '晚上' && hour >= 1 && hour <= 11) hour += 12

  return { period, hour, minute, exact }
}

function parseImageTimeIntent(text = '', now = new Date()) {
  const value = String(text || '')
  const recent = /刚才|刚刚|刚发|刚发的|上面|前面|最近|方才/u.test(value)
  const datePart = parseDateOnlyFromQuery(value, now)
  const timePart = parseTimeOfDayFromQuery(value)
  const hasPeriod = !!timePart.period
  const hasExactTime = timePart.hour !== null

  if (!datePart && !hasPeriod && !hasExactTime && !recent) return { active: false }

  if (recent && !datePart && !hasPeriod && !hasExactTime) {
    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    return {
      active: true,
      label: '最近2小时',
      recent: true,
      startMs: start.getTime(),
      endMs: now.getTime(),
      startIso: toLocalIso(start),
      endIso: toLocalIso(now),
    }
  }

  let base = datePart?.date || new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let start = startOfLocalDay(base)
  let end = endOfLocalDay(base)
  let targetMs = 0
  let label = datePart?.label || '今天'

  if (hasPeriod) {
    start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), timePart.period.start, 0, 0, 0)
    end = timePart.period.end >= 24
      ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999)
      : new Date(base.getFullYear(), base.getMonth(), base.getDate(), timePart.period.end, 0, 0, 0)
    label += timePart.period.label
  }

  if (hasExactTime) {
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate(), timePart.hour, timePart.minute, 0, 0)
    targetMs = target.getTime()
    const windowMinutes = String(value || '').includes('左右') || String(value || '').includes('前后') ? 75 : (timePart.minute ? 45 : 75)
    start = new Date(targetMs - windowMinutes * 60 * 1000)
    end = new Date(targetMs + windowMinutes * 60 * 1000)
    label += `${pad2(timePart.hour)}:${pad2(timePart.minute)}附近`
  }

  return {
    active: true,
    label,
    recent,
    exact: hasExactTime,
    targetMs,
    startMs: start.getTime(),
    endMs: end.getTime(),
    startIso: toLocalIso(start),
    endIso: toLocalIso(end),
  }
}

function scoreImageTime(row = {}, timeIntent = {}) {
  if (!timeIntent?.active) return 0
  const rowMs = Date.parse(row.created_at || row.described_at || row.updated_at || '')
  if (!Number.isFinite(rowMs)) return -8
  if (rowMs < timeIntent.startMs || rowMs > timeIntent.endMs) return -16
  if (timeIntent.targetMs) {
    const diffMinutes = Math.abs(rowMs - timeIntent.targetMs) / 60000
    return Math.max(6, 36 - Math.floor(diffMinutes / 3))
  }
  return timeIntent.recent ? 14 : 18
}

function inferMimeType(filePath = '', fallback = '') {
  const value = String(fallback || '').toLowerCase()
  if (value.startsWith('image/')) return value
  switch (path.extname(String(filePath || '').toLowerCase())) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.bmp': return 'image/bmp'
    case '.png':
    default: return 'image/png'
  }
}

function isImageMime(mime = '') {
  return /^image\/(?:png|jpe?g|webp|gif|bmp)$/iu.test(String(mime || ''))
}

export function isVisionCapableModel(model = '') {
  const value = String(model || '').toLowerCase()
  if (!value) return false
  if (/gpt-image|dall-e|embedding|whisper|tts|deepseek|m2\.7|moonshot-v1|glm-4-flash|seedream|agnes-image|agnes-video/u.test(value)) return false
  return /gpt-4o|gpt-4\.1|gpt-5|o3|o4|vision|vl|qwen.*vl|gemini|claude-3|pixtral|llava|agnes-(?:1\.5|2\.0)-flash/u.test(value)
}

function normalizeRuntimeBaseURL(value = '') {
  return String(value || '').trim().replace(/\/$/, '')
}

function normalizeVisionRequestParams(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const blocked = new Set(['messages', 'input', 'image_url'])
  const out = {}
  for (const [key, val] of Object.entries(value)) {
    if (!key || blocked.has(key)) continue
    if (val === undefined || typeof val === 'function') continue
    out[key] = val
  }
  return out
}

function runtimeKey(runtime = {}) {
  // source 只表示“来自当前模型/LLM 列表/识图备用”，不能参与去重。
  // 否则同一个中转 + 同一个模型会被当前模型和 LLM Profile 重复调用，图片解析失败时会白等一轮超时。
  // provider 也不能参与去重：同一个 baseURL + model + key 通过“当前模型/Skill/LLM 列表”
  // 进入候选时，实际调用的是同一个接口，重复请求只会拖慢后台识图。
  return [runtime.model || '', normalizeRuntimeBaseURL(runtime.baseURL || ''), String(runtime.apiKey || '').slice(-10)].join('|')
}

function getVisionRuntimeCandidates(cfg = getSkillImageVisionCredentials()) {
  const candidates = []
  const push = runtime => {
    if (!runtime?.apiKey || !runtime?.baseURL || !runtime?.model) return
    const normalized = { ...runtime, baseURL: normalizeRuntimeBaseURL(runtime.baseURL) }
    const key = runtimeKey(normalized)
    if (!candidates.some(item => runtimeKey(item) === key)) candidates.push(normalized)
  }

  // 显式“识图模型”是用户在图片理解菜单里专门配置的模型，必须优先于普通 LLM。
  // 否则当前聊天模型虽然名字支持视觉，但中转实际可能空返回/超时，会拖慢所有后台图片解析。
  for (const channel of getSkillImageVisionRuntimeCandidates()) {
    push({ provider: channel.provider || 'vision', model: channel.model, apiKey: channel.apiKey, baseURL: channel.baseUrl, requestParams: channel.requestParams, source: `skill:${channel.name || channel.id || channel.model}` })
  }

  if (cfg.failoverEnabled === false) return candidates

  // 当前 LLM 只作为兜底候选：如果专用识图渠道不可用，再尝试它。
  if (cfg.preferCurrentMultimodal && isVisionCapableModel(config.model) && config.apiKey && config.baseURL) {
    push({ provider: config.provider || 'current', model: config.model, apiKey: config.apiKey, baseURL: config.baseURL, source: 'current' })
  }

  for (const profile of config.llmProfiles || []) {
    if (profile?.enabled === false || !profile?.apiKey || !profile?.baseURL || !isVisionCapableModel(profile.model)) continue
    push({ provider: profile.provider || 'profile', model: profile.model, apiKey: profile.apiKey, baseURL: profile.baseURL, source: `llm_profile:${profile.name || profile.id || profile.model}` })
  }

  return candidates
}

function resolveVisionRuntime(cfg = getSkillImageVisionCredentials()) {
  return getVisionRuntimeCandidates(cfg)[0] || null
}

function extractLabels(description = '') {
  const text = normalizeText(description)
  const match = text.match(/(?:关键标签|标签)[:：]\s*([\s\S]*?)(?:如果图中|文字摘录|$)/u)
  if (!match) return []
  return match[1].replace(/[。；;]+$/u, '').split(/[，,、/ ]+/u).map(v => v.trim()).filter(Boolean).slice(0, 16)
}

function safeRelativePath(rel = '') {
  const value = String(rel || '').trim().replace(/\\/g, '/')
  if (!value || value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) return ''
  return value
}

function extractStoredMediaPaths(text = '') {
  const rows = []
  for (const match of String(text || '').matchAll(/\[媒体文件\]\s+([^\n\r]+)/gu)) {
    const rel = safeRelativePath(match[1] || '')
    if (rel) rows.push(rel)
  }
  return [...new Set(rows)]
}

function resetStaleRunningMedia(db) {
  // Electron 被强制重启/旧代码异常退出时，个别图片会永久停在 running。
  // 超过 15 分钟的 running 不可能仍由当前进程处理，自动重排队，保证界面状态真实。
  try {
    const staleBefore = toLocalIso(new Date(Date.now() - 15 * 60 * 1000))
    db.prepare(`
      UPDATE wechat_group_media_items
      SET vision_status='pending', vision_error='', updated_at=?
      WHERE vision_status='running'
        AND description = ''
        AND updated_at <> ''
        AND updated_at < ?
    `).run(nowTimestamp(), staleBefore)
  } catch {}
}

export function upsertWeChatImageMediaItem({ groupId = '', groupName = '', senderId = '', senderName = '', mediaInfo = {}, sourceText = '', messageType = '' } = {}) {
  ensureSchema()
  const filePath = String(mediaInfo.filePath || '').trim()
  const relativePath = safeRelativePath(mediaInfo.relativePath || '')
  if (!filePath || !relativePath || !fs.existsSync(filePath)) return { ok: false, skipped: true, reason: 'missing_file' }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return { ok: false, skipped: true, reason: 'not_file' }
  const mimeType = inferMimeType(filePath, mediaInfo.contentType || mediaInfo.type || '')
  if (!isImageMime(mimeType)) return { ok: false, skipped: true, reason: 'not_image', mimeType }
  const buffer = fs.readFileSync(filePath)
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const cfg = getSkillImageVisionCredentials()
  const maxBytes = Math.max(Number(cfg.maxImageBytesMB || 8), 1) * 1024 * 1024
  const base64 = buffer.length <= maxBytes ? buffer.toString('base64') : ''
  const now = nowTimestamp()
  const db = getDB()
  db.prepare(`
    INSERT INTO wechat_group_media_items (
      group_id, group_name, sender_id, sender_name, message_type, relative_path, file_name, mime_type, bytes, sha256, base64, source_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, sha256) DO UPDATE SET
      group_name = CASE WHEN excluded.group_name <> '' THEN excluded.group_name ELSE wechat_group_media_items.group_name END,
      sender_id = CASE WHEN excluded.sender_id <> '' THEN excluded.sender_id ELSE wechat_group_media_items.sender_id END,
      sender_name = CASE WHEN excluded.sender_name <> '' THEN excluded.sender_name ELSE wechat_group_media_items.sender_name END,
      message_type = CASE WHEN excluded.message_type <> '' THEN excluded.message_type ELSE wechat_group_media_items.message_type END,
      relative_path = CASE WHEN excluded.relative_path <> '' THEN excluded.relative_path ELSE wechat_group_media_items.relative_path END,
      file_name = CASE WHEN excluded.file_name <> '' THEN excluded.file_name ELSE wechat_group_media_items.file_name END,
      mime_type = CASE WHEN excluded.mime_type <> '' THEN excluded.mime_type ELSE wechat_group_media_items.mime_type END,
      bytes = CASE WHEN excluded.bytes > 0 THEN excluded.bytes ELSE wechat_group_media_items.bytes END,
      base64 = CASE WHEN excluded.base64 <> '' THEN excluded.base64 ELSE wechat_group_media_items.base64 END,
      source_text = CASE WHEN excluded.source_text <> '' THEN excluded.source_text ELSE wechat_group_media_items.source_text END,
      updated_at = excluded.updated_at
  `).run(
    String(groupId || ''),
    String(groupName || ''),
    String(senderId || ''),
    String(senderName || ''),
    String(messageType || ''),
    relativePath,
    path.basename(filePath),
    mimeType,
    buffer.length,
    sha256,
    base64,
    String(sourceText || '').slice(0, 2000),
    now,
    now,
  )
  const row = db.prepare(`SELECT * FROM wechat_group_media_items WHERE group_id = ? AND sha256 = ?`).get(String(groupId || ''), sha256)
  return { ok: true, id: row?.id, item: row, storedBase64: !!base64, bytes: buffer.length, mimeType }
}

async function callVisionModel(row, runtime, cfg) {
  const base64 = row.base64 || (() => {
    const filePath = path.join(paths.userDir, row.relative_path || '')
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString('base64') : ''
  })()
  if (!base64) throw new Error('图片超过保存上限或文件不存在，无法转 base64 给识图模型')
  // 真实测试显示部分大图在 gpt-5.4 上需要 30 秒左右才能返回；
  // 这里不能再硬压到 25 秒，否则可用渠道会被误判超时。前台已先回复“正在识别”，允许按设置等待。
  const timeoutSeconds = Math.min(Math.max(Number(cfg.apiTimeoutSeconds || 45), 5), 180)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  try {
    const res = await fetch(`${normalizeRuntimeBaseURL(runtime.baseURL)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...normalizeVisionRequestParams(runtime.requestParams),
        model: runtime.model,
        temperature: 0.1,
        max_tokens: 420,
        messages: [
          {
            role: 'system',
            content: '你是微信群图片识别器。只描述图片可见内容，不要编造来源、人物身份或隐私。输出中文，适合后续让普通文本模型理解这张图。',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请识别这张微信群图片，输出三段：内容描述、关键标签、如果图中有文字请摘录。保持简洁但信息完整。' },
              { type: 'image_url', image_url: { url: `data:${row.mime_type || 'image/png'};base64,${base64}` } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    if (!res.ok) {
      const message = json?.error?.message || json?.message || text.slice(0, 240) || `HTTP ${res.status}`
      throw new Error(message)
    }
    const message = json?.choices?.[0]?.message || {}
    const rawContent = (() => {
      if (typeof message.content === 'string') return message.content
      if (Array.isArray(message.content)) {
        return message.content
          .map(part => typeof part === 'string' ? part : (part?.text || part?.content || ''))
          .filter(Boolean)
          .join('\n')
      }
      return message.text || json?.choices?.[0]?.text || ''
    })()
    return normalizeText(rawContent)
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Request timed out.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function describeWeChatImageMedia({ mediaId, force = false } = {}) {
  const key = Number(mediaId || 0)
  if (key && !force && mediaDescribeJobs.has(key)) return await mediaDescribeJobs.get(key)
  const job = describeWeChatImageMediaInternal({ mediaId, force })
  if (key && !force) mediaDescribeJobs.set(key, job)
  try {
    return await job
  } finally {
    if (key && mediaDescribeJobs.get(key) === job) mediaDescribeJobs.delete(key)
  }
}

async function describeWeChatImageMediaInternal({ mediaId, force = false } = {}) {
  ensureSchema()
  const db = getDB()
  const row = db.prepare(`SELECT * FROM wechat_group_media_items WHERE id = ?`).get(mediaId)
  if (!row) return { ok: false, error: 'media not found' }
  if (row.description && !force) return { ok: true, skipped: true, description: row.description, item: row }
  const cfg = getSkillImageVisionCredentials()
  if (cfg.enabled === false || cfg.autoDescribe === false) {
    db.prepare(`UPDATE wechat_group_media_items SET vision_status='disabled', updated_at=? WHERE id=?`).run(nowTimestamp(), mediaId)
    return { ok: false, skipped: true, error: '识图功能未启用' }
  }
  const runtimes = getVisionRuntimeCandidates(cfg)
  if (!runtimes.length) {
    db.prepare(`UPDATE wechat_group_media_items SET vision_status='no_model', vision_error=?, updated_at=? WHERE id=?`).run('未配置可用的多模态/GPT识图模型', nowTimestamp(), mediaId)
    return { ok: false, error: '未配置可用的多模态/GPT识图模型' }
  }

  const errors = []
  for (const runtime of runtimes) {
    try {
      db.prepare(`UPDATE wechat_group_media_items SET vision_status='running', vision_provider=?, vision_model=?, vision_error='', updated_at=? WHERE id=?`).run(runtime.provider, runtime.model, nowTimestamp(), mediaId)
      const description = await callVisionModel(row, runtime, cfg)
      if (!description) throw new Error('识图模型返回空内容')
      const labels = extractLabels(description)
      db.prepare(`
        UPDATE wechat_group_media_items
        SET description=?, labels_json=?, vision_status='done', vision_provider=?, vision_model=?, vision_error='', described_at=?, updated_at=?
        WHERE id=?
      `).run(description, JSON.stringify(labels), runtime.provider, runtime.model, nowTimestamp(), nowTimestamp(), mediaId)
      return { ok: true, id: mediaId, description, labels, provider: runtime.provider, model: runtime.model, source: runtime.source }
    } catch (err) {
      const message = err?.message || String(err)
      errors.push(`${runtime.source || runtime.provider}/${runtime.model}: ${message}`)
      console.warn(`[WechatImageVision] 识图候选失败 media=${mediaId} runtime=${runtime.source || runtime.provider}/${runtime.model}: ${message}`)
    }
  }

  const finalMessage = errors.join('；').slice(0, 1000) || '识图模型不可用'
  db.prepare(`UPDATE wechat_group_media_items SET vision_status='error', vision_error=?, updated_at=? WHERE id=?`).run(finalMessage, nowTimestamp(), mediaId)
  return { ok: false, error: finalMessage, tried: errors }
}

export async function maybeDescribeWeChatImageMedia({ mediaItem, wait = false } = {}) {
  if (!mediaItem?.id) return { ok: false, skipped: true, reason: 'missing_media' }
  const task = describeWeChatImageMedia({ mediaId: mediaItem.id })
  if (wait) return await task
  task.catch(err => console.warn(`[WechatImageVision] 图片识别失败：${err?.message || err}`))
  return { ok: true, scheduled: true, id: mediaItem.id }
}

export async function waitForWeChatImageMediaDescription({ mediaId, attempts = 3, intervalMs = 5000 } = {}) {
  ensureSchema()
  const id = Number(mediaId || 0)
  if (!id) return { ok: false, error: 'missing_media_id', retryCount: 0 }
  const db = getDB()
  const maxAttempts = Math.min(Math.max(Number(attempts ?? 3), 1), 10)
  const waitMs = Math.min(Math.max(Number(intervalMs ?? 5000), 0), 30000)
  let last = null
  for (let i = 0; i < maxAttempts; i += 1) {
    last = db.prepare(`SELECT * FROM wechat_group_media_items WHERE id = ?`).get(id)
    if (!last) return { ok: false, error: 'media not found', retryCount: i + 1 }
    if (last.description) {
      return {
        ok: true,
        mediaId: id,
        description: last.description,
        labels: (() => { try { return JSON.parse(last.labels_json || '[]') } catch { return [] } })(),
        vision_status: last.vision_status || 'done',
        retryCount: i + 1,
        item: last,
      }
    }
    if (i < maxAttempts - 1 && waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }
  }
  return {
    ok: false,
    mediaId: id,
    description: '',
    labels: [],
    vision_status: last?.vision_status || 'pending',
    vision_error: last?.vision_error || '',
    retryCount: maxAttempts,
    item: last,
  }
}

function normalizeMediaStatusFilter(status = '') {
  const value = String(status || '').trim().toLowerCase()
  if (['done', 'described', 'parsed'].includes(value)) return 'done'
  if (['pending', 'todo', 'waiting'].includes(value)) return 'pending'
  if (['running', 'processing'].includes(value)) return 'running'
  if (['error', 'failed'].includes(value)) return 'error'
  if (['no_model', 'disabled'].includes(value)) return value
  if (['undescribed', 'unparsed'].includes(value)) return 'undescribed'
  return ''
}

function normalizeDateTimeFilter(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00+08:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00+08:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) return raw
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return ''
  return toLocalIso(new Date(ts))
}

function rowToImageMediaItem(row = {}) {
  return {
    id: row.id,
    group_id: row.group_id,
    group_name: row.group_name,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    message_type: row.message_type,
    relative_path: row.relative_path,
    file_name: row.file_name,
    mime_type: row.mime_type,
    bytes: row.bytes,
    sha256: row.sha256,
    has_base64: !!row.base64,
    description: row.description || '',
    labels: (() => { try { return JSON.parse(row.labels_json || '[]') } catch { return [] } })(),
    vision_status: row.description ? 'done' : (row.vision_status || 'pending'),
    vision_provider: row.vision_provider || '',
    vision_model: row.vision_model || '',
    vision_error: row.vision_error || '',
    source_text: row.source_text || '',
    described_at: row.described_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  }
}

export function listWeChatImageMediaItems({ groupId = '', groupName = '', q = '', status = '', sender = '', from = '', to = '', limit = 60, offset = 0 } = {}) {
  ensureSchema()
  const db = getDB()
  resetStaleRunningMedia(db)
  const filters = [`relative_path <> ''`]
  const params = []
  const gid = String(groupId || '').trim()
  const name = String(groupName || '').trim()
  if (gid && gid !== 'all') { filters.push(`group_id = ?`); params.push(gid) }
  else if (name) { filters.push(`group_name = ?`); params.push(name) }

  const statusFilter = normalizeMediaStatusFilter(status)
  if (statusFilter === 'done') filters.push(`description <> ''`)
  else if (statusFilter === 'undescribed' || statusFilter === 'pending') filters.push(`description = ''`)
  else if (statusFilter) { filters.push(`vision_status = ?`); params.push(statusFilter) }

  const keyword = normalizeText(q)
  if (keyword) {
    const qVariants = new Set([keyword.slice(0, 120)])
    const compact = compactSearchText(keyword)
    if (compact.includes('newapi') || /new\s*api/u.test(normalizeSearchText(keyword))) {
      qVariants.add('New API')
      qVariants.add('new api')
      qVariants.add('newapi')
    }
    if (/力佬|大力/u.test(keyword) || compact.includes('dali') || compact.includes('dafi')) {
      qVariants.add('大力')
      qVariants.add('Dali')
      qVariants.add('Dafi')
    }
    const sub = []
    for (const term of qVariants) {
      sub.push(`(description LIKE ? OR labels_json LIKE ? OR source_text LIKE ? OR sender_name LIKE ? OR file_name LIKE ? OR vision_error LIKE ?)`)
      const like = `%${term}%`
      params.push(like, like, like, like, like, like)
    }
    filters.push(`(${sub.join(' OR ')})`)
  }
  const senderQuery = normalizeText(sender)
  if (senderQuery) {
    filters.push(`(sender_name LIKE ? OR sender_id LIKE ?)`)
    params.push(`%${senderQuery.slice(0, 80)}%`, `%${senderQuery.slice(0, 80)}%`)
  }
  const fromIso = normalizeDateTimeFilter(from)
  const toIso = normalizeDateTimeFilter(to)
  if (fromIso) { filters.push(`created_at >= ?`); params.push(fromIso) }
  if (toIso) { filters.push(`created_at <= ?`); params.push(toIso) }

  const where = filters.join(' AND ')
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM wechat_group_media_items WHERE ${where}`).get(...params)?.c || 0)
  const cappedLimit = Math.min(Math.max(Number(limit || 60), 1), 200)
  const safeOffset = Math.max(Number(offset || 0), 0)
  const rows = db.prepare(`
    SELECT *
    FROM wechat_group_media_items
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, cappedLimit, safeOffset)

  const countsRows = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN description <> '' THEN 1 ELSE 0 END) AS described,
      SUM(CASE WHEN description = '' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN vision_status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN vision_status = 'error' THEN 1 ELSE 0 END) AS error,
      SUM(CASE WHEN vision_status = 'no_model' THEN 1 ELSE 0 END) AS no_model,
      SUM(CASE WHEN base64 <> '' THEN 1 ELSE 0 END) AS base64
    FROM wechat_group_media_items
    WHERE ${gid && gid !== 'all' ? 'group_id = ?' : name ? 'group_name = ?' : '1=1'}
  `).get(...(gid && gid !== 'all' ? [gid] : name ? [name] : [])) || {}

  const groups = db.prepare(`
    SELECT group_id, group_name, COUNT(*) AS total,
      SUM(CASE WHEN description <> '' THEN 1 ELSE 0 END) AS described,
      SUM(CASE WHEN description = '' THEN 1 ELSE 0 END) AS pending,
      MAX(created_at) AS latest_at
    FROM wechat_group_media_items
    WHERE relative_path <> ''
    GROUP BY group_id, group_name
    ORDER BY latest_at DESC
    LIMIT 200
  `).all()

  return {
    ok: true,
    total,
    limit: cappedLimit,
    offset: safeOffset,
    has_more: safeOffset + rows.length < total,
    counts: {
      total: Number(countsRows.total || 0),
      described: Number(countsRows.described || 0),
      pending: Number(countsRows.pending || 0),
      running: Number(countsRows.running || 0),
      error: Number(countsRows.error || 0),
      no_model: Number(countsRows.no_model || 0),
      base64: Number(countsRows.base64 || 0),
      worker_running: !!pendingDescribeJob,
    },
    groups,
    items: rows.map(rowToImageMediaItem),
  }
}

export async function processPendingWeChatImageMedia({ groupId = '', groupName = '', limit = 5, retryErrors = true } = {}) {
  ensureSchema()
  const db = getDB()
  resetStaleRunningMedia(db)
  const filters = [`relative_path <> ''`, `description = ''`]
  const params = []
  const gid = String(groupId || '').trim()
  const name = String(groupName || '').trim()
  if (gid && gid !== 'all') {
    const runtime = getImageParseArchiveRuntimeForGroup({ groupId: gid, groupName: name })
    if (!runtime.enabled) return { ok: true, processed: 0, described: 0, skipped: true, reason: 'group_not_selected_for_image_parse', errors: [] }
    filters.push(`group_id = ?`)
    params.push(gid)
  } else if (name) {
    const runtime = getImageParseArchiveRuntimeForGroup({ groupName: name })
    if (!runtime.enabled) return { ok: true, processed: 0, described: 0, skipped: true, reason: 'group_not_selected_for_image_parse', errors: [] }
    filters.push(`group_name = ?`)
    params.push(name)
  } else {
    appendImageParseScopeFilter(filters, params)
  }
  if (!retryErrors) filters.push(`vision_status NOT IN ('error')`)
  const rows = db.prepare(`
    SELECT id
    FROM wechat_group_media_items
    WHERE ${filters.join(' AND ')}
      AND vision_status IN ('pending','running','error','no_model','')
    ORDER BY
      CASE vision_status WHEN 'pending' THEN 0 WHEN '' THEN 1 WHEN 'no_model' THEN 2 WHEN 'error' THEN 3 ELSE 4 END,
      created_at DESC,
      id DESC
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit || 5), 1), 30))
  let processed = 0
  let described = 0
  const errors = []
  for (const row of rows) {
    processed += 1
    const result = await describeWeChatImageMedia({ mediaId: row.id, force: false })
    if (result?.ok || result?.skipped) described += 1
    else if (result?.error) errors.push({ id: row.id, error: result.error })
  }
  return { ok: errors.length === 0, processed, described, errors }
}

export function startWeChatImageBackgroundDescribe(options = {}) {
  if (pendingDescribeJob) return { ok: true, running: true, started: false }
  const opts = { ...options }
  pendingDescribeJob = processPendingWeChatImageMedia(opts)
    .catch(err => ({ ok: false, error: err?.message || String(err) }))
    .finally(() => { pendingDescribeJob = null })
  return { ok: true, running: true, started: true }
}

export async function backfillWeChatImageMediaFromActivity({ groupId = '', groupName = '', limit = 200, describe = false } = {}) {
  ensureSchema()
  const db = getDB()
  const hasRawFull = hasWechatActivityColumn(db, 'raw_text_full')
  const rawFullSelect = hasRawFull ? 'raw_text_full' : "'' AS raw_text_full"
  const rawFullFilter = hasRawFull ? " OR raw_text_full LIKE '%[媒体文件]%'" : ''
  const filters = [`(raw_text LIKE '%[媒体文件]%'${rawFullFilter} OR display_text LIKE '%[媒体文件]%')`]
  const params = []
  const gid = String(groupId || '').trim()
  const name = String(groupName || '').trim()
  if (gid) {
    const runtime = getImageParseArchiveRuntimeForGroup({ groupId: gid, groupName: name })
    if (!runtime.enabled) return { ok: true, scanned: 0, imported: 0, described: 0, skipped: true, reason: 'group_not_selected_for_image_parse', errors: [] }
    filters.push('group_id = ?')
    params.push(gid)
  }
  if (name) {
    const runtime = getImageParseArchiveRuntimeForGroup({ groupId: gid, groupName: name })
    if (!runtime.enabled) return { ok: true, scanned: 0, imported: 0, described: 0, skipped: true, reason: 'group_not_selected_for_image_parse', errors: [] }
    filters.push('group_name = ?')
    params.push(name)
  }
  if (!gid && !name) appendImageParseScopeFilter(filters, params)
  const rows = db.prepare(`
    SELECT id, group_id, group_name, sender_id, sender_name, message_type, raw_text, ${rawFullSelect}, display_text, timestamp
    FROM wechat_group_activity
    WHERE ${filters.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit || 200), 1), 2000))
  let scanned = 0
  let imported = 0
  let described = 0
  const errors = []
  for (const row of rows) {
    const rels = extractStoredMediaPaths(`${row.raw_text_full || ''}\n${row.raw_text || ''}\n${row.display_text || ''}`)
    for (const rel of rels) {
      scanned += 1
      const filePath = path.join(paths.userDir, rel)
      try {
        const result = upsertWeChatImageMediaItem({
          groupId: row.group_id,
          groupName: row.group_name,
          senderId: row.sender_id,
          senderName: row.sender_name,
          messageType: row.message_type,
          sourceText: row.display_text || row.raw_text || '',
          mediaInfo: { filePath, relativePath: rel, type: inferMimeType(filePath) },
        })
        if (result?.ok) {
          imported += 1
          if (describe && result.item?.id) {
            const desc = await describeWeChatImageMedia({ mediaId: result.item.id })
            if (desc?.ok || desc?.skipped) described += 1
            else if (desc?.error) errors.push(`${rel}: ${desc.error}`)
          }
        }
      } catch (err) {
        errors.push(`${rel}: ${err?.message || err}`)
      }
    }
  }
  return { ok: errors.length === 0, scanned, imported, described, errors: errors.slice(0, 20) }
}

export function getWeChatImageMemoryContext({ groupId = '', limit = 12, query = '' } = {}) {
  ensureSchema()
  const gid = String(groupId || '').trim()
  if (!gid) return ''
  const q = normalizeText(query)
  const db = getDB()
  let rows = []
  if (q) {
    rows = db.prepare(`
      SELECT * FROM wechat_group_media_items
      WHERE group_id = ? AND description <> '' AND (description LIKE ? OR source_text LIKE ? OR sender_name LIKE ?)
      ORDER BY described_at DESC, id DESC
      LIMIT ?
    `).all(gid, `%${q.slice(0, 80)}%`, `%${q.slice(0, 80)}%`, `%${q.slice(0, 80)}%`, Math.min(Math.max(Number(limit || 12), 1), 30))
  }
  if (!rows.length) {
    rows = db.prepare(`
      SELECT * FROM wechat_group_media_items
      WHERE group_id = ? AND description <> ''
      ORDER BY described_at DESC, id DESC
      LIMIT ?
    `).all(gid, Math.min(Math.max(Number(limit || 12), 1), 30))
  }
  if (!rows.length) return '<wechat-image-memory>当前群暂无已识别图片。</wechat-image-memory>'
  const lines = rows.map(row => {
    const ts = String(row.described_at || row.created_at || '').slice(0, 16)
    return `- ${ts} ${row.sender_name || row.sender_id || '群成员'} 发图：${row.description}`
  })
  return `<wechat-image-memory source="local-image-vision">\n${lines.join('\n')}\n</wechat-image-memory>`
}

function extractImageSearchTerms(text = '') {
  const cleaned = normalizeText(text)
    .replace(/^[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]{1,40}/u, ' ')
    .replace(/(?:发|发送|转发|传|给我|发我|拿给我|那张|这张|刚才|刚刚|上面|前面|原图|图片|图|照片|引用|一下|吧|啊|呀|哈|的)/gu, ' ')
    .replace(/(?:今天|今日|本日|昨天|昨日|前天|大前天|最近|上午|早上|早晨|中午|下午|傍晚|晚上|夜里|夜晚|凌晨|晚间|\d{1,2}\s*天前|\d{1,2}\s*[:：]\s*[0-5]\d|\d{1,2}\s*(?:点|时)(?:半|[0-5]?\d分?)?(?:左右|前后|多)?|20\d{2}[年./-]\s*\d{1,2}[月./-]\s*\d{1,2}\s*(?:日|号)?|\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = []
  for (const match of cleaned.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}/gu)) {
    const token = match[0]
    if (/^(给我|发送|那张|这张|图片|照片|引用|前夜)$/u.test(token)) continue
    tokens.push(token)
  }
  return [...new Set(tokens)].slice(0, 8)
}

function expandImageSearchTerms(terms = [], query = '') {
  const all = new Set((terms || []).map(v => String(v || '').trim()).filter(Boolean))
  const raw = `${query || ''} ${(terms || []).join(' ')}`
  const norm = normalizeSearchText(raw)
  const compact = compactSearchText(raw)

  // 识图模型经常把 NewAPI 识别成 “New API”；用户一般会连续写成 newapi。
  // 搜索时两个写法必须视为同一个词，否则“给我那张 newapi 图”会找不到。
  if (compact.includes('newapi') || /new\s*api/u.test(norm)) {
    all.add('newapi')
    all.add('new api')
    all.add('new-api')
  }

  // 微信群里常用外号，不一定等于 Wechaty 采到的花体昵称。
  // 先内置当前已出现的“力佬/大力/Dali”别名，后续可再接到成员别名管理。
  if (/力佬|大力/u.test(raw) || compact.includes('dali') || compact.includes('dafi')) {
    all.add('力佬')
    all.add('大力')
    all.add('dali')
    all.add('dafi')
  }

  return [...all].slice(0, 14)
}

function scoreImageSearchTerm({ hay = '', hayCompact = '', term = '', row = {} } = {}) {
  const rawTerm = String(term || '').trim()
  if (!rawTerm) return 0
  const t = normalizeSearchText(rawTerm)
  const tc = compactSearchText(rawTerm)
  if (!t && !tc) return 0
  let score = 0
  const weight = Math.max(2, Math.min(8, (tc || t).length))
  if (hay.includes(t)) score += weight
  if (tc && tc !== t && hay.includes(tc)) score += weight
  if (tc && hayCompact.includes(tc)) score += weight + (tc.length >= 4 ? 2 : 0)

  const senderHay = normalizeSearchText(`${row.sender_name || ''} ${row.sender_id || ''}`)
  const senderCompact = compactSearchText(`${row.sender_name || ''} ${row.sender_id || ''}`)
  if (senderHay.includes(t) || (tc && senderCompact.includes(tc))) score += 6
  return score
}

export function findWeChatImageMediaForRequest({ groupId = '', groupName = '', query = '', limit = 8 } = {}) {
  ensureSchema()
  const db = getDB()
  const gid = String(groupId || '').trim()
  const name = String(groupName || '').trim()
  const timeIntent = parseImageTimeIntent(query)
  const filters = [`relative_path <> ''`]
  const params = []
  if (gid || name) {
    const sub = []
    if (gid) { sub.push('group_id = ?'); params.push(gid) }
    if (name) { sub.push('group_name = ?'); params.push(name) }
    filters.push(`(${sub.join(' OR ')})`)
  }
  if (timeIntent.active && timeIntent.startIso && timeIntent.endIso) {
    filters.push(`created_at >= ? AND created_at <= ?`)
    params.push(timeIntent.startIso, timeIntent.endIso)
  }
  const rows = db.prepare(`
    SELECT * FROM wechat_group_media_items
    WHERE ${filters.join(' AND ')}
    ORDER BY created_at DESC, described_at DESC, id DESC
    LIMIT ${timeIntent.active ? 600 : 160}
  `).all(...params)
  const terms = expandImageSearchTerms(extractImageSearchTerms(query), query)
  const queryNorm = normalizeSearchText(query)
  const queryCompact = compactSearchText(query)
  const scored = rows.map(row => {
    const hayText = [
      row.description || '',
      row.labels_json || '',
      row.source_text || '',
      row.sender_name || '',
      row.sender_id || '',
      row.file_name || '',
    ].join(' ')
    const hay = normalizeSearchText(hayText)
    const hayCompact = compactSearchText(hayText)
    let score = 0
    for (const term of terms) {
      score += scoreImageSearchTerm({ hay, hayCompact, term, row })
    }
    if (/山水|水墨|国画|山水画/u.test(query) && /山水|水墨|国画|群山|云雾|瀑布/u.test(row.description || '')) score += 10
    if (/截图|报错|错误|502|hermes|Hermes/u.test(query) && /截图|报错|错误|502|Hermes|hermes|provider|重试/u.test(row.description || '')) score += 10
    if ((queryCompact.includes('newapi') || /new\s*api/u.test(queryNorm)) && /new\s*api|newapi/u.test(hay)) score += 10
    if (/力佬|大力/u.test(query) && (/大力/u.test(row.description || '') || compactSearchText(row.sender_name || '').includes('dali'))) score += 8
    if (!row.description && /(?:刚才|刚刚|上面|前面|最近|他发|她发|发的)/u.test(query)) score += 1
    score += scoreImageTime(row, timeIntent)
    return { row, score }
  }).filter(item => item.score > 0 || terms.length === 0 || timeIntent.active)
    .sort((a, b) => b.score - a.score || Date.parse(b.row.created_at || '') - Date.parse(a.row.created_at || '') || Number(b.row.id || 0) - Number(a.row.id || 0))
    .slice(0, Math.min(Math.max(Number(limit || 8), 1), 30))
  return {
    ok: true,
    terms,
    timeIntent: timeIntent.active ? {
      label: timeIntent.label,
      startIso: timeIntent.startIso,
      endIso: timeIntent.endIso,
      exact: !!timeIntent.exact,
      recent: !!timeIntent.recent,
    } : null,
    items: scored.map(item => ({ ...item.row, _score: item.score })),
  }
}

function parseQuoteCreateTimeMs(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return 0
  if (/^\d{13}$/u.test(raw)) return Number(raw)
  if (/^\d{10}$/u.test(raw)) return Number(raw) * 1000
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function findWeChatImageMediaForQuote({ groupId = '', groupName = '', quote = {}, query = '', limit = 5 } = {}) {
  ensureSchema()
  if (!quote?.ok || quote.kind !== 'image') return { ok: false, reason: 'quote_not_image', items: [] }
  const db = getDB()
  const gid = String(groupId || '').trim()
  const name = String(groupName || '').trim()
  const filters = [`relative_path <> ''`]
  const params = []
  if (gid || name) {
    const sub = []
    if (gid) { sub.push('group_id = ?'); params.push(gid) }
    if (name) { sub.push('group_name = ?'); params.push(name) }
    filters.push(`(${sub.join(' OR ')})`)
  }
  const rows = db.prepare(`
    SELECT * FROM wechat_group_media_items
    WHERE ${filters.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT 500
  `).all(...params)
  const messageIds = [...new Set([
    quote.messageId,
    ...(Array.isArray(quote.messageIds) ? quote.messageIds : []),
  ].map(v => String(v || '').trim()).filter(Boolean))]
  const rowMatchesMessageId = (row = {}) => {
    if (!messageIds.length) return false
    const sourceText = String(row.source_text || '')
    const fileName = String(row.file_name || '')
    const rowId = String(row.id || '')
    return messageIds.some(id => id && (sourceText.includes(id) || fileName.includes(id) || rowId === id))
  }
  if (messageIds.length) {
    const matched = rows
      .filter(rowMatchesMessageId)
      .map(row => ({ ...row, _score: 100, _match_type: 'message_id' }))
      .slice(0, Math.min(Math.max(Number(limit || 5), 1), 20))
    return {
      ok: true,
      strict: true,
      messageIds,
      reason: matched.length ? 'quote_message_id_matched' : 'quote_message_id_not_found',
      items: matched,
    }
  }
  const sender = normalizeSearchText(quote.sender || '')
  const senderCompact = compactSearchText(quote.sender || '')
  const quoteMs = parseQuoteCreateTimeMs(quote.createTime)
  const terms = expandImageSearchTerms(extractImageSearchTerms(`${query} ${quote.content || ''}`), `${query} ${quote.content || ''}`)
  const scored = rows.map(row => {
    const sourceText = String(row.source_text || '')
    const fileName = String(row.file_name || '')
    const hayText = [
      row.description || '',
      row.labels_json || '',
      row.source_text || '',
      row.sender_name || '',
      row.sender_id || '',
      row.file_name || '',
    ].join(' ')
    const hay = normalizeSearchText(hayText)
    const hayCompact = compactSearchText(hayText)
    let score = 0
    for (const id of messageIds) {
      if (id && (sourceText.includes(id) || fileName.includes(id) || String(row.id || '') === id)) score += 80
    }
    const rowSender = normalizeSearchText(`${row.sender_name || ''} ${row.sender_id || ''}`)
    const rowSenderCompact = compactSearchText(`${row.sender_name || ''} ${row.sender_id || ''}`)
    if (sender && rowSender.includes(sender)) score += 18
    if (senderCompact && rowSenderCompact.includes(senderCompact)) score += 18
    if (quoteMs) {
      const rowMs = Date.parse(row.created_at || row.updated_at || '')
      if (Number.isFinite(rowMs)) {
        const diffMinutes = Math.abs(rowMs - quoteMs) / 60000
        if (diffMinutes <= 2) score += 60
        else if (diffMinutes <= 10) score += 42
        else if (diffMinutes <= 60) score += 24
        else if (diffMinutes <= 24 * 60) score += 8
      }
    }
    for (const term of terms) score += scoreImageSearchTerm({ hay, hayCompact, term, row })
    if (!score && /(?:刚才|上面|前面|引用|这张|那张|看看|看下)/u.test(`${query} ${quote.content || ''}`)) score += 1
    return { row, score }
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.row.created_at || '') - Date.parse(a.row.created_at || '') || Number(b.row.id || 0) - Number(a.row.id || 0))
    .slice(0, Math.min(Math.max(Number(limit || 5), 1), 20))
  return { ok: true, messageIds, items: scored.map(item => ({ ...item.row, _score: item.score })) }
}

export function resolveWeChatImageMediaFile(row = {}) {
  const rel = safeRelativePath(row.relative_path || '')
  if (!rel) return { ok: false, error: 'invalid media path' }
  const root = path.resolve(paths.userDir)
  const filePath = path.resolve(root, rel)
  const diff = path.relative(root, filePath)
  if (!diff || diff.startsWith('..') || path.isAbsolute(diff)) return { ok: false, error: 'invalid media path' }
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return { ok: false, error: 'media file not found' }
    if (!isImageMime(inferMimeType(filePath, row.mime_type))) return { ok: false, error: 'not image' }
    return { ok: true, filePath, bytes: stat.size, mimeType: inferMimeType(filePath, row.mime_type), relativePath: rel }
  } catch {
    return { ok: false, error: 'media file not found' }
  }
}

export function updateWeChatImageMediaItem({ id, description = '', labels = [], visionStatus = 'done' } = {}) {
  ensureSchema()
  const mediaId = Number(id || 0)
  if (!mediaId) return { ok: false, error: 'id required' }
  const db = getDB()
  const row = db.prepare(`SELECT * FROM wechat_group_media_items WHERE id = ?`).get(mediaId)
  if (!row) return { ok: false, error: 'image not found' }
  const cleanDescription = String(description || '').trim().slice(0, 12000)
  const cleanLabels = (Array.isArray(labels) ? labels : String(labels || '').split(/[，,、\n\r]+/u))
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .slice(0, 30)
  const status = cleanDescription ? (visionStatus || 'done') : (visionStatus || row.vision_status || 'pending')
  db.prepare(`
    UPDATE wechat_group_media_items
    SET description = ?, labels_json = ?, vision_status = ?, vision_error = '',
        described_at = CASE WHEN ? <> '' THEN COALESCE(NULLIF(described_at, ''), ?) ELSE described_at END,
        updated_at = ?
    WHERE id = ?
  `).run(cleanDescription, JSON.stringify(cleanLabels), status, cleanDescription, nowTimestamp(), nowTimestamp(), mediaId)
  const next = db.prepare(`SELECT * FROM wechat_group_media_items WHERE id = ?`).get(mediaId)
  return { ok: true, item: rowToImageMediaItem(next) }
}

export function deleteWeChatImageMediaItem({ id, deleteFile = true } = {}) {
  ensureSchema()
  const mediaId = Number(id || 0)
  if (!mediaId) return { ok: false, error: 'id required' }
  const db = getDB()
  const row = db.prepare(`SELECT * FROM wechat_group_media_items WHERE id = ?`).get(mediaId)
  if (!row) return { ok: false, error: 'image not found' }
  const resolved = resolveWeChatImageMediaFile(row)
  let fileDeleted = false
  let fileDeleteError = ''
  if (deleteFile && resolved.ok) {
    try {
      fs.unlinkSync(resolved.filePath)
      fileDeleted = true
    } catch (err) {
      fileDeleteError = err?.message || String(err)
    }
  }
  db.prepare(`DELETE FROM wechat_group_media_items WHERE id = ?`).run(mediaId)
  return {
    ok: true,
    deleted_id: mediaId,
    file_deleted: fileDeleted,
    file_delete_error: fileDeleteError,
    item: rowToImageMediaItem(row),
  }
}

export function getWeChatImageVisionStatus() {
  ensureSchema()
  const db = getDB()
  resetStaleRunningMedia(db)
  const cfg = getSkillImageVisionCredentials()
  const runtime = resolveVisionRuntime(cfg)
  const scalar = sql => {
    try { return Number(Object.values(db.prepare(sql).get() || {})[0] || 0) } catch { return 0 }
  }
  const latestDone = (() => {
    try {
      return db.prepare(`SELECT id, group_name, sender_name, vision_model, vision_provider, described_at, updated_at FROM wechat_group_media_items WHERE description <> '' ORDER BY COALESCE(NULLIF(described_at,''), updated_at) DESC, id DESC LIMIT 1`).get() || null
    } catch { return null }
  })()
  const latestError = (() => {
    try {
      return db.prepare(`SELECT id, group_name, sender_name, vision_model, vision_provider, vision_status, vision_error, updated_at FROM wechat_group_media_items WHERE vision_status IN ('error','no_model') OR vision_error <> '' ORDER BY updated_at DESC, id DESC LIMIT 1`).get() || null
    } catch { return null }
  })()
  const doneMs = Date.parse(latestDone?.described_at || latestDone?.updated_at || '')
  const errorMs = Date.parse(latestError?.updated_at || '')
  const recentDoneMs = Date.now() - 6 * 60 * 60 * 1000
  const health = !runtime
    ? 'no_model'
    : (Number.isFinite(doneMs) && doneMs >= recentDoneMs)
      ? 'ok'
      : (latestError && (!Number.isFinite(doneMs) || (Number.isFinite(errorMs) && errorMs >= doneMs)))
      ? 'error'
      : latestDone
        ? 'ok'
        : 'configured'
  return {
    enabled: cfg.enabled !== false,
    autoDescribe: cfg.autoDescribe !== false,
    configured: !!runtime,
    health,
    runtime: runtime ? { provider: runtime.provider, model: runtime.model, baseURL: runtime.baseURL, source: runtime.source } : null,
    worker: { running: !!pendingDescribeJob },
    counts: {
      total: scalar('SELECT COUNT(*) FROM wechat_group_media_items'),
      described: scalar("SELECT COUNT(*) FROM wechat_group_media_items WHERE description <> ''"),
      pending: scalar("SELECT COUNT(*) FROM wechat_group_media_items WHERE vision_status IN ('pending','running','no_model') AND description = ''"),
      running: scalar("SELECT COUNT(*) FROM wechat_group_media_items WHERE vision_status = 'running' AND description = ''"),
      error: scalar("SELECT COUNT(*) FROM wechat_group_media_items WHERE vision_status = 'error' AND description = ''"),
      base64: scalar("SELECT COUNT(*) FROM wechat_group_media_items WHERE base64 <> ''"),
    },
    latest_done: latestDone,
    latest_error: latestError,
  }
}

export async function testWeChatImageVision({ imagePath = '' } = {}) {
  const filePath = imagePath || path.join(paths.dataDir, 'generated-images')
  return getWeChatImageVisionStatus()
}
