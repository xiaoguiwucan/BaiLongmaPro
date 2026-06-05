import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDB } from '../db.js'
import { paths } from '../paths.js'
import { nowTimestamp } from '../time.js'
import { ensureWeChatGroupStatsSchemaForBackup, backfillWeChatGroupMemoryIndex } from './wechat-group-stats.js'
import { ensureLocalWeChatGroupMemorySchemaForBackup, backfillLocalWeChatMemoryIndex } from './wechat-group-memory.js'
import { ensureWeChatImageVisionSchemaForBackup } from './wechat-image-vision.js'

export const WECHAT_GROUP_BACKUP_FORMAT = 'bailongma.wechat_group_backup'
export const WECHAT_GROUP_BACKUP_SCHEMA_VERSION = 1
export const WECHAT_GROUP_BACKUP_BODY_LIMIT_BYTES = 300 * 1024 * 1024

const MAX_MEDIA_FILE_BYTES = 20 * 1024 * 1024
const MAX_IMPORT_ERRORS = 30

const GROUP_TABLES = [
  { key: 'activity', table: 'wechat_group_activity', time: 'timestamp' },
  { key: 'messages', table: 'wechat_group_messages', time: 'timestamp' },
  { key: 'memory_items', table: 'wechat_group_memory_items', time: 'updated_at' },
  { key: 'member_names', table: 'wechat_group_member_names', time: 'last_seen' },
  { key: 'member_identities', table: 'wechat_member_identities', time: 'last_seen' },
  { key: 'member_identity_aliases', table: 'wechat_member_identity_aliases', time: 'last_seen' },
  { key: 'media_items', table: 'wechat_group_media_items', time: 'created_at' },
]
const GROUP_KEYS = GROUP_TABLES.map(item => item.key)

const EXPORT_COLUMNS = {
  wechat_group_activity: [
    'id', 'group_id', 'group_name', 'sender_id', 'sender_name', 'message_type',
    'display_text', 'raw_text', 'raw_text_full', 'text_length', 'image_count',
    'emoji_count', 'link_count', 'brag_score', 'mentioned_self', 'source',
    'timestamp', 'created_at',
  ],
  wechat_group_messages: [
    'id', 'group_id', 'group_external_id', 'group_name', 'member_id', 'member_name',
    'canonical_member_id', 'content', 'mentioned_self', 'source', 'timestamp', 'created_at',
  ],
  wechat_group_memory_items: [
    'id', 'group_id', 'group_external_id', 'group_name', 'member_id', 'member_name',
    'canonical_member_id', 'category', 'title', 'content', 'status', 'salience',
    'source_message_id', 'source_text', 'created_at', 'updated_at',
  ],
  wechat_group_member_names: [
    'id', 'group_id', 'group_name', 'sender_id', 'display_name', 'room_alias',
    'contact_alias', 'contact_name', 'wechat_id', 'wxid', 'stable_key',
    'raw_identity', 'source', 'first_seen', 'last_seen',
  ],
  wechat_member_identities: [
    'canonical_member_id', 'group_id', 'group_name', 'display_name', 'stable_key',
    'wxid', 'wechat_id', 'aliases', 'confidence', 'first_seen', 'last_seen',
  ],
  wechat_member_identity_aliases: [
    'id', 'canonical_member_id', 'group_id', 'sender_id', 'display_name',
    'room_alias', 'contact_alias', 'contact_name', 'stable_key', 'wxid',
    'wechat_id', 'source', 'first_seen', 'last_seen',
  ],
  wechat_group_media_items: [
    'id', 'group_id', 'group_name', 'sender_id', 'sender_name', 'message_type',
    'relative_path', 'file_name', 'mime_type', 'bytes', 'sha256', 'base64',
    'description', 'labels_json', 'vision_status', 'vision_provider',
    'vision_model', 'vision_error', 'source_text', 'described_at',
    'created_at', 'updated_at',
  ],
}

function ensureSchemas() {
  ensureWeChatGroupStatsSchemaForBackup()
  ensureLocalWeChatGroupMemorySchemaForBackup()
  ensureWeChatImageVisionSchemaForBackup()
  ensureBackupLedgerSchema()
}

function ensureBackupLedgerSchema() {
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_group_backup_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_id TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1,
      source_app_version TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_wgb_import_backup ON wechat_group_backup_imports(backup_id, imported_at);

    CREATE TABLE IF NOT EXISTS wechat_group_backup_import_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      backup_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      source_group_key TEXT NOT NULL,
      source_row_id TEXT NOT NULL DEFAULT '',
      target_group_id TEXT NOT NULL,
      target_row_id TEXT NOT NULL DEFAULT '',
      row_hash TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL,
      UNIQUE(backup_id, table_name, source_group_key, source_row_id, target_group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wgb_import_rows_target ON wechat_group_backup_import_rows(target_group_id, table_name);
  `)
}

function readPackageVersion() {
  for (const file of [path.join(paths.resourcesDir, 'package.json'), path.resolve('package.json')]) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (raw?.version) return String(raw.version)
    } catch {}
  }
  return ''
}

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function hashJson(value) {
  return sha256(JSON.stringify(value || {}))
}

function sourceLoginUserHash(roomStatus = {}) {
  const loginUser = normalizeText(roomStatus.login_user || roomStatus.last_login_user || '')
  return loginUser ? sha256(loginUser) : ''
}

function safeIdPart(value = '') {
  return encodeURIComponent(String(value || '').trim()).replace(/%/g, '_')
}

function localExternalGroupId(groupId = '') {
  return `wechat:group:${safeIdPart(groupId)}`
}

function normalizeText(value = '') {
  return String(value ?? '').trim()
}

function canonicalTopic(value = '') {
  return normalizeText(value).replace(/\s+/gu, ' ').toLowerCase()
}

function normalizeGroupId(value = '') {
  const raw = normalizeText(value)
  if (!raw) return ''
  if (raw.startsWith('wechat:clawbot-group:')) return raw.slice('wechat:clawbot-group:'.length)
  return raw
}

function roomIdPart(value = '') {
  const raw = normalizeGroupId(value)
  return raw.startsWith('wechaty:') ? raw.slice('wechaty:'.length) : raw
}

function targetGroupIdFromRoom(room = {}) {
  const raw = roomIdPart(room.group_id || room.id || '')
  return raw ? `wechaty:${raw}` : ''
}

function backupGroupKey(groupId = '', groupName = '') {
  return `group_${sha256(`${normalizeGroupId(groupId)}\n${normalizeText(groupName)}`).slice(0, 18)}`
}

function tableExists(db, table) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1`).get(table)
}

function existingColumns(db, table) {
  if (!tableExists(db, table)) return []
  try { return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all().map(row => row.name) } catch { return [] }
}

function selectableColumns(db, table) {
  const have = new Set(existingColumns(db, table))
  return (EXPORT_COLUMNS[table] || []).filter(col => have.has(col))
}

function safeRow(row = {}) {
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    if (Buffer.isBuffer(value)) continue
    out[key] = value ?? ''
  }
  return out
}

function sourceRow(row = {}) {
  const out = safeRow(row)
  if (Object.prototype.hasOwnProperty.call(out, 'id')) {
    out.source_id = String(out.id || '')
    delete out.id
  }
  return out
}

function countMediaBytes(db, groupId) {
  if (!tableExists(db, 'wechat_group_media_items')) return 0
  try {
    return Number(db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN bytes > 0 THEN bytes ELSE 0 END), 0) AS n
      FROM wechat_group_media_items WHERE group_id = ?
    `).get(groupId)?.n || 0)
  } catch {
    return 0
  }
}

function mergeGroup(groups, row = {}, key, table) {
  const groupId = normalizeGroupId(row.group_id)
  if (!groupId) return
  const groupName = normalizeText(row.group_name || row.groupName || '')
  const mapKey = backupGroupKey(groupId, groupName)
  const old = groups.get(mapKey) || {
    backup_group_key: mapKey,
    group_id: groupId,
    group_name: groupName,
    counts: Object.fromEntries(GROUP_TABLES.map(item => [item.key, 0])),
    tables: [],
    latest_message_at: '',
    media_bytes_estimate: 0,
  }
  old.counts[key] = Number(row.count || 0)
  if (!old.tables.includes(table)) old.tables.push(table)
  if (!old.group_name && groupName) old.group_name = groupName
  const latest = normalizeText(row.latest_at || '')
  if (latest && latest > old.latest_message_at) old.latest_message_at = latest
  groups.set(mapKey, old)
}

export function listWeChatGroupBackupGroups() {
  ensureSchemas()
  const db = getDB()
  const groups = new Map()
  for (const spec of GROUP_TABLES) {
    if (!tableExists(db, spec.table)) continue
    const cols = new Set(existingColumns(db, spec.table))
    if (!cols.has('group_id')) continue
    const groupNameExpr = cols.has('group_name') ? "COALESCE(NULLIF(MAX(group_name), ''), group_id)" : 'group_id'
    const latestExpr = cols.has(spec.time) ? `MAX(${spec.time})` : "''"
    const rows = db.prepare(`
      SELECT group_id, ${groupNameExpr} AS group_name, COUNT(*) AS count, ${latestExpr} AS latest_at
      FROM ${spec.table}
      WHERE COALESCE(group_id, '') <> ''
      GROUP BY group_id
      ORDER BY latest_at DESC
      LIMIT 1000
    `).all()
    for (const row of rows) mergeGroup(groups, row, spec.key, spec.table)
  }
  for (const group of groups.values()) {
    group.media_bytes_estimate = countMediaBytes(db, group.group_id)
    group.total_rows = Object.values(group.counts).reduce((sum, value) => sum + Number(value || 0), 0)
  }
  const rows = [...groups.values()].sort((a, b) => String(b.latest_message_at || '').localeCompare(String(a.latest_message_at || '')) || a.group_name.localeCompare(b.group_name, 'zh-Hans-CN'))
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    groups: rows,
    totals: rows.reduce((acc, group) => {
      acc.groups += 1
      acc.rows += group.total_rows || 0
      acc.media_bytes_estimate += group.media_bytes_estimate || 0
      for (const [key, value] of Object.entries(group.counts || {})) acc[key] = (acc[key] || 0) + Number(value || 0)
      return acc
    }, { groups: 0, rows: 0, media_bytes_estimate: 0 }),
    db_path: paths.dbFile,
  }
}

function selectRowsForGroup(db, table, groupId, { includeDeletedMemory = true } = {}) {
  const cols = selectableColumns(db, table)
  if (!cols.length) return []
  const params = [groupId]
  let where = 'group_id = ?'
  if (table === 'wechat_group_memory_items' && !includeDeletedMemory && cols.includes('status')) {
    where += " AND COALESCE(status, 'active') = 'active'"
  }
  return db.prepare(`
    SELECT ${cols.map(col => `"${col}"`).join(', ')}
    FROM ${table}
    WHERE ${where}
    ORDER BY ${cols.includes('id') ? 'id ASC' : 'rowid ASC'}
  `).all(...params).map(sourceRow)
}

function safeRelativePath(rel = '') {
  const value = normalizeText(rel).replace(/\\/g, '/')
  if (!value || value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) return ''
  return value
}

function mimeToExt(mime = '', fallbackName = '') {
  const ext = path.extname(normalizeText(fallbackName)).toLowerCase()
  if (/^\.[a-z0-9]{1,8}$/i.test(ext)) return ext
  const value = normalizeText(mime).toLowerCase()
  if (value.includes('png')) return '.png'
  if (value.includes('jpeg') || value.includes('jpg')) return '.jpg'
  if (value.includes('gif')) return '.gif'
  if (value.includes('webp')) return '.webp'
  return '.bin'
}

function mediaBase64ForExport(row = {}) {
  const existing = normalizeText(row.base64 || '')
  if (existing) return existing
  const rel = safeRelativePath(row.relative_path || '')
  if (!rel) return ''
  const filePath = path.resolve(paths.userDir, rel)
  const root = path.resolve(paths.userDir)
  const diff = path.relative(root, filePath)
  if (!diff || diff.startsWith('..') || path.isAbsolute(diff)) return ''
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_MEDIA_FILE_BYTES) return ''
    return fs.readFileSync(filePath).toString('base64')
  } catch {
    return ''
  }
}

function exportMediaRows(rows = [], includeMediaFiles = true) {
  return rows.map(row => {
    const out = { ...row }
    if (includeMediaFiles) out.base64 = mediaBase64ForExport(row)
    else out.base64 = ''
    out.file_included = !!out.base64
    return out
  })
}

function sourceHistoricalIdsForGroup(roomStatus = {}, groupId = '', groupName = '') {
  const id = roomIdPart(groupId)
  const name = canonicalTopic(groupName)
  const rooms = Array.isArray(roomStatus?.rooms) ? roomStatus.rooms : []
  const found = rooms.find(room => roomIdPart(room.group_id || room.id || '') === id || (name && canonicalTopic(room.topic) === name))
  return Array.isArray(found?.historical_ids) ? found.historical_ids : []
}

export function buildWeChatGroupBackupExport({ groupIds = [], includeMediaFiles = true, includeDeletedMemory = true, roomStatus = null } = {}) {
  ensureSchemas()
  const db = getDB()
  const overview = listWeChatGroupBackupGroups()
  const selected = new Set((Array.isArray(groupIds) ? groupIds : []).map(value => normalizeText(value)).filter(Boolean))
  const wanted = overview.groups.filter(group => {
    if (!selected.size) return false
    return selected.has(group.group_id) || selected.has(group.backup_group_key)
  })
  if (!wanted.length) return { ok: false, error: '请选择要导出的微信群组' }

  const backupId = `wgb_${Date.now()}_${sha256(`${Date.now()}_${Math.random()}`).slice(0, 8)}`
  const manifestGroups = []
  const groups = {}
  for (const group of wanted) {
    const payload = {}
    for (const spec of GROUP_TABLES) {
      const rows = selectRowsForGroup(db, spec.table, group.group_id, { includeDeletedMemory })
      payload[spec.key] = spec.key === 'media_items' ? exportMediaRows(rows, includeMediaFiles) : rows
    }
    const counts = Object.fromEntries(Object.entries(payload).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]))
    const checksum = hashJson(payload)
    groups[group.backup_group_key] = payload
    manifestGroups.push({
      backup_group_key: group.backup_group_key,
      source_group_id: group.group_id,
      source_group_name: group.group_name,
      source_historical_ids: sourceHistoricalIdsForGroup(roomStatus || {}, group.group_id, group.group_name),
      source_login_user_hash: sourceLoginUserHash(roomStatus || {}),
      counts,
      latest_message_at: group.latest_message_at || '',
      media_bytes_estimate: group.media_bytes_estimate || 0,
      checksum,
    })
  }
  const backup = {
    format: WECHAT_GROUP_BACKUP_FORMAT,
    schema_version: WECHAT_GROUP_BACKUP_SCHEMA_VERSION,
    app_version: readPackageVersion(),
    created_at: new Date().toISOString(),
    backup_id: backupId,
    manifest: {
      groups: manifestGroups,
      include_media_files: !!includeMediaFiles,
      include_deleted_memory: !!includeDeletedMemory,
      excluded: ['llmProfiles', 'skills', 'knowledge_*', 'memories', 'config', 'config.json', 'wechat_clawbot_tokens', 'embedding', 'honcho_synced_at', 'honcho_message_id'],
    },
    groups,
  }
  const body = JSON.stringify(backup, null, 2)
  return {
    ok: true,
    backup,
    filename: `bailongma-wechat-groups-backup-${new Date().toISOString().slice(0, 10)}.json`,
    contentType: 'application/json; charset=utf-8',
    body,
    bytes: Buffer.byteLength(body),
  }
}

function normalizeBackupPayload(payload = {}) {
  const backup = payload?.backup && typeof payload.backup === 'object' ? payload.backup : payload
  if (!backup || typeof backup !== 'object') return { ok: false, error: '备份内容为空' }
  if (backup.format !== WECHAT_GROUP_BACKUP_FORMAT) return { ok: false, error: '不是白龙马微信群组备份文件' }
  if (Number(backup.schema_version || 0) > WECHAT_GROUP_BACKUP_SCHEMA_VERSION) return { ok: false, error: `备份版本过高：${backup.schema_version}` }
  if (!backup.manifest || !Array.isArray(backup.manifest.groups) || !backup.groups || typeof backup.groups !== 'object') {
    return { ok: false, error: '备份结构不完整' }
  }
  return { ok: true, backup }
}

function validateManifestGroupPayload(backup = {}, group = {}) {
  const key = normalizeText(group.backup_group_key)
  if (!key) return { ok: false, reason: 'backup_group_key missing' }
  const payload = backup.groups?.[key]
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'payload_missing' }
  for (const tableKey of GROUP_KEYS) {
    if (payload[tableKey] !== undefined && !Array.isArray(payload[tableKey])) {
      return { ok: false, reason: `${tableKey} 不是数组` }
    }
  }
  const normalizedPayload = Object.fromEntries(GROUP_KEYS.map(tableKey => [tableKey, Array.isArray(payload[tableKey]) ? payload[tableKey] : []]))
  const actualCounts = Object.fromEntries(GROUP_KEYS.map(tableKey => [tableKey, normalizedPayload[tableKey].length]))
  const expectedCounts = group.counts && typeof group.counts === 'object' ? group.counts : {}
  for (const tableKey of GROUP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(expectedCounts, tableKey) && Number(expectedCounts[tableKey] || 0) !== actualCounts[tableKey]) {
      return { ok: false, reason: `${tableKey} 行数与 manifest 不一致` }
    }
  }
  const checksum = normalizeText(group.checksum || '')
  if (checksum && hashJson(normalizedPayload) !== checksum) {
    return { ok: false, reason: '群组 payload checksum 不一致' }
  }
  return { ok: true, payload: normalizedPayload, counts: actualCounts }
}

function buildRoomIndex(roomStatus = {}) {
  const rooms = Array.isArray(roomStatus?.rooms) ? roomStatus.rooms : []
  const byId = new Map()
  const byName = new Map()
  for (const room of rooms) {
    const id = roomIdPart(room.group_id || room.id || '')
    const topic = normalizeText(room.topic || room.group_name || '')
    if (id) byId.set(id, { ...room, id, group_id: `wechaty:${id}`, topic })
    const name = canonicalTopic(topic)
    if (name) {
      const list = byName.get(name) || []
      list.push({ ...room, id, group_id: id ? `wechaty:${id}` : '', topic })
      byName.set(name, list)
    }
  }
  return { byId, byName }
}

function matchManifestGroup(group = {}, roomStatus = {}) {
  if (!roomStatus?.ok || roomStatus.rooms_stale || roomStatus.fresh === false) {
    return {
      match_status: 'wechat_not_ready',
      importable: false,
      reason: roomStatus?.error || '当前微信号未在线或群列表不是实时结果',
    }
  }
  const { byId, byName } = buildRoomIndex(roomStatus)
  const ids = [
    group.source_group_id,
    ...(Array.isArray(group.source_historical_ids) ? group.source_historical_ids : []),
  ].map(roomIdPart).filter(Boolean)
  for (const id of ids) {
    if (byId.has(id)) {
      const target = byId.get(id)
      return { match_status: 'exact_id', importable: true, requires_name_confirmation: false, target }
    }
  }
  const name = canonicalTopic(group.source_group_name || '')
  if (name) {
    const matches = byName.get(name) || []
    if (matches.length === 1) {
      return { match_status: 'unique_name', importable: true, requires_name_confirmation: true, target: matches[0] }
    }
    if (matches.length > 1) {
      return { match_status: 'ambiguous_name', importable: false, reason: '当前账号存在多个同名群，不能按群名导入' }
    }
  }
  return { match_status: 'missing', importable: false, reason: '当前微信账号没有匹配的群' }
}

export function previewWeChatGroupBackupImport({ backup: rawBackup, roomStatus = {} } = {}) {
  const normalized = normalizeBackupPayload(rawBackup)
  if (!normalized.ok) return normalized
  const { backup } = normalized
  const groups = backup.manifest.groups.map(group => {
    const validation = validateManifestGroupPayload(backup, group)
    if (!validation.ok) {
      return {
        ...group,
        match_status: 'invalid_payload',
        importable: false,
        reason: validation.reason,
        target_group_id: '',
        target_group_name: '',
        target_room_id: '',
      }
    }
    const match = matchManifestGroup(group, roomStatus)
    return {
      ...group,
      ...match,
      target_group_id: match.target?.group_id || '',
      target_group_name: match.target?.topic || '',
      target_room_id: match.target?.id || '',
    }
  })
  return {
    ok: true,
    format: backup.format,
    schema_version: backup.schema_version,
    app_version: backup.app_version || '',
    backup_id: backup.backup_id || '',
    created_at: backup.created_at || '',
    room_status: {
      ok: !!roomStatus?.ok,
      online: !!roomStatus?.online,
      fresh: roomStatus?.fresh === true,
      rooms_stale: !!roomStatus?.rooms_stale,
      login_user: roomStatus?.login_user || '',
      error: roomStatus?.error || '',
    },
    groups,
    importable_count: groups.filter(group => group.importable).length,
  }
}

function isInternalWechatIdLike(value = '') {
  const text = normalizeText(value)
  return /^@|^wxid_|^gh_|^@@/i.test(text) || /^[a-z0-9_-]{16,}$/i.test(text)
}

function normalizeIdentityName(value = '') {
  return normalizeText(value).replace(/\s+/gu, ' ').toLowerCase()
}

function canonicalMemberIdFromRow(row = {}, targetGroupId = '') {
  const old = normalizeText(row.canonical_member_id || '')
  if (old.startsWith('wechat_member_stable_')) return old
  const stable = normalizeText(row.stable_key || row.wxid || row.wechat_id || '')
  if (stable) return `wechat_member_stable_${safeIdPart(stable)}`
  const name = normalizeText(row.display_name || row.member_name || row.sender_name || '')
  if (name && !isInternalWechatIdLike(name)) return `wechat_member_name_${safeIdPart(targetGroupId)}_${safeIdPart(normalizeIdentityName(name))}`
  const sender = normalizeText(row.sender_id || row.member_id || '')
  return `wechat_member_sender_${safeIdPart(targetGroupId)}_${safeIdPart(sender || name || 'unknown')}`
}

function getSourceId(row = {}) {
  return normalizeText(row.source_id || row.id || '')
}

function insertImportLedger(db, importId, backupId, tableName, sourceGroupKey, sourceRowId, targetGroupId, targetRowId, row) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO wechat_group_backup_import_rows (
        import_id, backup_id, table_name, source_group_key, source_row_id,
        target_group_id, target_row_id, row_hash, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(importId, backupId, tableName, sourceGroupKey, sourceRowId || '', targetGroupId, String(targetRowId || ''), hashJson(row), nowTimestamp())
  } catch {}
}

function addError(summary, message) {
  if (summary.errors.length < MAX_IMPORT_ERRORS) summary.errors.push(message)
}

function importMemberNames(db, rows, target, summary) {
  const stmt = db.prepare(`
    INSERT INTO wechat_group_member_names (
      group_id, group_name, sender_id, display_name, room_alias, contact_alias,
      contact_name, wechat_id, wxid, stable_key, raw_identity, source, first_seen, last_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, sender_id) DO UPDATE SET
      group_name = excluded.group_name,
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
  `)
  for (const row of rows || []) {
    const senderId = normalizeText(row.sender_id)
    const displayName = normalizeText(row.display_name || row.room_alias || row.contact_alias || row.contact_name || senderId)
    if (!senderId || !displayName) { summary.member_names.skipped += 1; continue }
    try {
      const info = stmt.run(
        target.groupId,
        target.groupName,
        senderId,
        displayName,
        normalizeText(row.room_alias),
        normalizeText(row.contact_alias),
        normalizeText(row.contact_name),
        normalizeText(row.wechat_id),
        normalizeText(row.wxid),
        normalizeText(row.stable_key || row.wxid || row.wechat_id),
        normalizeText(row.raw_identity).slice(0, 2000),
        normalizeText(row.source || 'backup-import'),
        normalizeText(row.first_seen || nowTimestamp()),
        normalizeText(row.last_seen || nowTimestamp()),
      )
      if (info.changes) summary.member_names.inserted += 1
      else summary.member_names.skipped += 1
    } catch (err) {
      summary.member_names.skipped += 1
      addError(summary, `member_names:${senderId}: ${err?.message || err}`)
    }
  }
}

function importMemberIdentities(db, rows, aliases, target, summary) {
  const canonicalMap = new Map()
  const identityStmt = db.prepare(`
    INSERT INTO wechat_member_identities (
      canonical_member_id, group_id, group_name, display_name, stable_key,
      wxid, wechat_id, aliases, confidence, first_seen, last_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_member_id) DO UPDATE SET
      group_name = excluded.group_name,
      display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE wechat_member_identities.display_name END,
      stable_key = CASE WHEN excluded.stable_key <> '' THEN excluded.stable_key ELSE wechat_member_identities.stable_key END,
      wxid = CASE WHEN excluded.wxid <> '' THEN excluded.wxid ELSE wechat_member_identities.wxid END,
      wechat_id = CASE WHEN excluded.wechat_id <> '' THEN excluded.wechat_id ELSE wechat_member_identities.wechat_id END,
      aliases = excluded.aliases,
      confidence = MAX(wechat_member_identities.confidence, excluded.confidence),
      last_seen = excluded.last_seen
  `)
  for (const row of rows || []) {
    const canonical = canonicalMemberIdFromRow(row, target.groupId)
    if (!canonical) { summary.member_identities.skipped += 1; continue }
    canonicalMap.set(normalizeText(row.canonical_member_id), canonical)
    try {
      const info = identityStmt.run(
        canonical,
        target.groupId,
        target.groupName,
        normalizeText(row.display_name),
        normalizeText(row.stable_key || row.wxid || row.wechat_id),
        normalizeText(row.wxid),
        normalizeText(row.wechat_id),
        normalizeText(row.aliases || '[]') || '[]',
        Number(row.confidence || 1),
        normalizeText(row.first_seen || nowTimestamp()),
        normalizeText(row.last_seen || nowTimestamp()),
      )
      if (info.changes) summary.member_identities.inserted += 1
      else summary.member_identities.skipped += 1
    } catch (err) {
      summary.member_identities.skipped += 1
      addError(summary, `member_identities:${canonical}: ${err?.message || err}`)
    }
  }

  const aliasStmt = db.prepare(`
    INSERT INTO wechat_member_identity_aliases (
      canonical_member_id, group_id, sender_id, display_name, room_alias,
      contact_alias, contact_name, stable_key, wxid, wechat_id, source, first_seen, last_seen
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
  `)
  for (const row of aliases || []) {
    const senderId = normalizeText(row.sender_id)
    const canonical = canonicalMap.get(normalizeText(row.canonical_member_id)) || canonicalMemberIdFromRow(row, target.groupId)
    if (!senderId || !canonical) { summary.member_identity_aliases.skipped += 1; continue }
    try {
      const info = aliasStmt.run(
        canonical,
        target.groupId,
        senderId,
        normalizeText(row.display_name),
        normalizeText(row.room_alias),
        normalizeText(row.contact_alias),
        normalizeText(row.contact_name),
        normalizeText(row.stable_key || row.wxid || row.wechat_id),
        normalizeText(row.wxid),
        normalizeText(row.wechat_id),
        normalizeText(row.source || 'backup-import'),
        normalizeText(row.first_seen || nowTimestamp()),
        normalizeText(row.last_seen || nowTimestamp()),
      )
      if (info.changes) summary.member_identity_aliases.inserted += 1
      else summary.member_identity_aliases.skipped += 1
    } catch (err) {
      summary.member_identity_aliases.skipped += 1
      addError(summary, `member_identity_aliases:${senderId}: ${err?.message || err}`)
    }
  }
  return canonicalMap
}

function importActivityRows(db, rows, target, summary, ledger) {
  const find = db.prepare(`
    SELECT id FROM wechat_group_activity
    WHERE group_id = ? AND sender_id = ? AND timestamp = ? AND raw_text = ?
    LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO wechat_group_activity (
      group_id, group_name, sender_id, sender_name, message_type, display_text,
      raw_text, raw_text_full, text_length, image_count, emoji_count, link_count,
      brag_score, mentioned_self, source, timestamp, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of rows || []) {
    const rawText = normalizeText(row.raw_text || row.rawText || row.display_text || row.content || row.text || '')
    const senderId = normalizeText(row.sender_id || row.senderId || row.member_id || '')
    const timestamp = normalizeText(row.timestamp || nowTimestamp())
    if (!rawText && !normalizeText(row.display_text)) { summary.activity.skipped += 1; continue }
    try {
      const existing = find.get(target.groupId, senderId, timestamp, rawText)
      if (existing?.id) {
        summary.activity.skipped += 1
        continue
      }
      const full = normalizeText(row.raw_text_full || row.rawTextFull || rawText || row.display_text)
      const info = insert.run(
        target.groupId,
        target.groupName,
        senderId,
        normalizeText(row.sender_name || row.senderName || row.member_name),
        normalizeText(row.message_type || row.messageType || 'text'),
        normalizeText(row.display_text || row.displayText || rawText),
        rawText,
        full,
        Number(row.text_length || Array.from(full || rawText).length || 0),
        Number(row.image_count || 0),
        Number(row.emoji_count || 0),
        Number(row.link_count || 0),
        Number(row.brag_score || 0),
        row.mentioned_self || row.mentionedSelf ? 1 : 0,
        normalizeText(row.source || 'backup-import'),
        timestamp,
        normalizeText(row.created_at || nowTimestamp()),
      )
      summary.activity.inserted += 1
      insertImportLedger(db, ledger.importId, ledger.backupId, 'wechat_group_activity', ledger.groupKey, getSourceId(row), target.groupId, info.lastInsertRowid, row)
    } catch (err) {
      summary.activity.skipped += 1
      addError(summary, `activity:${getSourceId(row)}: ${err?.message || err}`)
    }
  }
}

function importMessageRows(db, rows, target, summary, canonicalMap, ledger) {
  const sourceToTarget = new Map()
  const find = db.prepare(`
    SELECT id FROM wechat_group_messages
    WHERE group_id = ? AND member_id = ? AND timestamp = ? AND content = ?
    LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO wechat_group_messages (
      group_id, group_external_id, group_name, member_id, member_name,
      canonical_member_id, content, mentioned_self, source, timestamp, created_at,
      honcho_synced_at, honcho_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')
  `)
  for (const row of rows || []) {
    const content = normalizeText(row.content || row.text || '')
    const memberId = normalizeText(row.member_id || row.sender_id || '')
    const timestamp = normalizeText(row.timestamp || nowTimestamp())
    const sourceId = getSourceId(row)
    if (!content) { summary.messages.skipped += 1; continue }
    try {
      const existing = find.get(target.groupId, memberId, timestamp, content)
      if (existing?.id) {
        sourceToTarget.set(sourceId, existing.id)
        summary.messages.skipped += 1
        continue
      }
      const canonical = canonicalMap.get(normalizeText(row.canonical_member_id)) || canonicalMemberIdFromRow({ ...row, sender_id: memberId, display_name: row.member_name }, target.groupId)
      const info = insert.run(
        target.groupId,
        localExternalGroupId(target.groupId),
        target.groupName,
        memberId,
        normalizeText(row.member_name || row.sender_name),
        canonical,
        content,
        row.mentioned_self || row.mentionedSelf ? 1 : 0,
        normalizeText(row.source || 'backup-import'),
        timestamp,
        normalizeText(row.created_at || nowTimestamp()),
      )
      sourceToTarget.set(sourceId, info.lastInsertRowid)
      summary.messages.inserted += 1
      insertImportLedger(db, ledger.importId, ledger.backupId, 'wechat_group_messages', ledger.groupKey, sourceId, target.groupId, info.lastInsertRowid, row)
    } catch (err) {
      summary.messages.skipped += 1
      addError(summary, `messages:${sourceId}: ${err?.message || err}`)
    }
  }
  return sourceToTarget
}

function importMemoryRows(db, rows, target, summary, canonicalMap, messageIdMap, ledger) {
  const find = db.prepare(`
    SELECT id FROM wechat_group_memory_items
    WHERE group_id = ? AND category = ? AND content = ?
      AND (
        COALESCE(canonical_member_id, '') = ?
        OR (COALESCE(canonical_member_id, '') = '' AND COALESCE(member_id, '') = ? AND COALESCE(member_name, '') = ?)
      )
    LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO wechat_group_memory_items (
      group_id, group_external_id, group_name, member_id, member_name,
      canonical_member_id, category, title, content, status, salience,
      source_message_id, source_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of rows || []) {
    const content = normalizeText(row.content)
    const category = normalizeText(row.category || 'manual')
    const memberId = normalizeText(row.member_id || row.sender_id || '')
    const memberName = normalizeText(row.member_name || row.sender_name || '')
    if (!content) { summary.memory_items.skipped += 1; continue }
    const canonical = canonicalMap.get(normalizeText(row.canonical_member_id)) || (memberId || memberName ? canonicalMemberIdFromRow({ ...row, sender_id: memberId, display_name: memberName }, target.groupId) : '')
    try {
      const existing = find.get(target.groupId, category, content, canonical, memberId, memberName)
      if (existing?.id) {
        summary.memory_items.skipped += 1
        continue
      }
      const sourceMessageId = normalizeText(row.source_message_id || '')
      const mappedMessageId = sourceMessageId && messageIdMap.has(sourceMessageId) ? Number(messageIdMap.get(sourceMessageId)) : null
      const info = insert.run(
        target.groupId,
        localExternalGroupId(target.groupId),
        target.groupName,
        memberId,
        memberName,
        canonical,
        category,
        normalizeText(row.title || content.slice(0, 48)),
        content,
        normalizeText(row.status || 'active'),
        Number(row.salience || 3),
        mappedMessageId,
        normalizeText(row.source_text || row.sourceText || ''),
        normalizeText(row.created_at || nowTimestamp()),
        normalizeText(row.updated_at || row.created_at || nowTimestamp()),
      )
      summary.memory_items.inserted += 1
      insertImportLedger(db, ledger.importId, ledger.backupId, 'wechat_group_memory_items', ledger.groupKey, getSourceId(row), target.groupId, info.lastInsertRowid, row)
    } catch (err) {
      summary.memory_items.skipped += 1
      addError(summary, `memory_items:${getSourceId(row)}: ${err?.message || err}`)
    }
  }
}

function restoreMediaRelativePath(row = {}, backupId = '') {
  const base64 = normalizeText(row.base64 || row.file_base64 || '')
  if (!base64) return { relativePath: '', base64: '', restored: false, skipped: true, reason: 'no_base64' }
  let buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch {
    return { relativePath: '', base64: '', restored: false, skipped: true, reason: 'invalid_base64' }
  }
  if (!buffer.length || buffer.length > MAX_MEDIA_FILE_BYTES) return { relativePath: '', base64: '', restored: false, skipped: true, reason: 'media_too_large' }
  const hash = normalizeText(row.sha256) || crypto.createHash('sha256').update(buffer).digest('hex')
  const ext = mimeToExt(row.mime_type || row.content_type, row.file_name || row.relative_path)
  const rel = safeRelativePath(path.join('data', 'wechat-media', 'imported', safeIdPart(backupId || 'backup'), `${hash}${ext}`))
  if (!rel) return { relativePath: '', base64: '', restored: false, skipped: true, reason: 'invalid_target_path' }
  try {
    const filePath = path.resolve(paths.userDir, rel)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, buffer)
    return { relativePath: rel, base64, restored: true, sha256: hash, bytes: buffer.length }
  } catch (err) {
    return { relativePath: '', base64, restored: false, skipped: true, reason: err?.message || String(err), sha256: hash, bytes: buffer.length }
  }
}

function importMediaRows(db, rows, target, summary, ledger) {
  const stmt = db.prepare(`
    INSERT INTO wechat_group_media_items (
      group_id, group_name, sender_id, sender_name, message_type, relative_path,
      file_name, mime_type, bytes, sha256, base64, description, labels_json,
      vision_status, vision_provider, vision_model, vision_error, source_text,
      described_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, sha256) DO UPDATE SET
      group_name = excluded.group_name,
      sender_id = CASE WHEN excluded.sender_id <> '' THEN excluded.sender_id ELSE wechat_group_media_items.sender_id END,
      sender_name = CASE WHEN excluded.sender_name <> '' THEN excluded.sender_name ELSE wechat_group_media_items.sender_name END,
      message_type = CASE WHEN excluded.message_type <> '' THEN excluded.message_type ELSE wechat_group_media_items.message_type END,
      relative_path = CASE WHEN excluded.relative_path <> '' THEN excluded.relative_path ELSE wechat_group_media_items.relative_path END,
      file_name = CASE WHEN excluded.file_name <> '' THEN excluded.file_name ELSE wechat_group_media_items.file_name END,
      mime_type = CASE WHEN excluded.mime_type <> '' THEN excluded.mime_type ELSE wechat_group_media_items.mime_type END,
      bytes = CASE WHEN excluded.bytes > 0 THEN excluded.bytes ELSE wechat_group_media_items.bytes END,
      base64 = CASE WHEN excluded.base64 <> '' THEN excluded.base64 ELSE wechat_group_media_items.base64 END,
      description = CASE WHEN excluded.description <> '' THEN excluded.description ELSE wechat_group_media_items.description END,
      labels_json = CASE WHEN excluded.labels_json <> '' AND excluded.labels_json <> '[]' THEN excluded.labels_json ELSE wechat_group_media_items.labels_json END,
      vision_status = CASE WHEN excluded.vision_status <> '' THEN excluded.vision_status ELSE wechat_group_media_items.vision_status END,
      vision_provider = CASE WHEN excluded.vision_provider <> '' THEN excluded.vision_provider ELSE wechat_group_media_items.vision_provider END,
      vision_model = CASE WHEN excluded.vision_model <> '' THEN excluded.vision_model ELSE wechat_group_media_items.vision_model END,
      vision_error = excluded.vision_error,
      source_text = CASE WHEN excluded.source_text <> '' THEN excluded.source_text ELSE wechat_group_media_items.source_text END,
      described_at = CASE WHEN excluded.described_at <> '' THEN excluded.described_at ELSE wechat_group_media_items.described_at END,
      updated_at = excluded.updated_at
  `)
  for (const row of rows || []) {
    const restored = restoreMediaRelativePath(row, ledger.backupId)
    const sha = normalizeText(row.sha256 || restored.sha256)
    if (!sha) { summary.media_items.skipped += 1; continue }
    try {
      const info = stmt.run(
        target.groupId,
        target.groupName,
        normalizeText(row.sender_id),
        normalizeText(row.sender_name),
        normalizeText(row.message_type || 'image'),
        restored.relativePath,
        normalizeText(row.file_name || path.basename(restored.relativePath || '')),
        normalizeText(row.mime_type || row.content_type),
        Number(restored.bytes || row.bytes || 0),
        sha,
        normalizeText(restored.base64 || row.base64 || ''),
        normalizeText(row.description),
        normalizeText(row.labels_json || '[]') || '[]',
        normalizeText(row.vision_status || (row.description ? 'done' : 'pending')),
        normalizeText(row.vision_provider),
        normalizeText(row.vision_model),
        normalizeText(row.vision_error),
        normalizeText(row.source_text).slice(0, 2000),
        normalizeText(row.described_at),
        normalizeText(row.created_at || nowTimestamp()),
        normalizeText(row.updated_at || nowTimestamp()),
      )
      if (info.changes) summary.media_items.inserted += 1
      else summary.media_items.skipped += 1
      if (restored.restored) summary.media_files_restored += 1
      else if (restored.skipped) summary.media_files_missing += 1
      insertImportLedger(db, ledger.importId, ledger.backupId, 'wechat_group_media_items', ledger.groupKey, getSourceId(row), target.groupId, sha, row)
    } catch (err) {
      summary.media_items.skipped += 1
      addError(summary, `media_items:${sha}: ${err?.message || err}`)
    }
  }
}

function emptyTableSummary() {
  return { inserted: 0, skipped: 0 }
}

function importOneGroup(db, backup, manifestGroup, payload, match, importId) {
  const targetGroupId = targetGroupIdFromRoom(match.target)
  const targetGroupName = normalizeText(match.target?.topic || manifestGroup.source_group_name || targetGroupId)
  const summary = {
    backup_group_key: manifestGroup.backup_group_key,
    source_group_id: manifestGroup.source_group_id || '',
    source_group_name: manifestGroup.source_group_name || '',
    target_group_id: targetGroupId,
    target_group_name: targetGroupName,
    match_status: match.match_status,
    activity: emptyTableSummary(),
    messages: emptyTableSummary(),
    memory_items: emptyTableSummary(),
    member_names: emptyTableSummary(),
    member_identities: emptyTableSummary(),
    member_identity_aliases: emptyTableSummary(),
    media_items: emptyTableSummary(),
    media_files_restored: 0,
    media_files_missing: 0,
    errors: [],
  }
  if (!targetGroupId) {
    summary.errors.push('target group id missing')
    return summary
  }
  const ledger = {
    importId,
    backupId: backup.backup_id || '',
    groupKey: manifestGroup.backup_group_key,
  }
  const target = { groupId: targetGroupId, groupName: targetGroupName }
  const tx = db.transaction(() => {
    importMemberNames(db, payload.member_names || [], target, summary)
    const canonicalMap = importMemberIdentities(db, payload.member_identities || [], payload.member_identity_aliases || [], target, summary)
    importActivityRows(db, payload.activity || [], target, summary, ledger)
    const messageIdMap = importMessageRows(db, payload.messages || [], target, summary, canonicalMap, ledger)
    importMemoryRows(db, payload.memory_items || [], target, summary, canonicalMap, messageIdMap, ledger)
    importMediaRows(db, payload.media_items || [], target, summary, ledger)
  })
  tx()
  return summary
}

export function importWeChatGroupBackup({ backup: rawBackup, selectedGroupKeys = [], roomStatus = {}, allowUniqueNameMatch = false } = {}) {
  ensureSchemas()
  const normalized = normalizeBackupPayload(rawBackup)
  if (!normalized.ok) return normalized
  const { backup } = normalized
  const selected = new Set((Array.isArray(selectedGroupKeys) ? selectedGroupKeys : []).map(value => normalizeText(value)).filter(Boolean))
  if (!selected.size) return { ok: false, error: '请选择要导入的群组' }

  const db = getDB()
  const importedAt = nowTimestamp()
  const importInfo = db.prepare(`
    INSERT INTO wechat_group_backup_imports (backup_id, format_version, source_app_version, imported_at, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    normalizeText(backup.backup_id || ''),
    Number(backup.schema_version || 1),
    normalizeText(backup.app_version || ''),
    importedAt,
    'wechat group backup import',
  )
  const importId = importInfo.lastInsertRowid
  const groups = []
  const skipped_groups = []
  for (const manifestGroup of backup.manifest.groups || []) {
    const key = normalizeText(manifestGroup.backup_group_key)
    if (!selected.has(key)) {
      skipped_groups.push({ backup_group_key: key, reason: 'not_selected' })
      continue
    }
    const validation = validateManifestGroupPayload(backup, manifestGroup)
    if (!validation.ok) {
      skipped_groups.push({ backup_group_key: key, match_status: 'invalid_payload', reason: validation.reason })
      continue
    }
    const match = matchManifestGroup(manifestGroup, roomStatus)
    if (!match.importable || (match.match_status === 'unique_name' && !allowUniqueNameMatch)) {
      skipped_groups.push({ backup_group_key: key, match_status: match.match_status, reason: match.reason || 'not_importable' })
      continue
    }
    const payload = validation.payload
    if (!payload || typeof payload !== 'object') {
      skipped_groups.push({ backup_group_key: key, reason: 'payload_missing' })
      continue
    }
    try {
      groups.push(importOneGroup(db, backup, manifestGroup, payload, match, importId))
    } catch (err) {
      skipped_groups.push({ backup_group_key: key, reason: err?.message || String(err) })
    }
  }
  const activityIndex = backfillWeChatGroupMemoryIndex({ limit: 50000 })
  const localIndex = backfillLocalWeChatMemoryIndex({ limit: 50000 })
  return {
    ok: groups.length > 0,
    imported_at: importedAt,
    backup_id: backup.backup_id || '',
    import_id: importId,
    groups,
    skipped_groups,
    activity_index: {
      ok: activityIndex.ok,
      scanned: activityIndex.scanned,
      activity_fts: activityIndex.activity_fts,
      chunks: activityIndex.chunks,
      errors: activityIndex.errors || [],
    },
    local_index: {
      ok: localIndex.ok,
      messages: localIndex.messages,
      memories: localIndex.memories,
      errors: localIndex.errors || [],
    },
  }
}
