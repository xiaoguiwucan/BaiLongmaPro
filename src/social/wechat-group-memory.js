import { Honcho } from '@honcho-ai/sdk'
import { nowTimestamp } from '../time.js'
import { getHonchoConfig } from '../config.js'
import { extractWeChatGroupId } from './wechat-groups.js'
import { extractWeChatExplicitMemories } from './wechat-memory-extractor.js'
import { getDB, updateMemoryEmbedding } from '../db.js'

let client = null
let cachedKey = ''
let cachedBaseURL = ''
let cachedEnv = ''
let appIdCache = ''
const userCache = new Map()
const sessionCache = new Map()

let honchoDisabledUntil = 0
let honchoLastError = ''

function isHonchoTemporarilyDisabled() {
  return honchoDisabledUntil && Date.now() < honchoDisabledUntil
}

function markHonchoUnavailable(err, source = 'honcho') {
  const message = err?.message || String(err || 'unknown error')
  honchoLastError = message
  honchoDisabledUntil = Date.now() + 60_000
  client = null
  userCache.clear()
  sessionCache.clear()
  console.warn(`[Honcho] ${source} 暂不可用，60 秒内降级跳过：${message}`)
}

function honchoUnavailableResult(extra = {}) {
  return { ok: false, provider: 'honcho', skipped: true, degraded: true, error: honchoLastError || 'Honcho 暂不可用', ...extra }
}

const ASSISTANT_PEER_ID = 'bailongma_assistant'

const GROUP_SESSION_CONFIGURATION = {
  reasoning: { enabled: true },
  peerCard: { use: true, create: true },
  summary: { enabled: true, messagesPerShortSummary: 10, messagesPerLongSummary: 30 },
  dream: { enabled: true },
}

function normalizeText(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function isInternalToolProtocolText(text = '') {
  return /I did not actually call the required tool|cannot claim the operation completed|execute the tool first|required tool/i.test(String(text || ''))
}

function normalizeMemoryDisplayText(text = '') {
  const value = normalizeText(text)
  if (!value) return ''
  if (isInternalToolProtocolText(value)) return '[历史内部协议误回复，已在 v0.4.1 隐藏；未来不会再发到群里]'
  if (/<msg[\s\S]{0,800}<emoji|<emoji\b|cdnurl=|emoji[^>]{0,120}(?:md5|len|aeskey)/iu.test(value)) return '[表情]'
  if (/<img\b|<image\b|cdnthumburl=|cdnmidimgurl=/iu.test(value)) return '[图片]'
  if (/^<appmsg\b|<weappinfo\b|小程序/u.test(value)) return '[小程序/链接]'
  if ((/^<\?xml|^<msg\b|^<sysmsg\b/iu.test(value)) && value.length > 80) return '[微信结构化消息]'
  return value.slice(0, 2400)
}

function safeIdPart(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'unknown'
}

function groupKey(groupId = '') {
  const raw = extractWeChatGroupId(groupId)
  return normalizeText(raw) || normalizeText(groupId)
}

function groupPeerIdFor(gid = '') {
  return `wechat_group_${safeIdPart(gid)}`
}

function memberPeerIdFor(senderId = '', senderName = '') {
  return `wechat_member_${safeIdPart(senderId || senderName)}`
}

function sessionIdFor(gid = '') {
  return `wechat_group_${safeIdPart(gid)}`
}


let localSchemaReady = false

function ensureLocalMemorySchema() {
  if (localSchemaReady) return
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      group_external_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      mentioned_self INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'wechaty',
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_wgm_group_ts ON wechat_group_messages(group_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_wgm_member_ts ON wechat_group_messages(group_id, member_id, timestamp);

    CREATE TABLE IF NOT EXISTS wechat_group_memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      group_external_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      salience INTEGER NOT NULL DEFAULT 3,
      source_message_id INTEGER,
      source_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wgmi_group_member ON wechat_group_memory_items(group_id, member_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_wgmi_group_category ON wechat_group_memory_items(group_id, category, status, updated_at);

    CREATE TABLE IF NOT EXISTS wechat_member_identities (
      canonical_member_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      stable_key TEXT NOT NULL DEFAULT '',
      wxid TEXT NOT NULL DEFAULT '',
      wechat_id TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      confidence INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wmi_group_name ON wechat_member_identities(group_id, display_name);
    CREATE INDEX IF NOT EXISTS idx_wmi_group_stable ON wechat_member_identities(group_id, stable_key);

    CREATE TABLE IF NOT EXISTS wechat_member_identity_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_member_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      room_alias TEXT NOT NULL DEFAULT '',
      contact_alias TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      stable_key TEXT NOT NULL DEFAULT '',
      wxid TEXT NOT NULL DEFAULT '',
      wechat_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(group_id, sender_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wmia_canonical ON wechat_member_identity_aliases(canonical_member_id);
  `)
  try { db.exec(`ALTER TABLE wechat_group_messages ADD COLUMN embedding BLOB`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_messages ADD COLUMN honcho_synced_at TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_messages ADD COLUMN honcho_message_id TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_messages ADD COLUMN canonical_member_id TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_memory_items ADD COLUMN embedding BLOB`) } catch {}
  try { db.exec(`ALTER TABLE wechat_group_memory_items ADD COLUMN canonical_member_id TEXT NOT NULL DEFAULT ''`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_wgm_group_text ON wechat_group_messages(group_id, content)`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_wgm_canonical_ts ON wechat_group_messages(group_id, canonical_member_id, timestamp)`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_wgmi_canonical ON wechat_group_memory_items(group_id, canonical_member_id, status, updated_at)`) } catch {}
  localSchemaReady = true
}

function localExternalGroupId(gid = '') { return `wechat:group:${safeIdPart(gid)}` }

function normalizeIdentityName(value = '') {
  let text = String(value || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  try { text = text.normalize('NFKC') } catch {}
  return text.toLowerCase()
}

function isInternalWechatIdLike(value = '') {
  const text = String(value || '').trim()
  return !text
    || /^wechaty:/iu.test(text)
    || /^@@?[a-f0-9]{16,}$/iu.test(text)
    || /^@(?:[a-f0-9_-]{16,}|[0-9a-z_-]{24,})$/iu.test(text)
    || /^wxid_[a-z0-9_-]{8,}$/iu.test(text)
    || /^gh_[a-z0-9_-]{8,}$/iu.test(text)
}

function pickDisplayName(candidates = [], fallback = '') {
  for (const item of [...(Array.isArray(candidates) ? candidates : [candidates]), fallback]) {
    const value = String(item || '').trim()
    if (value && !/^(未知成员|unknown)$/iu.test(value) && !isInternalWechatIdLike(value)) return value
  }
  const raw = String(fallback || '').trim()
  return raw || '未知成员'
}

function canonicalMemberIdFromParts({ groupId = '', stableKey = '', wxid = '', wechatId = '', displayName = '', senderId = '' } = {}) {
  const stable = String(stableKey || wxid || wechatId || '').trim()
  if (stable) return `wechat_member_stable_${safeIdPart(stable)}`
  const nameKey = normalizeIdentityName(displayName)
  if (nameKey && !isInternalWechatIdLike(displayName)) return `wechat_member_name_${safeIdPart(groupId)}_${safeIdPart(nameKey)}`
  return `wechat_member_sender_${safeIdPart(groupId)}_${safeIdPart(senderId || displayName || 'unknown')}`
}

function readKnownMemberIdentity(db, gid, senderId = '', senderName = '') {
  const sid = String(senderId || '').trim()
  const name = String(senderName || '').trim()
  try {
    if (sid) {
      const row = db.prepare(`
        SELECT sender_id, display_name, room_alias, contact_alias, contact_name, wechat_id, wxid, stable_key, source
        FROM wechat_group_member_names
        WHERE group_id = ? AND sender_id = ?
        ORDER BY last_seen DESC LIMIT 1
      `).get(gid, sid)
      if (row) return row
    }
  } catch {}
  try {
    if (name && !isInternalWechatIdLike(name)) {
      const rows = db.prepare(`
        SELECT sender_id, display_name, room_alias, contact_alias, contact_name, wechat_id, wxid, stable_key, source
        FROM wechat_group_member_names
        WHERE group_id = ? AND (
          display_name = ? OR room_alias = ? OR contact_alias = ? OR contact_name = ?
        )
        ORDER BY last_seen DESC LIMIT 3
      `).all(gid, name, name, name, name)
      if (rows.length === 1) return rows[0]
    }
  } catch {}
  return null
}

function aliasListForIdentity(values = []) {
  return JSON.stringify([...new Set(values.map(item => String(item || '').trim()).filter(item => item && !isInternalWechatIdLike(item)))].slice(0, 20))
}

function resolveLocalMemberIdentity({ groupId, groupName = '', senderId = '', senderName = '', canonicalMemberId = '', source = 'memory' } = {}) {
  const gid = groupKey(groupId)
  if (!gid) return { canonical_member_id: '', display_name: senderName || senderId || '', sender_id: senderId || '' }
  ensureLocalMemorySchema()
  const db = getDB()
  const known = readKnownMemberIdentity(db, gid, senderId, senderName) || {}
  const sid = String(senderId || known.sender_id || '').trim()
  const displayName = pickDisplayName([senderName, known.display_name, known.room_alias, known.contact_alias, known.contact_name], sid)
  const stableKey = String(known.stable_key || known.wxid || known.wechat_id || '').trim()
  const cid = String(canonicalMemberId || '').trim() || canonicalMemberIdFromParts({
    groupId: gid,
    stableKey,
    wxid: known.wxid,
    wechatId: known.wechat_id,
    displayName,
    senderId: sid,
  })
  const now = nowTimestamp()
  const aliases = aliasListForIdentity([displayName, known.display_name, known.room_alias, known.contact_alias, known.contact_name, known.wechat_id, known.wxid])
  db.prepare(`
    INSERT INTO wechat_member_identities (canonical_member_id, group_id, group_name, display_name, stable_key, wxid, wechat_id, aliases, confidence, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_member_id) DO UPDATE SET
      group_name = CASE WHEN excluded.group_name <> '' THEN excluded.group_name ELSE wechat_member_identities.group_name END,
      display_name = CASE WHEN excluded.display_name <> '' AND excluded.display_name <> '未知成员' THEN excluded.display_name ELSE wechat_member_identities.display_name END,
      stable_key = CASE WHEN excluded.stable_key <> '' THEN excluded.stable_key ELSE wechat_member_identities.stable_key END,
      wxid = CASE WHEN excluded.wxid <> '' THEN excluded.wxid ELSE wechat_member_identities.wxid END,
      wechat_id = CASE WHEN excluded.wechat_id <> '' THEN excluded.wechat_id ELSE wechat_member_identities.wechat_id END,
      aliases = excluded.aliases,
      confidence = MAX(wechat_member_identities.confidence, excluded.confidence),
      last_seen = excluded.last_seen
  `).run(cid, gid, groupName, displayName, stableKey, known.wxid || '', known.wechat_id || '', aliases, stableKey ? 3 : (sid ? 2 : 1), now, now)
  if (sid) {
    db.prepare(`
      INSERT INTO wechat_member_identity_aliases (
        canonical_member_id, group_id, sender_id, display_name, room_alias, contact_alias, contact_name, stable_key, wxid, wechat_id, source, first_seen, last_seen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, sender_id) DO UPDATE SET
        canonical_member_id = excluded.canonical_member_id,
        display_name = excluded.display_name,
        room_alias = excluded.room_alias,
        contact_alias = excluded.contact_alias,
        contact_name = excluded.contact_name,
        stable_key = CASE WHEN excluded.stable_key <> '' THEN excluded.stable_key ELSE wechat_member_identity_aliases.stable_key END,
        wxid = CASE WHEN excluded.wxid <> '' THEN excluded.wxid ELSE wechat_member_identity_aliases.wxid END,
        wechat_id = CASE WHEN excluded.wechat_id <> '' THEN excluded.wechat_id ELSE wechat_member_identity_aliases.wechat_id END,
        source = excluded.source,
        last_seen = excluded.last_seen
    `).run(cid, gid, sid, displayName, known.room_alias || '', known.contact_alias || '', known.contact_name || '', stableKey, known.wxid || '', known.wechat_id || '', source, now, now)
  }
  return {
    canonical_member_id: cid,
    display_name: displayName,
    sender_id: sid,
    stable_key: stableKey,
    wxid: known.wxid || '',
    wechat_id: known.wechat_id || '',
  }
}

function localHashEmbeddingBuffer(text = '') {
  const dims = 384
  const vec = new Float32Array(dims)
  const value = normalizeText(text).toLowerCase()
  for (let i = 0; i < value.length; i++) {
    const gram = value.slice(i, i + 2)
    let h = 2166136261
    for (let j = 0; j < gram.length; j++) { h ^= gram.charCodeAt(j); h = Math.imul(h, 16777619) }
    vec[Math.abs(h) % dims] += 1
  }
  let norm = 0
  for (const n of vec) norm += n * n
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm
  return Buffer.from(vec.buffer)
}

function writeLocalEmbedding(table, id, text) {
  const body = normalizeText(text)
  if (!body || !id) return
  ;(async () => {
    try {
      let buffer = null
      try {
        const { computeEmbedding, isEmbeddingConfigured } = await import('../embedding.js')
        if (isEmbeddingConfigured()) buffer = await computeEmbedding(body)
      } catch {}
      if (!buffer) buffer = localHashEmbeddingBuffer(body)
      const db = getDB()
      db.prepare(`UPDATE ${table} SET embedding = ? WHERE id = ?`).run(buffer, id)
    } catch {}
  })()
}

function shouldAutoArchiveMemberMessage(content = '') {
  const text = normalizeText(content)
  if (text.length < 8 || text.length > 1200) return false
  if (/^\[(?:图片|表情|链接|视频|语音|小程序\/链接|微信结构化消息)\]$/u.test(text)) return false
  return /(?:记住|记一下|以后|以后都|我(?:是|叫|喜欢|不喜欢|讨厌|负责|在|来自|要|想|需要|习惯|经常)|我的(?:名字|昵称|称呼|身份|工作|职业|爱好|偏好)|别叫我|叫我|喊我)/u.test(text)
}

function shouldArchiveMemberUtterance(content = '') {
  const text = normalizeText(content)
  if (text.length < 4 || text.length > 900) return false
  if (/^\[(?:图片|表情|链接|视频|语音|小程序\/链接|微信结构化消息)\]$/u.test(text)) return false
  if (isInternalToolProtocolText(text)) return false
  if (/^(?:哈+|哈哈+|hhh+|666+|嗯+|啊+|哦+|行|好|收到|ok|OK|1|。。?|[?？!！~～]+)$/iu.test(text)) return false
  return /[\p{Script=Han}A-Za-z0-9]/u.test(text)
}

function autoMemberMemoryContent({ memberName = '', content = '' } = {}) {
  const name = normalizeText(memberName || '该群友')
  const body = normalizeMemoryDisplayText(content)
  return `群友「${name}」曾在本群表达/说明：${body}`
}

function memberUtteranceMemoryContent({ memberName = '', content = '' } = {}) {
  const name = normalizeText(memberName || '该群友')
  const body = normalizeMemoryDisplayText(content)
  return `群友「${name}」在本群的发言素材：${body}`
}

function tokenizePersonaText(text = '') {
  return normalizeText(text)
    .replace(/[^\p{Script=Han}A-Za-z0-9_]+/gu, ' ')
    .split(/\s+/u)
    .map(v => v.trim())
    .filter(v => v.length >= 2 && !/^(这个|那个|就是|一下|什么|不是|没有|可以|然后|因为|所以|今天|明天|昨天|哈哈|视频|图片)$/u.test(v))
}

function topKeywordsFromMessages(messages = [], max = 8) {
  const counts = new Map()
  for (const msg of messages) {
    for (const token of tokenizePersonaText(msg)) counts.set(token, (counts.get(token) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, max).map(([word]) => word)
}

function buildMemberPersonaSummary({ memberName = '', messages = [] } = {}) {
  const name = normalizeText(memberName || '该群友')
  const usable = (Array.isArray(messages) ? messages : []).map(normalizeMemoryDisplayText).filter(shouldArchiveMemberUtterance)
  if (!usable.length) return ''
  const keywords = topKeywordsFromMessages(usable, 10)
  const samples = usable
    .slice(-8)
    .map(text => text.length > 72 ? `${text.slice(0, 72)}…` : text)
    .slice(0, 5)
  const directCount = usable.filter(text => /(?:我|我的|老子|本人|喜欢|不喜欢|负责|要|想|需要|讨厌|以后|叫我|喊我)/u.test(text)).length
  const questionCount = usable.filter(text => /[?？]|(?:什么|怎么|为啥|看看|帮|能不能|有没有)/u.test(text)).length
  const style = [
    directCount >= 3 ? '常主动表达自己的身份、偏好或判断' : '',
    questionCount >= 3 ? '经常发起问题或让助手/群友判断内容' : '',
    usable.some(text => /(?:哈哈|笑死|绷|老登|哥|佬|牛|艹|草|妈的|卧槽)/u.test(text)) ? '聊天风格偏口语、接梗和群聊语气' : '',
  ].filter(Boolean)
  return [
    `【群友人设总结】${name}`,
    `- 发言画像：${style.join('；') || '根据历史发言形成的群内互动画像，回复时应参考其常用话题和语气。'}`,
    keywords.length ? `- 常见话题/关键词：${keywords.join('、')}` : '',
    `- 回复口味：结合此人在本群的历史发言素材，尽量贴近其称呼、关注点和表达习惯；不确定时用自然群聊口吻，不要装作知道未出现过的事实。`,
    samples.length ? `- 代表性发言：${samples.map(item => `“${item}”`).join('；')}` : '',
  ].filter(Boolean).join('\n')
}

function upsertMemberPersonaSummary({ groupId, groupName = '', senderId = '', senderName = '', canonicalMemberId = '', content = '' } = {}) {
  const body = normalizeMemoryDisplayText(content)
  const gid = groupKey(groupId)
  if (!gid || !body) return { ok: false, skipped: true, reason: 'empty_persona_summary' }
  ensureLocalMemorySchema()
  const db = getDB()
  const identity = resolveLocalMemberIdentity({ groupId: gid, groupName, senderId, senderName, canonicalMemberId, source: 'member-persona-summary' })
  const cid = identity.canonical_member_id || canonicalMemberId || ''
  const now = nowTimestamp()
  const existing = cid ? db.prepare(`
    SELECT id FROM wechat_group_memory_items
    WHERE group_id=? AND canonical_member_id=? AND category='member_persona_summary' AND status='active'
    ORDER BY id DESC LIMIT 1
  `).get(gid, cid) : null
  if (existing?.id) {
    db.prepare(`
      UPDATE wechat_group_memory_items
      SET title=?, content=?, salience=5, source_text=?, updated_at=?
      WHERE id=? AND group_id=? AND status='active'
    `).run(body.slice(0, 48), body, 'auto persona summary from group messages', now, existing.id, gid)
    writeLocalEmbedding('wechat_group_memory_items', existing.id, `${groupName} ${identity.display_name || senderName} member_persona_summary: ${body}`)
    return { ok: true, updated: true, id: String(existing.id) }
  }
  return localCreateMemory({
    groupId: gid,
    groupName,
    senderId: identity.sender_id || senderId,
    senderName: identity.display_name || senderName,
    canonicalMemberId: cid,
    content: body,
    category: 'member_persona_summary',
    sourceText: 'auto persona summary from group messages',
    salience: 5,
  })
}

function localRecordGroupMessage({ groupId, groupName = '', senderId = '', senderName = '', text = '', mentionedSelf = false, source = 'wechaty', timestamp = nowTimestamp() } = {}) {
  const content = normalizeMemoryDisplayText(text)
  const gid = groupKey(groupId)
  if (!gid || !content) return { ok: false, provider: 'local', skipped: true, reason: 'empty_group_or_content' }
  ensureLocalMemorySchema()
  const db = getDB()
  const identity = senderId || senderName
    ? resolveLocalMemberIdentity({ groupId: gid, groupName, senderId, senderName, source })
    : { canonical_member_id: '', display_name: senderName || '', sender_id: senderId || '' }
  const info = db.prepare(`
    INSERT INTO wechat_group_messages (group_id, group_external_id, group_name, member_id, member_name, canonical_member_id, content, mentioned_self, source, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(gid, localExternalGroupId(gid), groupName, identity.sender_id || senderId || senderName, identity.display_name || senderName, identity.canonical_member_id || '', content, mentionedSelf ? 1 : 0, source, timestamp, nowTimestamp())
  writeLocalEmbedding('wechat_group_messages', info.lastInsertRowid, `${groupName} ${identity.display_name || senderName}: ${content}`)
  if (shouldAutoArchiveMemberMessage(content)) {
    localCreateMemory({
      groupId: gid,
      groupName,
      senderId: identity.sender_id || senderId || senderName,
      senderName: identity.display_name || senderName,
      canonicalMemberId: identity.canonical_member_id || '',
      content: autoMemberMemoryContent({ memberName: identity.display_name || senderName, content }),
      category: 'auto_member_fact',
      sourceText: content,
      sourceMessageId: info.lastInsertRowid,
      salience: 3,
    })
  }
  return { ok: true, provider: 'local', id: info.lastInsertRowid, group_id: gid }
}

function localCreateMemory({ groupId, groupName = '', content = '', category = 'manual', senderId = '', senderName = '', canonicalMemberId = '', sourceText = '', sourceMessageId = null, salience = 3 } = {}) {
  const body = normalizeMemoryDisplayText(content)
  const gid = groupKey(groupId)
  if (!gid || !body) return { ok: false, provider: 'local', error: '本地记忆内容为空' }
  ensureLocalMemorySchema()
  const db = getDB()
  const now = nowTimestamp()
  const title = body.slice(0, 48)
  const identity = senderId || senderName || canonicalMemberId
    ? resolveLocalMemberIdentity({ groupId: gid, groupName, senderId, senderName, canonicalMemberId, source: 'manual-memory' })
    : { canonical_member_id: '', display_name: senderName || '', sender_id: senderId || '' }
  const existing = db.prepare(`
    SELECT id, category, title, content, member_id, member_name, canonical_member_id, created_at, updated_at
    FROM wechat_group_memory_items
    WHERE group_id = ?
      AND category = ?
      AND content = ?
      AND status='active'
      AND (
        COALESCE(canonical_member_id,'') = ?
        OR (COALESCE(canonical_member_id,'') = '' AND COALESCE(member_id,'') = ? AND COALESCE(member_name,'') = ?)
      )
    LIMIT 1
  `).get(gid, category, body, identity.canonical_member_id || '', identity.sender_id || senderId || senderName || '', identity.display_name || senderName || '')
  if (existing) {
    return { ok: true, provider: 'local', deduped: true, group_id: gid, items: [{ id: String(existing.id), kind: 'conclusion', scope: identity.canonical_member_id || identity.sender_id || identity.display_name ? 'member' : 'group', category: existing.category, title: existing.title, content: existing.content, speaker: existing.member_name || groupName, canonicalMemberId: existing.canonical_member_id || identity.canonical_member_id || '', createdAt: existing.created_at, updatedAt: existing.updated_at }] }
  }
  const info = db.prepare(`
    INSERT INTO wechat_group_memory_items (group_id, group_external_id, group_name, member_id, member_name, canonical_member_id, category, title, content, status, salience, source_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(gid, localExternalGroupId(gid), groupName, identity.sender_id || senderId || senderName, identity.display_name || senderName, identity.canonical_member_id || '', category, title, body, Number(salience || 3), sourceText || '', now, now)
  if (sourceMessageId) {
    try { db.prepare(`UPDATE wechat_group_memory_items SET source_message_id=? WHERE id=?`).run(Number(sourceMessageId), info.lastInsertRowid) } catch {}
  }
  writeLocalEmbedding('wechat_group_memory_items', info.lastInsertRowid, `${groupName} ${identity.display_name || senderName} ${category}: ${body}`)
  return { ok: true, provider: 'local', group_id: gid, items: [{ id: String(info.lastInsertRowid), kind: 'conclusion', scope: identity.canonical_member_id || identity.sender_id || identity.display_name ? 'member' : 'group', category, title, content: body, speaker: identity.display_name || senderName || groupName, canonicalMemberId: identity.canonical_member_id || '', createdAt: now, updatedAt: now }] }
}

function cosineSimilarityBuffer(a, b) {
  try {
    const fa = new Float32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4))
    const fb = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
    const n = Math.min(fa.length, fb.length)
    if (!n) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) { dot += fa[i] * fb[i]; na += fa[i] * fa[i]; nb += fb[i] * fb[i] }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
  } catch { return 0 }
}

async function localSemanticRows({ table, groupId, query, limit = 8 }) {
  const gid = groupKey(groupId)
  const q = normalizeText(query)
  if (!gid || !q) return []
  try {
    let qbuf = null
    try {
      const { computeEmbedding, isEmbeddingConfigured } = await import('../embedding.js')
      if (isEmbeddingConfigured()) qbuf = await computeEmbedding(q)
    } catch {}
    if (!qbuf) qbuf = localHashEmbeddingBuffer(q)
    const rows = getDB().prepare(`SELECT * FROM ${table} WHERE group_id = ? AND embedding IS NOT NULL ORDER BY id DESC LIMIT 1200`).all(gid)
    return rows.map(row => ({ ...row, _score: cosineSimilarityBuffer(qbuf, row.embedding) }))
      .filter(row => row._score > 0.12)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
  } catch { return [] }
}

async function getLocalGroupMemoryContext({ groupId, senderId = '', senderName = '', query = '', limit = 16 } = {}) {
  const gid = groupKey(groupId)
  if (!gid) return ''
  ensureLocalMemorySchema()
  const db = getDB()
  const q = normalizeText(query)
  const like = q ? `%${q.slice(0, 80)}%` : ''
  const identity = senderId || senderName
    ? resolveLocalMemberIdentity({ groupId: gid, senderId, senderName, source: 'memory-context' })
    : { canonical_member_id: '', display_name: senderName || '', sender_id: senderId || '' }
  const canonical = identity.canonical_member_id || ''
  const memberId = identity.sender_id || senderId || senderName
  const memberName = identity.display_name || senderName
  let memories = []
  if (like) {
    memories = db.prepare(`
      SELECT * FROM wechat_group_memory_items
      WHERE group_id = ? AND status='active'
        AND (
          canonical_member_id IN ('', ?)
          OR member_id IN ('', ?)
          OR member_name IN ('', ?)
          OR member_id = ?
          OR member_name = ?
        )
        AND content LIKE ?
      ORDER BY salience DESC, updated_at DESC LIMIT ?
    `).all(gid, canonical, memberId, memberName, memberId, memberName, like, Math.min(limit, 20))
  }
  if (!memories.length) {
    memories = db.prepare(`
      SELECT * FROM wechat_group_memory_items
      WHERE group_id = ? AND status='active'
        AND (
          canonical_member_id IN ('', ?)
          OR member_id IN ('', ?)
          OR member_name IN ('', ?)
          OR member_id = ?
          OR member_name = ?
        )
      ORDER BY salience DESC, updated_at DESC LIMIT ?
    `).all(gid, canonical, memberId, memberName, memberId, memberName, Math.min(limit, 20))
  }
  const semanticMemories = await localSemanticRows({ table: 'wechat_group_memory_items', groupId: gid, query: q, limit: 6 })
  const semanticMessages = await localSemanticRows({ table: 'wechat_group_messages', groupId: gid, query: q, limit: 8 })
  let relatedMemberMemories = []
  if (q) {
    try {
      const relatedMembers = listLocalPermanentMemoryMembers({ groupId: gid, q, limit: 8 }).members
        .filter(member => member.canonical_member_id && member.canonical_member_id !== canonical)
        .slice(0, 5)
      if (relatedMembers.length) {
        relatedMemberMemories = db.prepare(`
          SELECT * FROM wechat_group_memory_items
          WHERE group_id = ? AND status='active'
            AND canonical_member_id IN (${relatedMembers.map(() => '?').join(',')})
          ORDER BY salience DESC, updated_at DESC, id DESC
          LIMIT ?
        `).all(gid, ...relatedMembers.map(member => member.canonical_member_id), 12)
      }
    } catch {}
  }
  const recentMessages = db.prepare(`
    SELECT * FROM wechat_group_messages WHERE group_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?
  `).all(gid, Math.min(limit, 30))
  const memoryLines = [...new Map([...semanticMemories, ...relatedMemberMemories, ...memories].map(row => [row.id, row])).values()]
    .slice(0, 12)
    .map(row => `- [${row.member_name || '群'}][${row.category || 'memory'}] ${row.content}`)
  const messageLines = [...new Map([...semanticMessages, ...recentMessages].map(row => [row.id, row])).values()]
    .slice(0, 16)
    .map(row => `- ${row.timestamp || row.created_at} ${row.member_name || '群成员'}：${row.content}`)
  if (!memoryLines.length && !messageLines.length) return '<local-group-memory>本地暂无本群记忆。</local-group-memory>'
  return `<local-group-memory query="${q.slice(0,120)}">
${memoryLines.length ? `<member-and-group-memories>\n${memoryLines.join('\n')}\n</member-and-group-memories>` : ''}
${messageLines.length ? `<recent-and-semantic-chat-records>\n${messageLines.join('\n')}\n</recent-and-semantic-chat-records>` : ''}
</local-group-memory>`
}

function listLocalGroupMemory({ groupId, groupName = '', limit = 80, includeAllPeers = true } = {}) {
  const gid = groupKey(groupId)
  if (!gid) return { ok: false, provider: 'local', items: [], messages: [], conclusions: [], summaries: [], error: 'missing group id' }
  ensureLocalMemorySchema()
  const db = getDB()
  const size = Math.min(Math.max(Number(limit || 80), 1), 300)
  const messages = db.prepare(`SELECT * FROM wechat_group_messages WHERE group_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?`).all(gid, size)
    .map(row => ({ id: String(row.id), kind: 'message', type: 'wechat_group_message', content: row.content, speaker: row.member_name || row.member_id || '群成员', createdAt: row.timestamp || row.created_at, metadata: { sender_id: row.member_id, sender_name: row.member_name, canonical_member_id: row.canonical_member_id || '', group_id: row.group_id, group_name: row.group_name } }))
  const conclusions = db.prepare(`SELECT * FROM wechat_group_memory_items WHERE group_id = ? AND status='active' ORDER BY salience DESC, updated_at DESC LIMIT ?`).all(gid, size)
    .map(row => ({ id: String(row.id), kind: 'conclusion', scope: row.canonical_member_id || row.member_id || row.member_name ? 'member' : 'group', category: row.category, title: row.title, content: row.content, speaker: row.member_name || row.group_name || '群', canonicalMemberId: row.canonical_member_id || '', createdAt: row.created_at, updatedAt: row.updated_at, metadata: { member_id: row.member_id, member_name: row.member_name, canonical_member_id: row.canonical_member_id || '' } }))
  return { ok: true, provider: 'local', group_id: gid, group_name: groupName, items: messages, messages, conclusions, summaries: [], counts: { messages: messages.length, totalMessages: db.prepare('SELECT COUNT(*) AS n FROM wechat_group_messages WHERE group_id=?').get(gid).n, conclusions: conclusions.length, summaries: 0 }, errors: [] }
}

function memberRowIdentity(row = {}, gid = '', groupName = '') {
  return resolveLocalMemberIdentity({
    groupId: gid,
    groupName: groupName || row.group_name || '',
    senderId: row.sender_id || row.member_id || '',
    senderName: row.display_name || row.member_name || row.sender_name || '',
    canonicalMemberId: row.canonical_member_id || '',
    source: 'member-memory-list',
  })
}

function listLocalPermanentMemoryMembers({ groupId, groupName = '', q = '', limit = 300 } = {}) {
  const gid = groupKey(groupId)
  if (!gid) return { ok: false, provider: 'local', members: [], error: 'missing group id' }
  ensureLocalMemorySchema()
  const db = getDB()
  const max = Math.min(Math.max(Number(limit || 300), 1), 20000)
  const sourceMax = Math.min(Math.max(max * 4, 1000), 20000)
  const keyword = normalizeText(q)
  const rows = []
  try {
    rows.push(...db.prepare(`
      SELECT group_id, group_name, sender_id, display_name, stable_key, wxid, wechat_id, last_seen
      FROM wechat_group_member_names
      WHERE group_id = ? OR group_name = ?
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(gid, groupName || gid, sourceMax))
  } catch {}
  try {
    rows.push(...db.prepare(`
      SELECT group_id, group_name, member_id AS sender_id, member_name AS display_name, canonical_member_id, MAX(updated_at) AS last_seen
      FROM wechat_group_memory_items
      WHERE group_id = ? AND status='active' AND (canonical_member_id <> '' OR member_id <> '' OR member_name <> '')
      GROUP BY canonical_member_id, member_id, member_name
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(gid, sourceMax))
  } catch {}
  try {
    rows.push(...db.prepare(`
      SELECT group_id, group_name, member_id AS sender_id, member_name AS display_name, canonical_member_id, MAX(timestamp) AS last_seen
      FROM wechat_group_messages
      WHERE group_id = ? AND (canonical_member_id <> '' OR member_id <> '' OR member_name <> '')
      GROUP BY canonical_member_id, member_id, member_name
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(gid, sourceMax))
  } catch {}
  const map = new Map()
  for (const row of rows) {
    const identity = memberRowIdentity(row, gid, groupName)
    const cid = identity.canonical_member_id
    if (!cid || cid.includes('unknown')) continue
    const displayName = pickDisplayName([identity.display_name, row.display_name, row.member_name], row.sender_id || '')
    if (keyword && !`${displayName} ${row.sender_id || ''} ${identity.stable_key || ''}`.toLowerCase().includes(keyword.toLowerCase())) continue
    const prev = map.get(cid) || {
      canonical_member_id: cid,
      display_name: displayName,
      sender_ids: new Set(),
      aliases: new Set(),
      stable_key: identity.stable_key || row.stable_key || '',
      wxid: identity.wxid || row.wxid || '',
      wechat_id: identity.wechat_id || row.wechat_id || '',
      memory_count: 0,
      message_count: 0,
      last_seen: '',
    }
    if (row.sender_id) prev.sender_ids.add(String(row.sender_id))
    if (displayName && displayName !== '未知成员') prev.aliases.add(displayName)
    const last = row.last_seen || ''
    if (last && String(last).localeCompare(String(prev.last_seen || '')) > 0) {
      prev.last_seen = last
      prev.display_name = displayName || prev.display_name
    }
    map.set(cid, prev)
  }
  for (const member of map.values()) {
    try {
      const senderIds = [...member.sender_ids]
      const memoryParams = [gid, member.canonical_member_id]
      const messageParams = [gid, member.canonical_member_id]
      let senderMemorySql = ''
      let senderMessageSql = ''
      if (senderIds.length) {
        senderMemorySql = ` OR member_id IN (${senderIds.map(() => '?').join(',')})`
        senderMessageSql = ` OR member_id IN (${senderIds.map(() => '?').join(',')})`
        memoryParams.push(...senderIds)
        messageParams.push(...senderIds)
      }
      member.memory_count = db.prepare(`SELECT COUNT(*) AS n FROM wechat_group_memory_items WHERE group_id=? AND status='active' AND (canonical_member_id=?${senderMemorySql})`).get(...memoryParams).n || 0
      member.message_count = db.prepare(`SELECT COUNT(*) AS n FROM wechat_group_messages WHERE group_id=? AND (canonical_member_id=?${senderMessageSql})`).get(...messageParams).n || 0
    } catch {}
  }
  const members = [...map.values()]
    .sort((a, b) => Number(b.memory_count || 0) - Number(a.memory_count || 0) || String(b.last_seen || '').localeCompare(String(a.last_seen || '')))
    .slice(0, max)
    .map(item => ({ ...item, sender_ids: [...item.sender_ids], aliases: [...item.aliases] }))
  return { ok: true, provider: 'local', group_id: gid, group_name: groupName, members }
}

export function listWeChatMemberPermanentMemory({ groupId, groupName = '', canonicalMemberId = '', senderId = '', senderName = '', q = '', limit = 300 } = {}) {
  const gid = groupKey(groupId)
  if (!gid) return { ok: false, provider: 'local', members: [], memories: [], error: 'missing group id' }
  ensureLocalMemorySchema()
  const db = getDB()
  const membersResult = listLocalPermanentMemoryMembers({ groupId: gid, groupName, q: '', limit })
  let identity = null
  const wantedCid = String(canonicalMemberId || '').trim()
  if (wantedCid) identity = membersResult.members.find(member => member.canonical_member_id === wantedCid) || { canonical_member_id: wantedCid, display_name: senderName || senderId || wantedCid }
  else if (senderId || senderName) identity = resolveLocalMemberIdentity({ groupId: gid, groupName, senderId, senderName, source: 'member-memory-read' })
  else identity = membersResult.members[0] || null
  const cid = identity?.canonical_member_id || ''
  const senderIds = Array.isArray(identity?.sender_ids) ? identity.sender_ids : [identity?.sender_id || senderId].filter(Boolean)
  const displayName = identity?.display_name || senderName || ''
  const query = normalizeText(q)
  const memberClauses = ['canonical_member_id = ?']
  const params = [gid, cid]
  if (senderIds.length) {
    memberClauses.push(`member_id IN (${senderIds.map(() => '?').join(',')})`)
    params.push(...senderIds)
  }
  if (displayName) {
    memberClauses.push('member_name = ?')
    params.push(displayName)
  }
  let searchSql = ''
  if (query) {
    searchSql = 'AND content LIKE ?'
    params.push(`%${query}%`)
  }
  const rows = cid ? db.prepare(`
    SELECT id, group_id, group_name, member_id, member_name, canonical_member_id, category, title, content, salience, source_text, created_at, updated_at
    FROM wechat_group_memory_items
    WHERE group_id = ? AND (${memberClauses.join(' OR ')}) AND status='active' ${searchSql}
    ORDER BY salience DESC, updated_at DESC, id DESC
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit || 300), 1), 1000)) : []
  return {
    ok: true,
    provider: 'local',
    group_id: gid,
    group_name: groupName,
    selected: identity,
    members: membersResult.members,
    memories: rows.map(row => ({
      id: String(row.id),
      group_id: row.group_id,
      group_name: row.group_name,
      member_id: row.member_id,
      member_name: row.member_name,
      canonical_member_id: row.canonical_member_id,
      category: row.category,
      title: row.title,
      content: row.content,
      salience: row.salience,
      source_text: row.source_text,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  }
}

export function updateWeChatMemberPermanentMemory({ groupId, itemId = '', content = '', category = '', salience = null } = {}) {
  const gid = groupKey(groupId)
  const id = String(itemId || '').trim()
  const body = normalizeMemoryDisplayText(content)
  if (!gid || !id) return { ok: false, provider: 'local', error: '缺少群 ID 或记忆 ID' }
  if (!body) return { ok: false, provider: 'local', error: '记忆内容不能为空' }
  ensureLocalMemorySchema()
  const db = getDB()
  const existing = db.prepare(`SELECT * FROM wechat_group_memory_items WHERE id=? AND group_id=? AND status='active'`).get(id, gid)
  if (!existing) return { ok: false, provider: 'local', error: '没有找到这条记忆' }
  const nextCategory = normalizeText(category || existing.category || 'manual')
  const nextSalience = Number.isFinite(Number(salience)) ? Math.min(Math.max(Number(salience), 1), 5) : existing.salience
  const now = nowTimestamp()
  const title = body.slice(0, 48)
  db.prepare(`
    UPDATE wechat_group_memory_items
    SET category=?, title=?, content=?, salience=?, updated_at=?
    WHERE id=? AND group_id=? AND status='active'
  `).run(nextCategory, title, body, nextSalience, now, id, gid)
  writeLocalEmbedding('wechat_group_memory_items', id, `${existing.group_name || ''} ${existing.member_name || ''} ${nextCategory}: ${body}`)
  return { ok: true, provider: 'local', id, group_id: gid, updated_at: now }
}

export function deleteWeChatMemberPermanentMemory({ groupId, itemId = '' } = {}) {
  const gid = groupKey(groupId)
  const id = String(itemId || '').trim()
  if (!gid || !id) return { ok: false, provider: 'local', error: '缺少群 ID 或记忆 ID' }
  ensureLocalMemorySchema()
  const info = getDB().prepare(`UPDATE wechat_group_memory_items SET status='deleted', updated_at=? WHERE id=? AND group_id=?`).run(nowTimestamp(), id, gid)
  return { ok: info.changes > 0, provider: 'local', id, group_id: gid }
}

function messageCreatedAt(item) {
  return item?.createdAt || item?.created_at || item?.created_at_ || item?.metadata?.timestamp || ''
}

function messageSpeaker(item) {
  return item?.metadata?.sender_name || item?.metadata?.target_member_name || item?.peerId || item?.peer_id || '群成员'
}

function pageItems(page) {
  return page?.items || page?.data || (Array.isArray(page) ? page : [])
}

function pageTotal(page, rows = []) {
  return Number.isFinite(page?.total) ? page.total : rows.length
}

function normalizeMessageItem(item) {
  return {
    id: String(item?.id || ''),
    kind: 'message',
    type: String(item?.metadata?.type || 'wechat_group_message'),
    content: normalizeMemoryDisplayText(item?.content || ''),
    speaker: normalizeText(messageSpeaker(item)),
    peerId: item?.peerId || item?.peer_id || '',
    sessionId: item?.sessionId || item?.session_id || '',
    workspaceId: item?.workspaceId || item?.workspace_id || '',
    createdAt: messageCreatedAt(item),
    metadata: item?.metadata || {},
    deletable: false,
    deleteHint: 'Honcho SDK 当前不提供单条原始消息删除接口；如需清空请使用“清空本群 Honcho session”。',
  }
}

function normalizeConclusionItem(item, scope = 'group') {
  return {
    id: String(item?.id || ''),
    kind: 'conclusion',
    type: scope === 'member' ? 'member_memory' : 'group_memory',
    scope,
    content: normalizeText(item?.content || ''),
    observerId: item?.observerId || item?.observer_id || '',
    observedId: item?.observedId || item?.observed_id || '',
    sessionId: item?.sessionId || item?.session_id || '',
    createdAt: item?.createdAt || item?.created_at || '',
    deletable: true,
  }
}

function normalizeSummaryItem(summary, type = 'summary') {
  if (!summary?.content) return null
  return {
    id: String(summary.messageId || `${type}_summary`),
    kind: 'summary',
    type,
    content: normalizeText(summary.content),
    createdAt: summary.createdAt || '',
    tokenCount: summary.tokenCount || 0,
    deletable: false,
  }
}

function formatHonchoMessagesAsContext(rows = []) {
  const usable = rows
    .slice()
    .reverse()
    .map(item => {
      if (isInternalToolProtocolText(item?.content || '')) return ''
      const text = normalizeMemoryDisplayText(item?.content || '')
      if (!text) return ''
      const ts = String(messageCreatedAt(item) || '').slice(0, 16)
      const speaker = normalizeText(messageSpeaker(item))
      return `- ${ts ? `${ts} ` : ''}${speaker}：${text}`
    })
    .filter(Boolean)
  if (!usable.length) return ''
  return `<honcho-recent-group-messages source="honcho-messages">\n${usable.join('\n')}\n</honcho-recent-group-messages>`
}

function formatHonchoConclusionsAsContext(rows = []) {
  const usable = rows
    .map(item => normalizeText(item?.content || ''))
    .filter(Boolean)
    .slice(0, 20)
    .map(text => `- ${text}`)
  if (!usable.length) return ''
  return `<honcho-derived-memory source="honcho-conclusions">\n${usable.join('\n')}\n</honcho-derived-memory>`
}

function formatHonchoSummariesAsContext(summaries = []) {
  const usable = summaries
    .map(item => normalizeText(item?.content || ''))
    .filter(Boolean)
    .slice(0, 2)
    .map(text => `- ${text}`)
  if (!usable.length) return ''
  return `<honcho-session-summaries>\n${usable.join('\n')}\n</honcho-session-summaries>`
}

function getClient() {
  if (isHonchoTemporarilyDisabled()) return null
  const cfg = getHonchoConfig()
  if (!cfg.enabled || !cfg.apiKey) return null
  const key = cfg.apiKey
  const baseURL = cfg.baseURL || ''
  const env = cfg.environment || 'local'
  if (!client || key !== cachedKey || baseURL !== cachedBaseURL || env !== cachedEnv) {
    // @honcho-ai/sdk 会在 environment='local' 时强制覆盖 baseURL 为 localhost:8000。
    // 白龙马使用专用端口 8018，所以有 baseURL 时不传 environment，避免误连其它项目的 8000。
    client = new Honcho({
      apiKey: key,
      environment: baseURL ? undefined : env,
      baseURL: baseURL || undefined,
      workspaceId: cfg.workspaceId || cfg.appId || 'bailongma-wechat-memory',
      timeout: 8000,
      maxRetries: 0,
    })
    cachedKey = key
    cachedBaseURL = baseURL
    cachedEnv = env
    appIdCache = cfg.workspaceId || cfg.appId || 'bailongma-wechat-memory'
    userCache.clear()
    sessionCache.clear()
  }
  return client
}

async function ensureApp(honcho) {
  try {
    await honcho.getMetadata()
    const cfg = getHonchoConfig()
    appIdCache = cfg.workspaceId || cfg.appId || 'bailongma-wechat-memory'
    return appIdCache
  } catch (err) {
    markHonchoUnavailable(err, '连接')
    throw err
  }
}

async function ensurePeer(honcho, id, metadata = {}) {
  const key = id
  if (userCache.has(key)) return userCache.get(key)
  const peer = await honcho.peer(id, { metadata })
  userCache.set(key, peer)
  return peer
}

async function ensureSession(honcho, groupId, metadata = {}, peers = []) {
  const key = groupId
  if (sessionCache.has(key)) return sessionCache.get(key)
  const options = {
    metadata,
    configuration: GROUP_SESSION_CONFIGURATION,
  }
  const peerCount = Array.isArray(peers) ? peers.length : Object.keys(peers || {}).length
  if (peerCount > 0) options.peers = peers
  const session = await honcho.session(sessionIdFor(groupId), options)
  sessionCache.set(key, session)
  return session
}

async function scheduleDreams(honcho, session, observedPeerIds = []) {
  for (const observed of observedPeerIds.filter(Boolean)) {
    honcho.scheduleDream({ observer: ASSISTANT_PEER_ID, observed, session }).catch(() => {})
  }
}

async function collectSessionSummaries(session) {
  try {
    const summaries = await session.summaries()
    return [
      normalizeSummaryItem(summaries?.longSummary, 'long_summary'),
      normalizeSummaryItem(summaries?.shortSummary, 'short_summary'),
    ].filter(Boolean)
  } catch (err) {
    return { error: err?.message || String(err), items: [] }
  }
}

async function collectConclusions({ assistantPeer, groupPeer, memberPeer, session, limit = 40, includeAllPeers = false, extraMemberPeers = [] } = {}) {
  const rows = []
  const errors = []
  const seen = new Set()

  async function addScope(targetPeer, scope) {
    if (!targetPeer?.id || seen.has(`${scope}:${targetPeer.id}`)) return
    seen.add(`${scope}:${targetPeer.id}`)
    try {
      const page = await assistantPeer.conclusionsOf(targetPeer).list({ session, size: Math.min(Math.max(Number(limit || 40), 1), 100), reverse: true })
      rows.push(...pageItems(page).map(item => normalizeConclusionItem(item, scope)))
    } catch (err) {
      errors.push(`${targetPeer.id}: ${err?.message || err}`)
    }
  }

  await addScope(groupPeer, 'group')
  if (memberPeer) await addScope(memberPeer, 'member')
  for (const peer of extraMemberPeers || []) {
    if (!peer?.id || peer.id === memberPeer?.id || peer.id === groupPeer?.id || peer.id === ASSISTANT_PEER_ID) continue
    await addScope(peer, 'member')
  }

  if (includeAllPeers) {
    try {
      const peers = await session.peers()
      for (const peer of peers || []) {
        if (!peer?.id || peer.id === ASSISTANT_PEER_ID || peer.id === groupPeer?.id || peer.id === memberPeer?.id) continue
        await addScope(peer, 'member')
      }
    } catch (err) {
      errors.push(`peers: ${err?.message || err}`)
    }
  }

  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { items: rows.slice(0, Math.min(Math.max(Number(limit || 40), 1), 200)), errors }
}

async function getSessionQueueStatus(session) {
  try {
    return await session.queueStatus({ observer: ASSISTANT_PEER_ID })
  } catch {
    return null
  }
}

export function getWeChatGroupMemoryStatus() {
  const cfg = getHonchoConfig()
  if (!cfg.enabled) {
    return {
      provider: 'local',
      enabled: false,
      configured: true,
      environment: 'embedded',
      baseURL: '',
      workspaceId: 'bailongma-local-memory',
      appName: 'BaiLongma Local Memory',
      message: '使用内置本地群记忆引擎，无需 Docker/Honcho。',
    }
  }
  return {
    provider: 'honcho',
    enabled: !!cfg.enabled,
    configured: !!cfg.apiKey,
    environment: cfg.environment || 'local',
    baseURL: cfg.baseURL || '',
    workspaceId: cfg.workspaceId || cfg.appId || appIdCache || 'bailongma-wechat-memory',
    appName: cfg.appName || 'BaiLongma WeChat Memory',
  }
}

export async function recordWeChatGroupMessage({ groupId, groupName = '', senderId = '', senderName = '', text = '', mentionedSelf = false, source = 'wechaty', timestamp = nowTimestamp() } = {}) {
  const content = normalizeText(text)
  const gid = groupKey(groupId)
  const local = localRecordGroupMessage({ groupId, groupName, senderId, senderName, text, mentionedSelf, source, timestamp })
  const honcho = getClient()
  if (!honcho || !gid || !content) return { ...local, honcho: { ok: false, skipped: true, reason: 'honcho_not_configured' } }
  try { await ensureApp(honcho) } catch (err) { return { ...local, honcho: honchoUnavailableResult({ reason: 'honcho_unavailable' }) } }
  const groupPeerId = groupPeerIdFor(gid)
  const memberPeerId = memberPeerIdFor(senderId, senderName)
  const groupPeer = await ensurePeer(honcho, groupPeerId, { type: 'wechat_group', group_id: gid, group_name: groupName })
  const memberPeer = await ensurePeer(honcho, memberPeerId, { type: 'wechat_member', sender_id: senderId, sender_name: senderName, group_id: gid, group_name: groupName })
  const assistantPeer = await ensurePeer(honcho, ASSISTANT_PEER_ID, { type: 'assistant', name: '小白龙' })
  const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid, group_name: groupName, source }, [groupPeer, memberPeer, assistantPeer])
  const created = await session.addMessages(memberPeer.message(content, {
    metadata: { type: 'wechat_group_message', group_id: gid, group_name: groupName, sender_id: senderId, sender_name: senderName, mentioned_self: !!mentionedSelf, source, timestamp },
    createdAt: timestamp,
  }))
  scheduleDreams(honcho, session, [groupPeerId, memberPeerId])
  const honchoIds = created.map(item => item.id).filter(Boolean)
  try { if (local?.id) getDB().prepare(`UPDATE wechat_group_messages SET honcho_synced_at = ?, honcho_message_id = ? WHERE id = ?`).run(nowTimestamp(), honchoIds.join(','), local.id) } catch {}
  return { ok: true, provider: 'local+honcho', local, honcho: { ok: true, provider: 'honcho', workspaceId: appIdCache, sessionId: session.id, groupPeerId, memberPeerId, messageIds: honchoIds } }
}

export async function recordWeChatGroupAssistantReply({ groupId, groupName = '', reply = '', targetMemberName = '', source = 'wechaty', timestamp = nowTimestamp() } = {}) {
  const content = normalizeText(reply)
  const gid = groupKey(groupId)
  const local = localRecordGroupMessage({ groupId, groupName, senderId: ASSISTANT_PEER_ID, senderName: targetMemberName ? `小白龙 -> ${targetMemberName}` : '小白龙', text: content, mentionedSelf: false, source: `${source}:assistant`, timestamp })
  const honcho = getClient()
  if (!honcho || !gid || !content) return { ...local, honcho: { ok: false, skipped: true, reason: 'honcho_not_configured' } }
  try { await ensureApp(honcho) } catch (err) { return { ...local, honcho: honchoUnavailableResult({ reason: 'honcho_unavailable' }) } }
  const groupPeer = await ensurePeer(honcho, groupPeerIdFor(gid), { type: 'wechat_group', group_id: gid, group_name: groupName })
  const assistantPeer = await ensurePeer(honcho, ASSISTANT_PEER_ID, { type: 'assistant', name: '小白龙' })
  const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid, group_name: groupName, source }, [groupPeer, assistantPeer])
  const created = await session.addMessages(assistantPeer.message(content, { metadata: { type: 'assistant_reply', group_id: gid, group_name: groupName, target_member_name: targetMemberName, source, timestamp }, createdAt: timestamp }))
  scheduleDreams(honcho, session, [groupPeer.id])
  return { ok: true, provider: 'local+honcho', local, honcho: { ok: true, provider: 'honcho', workspaceId: appIdCache, sessionId: session.id, messageIds: created.map(item => item.id).filter(Boolean) } }
}

export async function createWeChatGroupManualMemory({ groupId, groupName = '', content = '', category = 'manual', senderId = '', senderName = '', canonicalMemberId = '' } = {}) {
  const body = normalizeText(content)
  const gid = groupKey(groupId)
  const local = localCreateMemory({ groupId, groupName, content, category, senderId, senderName, canonicalMemberId })
  const honcho = getClient()
  if (!honcho || !gid) return { ...local, honcho: { ok: false, provider: 'honcho', error: 'Honcho 未配置或未启用' } }
  if (!body) return { ok: false, provider: 'local+honcho', error: '记忆内容不能为空' }
  try { await ensureApp(honcho) } catch (err) { return { ...local, honcho: honchoUnavailableResult({ error: `Honcho 暂不可用：${err?.message || err}` }) } }
  const groupPeer = await ensurePeer(honcho, groupPeerIdFor(gid), { type: 'wechat_group', group_id: gid, group_name: groupName })
  const assistantPeer = await ensurePeer(honcho, ASSISTANT_PEER_ID, { type: 'assistant', name: '小白龙' })
  const memberPeer = senderId || senderName || canonicalMemberId ? await ensurePeer(honcho, memberPeerIdFor(canonicalMemberId || senderId, senderName), { type: 'wechat_member', canonical_member_id: canonicalMemberId, sender_id: senderId, sender_name: senderName, group_id: gid, group_name: groupName }) : null
  const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid, group_name: groupName, source: 'manual' }, [groupPeer, assistantPeer, ...(memberPeer ? [memberPeer] : [])])
  const target = memberPeer || groupPeer
  const created = await assistantPeer.conclusionsOf(target).create({ content: body, sessionId: session })
  return {
    ok: true,
    provider: 'local+honcho',
    workspaceId: appIdCache,
    sessionId: session.id,
    group_id: gid,
    category,
    items: created.map(item => normalizeConclusionItem(item, memberPeer ? 'member' : 'group')),
    local,
  }
}

export async function recordWeChatGroupExplicitMemories({ groupId, groupName = '', senderId = '', senderName = '', text = '', source = 'wechaty' } = {}) {
  const memories = extractWeChatExplicitMemories({ text, senderName, senderId })
  if (!memories.length) return { ok: true, skipped: true, count: 0, memories: [] }
  const written = []
  const errors = []
  for (const memory of memories) {
    try {
      const memberResult = await createWeChatGroupManualMemory({
        groupId,
        groupName,
        senderId,
        senderName,
        content: memory.content,
        category: memory.category || 'explicit',
      })
      written.push({ scope: 'member', category: memory.category, result: memberResult })
    } catch (err) {
      errors.push(`member:${err?.message || err}`)
    }
    if (memory.groupContent && memory.groupContent !== memory.content) {
      try {
        const groupResult = await createWeChatGroupManualMemory({
          groupId,
          groupName,
          content: memory.groupContent,
          category: memory.category || 'explicit',
        })
        written.push({ scope: 'group', category: memory.category, result: groupResult })
      } catch (err) {
        errors.push(`group:${err?.message || err}`)
      }
    }
  }
  return { ok: errors.length === 0, source, count: written.length, memories, written, errors }
}

export async function getWeChatGroupMemoryContext({ groupId, senderId = '', senderName = '', query = '', limit = 16 } = {}) {
  const gid = groupKey(groupId)
  const honcho = getClient()
  if (!honcho || !gid) return await getLocalGroupMemoryContext({ groupId, senderId, senderName, query, limit })
  try { await ensureApp(honcho) } catch (err) { return `${await getLocalGroupMemoryContext({ groupId, senderId, senderName, query, limit })}
<honcho-memory status="error">Honcho 暂不可用，已降级使用本地记忆：${normalizeText(err?.message || err)}</honcho-memory>` }
  const groupPeer = await ensurePeer(honcho, groupPeerIdFor(gid), { type: 'wechat_group', group_id: gid })
  const memberPeer = await ensurePeer(honcho, memberPeerIdFor(senderId, senderName), { type: 'wechat_member', sender_id: senderId, sender_name: senderName, group_id: gid })
  const assistantPeer = await ensurePeer(honcho, ASSISTANT_PEER_ID, { type: 'assistant', name: '小白龙' })
  const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid }, [groupPeer, memberPeer, assistantPeer])
  try {
    const page = await session.messages({ reverse: true, size: Math.min(Math.max(Number(limit || 16), 1), 60) })
    const rows = pageItems(page)
    const summariesResult = await collectSessionSummaries(session)
    const summaries = Array.isArray(summariesResult) ? summariesResult : []
    const conclusions = await collectConclusions({ assistantPeer, groupPeer, memberPeer, session, limit: 16, includeAllPeers: false })
    const sections = [
      formatHonchoConclusionsAsContext(conclusions.items),
      formatHonchoSummariesAsContext(summaries),
      formatHonchoMessagesAsContext(rows),
    ].filter(Boolean)
    if (!sections.length) return await getLocalGroupMemoryContext({ groupId, senderId, senderName, query, limit })
    return `<honcho-group-memory query="${normalizeText(query).slice(0, 120)}">\n${sections.join('\n')}\n</honcho-group-memory>`
  } catch (err) {
    return `${await getLocalGroupMemoryContext({ groupId, senderId, senderName, query, limit })}
<honcho-memory status="error">Honcho 读取失败，已降级使用本地记忆：${normalizeText(err?.message || err)}</honcho-memory>`
  }
}

export async function listWeChatGroupMemory({ groupId, groupName = '', limit = 80, includeAllPeers = true } = {}) {
  const gid = groupKey(groupId)
  const honcho = getClient()
  if (!honcho || !gid) return listLocalGroupMemory({ groupId, groupName, limit, includeAllPeers })
  try { await ensureApp(honcho) } catch (err) { const local = listLocalGroupMemory({ groupId, groupName, limit, includeAllPeers }); return { ...local, degraded: true, honcho: honchoUnavailableResult({ error: `Honcho 暂不可用：${err?.message || err}` }) } }
  const groupPeer = await ensurePeer(honcho, groupPeerIdFor(gid), { type: 'wechat_group', group_id: gid, group_name: groupName })
  const assistantPeer = await ensurePeer(honcho, ASSISTANT_PEER_ID, { type: 'assistant', name: '小白龙' })
  const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid, group_name: groupName }, [groupPeer, assistantPeer])
  const errors = []
  try {
    const size = Math.min(Math.max(Number(limit || 80), 1), 300)
    let messageRows = []
    let messageTotal = 0
    try {
      const page = await session.messages({ reverse: true, size })
      messageRows = pageItems(page).map(normalizeMessageItem)
      messageTotal = pageTotal(page, messageRows)
    } catch (err) {
      errors.push(`messages: ${err?.message || err}`)
    }

    const summaryResult = await collectSessionSummaries(session)
    const summaries = Array.isArray(summaryResult) ? summaryResult : []
    if (!Array.isArray(summaryResult) && summaryResult?.error) errors.push(`summaries: ${summaryResult.error}`)

    const extraMemberPeers = []
    if (includeAllPeers && messageRows.length) {
      const seenMembers = new Set()
      for (const row of messageRows) {
        const senderId = row?.metadata?.sender_id || ''
        const senderName = row?.metadata?.sender_name || row?.speaker || ''
        const memberPeerId = memberPeerIdFor(senderId, senderName)
        if (!senderId && !senderName) continue
        if (seenMembers.has(memberPeerId)) continue
        seenMembers.add(memberPeerId)
        try {
          extraMemberPeers.push(await ensurePeer(honcho, memberPeerId, { type: 'wechat_member', sender_id: senderId, sender_name: senderName, group_id: gid, group_name: groupName }))
        } catch (err) {
          errors.push(`member-peer:${senderName || senderId}: ${err?.message || err}`)
        }
      }
    }

    const conclusionsResult = await collectConclusions({ assistantPeer, groupPeer, session, limit: size, includeAllPeers, extraMemberPeers })
    const conclusions = conclusionsResult.items || []
    if (conclusionsResult.errors?.length) errors.push(...conclusionsResult.errors.map(err => `conclusions: ${err}`))

    const queue = await getSessionQueueStatus(session)
    return {
      ok: true,
      provider: 'honcho',
      workspaceId: appIdCache,
      group_id: gid,
      group_name: groupName,
      groupPeerId: groupPeer.id,
      sessionId: session.id,
      items: messageRows,
      messages: messageRows,
      conclusions,
      summaries,
      counts: {
        messages: messageRows.length,
        totalMessages: messageTotal,
        conclusions: conclusions.length,
        summaries: summaries.length,
      },
      queue,
      errors,
    }
  } catch (err) {
    return { ok: false, provider: 'honcho', items: [], messages: [], conclusions: [], summaries: [], error: err?.message || String(err), workspaceId: appIdCache, group_id: gid, sessionId: session?.id || '' }
  }
}

export async function listWeChatGroupMemoryOverview({ groups = [], limit = 20 } = {}) {
  const honcho = getClient()
  const unique = []
  const seen = new Set()
  for (const group of groups || []) {
    const rawId = group?.id || group?.groupId || group?.group_id || group?.topic || group?.name || ''
    const id = rawId && !String(rawId).startsWith('wechaty:') && group?.id ? `wechaty:${rawId}` : String(rawId || '')
    const gid = groupKey(id)
    if (!gid || seen.has(gid)) continue
    seen.add(gid)
    unique.push({ id, gid, topic: group?.topic || group?.name || group?.groupName || group?.group_name || gid, selected: group?.selected === true })
  }
  if (!honcho) {
    const rows = unique.slice(0, 50).map(group => {
      const detail = listLocalGroupMemory({ groupId: group.id || group.gid, groupName: group.topic, limit, includeAllPeers: false })
      return {
        id: group.id || group.gid,
        group_id: detail.group_id || group.gid,
        group_name: group.topic,
        selected: group.selected,
        ok: detail.ok,
        sessionId: `local:${detail.group_id || group.gid}`,
        counts: detail.counts || { messages: 0, conclusions: 0, summaries: 0 },
        latest: (detail.messages || [])[0] || (detail.conclusions || [])[0] || null,
        errors: detail.errors || (detail.error ? [detail.error] : []),
      }
    })
    return { ok: true, provider: 'local', workspaceId: 'bailongma-local-memory', groups: rows, degraded: false }
  }
  const rows = []
  for (const group of unique.slice(0, 50)) {
    const detail = await listWeChatGroupMemory({ groupId: group.id || group.gid, groupName: group.topic, limit, includeAllPeers: false })
    rows.push({
      id: group.id || group.gid,
      group_id: detail.group_id || group.gid,
      group_name: group.topic,
      selected: group.selected,
      ok: detail.ok,
      sessionId: detail.sessionId,
      counts: detail.counts || { messages: 0, conclusions: 0, summaries: 0 },
      latest: (detail.messages || [])[0] || (detail.conclusions || [])[0] || null,
      errors: detail.errors || (detail.error ? [detail.error] : []),
    })
  }
  return { ok: true, provider: 'honcho', workspaceId: appIdCache, groups: rows }
}

export async function deleteWeChatGroupMemory({ groupId, kind = '', itemId = '', observerId = ASSISTANT_PEER_ID, observedId = '' } = {}) {
  const gid = groupKey(groupId)
  const honcho = getClient()
  const normalizedKind = String(kind || '').trim().toLowerCase()
  if (!honcho || !gid) {
    if (!gid) return { ok: false, provider: 'local', error: '缺少群 ID' }
    ensureLocalMemorySchema()
    const db = getDB()
    if (normalizedKind === 'session' || normalizedKind === 'group' || normalizedKind === 'all') {
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM wechat_group_messages WHERE group_id = ?`).run(gid)
        db.prepare(`DELETE FROM wechat_group_memory_items WHERE group_id = ?`).run(gid)
      })
      tx()
      return { ok: true, provider: 'local', deleted: 'group', group_id: gid }
    }
    if (normalizedKind === 'conclusion') {
      const id = String(itemId || '').trim()
      if (!id) return { ok: false, provider: 'local', error: 'conclusion id required' }
      const info = db.prepare(`UPDATE wechat_group_memory_items SET status='deleted', updated_at=? WHERE id=? AND group_id=?`).run(nowTimestamp(), id, gid)
      return { ok: info.changes > 0, provider: 'local', deleted: 'conclusion', id, group_id: gid }
    }
    return { ok: false, provider: 'local', error: '当前只支持删除结论记忆或清空本群本地记忆。' }
  }
  try { await ensureApp(honcho) } catch (err) { return honchoUnavailableResult({ error: `Honcho 暂不可用：${err?.message || err}` }) }
  const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid }, [])
  if (normalizedKind === 'session' || normalizedKind === 'group' || normalizedKind === 'all') {
    await session.delete()
    sessionCache.delete(gid)
    return { ok: true, provider: 'honcho', deleted: 'session', group_id: gid, sessionId: session.id }
  }
  if (normalizedKind === 'conclusion') {
    const id = String(itemId || '').trim()
    if (!id) return { ok: false, provider: 'honcho', error: 'conclusion id required' }
    const observerPeer = await ensurePeer(honcho, observerId || ASSISTANT_PEER_ID, { type: 'assistant' })
    const targetObservedId = observedId || groupPeerIdFor(gid)
    await observerPeer.conclusionsOf(targetObservedId).delete(id)
    return { ok: true, provider: 'honcho', deleted: 'conclusion', id, group_id: gid }
  }
  return { ok: false, provider: 'honcho', error: '当前只支持删除 Honcho 结论记忆或清空本群 session；原始消息不支持单条删除。' }
}

export function backfillLocalWeChatMemoryEmbeddings({ limit = 2000 } = {}) {
  ensureLocalMemorySchema()
  const db = getDB()
  const max = Math.min(Math.max(Number(limit || 2000), 1), 10000)
  let messages = 0
  let memories = 0
  const messageRows = db.prepare(`SELECT id, group_name, member_name, content FROM wechat_group_messages WHERE embedding IS NULL AND content <> '' ORDER BY id DESC LIMIT ?`).all(max)
  const memoryRows = db.prepare(`SELECT id, group_name, member_name, category, content FROM wechat_group_memory_items WHERE embedding IS NULL AND content <> '' ORDER BY id DESC LIMIT ?`).all(max)
  const tx = db.transaction(() => {
    for (const row of messageRows) {
      db.prepare(`UPDATE wechat_group_messages SET embedding = ? WHERE id = ?`).run(localHashEmbeddingBuffer(`${row.group_name || ''} ${row.member_name || ''}: ${row.content || ''}`), row.id)
      messages += 1
    }
    for (const row of memoryRows) {
      db.prepare(`UPDATE wechat_group_memory_items SET embedding = ? WHERE id = ?`).run(localHashEmbeddingBuffer(`${row.group_name || ''} ${row.member_name || ''} ${row.category || ''}: ${row.content || ''}`), row.id)
      memories += 1
    }
  })
  tx()
  return { ok: true, provider: 'local-hash', messages, memories }
}

export async function backfillWeChatExplicitMemoriesFromMessages({ limit = 5000, archiveMessages = true } = {}) {
  ensureLocalMemorySchema()
  const db = getDB()
  const max = Math.min(Math.max(Number(limit || 5000), 1), 20000)
  const rows = db.prepare(`
    SELECT id, group_id, group_name, member_id, member_name, canonical_member_id, content, source
    FROM wechat_group_messages
    WHERE content <> ''
    ORDER BY id ASC LIMIT ?
  `).all(max)
  let scanned = 0
  let extracted = 0
  let archived = 0
  let utteranceArchived = 0
  let personaSummaries = 0
  let personaUpdated = 0
  let deduped = 0
  let skipped = 0
  const errors = []
  const personaBuckets = new Map()
  for (const row of rows) {
    scanned += 1
    const memories = extractWeChatExplicitMemories({ text: row.content, senderName: row.member_name, senderId: row.member_id })
    const identity = row.member_id || row.member_name
      ? resolveLocalMemberIdentity({ groupId: row.group_id, groupName: row.group_name, senderId: row.member_id, senderName: row.member_name, canonicalMemberId: row.canonical_member_id || '', source: 'local-backfill-persona' })
      : { canonical_member_id: row.canonical_member_id || '', display_name: row.member_name || '', sender_id: row.member_id || '' }
    if (archiveMessages && identity.canonical_member_id && shouldArchiveMemberUtterance(row.content)) {
      const key = `${row.group_id}::${identity.canonical_member_id}`
      const bucket = personaBuckets.get(key) || { groupId: row.group_id, groupName: row.group_name, senderId: identity.sender_id || row.member_id, senderName: identity.display_name || row.member_name, canonicalMemberId: identity.canonical_member_id, messages: [] }
      bucket.messages.push(row.content)
      personaBuckets.set(key, bucket)
    }
    if (memories.length) {
      try {
        const result = await recordWeChatGroupExplicitMemories({
          groupId: row.group_id,
          groupName: row.group_name,
          senderId: row.member_id,
          senderName: row.member_name,
          text: row.content,
          source: row.source || 'local-backfill',
        })
        extracted += Number(result?.count || memories.length || 0)
      } catch (err) {
        errors.push(`${row.id}: ${err?.message || err}`)
        if (errors.length >= 20) break
      }
    }
    if (!archiveMessages) {
      if (!memories.length) skipped += 1
      continue
    }
    const stableFact = shouldAutoArchiveMemberMessage(row.content)
    const utterance = shouldArchiveMemberUtterance(row.content)
    if (!stableFact && !utterance) {
      if (!memories.length) skipped += 1
      continue
    }
    try {
      const result = localCreateMemory({
        groupId: row.group_id,
        groupName: row.group_name,
        senderId: identity.sender_id || row.member_id,
        senderName: identity.display_name || row.member_name,
        canonicalMemberId: identity.canonical_member_id || row.canonical_member_id || '',
        content: stableFact
          ? autoMemberMemoryContent({ memberName: identity.display_name || row.member_name || row.member_id, content: row.content })
          : memberUtteranceMemoryContent({ memberName: identity.display_name || row.member_name || row.member_id, content: row.content }),
        category: stableFact ? 'auto_member_fact' : 'member_utterance',
        sourceText: row.content,
        sourceMessageId: row.id,
        salience: stableFact ? (memories.length ? 3 : 2) : 1,
      })
      if (result?.deduped) deduped += 1
      else if (result?.ok) {
        if (stableFact) archived += 1
        else utteranceArchived += 1
      }
      else skipped += 1
    } catch (err) {
      errors.push(`${row.id}: ${err?.message || err}`)
      if (errors.length >= 20) break
    }
  }
  if (archiveMessages && errors.length < 20) {
    for (const bucket of personaBuckets.values()) {
      if (!bucket.messages.length) continue
      try {
        const content = buildMemberPersonaSummary({ memberName: bucket.senderName || bucket.senderId, messages: bucket.messages })
        if (!content) continue
        const result = upsertMemberPersonaSummary({ ...bucket, content })
        if (result?.updated) personaUpdated += 1
        else if (result?.ok) personaSummaries += 1
      } catch (err) {
        errors.push(`persona:${bucket.groupId}:${bucket.senderName || bucket.senderId}: ${err?.message || err}`)
        if (errors.length >= 20) break
      }
    }
  }
  return { ok: errors.length === 0, provider: 'local+honcho', scanned, extracted, archived, utterance_archived: utteranceArchived, persona_summaries: personaSummaries, persona_updated: personaUpdated, deduped, skipped, errors }
}


export async function syncLocalWeChatMessagesToHoncho({ limit = 300 } = {}) {
  ensureLocalMemorySchema()
  const honcho = getClient()
  if (!honcho) return { ok: false, provider: 'honcho', error: 'Honcho 未配置或未启用' }
  try { await ensureApp(honcho) } catch (err) { return honchoUnavailableResult({ error: `Honcho 暂不可用：${err?.message || err}` }) }
  const db = getDB()
  const rows = db.prepare(`
    SELECT * FROM wechat_group_messages
    WHERE COALESCE(honcho_synced_at, '') = '' AND content <> ''
    ORDER BY timestamp ASC, id ASC
    LIMIT ?
  `).all(Math.min(Math.max(Number(limit || 300), 1), 2000))
  let synced = 0
  const errors = []
  for (const row of rows) {
    try {
      const gid = groupKey(row.group_id)
      const groupPeerId = groupPeerIdFor(gid)
      const memberPeerId = memberPeerIdFor(row.member_id, row.member_name)
      const groupPeer = await ensurePeer(honcho, groupPeerId, { type: 'wechat_group', group_id: gid, group_name: row.group_name })
      const memberPeer = await ensurePeer(honcho, memberPeerId, { type: 'wechat_member', sender_id: row.member_id, sender_name: row.member_name, group_id: gid, group_name: row.group_name })
      const assistantPeer = await ensurePeer(honcho, ASSISTANT_PEER_ID, { type: 'assistant', name: '小白龙' })
      const session = await ensureSession(honcho, gid, { type: 'wechat_group_session', group_id: gid, group_name: row.group_name, source: 'local-backfill' }, [groupPeer, memberPeer, assistantPeer])
      const created = await session.addMessages(memberPeer.message(row.content, { metadata: { type: 'wechat_group_message', local_message_id: row.id, group_id: gid, group_name: row.group_name, sender_id: row.member_id, sender_name: row.member_name, mentioned_self: !!row.mentioned_self, source: row.source || 'local-backfill', timestamp: row.timestamp }, createdAt: row.timestamp }))
      const ids = created.map(item => item.id).filter(Boolean).join(',')
      db.prepare(`UPDATE wechat_group_messages SET honcho_synced_at = ?, honcho_message_id = ? WHERE id = ?`).run(nowTimestamp(), ids, row.id)
      synced += 1
    } catch (err) {
      errors.push(`${row.id}: ${err?.message || err}`)
      if (errors.length >= 10) break
    }
  }
  return { ok: errors.length === 0, provider: 'honcho', scanned: rows.length, synced, errors }
}
