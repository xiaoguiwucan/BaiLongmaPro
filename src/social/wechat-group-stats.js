import { getDB } from '../db.js'
import { nowTimestamp } from '../time.js'
import { getWeChatGroupDigestConfig } from '../config.js'
import { paths } from '../paths.js'
import fs from 'fs'
import path from 'path'

const MAX_TEXT_LENGTH = 2400

const WECHATY_TYPE_NAMES = {
  0: 'unknown',
  1: 'attachment',
  2: 'audio',
  3: 'contact',
  4: 'chat_history',
  5: 'emoji',
  6: 'image',
  7: 'text',
  8: 'location',
  9: 'mini_program',
  10: 'group_note',
  11: 'transfer',
  12: 'red_envelope',
  13: 'recalled',
  14: 'link',
  15: 'video',
  16: 'post',
}

const BRAG_PATTERNS = [
  /(?:我|哥|爷|本人|咱|咱们).{0,8}(?:早就|随便|轻松|闭眼|秒|拿捏|吊打|乱杀|碾压|无敌|遥遥领先|封神|王者|顶级|高端|专业|天花板)/u,
  /(?:懂不懂|格局|这才叫|看我操作|不是我吹|不装了|摊牌了|低调|小意思|基操|洒洒水|随便拿捏)/u,
  /(?:牛逼|牛批|太强了|强无敌|大佬|大神|专家|大师|天才|遥遥领先|降维打击|秒了|赢麻了|装逼|凡尔赛)/u,
]

const IMPORTANT_RE = /(重要|确定|决定|待办|安排|问题|风险|上线|发布|修复|报错|失败|需要|今天|明天|截止|会议|方案|结论|确认|负责人|进度|报警|告警|事故|复盘)/u
const URL_RE = /https?:\/\/[^\s<>'"）)]+/giu
const EMOJI_XML_RE = /<msg[\s\S]{0,800}<emoji|<emoji\b|cdnurl=|emoji[^>]{0,120}(?:md5|len|aeskey)/iu
const IMAGE_XML_RE = /<img\b|<image\b|cdnthumburl=|cdnmidimgurl=|(?:\.jpg|\.jpeg|\.png|\.gif|\.webp)(?:\?|$)/iu
const MINI_PROGRAM_RE = /<appmsg\b|<weappinfo\b|小程序/u
const XML_LIKE_RE = /^<\?xml|^<msg\b|^<appmsg\b|^<sysmsg\b/iu

let schemaReady = false

export function formatWeChatLocalDateTime(value = '') {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).replace('T', ' ').slice(0, 19)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function isWeChatInternalIdLike(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  return /^wechaty:/iu.test(text)
    || /^@@?[a-f0-9]{16,}$/iu.test(text)
    || /^@(?:[a-f0-9_-]{16,}|[0-9a-z_-]{24,})$/iu.test(text)
    || /^wxid_[a-z0-9_-]{8,}$/iu.test(text)
    || /^gh_[a-z0-9_-]{8,}$/iu.test(text)
}

function pickWeChatDisplayName(candidates = [], fallback = '') {
  const list = Array.isArray(candidates) ? candidates : [candidates]
  for (const item of [...list, fallback]) {
    const value = String(item || '').trim()
    if (value && !/^(未知成员|unknown)$/iu.test(value) && !isWeChatInternalIdLike(value)) return value
  }
  const safeFallback = String(fallback || '').trim()
  return safeFallback && !/^(未知成员|unknown)$/iu.test(safeFallback) && !isWeChatInternalIdLike(safeFallback) ? safeFallback : '未知成员'
}

function splitNameCandidates(value = '') {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function cleanStatsGroupName(value = '') {
  return String(value || '').trim()
}

function resolveQueryGroupName(db, gid = '', groupName = '') {
  const explicit = cleanStatsGroupName(groupName)
  if (explicit) return explicit
  if (!gid) return ''
  try {
    const row = db.prepare(`
      SELECT group_name
      FROM wechat_group_activity
      WHERE group_id = ? AND group_name <> ''
      ORDER BY id DESC
      LIMIT 1
    `).get(gid)
    return cleanStatsGroupName(row?.group_name)
  } catch {
    return ''
  }
}

function groupWhereClause(gid = '', groupName = '', alias = '') {
  const prefix = alias ? `${alias}.` : ''
  const name = cleanStatsGroupName(groupName)
  if (name) return { sql: `(${prefix}group_id = ? OR ${prefix}group_name = ?)`, params: [gid, name] }
  return { sql: `${prefix}group_id = ?`, params: [gid] }
}

function normalizeSearchDateInput(value = '', boundary = 'start') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  let normalized = raw
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    normalized = `${raw}T${boundary === 'end' ? '23:59:59' : '00:00:00'}`
  } else if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}$/u.test(raw)) {
    normalized = `${raw.replace(' ', 'T')}:${boundary === 'end' ? '59' : '00'}`
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/u.test(raw)) {
    normalized = raw.replace(' ', 'T')
  }
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? normalized : toLocalTimestamp(parsed)
}

function extractArchiveSearchTerms(query = '') {
  const value = String(query || '').trim()
  const stop = new Set('这个 那个 什么 怎么 为啥 为什么 是否 是谁 哪个 哪里 之前 现在 当前 聊天 记录 数据 忘了 你们 我们 他们 还有 一下 说是 有没有 帮我 看看 查询 记得 不记得 知道 不知道'.split(' '))
  const terms = []
  for (const match of value.matchAll(/[“"「『']([^”"」』']{1,24})[”"」』']/gu)) {
    const term = match[1]?.trim()
    if (term) terms.push(term)
  }
  // 不把开头 @ 助手账号当检索词，否则群里每条 @ 助手的消息都会命中，淹没真正关键词。
  const withoutMentions = value.replace(/[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、?？!！]{1,24}/gu, ' ')
  for (const token of withoutMentions.match(/[\u4e00-\u9fa5A-Za-z0-9_]{2,16}/gu) || []) {
    if (!stop.has(token) && !/^\d+$/.test(token)) terms.push(token)
  }
  for (const special of ['老登', '大哥', '义父', '老板', '群主', '管理', '管理员', '向量记忆', '称呼', '外号']) {
    if (value.includes(special)) terms.push(special)
  }
  return [...new Set(terms.map(item => item.trim()).filter(item => item && item.length <= 24))].slice(0, 8)
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scoreArchiveEvidenceRow(row = {}, terms = [], query = '') {
  const text = `${row.display_text || ''}\n${row.raw_text || ''}`
  const sender = String(row.sender_name || '')
  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (text.includes(term)) score += 8
    if (sender.includes(term)) score += 5
    const safeTerm = escapeRegex(term)
    if (new RegExp(`${safeTerm}.{0,12}(?:就是|是|指|意思|叫|称呼|代表)|(?:就是|是|指|意思|叫|称呼).{0,12}${safeTerm}`, 'u').test(text)) score += 30
  }
  if (/(?:是谁|什么|啥意思|什么意思|叫谁|哪个|哪位)/u.test(query) && /(?:就是|是|指|意思|叫|称呼|代表)/u.test(text)) score += 12
  if (row.mentioned_self) score += 2
  score += Math.min(Number(row.id || 0) / 1000000, 1)
  return score
}

function getMemberDisplayNameMap(db, gid, groupName = '') {
  ensureSchema()
  const name = cleanStatsGroupName(groupName)
  const where = name ? '(group_id = ? OR group_name = ?)' : 'group_id = ?'
  const params = name ? [gid, name] : [gid]
  const rows = db.prepare(`
    SELECT sender_id, display_name
    FROM wechat_group_member_names
    WHERE ${where}
    ORDER BY last_seen DESC
  `).all(...params)
  const map = new Map()
  for (const row of rows) {
    const sid = String(row.sender_id || '')
    if (sid && !map.has(sid)) map.set(sid, String(row.display_name || ''))
  }
  return map
}

function normalizeStatsIdentityName(value = '') {
  let text = String(value || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  try { text = text.normalize('NFKC') } catch {}
  return text.toLowerCase()
}

function getMemberIdentityContext(db, gid, groupName = '') {
  ensureSchema()
  const name = cleanStatsGroupName(groupName)
  const where = name ? '(group_id = ? OR group_name = ?)' : 'group_id = ?'
  const params = name ? [gid, name] : [gid]
  const rows = db.prepare(`
    SELECT sender_id, display_name, room_alias, contact_alias, contact_name, wechat_id, wxid, stable_key, last_seen
    FROM wechat_group_member_names
    WHERE ${where}
    ORDER BY last_seen DESC
  `).all(...params)
  const bySender = new Map()
  const displayByIdentity = new Map()
  for (const row of rows) {
    const sid = String(row.sender_id || '').trim()
    const displayName = pickWeChatDisplayName([row.display_name, row.room_alias, row.contact_alias, row.contact_name], sid)
    const stable = String(row.stable_key || row.wxid || row.wechat_id || '').trim()
    const nameKey = normalizeStatsIdentityName(displayName)
    const identityKey = stable
      ? `stable:${stable}`
      : (nameKey && displayName !== '未知成员' && !isWeChatInternalIdLike(displayName))
        ? `name:${nameKey}`
        : (sid ? `sender:${sid}` : '')
    if (sid && !bySender.has(sid)) bySender.set(sid, { displayName, stable, identityKey, lastSeen: row.last_seen || '' })
    if (identityKey && !displayByIdentity.has(identityKey) && displayName && displayName !== '未知成员') {
      displayByIdentity.set(identityKey, displayName)
    }
  }
  return { bySender, displayByIdentity }
}

function resolveStatsSenderIdentity(row = {}, context = { bySender: new Map(), displayByIdentity: new Map() }) {
  const sid = String(row.sender_id || '').trim()
  const senderKey = String(row.sender_key || sid || '').trim()
  const names = splitNameCandidates(row.sender_names || row.sender_name || '')
  const mapped = context.bySender.get(sid)
  const displayName = pickWeChatDisplayName([mapped?.displayName, ...names], sid || senderKey)
  const stable = String(mapped?.stable || '').trim()
  const nameKey = normalizeStatsIdentityName(displayName)
  const identityKey = stable
    ? `stable:${stable}`
    : (nameKey && displayName !== '未知成员' && !isWeChatInternalIdLike(displayName))
      ? `name:${nameKey}`
      : `sender:${senderKey || sid || 'unknown'}`
  return {
    identityKey,
    displayName: context.displayByIdentity.get(identityKey) || displayName,
  }
}

function rowWithDisplayName(row = {}, nameMap = new Map()) {
  const mapped = nameMap.get(String(row.sender_id || ''))
  const senderName = pickWeChatDisplayName([mapped, row.sender_name], row.sender_id)
  return {
    ...row,
    sender_name: senderName,
    sender_display_name: senderName,
    timestamp_display: formatWeChatLocalDateTime(row.timestamp),
    media_files: mediaMetadataFromText(`${row.raw_text || ''}\n${row.display_text || ''}`),
  }
}

function extractStoredMediaPaths(text = '') {
  const mediaPaths = []
  for (const match of String(text || '').matchAll(/\[媒体文件\]\s+([^\n\r]+)/gu)) {
    const rel = String(match[1] || '').trim()
    if (rel && !rel.includes('..') && !rel.startsWith('/')) mediaPaths.push(rel)
  }
  return [...new Set(mediaPaths)]
}

function inferMediaKind(relativePath = '') {
  const ext = path.extname(String(relativePath || '').toLowerCase())
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image'
  if (['.mp4', '.mov', '.webm', '.m4v', '.avi'].includes(ext)) return 'video'
  if (['.mp3', '.m4a', '.wav', '.ogg', '.amr', '.silk'].includes(ext)) return 'audio'
  return 'file'
}

function contentTypeForMedia(filePath = '') {
  switch (path.extname(String(filePath || '').toLowerCase())) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.bmp': return 'image/bmp'
    case '.svg': return 'image/svg+xml'
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    case '.mp3': return 'audio/mpeg'
    case '.m4a': return 'audio/mp4'
    case '.wav': return 'audio/wav'
    case '.ogg': return 'audio/ogg'
    default: return 'application/octet-stream'
  }
}

function mediaMetadataFromText(text = '') {
  return extractStoredMediaPaths(text).map(rel => ({
    relative_path: rel,
    file_name: path.basename(rel),
    kind: inferMediaKind(rel),
  }))
}

export function resolveWeChatGroupMediaFile(relativePath = '') {
  const rel = String(relativePath || '').trim().replace(/\\/g, '/')
  if (!rel || rel.includes('\0') || rel.startsWith('/') || rel.split('/').includes('..')) {
    return { ok: false, error: 'invalid media path' }
  }
  const root = path.resolve(paths.userDir)
  const filePath = path.resolve(root, rel)
  const diff = path.relative(root, filePath)
  if (!diff || diff.startsWith('..') || path.isAbsolute(diff)) return { ok: false, error: 'invalid media path' }
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return { ok: false, error: 'media file not found' }
    return {
      ok: true,
      filePath,
      relative_path: rel,
      file_name: path.basename(filePath),
      bytes: stat.size,
      content_type: contentTypeForMedia(filePath),
      kind: inferMediaKind(rel),
    }
  } catch {
    return { ok: false, error: 'media file not found' }
  }
}

function collectMediaExports(records = []) {
  const files = []
  const seen = new Set()
  for (const row of records) {
    for (const rel of extractStoredMediaPaths(`${row.raw_text || ''}\n${row.display_text || ''}`)) {
      if (seen.has(rel)) continue
      seen.add(rel)
      const resolved = resolveWeChatGroupMediaFile(rel)
      if (!resolved.ok) continue
      try {
        const stat = fs.statSync(resolved.filePath)
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) continue
        files.push({
          relative_path: rel,
          file_name: resolved.file_name,
          kind: resolved.kind,
          content_type: resolved.content_type,
          bytes: stat.size,
          base64: fs.readFileSync(resolved.filePath).toString('base64'),
        })
      } catch {}
    }
  }
  return files
}

function ensureSchema() {
  if (schemaReady) return
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_group_member_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      sender_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      room_alias TEXT NOT NULL DEFAULT '',
      contact_alias TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(group_id, sender_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wechat_group_member_names_group ON wechat_group_member_names(group_id, display_name);

    CREATE TABLE IF NOT EXISTS wechat_group_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      sender_id TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      message_type TEXT NOT NULL DEFAULT 'text',
      display_text TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL DEFAULT '',
      text_length INTEGER NOT NULL DEFAULT 0,
      image_count INTEGER NOT NULL DEFAULT 0,
      emoji_count INTEGER NOT NULL DEFAULT 0,
      link_count INTEGER NOT NULL DEFAULT 0,
      brag_score INTEGER NOT NULL DEFAULT 0,
      mentioned_self INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wechat_group_activity_group_ts ON wechat_group_activity(group_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_wechat_group_activity_sender_ts ON wechat_group_activity(group_id, sender_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_wechat_group_activity_type ON wechat_group_activity(group_id, message_type, timestamp);

    CREATE TABLE IF NOT EXISTS wechat_group_digest_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      digest_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      UNIQUE(group_id, digest_type, period_key)
    );
    CREATE INDEX IF NOT EXISTS idx_wechat_group_digest_sent_at ON wechat_group_digest_sent(sent_at);
  `)
  try { db.exec(`ALTER TABLE wechat_group_member_names ADD COLUMN wechat_id TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_member_names ADD COLUMN wxid TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_member_names ADD COLUMN stable_key TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_member_names ADD COLUMN raw_identity TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_wechat_group_member_names_stable ON wechat_group_member_names(group_id, stable_key)`) } catch {}
  schemaReady = true
}

function toLocalTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return nowTimestamp()
  const pad = n => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absOffset = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
}

export function normalizeStatsGroupId(groupId = '') {
  const raw = String(groupId || '').trim()
  return raw.startsWith('wechat:clawbot-group:') ? raw.slice('wechat:clawbot-group:'.length) : raw
}

function groupMatchesSelection({ groupId = '', groupName = '' } = {}, selected = []) {
  const gid = normalizeStatsGroupId(groupId)
  const raw = gid.replace(/^wechaty:/, '')
  const name = String(groupName || '').trim()
  return selected.some(item => {
    const value = String(item || '').trim()
    if (!value) return false
    const normalized = normalizeStatsGroupId(value)
    return value === gid
      || normalized === gid
      || value === raw
      || normalized === raw
      || (!!name && value === name)
  })
}

export function shouldTrackWeChatGroupStats({ groupId = '', groupName = '' } = {}) {
  const cfg = getWeChatGroupDigestConfig()
  if (cfg.enabled === false) return false
  const selected = Array.isArray(cfg.selectedGroups) ? cfg.selectedGroups : []
  // 重要：没有手动选择群组时，不默认统计、不默认定时发送，避免把所有群都纳入统计。
  if (!selected.length) return false
  if (groupMatchesSelection({ groupId, groupName }, selected)) return true
  const name = cleanStatsGroupName(groupName)
  if (!name) return false
  try {
    ensureSchema()
    const db = getDB()
    return selected.some(item => {
      const normalized = normalizeStatsGroupId(item)
      if (!normalized || normalized === name) return normalized === name
      const row = db.prepare(`SELECT group_name FROM wechat_group_activity WHERE group_id = ? AND group_name <> '' ORDER BY id DESC LIMIT 1`).get(normalized)
      return cleanStatsGroupName(row?.group_name) === name
    })
  } catch {
    return false
  }
}

export function normalizeWechatMessageType(messageType = '') {
  if (typeof messageType === 'number') return WECHATY_TYPE_NAMES[messageType] || `type_${messageType}`
  const raw = String(messageType || '').trim()
  if (!raw) return ''
  const numeric = Number(raw)
  if (Number.isInteger(numeric) && WECHATY_TYPE_NAMES[numeric]) return WECHATY_TYPE_NAMES[numeric]
  return raw.toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fa5-]+/g, '_')
}

function countUnicodeEmoji(text = '') {
  try {
    const matches = String(text || '').match(/[\p{Extended_Pictographic}]/gu)
    return matches ? matches.length : 0
  } catch {
    return 0
  }
}

function countBracketEmoji(text = '') {
  return (String(text || '').match(/\[[\u4e00-\u9fa5A-Za-z]{1,8}\]/g) || []).length
}

function countBragScore(text = '') {
  const value = String(text || '')
  if (!value.trim()) return 0
  let score = 0
  for (const re of BRAG_PATTERNS) {
    if (re.test(value)) score += 1
  }
  return Math.min(score, 3)
}

function stripXmlNoise(text = '') {
  const value = String(text || '').trim()
  if (!XML_LIKE_RE.test(value) || value.length < 80) return value
  if (EMOJI_XML_RE.test(value)) return '[表情]'
  if (IMAGE_XML_RE.test(value)) return '[图片]'
  if (MINI_PROGRAM_RE.test(value)) return '[小程序/链接]'
  return '[微信结构化消息]'
}

export function analyzeWeChatGroupMessage({ text = '', messageType = '' } = {}) {
  const rawText = String(text || '').trim()
  const type = normalizeWechatMessageType(messageType)
  const lowerType = type.toLowerCase()
  const isImageType = /(image|img|photo|picture|video|attachment|6|15)/iu.test(lowerType)
  const isEmojiType = /(emoji|emoticon|sticker|5)/iu.test(lowerType)
  const isLinkType = /(link|url|post|mini_program|appmsg|14|16)/iu.test(lowerType)
  const imageXml = IMAGE_XML_RE.test(rawText)
  const emojiXml = EMOJI_XML_RE.test(rawText)
  const miniProgram = MINI_PROGRAM_RE.test(rawText)
  const urls = [...rawText.matchAll(URL_RE)].map(match => match[0].replace(/[。。，，、；;]+$/u, ''))
  const imageCount = (isImageType || imageXml) ? 1 : 0
  const emojiCount = (isEmojiType || emojiXml ? 1 : 0) + countBracketEmoji(rawText) + countUnicodeEmoji(rawText)
  const linkCount = urls.length + ((isLinkType || miniProgram) && !urls.length ? 1 : 0)
  let displayText = stripXmlNoise(rawText)
  if (!displayText) {
    if (imageCount) displayText = '[图片]'
    else if (emojiCount) displayText = '[表情]'
    else if (linkCount) displayText = '[链接]'
  }
  displayText = displayText.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
  const textLength = displayText.replace(/^\[(?:图片|表情|链接|小程序\/链接|微信结构化消息)\]$/u, '').length
  const bragScore = countBragScore(displayText)
  const kinds = []
  if (textLength > 0) kinds.push('text')
  if (imageCount) kinds.push('image')
  if (emojiCount) kinds.push('emoji')
  if (linkCount) kinds.push('link')
  if (!kinds.length && displayText) kinds.push('text')
  const messageKind = kinds.length > 1 ? 'mixed' : (kinds[0] || 'unknown')
  return {
    ok: !!displayText || imageCount > 0 || emojiCount > 0 || linkCount > 0,
    messageType: messageKind,
    sourceType: type || '',
    displayText,
    rawText: rawText.slice(0, MAX_TEXT_LENGTH),
    textLength,
    imageCount,
    emojiCount,
    linkCount,
    bragScore,
    urls: [...new Set(urls)].slice(0, 12),
    important: IMPORTANT_RE.test(displayText),
  }
}

export function normalizeWeChatGroupDisplayText(text = '', messageType = '') {
  return analyzeWeChatGroupMessage({ text, messageType }).displayText
}

export function recordWeChatGroupActivity({ groupId, groupName = '', senderId = '', senderName = '', text = '', messageType = '', mentionedSelf = false, source = 'wechaty', timestamp = nowTimestamp(), force = false } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!force && !shouldTrackWeChatGroupStats({ groupId: gid, groupName })) return { ok: false, skipped: true, reason: 'group_not_selected_for_stats' }
  const analysis = analyzeWeChatGroupMessage({ text, messageType })
  if (!gid || !analysis.ok) return { ok: false, skipped: true, reason: 'empty_activity', analysis }
  ensureSchema()
  const db = getDB()
  const info = db.prepare(`
    INSERT INTO wechat_group_activity (
      group_id, group_name, sender_id, sender_name, message_type, display_text, raw_text,
      text_length, image_count, emoji_count, link_count, brag_score, mentioned_self, source, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    gid,
    String(groupName || '').trim(),
    String(senderId || '').trim(),
    pickWeChatDisplayName([senderName], senderId),
    analysis.messageType,
    analysis.displayText,
    analysis.rawText,
    analysis.textLength,
    analysis.imageCount,
    analysis.emojiCount,
    analysis.linkCount,
    analysis.bragScore,
    mentionedSelf ? 1 : 0,
    String(source || '').trim(),
    String(timestamp || nowTimestamp())
  )
  return { ok: true, id: info.lastInsertRowid, group_id: gid, ...analysis }
}

export function updateWeChatGroupActivitySenderName({ groupId, groupName = '', senderId = '', senderName = '' } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  const sid = String(senderId || '').trim()
  const displayName = pickWeChatDisplayName([senderName], '')
  const cleanGroupName = String(groupName || '').trim()
  if (!gid || !sid || !displayName || displayName === '未知成员' || isWeChatInternalIdLike(displayName)) {
    return { ok: false, skipped: true, reason: 'invalid_sender_display_name' }
  }
  ensureSchema()
  const db = getDB()
  db.prepare(`
    INSERT INTO wechat_group_member_names (
      group_id, group_name, sender_id, display_name, source, first_seen, last_seen
    ) VALUES (?, ?, ?, ?, 'wechaty', ?, ?)
    ON CONFLICT(group_id, sender_id) DO UPDATE SET
      group_name = CASE WHEN excluded.group_name <> '' THEN excluded.group_name ELSE wechat_group_member_names.group_name END,
      display_name = excluded.display_name,
      source = excluded.source,
      last_seen = excluded.last_seen
  `).run(gid, cleanGroupName, sid, displayName, nowTimestamp(), nowTimestamp())
  const info = db.prepare(`
    UPDATE wechat_group_activity
    SET sender_name = ?,
        group_name = CASE WHEN ? <> '' THEN ? ELSE group_name END
    WHERE (group_id = ? OR (? <> '' AND group_name = ?))
      AND sender_id = ?
      AND (
        sender_name IS NULL
        OR sender_name = ''
        OR sender_name = '未知成员'
        OR LOWER(sender_name) = 'unknown'
        OR sender_name = sender_id
        OR sender_name LIKE '@%'
        OR sender_name LIKE 'wxid_%'
        OR sender_name LIKE 'gh_%'
        OR LENGTH(sender_name) >= 16
      )
  `).run(displayName, cleanGroupName, cleanGroupName, gid, cleanGroupName, cleanGroupName, sid)
  return { ok: true, updated: info.changes || 0, group_id: gid, sender_id: sid, sender_name: displayName }
}


export function upsertWeChatGroupMemberName({ groupId, groupName = '', senderId = '', displayName = '', roomAlias = '', contactAlias = '', contactName = '', wechatId = '', wxid = '', stableKey = '', rawIdentity = '', source = 'wechaty' } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  const sid = String(senderId || '').trim()
  const cleanRoomAlias = isWeChatInternalIdLike(roomAlias) ? '' : String(roomAlias || '').trim()
  const cleanContactAlias = isWeChatInternalIdLike(contactAlias) ? '' : String(contactAlias || '').trim()
  const cleanContactName = isWeChatInternalIdLike(contactName) ? '' : String(contactName || '').trim()
  const cleanWechatId = String(wechatId || '').trim()
  const cleanWxid = String(wxid || '').trim()
  const cleanStableKey = String(stableKey || cleanWxid || cleanWechatId || '').trim()
  const cleanRawIdentity = String(rawIdentity || '').slice(0, 2000)
  const finalName = pickWeChatDisplayName([displayName, cleanRoomAlias, cleanContactAlias, cleanContactName], '')
  if (!gid || !sid || finalName === '未知成员') return { ok: false, skipped: true, reason: 'invalid_member_name' }
  ensureSchema()
  const db = getDB()
  db.prepare(`
    INSERT INTO wechat_group_member_names (
      group_id, group_name, sender_id, display_name, room_alias, contact_alias, contact_name, wechat_id, wxid, stable_key, raw_identity, source, first_seen, last_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, sender_id) DO UPDATE SET
      group_name = CASE WHEN excluded.group_name <> '' THEN excluded.group_name ELSE wechat_group_member_names.group_name END,
      display_name = excluded.display_name,
      room_alias = excluded.room_alias,
      contact_alias = excluded.contact_alias,
      contact_name = excluded.contact_name,
      wechat_id = CASE WHEN excluded.wechat_id <> '' THEN excluded.wechat_id ELSE wechat_group_member_names.wechat_id END,
      wxid = CASE WHEN excluded.wxid <> '' THEN excluded.wxid ELSE wechat_group_member_names.wxid END,
      stable_key = CASE WHEN excluded.stable_key <> '' THEN excluded.stable_key ELSE wechat_group_member_names.stable_key END,
      raw_identity = CASE WHEN excluded.raw_identity <> '' THEN excluded.raw_identity ELSE wechat_group_member_names.raw_identity END,
      source = excluded.source,
      last_seen = excluded.last_seen
  `).run(
    gid,
    String(groupName || '').trim(),
    sid,
    finalName,
    cleanRoomAlias,
    cleanContactAlias,
    cleanContactName,
    cleanWechatId,
    cleanWxid,
    cleanStableKey,
    cleanRawIdentity,
    String(source || 'wechaty').trim(),
    nowTimestamp(),
    nowTimestamp()
  )
  const updated = updateWeChatGroupActivitySenderName({ groupId: gid, groupName, senderId: sid, senderName: finalName })
  return { ok: true, group_id: gid, sender_id: sid, display_name: finalName, updated: updated?.updated || 0 }
}


export function listKnownWeChatGroups({ limit = 300 } = {}) {
  ensureSchema()
  const db = getDB()
  const max = Math.min(Math.max(Number(limit || 300), 1), 1000)
  const map = new Map()
  function canonicalGroupName(value = '') {
    return cleanStatsGroupName(value).replace(/\s+/gu, ' ').toLowerCase()
  }
  function add(row = {}, source = '') {
    const groupId = normalizeStatsGroupId(row.group_id || row.groupId || '')
    const groupName = cleanStatsGroupName(row.group_name || row.groupName || '')
    // Wechaty 在重新登录/恢复后可能给同一个群产生多个历史 room_id。
    // 设置页、统计页、记忆页面给用户看的必须是“一个群名一条记录”，不能按历史 id 展开。
    const key = groupName ? `name:${canonicalGroupName(groupName)}` : `id:${groupId}`
    if (!key || key === 'id:') return
    const prev = map.get(key) || { group_id: groupId, group_name: groupName, message_count: 0, member_count: 0, last_seen: '', sources: new Set(), historical_ids: new Set() }
    if (groupId) prev.historical_ids.add(groupId)
    const last = row.last_seen || row.last_ts || row.last_timestamp || ''
    const isNewer = last && String(last).localeCompare(String(prev.last_seen || '')) > 0
    // 保留最近一次出现的 room_id，旧 id 只作为 historical_ids 供排查，不再污染 UI。
    if (groupId && (!prev.group_id || isNewer)) prev.group_id = groupId
    if (groupName && (!prev.group_name || prev.group_name === prev.group_id || isNewer)) prev.group_name = groupName
    prev.message_count += Number(row.message_count || 0)
    prev.member_count = Math.max(Number(prev.member_count || 0), Number(row.member_count || 0))
    if (last && String(last).localeCompare(String(prev.last_seen || '')) > 0) prev.last_seen = last
    if (source) prev.sources.add(source)
    map.set(key, prev)
  }
  try {
    for (const row of db.prepare(`
      SELECT group_id, group_name, COUNT(*) AS message_count, MAX(timestamp) AS last_seen
      FROM wechat_group_activity
      GROUP BY group_id, group_name
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(max)) add(row, 'activity')
  } catch {}
  try {
    for (const row of db.prepare(`
      SELECT group_id, group_name, COUNT(DISTINCT sender_id) AS member_count, MAX(last_seen) AS last_seen
      FROM wechat_group_member_names
      GROUP BY group_id, group_name
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(max)) add(row, 'members')
  } catch {}
  const groups = [...map.values()]
    .map(item => ({
      ...item,
      id: item.group_id,
      topic: item.group_name || item.group_id,
      sources: [...item.sources],
      historical_ids: [...(item.historical_ids || [])],
      duplicate_count: Math.max(0, (item.historical_ids?.size || 1) - 1),
      last_seen_display: formatWeChatLocalDateTime(item.last_seen),
    }))
    .sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')) || String(a.topic || '').localeCompare(String(b.topic || ''), 'zh-Hans-CN'))
    .slice(0, max)
  return { ok: true, total: groups.length, groups }
}

export function listWeChatGroupMembers({ groupId = '', groupName = '', q = '', limit = 300 } = {}) {
  ensureSchema()
  const db = getDB()
  const gid = normalizeStatsGroupId(groupId)
  const cleanGroupName = cleanStatsGroupName(groupName)
  const filters = []
  const params = []
  if (gid) {
    const groupFilter = groupWhereClause(gid, cleanGroupName)
    filters.push(groupFilter.sql)
    params.push(...groupFilter.params)
  } else if (cleanGroupName) {
    filters.push('group_name = ?')
    params.push(cleanGroupName)
  }
  const keyword = String(q || '').trim()
  if (keyword) {
    filters.push('(display_name LIKE ? OR room_alias LIKE ? OR contact_alias LIKE ? OR contact_name LIKE ? OR wechat_id LIKE ? OR wxid LIKE ? OR stable_key LIKE ? OR sender_id LIKE ? OR group_name LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like, like, like, like, like, like)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT group_id, group_name, sender_id, display_name, room_alias, contact_alias, contact_name, wechat_id, wxid, stable_key, raw_identity, source, first_seen, last_seen
    FROM wechat_group_member_names
    ${where}
    ORDER BY last_seen DESC, group_name COLLATE NOCASE ASC, display_name COLLATE NOCASE ASC
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit || 300), 1), 20000))
  return {
    ok: true,
    total: rows.length,
    members: rows.map(row => ({
      ...row,
      display_name: pickWeChatDisplayName([row.display_name, row.room_alias, row.contact_alias, row.contact_name], row.sender_id),
      last_seen_display: formatWeChatLocalDateTime(row.last_seen),
    })),
  }
}

function rangeDates({ from = '', to = '', hours = 24, range = '' } = {}) {
  const now = new Date()
  let start = from ? new Date(from) : null
  let end = to ? new Date(to) : now
  if (range === 'today') {
    start = new Date(now)
    start.setHours(0, 0, 0, 0)
    end = now
  } else if (!start || Number.isNaN(start.getTime())) {
    start = new Date(now.getTime() - Math.min(Math.max(Number(hours || 24), 1), 24 * 90) * 3600 * 1000)
  }
  if (!end || Number.isNaN(end.getTime())) end = now
  return { from: toLocalTimestamp(start), to: toLocalTimestamp(end) }
}

function rowsByMetric(db, gid, from, to, metric, limit, groupName = '') {
  const safeMetric = {
    message_count: 'COUNT(*)',
    image_count: 'SUM(image_count)',
    emoji_count: 'SUM(emoji_count)',
    link_count: 'SUM(link_count)',
    brag_score: 'SUM(brag_score)',
    brag_count: 'SUM(CASE WHEN brag_score > 0 THEN 1 ELSE 0 END)',
  }[metric]
  if (!safeMetric) return []
  const identityContext = getMemberIdentityContext(db, gid, groupName)
  const groupFilter = groupWhereClause(gid, groupName)
  const safeLimit = Math.min(Math.max(Number(limit || 10), 1), 30)
  const scanLimit = Math.min(Math.max(safeLimit * 100, 500), 5000)
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(sender_id, ''), NULLIF(sender_name, ''), 'unknown') AS sender_key,
           sender_id,
           GROUP_CONCAT(DISTINCT NULLIF(sender_name, '')) AS sender_names,
           COALESCE(${safeMetric}, 0) AS value,
           COUNT(*) AS message_count,
           MAX(timestamp) AS last_seen
    FROM wechat_group_activity
    WHERE ${groupFilter.sql} AND timestamp >= ? AND timestamp <= ?
    GROUP BY sender_key
    HAVING value > 0
    ORDER BY value DESC, message_count DESC
    LIMIT ?
  `).all(...groupFilter.params, from, to, scanLimit)
  const merged = new Map()
  for (const row of rows) {
    const identity = resolveStatsSenderIdentity(row, identityContext)
    const key = identity.identityKey
    const prev = merged.get(key) || {
      identity_key: key,
      sender_ids: new Set(),
      sender_names: new Set(),
      name: identity.displayName || '未知成员',
      value: 0,
      message_count: 0,
      last_seen: '',
    }
    if (row.sender_id) prev.sender_ids.add(String(row.sender_id))
    for (const name of splitNameCandidates(row.sender_names)) prev.sender_names.add(name)
    prev.value += Number(row.value || 0)
    prev.message_count += Number(row.message_count || 0)
    if (row.last_seen && String(row.last_seen).localeCompare(String(prev.last_seen || '')) > 0) {
      prev.last_seen = row.last_seen
      prev.name = identity.displayName || prev.name
    }
    merged.set(key, prev)
  }
  return [...merged.values()]
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0)
      || Number(b.message_count || 0) - Number(a.message_count || 0)
      || String(b.last_seen || '').localeCompare(String(a.last_seen || '')))
    .slice(0, safeLimit)
    .map(row => ({
      ...row,
      sender_ids: [...row.sender_ids],
      sender_names: [...row.sender_names],
      value: Number(row.value || 0),
      message_count: Number(row.message_count || 0),
    }))
}

function participantCountByIdentity(db, gid, from, to, groupName = '') {
  const identityContext = getMemberIdentityContext(db, gid, groupName)
  const groupFilter = groupWhereClause(gid, groupName)
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(sender_id, ''), NULLIF(sender_name, ''), 'unknown') AS sender_key,
           sender_id,
           GROUP_CONCAT(DISTINCT NULLIF(sender_name, '')) AS sender_names,
           MAX(timestamp) AS last_seen
    FROM wechat_group_activity
    WHERE ${groupFilter.sql} AND timestamp >= ? AND timestamp <= ?
    GROUP BY sender_key
  `).all(...groupFilter.params, from, to)
  const keys = new Set()
  for (const row of rows) keys.add(resolveStatsSenderIdentity(row, identityContext).identityKey)
  return keys.size
}

export function getWeChatGroupStats({ groupId, groupName = '', from = '', to = '', hours = 24, range = '', limit = 10 } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!gid) return { ok: false, error: 'group_id required' }
  ensureSchema()
  const db = getDB()
  const resolvedGroupName = resolveQueryGroupName(db, gid, groupName)
  const nameMap = getMemberDisplayNameMap(db, gid, resolvedGroupName)
  const groupFilter = groupWhereClause(gid, resolvedGroupName)
  const dates = rangeDates({ from, to, hours, range })
  const totals = db.prepare(`
    SELECT COUNT(*) AS message_count,
           COALESCE(SUM(text_length), 0) AS text_length,
           COALESCE(SUM(image_count), 0) AS image_count,
           COALESCE(SUM(emoji_count), 0) AS emoji_count,
           COALESCE(SUM(link_count), 0) AS link_count,
           COALESCE(SUM(brag_score), 0) AS brag_score,
           COALESCE(SUM(CASE WHEN brag_score > 0 THEN 1 ELSE 0 END), 0) AS brag_count,
           MAX(group_name) AS group_name
    FROM wechat_group_activity
    WHERE ${groupFilter.sql} AND timestamp >= ? AND timestamp <= ?
  `).get(...groupFilter.params, dates.from, dates.to) || {}
  const participantCount = participantCountByIdentity(db, gid, dates.from, dates.to, resolvedGroupName)
  const recent = db.prepare(`
    SELECT id, group_id, group_name, sender_id, sender_name, message_type, display_text, image_count, emoji_count, link_count, brag_score, timestamp
    FROM wechat_group_activity
    WHERE ${groupFilter.sql} AND timestamp >= ? AND timestamp <= ?
    ORDER BY id DESC
    LIMIT ?
  `).all(...groupFilter.params, dates.from, dates.to, 80).reverse()
    .map(row => rowWithDisplayName(row, nameMap))
  const important = recent.filter(row => IMPORTANT_RE.test(row.display_text || '')).slice(-12)
  const links = db.prepare(`
    SELECT display_text, sender_id, sender_name, timestamp
    FROM wechat_group_activity
    WHERE ${groupFilter.sql} AND timestamp >= ? AND timestamp <= ? AND link_count > 0
    ORDER BY id DESC
    LIMIT 20
  `).all(...groupFilter.params, dates.from, dates.to).reverse()
    .map(row => rowWithDisplayName(row, nameMap))
  return {
    ok: true,
    group_id: gid,
    group_name: totals.group_name || resolvedGroupName || '',
    from: dates.from,
    to: dates.to,
    totals: {
      message_count: Number(totals.message_count || 0),
      text_length: Number(totals.text_length || 0),
      image_count: Number(totals.image_count || 0),
      emoji_count: Number(totals.emoji_count || 0),
      link_count: Number(totals.link_count || 0),
      brag_score: Number(totals.brag_score || 0),
      brag_count: Number(totals.brag_count || 0),
      participant_count: participantCount,
    },
    leaderboards: {
      messages: rowsByMetric(db, gid, dates.from, dates.to, 'message_count', limit, resolvedGroupName),
      images: rowsByMetric(db, gid, dates.from, dates.to, 'image_count', limit, resolvedGroupName),
      emojis: rowsByMetric(db, gid, dates.from, dates.to, 'emoji_count', limit, resolvedGroupName),
      links: rowsByMetric(db, gid, dates.from, dates.to, 'link_count', limit, resolvedGroupName),
      brag: rowsByMetric(db, gid, dates.from, dates.to, 'brag_count', limit, resolvedGroupName),
    },
    important,
    links,
    recent,
    db_path: paths.dbFile,
  }
}

export function getWeChatGroupArchiveEvidence({ groupId, groupName = '', query = '', limit = 36, recentLimit = 12, days = 30 } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!gid) return { ok: false, error: 'group_id required', text: '' }
  ensureSchema()
  const db = getDB()
  const resolvedGroupName = resolveQueryGroupName(db, gid, groupName)
  const groupFilter = groupWhereClause(gid, resolvedGroupName)
  const nameMap = getMemberDisplayNameMap(db, gid, resolvedGroupName)
  const safeLimit = Math.min(Math.max(Number(limit || 36), 6), 80)
  const safeRecentLimit = Math.min(Math.max(Number(recentLimit || 12), 0), 40)
  const from = toLocalTimestamp(new Date(Date.now() - Math.min(Math.max(Number(days || 30), 1), 365) * 24 * 3600 * 1000))
  const terms = extractArchiveSearchTerms(query)
  const seen = new Set()
  const matched = []
  if (terms.length) {
    const termWhere = terms.map(() => '(display_text LIKE ? OR raw_text LIKE ? OR sender_name LIKE ? OR sender_id LIKE ?)').join(' OR ')
    const params = [...groupFilter.params, from]
    for (const term of terms) {
      const like = `%${term}%`
      params.push(like, like, like, like)
    }
    const rows = db.prepare(`
      SELECT id, group_id, group_name, sender_id, sender_name, message_type, display_text, raw_text,
             image_count, emoji_count, link_count, mentioned_self, source, timestamp, created_at
      FROM wechat_group_activity
      WHERE ${groupFilter.sql} AND timestamp >= ? AND (${termWhere})
      ORDER BY id DESC
      LIMIT ?
    `).all(...params, Math.max(safeLimit * 6, 120))
    const ranked = rows
      .map(row => ({ row, score: scoreArchiveEvidenceRow(row, terms, query) }))
      .sort((a, b) => b.score - a.score || Number(b.row.id || 0) - Number(a.row.id || 0))
      .slice(0, safeLimit)
      .map(item => item.row)
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
    for (const row of ranked) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      matched.push(rowWithDisplayName(row, nameMap))
    }
  }
  const recent = safeRecentLimit > 0 ? db.prepare(`
    SELECT id, group_id, group_name, sender_id, sender_name, message_type, display_text, raw_text,
           image_count, emoji_count, link_count, mentioned_self, source, timestamp, created_at
    FROM wechat_group_activity
    WHERE ${groupFilter.sql}
    ORDER BY id DESC
    LIMIT ?
  `).all(...groupFilter.params, safeRecentLimit).reverse()
    .filter(row => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
    .map(row => rowWithDisplayName(row, nameMap)) : []
  const rows = [...matched, ...recent].slice(-safeLimit)
  const lines = rows.map(row => {
    const media = [
      row.image_count ? `图${row.image_count}` : '',
      row.emoji_count ? `表${row.emoji_count}` : '',
      row.link_count ? `链${row.link_count}` : '',
    ].filter(Boolean).join('/')
    return `${row.timestamp_display || formatWeChatLocalDateTime(row.timestamp)} ${row.sender_display_name || row.sender_name || row.sender_id || '未知成员'}: ${row.display_text || row.raw_text || ''}${media ? `（${media}）` : ''}`
  })
  return {
    ok: true,
    group_id: gid,
    group_name: resolvedGroupName,
    terms,
    count: rows.length,
    matched_count: matched.length,
    recent_count: recent.length,
    records: rows,
    text: lines.join('\n'),
  }
}


export function listWeChatGroupActivityRecords({ groupId, groupName = '', from = '', to = '', hours = 24, range = '', limit = 80, offset = 0, q = '', type = '' } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!gid) return { ok: false, error: 'group_id required' }
  ensureSchema()
  const db = getDB()
  const resolvedGroupName = resolveQueryGroupName(db, gid, groupName)
  const dates = from || to
    ? { from: normalizeSearchDateInput(from, 'start') || toLocalTimestamp(new Date(Date.now() - 24 * 90 * 3600 * 1000)), to: normalizeSearchDateInput(to, 'end') || toLocalTimestamp(new Date()) }
    : rangeDates({ hours, range })
  const safeLimit = Math.min(Math.max(Number(limit || 80), 1), 500)
  const safeOffset = Math.max(Number(offset || 0), 0)
  const query = String(q || '').trim()
  const messageType = String(type || '').trim()
  const groupFilter = groupWhereClause(gid, resolvedGroupName)
  const filters = [groupFilter.sql, 'timestamp >= ?', 'timestamp <= ?']
  const params = [...groupFilter.params, dates.from, dates.to]
  if (query) {
    filters.push('(display_text LIKE ? OR raw_text LIKE ? OR sender_name LIKE ? OR sender_id LIKE ?)')
    const like = `%${query}%`
    params.push(like, like, like, like)
  }
  if (messageType) {
    if (messageType === 'image') filters.push('image_count > 0')
    else if (messageType === 'emoji') filters.push('emoji_count > 0')
    else if (messageType === 'link') filters.push('link_count > 0')
    else {
      filters.push('message_type = ?')
      params.push(messageType)
    }
  }
  const where = filters.join(' AND ')
  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(image_count), 0) AS image_count,
           COALESCE(SUM(emoji_count), 0) AS emoji_count,
           COALESCE(SUM(link_count), 0) AS link_count,
           COALESCE(SUM(brag_score), 0) AS brag_score,
           COUNT(DISTINCT COALESCE(NULLIF(sender_id, ''), sender_name)) AS raw_participant_count,
           MAX(group_name) AS group_name
    FROM wechat_group_activity
    WHERE ${where}
  `).get(...params) || {}
  const participantCount = query || messageType
    ? Number(totals.raw_participant_count || 0)
    : participantCountByIdentity(db, gid, dates.from, dates.to, resolvedGroupName)
  const latestRecord = db.prepare(`
    SELECT id, group_id, group_name, sender_id, sender_name, message_type, display_text, timestamp, created_at
    FROM wechat_group_activity
    WHERE ${groupFilter.sql}
    ORDER BY id DESC
    LIMIT 1
  `).get(...groupFilter.params) || null
  const rows = db.prepare(`
    SELECT id, group_id, group_name, sender_id, sender_name, message_type, display_text, raw_text,
           text_length, image_count, emoji_count, link_count, brag_score, mentioned_self, source, timestamp, created_at
    FROM wechat_group_activity
    WHERE ${where}
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset)
  const nameMap = getMemberDisplayNameMap(db, gid, resolvedGroupName)
  return {
    ok: true,
    group_id: gid,
    group_name: totals.group_name || resolvedGroupName || '',
    from: dates.from,
    to: dates.to,
    from_display: formatWeChatLocalDateTime(dates.from),
    to_display: formatWeChatLocalDateTime(dates.to),
    total: Number(totals.total || 0),
    limit: safeLimit,
    offset: safeOffset,
    has_more: safeOffset + rows.length < Number(totals.total || 0),
    totals: {
      message_count: Number(totals.total || 0),
      participant_count: participantCount,
      image_count: Number(totals.image_count || 0),
      emoji_count: Number(totals.emoji_count || 0),
      link_count: Number(totals.link_count || 0),
      brag_score: Number(totals.brag_score || 0),
    },
    records: rows.map(row => rowWithDisplayName(row, nameMap)),
    latest_record: latestRecord ? rowWithDisplayName(latestRecord, nameMap) : null,
    db_path: paths.dbFile,
  }
}

export function buildWeChatGroupActivityExport({ groupId, groupName = '', from = '', to = '', hours = 24, range = '', q = '', type = '', format = 'json' } = {}) {
  const first = listWeChatGroupActivityRecords({ groupId, groupName, from, to, hours, range, q, type, limit: 500, offset: 0 })
  if (!first.ok) return first
  let all = [...first.records]
  let offset = all.length
  while (first.total > offset && all.length < 20000) {
    const page = listWeChatGroupActivityRecords({ groupId, groupName, from, to, hours, range, q, type, limit: 500, offset })
    if (!page.ok || !page.records?.length) break
    all = all.concat(page.records)
    offset += page.records.length
  }
  if (String(format).toLowerCase() === 'csv') {
    const headers = ['id', '时间', '群', '成员昵称', '成员ID', '类型', '内容', '原始内容', '图片数', '表情数', '链接数', '装逼分', '是否@助手', '来源']
    const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = [
      headers.map(esc).join(','),
      ...all.map(row => [
        row.id,
        row.timestamp_display,
        row.group_name,
        row.sender_display_name || row.sender_name,
        row.sender_id,
        row.message_type,
        row.display_text,
        row.raw_text,
        row.image_count,
        row.emoji_count,
        row.link_count,
        row.brag_score,
        row.mentioned_self ? 1 : 0,
        row.source,
      ].map(esc).join(',')),
    ]
    return { ok: true, format: 'csv', filename: `wechat-group-${Date.now()}.csv`, contentType: 'text/csv; charset=utf-8', body: `\uFEFF${lines.join('\n')}` }
  }
  const mediaFiles = collectMediaExports(all)
  return {
    ok: true,
    format: 'json',
    filename: `wechat-group-${Date.now()}.json`,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ ...first, count: all.length, records: all, media_files: mediaFiles, media_note: 'media_files 内为本机已保存媒体的 base64；CSV 只导出媒体相对路径。' }, null, 2),
  }
}

export function importWeChatGroupActivityRecords({ groupId, groupName = '', records = [], mediaFiles = [], media_files = [] } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!gid) return { ok: false, error: 'group_id required' }
  if (!Array.isArray(records)) return { ok: false, error: 'records must be array' }
  ensureSchema()
  const importMediaFiles = Array.isArray(mediaFiles) && mediaFiles.length ? mediaFiles : (Array.isArray(media_files) ? media_files : [])
  let mediaImported = 0
  let mediaSkipped = 0
  for (const file of importMediaFiles) {
    const rel = String(file.relative_path || file.relativePath || '').trim()
    const base64 = String(file.base64 || '')
    if (!rel || !base64 || rel.includes('..') || rel.startsWith('/')) {
      mediaSkipped += 1
      continue
    }
    try {
      const target = path.join(paths.userDir, rel)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, Buffer.from(base64, 'base64'))
      mediaImported += 1
    } catch {
      mediaSkipped += 1
    }
  }
  let inserted = 0
  let skipped = 0
  const db = getDB()
  for (const row of records) {
    const text = row.raw_text || row.rawText || row.display_text || row.content || row.text || ''
    const senderId = row.sender_id || row.senderId || row.member_id || row.memberId || ''
    const timestamp = row.timestamp || nowTimestamp()
    const exists = db.prepare(`
      SELECT 1 FROM wechat_group_activity
      WHERE group_id = ? AND sender_id = ? AND timestamp = ? AND raw_text = ?
      LIMIT 1
    `).get(gid, String(senderId || '').trim(), String(timestamp), String(text).trim().slice(0, MAX_TEXT_LENGTH))
    if (exists) {
      skipped += 1
      continue
    }
    const result = recordWeChatGroupActivity({
      groupId: gid,
      groupName: row.group_name || row.groupName || groupName,
      senderId,
      senderName: row.sender_name || row.senderName || row.member_name || row.memberName || '',
      text,
      messageType: row.message_type || row.messageType || '',
      mentionedSelf: !!(row.mentioned_self || row.mentionedSelf),
      source: row.source || 'import',
      timestamp,
      force: true,
    })
    if (result.ok) inserted += 1
    else skipped += 1
  }
  return { ok: true, inserted, skipped, total: records.length, media_imported: mediaImported, media_skipped: mediaSkipped }
}

export function listActiveWeChatGroupStatsGroups({ hours = 24 * 30, limit = 100 } = {}) {
  ensureSchema()
  const db = getDB()
  const cutoff = toLocalTimestamp(new Date(Date.now() - Math.min(Math.max(Number(hours || 720), 1), 24 * 365) * 3600 * 1000))
  return db.prepare(`
    SELECT group_id,
           COALESCE(NULLIF(MAX(group_name), ''), group_id) AS group_name,
           COUNT(*) AS message_count,
           MAX(timestamp) AS last_ts
    FROM wechat_group_activity
    WHERE timestamp >= ?
    GROUP BY group_id
    ORDER BY MAX(id) DESC
    LIMIT ?
  `).all(cutoff, Math.min(Math.max(Number(limit || 100), 1), 300))
}

export function hasDigestBeenSent({ groupId, digestType, periodKey } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!gid || !digestType || !periodKey) return false
  ensureSchema()
  const row = getDB().prepare(`SELECT 1 FROM wechat_group_digest_sent WHERE group_id = ? AND digest_type = ? AND period_key = ?`).get(gid, digestType, String(periodKey))
  return !!row
}

export function markDigestSent({ groupId, digestType, periodKey, sentAt = nowTimestamp() } = {}) {
  const gid = normalizeStatsGroupId(groupId)
  if (!gid || !digestType || !periodKey) return { ok: false, error: 'missing digest sent key' }
  ensureSchema()
  getDB().prepare(`INSERT OR IGNORE INTO wechat_group_digest_sent (group_id, digest_type, period_key, sent_at) VALUES (?, ?, ?, ?)`).run(gid, String(digestType), String(periodKey), String(sentAt))
  return { ok: true }
}


function randomDigestPick(items = []) {
  return items.length ? items[Math.floor(Math.random() * items.length)] : ''
}

function extractDigestHotWords(stats = {}) {
  const stop = new Set('这个 那个 什么 怎么 为啥 为什么 不是 没有 一下 可以 已经 现在 今天 明天 群聊 消息 图片 表情 链接 还是 继续 时候 一个 起来'.split(' '))
  const text = (stats.important || []).map(row => row.display_text || row.raw_text || '').join(' ')
  const words = []
  for (const token of text.match(/[一-龥A-Za-z0-9_]{2,12}/gu) || []) {
    const value = token.trim()
    if (value && !stop.has(value) && !/^\d+$/u.test(value)) words.push(value)
  }
  const defaults = ['轻微冒泡', '表情接力', '情报搬运', '素材开闸', '键盘冒烟', '群友上线', '水群小浪花', '链接投喂', '今日留痕']
  return [...new Set([...words, ...defaults.sort(() => Math.random() - 0.5)])].slice(0, 5)
}

function buildDigestMoodLine(stats = {}) {
  const totals = stats.totals || {}
  const total = Number(totals.message_count || 0)
  const participants = Number(totals.participant_count || 0)
  const words = extractDigestHotWords(stats)
  const quiet = total < 20 || participants <= 2
  const pool = quiet
    ? [
        `本时段是轻量冒泡局，关键词先记：${words.join('、')}。`,
        `群里没有炸锅，但有几朵小水花：${words.join('、')}。`,
        `消息量不大，不硬凑榜；本轮看点是：${words.join('、')}。`,
        `今天这段属于低频留痕，${words.slice(0, 3).join('、')} 先上小本本。`,
      ]
    : [
        `本轮群聊热度在线，关键词：${words.join('、')}。`,
        `发言、表情和情报都有动静，今日梗点：${words.join('、')}。`,
        `榜单开始有江湖味了，${words.slice(0, 3).join('、')} 是本轮主线。`,
        `群聊水花已起来，${words.join('、')} 轮流上桌。`,
      ]
  return randomDigestPick(pool)
}

function formatRank(rows = [], suffix = '次') {
  if (!rows.length) return '暂无'
  return rows.slice(0, 5).map((row, index) => `${index + 1}. ${row.name || '未知成员'} ${Number(row.value || 0)}${suffix}`).join('\n')
}

function formatTime(iso = '') {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16)
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function buildWeChatGroupStatsDigest(stats = {}, { mode = 'interval', include = {} } = {}) {
  if (!stats?.ok) return '群统计生成失败：没有可用数据。'
  const totals = stats.totals || {}
  const name = stats.group_name || stats.group_id || '本群'
  const title = mode === 'daily' ? `📊 ${name} 今日群聊日报` : `🧾 ${name} 群聊阶段总结`
  const includeRank = key => include[key] !== false
  const highlights = (stats.important || []).slice(-8).map(row => `- ${formatTime(row.timestamp).slice(6)} ${row.sender_name || row.sender_id || '群成员'}：${String(row.display_text || '').slice(0, 90)}`)
  const moodLine = buildDigestMoodLine(stats)
  const lines = [
    title,
    `时间：${formatTime(stats.from)} ~ ${formatTime(stats.to)}`,
    `总量：${totals.message_count || 0} 条消息 / ${totals.participant_count || 0} 人参与 / 图片 ${totals.image_count || 0} / 表情 ${totals.emoji_count || 0} / 链接 ${totals.link_count || 0}`,
    `梗点：${moodLine}`,
  ]
  if (includeRank('messageLeaderboard')) lines.push(`\n💬 发言榜\n${formatRank(stats.leaderboards?.messages, '条')}`)
  if (includeRank('imageLeaderboard')) lines.push(`\n🖼 发图榜\n${formatRank(stats.leaderboards?.images, '张')}`)
  if (includeRank('emojiLeaderboard')) lines.push(`\n😄 表情榜\n${formatRank(stats.leaderboards?.emojis, '个')}`)
  if (includeRank('linkLeaderboard')) lines.push(`\n🔗 链接榜\n${formatRank(stats.leaderboards?.links, '条')}`)
  if (includeRank('bragLeaderboard')) lines.push(`\n😎 装逼榜（启发式统计）\n${formatRank(stats.leaderboards?.brag, '次')}`)
  lines.push(highlights.length ? `\n📌 重点/待办线索\n${highlights.join('\n')}` : '\n📌 重点/待办线索\n暂未发现明显决定、待办或风险关键词。')
  return lines.join('\n').slice(0, 1800)
}
