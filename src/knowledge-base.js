import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { getDB } from './db.js'
import { nowTimestamp } from './time.js'
import { getHonchoConfig, getEmbeddingConfig, getSkillImageVisionCredentials, getSkillImageVisionRuntimeCandidates } from './config.js'

const PARSER_VERSION = 'knowledge-v1'
let schemaReady = false

function normalizeText(value = '') {
  return String(value || '').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')) } catch { return fallback }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sourceKindFromName(name = '', mime = '') {
  const ext = path.extname(String(name || '')).toLowerCase()
  const type = String(mime || '').toLowerCase()
  if (/^image\//.test(type) || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.svg'].includes(ext)) return 'image'
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'sheet'
  if (['.pdf'].includes(ext)) return 'pdf'
  if (['.docx', '.doc'].includes(ext)) return 'word'
  if (['.md', '.markdown'].includes(ext)) return 'markdown'
  return 'text'
}

export function ensureKnowledgeSchema() {
  if (schemaReady) return
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'global',
      status TEXT NOT NULL DEFAULT 'draft',
      enabled INTEGER NOT NULL DEFAULT 1,
      summary TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      parser_version TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_hit_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      committed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_ks_status ON knowledge_sources(status, enabled, updated_at);
    CREATE INDEX IF NOT EXISTS idx_ks_type ON knowledge_sources(source_type, updated_at);

    CREATE TABLE IF NOT EXISTS knowledge_source_groups (
      source_id INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ksg_group ON knowledge_source_groups(group_id, source_id);

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_id, chunk_index);

    CREATE TABLE IF NOT EXISTS knowledge_import_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'parsed',
      payload_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  schemaReady = true
}

function localHashEmbeddingBuffer(text = '') {
  const dims = 384
  const vec = new Float32Array(dims)
  const value = compactText(text).toLowerCase()
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

function cosineSimilarityBuffer(a, b) {
  try {
    const fa = new Float32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4))
    const fb = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
    const n = Math.min(fa.length, fb.length)
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) { dot += fa[i] * fb[i]; na += fa[i] * fa[i]; nb += fb[i] * fb[i] }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
  } catch { return 0 }
}

async function embeddingFor(text = '') {
  try {
    const { computeEmbedding, isEmbeddingConfigured } = await import('./embedding.js')
    if (isEmbeddingConfigured()) return await computeEmbedding(text)
  } catch {}
  return localHashEmbeddingBuffer(text)
}

function chunkText(text = '', max = 900) {
  const body = normalizeText(text)
  if (!body) return []
  const parts = body.split(/\n{2,}|(?<=[。！？!?])\s+/u).map(s => s.trim()).filter(Boolean)
  const chunks = []
  let cur = ''
  for (const part of parts.length ? parts : [body]) {
    if ((cur + '\n' + part).length > max && cur) {
      chunks.push(cur.trim())
      cur = ''
    }
    if (part.length > max) {
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max))
    } else {
      cur = cur ? `${cur}\n${part}` : part
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.slice(0, 300)
}

function summarizeText(text = '') {
  const body = compactText(text)
  return body.slice(0, 220)
}

function stripDataUrl(value = '') {
  const raw = String(value || '')
  const idx = raw.indexOf(',')
  return raw.startsWith('data:') && idx >= 0 ? raw.slice(idx + 1) : raw
}

function bufferFromBase64(base64 = '') {
  return Buffer.from(stripDataUrl(base64), 'base64')
}

async function parseOfficeFile({ buffer, fileName, mimeType }) {
  const ext = path.extname(fileName || '').toLowerCase()
  if (ext === '.doc') {
    throw new Error('暂不支持旧版 .doc，请先另存为 .docx 后导入')
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer })
    return normalizeText(result.value || '')
  }
  if (ext === '.csv') {
    const text = buffer.toString('utf8')
    const rows = text.split(/\r?\n/).map(line => line.split(',').map(cell => compactText(cell)).filter(Boolean).join(' | ')).filter(Boolean)
    return normalizeText(rows.join('\n'))
  }
  if (['.xlsx', '.xls'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const out = []
    for (const name of wb.SheetNames || []) {
      const sheet = wb.Sheets[name]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })
      out.push(`# Sheet: ${name}`)
      for (const row of rows.slice(0, 2000)) {
        out.push(row.map(cell => compactText(cell)).filter(Boolean).join(' | '))
      }
    }
    return normalizeText(out.join('\n'))
  }
  if (ext === '.pdf' || /pdf/.test(mimeType || '')) {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return normalizeText(result.text || '')
    } finally {
      await parser.destroy?.()
    }
  }
  return normalizeText(buffer.toString('utf8'))
}

async function normalizeImageBuffer({ buffer, fileName = '', mimeType = '' }) {
  const ext = path.extname(fileName || '').toLowerCase()
  if (ext === '.svg' || /svg/.test(mimeType)) {
    const svg = buffer.toString('utf8')
    const text = normalizeText(svg.replace(/<style[\s\S]*?<\/style>/giu, ' ').replace(/<script[\s\S]*?<\/script>/giu, ' ').replace(/<[^>]+>/g, ' '))
    try {
      const sharp = (await import('sharp')).default
      const png = await sharp(buffer, { animated: false }).png().toBuffer()
      return { buffer: png, mimeType: 'image/png', extractedText: text }
    } catch {
      return { buffer, mimeType: 'image/svg+xml', extractedText: text }
    }
  }
  if (['.tif', '.tiff', '.heic', '.heif', '.gif'].includes(ext) || /tiff|heic|heif|gif/.test(mimeType)) {
    try {
      const sharp = (await import('sharp')).default
      const png = await sharp(buffer, { animated: false, pages: 1 }).png().toBuffer()
      return { buffer: png, mimeType: 'image/png', extractedText: '' }
    } catch (err) {
      if (/gif/i.test(mimeType) || ext === '.gif') return { buffer, mimeType: 'image/gif', extractedText: '' }
      throw new Error(`图片格式转换失败：${err?.message || err}`)
    }
  }
  const inferred = mimeType || (ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png')
  return { buffer, mimeType: inferred, extractedText: '' }
}

async function describeImage({ buffer, mimeType }) {
  const cfg = getSkillImageVisionCredentials()
  if (cfg.enabled === false) throw new Error('识图功能未启用')
  const runtimes = getSkillImageVisionRuntimeCandidates()
    .filter(item => item?.apiKey && item?.baseURL && item?.model)
  if (!runtimes.length) throw new Error('未配置可用的多模态/GPT识图模型')
  const base64 = buffer.toString('base64')
  const timeoutSeconds = Math.min(Math.max(Number(cfg.apiTimeoutSeconds || 45), 5), 180)
  const errors = []
  const sanitizeRequestParams = value => {
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
  for (const runtime of runtimes) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
    try {
      const res = await fetch(`${String(runtime.baseURL || '').replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...sanitizeRequestParams(runtime.requestParams),
          model: runtime.model,
          temperature: 0.1,
          max_tokens: 650,
          messages: [
            { role: 'system', content: '你是知识库图片解析器。请只根据图片可见内容输出中文描述、OCR文字、关键标签，适合后续文本检索。' },
            { role: 'user', content: [
              { type: 'text', text: '请解析这张知识库图片，输出：1. 内容描述 2. 图中文字/OCR 3. 关键标签 4. 可供机器人回答使用的知识点。' },
              { type: 'image_url', image_url: { url: `data:${mimeType || 'image/png'};base64,${base64}` } },
            ] },
          ],
        }),
        signal: controller.signal,
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      if (!res.ok) throw new Error(json?.error?.message || json?.message || text.slice(0, 240) || `HTTP ${res.status}`)
      const content = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || ''
      const normalized = normalizeText(Array.isArray(content) ? content.map(p => p?.text || p?.content || '').join('\n') : content)
      if (!normalized) throw new Error('识图模型返回空内容')
      return normalized
    } catch (err) {
      errors.push(`${runtime.source || runtime.provider}/${runtime.model}: ${err?.message || err}`)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(errors.join('；').slice(0, 1000) || '识图失败')
}

async function parseImageFile({ buffer, fileName, mimeType }) {
  const normalized = await normalizeImageBuffer({ buffer, fileName, mimeType })
  let description = ''
  try {
    description = await describeImage({ buffer: normalized.buffer, mimeType: normalized.mimeType })
  } catch (err) {
    if (!normalized.extractedText) throw err
    description = `图片文本提取：\n${normalized.extractedText}\n\n识图未完成：${err?.message || err}`
  }
  return normalizeText([normalized.extractedText ? `SVG/图片内文字：\n${normalized.extractedText}` : '', description].filter(Boolean).join('\n\n'))
}

async function parseUrl(url = '') {
  const clean = String(url || '').trim()
  if (!/^https?:\/\//i.test(clean)) throw new Error('只支持 http/https 链接')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const jinaUrl = `https://r.jina.ai/${clean}`
    const errors = []
    let text = ''
    try {
      const res = await fetch(jinaUrl, { signal: controller.signal, headers: { Accept: 'text/plain,*/*' } })
      text = res.ok ? await res.text() : ''
      if (!res.ok) errors.push(`Jina 抓取失败：HTTP ${res.status}`)
    } catch (err) {
      errors.push(`Jina 抓取失败：${err?.message || err}`)
    }
    if (!text || text.length < 120) {
      try {
        const res = await fetch(clean, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 BailongmaKnowledgeBot/1.0' } })
        const html = res.ok ? await res.text() : ''
        if (!res.ok) errors.push(`原始链接抓取失败：HTTP ${res.status}`)
        text = html
          .replace(/<script[\s\S]*?<\/script>/giu, ' ')
          .replace(/<style[\s\S]*?<\/style>/giu, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
      } catch (err) {
        errors.push(`原始链接抓取失败：${err?.message || err}`)
      }
    }
    const body = normalizeText(text)
    if (!body || body.length < 40) {
      const detail = errors.length ? `（${errors.join('；')}）` : ''
      throw new Error(`链接没有可解析正文，可能需要登录或被反爬限制${detail}`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

async function makePreview({ title, sourceType, sourceUrl = '', fileName = '', mimeType = '', text = '', groups = [], scope = 'global', metadata = {} }) {
  const body = normalizeText(text)
  if (!body) throw new Error('解析结果为空')
  const chunks = chunkText(body).map((content, index) => ({ index, content }))
  return {
    id: crypto.randomUUID?.() || sha256(`${title}:${Date.now()}`).slice(0, 16),
    title: compactText(title || fileName || sourceUrl || '未命名知识').slice(0, 120),
    source_type: sourceType,
    source_url: sourceUrl,
    file_name: fileName,
    mime_type: mimeType,
    scope,
    groups,
    status: 'parsed',
    summary: summarizeText(body),
    raw_text: body,
    chunks,
    metadata,
    content_hash: sha256(`${sourceType}:${sourceUrl}:${fileName}:${body}`),
  }
}

function normalizeGroups(groups = []) {
  return (Array.isArray(groups) ? groups : [])
    .map(g => ({ id: String(g?.id || g?.group_id || g?.groupId || '').trim(), name: String(g?.name || g?.group_name || g?.groupName || g?.topic || '').trim() }))
    .filter(g => g.id)
}

export async function parseKnowledgeImport(payload = {}) {
  ensureKnowledgeSchema()
  const groups = normalizeGroups(payload.groups || payload.target?.groups || [])
  const scope = groups.length ? (payload.scope || payload.target?.scope || 'groups') : 'global'
  const previews = []
  const errors = []

  for (const item of payload.texts || []) {
    try {
      previews.push(await makePreview({ title: item.title || '手动知识', sourceType: 'manual', text: item.content || item.text || '', groups, scope, metadata: { input: 'manual' } }))
    } catch (err) { errors.push({ title: item.title || '手动知识', error: err.message }) }
  }
  for (const url of payload.urls || []) {
    const clean = typeof url === 'string' ? url : url?.url
    try {
      const body = await parseUrl(clean)
      previews.push(await makePreview({ title: typeof url === 'object' ? url.title : clean, sourceType: 'url', sourceUrl: clean, text: body, groups, scope, metadata: { input: 'url' } }))
    } catch (err) { errors.push({ title: clean, source_url: clean, error: err.message }) }
  }
  for (const file of payload.files || []) {
    const fileName = String(file.name || file.fileName || 'upload').trim()
    const mimeType = String(file.mimeType || file.type || '').trim()
    try {
      const buffer = file.base64 ? bufferFromBase64(file.base64) : Buffer.from(String(file.text || ''), 'utf8')
      const kind = sourceKindFromName(fileName, mimeType)
      const text = kind === 'image'
        ? await parseImageFile({ buffer, fileName, mimeType })
        : await parseOfficeFile({ buffer, fileName, mimeType })
      previews.push(await makePreview({ title: file.title || fileName, sourceType: kind === 'image' ? 'image' : kind, fileName, mimeType, text, groups, scope, metadata: { input: 'file', bytes: buffer.length } }))
    } catch (err) { errors.push({ title: fileName, file_name: fileName, error: err.message }) }
  }

  const now = nowTimestamp()
  const job = { ok: errors.length === 0, previews, errors, groups, scope, parser_version: PARSER_VERSION }
  const info = getDB().prepare(`INSERT INTO knowledge_import_jobs (status, payload_json, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(previews.length ? 'parsed' : 'error', JSON.stringify(job), errors.map(e => `${e.title}: ${e.error}`).join('\n').slice(0, 2000), now, now)
  return { ok: previews.length > 0, job_id: info.lastInsertRowid, previews, errors, groups, scope }
}

export async function commitKnowledgeImport(payload = {}) {
  ensureKnowledgeSchema()
  const sources = Array.isArray(payload.sources) ? payload.sources : []
  const targetGroups = normalizeGroups(payload.groups || payload.target?.groups || [])
  const db = getDB()
  const now = nowTimestamp()
  const committed = []
  const tx = db.transaction((prepared) => {
    for (const src of prepared) {
      const groups = normalizeGroups(src.groups?.length ? src.groups : targetGroups)
      const scope = groups.length ? (src.scope === 'global' ? 'global' : 'groups') : 'global'
      const title = compactText(src.title || src.file_name || src.source_url || '未命名知识').slice(0, 160)
      const raw = normalizeText(src.raw_text || (src.chunks || []).map(c => c.content || c).join('\n\n'))
      const info = db.prepare(`
        INSERT INTO knowledge_sources (title, source_type, source_url, file_name, mime_type, scope, status, enabled, summary, raw_text, content_hash, parser_version, error, metadata_json, created_at, updated_at, committed_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
      `).run(title, src.source_type || 'manual', src.source_url || '', src.file_name || '', src.mime_type || '', scope, src.enabled === false ? 0 : 1, compactText(src.summary || summarizeText(raw)).slice(0, 1000), raw, src.content_hash || sha256(raw), PARSER_VERSION, JSON.stringify(src.metadata || {}), now, now, now)
      const sourceId = info.lastInsertRowid
      for (const g of groups) db.prepare(`INSERT OR IGNORE INTO knowledge_source_groups (source_id, group_id, group_name, created_at) VALUES (?, ?, ?, ?)`).run(sourceId, g.id, g.name, now)
      const chunks = (src.chunks?.length ? src.chunks : chunkText(raw).map((content, index) => ({ index, content }))).filter(c => compactText(c.content || c))
      for (let i = 0; i < chunks.length; i++) {
        const content = normalizeText(chunks[i].content || chunks[i])
        db.prepare(`INSERT INTO knowledge_chunks (source_id, chunk_index, content, embedding, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(sourceId, i, content, chunks[i].embedding || null, JSON.stringify(chunks[i].metadata || {}), now)
      }
      committed.push({ id: sourceId, title, chunks: chunks.length })
    }
  })
  const prepared = []
  for (const src of sources) {
    const chunks = []
    for (const [i, c] of (src.chunks || []).entries()) {
      const content = normalizeText(c.content || c)
      if (content) chunks.push({ ...(typeof c === 'object' ? c : {}), index: i, content, embedding: await embeddingFor(content) })
    }
    prepared.push({ ...src, chunks })
  }
  tx(prepared)
  return { ok: true, committed }
}

function safeRow(row = {}) {
  const copy = { ...row }
  delete copy.embedding
  copy.metadata = safeJson(copy.metadata_json, {})
  delete copy.metadata_json
  return copy
}

export function listKnowledgeSources({ status = '', type = '', groupId = '', q = '', limit = 80 } = {}) {
  ensureKnowledgeSchema()
  const db = getDB()
  const clauses = ['1=1']
  const params = []
  if (status) { clauses.push('s.status = ?'); params.push(status) }
  if (type) { clauses.push('s.source_type = ?'); params.push(type) }
  if (q) { clauses.push('(s.title LIKE ? OR s.summary LIKE ? OR s.raw_text LIKE ? OR s.source_url LIKE ? OR s.file_name LIKE ?)'); params.push(...Array(5).fill(`%${String(q).slice(0, 80)}%`)) }
  if (groupId === '__global__') clauses.push("s.scope = 'global'")
  else if (groupId) { clauses.push("(s.scope = 'global' OR EXISTS (SELECT 1 FROM knowledge_source_groups g WHERE g.source_id=s.id AND g.group_id=?))"); params.push(groupId) }
  const rows = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.source_id=s.id) AS chunk_count,
      (SELECT GROUP_CONCAT(group_name || '|' || group_id, ';;') FROM knowledge_source_groups g WHERE g.source_id=s.id) AS group_concat
    FROM knowledge_sources s
    WHERE ${clauses.join(' AND ')}
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit || 80), 1), 300))
  return rows.map(row => {
    const groups = String(row.group_concat || '').split(';;').filter(Boolean).map(item => {
      const [name, id] = item.split('|')
      return { id, name }
    })
    return { ...safeRow(row), groups }
  })
}

export async function searchKnowledge({ q = '', groupId = '', limit = 8 } = {}) {
  ensureKnowledgeSchema()
  const query = compactText(q)
  if (!query) return { ok: false, error: 'missing query', items: [] }
  const db = getDB()
  const params = []
  let scopeSql = "s.enabled=1 AND s.status='active'"
  if (groupId) {
    scopeSql += " AND (s.scope='global' OR EXISTS (SELECT 1 FROM knowledge_source_groups g WHERE g.source_id=s.id AND g.group_id=?))"
    params.push(groupId)
  }
  const like = `%${query.slice(0, 80)}%`
  const keyword = db.prepare(`
    SELECT c.id AS chunk_id, c.content, c.chunk_index, s.*, 1.0 AS score
    FROM knowledge_chunks c JOIN knowledge_sources s ON s.id=c.source_id
    WHERE ${scopeSql} AND (c.content LIKE ? OR s.title LIKE ? OR s.summary LIKE ?)
    ORDER BY s.updated_at DESC LIMIT ?
  `).all(...params, like, like, like, Math.min(Math.max(Number(limit || 8), 1), 30))
  const qbuf = await embeddingFor(query)
  const vectorRows = db.prepare(`
    SELECT c.id AS chunk_id, c.content, c.chunk_index, c.embedding, s.*
    FROM knowledge_chunks c JOIN knowledge_sources s ON s.id=c.source_id
    WHERE ${scopeSql} AND c.embedding IS NOT NULL
    ORDER BY c.id DESC LIMIT 1600
  `).all(...params).map(row => ({ ...row, score: cosineSimilarityBuffer(qbuf, row.embedding) })).filter(row => row.score > 0.12)
  const merged = new Map()
  for (const row of [...keyword, ...vectorRows]) {
    const old = merged.get(row.chunk_id)
    if (!old || Number(row.score || 0) > Number(old.score || 0)) merged.set(row.chunk_id, row)
  }
  const items = [...merged.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, Math.min(Math.max(Number(limit || 8), 1), 20)).map(safeRow)
  if (items.length) {
    const now = nowTimestamp()
    const ids = [...new Set(items.map(i => i.source_id || i.id).filter(Boolean))]
    const bump = db.prepare(`UPDATE knowledge_sources SET hit_count=hit_count+1, last_hit_at=? WHERE id=?`)
    for (const id of ids) bump.run(now, id)
  }
  return { ok: true, q: query, group_id: groupId, items }
}

export async function getExternalKnowledgeContext({ groupId = '', query = '', limit = 8 } = {}) {
  const result = await searchKnowledge({ q: query, groupId, limit })
  const rows = result.items || []
  if (!rows.length) return '<external-knowledge-context>当前群/全局外部知识库没有命中。</external-knowledge-context>'
  const lines = rows.map(row => {
    const scope = row.scope === 'global' ? '全局' : '本群'
    const src = row.source_url || row.file_name || row.title || `#${row.source_id}`
    return `- [${scope}] ${row.title || '未命名'}｜来源：${src}｜内容：${compactText(row.content).slice(0, 520)}`
  })
  return `<external-knowledge-context query="${compactText(query).slice(0, 120)}">\n${lines.join('\n')}\n</external-knowledge-context>`
}

export async function getKnowledgeStatus() {
  ensureKnowledgeSchema()
  const db = getDB()
  const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params)?.n || 0)
  const honcho = getHonchoConfig()
  const docker = (() => {
    try {
      execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 2500 })
      return { ok: true, status: 'running' }
    } catch (err) {
      return { ok: false, status: 'unavailable', error: err?.message || String(err) }
    }
  })()
  let honchoHealth = { ok: false, configured: !!honcho.apiKey, enabled: !!honcho.enabled, baseURL: honcho.baseURL || '' }
  if (honcho.enabled && honcho.baseURL) {
    try {
      const res = await fetch(`${String(honcho.baseURL).replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout?.(2500) })
      honchoHealth = { ...honchoHealth, ok: res.ok, status: res.status, message: res.ok ? '已接通' : `HTTP ${res.status}` }
    } catch (err) {
      honchoHealth = { ...honchoHealth, ok: false, error: err?.message || String(err) }
    }
  }
  const groups = db.prepare(`
    SELECT group_id, group_name, COUNT(*) AS n, MAX(created_at) AS updated_at
    FROM knowledge_source_groups GROUP BY group_id, group_name ORDER BY updated_at DESC
  `).all()
  return {
    ok: true,
    honcho: honchoHealth,
    docker,
    embedding: getEmbeddingConfig(),
    counts: {
      sources: scalar('SELECT COUNT(*) AS n FROM knowledge_sources'),
      active: scalar("SELECT COUNT(*) AS n FROM knowledge_sources WHERE status='active' AND enabled=1"),
      global: scalar("SELECT COUNT(*) AS n FROM knowledge_sources WHERE scope='global'"),
      group: scalar('SELECT COUNT(DISTINCT source_id) AS n FROM knowledge_source_groups'),
      image: scalar("SELECT COUNT(*) AS n FROM knowledge_sources WHERE source_type='image'"),
      failed: scalar("SELECT COUNT(*) AS n FROM knowledge_sources WHERE status='error'"),
      chunks: scalar('SELECT COUNT(*) AS n FROM knowledge_chunks'),
    },
    groups,
  }
}

export async function reparseKnowledgeSource({ id } = {}) {
  ensureKnowledgeSchema()
  const db = getDB()
  const row = db.prepare(`SELECT * FROM knowledge_sources WHERE id=?`).get(Number(id || 0))
  if (!row) return { ok: false, error: 'knowledge source not found' }
  const groups = db.prepare(`SELECT group_id AS id, group_name AS name FROM knowledge_source_groups WHERE source_id=?`).all(row.id)
  const preview = await makePreview({ title: row.title, sourceType: row.source_type, sourceUrl: row.source_url, fileName: row.file_name, mimeType: row.mime_type, text: row.raw_text, groups, scope: row.scope, metadata: safeJson(row.metadata_json, {}) })
  return { ok: true, preview }
}

export async function updateKnowledgeSource({ id, title, summary, enabled, status, chunks } = {}) {
  ensureKnowledgeSchema()
  const db = getDB()
  const sourceId = Number(id || 0)
  const row = db.prepare(`SELECT * FROM knowledge_sources WHERE id=?`).get(sourceId)
  if (!row) return { ok: false, error: 'knowledge source not found' }
  const now = nowTimestamp()
  db.prepare(`UPDATE knowledge_sources SET title=?, summary=?, enabled=?, status=?, updated_at=? WHERE id=?`)
    .run(title != null ? compactText(title).slice(0, 160) : row.title, summary != null ? compactText(summary).slice(0, 1000) : row.summary, enabled == null ? row.enabled : (enabled ? 1 : 0), status || row.status, now, sourceId)
  if (Array.isArray(chunks)) {
    db.prepare(`DELETE FROM knowledge_chunks WHERE source_id=?`).run(sourceId)
    for (let i = 0; i < chunks.length; i++) {
      const content = normalizeText(chunks[i]?.content || chunks[i])
      if (!content) continue
      db.prepare(`INSERT INTO knowledge_chunks (source_id, chunk_index, content, embedding, metadata_json, created_at) VALUES (?, ?, ?, ?, '{}', ?)`)
        .run(sourceId, i, content, await embeddingFor(content), now)
    }
  }
  return { ok: true, item: listKnowledgeSources({ limit: 1 }).find(item => item.id === sourceId) || { id: sourceId } }
}

export function deleteKnowledgeSource({ id } = {}) {
  ensureKnowledgeSchema()
  const sourceId = Number(id || 0)
  if (!sourceId) return { ok: false, error: 'missing id' }
  const db = getDB()
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM knowledge_chunks WHERE source_id=?`).run(sourceId)
    db.prepare(`DELETE FROM knowledge_source_groups WHERE source_id=?`).run(sourceId)
    db.prepare(`DELETE FROM knowledge_sources WHERE id=?`).run(sourceId)
  })
  tx()
  return { ok: true, deleted: sourceId }
}
