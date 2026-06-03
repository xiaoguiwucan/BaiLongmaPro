import fs from 'fs'
import path from 'path'
import { getDB } from './db.js'
import { paths } from './paths.js'
import { getHonchoConfig, getEmbeddingConfig } from './config.js'

function fileSize(filePath = '') {
  try { return fs.statSync(filePath).size || 0 } catch { return 0 }
}

function dirSize(dir = '') {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) total += dirSize(full)
      else total += fileSize(full)
    }
  } catch {}
  return total
}

function countTable(db, table) {
  try { return Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`).get()?.n || 0) } catch { return 0 }
}

function getDbstatSizes(db) {
  try {
    const rows = db.prepare(`SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name`).all()
    return new Map(rows.map(row => [String(row.name || ''), Number(row.bytes || 0)]))
  } catch {
    return new Map()
  }
}

function getTables(db) {
  const statSizes = getDbstatSizes(db)
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name COLLATE NOCASE ASC
  `).all().map(row => String(row.name || '')).filter(Boolean)
  return tables.map(name => ({ name, rows: countTable(db, name), bytes: statSizes.get(name) || 0 }))
}

function getScalar(db, sql, fallback = 0) {
  try { return Number(Object.values(db.prepare(sql).get() || {})[0] || fallback) } catch { return fallback }
}

function getMemberIdentityStats(db) {
  const empty = {
    rawRows: 0,
    effectiveNicknames: 0,
    uniqueSenderIds: 0,
    uniqueWxids: 0,
    duplicatedNicknameRows: 0,
    groups: [],
    duplicateExamples: [],
  }
  try {
    const rawRows = getScalar(db, 'SELECT COUNT(*) FROM wechat_group_member_names')
    const effectiveNicknames = getScalar(db, `
      SELECT COUNT(*) FROM (
        SELECT group_name, display_name
        FROM wechat_group_member_names
        WHERE TRIM(display_name) <> ''
        GROUP BY group_name, display_name
      )
    `)
    const uniqueSenderIds = getScalar(db, "SELECT COUNT(DISTINCT sender_id) FROM wechat_group_member_names WHERE TRIM(sender_id) <> ''")
    const uniqueWxids = getScalar(db, "SELECT COUNT(DISTINCT wxid) FROM wechat_group_member_names WHERE TRIM(wxid) <> ''")
    const duplicatedNicknameRows = Math.max(rawRows - effectiveNicknames, 0)
    const groups = db.prepare(`
      SELECT
        group_name,
        COUNT(*) AS raw_rows,
        COUNT(DISTINCT display_name) AS effective_nicknames,
        COUNT(DISTINCT sender_id) AS unique_sender_ids,
        COUNT(DISTINCT CASE WHEN TRIM(wxid) <> '' THEN wxid END) AS unique_wxids,
        MAX(last_seen) AS last_seen
      FROM wechat_group_member_names
      GROUP BY group_name
      ORDER BY raw_rows DESC, group_name COLLATE NOCASE ASC
      LIMIT 30
    `).all()
    const duplicateExamples = db.prepare(`
      SELECT group_name, display_name, COUNT(*) AS raw_rows, COUNT(DISTINCT sender_id) AS sender_ids, MAX(last_seen) AS last_seen
      FROM wechat_group_member_names
      WHERE TRIM(display_name) <> ''
      GROUP BY group_name, display_name
      HAVING raw_rows > 1
      ORDER BY raw_rows DESC, last_seen DESC
      LIMIT 12
    `).all()
    return { rawRows, effectiveNicknames, uniqueSenderIds, uniqueWxids, duplicatedNicknameRows, groups, duplicateExamples }
  } catch {
    return empty
  }
}

function normalizeText(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function localHashEmbeddingBuffer(text = '') {
  const dims = 384
  const vec = new Float32Array(dims)
  const value = normalizeText(text).toLowerCase()
  for (let i = 0; i < value.length; i++) {
    const gram = value.slice(i, i + 2)
    let h = 2166136261
    for (let j = 0; j < gram.length; j++) {
      h ^= gram.charCodeAt(j)
      h = Math.imul(h, 16777619)
    }
    vec[Math.abs(h) % dims] += 1
  }
  let norm = 0
  for (const n of vec) norm += n * n
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm
  return Buffer.from(vec.buffer)
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

function safeRow(row = {}) {
  const copy = { ...row }
  delete copy.embedding
  return copy
}

export function backfillDatabaseVectors({ limit = 5000 } = {}) {
  const db = getDB()
  const max = Math.min(Math.max(Number(limit || 5000), 1), 20000)
  const result = { ok: true, provider: 'local-hash', coreMemories: 0, groupMessages: 0, groupMemoryItems: 0 }
  const coreRows = db.prepare(`
    SELECT id, mem_id, title, content, detail, concepts
    FROM memories
    WHERE embedding IS NULL AND COALESCE(content, '') <> '' AND visibility = 1
    ORDER BY id DESC LIMIT ?
  `).all(max)
  const groupRows = db.prepare(`
    SELECT id, group_name, member_name, content
    FROM wechat_group_messages
    WHERE embedding IS NULL AND COALESCE(content, '') <> ''
    ORDER BY id DESC LIMIT ?
  `).all(max)
  const itemRows = db.prepare(`
    SELECT id, group_name, member_name, category, content
    FROM wechat_group_memory_items
    WHERE embedding IS NULL AND COALESCE(content, '') <> ''
    ORDER BY id DESC LIMIT ?
  `).all(max)
  const tx = db.transaction(() => {
    for (const row of coreRows) {
      db.prepare(`UPDATE memories SET embedding = ? WHERE id = ?`).run(localHashEmbeddingBuffer(`${row.title || ''} ${row.content || ''} ${row.detail || ''} ${row.concepts || ''}`), row.id)
      result.coreMemories += 1
    }
    for (const row of groupRows) {
      db.prepare(`UPDATE wechat_group_messages SET embedding = ? WHERE id = ?`).run(localHashEmbeddingBuffer(`${row.group_name || ''} ${row.member_name || ''}: ${row.content || ''}`), row.id)
      result.groupMessages += 1
    }
    for (const row of itemRows) {
      db.prepare(`UPDATE wechat_group_memory_items SET embedding = ? WHERE id = ?`).run(localHashEmbeddingBuffer(`${row.group_name || ''} ${row.member_name || ''} ${row.category || ''}: ${row.content || ''}`), row.id)
      result.groupMemoryItems += 1
    }
  })
  tx()
  return result
}

export function searchDatabaseData({ q = '', groupId = '', groupName = '', limit = 30 } = {}) {
  const db = getDB()
  const query = normalizeText(q)
  const size = Math.min(Math.max(Number(limit || 30), 1), 100)
  if (!query) return { ok: false, error: '请输入搜索内容', items: [] }
  const whereGroup = []
  const params = []
  if (groupId) { whereGroup.push('group_id = ?'); params.push(groupId) }
  if (groupName) { whereGroup.push('group_name = ?'); params.push(groupName) }
  const groupSql = whereGroup.length ? ` AND (${whereGroup.join(' OR ')})` : ''
  const like = `%${query}%`
  const keywordMessages = db.prepare(`
    SELECT 'wechat_group_message' AS source_type, id, group_id, group_name, member_id, member_name, content, timestamp AS created_at, 1.0 AS score
    FROM wechat_group_messages
    WHERE content LIKE ? ${groupSql}
    ORDER BY timestamp DESC, id DESC LIMIT ?
  `).all(like, ...params, size)
  const keywordItems = db.prepare(`
    SELECT 'wechat_group_memory' AS source_type, id, group_id, group_name, member_id, member_name, content, updated_at AS created_at, 1.0 AS score
    FROM wechat_group_memory_items
    WHERE status='active' AND content LIKE ? ${groupSql}
    ORDER BY salience DESC, updated_at DESC LIMIT ?
  `).all(like, ...params, Math.ceil(size / 2))
  let keywordMedia = []
  try {
    keywordMedia = db.prepare(`
      SELECT 'wechat_image_description' AS source_type, id, group_id, group_name, sender_id AS member_id, sender_name AS member_name, description AS content, described_at AS created_at, 1.0 AS score
      FROM wechat_group_media_items
      WHERE description <> '' AND description LIKE ? ${groupSql}
      ORDER BY described_at DESC, id DESC LIMIT ?
    `).all(like, ...params, Math.ceil(size / 2))
  } catch {}
  const qbuf = localHashEmbeddingBuffer(query)
  const vectorMessages = db.prepare(`
    SELECT 'wechat_group_message' AS source_type, * FROM wechat_group_messages
    WHERE embedding IS NOT NULL ${groupSql}
    ORDER BY id DESC LIMIT 1800
  `).all(...params)
    .map(row => ({ ...safeRow(row), score: cosineSimilarityBuffer(qbuf, row.embedding), created_at: row.timestamp || row.created_at }))
    .filter(row => row.score > 0.12)
  const vectorItems = db.prepare(`
    SELECT 'wechat_group_memory' AS source_type, * FROM wechat_group_memory_items
    WHERE status='active' AND embedding IS NOT NULL ${groupSql}
    ORDER BY id DESC LIMIT 1800
  `).all(...params)
    .map(row => ({ ...safeRow(row), score: cosineSimilarityBuffer(qbuf, row.embedding), created_at: row.updated_at || row.created_at }))
    .filter(row => row.score > 0.12)
  const merged = new Map()
  for (const row of [...keywordMessages, ...keywordItems, ...keywordMedia, ...vectorMessages, ...vectorItems]) {
    const key = `${row.source_type}:${row.id}`
    const old = merged.get(key)
    if (!old || Number(row.score || 0) > Number(old.score || 0)) merged.set(key, safeRow(row))
  }
  const items = [...merged.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, size)
  return { ok: true, q: query, count: items.length, items }
}

export async function getHonchoHealth() {
  const cfg = getHonchoConfig()
  if (!cfg.enabled || !cfg.baseURL) return { ok: false, enabled: !!cfg.enabled, error: 'Honcho 未启用或未配置 baseURL' }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`${String(cfg.baseURL).replace(/\/+$/, '')}/health`, { signal: controller.signal })
    clearTimeout(timer)
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, body: text.slice(0, 200) }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

const EXPORT_TABLES = [
  'wechat_group_activity',
  'wechat_group_messages',
  'wechat_group_memory_items',
  'wechat_group_member_names',
  'wechat_group_media_items',
  'knowledge_sources',
  'knowledge_source_groups',
  'knowledge_chunks',
  'knowledge_import_jobs',
  'memories',
]

export function exportDatabaseData({ tables = EXPORT_TABLES } = {}) {
  const db = getDB()
  const selected = (Array.isArray(tables) && tables.length ? tables : EXPORT_TABLES).filter(t => EXPORT_TABLES.includes(t))
  const data = {}
  for (const table of selected) {
    try {
      data[table] = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all().map(row => {
        const out = { ...row }
        for (const [key, value] of Object.entries(out)) {
          if (Buffer.isBuffer(value)) out[key] = { __bailongma_blob_base64: value.toString('base64') }
        }
        return out
      })
    } catch { data[table] = [] }
  }
  return { ok: true, exportedAt: new Date().toISOString(), version: 1, tables: data }
}

export function importDatabaseData(payload = {}) {
  const db = getDB()
  const tables = payload?.tables && typeof payload.tables === 'object' ? payload.tables : {}
  const result = {}
  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(tables)) {
      if (!EXPORT_TABLES.includes(table) || !Array.isArray(rows) || !rows.length) continue
      const existingCols = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all().map(c => c.name)
      const cols = existingCols.filter(c => c !== 'id')
      let inserted = 0
      for (const row of rows) {
        try {
          if (table === 'wechat_group_messages') {
            const exists = db.prepare(`SELECT 1 FROM wechat_group_messages WHERE group_id=? AND member_id=? AND timestamp=? AND content=? LIMIT 1`).get(row.group_id || '', row.member_id || '', row.timestamp || '', row.content || '')
            if (exists) continue
          } else if (table === 'wechat_group_activity') {
            const exists = db.prepare(`SELECT 1 FROM wechat_group_activity WHERE group_id=? AND sender_id=? AND timestamp=? AND raw_text=? LIMIT 1`).get(row.group_id || '', row.sender_id || '', row.timestamp || '', row.raw_text || '')
            if (exists) continue
          } else if (table === 'wechat_group_memory_items') {
            const exists = db.prepare(`SELECT 1 FROM wechat_group_memory_items WHERE group_id=? AND member_id=? AND category=? AND content=? LIMIT 1`).get(row.group_id || '', row.member_id || '', row.category || '', row.content || '')
            if (exists) continue
          } else if (table === 'memories' && row.mem_id) {
            const exists = db.prepare(`SELECT 1 FROM memories WHERE mem_id=? LIMIT 1`).get(row.mem_id)
            if (exists) continue
          }
        } catch {}
        const values = cols.map(c => {
          const value = row[c]
          if (value && typeof value === 'object' && value.__bailongma_blob_base64) {
            try { return Buffer.from(String(value.__bailongma_blob_base64), 'base64') } catch { return null }
          }
          return value ?? null
        })
        try {
          const info = db.prepare(`INSERT OR IGNORE INTO "${table.replace(/"/g, '""')}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values)
          inserted += Number(info.changes || 0)
        } catch {}
      }
      result[table] = { received: rows.length, inserted }
    }
  })
  tx()
  return { ok: true, importedAt: new Date().toISOString(), result }
}

export async function getDatabaseOverview() {
  const db = getDB()
  const dbFile = paths.dbFile
  const walFile = `${dbFile}-wal`
  const shmFile = `${dbFile}-shm`
  const archiveDb = path.join(paths.sandboxDir, 'wechat-group-archive.db')
  const generatedImagesDir = path.join(paths.dataDir, 'generated-images')
  const wechatMediaDir = path.join(paths.dataDir, 'wechat-media')
  const tables = getTables(db)
  const totals = {
    jarvisDbBytes: fileSize(dbFile),
    walBytes: fileSize(walFile),
    shmBytes: fileSize(shmFile),
    archiveDbBytes: fileSize(archiveDb),
    generatedImagesBytes: dirSize(generatedImagesDir),
    wechatMediaBytes: dirSize(wechatMediaDir),
  }
  totals.totalBytes = Object.values(totals).reduce((sum, value) => sum + Number(value || 0), 0)
  const memberIdentityStats = getMemberIdentityStats(db)
  const categories = [
    { key: 'chat_records', name: '微信群聊天记录', rows: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_activity'), tables: ['wechat_group_activity'], bytes: tables.filter(t => t.name === 'wechat_group_activity').reduce((s, t) => s + t.bytes, 0) },
    { key: 'group_memory', name: '微信群知识库/记忆', rows: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_memory_items') + getScalar(db, 'SELECT COUNT(*) FROM wechat_group_messages'), tables: ['wechat_group_memory_items', 'wechat_group_messages'], bytes: tables.filter(t => ['wechat_group_memory_items', 'wechat_group_messages'].includes(t.name)).reduce((s, t) => s + t.bytes, 0) },
    { key: 'core_memory', name: '核心长期记忆', rows: getScalar(db, 'SELECT COUNT(*) FROM memories WHERE visibility=1'), tables: ['memories', 'memories_fts'], bytes: tables.filter(t => t.name.startsWith('memories')).reduce((s, t) => s + t.bytes, 0) },
    { key: 'members', name: '微信群成员/昵称', rows: memberIdentityStats.effectiveNicknames, rawRows: memberIdentityStats.rawRows, subtitle: `${memberIdentityStats.effectiveNicknames} 个昵称 / ${memberIdentityStats.rawRows} 条历史身份记录`, tables: ['wechat_group_member_names'], bytes: tables.filter(t => t.name === 'wechat_group_member_names').reduce((s, t) => s + t.bytes, 0) },
    { key: 'media', name: '图片/媒体文件', rows: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_media_items'), tables: ['wechat_group_media_items'], bytes: totals.generatedImagesBytes + totals.wechatMediaBytes + tables.filter(t => t.name === 'wechat_group_media_items').reduce((s, t) => s + t.bytes, 0) },
  ]
  const embeddingConfig = getEmbeddingConfig()
  const honchoConfig = getHonchoConfig()
  const vectorStats = {
    coreMemoryEmbedded: getScalar(db, 'SELECT COUNT(*) FROM memories WHERE embedding IS NOT NULL'),
    coreMemoryTotal: getScalar(db, 'SELECT COUNT(*) FROM memories WHERE visibility=1'),
    groupMessagesEmbedded: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_messages WHERE embedding IS NOT NULL'),
    groupMessagesTotal: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_messages'),
    groupMemoryEmbedded: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_memory_items WHERE embedding IS NOT NULL'),
    groupMemoryTotal: getScalar(db, "SELECT COUNT(*) FROM wechat_group_memory_items WHERE status='active'"),
    configured: !!embeddingConfig.configured,
    provider: embeddingConfig.provider || '',
    model: embeddingConfig.model || '',
    localFallback: true,
  }
  const honcho = {
    enabled: !!honchoConfig.enabled,
    configured: !!honchoConfig.apiKey,
    environment: honchoConfig.environment || 'local',
    baseURL: honchoConfig.baseURL || '',
    health: await getHonchoHealth(),
    localMessages: getScalar(db, 'SELECT COUNT(*) FROM wechat_group_messages'),
    syncedMessages: getScalar(db, "SELECT COUNT(*) FROM wechat_group_messages WHERE COALESCE(honcho_synced_at, '') <> ''"),
    pendingMessages: getScalar(db, "SELECT COUNT(*) FROM wechat_group_messages WHERE COALESCE(honcho_synced_at, '') = ''"),
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    paths: { userDir: paths.userDir, dbFile, archiveDb, generatedImagesDir, wechatMediaDir },
    totals,
    categories,
    memberIdentityStats,
    vectorStats,
    honcho,
    tables: tables.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)),
  }
}
