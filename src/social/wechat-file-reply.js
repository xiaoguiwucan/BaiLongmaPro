import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { paths } from '../paths.js'

const REPLY_FILE_DIR = path.join(paths.dataDir, 'wechat-reply-files')
const MAX_REPLY_FILE_TEXT_CHARS = 240_000

const FORMAT_ALIASES = new Map(Object.entries({
  text: 'txt',
  plain: 'txt',
  txt: 'txt',
  markdown: 'md',
  md: 'md',
  py: 'py',
  python: 'py',
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  typescript: 'ts',
  json: 'json',
  csv: 'csv',
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  word: 'docx',
  doc: 'docx',
  docx: 'docx',
  excel: 'xlsx',
  excle: 'xlsx',
  xls: 'xlsx',
  xlsx: 'xlsx',
  ppt: 'pptx',
  pptx: 'pptx',
  powerpoint: 'pptx',
  presentation: 'pptx',
}))

const MIME_BY_FORMAT = {
  txt: 'text/plain',
  md: 'text/markdown',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const FILE_REQUEST_FORMAT_PATTERNS = [
  { format: 'txt', re: /(?:txt|text|纯文本|文本(?:文档|文件)?|文本文档|记事本)(?:格式|文件|文档)?/iu },
  { format: 'md', re: /(?:md|markdown|马克飞象|Markdown)(?:格式|文件|文档)?/iu },
  { format: 'py', re: /(?:py|python|Python)(?:脚本|代码|格式|文件|文档)?/iu },
  { format: 'js', re: /(?:js|javascript|JavaScript)(?:脚本|代码|格式|文件|文档)?/iu },
  { format: 'ts', re: /(?:ts|typescript|TypeScript)(?:脚本|代码|格式|文件|文档)?/iu },
  { format: 'json', re: /(?:json|JSON)(?:格式|文件|文档)?/iu },
  { format: 'csv', re: /(?:csv|CSV)(?:表格|格式|文件|文档)?/iu },
  { format: 'html', re: /(?:html|HTML|网页)(?:格式|文件|文档)?/iu },
  { format: 'pdf', re: /(?:pdf|PDF)(?:格式|文件|文档)?/iu },
  { format: 'docx', re: /(?:word|Word|docx?|DOCX?)(?:格式|文件|文档)?/iu },
  { format: 'xlsx', re: /(?:excel|Excel|excle|xlsx?|XLSX?)(?:表格|格式|文件|文档)?/iu },
  { format: 'pptx', re: /(?:ppt|PPT|pptx|PPTX|powerpoint|PowerPoint)(?:演示|格式|文件|文档)?/iu },
]

export function normalizeWechatReplyFileFormat(format = '', fileName = '') {
  const raw = String(format || '').trim().toLowerCase().replace(/^\./, '')
  if (raw && FORMAT_ALIASES.has(raw)) return FORMAT_ALIASES.get(raw)
  const ext = path.extname(String(fileName || '').trim()).replace(/^\./, '').toLowerCase()
  if (ext && FORMAT_ALIASES.has(ext)) return FORMAT_ALIASES.get(ext)
  return ''
}

export function detectWechatReplyFileRequest(text = '') {
  const value = String(text || '').trim()
  if (!value) return { requested: false, format: '', reason: 'empty' }
  const asksForFile = /(?:发|发送|给我|传|用|以|导出|生成|做成|整理成|保存成|写成|转成).{0,40}(?:格式|文件|文档|附件|表格|脚本|代码|演示)|(?:格式|文件|文档|附件|表格|脚本|代码|演示).{0,40}(?:发|发送|给我|传|导出|生成|做成|整理成|保存成|写成|转成)/iu.test(value)
  if (!asksForFile && !/[.。]\s*(?:txt|md|py|js|ts|json|csv|html|pdf|docx?|xlsx?|pptx?)\b/iu.test(value)) {
    return { requested: false, format: '', reason: 'no_file_intent' }
  }
  for (const item of FILE_REQUEST_FORMAT_PATTERNS) {
    if (item.re.test(value)) return { requested: true, format: item.format, reason: 'format_mentioned' }
  }
  return { requested: asksForFile, format: 'txt', reason: asksForFile ? 'generic_file_request' : 'no_supported_format' }
}

export function hasExplicitWechatReplyFileFormatRequest(text = '') {
  const request = detectWechatReplyFileRequest(text)
  return request.requested && request.reason === 'format_mentioned' && !!request.format
}

export function isWechatReplyAcknowledgementOnly(content = '') {
  const body = String(content || '').trim()
  if (!body || body.length >= 100) return false
  return /^(?:好|好的|收到|可以|我来|马上|稍等|等我|安排|没问题|行|OK|ok|来了|接上|这就)[，,。.!！\s]*(?:我(?:来|会|这就)?|马上|稍后|给你|处理|整理|生成|写|发|安排|接着|继续)?.{0,50}$/iu.test(body)
}

export function isWechatSubstantiveReplyRequest(text = '') {
  const value = String(text || '').trim()
  if (!value) return false
  if (hasExplicitWechatReplyFileFormatRequest(value)) return true
  return /(?:\d{3,6}\s*(?:字|词|token|tokens)|长文|全文|完整|详细|详尽|报告|小说|故事|剧本|大纲|续写|继续|接着写|扩写|改写|整理|总结)/iu.test(value)
}

export function shouldAutoCreateWechatReplyFile({ userText = '', content = '' } = {}) {
  const request = detectWechatReplyFileRequest(userText)
  if (!request.requested) return { create: false, ...request }
  if (!hasExplicitWechatReplyFileFormatRequest(userText)) {
    return { create: false, ...request, reason: 'no_explicit_supported_format' }
  }
  const body = String(content || '').trim()
  if (!body) return { create: false, ...request, reason: 'empty_content' }
  const requestedLongForm = /(?:\d{3,6}\s*(?:字|词|token|tokens)|长文|全文|完整|详细|详尽|报告|小说|剧本|大纲|文档)/iu.test(String(userText || ''))
  const codeLikeFormat = /^(?:py|js|ts|json|html)$/u.test(request.format)
  const substantial = body.length >= 120 || body.split(/\n/u).filter(Boolean).length >= 4
  if (isWechatReplyAcknowledgementOnly(body) && !codeLikeFormat) return { create: false, ...request, reason: 'ack_only' }
  return { create: requestedLongForm || codeLikeFormat || substantial, ...request, reason: 'auto_attachment' }
}

export function defaultWechatReplyFileCaption(file = {}) {
  const format = String(file?.format || 'txt').toUpperCase()
  const name = String(file?.fileName || '').trim()
  return name ? `已按要求生成 ${format} 文件：${name}` : `已按要求生成 ${format} 文件。`
}

export function isWechatReplyGeneratedFilePath(filePath = '') {
  try {
    const resolved = path.resolve(String(filePath || ''))
    const root = path.resolve(REPLY_FILE_DIR)
    return resolved === root || resolved.startsWith(`${root}${path.sep}`)
  } catch {
    return false
  }
}

function sanitizeBaseName(value = '', fallback = 'bailongma-reply') {
  const clean = String(value || '')
    .replace(/\.[a-z0-9]{1,8}$/iu, '')
    .replace(/[\\/:*?"<>|#%{}~`^()[\]\s]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return clean || fallback
}

function normalizeReplyText(content = '') {
  const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return text.length > MAX_REPLY_FILE_TEXT_CHARS
    ? `${text.slice(0, MAX_REPLY_FILE_TEXT_CHARS)}\n\n[内容过长，已截断]`
    : text
}

function xmlEscape(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function splitParagraphs(text = '') {
  return normalizeReplyText(text).split(/\n{2,}/u).map(part => part.trim()).filter(Boolean)
}

async function makeZipFile(entries = {}) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content)
  }
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function renderDocx(content = '') {
  const paragraphs = splitParagraphs(content)
  const body = (paragraphs.length ? paragraphs : [''])
    .map(paragraph => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(paragraph)}</w:t></w:r></w:p>`)
    .join('')
  return await makeZipFile({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  })
}

function renderXlsx(content = '') {
  const rows = normalizeReplyText(content).split('\n').map(line => [line])
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['']])
  ws['!cols'] = [{ wch: 100 }]
  XLSX.utils.book_append_sheet(wb, ws, '内容')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

async function renderPptx(content = '', title = '') {
  const text = normalizeReplyText(content)
  const chunks = splitParagraphs(text).join('\n').match(/[\s\S]{1,520}/g) || ['']
  const slideOverrides = {}
  const slideRels = {}
  const presentationSlideIds = []
  const presentationRels = []
  chunks.slice(0, 20).forEach((chunk, index) => {
    const n = index + 1
    const slideTitle = index === 0 && title ? title : `内容 ${n}`
    presentationSlideIds.push(`<p:sldId id="${255 + n}" r:id="rId${n}"/>`)
    presentationRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`)
    slideOverrides[`slide${n}`] = `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    slideRels[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
    slideRels[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="685800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>${xmlEscape(slideTitle)}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1371600"/><a:ext cx="7772400" cy="3657600"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr sz="2000"/><a:t>${xmlEscape(chunk)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  })
  return await makeZipFile({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${Object.values(slideOverrides).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${presentationSlideIds.join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presentationRels.join('')}</Relationships>`,
    ...slideRels,
  })
}

function pdfEscape(value = '') {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function renderPdf(content = '') {
  const lines = normalizeReplyText(content).split('\n').flatMap(line => {
    if (line.length <= 86) return [line]
    const out = []
    for (let i = 0; i < line.length; i += 86) out.push(line.slice(i, i + 86))
    return out
  }).slice(0, 180)
  const textOps = ['BT', '/F1 11 Tf', '50 790 Td']
  lines.forEach((line, index) => {
    if (index) textOps.push('0 -15 Td')
    textOps.push(`(${pdfEscape(line)}) Tj`)
  })
  textOps.push('ET')
  const stream = textOps.join('\n')
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${obj}\n`
  }
  const xrefAt = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}

async function renderReplyFile(format, content, title = '') {
  if (format === 'docx') return await renderDocx(content)
  if (format === 'xlsx') return renderXlsx(content)
  if (format === 'pptx') return await renderPptx(content, title)
  if (format === 'pdf') return renderPdf(content)
  return Buffer.from(normalizeReplyText(content), 'utf8')
}

export async function createWechatReplyFile({ content = '', format = '', fileName = '', title = '' } = {}) {
  const normalizedFormat = normalizeWechatReplyFileFormat(format, fileName) || 'txt'
  if (!MIME_BY_FORMAT[normalizedFormat]) throw new Error(`不支持的微信群回复文件格式：${format || fileName}`)
  const body = normalizeReplyText(content)
  if (!body.trim()) throw new Error('回复文件内容为空')
  fs.mkdirSync(REPLY_FILE_DIR, { recursive: true })
  const baseName = sanitizeBaseName(fileName || title || `bailongma-reply-${new Date().toISOString().slice(0, 10)}`)
  const suffix = crypto.randomBytes(4).toString('hex')
  const finalName = `${baseName}-${suffix}.${normalizedFormat}`
  const filePath = path.join(REPLY_FILE_DIR, finalName)
  const buffer = await renderReplyFile(normalizedFormat, body, title || baseName)
  fs.writeFileSync(filePath, buffer)
  return {
    ok: true,
    filePath,
    fileName: finalName,
    format: normalizedFormat,
    mimeType: MIME_BY_FORMAT[normalizedFormat],
    bytes: buffer.length,
    relativePath: path.relative(paths.userDir, filePath),
  }
}
