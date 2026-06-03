import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { paths } from '../paths.js'
import { getSkillVideoAnalysisCredentials, getSkillVideoAnalysisRuntimeCandidates } from '../config.js'
import { normalizeWechatMessageType } from './wechat-group-stats.js'

const TEMP_ROOT = path.join(paths.dataDir, 'wechat-video-temp')
const VIDEO_ANALYSIS_REQUEST_RE = /(?:总结|概括|解析|分析|看看|看下|查看|读|理解|解释|说说|提取|识别|讲了啥|讲的啥|内容).{0,30}(?:视频|短视频|录像|录屏|影片)|(?:视频|短视频|录像|录屏|影片).{0,30}(?:总结|概括|解析|分析|看看|看下|查看|读|理解|解释|内容|讲了啥|讲的啥)/iu
const VIDEO_EXT_MIME = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.mkv', 'video/x-matroska'],
])

let lastRun = null

export function isWechatVideoAnalysisIntent(text = '') {
  return VIDEO_ANALYSIS_REQUEST_RE.test(String(text || ''))
}

export function isWechatVideoMessageType(messageType = '') {
  const type = normalizeWechatMessageType(messageType)
  return /(?:^|_)(?:video|short_video|type_15|15)(?:$|_)/iu.test(String(type || '')) || String(messageType) === '15'
}

function safeVideoName(name = '', fallback = 'wechat-video.mp4') {
  const base = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(-160)
  return base || fallback
}

function inferVideoMime(filePath = '') {
  return VIDEO_EXT_MIME.get(path.extname(String(filePath || '').toLowerCase())) || 'video/mp4'
}

function cleanupTempDir(dir = '') {
  const target = String(dir || '')
  if (!target) return { ok: true, deleted: false }
  const resolvedRoot = path.resolve(TEMP_ROOT)
  const resolvedTarget = path.resolve(target)
  const diff = path.relative(resolvedRoot, resolvedTarget)
  if (!diff || diff.startsWith('..') || path.isAbsolute(diff)) return { ok: false, error: 'invalid temp dir' }
  try {
    fs.rmSync(resolvedTarget, { recursive: true, force: true })
    return { ok: true, deleted: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

export async function saveWechatVideoToTemp(message, { messageId = '' } = {}) {
  if (!message?.toFileBox) return { ok: false, error: '当前 Wechaty 消息不支持读取视频文件' }
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const dir = path.join(TEMP_ROOT, runId)
  fs.mkdirSync(dir, { recursive: true })
  try {
    const fileBox = await message.toFileBox()
    const rawName = safeVideoName(fileBox?.name || `wechat-video-${messageId || Date.now()}.mp4`)
    const filePath = path.join(dir, rawName)
    await fileBox.toFile(filePath, true)
    const stat = fs.statSync(filePath)
    return { ok: true, filePath, tempDir: dir, fileName: rawName, bytes: stat.size, mimeType: inferVideoMime(filePath) }
  } catch (err) {
    cleanupTempDir(dir)
    return { ok: false, error: err?.message || String(err), tempDir: dir }
  }
}

function normalizeRuntime(channel = {}) {
  return {
    provider: channel.provider || 'video',
    baseURL: String(channel.baseUrl || channel.baseURL || '').replace(/\/+$/, ''),
    model: String(channel.model || '').trim(),
    apiKey: String(channel.apiKey || '').trim(),
    name: String(channel.name || channel.model || '视频解析渠道').trim(),
  }
}

async function callVideoRuntime(runtime, { videoPath = '', mimeType = 'video/mp4', question = '', timeoutSeconds = 90 } = {}) {
  const base64 = fs.readFileSync(videoPath).toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(15, Number(timeoutSeconds || 90)) * 1000)
  const started = Date.now()
  try {
    const res = await fetch(`${runtime.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: runtime.model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${question || '请用中文看懂这个微信群视频，概括主要内容、关键人物/画面、文字信息和可能的意图。'}\n\n回答要简洁，先给结论，再列关键细节。` },
              { type: 'video_url', video_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    const latencyMs = Date.now() - started
    if (!res.ok) {
      const message = json?.error?.message || json?.message || text.slice(0, 240) || `HTTP ${res.status}`
      return { ok: false, status: res.status, latencyMs, error: message, runtime: { provider: runtime.provider, model: runtime.model, baseURL: runtime.baseURL } }
    }
    const content = String(json?.choices?.[0]?.message?.content || '').trim()
    if (!content) return { ok: false, status: res.status, latencyMs, error: '视频解析接口返回空内容', runtime: { provider: runtime.provider, model: runtime.model, baseURL: runtime.baseURL } }
    return { ok: true, status: res.status, latencyMs, content, runtime: { provider: runtime.provider, model: runtime.model, baseURL: runtime.baseURL } }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: err?.name === 'AbortError' ? `视频解析超时（${timeoutSeconds} 秒）` : (err?.message || String(err)), runtime: { provider: runtime.provider, model: runtime.model, baseURL: runtime.baseURL } }
  } finally {
    clearTimeout(timer)
  }
}

export async function analyzeWechatVideoFile({ videoPath = '', mimeType = '', question = '' } = {}) {
  const cfg = getSkillVideoAnalysisCredentials()
  if (cfg.enabled === false) return { ok: false, skipped: true, error: '视频解析 Skill 未启用' }
  const channels = getSkillVideoAnalysisRuntimeCandidates()
  if (!channels.length) return { ok: false, error: '视频解析模型渠道未配置，请到设置 > Skill 技能 > 视频解析渠道池 中至少启用一个可用渠道。' }
  const stat = fs.statSync(videoPath)
  const maxBytes = Math.max(1, Number(cfg.maxVideoBytesMB || 25)) * 1024 * 1024
  if (stat.size > maxBytes) return { ok: false, error: `视频文件过大：${(stat.size / 1024 / 1024).toFixed(1)}MB，当前上限 ${cfg.maxVideoBytesMB || 25}MB` }
  const failures = []
  for (const channel of channels) {
    const runtime = normalizeRuntime(channel)
    if (!runtime.baseURL || !runtime.model || !runtime.apiKey) continue
    const result = await callVideoRuntime(runtime, {
      videoPath,
      mimeType: mimeType || inferVideoMime(videoPath),
      question,
      timeoutSeconds: cfg.apiTimeoutSeconds,
    })
    if (result.ok) {
      lastRun = { ok: true, at: new Date().toISOString(), runtime: result.runtime, latencyMs: result.latencyMs, bytes: stat.size }
      return result
    }
    failures.push(`${runtime.name}: ${result.error || 'unknown'}`)
    if (cfg.failoverEnabled === false) break
  }
  const error = failures.join('；').slice(0, 700) || '所有视频解析渠道均不可用'
  lastRun = { ok: false, at: new Date().toISOString(), error, bytes: stat.size }
  return { ok: false, error: `视频解析失败：${error}` }
}

export async function analyzeWechatVideoMessage({ message, text = '', messageType = '', messageId = '' } = {}) {
  if (!isWechatVideoMessageType(messageType)) return { ok: false, skipped: true, error: 'not_video_message' }
  let saved = null
  let response = null
  try {
    saved = await saveWechatVideoToTemp(message, { messageId })
    if (!saved.ok) return saved
    const result = await analyzeWechatVideoFile({ videoPath: saved.filePath, mimeType: saved.mimeType, question: text })
    response = { ...result, tempDeleted: false, tempDir: saved.tempDir, fileName: saved.fileName, bytes: saved.bytes }
    return response
  } finally {
    if (saved?.tempDir) {
      const cleanup = cleanupTempDir(saved.tempDir)
      if (lastRun) lastRun.tempDeleted = cleanup.ok && cleanup.deleted
      if (response) response.tempDeleted = cleanup.ok && cleanup.deleted
    }
  }
}

export function getWeChatVideoAnalysisStatus() {
  const cfg = getSkillVideoAnalysisCredentials()
  const runtime = getSkillVideoAnalysisRuntimeCandidates()[0] || null
  return {
    enabled: cfg.enabled !== false,
    configured: !!runtime,
    runtime: runtime ? { provider: runtime.provider, model: runtime.model, baseURL: runtime.baseUrl || runtime.baseURL || '', source: 'skill' } : null,
    tempDir: TEMP_ROOT,
    lastRun,
  }
}

export const __internals = {
  TEMP_ROOT,
  cleanupTempDir,
  inferVideoMime,
  callVideoRuntime,
}
