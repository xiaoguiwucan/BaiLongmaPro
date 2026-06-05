import qrcodeTerminal from 'qrcode-terminal'
import { WechatyBuilder, ScanStatus } from 'wechaty'
import { PuppetWechat4u } from 'wechaty-puppet-wechat4u'
import { FileBox } from 'file-box'
import { archiveWeChatGroupMessage, buildWeChatGroupCommandPrompt, formatGroupLine, isGroupSummaryRequest, makeWeChatGroupExternalId, WECHAT_GROUP_CHANNEL } from './wechat-groups.js'
import { getWechatyDutyGroupConfig, getWeChatGroupArchiveConfig, getWeChatGroupDigestConfig, setWechatyDutyGroupConfig, setWechatyDutyGroupRuntime } from '../config.js'
import { recordWeChatGroupMessage, recordWeChatGroupAssistantReply, recordWeChatGroupExplicitMemories } from './wechat-group-memory.js'
import { buildWeChatGroupStatsDigest, getWeChatGroupStats, isWeChatInternalIdLike, listWeChatGroupMembers, normalizeWechatMessageType, normalizeWeChatGroupDisplayText, recordWeChatGroupActivity, upsertWeChatGroupMemberName } from './wechat-group-stats.js'
import { renderWeChatGroupStatsPosterPng } from './wechat-group-report-renderer.js'
import { searchMemes } from './meme-search.js'
import { generateImageForWechat, isWechatImageGenerationRequest } from './image-generation-skill.js'
import { describeWeChatImageMedia, findWeChatImageMediaForQuote, findWeChatImageMediaForRequest, getWeChatImageVisionStatus, maybeDescribeWeChatImageMedia, resolveWeChatImageMediaFile, updateWeChatImageMediaItem, upsertWeChatImageMediaItem, waitForWeChatImageMediaDescription } from './wechat-image-vision.js'
import { isWechatReplyGeneratedFilePath } from './wechat-file-reply.js'
import { checkWeChatGroupCommandSafety } from './wechat-command-guard.js'
import { searchPublicImages } from './public-image-search.js'
import { extractWeChatQuoteContext } from './wechat-quote-context.js'
import { getClawbotStatus, sendClawbotSelfNotification } from './wechat-clawbot.js'
import { analyzeWechatVideoMessage, isWechatVideoAnalysisIntent, isWechatVideoMessageType } from './wechat-video-analysis-skill.js'
import { paths } from '../paths.js'
import { getDB } from '../db.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import QRCode from 'qrcode'

const FALLBACK_GROUP_NAMES = []
const WECHATY_MEMORY_NAME = path.join(paths.userDir, 'wechaty-duty-group')
const WECHATY_MEMORY_FILE = `${WECHATY_MEMORY_NAME}.memory-card.json`
const WECHAT_MEDIA_DIR = path.join(paths.dataDir, 'wechat-media')
const ROOM_REFRESH_STALE_MS = 2 * 60 * 1000
const MESSAGE_HEALTH_STALE_MS = 10 * 60 * 1000
const MEMBER_NAME_REFRESH_STALE_MS = 10 * 60 * 1000
const START_WATCHDOG_MS = 60 * 1000
const OFFLINE_DETECT_INTERVAL_MS = 30 * 1000
const STARTING_RELOGIN_REQUIRED_MS = 90 * 1000
const OFFLINE_QR_RELOGIN_MIN_INTERVAL_MS = 60 * 1000
const OFFLINE_QR_DIR = path.join(paths.dataDir, 'wechaty-login-qrcode')
const PUBLIC_IMAGE_URL_RE = /^https?:\/\/[^\s<>"'`]+\.(?:png|jpe?g|gif|webp)(?:[?#][^\s<>"'`]*)?$/iu
const LOCAL_FILE_REFERENCE_RE = /(?:file:\/\/|\/Users\/|~\/|[A-Za-z]:\\|(?:桌面|下载|文档|相册|截图|本机|本地).{0,20}(?:图片|文件|照片|截图))/iu
const DIRECT_MEME_REQUEST_RE = /(?:斗图|表情包|梗图|gif|动图|发.{0,4}表情|来.{0,4}表情|整.{0,4}表情|发.{0,3}图|来.{0,3}图|开心|难过|愤怒|生气|鄙视|无语|笑死|吃瓜|破防).{0,8}(?:表情|表情包|梗图|图|gif)?|(?:表情|表情包|梗图|gif|动图)$/iu
const DIRECT_PUBLIC_IMAGE_REQUEST_RE = /(?:找|搜|发|发送|来|给我|整).{0,12}(?:网络|网上|公开)?(?:图片|照片|壁纸|头像|配图|示意图|产品图|实拍图|图)(?!.*(?:表情包|表情|斗图|梗图|gif|动图))|(?:图片|照片|壁纸|头像|示意图).{0,8}(?:找|搜|发|来|给我)/iu
const IMAGE_UNDERSTANDING_REQUEST_RE = /(?:总结|概括|精简|识别|解析|分析|看看|看下|查看|读|理解|解释|说说|提取|压成).{0,24}(?:图|图片|照片|截图|海报|表格|内容|文字)|(?:图|图片|照片|截图|海报|表格).{0,24}(?:总结|概括|精简|识别|解析|分析|看看|看下|查看|读|理解|解释|内容|文字)/iu
const IMAGE_REPLY_META_DISCUSSION_RE = /(?:别|不要|别再|停止|禁止|避免).{0,12}(?:乱|胡乱)?.{0,12}(?:回复|解释|识别|解析|看).{0,12}(?:图|图片|图片内容)|(?:更新|修复|调整|优化|改|改一下|处理).{0,12}(?:图片|图).{0,12}(?:回复|接话|识图|识别|解析|逻辑|规则)|(?:提到|说到|包含).{0,8}(?:图片|图).{0,8}(?:两个字|这个词|就).{0,12}(?:回复|解释|识别|解析)/iu
const WECHAT_FOLLOWUP_WINDOW_MS = 10 * 1000
const WECHAT_MEDIA_WAIT_MS = 3200
const WECHAT_VIDEO_REFERENCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const WECHAT_IMAGE_REPLY_VISION_ATTEMPTS = 3
const WECHAT_IMAGE_REPLY_VISION_INTERVAL_MS = 5000

let bot = null
let status = 'idle' // idle | starting | qr_ready | logged_in | connected | error
let lastQr = ''
let lastQrAscii = ''
let lastError = ''
let wechatyGroupReplyEnabled = getWechatyDutyGroupConfig().enabled !== false
let targetGroupNames = getConfiguredGroupNames()
let targetRoomId = ''
let targetRoom = null
const targetRooms = new Map()
let pushMessageRef = null
let emitEventRef = null
let lastLoginUser = ''
let lastLoginUserId = ''
let lastLoginAt = 0
let roomSnapshot = []
let lastRoomRefreshAt = ''
let lastMessageAt = ''
let activePuppetName = ''
let reconnectTimer = null
let reconnectAttempts = 0
let suppressReconnectUntil = 0
let startWatchdogTimer = null
let offlineDetectTimer = null
let connectionAttemptStartedAt = 0
let lastOfflineAlertKey = ''
let offlineQrReloginInFlight = false
let lastOfflineQrReloginAt = 0
let lastClawbotQrNotifyKey = ''
let lastClawbotQrNotifyAt = 0
let lastClawbotQrNotifyError = ''
let lastClawbotQrNotifyResult = ''
const memberNameRefreshAt = new Map()
const recentWechatUserMessages = new Map()
const recentWechatGroupVideos = new Map()
const activeReplyLastAtByGroup = new Map()

function getWechatyActiveReplyConfig() {
  const cfg = getWechatyDutyGroupConfig().activeReply || {}
  const minInterval = Number(cfg.minIntervalSeconds ?? cfg.min_interval_seconds)
  return {
    enabled: cfg.enabled === true,
    minIntervalSeconds: Number.isFinite(minInterval) ? Math.min(3600, Math.max(10, Math.round(minInterval))) : 60,
  }
}

function shouldTriggerWechatyGroupReply({ mentionedSelf = false, isSelf = false, groupId = '', text = '' } = {}) {
  if (mentionedSelf) return { ok: true, reason: 'mention' }
  const activeReply = getWechatyActiveReplyConfig()
  if (!activeReply.enabled) return { ok: false, reason: 'active_reply_disabled' }
  if (isSelf) return { ok: false, reason: 'self_message' }
  const cleanText = String(text || '').trim()
  if (!cleanText) return { ok: false, reason: 'empty_text' }
  const key = String(groupId || '').trim()
  const now = Date.now()
  const minIntervalMs = activeReply.minIntervalSeconds * 1000
  const lastAt = Number(activeReplyLastAtByGroup.get(key) || 0)
  if (lastAt && now - lastAt < minIntervalMs) {
    return { ok: false, reason: 'active_reply_cooldown', cooldownRemainingMs: minIntervalMs - (now - lastAt) }
  }
  activeReplyLastAtByGroup.set(key, now)
  return { ok: true, reason: 'active_reply' }
}

function isWechatyBlockedSender(senderId = '') {
  const id = String(senderId || '').trim()
  if (!id) return false
  const blockedIds = getWechatyDutyGroupConfig().blockedWechatIds || []
  return blockedIds.map(item => String(item || '').trim()).includes(id)
}

function waitWechatMediaWindow(ms = WECHAT_MEDIA_WAIT_MS) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

async function withWechatySendTimeout(promise, ms = 15000, label = 'wechat send') {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(ms / 1000)}s`)), Math.max(1000, Number(ms || 15000)))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function getOfflineQrNotifyConfig() {
  try {
    const cfg = getWechatyDutyGroupConfig().offlineQrNotify || {}
    const cooldown = Number(cfg.cooldownMinutes || 15)
    return {
      enabled: cfg.enabled !== false,
      cooldownMinutes: [5, 10, 15, 30, 60].includes(cooldown) ? cooldown : 15,
      autoRelogin: cfg.autoRelogin !== false,
    }
  } catch {
    return { enabled: true, cooldownMinutes: 15, autoRelogin: true }
  }
}

function hashWechatyQr(qr = '') {
  return crypto.createHash('sha256').update(String(qr || '')).digest('hex').slice(0, 16)
}

function getOfflineQrNotifyState() {
  const cfg = getOfflineQrNotifyConfig()
  const clawbot = getClawbotStatus()
  return {
    enabled: cfg.enabled,
    cooldown_minutes: cfg.cooldownMinutes,
    auto_relogin: cfg.autoRelogin,
    clawbot_connected: clawbot.connected === true,
    clawbot_status: clawbot.status,
    clawbot_self_context_ready: clawbot.self_context_ready === true,
    last_sent_at: lastClawbotQrNotifyAt ? new Date(lastClawbotQrNotifyAt).toISOString() : '',
    last_result: lastClawbotQrNotifyResult,
    last_error: lastClawbotQrNotifyError,
    has_qr: !!lastQr,
  }
}

export function buildWechatyOfflineQrNotifyCaption({ reason = '', hint = '', loginUser = '', groupNames = [], now = new Date() } = {}) {
  const groups = (Array.isArray(groupNames) ? groupNames : [])
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('、')
  const lines = [
    '⚠️ 微信群助手已离线，需要重新扫码登录。',
    loginUser ? `上次登录：${loginUser}` : '',
    groups ? `接入群组：${groups}` : '',
    hint ? `状态：${hint}` : '',
    reason ? `触发原因：${reason}` : '',
    `时间：${now.toLocaleString('zh-CN', { hour12: false })}`,
    '请扫描随附二维码恢复微信群助手登录。',
  ].filter(Boolean)
  return lines.join('\n')
}

export function shouldThrottleWechatyOfflineQrNotify({ enabled = true, qr = '', lastKey = '', lastAt = 0, cooldownMinutes = 15, now = Date.now(), force = false } = {}) {
  if (!enabled) return { throttled: true, reason: 'disabled' }
  const key = hashWechatyQr(qr)
  if (!qr || !key) return { throttled: true, reason: 'no_qr' }
  const cooldownMs = Math.max(1, Number(cooldownMinutes || 15)) * 60 * 1000
  if (!force && lastKey === key && Number(now || Date.now()) - Number(lastAt || 0) < cooldownMs) {
    return { throttled: true, reason: 'cooldown', key }
  }
  return { throttled: false, key }
}

async function ensureWechatyQrImageFile(qr = '') {
  const value = String(qr || '').trim()
  if (!value) throw new Error('wechaty qr missing')
  const key = hashWechatyQr(value)
  fs.mkdirSync(OFFLINE_QR_DIR, { recursive: true })
  const file = path.join(OFFLINE_QR_DIR, `wechaty-login-${key}.png`)
  if (!fs.existsSync(file)) {
    await QRCode.toFile(file, value, {
      type: 'png',
      width: 420,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
  }
  return { file, key }
}

async function notifyWechatyLoginQrViaClawbot(reason = '', { force = false } = {}) {
  const cfg = getOfflineQrNotifyConfig()
  const throttle = shouldThrottleWechatyOfflineQrNotify({
    enabled: cfg.enabled,
    qr: lastQr,
    lastKey: lastClawbotQrNotifyKey,
    lastAt: lastClawbotQrNotifyAt,
    cooldownMinutes: cfg.cooldownMinutes,
    force,
  })
  if (throttle.throttled) return { ok: false, skipped: true, reason: throttle.reason }

  try {
    const { file, key } = await ensureWechatyQrImageFile(lastQr)
    const hint = getConnectionHint({ online: false, rooms: roomSnapshot })
    const caption = buildWechatyOfflineQrNotifyCaption({
      reason,
      hint,
      loginUser: previousLoginUser(),
      groupNames: targetGroupNames,
    })
    const fallbackText = `${caption}\n\n二维码内容：${lastQr}`
    const result = await sendClawbotSelfNotification({ text: caption, imagePath: file, fallbackText })
    if (result?.ok) {
      lastClawbotQrNotifyKey = key
      lastClawbotQrNotifyAt = Date.now()
      lastClawbotQrNotifyError = ''
      lastClawbotQrNotifyResult = result.image ? 'image_sent' : (result.fallback ? 'text_fallback_sent' : 'text_sent')
      console.log(`[WechatyOfflineQR] 已通过 ClawBot 自通知发送登录二维码 result=${lastClawbotQrNotifyResult}`)
      emitWechatyStatusEvent({ offline_qr_notify: getOfflineQrNotifyState() })
      return { ok: true, ...result }
    }
    lastClawbotQrNotifyError = result?.error || result?.reason || 'ClawBot notification failed'
    lastClawbotQrNotifyResult = 'failed'
    console.warn(`[WechatyOfflineQR] ClawBot 自通知失败：${lastClawbotQrNotifyError}`)
    emitWechatyStatusEvent({ offline_qr_notify: getOfflineQrNotifyState() })
    return { ok: false, ...result }
  } catch (err) {
    lastClawbotQrNotifyError = err?.message || String(err)
    lastClawbotQrNotifyResult = 'failed'
    console.warn(`[WechatyOfflineQR] 发送登录二维码失败：${lastClawbotQrNotifyError}`)
    emitWechatyStatusEvent({ offline_qr_notify: getOfflineQrNotifyState() })
    return { ok: false, error: lastClawbotQrNotifyError }
  }
}

export async function sendWechatyOfflineQrNotifyNow({ reason = 'manual_test', force = true } = {}) {
  const cfg = getOfflineQrNotifyConfig()
  if (!cfg.enabled) return { ok: false, skipped: true, reason: 'disabled', state: getOfflineQrNotifyState() }
  if (lastQr) {
    const result = await notifyWechatyLoginQrViaClawbot(reason, { force })
    return { ...result, state: getOfflineQrNotifyState() }
  }
  if (cfg.autoRelogin && needsWechatyRelogin()) {
    requestOfflineQrNotification(reason || 'manual_test')
    return { ok: false, skipped: true, reason: 'qr_generation_requested', state: getOfflineQrNotifyState() }
  }
  return { ok: false, skipped: true, reason: 'no_qr', state: getOfflineQrNotifyState() }
}

export function extractPublicImageUrlsFromWechatText(content = '') {
  const text = String(content || '')
  const urls = new Set()
  for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/giu)) {
    if (PUBLIC_IMAGE_URL_RE.test(match[1])) urls.add(match[1])
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`）)]+/giu)) {
    const url = match[0].replace(/[。。，，、；;]+$/u, '')
    if (PUBLIC_IMAGE_URL_RE.test(url)) urls.add(url)
  }
  return [...urls].slice(0, 3)
}

export function stripImageMarkdown(content = '', imageUrls = []) {
  let text = String(content || '')
  for (const url of imageUrls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 同时剥离 Markdown 图片、Markdown 链接和裸 URL；微信群里只发图片/GIF，不展示链接文本。
    text = text.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    text = text.replace(new RegExp(`\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    text = text.replace(new RegExp(escaped, 'g'), '')
  }
  return text
    .replace(/https?:\/\/[^\s<>"'`）)]+/giu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getRecentWechatKey(groupId = '', senderId = '', senderName = '') {
  return `${String(groupId || '').trim()}::${String(senderId || senderName || '').trim()}`
}

function rememberRecentWechatUserMessage({ groupId = '', senderId = '', senderName = '', text = '', mediaId = '', messageType = '', mentionedSelf = false, message = null, messageId = '' } = {}) {
  const key = getRecentWechatKey(groupId, senderId, senderName)
  if (!key || key.endsWith('::')) return
  const now = Date.now()
  const list = recentWechatUserMessages.get(key) || []
  list.push({
    at: now,
    text: String(text || '').trim(),
    mediaId: mediaId ? Number(mediaId) : 0,
    messageType: String(messageType || ''),
    mentionedSelf: !!mentionedSelf,
    messageId: String(messageId || message?.id || ''),
    videoMessage: isWechatVideoMessageType(messageType) && message?.toFileBox ? message : null,
  })
  const fresh = list.filter(item => now - Number(item.at || 0) <= WECHAT_FOLLOWUP_WINDOW_MS * 3).slice(-20)
  recentWechatUserMessages.set(key, fresh)
  if (isWechatVideoMessageType(messageType) && message?.toFileBox) {
    rememberRecentWechatGroupVideo({ groupId, senderId, senderName, message, messageType, text, messageId: messageId || message?.id || '' })
  }
}

function getRecentWechatUserMessages({ groupId = '', senderId = '', senderName = '', windowMs = WECHAT_FOLLOWUP_WINDOW_MS } = {}) {
  const key = getRecentWechatKey(groupId, senderId, senderName)
  const now = Date.now()
  return (recentWechatUserMessages.get(key) || [])
    .filter(item => now - Number(item.at || 0) <= windowMs)
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
}

function stripWechatAtTokens(text = '') {
  return String(text || '')
    .replace(/[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,。.!！?？：:、]{1,40}/gu, ' ')
    .replace(/[\s\u2005\u2006\u2007\u2008\u2009\u200a，,。.!！?？：:、]+/gu, ' ')
    .trim()
}

function isBareWechatMentionText(text = '') {
  return !stripWechatAtTokens(text)
}

function hasWechatImageUnderstandingIntent(text = '') {
  const value = String(text || '')
  if (IMAGE_REPLY_META_DISCUSSION_RE.test(value)) return false
  return IMAGE_UNDERSTANDING_REQUEST_RE.test(value)
}

function buildRecentWechatCombinedText({ groupId = '', senderId = '', senderName = '', fallback = '' } = {}) {
  const lines = getRecentWechatUserMessages({ groupId, senderId, senderName })
    .map(item => item.text || (item.mediaId ? '[图片]' : ''))
    .filter(Boolean)
  if (!lines.length) return String(fallback || '').trim()
  return [...new Set(lines)].join('\n').trim()
}

function buildWechatImageUnderstandingText({ groupId = '', senderId = '', senderName = '', fallback = '' } = {}) {
  const combined = buildRecentWechatCombinedText({ groupId, senderId, senderName, fallback })
  const value = combined || String(fallback || '').trim()
  if (!value) return ''
  // 用户常见操作是：先 @ 机器人，再连续发“总结一下图”和图片。
  // @ 触发消息本身可能只有一个 @，这里把同一用户短时间内的后续文本/图片合并成一次真实请求。
  if (hasWechatImageUnderstandingIntent(value)) return value
  const recent = getRecentWechatUserMessages({ groupId, senderId, senderName })
  const hasRecentImage = recent.some(item => Number(item.mediaId || 0) > 0 || /^\[图片\]$/u.test(String(item.text || '').trim()))
  if (hasRecentImage && isBareWechatMentionText(fallback)) return `${value}\n总结一下这张图`
  return value
}

function getLatestRecentWechatMediaId({ groupId = '', senderId = '', senderName = '' } = {}) {
  const recent = getRecentWechatUserMessages({ groupId, senderId, senderName, windowMs: WECHAT_FOLLOWUP_WINDOW_MS * 3 })
  for (const item of recent.slice().reverse()) {
    const mediaId = Number(item.mediaId || 0)
    if (mediaId > 0) return mediaId
  }
  return 0
}

function labelsFromWechatImageRow(row = {}) {
  try {
    const parsed = JSON.parse(row.labels_json || '[]')
    return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function findWechatImageReplyCandidate({ groupId = '', groupName = '', senderId = '', senderName = '', mediaId = 0, text = '', rawText = '', rawPayloadText = '', messageType = '' } = {}) {
  const id = Number(mediaId || 0)
  if (id > 0) return { item: { id }, quoteMatched: false, source: 'current_media' }
  const quote = extractWeChatQuoteContext({ text: text || rawText, rawText: rawPayloadText || rawText || text, messageType })
  if (quote?.ok && quote.kind === 'image') {
    const quoted = findWeChatImageMediaForQuote({ groupId, groupName, quote, query: text || rawText, limit: 5 })
    if (quoted.items?.[0]?.id) return { item: quoted.items[0], quoteMatched: true, source: 'quote' }
  }
  const recentMediaId = getLatestRecentWechatMediaId({ groupId, senderId, senderName })
  if (recentMediaId > 0 && (isBareWechatMentionText(text) || hasWechatImageUnderstandingIntent(text))) {
    return { item: { id: recentMediaId }, quoteMatched: false, source: 'recent_sender' }
  }
  return { item: null, quoteMatched: false, source: '' }
}

function buildWechatImageReplyContext({ result = {}, item = {}, senderName = '', quoteMatched = false } = {}) {
  const row = result.item || item || {}
  const labels = Array.isArray(result.labels) && result.labels.length ? result.labels : labelsFromWechatImageRow(row)
  return {
    media_id: Number(result.mediaId || row.id || item.id || 0) || 0,
    sender_name: row.sender_name || senderName || '',
    vision_status: result.vision_status || row.vision_status || (result.description ? 'done' : 'pending'),
    description: String(result.description || row.description || '').trim(),
    labels,
    quote_matched: !!quoteMatched,
    retry_count: Number(result.retryCount || result.retry_count || 0),
  }
}

function buildWechatImageEnhancedText({ baseText = '', imageContext = {} } = {}) {
  const base = String(baseText || '')
    .replace(/<msg[\s\S]*?<\/msg>/giu, ' ')
    .replace(/(?:cdnmidimgurl|cdnbigimgurl|aeskey|msgid|newmsgid|length)=["'][^"']*["']/giu, ' ')
    .replace(/原始大小标记\s*\d+/giu, ' ')
    .replace(/\[图片\]/gu, ' ')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu, ' ')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sender = String(imageContext.sender_name || '').trim()
  const description = String(imageContext.description || '').trim()
  const labels = Array.isArray(imageContext.labels) ? imageContext.labels.filter(Boolean) : []
  const imageLine = description ? `刚刚${sender || '群友'}发了一张图片，图片内容：${description}` : ''
  const labelLine = labels.length ? `图片标签：${labels.join('、')}` : ''
  return [base, imageLine, labelLine].filter(Boolean).join('\n').trim()
}

async function prepareWechatImageReplyText({ groupId = '', groupName = '', senderId = '', senderName = '', mediaInfo = null, text = '', rawText = '', rawPayloadText = '', messageType = '', mentionedSelf = false } = {}) {
  const candidate = findWechatImageReplyCandidate({
    groupId,
    groupName,
    senderId,
    senderName,
    mediaId: mediaInfo?.mediaId || 0,
    text,
    rawText,
    rawPayloadText,
    messageType,
  })
  if (!candidate.item?.id) return { ok: true, text, imageContext: null, skipped: true, reason: 'no_image_candidate' }
  const waitResult = await waitForWeChatImageMediaDescription({
    mediaId: candidate.item.id,
    attempts: WECHAT_IMAGE_REPLY_VISION_ATTEMPTS,
    intervalMs: WECHAT_IMAGE_REPLY_VISION_INTERVAL_MS,
  })
  if (!waitResult.ok || !waitResult.description) {
    console.log(`[WechatImageReply] 放弃图片回复 topic="${groupName}" sender="${senderName}" media_id=${candidate.item.id} mention=${mentionedSelf} status=${waitResult.vision_status || ''} retries=${waitResult.retryCount || 0}`)
    return { ok: false, text, imageContext: null, reason: 'image_vision_not_ready_after_retries', waitResult }
  }
  const imageContext = buildWechatImageReplyContext({
    result: waitResult,
    item: candidate.item,
    senderName,
    quoteMatched: candidate.quoteMatched,
  })
  return {
    ok: true,
    text: buildWechatImageEnhancedText({ baseText: text, imageContext }),
    imageContext,
    reason: candidate.source || 'image_candidate',
  }
}

function rememberRecentWechatGroupVideo({ groupId = '', senderId = '', senderName = '', message = null, messageType = '', text = '', messageId = '' } = {}) {
  const gid = String(groupId || '').trim()
  if (!gid || !message?.toFileBox || !isWechatVideoMessageType(messageType)) return
  const now = Date.now()
  const list = recentWechatGroupVideos.get(gid) || []
  list.push({
    at: now,
    groupId: gid,
    senderId: String(senderId || '').trim(),
    senderName: String(senderName || '').trim(),
    message,
    messageId: String(messageId || message?.id || '').trim(),
    text: String(text || '').trim(),
    messageType: String(messageType || ''),
  })
  const fresh = list
    .filter(item => now - Number(item.at || 0) <= WECHAT_VIDEO_REFERENCE_WINDOW_MS)
    .slice(-20)
  recentWechatGroupVideos.set(gid, fresh)
}

function getRecentWechatVideoCandidate({ groupId = '', senderId = '', senderName = '', preferSender = true, windowMs = WECHAT_VIDEO_REFERENCE_WINDOW_MS, quote = null } = {}) {
  const gid = String(groupId || '').trim()
  const now = Date.now()
  const candidates = (recentWechatGroupVideos.get(gid) || [])
    .filter(item => item?.message?.toFileBox && now - Number(item.at || 0) <= windowMs)
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
  if (!candidates.length) return null
  const messageIds = quote?.ok
    ? [...new Set([
      quote.messageId,
      ...(Array.isArray(quote.messageIds) ? quote.messageIds : []),
    ].map(v => String(v || '').trim()).filter(Boolean))]
    : []
  if (messageIds.length) {
    const exact = candidates.find(item => messageIds.some(id => id && (item.messageId === id || String(item.text || '').includes(id))))
    if (exact) return exact
  }
  if (preferSender) {
    const sid = String(senderId || '').trim()
    const sname = String(senderName || '').trim()
    const sameSender = candidates.find(item => (sid && item.senderId === sid) || (sname && item.senderName === sname))
    if (sameSender) return sameSender
  }
  return candidates[0] || null
}

function hasWechatVideoReferenceIntent(text = '', { quote = null } = {}) {
  const value = String(text || '')
  if (isWechatVideoAnalysisIntent(value)) return true
  if (quote?.ok && quote.kind === 'video') return true
  return /(?:这个|这条|刚才|刚刚|上面|前面|引用|发的).{0,18}(?:视频|短视频|录像|录屏|片段|电影|影视)|(?:视频|短视频|录像|录屏|片段|电影|影视).{0,18}(?:这个|这条|刚才|刚刚|上面|前面|引用|看看|看下|识别)/iu.test(value)
}

function getWechatImageUnderstandingGate({ text = '', rawText = '', rawPayloadText = '', messageType = '' } = {}) {
  const value = String(text || '')
  if (!hasWechatImageUnderstandingIntent(value)) return { handle: false, reason: 'no_image_intent', quote: { ok: false } }
  const quote = extractWeChatQuoteContext({ text: value || rawText, rawText: rawPayloadText || rawText || value, messageType })
  if (quote?.ok && quote.kind === 'video') return { handle: false, reason: 'quoted_video', quote }
  if (isWechatVideoMessageType(messageType) || hasWechatVideoReferenceIntent(value || rawText, { quote })) {
    return { handle: false, reason: 'video_intent', quote }
  }
  return { handle: true, reason: 'image_intent', quote }
}

function makeWechatyGroupReplyTargetId(roomId = '', senderId = '', senderName = '') {
  const roomKey = encodeURIComponent(String(roomId || 'unknown-room').trim())
  const memberKey = encodeURIComponent(String(senderId || senderName || 'unknown-member').trim())
  return `wechaty:room:${roomKey}:member:${memberKey}`
}

async function resolveWechatyMentionContact(room, mentionId = '') {
  const wanted = String(mentionId || '').trim()
  if (!wanted || !room || !bot) return null

  // 优先从“当前群成员列表”按 contact.id 精确找人。
  // 不能用昵称/备注兜底，否则群成员改名或同名时又会 @ 错人。
  try {
    const members = await room.memberAll()
    const found = (members || []).find(contact => getWechatyContactId(contact) === wanted)
    if (found) return found
  } catch {}

  // Contact.load 是按微信内部 UserName 精确加载；如果拿不到成员对象就宁可不 @，
  // 也不要按名字模糊查，避免把回复错 @ 到上一位提问人/管理员。
  try {
    const loaded = bot.Contact.load?.(wanted)
    if (loaded) {
      const loadedId = getWechatyContactId(loaded)
      if (!loadedId || loadedId === wanted) return loaded
    }
  } catch {}
  try {
    const found = await bot.Contact.find?.({ id: wanted })
    if (found && getWechatyContactId(found) === wanted) return found
  } catch {}
  return null
}

function normalizeWechatyMentionIds(opts = {}) {
  const rows = []
  if (Array.isArray(opts.mentionIds)) rows.push(...opts.mentionIds)
  if (Array.isArray(opts.mention_id_list)) rows.push(...opts.mention_id_list)
  if (opts.mentionId) rows.push(opts.mentionId)
  const seen = new Set()
  const out = []
  for (const item of rows) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= 20) break
  }
  return out
}

function normalizeWechatyMentionName(value = '') {
  const text = cleanWechatyDisplayCandidate(String(value || '').replace(/^[@＠]+/u, ''))
  if (!text || /^(未知成员|unknown)$/iu.test(text) || isWeChatInternalIdLike(text)) return ''
  // 微信 @ 前缀里不能带换行；过长名字通常不是群昵称，避免把整段回复拼进 @ 后面。
  return text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 40)
}

function normalizeWechatyMentionTargets(opts = {}) {
  const ids = normalizeWechatyMentionIds(opts)
  const names = Array.isArray(opts.mentionNames)
    ? opts.mentionNames
    : Array.isArray(opts.mention_names)
      ? opts.mention_names
      : []
  const fallbackName = opts.mentionName || opts.mention_name || ''
  return ids.map((id, index) => ({
    id,
    name: normalizeWechatyMentionName(names[index] || (ids.length === 1 ? fallbackName : '')),
  }))
}

function lookupStoredWechatyMemberNameParts(room, mentionId = '') {
  const roomId = String(room?.id || '').trim()
  const id = String(mentionId || '').trim()
  const empty = { roomAlias: '', displayName: '', contactAlias: '', contactName: '' }
  if (!roomId || !id) return empty
  try {
    const members = listWeChatGroupMembers({ groupId: `wechaty:${roomId}`, limit: 1000 }).members || []
    const row = members.find(item => String(item.sender_id || '').trim() === id)
    return {
      roomAlias: normalizeWechatyMentionName(row?.room_alias || ''),
      displayName: normalizeWechatyMentionName(row?.display_name || ''),
      contactAlias: normalizeWechatyMentionName(row?.contact_alias || ''),
      contactName: normalizeWechatyMentionName(row?.contact_name || ''),
    }
  } catch {}
  return empty
}

function pickWechatyMentionDisplayName({
  liveRoomAlias = '',
  roomAlias = '',
  storedRoomAlias = '',
  explicitName = '',
  displayName = '',
  storedDisplayName = '',
  directContactName = '',
  contactAlias = '',
  contactName = '',
  storedContactAlias = '',
  storedContactName = '',
} = {}) {
  const candidates = [
    liveRoomAlias,
    roomAlias,
    storedRoomAlias,
    explicitName,
    displayName,
    storedDisplayName,
    directContactName,
    contactAlias,
    contactName,
    storedContactAlias,
    storedContactName,
  ]
  return candidates.map(normalizeWechatyMentionName).find(Boolean) || ''
}

async function resolveWechatyMentionDisplayName(room, contact, mentionId = '', explicitName = '') {
  // 群内显示名优先。这里是最终发出去的 @ 文本，必须是群里可见的昵称，而不是内部 sender_id。
  let liveRoomAlias = ''
  let directContactName = ''
  let parts = null
  try { liveRoomAlias = await room?.alias?.(contact) || '' } catch {}
  try { directContactName = contact?.name?.() || '' } catch {}
  try {
    parts = contact
      ? await resolveWechatyMemberNameParts(room, contact, mentionId)
      : await resolveWechatyMemberNamePartsFromId(room, mentionId, { hydrate: true })
  } catch {}
  const stored = lookupStoredWechatyMemberNameParts(room, mentionId)
  return pickWechatyMentionDisplayName({
    liveRoomAlias,
    roomAlias: parts?.roomAlias || '',
    storedRoomAlias: stored.roomAlias,
    explicitName,
    displayName: parts?.displayName || '',
    storedDisplayName: stored.displayName,
    directContactName,
    contactAlias: parts?.contactAlias || '',
    contactName: parts?.contactName || '',
    storedContactAlias: stored.contactAlias,
    storedContactName: stored.contactName,
  })
}

async function resolveWechatyMentionTargets(room, mentionTargets = []) {
  const targets = []
  const seen = new Set()
  for (const target of mentionTargets) {
    const mentionId = String(target?.id || '').trim()
    if (!mentionId || seen.has(mentionId)) continue
    const contact = await resolveWechatyMentionContact(room, mentionId)
    const contactId = getWechatyContactId(contact)
    const resolvedId = contactId || mentionId
    if (seen.has(resolvedId)) continue
    const name = await resolveWechatyMentionDisplayName(room, contact, resolvedId, target?.name || '')
    if (!contact && !name) continue
    seen.add(resolvedId)
    targets.push({ id: resolvedId, contact, name })
  }
  return targets
}

function stripLeadingWechatMentionText(text = '') {
  let value = String(text || '').trim()
  // 去掉模型可能自己加的开头 @xxx，统一由底层用真实提问人的群昵称拼接，避免 @错人/空 @/重复 @。
  for (let i = 0; i < 5; i++) {
    const next = value.replace(/^[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]{0,40}[\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]*/u, '').trim()
    if (next === value) break
    value = next
  }
  return value || String(text || '').trim()
}

function buildManualWechatMentionText(text = '', targets = []) {
  const names = targets.map(item => normalizeWechatyMentionName(item?.name || '')).filter(Boolean)
  if (!names.length) return String(text || '')
  const prefix = names.map(name => `@${name}`).join('\u2005')
  return `${prefix}\u2005${stripLeadingWechatMentionText(text)}`
}

function escapeWechatMsgSourceXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function makeWechatClientMsgId() {
  return Math.ceil(Date.now() * 1000)
}

function buildWechat4uAtUserList(targets = []) {
  const ids = []
  const seen = new Set()
  for (const target of Array.isArray(targets) ? targets : []) {
    const id = String(target?.id || target?.contact?.id || '').trim()
    if (!id || !id.startsWith('@') || id.startsWith('@@') || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= 20) break
  }
  return ids
}

function buildWechat4uMsgSourceXml(targetIds = []) {
  const ids = (Array.isArray(targetIds) ? targetIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
  if (!ids.length) return ''
  // Web 微信收到真正 @ 消息时，元数据通常在 MsgSource/msgsource 的 atuserlist 中。
  // 这里保持 XML 最小化，避免引入其它来源不明字段导致接口拒绝。
  return `<msgsource><atuserlist>${ids.map(escapeWechatMsgSourceXml).join(',')}</atuserlist></msgsource>`
}

function getWechat4uRuntime() {
  return bot?.puppet?.wechat4u || bot?.puppet?.wechat4uBridge?.wechat4u || null
}

async function sendWechat4uRawTextWithMsgSource(room, text, resolvedMentionTargets = [], { variant = 'msgsource' } = {}) {
  const wechat4u = getWechat4uRuntime()
  const roomId = String(room?.id || '').trim()
  if (!wechat4u || !roomId) throw new Error('wechat4u runtime or room id missing')
  if (!wechat4u.request || !wechat4u.CONF || !wechat4u.PROP || !wechat4u.user || !wechat4u.getBaseRequest) {
    throw new Error('wechat4u internals unavailable')
  }
  const targetIds = buildWechat4uAtUserList(resolvedMentionTargets)
  if (!targetIds.length) throw new Error('mention target id missing')
  const msgSource = buildWechat4uMsgSourceXml(targetIds)
  const content = buildManualWechatMentionText(text, resolvedMentionTargets)
  const clientMsgId = makeWechatClientMsgId()
  const msg = {
    Type: wechat4u.CONF.MSGTYPE_TEXT,
    Content: content,
    FromUserName: wechat4u.user.UserName || wechat4u.user.userName || wechat4u.user['UserName'],
    ToUserName: roomId,
    LocalID: clientMsgId,
    ClientMsgId: clientMsgId,
  }
  if (variant === 'msgsource-lower') msg.msgsource = msgSource
  else if (variant === 'msgsource-both') {
    msg.MsgSource = msgSource
    msg.msgsource = msgSource
  } else if (variant === 'top-level-msgsource') {
    msg.MsgSource = msgSource
  } else {
    msg.MsgSource = msgSource
  }
  const payload = {
    BaseRequest: wechat4u.getBaseRequest(),
    Scene: 0,
    Msg: msg,
  }
  if (variant === 'top-level-msgsource') payload.MsgSource = msgSource
  console.log(`[WechatyNativeAtTest] 发送实验性 MsgSource @ room="${roomId}" targets="${targetIds.join(',')}" names="${resolvedMentionTargets.map(item => item.name || '').join(',')}" variant=${variant} content="${content.slice(0, 80)}"`)
  const res = await wechat4u.request({
    method: 'POST',
    url: wechat4u.CONF.API_webwxsendmsg,
    params: {
      pass_ticket: wechat4u.PROP.passTicket,
      lang: 'zh_CN',
    },
    data: payload,
  })
  const data = res?.data || {}
  const ret = Number(data?.BaseResponse?.Ret)
  if (ret !== 0) {
    const errMsg = data?.BaseResponse?.ErrMsg || JSON.stringify(data?.BaseResponse || data)
    throw new Error(`webwxsendmsg ret=${data?.BaseResponse?.Ret} ${errMsg}`)
  }
  return { ok: true, variant, roomId, targetIds, msgSource, content, response: data }
}

async function resolveWechatyRoomByNameOrId({ roomId = '', groupName = '' } = {}) {
  const rid = String(roomId || '').trim()
  const wantedName = String(groupName || '').trim()
  if (rid) {
    for (const cached of targetRooms.values()) {
      if (cached?.id === rid) return cached
    }
    try {
      const loaded = bot?.Room?.load?.(rid)
      if (loaded) return loaded
    } catch {}
  }
  if (wantedName) {
    for (const [topic, cached] of targetRooms.entries()) {
      if (topic === wantedName || topic.includes(wantedName) || wantedName.includes(topic)) return cached
    }
    try {
      const found = await bot?.Room?.find?.({ topic: wantedName })
      if (found) return found
    } catch {}
  }
  try {
    await resolveTargetRooms()
    if (rid) {
      for (const cached of targetRooms.values()) {
        if (cached?.id === rid) return cached
      }
    }
    if (wantedName) {
      for (const [topic, cached] of targetRooms.entries()) {
        if (topic === wantedName || topic.includes(wantedName) || wantedName.includes(topic)) return cached
      }
    }
  } catch {}
  return null
}

async function resolveWechatyMemberTargetForNativeMention(room, { memberId = '', memberName = '' } = {}) {
  const wantedId = String(memberId || '').trim()
  const wantedName = normalizeWechatyMentionName(memberName || '')
  const members = await room.memberAll()
  if (wantedId) {
    const contact = (members || []).find(item => getWechatyContactId(item) === wantedId) || await resolveWechatyMentionContact(room, wantedId)
    const name = await resolveWechatyMentionDisplayName(room, contact, wantedId, wantedName)
    return { id: getWechatyContactId(contact) || wantedId, contact, name: name || wantedName }
  }
  if (wantedName) {
    for (const contact of members || []) {
      const id = getWechatyContactId(contact)
      const name = await resolveWechatyMentionDisplayName(room, contact, id, '')
      if (normalizeWechatyMentionName(name) === wantedName) return { id, contact, name }
    }
    for (const contact of members || []) {
      const id = getWechatyContactId(contact)
      const name = await resolveWechatyMentionDisplayName(room, contact, id, '')
      const normalizedName = normalizeWechatyMentionName(name)
      if (normalizedName && (normalizedName.includes(wantedName) || wantedName.includes(normalizedName))) return { id, contact, name }
    }
  }
  return null
}

export async function testWechatyNativeMention({ groupName = '', roomId = '', memberName = '', memberId = '', text = '', variants = ['msgsource'] } = {}) {
  if (!bot || status !== 'connected') return { ok: false, reason: 'wechaty-duty-group not connected', status }
  if (!roomId && !groupName) return { ok: false, reason: 'roomId or groupName is required' }
  if (!memberId && !memberName) return { ok: false, reason: 'memberId or memberName is required' }
  const room = await resolveWechatyRoomByNameOrId({ roomId, groupName })
  if (!room) return { ok: false, reason: `room not found: ${roomId || groupName}` }
  const topic = await safeTopic(room)
  const target = await resolveWechatyMemberTargetForNativeMention(room, { memberId, memberName })
  if (!target?.id) return { ok: false, reason: `member not found: ${memberId || memberName}`, room_id: room.id, topic }
  const list = Array.isArray(variants) && variants.length ? variants : [variants || 'msgsource']
  const out = []
  for (const rawVariant of list.slice(0, 5)) {
    const variant = String(rawVariant || 'msgsource').trim() || 'msgsource'
    const body = text || `系统级 @ 实验 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}（variant=${variant}）`
    try {
      const result = await sendWechat4uRawTextWithMsgSource(room, body, [target], { variant })
      out.push({ ok: true, variant, msg_id: result.response?.MsgID || '', local_id: result.response?.LocalID || '', content: result.content, msg_source: result.msgSource, target: { id: target.id, name: target.name } })
    } catch (err) {
      console.error(`[WechatyNativeAtTest] variant=${variant} failed: ${err?.message || err}`)
      out.push({ ok: false, variant, error: err?.message || String(err), target: { id: target.id, name: target.name } })
    }
    if (list.length > 1) await new Promise(resolve => setTimeout(resolve, 1200))
  }
  return { ok: out.some(item => item.ok), room_id: room.id, topic, target: { id: target.id, name: target.name }, results: out }
}

function isWechat4uPuppetActive() {
  return /wechat4u/iu.test(activePuppetName || '') || !!bot?.puppet?.wechat4u
}

async function sayWechatyWithMentions(room, text, mentionTargets = []) {
  const cleanText = String(text || '')
  const targets = Array.isArray(mentionTargets) ? mentionTargets.filter(Boolean) : []
  const contacts = targets.map(item => item.contact).filter(Boolean)
  const manualText = buildManualWechatMentionText(cleanText, targets)
  if (targets.length && isWechat4uPuppetActive()) {
    // wechaty-puppet-wechat4u 的 messageSendText 会忽略 mentionIdList。
    // 只传 Contact 会发出一个空的 “@ ”，手机端也收不到真正 @ 提醒。
    // 因此 Web WeChat 链路必须手动拼出 “@群昵称<特殊空格>正文”。
    if (manualText !== cleanText) return room.say(manualText)
    console.warn('[Wechaty] 未解析到可见 @ 昵称，降级为普通文本发送')
    return room.say(cleanText)
  }
  if (!contacts.length) return room.say(cleanText)
  if (contacts.length === 1) {
    try {
      return await room.say(cleanText, contacts[0])
    } catch (err) {
      console.warn(`[Wechaty] 单人 @ 发送失败，降级为手动 @ 文本：${err?.message || err}`)
      return room.say(manualText || cleanText)
    }
  }
  try {
    return await room.say(cleanText, ...contacts)
  } catch (err) {
    try {
      return await room.say(cleanText, contacts)
    } catch (err2) {
      try {
        console.warn(`[Wechaty] 多人 @ 发送失败，降级为只 @ 第一人：${err2?.message || err2 || err}`)
        return await room.say(cleanText, contacts[0])
      } catch (err3) {
        console.warn(`[Wechaty] 多人 @ 降级后仍失败，最终改为手动 @ 文本：${err3?.message || err3}`)
        return room.say(manualText || cleanText)
      }
    }
  }
}
restoreRuntimeSnapshot()

function isLoginActive() {
  return status === 'logged_in' || status === 'connected'
}

function isConnectedStatus() {
  return status === 'connected'
}

function ageMs(iso = '') {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return Infinity
  return Date.now() - ts
}

function isFreshRoomRefresh() {
  return ageMs(lastRoomRefreshAt) <= ROOM_REFRESH_STALE_MS
}

function isMessageHealthy() {
  return !!lastMessageAt && ageMs(lastMessageAt) <= MESSAGE_HEALTH_STALE_MS
}

function hasCurrentResolvedRooms() {
  return !!targetRoomId && targetRooms.size > 0
}

function isTrulyOnline() {
  // “在线”必须代表当前进程真的能接入群，而不是只保存了历史登录用户/历史群快照。
  // connected + 当前 room 对象 + 最近刷新/收到消息，才允许 UI 显示为可用。
  return !!bot && isConnectedStatus() && hasCurrentResolvedRooms() && (isFreshRoomRefresh() || isMessageHealthy())
}

function emitWechatyStatusEvent(extra = {}) {
  emitEventRef?.('social_status', {
    platform: 'wechaty-duty-group',
    status: extra.status || status,
    group_names: [...targetGroupNames],
    online: isTrulyOnline(),
    rooms_stale: !!roomSnapshot.length && !isTrulyOnline(),
    needs_relogin: needsWechatyRelogin(),
    hint: getConnectionHint({ online: isTrulyOnline(), rooms: roomSnapshot }),
    rooms: roomSnapshot,
    login_user: isLoginActive() ? previousLoginUser() : '',
    last_login_user: previousLoginUser(),
    ...extra,
  })
}

function notifyWechatyOffline(reason = '', { force = false } = {}) {
  const key = `${status}:${reason}:${lastQr ? 'qr' : 'noqr'}`
  if (!force && key === lastOfflineAlertKey) return
  lastOfflineAlertKey = key
  const hint = getConnectionHint({ online: false, rooms: roomSnapshot })
  console.warn(`[Wechaty] 离线提醒：${hint}${reason ? ` (${reason})` : ''}`)
  try {
    globalThis.bailongmaAppControl?.notify?.({
      title: '微信群助手已离线',
      body: hint || '微信群助手当前不可接收 @ 消息，请重新扫码登录。',
      urgency: 'critical',
      showWindow: true,
    })
  } catch {}
  emitWechatyStatusEvent({ alert: 'offline', reason, error: lastError })
  requestOfflineQrNotification(reason || 'offline')
}

function requestOfflineQrNotification(reason = '') {
  const cfg = getOfflineQrNotifyConfig()
  if (!cfg.enabled) return
  if (lastQr) {
    notifyWechatyLoginQrViaClawbot(reason).catch(err =>
      console.warn(`[WechatyOfflineQR] ClawBot 二维码通知异常：${err?.message || err}`)
    )
    return
  }
  if (!cfg.autoRelogin) return
  if (offlineQrReloginInFlight) return
  if (Date.now() - lastOfflineQrReloginAt < OFFLINE_QR_RELOGIN_MIN_INTERVAL_MS) return
  if (!needsWechatyRelogin()) return
  offlineQrReloginInFlight = true
  lastOfflineQrReloginAt = Date.now()
  clearReconnectTimer()
  suppressReconnect(90000)
  console.warn(`[WechatyOfflineQR] 微信助手离线且暂无二维码，开始自动生成重新登录二维码 reason=${reason || 'unknown'}`)
  forceReloginWechatyDutyGroupConnector({
    pushMessage: pushMessageRef,
    emitEvent: emitEventRef,
    groupNames: targetGroupNames,
    enabled: true,
  }).catch(err => {
    lastClawbotQrNotifyError = err?.message || String(err)
    lastClawbotQrNotifyResult = 'relogin_failed'
    console.warn(`[WechatyOfflineQR] 自动生成二维码失败：${lastClawbotQrNotifyError}`)
    emitWechatyStatusEvent({ offline_qr_notify: getOfflineQrNotifyState() })
  }).finally(() => {
    offlineQrReloginInFlight = false
  })
}

function needsWechatyRelogin() {
  if (isTrulyOnline()) return false
  if (status === 'qr_ready') return false
  if (status === 'starting' && connectionAttemptStartedAt && Date.now() - connectionAttemptStartedAt > STARTING_RELOGIN_REQUIRED_MS) return true
  return ['logged_in', 'connected', 'rooms_stale', 'group_lookup_error', 'rooms_pending', 'group_not_found', 'error', 'disconnected', 'relogin_required'].includes(status)
}

function startOfflineDetector() {
  if (offlineDetectTimer) return
  offlineDetectTimer = setInterval(() => {
    if (!wechatyGroupReplyEnabled) return
    if (isTrulyOnline()) {
      lastOfflineAlertKey = ''
      return
    }
    if (lastQr) requestOfflineQrNotification('repeat_cooldown')
    if (needsWechatyRelogin()) {
      if (status === 'starting') {
        status = 'relogin_required'
        lastError = lastError || '微信登录态恢复超时，需要重新扫码。'
        persistRuntime(status)
      }
      notifyWechatyOffline('health_check')
      requestOfflineQrNotification('health_check')
    }
  }, OFFLINE_DETECT_INTERVAL_MS)
}

function stopOfflineDetector() {
  if (offlineDetectTimer) clearInterval(offlineDetectTimer)
  offlineDetectTimer = null
}

function previousLoginUser() {
  try {
    const runtime = getWechatyDutyGroupConfig().runtime || {}
    return lastLoginUser || String(runtime.loginUser || '')
  } catch {
    return lastLoginUser || ''
  }
}

function hasResolvedRooms() {
  // 这里只能看当前进程实际解析到的 room，不能看 roomSnapshot。
  // roomSnapshot 是上次运行留下的 UI 快照；如果把它当成当前在线证据，
  // 重启后等待扫码时遇到 wechat4u 暂态错误会被误标成 logged_in。
  return !!targetRoomId || targetRooms.size > 0
}

function clearStartWatchdog() {
  if (startWatchdogTimer) clearTimeout(startWatchdogTimer)
  startWatchdogTimer = null
}

function armStartWatchdog(currentBot) {
  clearStartWatchdog()
  startWatchdogTimer = setTimeout(async () => {
    startWatchdogTimer = null
    if (bot !== currentBot) return
    if (isTrulyOnline() || status !== 'starting') return
    lastError = '微信登录态恢复超时，需要重新扫码。'
    status = 'relogin_required'
    persistRuntime(status)
    console.warn(`[Wechaty] 启动 ${Math.round(START_WATCHDOG_MS / 1000)} 秒仍未拿到二维码/登录事件，改为强制重新扫码并触发 ClawBot 二维码通知。`)
    emitWechatyStatusEvent({ status, error: lastError })
    notifyWechatyOffline('start_watchdog', { force: true })
  }, START_WATCHDOG_MS)
}

function isWechat4uTransientError(message = '') {
  const value = String(message || '').trim()
  return /^-?1\s*==\s*0$/i.test(value)
    || /^400\s*!=\s*400$/i.test(value)
    || /socket hang up|network socket disconnected|TLS connection|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(value)
    || /batchGetContact|contactRawPayload|unknownContactId/i.test(value)
}

function isRecentlyLoggedIn(ms = 45000) {
  return !!lastLoginAt && Date.now() - lastLoginAt <= ms
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textMentionsLoginUser(text = '') {
  const value = String(text || '')
  const names = [...new Set([lastLoginUser, previousLoginUser()].map(v => String(v || '').trim()).filter(Boolean))]
  if (!names.length) return false
  return names.some(name => new RegExp(`[@＠]\\s*${escapeRegExp(name)}(?=$|[\\s\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a,，:：、])`, 'iu').test(value))
}

function extractAtUserListFromRawPayload(rawPayload = {}) {
  const texts = [
    rawPayload?.MsgSource,
    rawPayload?.msgSource,
    rawPayload?.Content,
    rawPayload?.OriginalContent,
    rawPayload?.MMActualContent,
    rawPayload?.payload,
    rawPayload?.xml,
  ].map(v => String(v || '')).filter(Boolean)
  const ids = new Set()
  for (const text of texts) {
    for (const match of text.matchAll(/<atuserlist>([\s\S]*?)<\/atuserlist>/giu)) {
      const body = match[1] || ''
      for (const part of body.split(/[,\s;]+/u)) {
        const value = part.trim()
        if (value) ids.add(value)
      }
    }
    for (const match of text.matchAll(/\batuserlist\b["'\s:=]+([^<>"'\s]+)/giu)) {
      for (const part of String(match[1] || '').split(/[,\s;]+/u)) {
        const value = part.trim()
        if (value) ids.add(value)
      }
    }
  }
  return [...ids]
}

export function detectWechatyLoginMention({ text = '', rawPayload = {}, loginName = '', loginId = '', mentionedContactIds = [], mentionedContactNames = [] } = {}) {
  const id = String(loginId || '').trim()
  const name = String(loginName || '').trim()
  const ids = new Set([
    ...extractAtUserListFromRawPayload(rawPayload),
    ...(Array.isArray(mentionedContactIds) ? mentionedContactIds : []),
  ].map(v => String(v || '').trim()).filter(Boolean))
  if (id && ids.has(id)) return true
  const names = new Set((Array.isArray(mentionedContactNames) ? mentionedContactNames : []).map(v => String(v || '').trim()).filter(Boolean))
  if (name && names.has(name)) return true
  const previous = lastLoginUser
  lastLoginUser = name || lastLoginUser
  try {
    return textMentionsLoginUser(text)
  } finally {
    lastLoginUser = previous
  }
}

async function getWechatyMentionContacts(message) {
  try {
    const list = await message.mentionList?.()
    return Array.isArray(list) ? list.filter(Boolean) : []
  } catch {
    return []
  }
}

async function getMentionedGroupMembers(message, room, rawText = '') {
  const contacts = await getWechatyMentionContacts(message)
  const rows = []
  const seen = new Set()
  for (const contact of contacts) {
    const id = getWechatyContactId(contact)
    if (!id || id === lastLoginUserId) continue
    const name = await resolveWechatyMemberDisplayName(room, contact, id)
    const key = id || name
    if (!key || seen.has(key)) continue
    seen.add(key)
    rows.push({ id, name: name || id })
  }
  if (!rows.length) {
    const loginNames = new Set([lastLoginUser, previousLoginUser()].map(v => String(v || '').trim()).filter(Boolean))
    for (const match of String(rawText || '').matchAll(/[@＠]([^\s\u2005\u2006\u2007\u2008\u2009\u200a，,。.!！?？：:、]{1,40})/gu)) {
      const name = String(match[1] || '').trim()
      if (!name || loginNames.has(name) || seen.has(name)) continue
      seen.add(name)
      rows.push({ id: '', name })
    }
  }
  return rows.slice(0, 8)
}

function getConnectionHint({ online = isTrulyOnline(), rooms = roomSnapshot } = {}) {
  if (online) return '已真实接入微信群，可以接收 @ 消息。'
  if (status === 'qr_ready') return '等待扫码登录。'
  if (status === 'starting') return '正在启动/恢复微信登录。'
  if (status === 'connected' && !isFreshRoomRefresh() && !isMessageHealthy()) return '当前只保留了历史群列表，最近没有真实刷新/消息心跳；如果群里 @ 无回复，请强制重新扫码。'
  if ((status === 'logged_in' || status === 'connected') && !hasCurrentResolvedRooms()) return '微信登录态可能存在，但当前进程没有真实接入目标群；请刷新真实群列表或强制重新扫码。'
  if (status === 'rooms_stale') return '没有获取到真实群列表；下方仅为上次缓存，请强制重新扫码。'
  if (status === 'group_lookup_error') return '查找微信群失败，请刷新群列表；如果持续失败请强制重新扫码。'
  if (status === 'rooms_pending') return '已登录但还没有拿到真实群列表，请稍等或强制重新扫码。'
  if (status === 'group_not_found') return '已登录但没有找到已勾选的群，请确认该微信在群里，或重新扫码。'
  if (status === 'disconnected') return '微信连接已断开，请重新登录。'
  if (status === 'error') return '微信连接异常，请强制重新扫码。'
  if (rooms?.length) return '未连接；下方仅为上次缓存的群列表。'
  return '未登录。'
}

export function getWechatyDutyGroupStatus() {
  const runtime = getWechatyDutyGroupConfig().runtime || {}
  const rooms = roomSnapshot.length
    ? roomSnapshot
    : (Array.isArray(runtime.rooms) ? markSelectedRooms(runtime.rooms) : [])
  const runtimeRoomIds = runtime.roomIds && typeof runtime.roomIds === 'object' ? runtime.roomIds : {}
  const roomIds = Object.keys(runtimeRoomIds).length
    ? runtimeRoomIds
    : Object.fromEntries([...targetRooms.entries()].map(([name, room]) => [name, room?.id || '']))
  const online = isTrulyOnline()
  const currentRoomIds = Object.fromEntries([...targetRooms.entries()].map(([name, room]) => [name, room?.id || '']))
  const stale = !!rooms.length && !online
  return {
    status,
    connection_state: online ? 'online' : (needsWechatyRelogin() ? 'offline' : (status === 'qr_ready' ? 'qr_ready' : 'connecting')),
    enabled: wechatyGroupReplyEnabled,
    group_name: targetGroupNames[0] || '',
    group_names: [...targetGroupNames],
    room_id: online ? targetRoomId : '',
    room_ids: online ? currentRoomIds : {},
    cached_room_ids: roomIds,
    qr: online ? '' : lastQr,
    qr_ascii: online ? '' : lastQrAscii,
    error: lastError,
    online,
    login_user: isLoginActive() ? previousLoginUser() : '',
    last_login_user: previousLoginUser(),
    room_count: online ? rooms.length : 0,
    cached_room_count: rooms.length,
    rooms,
    rooms_stale: stale,
    needs_relogin: needsWechatyRelogin(),
    hint: getConnectionHint({ online, rooms }),
    offline_qr_notify: getOfflineQrNotifyState(),
    active_reply: getWechatyActiveReplyConfig(),
    last_room_refresh_at: lastRoomRefreshAt || String(runtime.lastRoomRefreshAt || ''),
    last_message_at: lastMessageAt || String(runtime.lastMessageAt || ''),
    health: {
      current_room_count: targetRooms.size,
      has_current_room: hasCurrentResolvedRooms(),
      room_refresh_fresh: isFreshRoomRefresh(),
      message_healthy: isMessageHealthy(),
      room_refresh_age_ms: Number.isFinite(ageMs(lastRoomRefreshAt)) ? ageMs(lastRoomRefreshAt) : null,
      message_age_ms: Number.isFinite(ageMs(lastMessageAt)) ? ageMs(lastMessageAt) : null,
    },
    puppet: activePuppetName || String(runtime.puppet || ''),
    login_memory: getWechatyMemoryState(),
  }
}

export function configureWechatyDutyGroup({ groupName, groupNames, enabled } = {}) {
  if (enabled !== undefined) wechatyGroupReplyEnabled = enabled !== false
  targetGroupNames = normalizeGroupNames(groupNames ?? groupName)
  roomSnapshot = markSelectedRooms(roomSnapshot)
  for (const [name, room] of [...targetRooms.entries()]) {
    if (!targetGroupNames.some(target => name === target || name.includes(target) || target.includes(name))) targetRooms.delete(name)
  }
  targetRoom = [...targetRooms.values()][0] || targetRoom
  targetRoomId = targetRoom?.id || targetRoomId
  persistRuntime(status)
  return getWechatyDutyGroupStatus()
}


export async function sendWechatyDutyGroupMessage(roomId, content, opts = {}) {
  if (!bot || status !== 'connected') return { ok: false, reason: 'wechaty-duty-group not connected' }
  const rid = String(roomId || targetRoomId || '').trim()
  if (!rid) return { ok: false, reason: 'room id missing' }
  try {
    let room = (rid === targetRoomId && targetRoom) ? targetRoom : null
    if (!room) {
      for (const cached of targetRooms.values()) {
        if (cached?.id === rid) { room = cached; break }
      }
    }
    if (!room) {
      try { room = bot.Room.load?.(rid) || null } catch {}
    }
    if (!room && rid === targetRoomId) room = await resolveTargetRooms()
    if (!room) return { ok: false, reason: `room not found: ${rid}` }
    const mentionTargets = normalizeWechatyMentionTargets(opts)
    const mentionIds = mentionTargets.map(item => item.id)
    const body = String(content || '')
    const resolvedMentionTargets = await resolveWechatyMentionTargets(room, mentionTargets)
    if (mentionIds.length) {
      console.log(`[Wechaty] 准备发送群回复 room="${rid}" mention_ids="${mentionIds.join(',')}" mention_names="${resolvedMentionTargets.map(item => item.name || '').join(',')}" resolved=${resolvedMentionTargets.length}/${mentionIds.length}`)
    }
    const adminBypass = opts.adminBypass === true || opts.social?.wechat_admin === true
    if (!adminBypass && LOCAL_FILE_REFERENCE_RE.test(body)) {
      const refusal = '为了保护机主隐私，微信群里不能发送或描述本机文件、桌面图片、截图、相册或 file:// 路径。可以发送公开网络图片链接。'
      await withWechatySendTimeout(sayWechatyWithMentions(room, refusal, resolvedMentionTargets), opts.timeoutMs || 15000, 'wechat text send')
      return { ok: false, blocked: true, reason: 'local_file_reference_in_wechat_outbound' }
    }
    if (adminBypass && LOCAL_FILE_REFERENCE_RE.test(body)) {
      console.log('[WechatyAdmin] 已验证管理员回复绕过微信群本机隐私发送拦截')
    }
    const imageUrls = extractPublicImageUrlsFromWechatText(body)
    const localImageFiles = Array.isArray(opts.imageFilePaths)
      ? opts.imageFilePaths.map(v => String(v || '').trim()).filter(Boolean)
      : []
    const attachmentFiles = Array.isArray(opts.filePaths)
      ? opts.filePaths.map(v => String(v || '').trim()).filter(Boolean)
      : []
    let textBody = imageUrls.length ? stripImageMarkdown(body, imageUrls) : body
    if ((imageUrls.length || localImageFiles.length) && /^[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]{1,40}$/u.test(textBody.trim())) textBody = ''
    // 表情包/斗图/图片战报场景不要把图片 URL 当文字发到群里；微信里应只看到图片/GIF/海报。
    // 若模型额外写了自然语言说明，则先 @ 提问人发一句短文字；纯图片回复则完全不发链接文本。
    if (textBody.trim()) {
      await withWechatySendTimeout(sayWechatyWithMentions(room, textBody, resolvedMentionTargets), opts.timeoutMs || 15000, 'wechat text send')
    }
    const imageResults = await Promise.allSettled(imageUrls.map(async url => {
      await withWechatySendTimeout(room.say(FileBox.fromUrl(url)), opts.timeoutMs || 20000, 'wechat image send')
      return url
    }))
    for (let i = 0; i < imageResults.length; i++) {
      const result = imageResults[i]
      if (result.status === 'rejected') {
        console.warn(`[Wechaty] 公开网络图片发送失败：${imageUrls[i]} ${result.reason?.message || result.reason}`)
      }
    }
    const localImageResults = await Promise.allSettled(localImageFiles.map(async filePath => {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error(`not a file: ${filePath}`)
      await withWechatySendTimeout(room.say(FileBox.fromFile(filePath)), opts.timeoutMs || 30000, 'wechat local image send')
      return filePath
    }))
    for (let i = 0; i < localImageResults.length; i++) {
      const result = localImageResults[i]
      if (result.status === 'rejected') {
        console.warn(`[Wechaty] 本地图片发送失败：${localImageFiles[i]} ${result.reason?.message || result.reason}`)
      }
    }
    const attachmentResults = await Promise.allSettled(attachmentFiles.map(async filePath => {
      if (!isWechatReplyGeneratedFilePath(filePath)) throw new Error('refuse to send non-generated reply file')
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error(`not a file: ${filePath}`)
      await withWechatySendTimeout(room.say(FileBox.fromFile(filePath)), opts.timeoutMs || 45000, 'wechat file send')
      return filePath
    }))
    for (let i = 0; i < attachmentResults.length; i++) {
      const result = attachmentResults[i]
      if (result.status === 'rejected') {
        console.warn(`[Wechaty] 生成附件发送失败：${attachmentFiles[i]} ${result.reason?.message || result.reason}`)
      }
    }
    const sentImages = imageResults.filter(item => item.status === 'fulfilled').length + localImageResults.filter(item => item.status === 'fulfilled').length
    const sentFiles = attachmentResults.filter(item => item.status === 'fulfilled').length
    if (!textBody.trim() && !sentImages && !sentFiles) return { ok: false, platform: 'wechaty-duty-group', roomId: rid, reason: 'no text/image/file sent' }
    return { ok: true, platform: 'wechaty-duty-group', roomId: rid, images: sentImages, files: sentFiles }
  } catch (err) {
    console.error(`[Wechaty] 群消息发送失败：${err?.message || err}`)
    return { ok: false, error: err?.message || String(err) }
  }
}

export async function listWechatyDutyGroupRooms() {
  if (!bot || !isLoginActive()) {
    const reason = status === 'qr_ready'
      ? 'waiting for qr scan'
      : status === 'starting'
        ? 'wechaty-duty-group starting'
        : 'wechaty-duty-group not logged in'
    return { ok: false, status, enabled: wechatyGroupReplyEnabled, group_names: [...targetGroupNames], rooms: roomSnapshot, rooms_stale: roomSnapshot.length > 0, online: false, login_user: '', last_login_user: previousLoginUser(), last_room_refresh_at: lastRoomRefreshAt, error: reason, hint: getConnectionHint({ online: false, rooms: roomSnapshot }) }
  }
  try {
    const rooms = await bot.Room.findAll()
    const items = []
    for (const room of rooms) {
      const topic = await safeTopic(room)
      if (!topic) continue
      items.push({ id: room.id, topic, selected: isAllowedGroupTopic(topic) })
    }
    if (items.length) {
      roomSnapshot = markSelectedRooms(items)
      lastRoomRefreshAt = new Date().toISOString()
      lastError = ''
      roomSnapshot.sort((a, b) => Number(b.selected) - Number(a.selected) || a.topic.localeCompare(b.topic, 'zh-Hans-CN'))
      persistRuntime(status)
      return { ok: true, status, enabled: wechatyGroupReplyEnabled, group_names: [...targetGroupNames], rooms: roomSnapshot, rooms_stale: false, online: isTrulyOnline(), login_user: previousLoginUser(), last_login_user: previousLoginUser(), last_room_refresh_at: lastRoomRefreshAt, fresh: true, hint: getConnectionHint({ online: isTrulyOnline(), rooms: roomSnapshot }) }
    }

    if (targetRooms.size && isMessageHealthy()) {
      const activeRooms = markSelectedRooms([...targetRooms.entries()].map(([topic, room]) => ({ id: room?.id || '', topic, selected: true })))
      lastError = ''
      return { ok: true, status, enabled: wechatyGroupReplyEnabled, group_names: [...targetGroupNames], rooms: activeRooms, rooms_stale: false, online: isTrulyOnline(), login_user: previousLoginUser(), last_login_user: previousLoginUser(), last_room_refresh_at: lastRoomRefreshAt, fresh: false, message_healthy: true, hint: getConnectionHint({ online: true, rooms: activeRooms }) }
    }

    // 关键：这里不能再 ok:true。旧 roomSnapshot 只能当“历史缓存”展示，不能叫“刷新成功”。
    if (roomSnapshot.length) {
      console.warn('[Wechaty] 本次未获取到群列表，仅返回上次缓存；当前连接不可确认。')
    }
    lastError = '未获取到真实群列表；当前只显示上次缓存，可能需要重新扫码。'
    persistRuntime('rooms_stale')
    return { ok: false, status: 'rooms_stale', enabled: wechatyGroupReplyEnabled, group_names: [...targetGroupNames], rooms: roomSnapshot, rooms_stale: true, online: false, login_user: isLoginActive() ? previousLoginUser() : '', last_login_user: previousLoginUser(), last_room_refresh_at: lastRoomRefreshAt, fresh: false, error: lastError, hint: getConnectionHint({ online: false, rooms: roomSnapshot }) }
  } catch (err) {
    lastError = err?.message || String(err)
    return { ok: false, status, enabled: wechatyGroupReplyEnabled, group_names: [...targetGroupNames], rooms: roomSnapshot, rooms_stale: roomSnapshot.length > 0, online: false, login_user: isLoginActive() ? previousLoginUser() : '', last_login_user: previousLoginUser(), error: lastError, hint: getConnectionHint({ online: false, rooms: roomSnapshot }) }
  }
}

export async function restartWechatyDutyGroupConnector(opts = {}) {
  await stopWechatyDutyGroupConnector()
  return startWechatyDutyGroupConnector(opts)
}

export async function forceReloginWechatyDutyGroupConnector(opts = {}) {
  clearReconnectTimer()
  await stopWechatyDutyGroupConnector({ preserveRuntime: true })
  try { fs.rmSync(WECHATY_MEMORY_FILE, { force: true }) } catch {}
  try { fs.writeFileSync(WECHATY_MEMORY_FILE, '{}') } catch {}
  lastQr = ''
  lastQrAscii = ''
  lastError = '已清空微信登录态，请重新扫码。'
  lastMessageAt = ''
  targetRoomId = ''
  targetRoom = null
  targetRooms.clear()
  status = 'idle'
  persistRuntime('relogin_required')
  return startWechatyDutyGroupConnector(opts)
}

export async function stopWechatyDutyGroupConnector(options = {}) {
  suppressReconnect(8000)
  clearReconnectTimer()
  if (!options.preserveRuntime) stopOfflineDetector()
  status = 'idle'
  lastQr = ''
  lastQrAscii = ''
  lastMessageAt = ''
  targetRoomId = ''
  targetRoom = null
  targetRooms.clear()
  try { await bot?.stop?.() } catch {}
  bot = null
  if (!options.preserveRuntime) persistRuntime(status)
  emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status: 'idle' })
}

export async function startWechatyDutyGroupConnector({ pushMessage, emitEvent, groupName, groupNames, enabled } = {}) {
  pushMessageRef = pushMessage || pushMessageRef
  emitEventRef = emitEvent || emitEventRef
  if (groupNames || groupName || enabled !== undefined) configureWechatyDutyGroup({ groupNames, groupName, enabled })
  if (bot && status !== 'idle' && status !== 'error') return { platform: 'wechaty-duty-group', stop: stopWechatyDutyGroupConnector }
  if (bot) {
    await stopWechatyGroupOnly()
    bot = null
  }

  clearReconnectTimer()
  status = 'starting'
  connectionAttemptStartedAt = Date.now()
  lastOfflineAlertKey = ''
  lastError = ''
  persistRuntime(status)
  lastQr = ''
  lastQrAscii = ''
  targetRoomId = ''
  targetRoom = null
  targetRooms.clear()

  const puppet = createWechatyPuppet()
  bot = WechatyBuilder.build({
    name: WECHATY_MEMORY_NAME,
    puppet,
  })

  bot.on('scan', (qrcode, scanStatus) => {
    clearStartWatchdog()
    status = 'qr_ready'
    lastQr = qrcode
    lastQrAscii = qrToAscii(qrcode)
    const label = ScanStatus?.[scanStatus] || scanStatus
    console.log(`[Wechaty] 请扫码登录微信，目标群：${targetGroupNames.join('、')}，状态：${label}`)
    try { qrcodeTerminal.generate(qrcode, { small: true }) } catch {}
    persistRuntime(status)
    emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status, group_names: [...targetGroupNames], qr: qrcode, qr_ascii: lastQrAscii })
    notifyWechatyLoginQrViaClawbot('qr_ready').catch(err =>
      console.warn(`[WechatyOfflineQR] 二维码已生成但 ClawBot 通知异常：${err?.message || err}`)
    )
  })

  bot.on('login', async (user) => {
    clearStartWatchdog()
    status = 'logged_in'
    lastLoginUser = user?.name?.() || ''
    lastLoginUserId = getWechatyContactId(user) || ''
    lastLoginAt = Date.now()
    lastQr = ''
    lastQrAscii = ''
    lastClawbotQrNotifyError = ''
    console.log(`[Wechaty] 登录成功：${lastLoginUser}，正在查找群：${targetGroupNames.join('、')}`)
    reconnectAttempts = 0
    persistRuntime(status)
    emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status, group_names: [...targetGroupNames], user: lastLoginUser })
    await resolveTargetRooms()
  })

  bot.on('ready', async () => {
    clearStartWatchdog()
    await resolveTargetRooms()
  })

  bot.on('logout', (user) => {
    status = 'disconnected'
    targetRoomId = ''
    console.log(`[Wechaty] 已断开/退出：${user?.name?.() || lastLoginUser || ''}`)
    persistRuntime(status)
    emitWechatyStatusEvent({ login_user: lastLoginUser })
    notifyWechatyOffline('logout', { force: true })
    if (!isReconnectSuppressed()) scheduleReconnect('logout')
  })

  bot.on('error', (err) => {
    clearStartWatchdog()
    lastError = err?.message || String(err)
    // wechat4u 登录后常见 `-1 == 0` / `400 != 400` 这类底层同步抖动。
    // 如果已经登录并解析到目标群，不能因为这个暂态错误主动 stop/restart；
    // 否则会把刚扫码成功的会话踢回二维码状态，群里 @ 自然收不到。
    if (isWechat4uTransientError(lastError)) {
      if (hasResolvedRooms() && (isFreshRoomRefresh() || isMessageHealthy())) {
        status = targetRoomId ? 'connected' : 'logged_in'
        console.warn(`[Wechaty] 忽略 wechat4u 暂态/网络抖动错误，保持当前连接：${lastError}`)
        persistRuntime(status)
        emitWechatyStatusEvent({ room_id: targetRoomId, warning: lastError })
        return
      }
      if ((status === 'logged_in' || status === 'connected') && isRecentlyLoggedIn()) {
        status = 'rooms_pending'
        console.warn(`[Wechaty] 登录后群列表尚未稳定，暂不重启，等待消息/群列表恢复：${lastError}`)
        persistRuntime(status)
        emitWechatyStatusEvent({ warning: lastError })
        return
      }
      if (hasResolvedRooms()) {
        status = 'group_lookup_error'
        console.warn(`[Wechaty] wechat4u 暂态错误但连接健康过期，标记为需确认/重登：${lastError}`)
        persistRuntime(status)
        emitWechatyStatusEvent({ warning: lastError })
        return
      }
      if (status === 'qr_ready' || status === 'starting' || status === 'rooms_pending') {
        console.warn(`[Wechaty] 等待登录/群列表期间忽略 wechat4u 暂态错误：${lastError}`)
        persistRuntime(status)
        emitWechatyStatusEvent({ warning: lastError })
        return
      }
    }
    if (!targetRoomId) status = 'error'
    console.error(`[Wechaty] 错误：${lastError}`)
    persistRuntime(status)
    emitWechatyStatusEvent({ room_id: targetRoomId, error: lastError })
    notifyWechatyOffline('error')
    scheduleReconnect('error')
  })

  bot.on('message', handleMessage)

  startOfflineDetector()
  armStartWatchdog(bot)
  bot.start().catch(err => {
    clearStartWatchdog()
    status = 'error'
    lastError = err?.message || String(err)
    persistRuntime(status)
    console.error(`[Wechaty] 启动失败：${lastError}`)
    emitWechatyStatusEvent({ status: 'error', error: lastError })
    notifyWechatyOffline('start_failed')
  })

  return { platform: 'wechaty-duty-group', stop: stopWechatyDutyGroupConnector }
}

export async function syncWechatyDutyGroupRooms() {
  return resolveTargetRooms()
}

async function findWechatyRoomForGroup({ groupId = '', groupName = '' } = {}) {
  const gid = String(groupId || '').trim()
  const wantedRoomId = gid.startsWith('wechaty:') ? gid.slice('wechaty:'.length) : gid
  const wantedName = String(groupName || '').trim()
  if (!targetRooms.size && bot && isLoginActive()) {
    await resolveTargetRooms().catch(() => null)
  }
  if (wantedRoomId) {
    for (const room of targetRooms.values()) {
      if (String(room?.id || '') === wantedRoomId) return { room, topic: await safeTopic(room) }
    }
  }
  if (wantedName && targetRooms.has(wantedName)) return { room: targetRooms.get(wantedName), topic: wantedName }
  if (!bot || !isLoginActive()) return { room: null, topic: wantedName }
  try {
    const rooms = await bot.Room.findAll()
    for (const room of rooms || []) {
      const topic = await safeTopic(room)
      if ((wantedRoomId && String(room?.id || '') === wantedRoomId) || (wantedName && topic === wantedName)) {
        targetRooms.set(topic, room)
        return { room, topic }
      }
    }
  } catch (err) {
    console.warn(`[WechatyStats] 查找指定群成员刷新目标失败 group="${wantedName || wantedRoomId}"：${err?.message || err}`)
  }
  return { room: null, topic: wantedName }
}

export async function refreshWechatyDutyGroupMemberNames({ force = true, groupId = '', groupName = '' } = {}) {
  if (groupId || groupName) {
    const found = await findWechatyRoomForGroup({ groupId, groupName })
    if (!found.room?.id) return { ok: false, rooms: 0, members: 0, named: 0, updated: 0, error: '未找到当前微信群或微信助手未在线' }
    if (force) memberNameRefreshAt.delete(`wechaty:${found.room.id}`)
    const result = await refreshRoomMemberDisplayNames(found.room, found.topic || groupName, { force })
    return { ok: true, rooms: 1, members: Number(result?.members || 0), named: Number(result?.named || 0), updated: Number(result?.updated || 0), results: [result] }
  }
  if (!targetRooms.size && bot && isLoginActive()) {
    await resolveTargetRooms().catch(() => null)
  }
  const results = []
  for (const [topic, room] of targetRooms.entries()) {
    if (!room?.id) continue
    if (force) memberNameRefreshAt.delete(`wechaty:${room.id}`)
    results.push(await refreshRoomMemberDisplayNames(room, topic, { force }))
  }
  const totals = results.reduce((acc, row) => ({
    rooms: acc.rooms + 1,
    members: acc.members + Number(row?.members || 0),
    named: acc.named + Number(row?.named || 0),
    updated: acc.updated + Number(row?.updated || 0),
  }), { rooms: 0, members: 0, named: 0, updated: 0 })
  return { ok: true, ...totals, results }
}

async function resolveTargetRooms() {
  if (!bot) return null
  if (!isLoginActive()) {
    console.log(`[Wechaty] 当前状态 ${status} 尚未登录，不刷新群列表，保留现有设置。`)
    persistRuntime(status)
    return null
  }
  let firstRoom = null
  try {
    const rooms = await bot.Room.findAll()
    const snapshot = []
    for (const candidate of rooms) {
      const topic = await safeTopic(candidate)
      if (topic) snapshot.push({ id: candidate.id, topic, selected: isAllowedGroupTopic(topic) })
    }
    if (snapshot.length) {
      roomSnapshot = markSelectedRooms(snapshot).sort((a, b) => Number(b.selected) - Number(a.selected) || a.topic.localeCompare(b.topic, 'zh-Hans-CN'))
      lastRoomRefreshAt = new Date().toISOString()
      persistRuntime(status)
    } else if (roomSnapshot.length) {
      console.warn('[Wechaty] 群列表暂时为空，仅保留上次缓存；当前连接不可确认。')
    }
    for (const name of targetGroupNames) {
      let room = null
      try { room = await bot.Room.find({ topic: name }) } catch {}
      if (!room) {
        for (const candidate of rooms) {
          const topic = await safeTopic(candidate)
          if (topic === name) { room = candidate; break }
        }
      }
      if (!room) {
        for (const candidate of rooms) {
          const topic = await safeTopic(candidate)
          if (topic.includes(name) || name.includes(topic)) { room = candidate; break }
        }
      }
      if (room) {
        targetRooms.set(name, room)
        if (!firstRoom) firstRoom = room
        const topic = await safeTopic(room)
        console.log(`[Wechaty] 已接入群：${topic} (${room.id})`)
        scheduleRoomMemberNameRefresh(room, topic)
      } else {
        console.warn(`[Wechaty] 已登录，但未找到群：${name}。请确认当前微信在该群里，或等群里发一条消息。`)
      }
    }
    if (!firstRoom && snapshot.length === 0) {
      status = 'logged_in'
      persistRuntime('rooms_pending')
      emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status: 'rooms_pending', group_names: [...targetGroupNames], rooms: roomSnapshot })
      return null
    }
    if (!firstRoom) {
      status = 'logged_in'
      persistRuntime('group_not_found')
      emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status: 'group_not_found', group_names: [...targetGroupNames], rooms: roomSnapshot })
      return null
    }
    targetRoom = firstRoom
    targetRoomId = firstRoom.id
    lastQr = ''
    lastQrAscii = ''
    status = 'connected'
    persistRuntime(status)
    emitEventRef?.('social_status', {
      platform: 'wechaty-duty-group',
      status,
      group_names: [...targetGroupNames],
      room_id: targetRoomId,
      room_ids: Object.fromEntries([...targetRooms.entries()].map(([name, room]) => [name, room?.id || ''])),
      room_count: roomSnapshot.length,
      rooms: roomSnapshot,
      last_room_refresh_at: lastRoomRefreshAt,
    })
    return firstRoom
  } catch (err) {
    lastError = err?.message || String(err)
    console.warn(`[Wechaty] 查找群失败：${lastError}`)
    persistRuntime('group_lookup_error')
    emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status: 'group_lookup_error', group_names: [...targetGroupNames], error: lastError, rooms: roomSnapshot })
    return null
  }
}

async function handleMessage(message) {
  try {
    const isSelf = !!message.self?.()
    const room = message.room?.()
    if (!room) return
    const topic = await safeTopic(room)
    const assistantEnabledForGroup = isAllowedGroupTopic(topic)
    const groupId = `wechaty:${room.id}`
    const groupExternalId = makeWeChatGroupExternalId(groupId)
    const archiveRuntime = getWechatGroupArchiveRuntimeForGroup({ groupId, groupName: topic })
    const recordEnabledForGroup = archiveRuntime.recordEnabled
    const mediaEnabledForGroup = archiveRuntime.mediaEnabled
    const imageParseEnabledForGroup = archiveRuntime.imageParseEnabled

    if (assistantEnabledForGroup) {
      targetRooms.set(topic, room)
      if (lastQr) {
        lastQr = ''
        lastQrAscii = ''
      }
      if (/未获取到真实群列表|只显示上次缓存|需要重新扫码/u.test(lastError)) lastError = ''
    }
    if (assistantEnabledForGroup && (!targetRoomId || status !== 'connected')) {
      targetRoomId = room.id
      targetRoom = room
      status = 'connected'
      persistRuntime(status)
      emitEventRef?.('social_status', { platform: 'wechaty-duty-group', status, group_names: [...targetGroupNames], room_id: targetRoomId })
    }
    lastMessageAt = new Date().toISOString()
    if (!recordEnabledForGroup) {
      console.log(`[WechatyArchive] 群未开启聊天记录范围，跳过聊天入库和回复 topic="${topic}"`)
      return
    }
    scheduleRoomMemberNameRefresh(room, topic)

    const rawText = String(message.text?.() || '').trim()
    let messageType = ''
    try { messageType = message.type?.() ?? '' } catch {}
    const talker = message.talker?.()
    const rawWechatPayload = await getWechatRawMessagePayload(message)
    const rawPayloadText = compactRawPayloadForQuote(rawWechatPayload)
    const rawSenderName = extractRawWechatSenderName(rawWechatPayload)
    const senderId = getWechatyContactId(talker)
    const senderParts = isSelf ? { displayName: '我', roomAlias: '', contactAlias: '', contactName: '我', wechatId: '', wxid: '', stableKey: '', rawIdentity: '' } : await resolveWechatyMemberNameParts(room, talker, senderId)
    if (rawSenderName && !isWeChatInternalIdLike(rawSenderName) && senderParts.displayName === '未知成员') senderParts.displayName = rawSenderName
    const senderName = senderParts.displayName
    if (recordEnabledForGroup && senderId && senderName && senderName !== '未知成员') {
      try {
        upsertWeChatGroupMemberName({
          groupId,
          groupName: topic,
          senderId,
          displayName: senderName,
          roomAlias: senderParts.roomAlias || rawSenderName,
          contactAlias: senderParts.contactAlias,
          contactName: senderParts.contactName,
          wechatId: senderParts.wechatId,
          wxid: senderParts.wxid,
          stableKey: senderParts.stableKey,
          rawIdentity: senderParts.rawIdentity,
          source: 'wechaty-message',
        })
      } catch (err) {
        console.warn(`[WechatyStats] 更新成员昵称失败：${err?.message || err}`)
      }
    }
    const mentionContacts = await getWechatyMentionContacts(message)
    const mentionContactIds = mentionContacts.map(contact => getWechatyContactId(contact)).filter(Boolean)
    const mentionContactNames = []
    for (const contact of mentionContacts) {
      try { mentionContactNames.push(await resolveWechatyMemberDisplayName(room, contact, getWechatyContactId(contact))) } catch {}
    }
    let mentionedSelf = false
    try { mentionedSelf = !!(await message.mentionSelf?.()) } catch {}
    if (!mentionedSelf) {
      mentionedSelf = detectWechatyLoginMention({
        text: rawText,
        rawPayload: rawWechatPayload,
        loginName: lastLoginUser || previousLoginUser(),
        loginId: lastLoginUserId,
        mentionedContactIds: mentionContactIds,
        mentionedContactNames: mentionContactNames,
      })
    }
    const mentionedMembers = await getMentionedGroupMembers(message, room, rawText)
    let mediaInfo = null
    let imageVisionText = ''
    const isVideoMessage = isWechatVideoMessageType(messageType)
    try {
      mediaInfo = isVideoMessage
        ? { stored: false, skipped: true, reason: 'video_analysis_temp_only', type: normalizeWechatMessageType(messageType) }
        : (mediaEnabledForGroup
            ? await persistWechatMessageMedia(message, { groupId, groupName: topic, senderId })
            : { stored: false, skipped: true, reason: 'group_not_selected_for_media_archive' })
      if (imageParseEnabledForGroup && mediaInfo?.stored) {
        const mediaRecord = upsertWeChatImageMediaItem({
          groupId,
          groupName: topic,
          senderId: senderId || senderName,
          senderName,
          mediaInfo,
          sourceText: rawText,
          messageType,
        })
        if (mediaRecord?.ok && mediaRecord.item?.id) {
          mediaInfo.mediaId = mediaRecord.item.id
          // 图片入库后统一进入后台识图；不要在消息入口同步阻塞。
          // 否则“先 @、再发文字、再发图片”的连续操作会在图片尚未入库时就把 LLM 触发掉，
          // 最终只看到 [图片] 占位。真正需要即时识图时由后面的直接识图回复链路按最近图片主动拉取。
          maybeDescribeWeChatImageMedia({ mediaItem: mediaRecord.item, wait: false }).catch(() => {})
        }
      }
    } catch (err) { console.warn(`[WechatyStats] 保存/识别群媒体失败：${err?.message || err}`) }
    const statsRawText = mediaInfo?.stored ? `${rawText || normalizeWeChatGroupDisplayText(rawText, messageType)}
[媒体文件] ${mediaInfo.relativePath}
${imageVisionText}`.trim() : rawText
    let activity = null
    if (recordEnabledForGroup) {
      try {
        activity = recordWeChatGroupActivity({
          groupId,
          groupName: topic,
          senderId: senderId || senderName,
          senderName,
          text: statsRawText,
          messageType,
          mentionedSelf,
          source: 'wechaty',
          force: true,
        })
      } catch (err) {
        console.warn(`[WechatyStats] 写入群统计失败：${err?.message || err}`)
      }
    }
    const text = imageVisionText
      ? `${activity?.displayText || normalizeWeChatGroupDisplayText(rawText, messageType)}\n${imageVisionText}`.trim()
      : (activity?.displayText || normalizeWeChatGroupDisplayText(rawText, messageType))
    if (!text) return
    rememberRecentWechatUserMessage({
      groupId,
      senderId: senderId || senderName,
      senderName,
      text,
      mediaId: mediaInfo?.mediaId || 0,
      messageType,
      mentionedSelf,
      message,
      messageId: message?.id || '',
    })

    if (!mentionedSelf) {
      mentionedSelf = detectWechatyLoginMention({
        text: rawText || text,
        rawPayload: rawWechatPayload,
        loginName: lastLoginUser || previousLoginUser(),
        loginId: lastLoginUserId,
        mentionedContactIds: mentionContactIds,
        mentionedContactNames: mentionContactNames,
      })
    }
    console.log(`[Wechaty] 收到群消息 topic="${topic}" sender="${senderName}" self=${isSelf} mention=${mentionedSelf} other_mentions=${mentionedMembers.map(item => item.name || item.id).join('、')} text=${text.slice(0, 100)}`)

    // 非“微信群助手接入群”只按记录范围入库，不进入 Honcho/LLM/自动回复链路。
    if (!assistantEnabledForGroup) return

    // 已开启记录范围的群消息写入当前群专属记忆库；默认不打扰、不回复。
    if (recordEnabledForGroup) {
      archiveWeChatGroupMessage({ groupId, senderId: senderName, text })
      recordWeChatGroupMessage({ groupId, groupName: topic, senderId: senderId || senderName, senderName, text, mentionedSelf, source: 'wechaty' }).catch(err => console.warn(`[Honcho] 写入群记忆失败：${err?.message || err}`))
    }
    if (isWechatyBlockedSender(senderId)) {
      console.log(`[Wechaty] 已屏蔽成员消息，不进入回复链路 topic="${topic}" sender="${senderName}" sender_id="${senderId}" mention=${mentionedSelf}`)
      return
    }
    // @ 当前扫码登录的微信号时必回；非 @ 消息只有显式开启主动回复并通过群级冷却后才进入回复链路。
    // 注意：@ 场景不再做任何关键词/意图/内容二次过滤，也不做硬编码回复。
    if (!wechatyGroupReplyEnabled) return
    const replyTrigger = shouldTriggerWechatyGroupReply({ mentionedSelf, isSelf, groupId, text })
    if (!replyTrigger.ok) return

    let replyText = text
    if (isBareWechatMentionText(replyText) || hasWechatImageUnderstandingIntent(replyText)) {
      await waitWechatMediaWindow()
      const combinedText = buildWechatImageUnderstandingText({
        groupId,
        senderId: senderId || senderName,
        senderName,
        fallback: replyText,
      })
      if (combinedText && combinedText !== replyText) {
        console.log(`[Wechaty] 合并连续微信消息 topic="${topic}" sender="${senderName}" before="${replyText.slice(0, 80)}" after="${combinedText.slice(0, 160)}"`)
        replyText = combinedText
      }
    }
    const imagePrepared = await prepareWechatImageReplyText({
      groupId,
      groupName: topic,
      senderId: senderId || senderName,
      senderName,
      mediaInfo,
      text: replyText,
      rawText,
      rawPayloadText,
      messageType,
      mentionedSelf,
    })
    if (!imagePrepared.ok) return
    const imageReplyContext = imagePrepared.imageContext
    replyText = imagePrepared.text || replyText

    console.log(`[Wechaty] 群消息 topic="${topic}"${isSelf ? ' self=true' : ''}${mentionedSelf ? ' mentioned_self=true' : ''} trigger=${replyTrigger.reason} sender="${senderName}": ${replyText.slice(0, 100)}`)

    const adminVerified = await isWechatyGroupAdminSender({ senderId, senderName, groupId, groupName: topic })
    const adminProtectionReply = adminVerified ? '' : buildAdminProtectionReply({ groupId, groupName: topic, senderId, text: replyText })
    if (adminProtectionReply) {
      await sendWechatyDutyGroupMessage(room.id, adminProtectionReply, { mentionId: senderId, mentionName: senderName })
      recordWeChatGroupAssistantReply({ groupId, groupName: topic, reply: adminProtectionReply, targetMemberName: senderName, source: 'wechaty' }).catch(() => {})
      return
    }
    const safety = adminVerified ? { allowed: true, adminBypass: true } : checkWeChatGroupCommandSafety(replyText)
    if (!safety.allowed) {
      const refusal = safety.reason
      await sendWechatyDutyGroupMessage(room.id, refusal, { mentionId: senderId, mentionName: senderName })
      recordWeChatGroupAssistantReply({ groupId, groupName: topic, reply: refusal, targetMemberName: senderName, source: 'wechaty' }).catch(() => {})
      return
    }
    if (adminVerified) {
      console.warn(`[WechatyAdmin] 管理员指令已通过精确 sender_id 验证，跳过微信群黑名单 topic="${topic}" sender="${senderName}" sender_id="${senderId}"`)
      emitEventRef?.('wechat_admin_command', { group_name: topic, room_id: room.id, sender_name: senderName, sender_id: senderId || '', text: replyText.slice(0, 300), timestamp: new Date().toISOString() })
    }

    if (recordEnabledForGroup) {
      recordWeChatGroupExplicitMemories({ groupId, groupName: topic, senderId: senderId || senderName, senderName, text: replyText, source: 'wechaty' })
        .then(result => {
          if (result?.count) console.log(`[Honcho] 已沉淀群显式记忆 topic="${topic}" sender="${senderName}" count=${result.count}`)
        })
        .catch(err => console.warn(`[Honcho] 显式群记忆写入失败：${err?.message || err}`))
    }

    if (await tryDirectGroupSummaryPosterReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic })) {
      return
    }

    if (await tryDirectImageTaggingReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic, rawText: rawText || replyText, rawPayloadText, messageType })) {
      return
    }

    if (isBareWechatMentionText(replyText) || isWechatVideoAnalysisIntent(replyText) || /\b视频\b|视频|短视频|录像|录屏|片段|电影|影视/u.test(replyText)) {
      await waitWechatMediaWindow()
    }

    if (await tryDirectVideoAnalysisReply(room, message, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic, rawText: rawText || replyText, rawPayloadText, messageType })) {
      return
    }

    if (!imageReplyContext?.media_id && await tryDirectImageUnderstandingReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic, rawText: rawText || replyText, rawPayloadText, messageType })) {
      return
    }

    if (await tryDirectStoredImageReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic })) {
      return
    }

    if (await tryDirectImageGenerationReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic })) {
      return
    }

    if (!adminVerified && await tryDirectPublicImageReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic })) {
      return
    }

    if (!adminVerified && await tryDirectMemeReply(room, replyText, { senderId: senderId || '', senderName, groupId, groupName: topic })) {
      return
    }

    emitEventRef?.('message_in', {
      from_id: groupExternalId,
      content: formatGroupLine(senderName, replyText),
      channel: WECHAT_GROUP_CHANNEL,
      external_party_id: groupExternalId,
      social: { platform: 'wechaty-duty-group', group_name: topic, room_id: room.id, sender_name: senderName, sender_id: senderId || '', mentioned_self: mentionedSelf, reply_trigger: replyTrigger.reason, reply_mention_id: senderId || '', reply_mention_name: senderName || '', user_text: replyText, raw_user_text: rawText || replyText, raw_payload_text: rawPayloadText || '', message_type: messageType || '', wechat_admin: adminVerified, mentioned_members: mentionedMembers, image_context: imageReplyContext },
      timestamp: new Date().toISOString(),
    })

    const replyTargetId = makeWechatyGroupReplyTargetId(room.id, senderId || senderName, senderName)
    const replySocial = {
      platform: 'wechaty-duty-group',
      group_name: topic,
      room_id: room.id,
      sender_name: senderName,
      sender_id: senderId || '',
      mentioned_self: mentionedSelf,
      reply_trigger: replyTrigger.reason,
      reply_mention_id: senderId || '',
      reply_mention_name: senderName || '',
      user_text: replyText,
      raw_user_text: rawText || replyText,
      raw_payload_text: rawPayloadText || '',
      message_type: messageType || '',
      wechat_admin: adminVerified,
      mentioned_members: mentionedMembers,
      image_context: imageReplyContext,
    }
    const prompt = await buildWeChatGroupCommandPrompt({
      groupId,
      groupName: topic,
      senderId: senderId || senderName,
      senderName,
      text: replyText,
      rawText: rawText || replyText,
      rawPayloadText,
      messageType,
      mentionedSelf,
      mentionedMembers,
      adminVerified,
      replyTargetId,
    })
    pushMessageRef?.(replyTargetId, prompt, WECHAT_GROUP_CHANNEL, {
      noPersist: true,
      noPrune: true,
      noPreempt: true,
      externalPartyIdOverride: `wechaty:room:${room.id}`,
      groupArchiveId: groupExternalId,
      social: replySocial,
    })
  } catch (err) {
    console.warn(`[Wechaty] 处理群消息失败：${err?.message || err}`)
  }
}


function includeDigestConfig(cfg = {}) {
  return {
    messageLeaderboard: cfg.messageLeaderboard !== false,
    imageLeaderboard: cfg.imageLeaderboard !== false,
    emojiLeaderboard: cfg.emojiLeaderboard !== false,
    linkLeaderboard: cfg.linkLeaderboard !== false,
    bragLeaderboard: cfg.bragLeaderboard !== false,
  }
}

function resolveDirectGroupSummaryMode(text = '') {
  return /(?:今天|今日|当天|本日|日报|日总结|从早|上午|下午|晚上|凌晨)/u.test(String(text || '')) ? 'daily' : 'interval'
}

function resolveDirectGroupSummaryRange(mode = 'interval', cfg = {}, now = new Date()) {
  if (mode === 'daily') {
    const from = new Date(now)
    from.setHours(0, 0, 0, 0)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  const minutes = Math.max(Number(cfg.intervalMinutes || 180), 30)
  return { from: new Date(now.getTime() - minutes * 60 * 1000).toISOString(), to: now.toISOString() }
}

async function tryDirectGroupSummaryPosterReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '' } = {}) {
  if (!isGroupSummaryRequest(text)) return false
  const cfg = getWeChatGroupDigestConfig()
  const mode = resolveDirectGroupSummaryMode(text)
  const range = resolveDirectGroupSummaryRange(mode, cfg)
  const stats = getWeChatGroupStats({ groupId, groupName, from: range.from, to: range.to, limit: 8 })
  const summary = buildWeChatGroupStatsDigest({ ...stats, group_name: groupName || stats.group_name }, { mode, include: includeDigestConfig(cfg) })
  let poster = null
  try {
    poster = await renderWeChatGroupStatsPosterPng(
      { ...stats, group_name: groupName || stats.group_name },
      { templateId: cfg.reportTemplate || 'guochao-red-gold' }
    )
    if (poster?.ok && poster.filePath) {
      const sent = await sendWechatyDutyGroupMessage(room.id, '', {
        imageFilePaths: [poster.filePath],
        timeoutMs: 45000,
      })
      if (sent?.ok) {
        recordWeChatGroupAssistantReply({
          groupId,
          groupName,
          reply: `[群聊图片战报] ${cfg.reportTemplate || 'guochao-red-gold'} ${poster.filePath}`,
          targetMemberName: senderName,
          source: 'wechaty-direct-group-summary',
        }).catch(() => {})
        return true
      }
      console.warn(`[WechatyDigest] 群内总结图片发送失败，回退文字：${sent?.error || sent?.reason || 'unknown'}`)
    }
  } catch (err) {
    poster = { ok: false, error: err?.message || String(err) }
    console.warn(`[WechatyDigest] 群内总结长图生成失败，回退文字：${poster.error}`)
  }
  await sendWechatyDutyGroupMessage(room.id, summary, { mentionId: senderId, mentionName: senderName })
  recordWeChatGroupAssistantReply({
    groupId,
    groupName,
    reply: summary,
    targetMemberName: senderName,
    source: 'wechaty-direct-group-summary-fallback',
  }).catch(() => {})
  return true
}

function extractMemeQueryFromWechatText(text = '') {
  return String(text || '')
    .replace(/^[@＠][^\s      ，,：:、]{1,40}/u, '')
    .replace(/(?:发|来|整|给|找|搜|搞|要|一个|一张|个|张|点|的|一下|吧|啊|呀|哈)/giu, ' ')
    .replace(/(?:表情包|表情|梗图|斗图|gif|GIF|动图|图片|图)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24) || '表情包'
}

function extractPublicImageQueryFromWechatText(text = '') {
  return String(text || '')
    .replace(/^[@＠][^\s      ，,：:、]{1,40}/u, '')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/(?:发|发送|来|整|给我|找|搜|搜索|要|一个|一张|张|个|一下|吧|啊|呀|哈|公开|网络|网上)/giu, ' ')
    .replace(/(?:图片|照片|壁纸|头像|配图|示意图|产品图|实拍图|图)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || '有趣图片'
}

async function tryDirectPublicImageReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '' } = {}) {
  if (!DIRECT_PUBLIC_IMAGE_REQUEST_RE.test(String(text || ''))) return false
  const query = extractPublicImageQueryFromWechatText(text)
  const result = await searchPublicImages({ query, count: 8, provider: 'auto' })
  const items = Array.isArray(result?.items) ? result.items : []
  const item = items[Math.floor(Math.random() * Math.max(1, items.length))]
  if (!result?.ok || !item?.url) {
    console.warn(`[WechatyImageSearch] 网络图片搜索失败 topic="${groupName}" sender="${senderName}" query="${query}" error="${result?.error || 'unknown'}"`)
    await sendWechatyDutyGroupMessage(room.id, `我这边没搜到可直接发送的公开图片：${result?.error || '图片搜索失败'}`, { mentionId: senderId, mentionName: senderName })
    return true
  }
  console.log(`[WechatyImageSearch] 直接网络图片回复 topic="${groupName}" sender="${senderName}" query="${query}" provider="${result.provider}" url="${item.url}"`)
  await sendWechatyDutyGroupMessage(room.id, item.url, { mentionId: senderId, mentionName: senderName })
  recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[网络图片] ${query} ${item.url}`, targetMemberName: senderName, source: 'wechaty-public-image-search' }).catch(() => {})
  return true
}

async function tryDirectMemeReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '' } = {}) {
  if (!DIRECT_MEME_REQUEST_RE.test(String(text || ''))) return false
  const query = extractMemeQueryFromWechatText(text)
  const result = await searchMemes({ query, count: 8, seed: `${groupId}:${senderId}:${Date.now()}` })
  const item = result?.items?.[0]
  if (!result?.ok || !item?.url) return false
  console.log(`[WechatyMeme] 直接表情包回复 topic="${groupName}" sender="${senderName}" query="${query}" url="${item.url}"`)
  await sendWechatyDutyGroupMessage(room.id, item.url, { mentionId: senderId, mentionName: senderName })
  return true
}

const STORED_IMAGE_SEND_RE = /(?:发|发送|转发|传|给我|发我|拿给我|调用|调出来|找出|找一下).{0,36}(?:那张|这张|刚才|刚刚|上面|前面|原图|图片|图库|图|照片|山水画|截图|标签)|(?:那张|这张|刚才|刚刚|上面|前面|图库|标签).{0,36}(?:发|发送|转发|传|给我|发我|拿给我|调用|调出来|找出)/u
const IMAGE_TAGGING_REQUEST_RE = /(?:给|帮|把|将|替)?(?:这张|那张|引用|上面|前面|刚才|刚刚)?(?:图片|图|照片|截图)?.{0,12}(?:打标签|加标签|标记|记住|存为|归类|命名为|叫做|设为|备注为)|(?:标签|tag|TAG)[:：]/u

function summarizeVisionDescription(description = '') {
  const text = String(description || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 520 ? `${text.slice(0, 520)}…` : text
}

function pickRecentImageCandidate(items = []) {
  const now = Date.now()
  const rows = (Array.isArray(items) ? items : []).filter(Boolean)
  return rows.find(row => {
    const ts = Date.parse(row.created_at || row.updated_at || '')
    return Number.isFinite(ts) && now - ts <= 15 * 60 * 1000 && String(row.message_type || '') !== '5'
  }) || rows.find(row => String(row.message_type || '') !== '5') || rows[0] || null
}

function parseImageMemoryLabels(text = '') {
  const value = String(text || '')
  const chunks = []
  const patterns = [
    /(?:标签|tag|TAG)[:：]\s*([^\n。；;]+)/u,
    /(?:打标签|加标签|标记为|记住为|存为|归类为|命名为|叫做|设为|备注为)\s*([^\n。；;]+)/u,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match?.[1]) chunks.push(match[1])
  }
  if (!chunks.length) return []
  return [...new Set(chunks.join(' ')
    .replace(/[“”"']/g, ' ')
    .split(/[，,、/\s]+/u)
    .map(v => v.trim())
    .filter(v => v && !/^(这张|那张|图片|照片|截图|引用|上面|前面|刚才|刚刚|标签|tag)$/iu.test(v))
    .slice(0, 12))]
}

function labelsFromMediaRow(row = {}) {
  try {
    const parsed = JSON.parse(row.labels_json || '[]')
    return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

async function tryDirectImageTaggingReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '', rawText = '', rawPayloadText = '', messageType = '' } = {}) {
  const value = String(text || '')
  if (!IMAGE_TAGGING_REQUEST_RE.test(value)) return false
  const labels = parseImageMemoryLabels(value)
  if (!labels.length) return false
  const quote = extractWeChatQuoteContext({ text: value || rawText, rawText: rawPayloadText || rawText || value, messageType })
  const quotedImage = quote?.ok && quote.kind === 'image'
    ? findWeChatImageMediaForQuote({ groupId, groupName, quote, query: value, limit: 5 })
    : { items: [] }
  const found = findWeChatImageMediaForRequest({ groupId, groupName, query: `${value} 刚才 最近`, limit: 8 })
  const recentMediaId = getLatestRecentWechatMediaId({ groupId, senderId, senderName })
  const item = (quotedImage.items || [])[0]
    || (found.items || []).find(row => Number(row.id || 0) === recentMediaId)
    || pickRecentImageCandidate(found.items || [])
  if (!item?.id) {
    await sendWechatyDutyGroupMessage(room.id, '我没在当前群图片库里匹配到这张图。你把原图直接再发一次，然后引用它说“打标签：xxx”。', { mentionId: senderId, mentionName: senderName })
    return true
  }
  let description = item.description || ''
  if (!description) {
    const vision = await describeWeChatImageMedia({ mediaId: item.id })
    description = vision?.description || ''
  }
  const mergedLabels = [...new Set([...labelsFromMediaRow(item), ...labels])].slice(0, 30)
  const nextDescription = description || `用户标签：${mergedLabels.join('、')}`
  const updated = updateWeChatImageMediaItem({ id: item.id, description: nextDescription, labels: mergedLabels, visionStatus: nextDescription ? 'done' : 'pending' })
  if (!updated?.ok) {
    await sendWechatyDutyGroupMessage(room.id, `图片标签保存失败：${updated?.error || 'unknown'}`, { mentionId: senderId, mentionName: senderName })
    return true
  }
  await sendWechatyDutyGroupMessage(room.id, `已给这张图打标签：${mergedLabels.join('、')}。以后可以直接说“发那张 ${labels[0]} 图”。`, { mentionId: senderId, mentionName: senderName })
  recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[图片标签] media=${item.id} labels=${mergedLabels.join('、')}`, targetMemberName: senderName, source: 'wechaty-image-tagging' }).catch(() => {})
  return true
}

async function tryDirectImageUnderstandingReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '', rawText = '', rawPayloadText = '', messageType = '' } = {}) {
  const value = String(text || '')
  const gate = getWechatImageUnderstandingGate({ text: value, rawText, rawPayloadText, messageType })
  if (!gate.handle) return false
  const quote = gate.quote
  const quotedImage = quote?.ok && quote.kind === 'image'
    ? findWeChatImageMediaForQuote({ groupId, groupName, quote, query: value, limit: 5 })
    : { items: [] }
  const found = findWeChatImageMediaForRequest({ groupId, groupName, query: `${value} 刚才 最近`, limit: 8 })
  const recentMediaId = getLatestRecentWechatMediaId({ groupId, senderId, senderName })
  const item = (quotedImage.items || [])[0]
    || (found.items || []).find(row => Number(row.id || 0) === recentMediaId)
    || pickRecentImageCandidate(found.items || [])
  if (!item?.id) {
    const hint = quotedImage?.ok
      ? '我看到了你引用的是图片，但没能在当前群本地图片库里匹配到对应原图。可能是这张图发送时我还没在线入库，或引用没有带可匹配的消息 ID。'
      : '我没在当前群最近图片库里找到可识别的图片。'
    await sendWechatyDutyGroupMessage(room.id, `${hint} 你可以把原图直接再发一次，我收到后会自动入库识别。`, { mentionId: senderId, mentionName: senderName })
    return true
  }

  console.log(`[WechatImageVision] 直接识图回复 topic="${groupName}" sender="${senderName}" media_id=${item.id} status=${item.vision_status || ''} quote=${quotedImage.items?.[0]?.id ? 'matched' : 'no'} query="${value.slice(0, 120)}"`)
  if (!item.description) {
    sendWechatyDutyGroupMessage(room.id, '收到，图片已入库，正在识别；如果模型渠道不通我会把具体错误发出来。', { mentionId: senderId, mentionName: senderName, timeoutMs: 8000 }).catch(() => {})
  }
  const vision = item.description
    ? { ok: true, description: item.description, item }
    : await describeWeChatImageMedia({ mediaId: item.id })

  if (vision?.description) {
    const summary = summarizeVisionDescription(vision.description)
    await sendWechatyDutyGroupMessage(room.id, `这张图大意：${summary}`, { mentionId: senderId, mentionName: senderName })
    recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[识图总结] ${summary}`, targetMemberName: senderName, source: 'wechaty-image-vision-direct' }).catch(() => {})
    return true
  }

  const status = (() => { try { return getWeChatImageVisionStatus() } catch { return null } })()
  const runtime = status?.runtime ? `${status.runtime.model || 'unknown'} @ ${status.runtime.baseURL || status.runtime.provider || ''}` : '未配置可用识图模型'
  const error = String(vision?.error || item.vision_error || '识图模型没有返回内容').replace(/\s+/g, ' ').slice(0, 360)
  await sendWechatyDutyGroupMessage(room.id, `图片已经收到并入库，但识图模型解析失败：${error}。当前识图：${runtime}。你需要换一个可用的多模态模型/中转后再点“解析待处理”。`, { mentionId: senderId, mentionName: senderName })
  recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[识图失败] ${error}`, targetMemberName: senderName, source: 'wechaty-image-vision-direct' }).catch(() => {})
  return true
}

async function tryDirectVideoAnalysisReply(room, message, text = '', { senderId = '', senderName = '', groupId = '', groupName = '', rawText = '', rawPayloadText = '', messageType = '' } = {}) {
  const quote = extractWeChatQuoteContext({ text: text || rawText, rawText: rawPayloadText || rawText || text, messageType })
  const currentIsVideo = isWechatVideoMessageType(messageType)
  const wantsVideo = hasWechatVideoReferenceIntent(text || rawText, { quote }) || (currentIsVideo && isBareWechatMentionText(text))
  if (!currentIsVideo && !wantsVideo) return false
  const candidate = currentIsVideo && message?.toFileBox
    ? { message, messageId: message?.id || '', source: 'current' }
    : getRecentWechatVideoCandidate({ groupId, senderId, senderName, preferSender: !(quote?.ok && quote.kind === 'video'), quote })
  if (!candidate?.message?.toFileBox) {
    if (!wantsVideo) return false
    await sendWechatyDutyGroupMessage(room.id, '我看到了你要我看视频，但当前群最近没有可读取的视频文件。请把原视频直接发到群里后，再说“看看这个视频”。', { mentionId: senderId, mentionName: senderName })
    recordWeChatGroupAssistantReply({ groupId, groupName, reply: '[视频解析失败] no_recent_video_message', targetMemberName: senderName, source: 'wechaty-video-analysis' }).catch(() => {})
    return true
  }
  console.log(`[WechatVideoSkill] 命中微信群视频解析 topic="${groupName}" sender="${senderName}" source="${candidate.source || 'recent'}" video_sender="${candidate.senderName || senderName}" text="${String(text || '').slice(0, 120)}"`)
  await sendWechatyDutyGroupMessage(room.id, '收到，正在临时读取这个视频，解析完会删除本地临时文件。', { mentionId: senderId, mentionName: senderName, timeoutMs: 8000 })
  try {
    const result = await analyzeWechatVideoMessage({ message: candidate.message, text, messageType: candidate.messageType || messageType || 'video', messageId: candidate.messageId || message?.id || '' })
    if (!result.ok) {
      await sendWechatyDutyGroupMessage(room.id, result.error || '视频解析失败：未知错误', { mentionId: senderId, mentionName: senderName })
      recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[视频解析失败] ${result.error || 'unknown'}`, targetMemberName: senderName, source: 'wechaty-video-analysis' }).catch(() => {})
      return true
    }
    const content = String(result.content || '').trim().slice(0, 1400)
    await sendWechatyDutyGroupMessage(room.id, `视频大意：${content}`, { mentionId: senderId, mentionName: senderName })
    recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[视频解析] ${content}`, targetMemberName: senderName, source: 'wechaty-video-analysis' }).catch(() => {})
    return true
  } catch (err) {
    await sendWechatyDutyGroupMessage(room.id, `视频解析失败：${err?.message || err}`, { mentionId: senderId, mentionName: senderName })
    return true
  }
}

export const __wechatyMentionTestInternals = {
  normalizeWechatyMentionName,
  pickWechatyMentionDisplayName,
  buildManualWechatMentionText,
}

export const __wechatyVideoTestInternals = {
  rememberRecentWechatUserMessage,
  getRecentWechatVideoCandidate,
  hasWechatVideoReferenceIntent,
  hasWechatImageUnderstandingIntent,
  getWechatImageUnderstandingGate,
  buildWechatImageEnhancedText,
  buildWechatImageReplyContext,
  videoReferenceWindowMs: WECHAT_VIDEO_REFERENCE_WINDOW_MS,
  ageRecentWechatVideosForTest(ms = 0) {
    const delta = Number(ms || 0)
    for (const list of recentWechatGroupVideos.values()) {
      for (const item of list) item.at = Number(item.at || Date.now()) - delta
    }
    for (const list of recentWechatUserMessages.values()) {
      for (const item of list) item.at = Number(item.at || Date.now()) - delta
    }
  },
  clearRecentWechatVideos() {
    recentWechatGroupVideos.clear()
    recentWechatUserMessages.clear()
  },
}

async function tryDirectStoredImageReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '' } = {}) {
  const value = String(text || '')
  if (!STORED_IMAGE_SEND_RE.test(value)) return false
  if (isWechatImageGenerationRequest(value)) return false
  const found = findWeChatImageMediaForRequest({ groupId, groupName, query: value, limit: 5 })
  const item = found.items?.[0]
  if (!item) {
    await sendWechatyDutyGroupMessage(room.id, '我没在当前群的图片库里找到匹配的图。你把原图直接再发一次，我识别入库后就能转发。', { mentionId: senderId, mentionName: senderName })
    return true
  }
  const resolved = resolveWeChatImageMediaFile(item)
  if (!resolved.ok) {
    await sendWechatyDutyGroupMessage(room.id, `找到了图片记录，但本地文件不可用：${resolved.error || 'unknown'}`, { mentionId: senderId, mentionName: senderName })
    return true
  }
  console.log(`[WechatStoredImage] 转发已入库群图片 topic="${groupName}" sender="${senderName}" media_id=${item.id} score=${item._score || 0}`)
  await room.say(FileBox.fromFile(resolved.filePath))
  await sendWechatyDutyGroupMessage(room.id, '这张，已从当前群图片库发给你。', { mentionId: senderId, mentionName: senderName })
  recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[转发已入库图片] ${item.description || item.relative_path || item.id}`, targetMemberName: senderName, source: 'wechaty-stored-image' }).catch(() => {})
  return true
}

async function tryDirectImageGenerationReply(room, text = '', { senderId = '', senderName = '', groupId = '', groupName = '' } = {}) {
  if (!isWechatImageGenerationRequest(text)) return false
  console.log(`[WechatImageSkill] 命中微信群生图请求 topic="${groupName}" sender="${senderName}" text="${String(text || '').slice(0, 120)}"`)
  await sendWechatyDutyGroupMessage(room.id, '收到，正在生图，稍等一下…', { mentionId: senderId, mentionName: senderName })
  try {
    const result = await generateImageForWechat({ text, groupId, groupName, senderId, senderName })
    if (!result.ok) {
      await sendWechatyDutyGroupMessage(room.id, result.error || '生图失败：未知错误', { mentionId: senderId, mentionName: senderName })
      return true
    }
    await room.say(FileBox.fromFile(result.filePath))
    const suffix = typeof result.remaining === 'number' ? `（本小时剩余 ${result.remaining} 张）` : ''
    await sendWechatyDutyGroupMessage(room.id, `图好了${suffix}`, { mentionId: senderId, mentionName: senderName })
    recordWeChatGroupAssistantReply({ groupId, groupName, reply: `[生图] ${result.prompt}`, targetMemberName: senderName, source: 'wechaty-image-skill' }).catch(() => {})
    return true
  } catch (err) {
    await sendWechatyDutyGroupMessage(room.id, `生图失败：${err?.message || err}`, { mentionId: senderId, mentionName: senderName })
    return true
  }
}

async function getWechatRawMessagePayload(message) {
  try {
    if (bot?.puppet?.messageRawPayload && message?.id) return await bot.puppet.messageRawPayload(message.id)
  } catch {}
  try { return message?.payload || null } catch { return null }
}

function compactRawPayloadForQuote(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') return ''
  const parts = []
  for (const key of [
    'Content',
    'OriginalContent',
    'MMActualContent',
    'MsgSource',
    'Url',
    'FileName',
    'AppMsgType',
    'Type',
  ]) {
    const value = rawPayload?.[key]
    if (value == null) continue
    const text = String(value || '').trim()
    if (!text) continue
    parts.push(`${key}: ${text}`)
  }
  try {
    const payloadText = String(rawPayload?.payload || rawPayload?.xml || '').trim()
    if (payloadText) parts.push(payloadText)
  } catch {}
  return parts
    .join('\n')
    .replace(/\s+/g, ' ')
    .slice(0, 6000)
}

function extractRawWechatSenderName(rawPayload) {
  try {
    const content = String(rawPayload?.Content || rawPayload?.MMActualContent || '')
    const original = String(rawPayload?.OriginalContent || '')
    const display = String(rawPayload?.ActualNickName || rawPayload?.RecommendInfo?.NickName || rawPayload?.User?.NickName || '')
    const fromContent = content.includes(':\n') ? content.split(':\n')[0] : ''
    const fromOriginal = original.includes(':<br/>') ? original.split(':<br/>')[0] : ''
    return [display, fromContent, fromOriginal].map(v => String(v || '').trim()).find(v => v && !isWeChatInternalIdLike(v)) || ''
  } catch {
    return ''
  }
}

function getWechatyContactId(contact) {
  const payload = contact?.payload && typeof contact.payload === 'object' ? contact.payload : {}
  return String(contact?.id || payload?.id || payload?.contactId || payload?.UserName || '').trim()
}

function pushWechatyCandidate(candidates, value) {
  const text = String(value || '').trim()
  if (text) candidates.push(text)
}

function cleanWechatyDisplayCandidate(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .trim()
}

function extractWechatyStableIdentity(...sources) {
  const values = []
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['Alias', 'alias', 'WeChatId', 'weixin', 'wechat', 'wechatId', 'wxid', 'Wxid', 'UserName', 'id']) {
      const value = String(source?.[key] || '').trim()
      if (value) values.push({ key, value })
    }
  }
  const wxid = values.find(item => /^wxid_/iu.test(item.value))?.value || ''
  // Alias 通常是用户设置的微信号；RemarkName/NickName/DisplayName 是可变昵称，不能当稳定身份。
  const wechatId = values.find(item => /^(Alias|alias|WeChatId|weixin|wechat|wechatId)$/u.test(item.key) && item.value && !isWeChatInternalIdLike(item.value))?.value || ''
  const stableKey = wxid || wechatId || ''
  const rawIdentity = JSON.stringify(Object.fromEntries(values.map(item => [item.key, item.value]).filter(([, value]) => value).slice(0, 20)))
  return { wechatId, wxid, stableKey, rawIdentity }
}

function partsFromWechatyRoomMemberRaw(raw = {}) {
  const identity = extractWechatyStableIdentity(raw)
  return {
    roomAlias: cleanWechatyDisplayCandidate(raw.DisplayName || raw.RemarkName || raw.RemarkPYInitial || ''),
    contactAlias: cleanWechatyDisplayCandidate(raw.Alias || raw.RemarkName || raw.RemarkPYQuanPin || ''),
    contactName: cleanWechatyDisplayCandidate(raw.NickName || raw.DisplayName || ''),
    ...identity,
  }
}

function hasUsableWechatyMemberName(raw = {}) {
  const parts = partsFromWechatyRoomMemberRaw(raw)
  return [parts.roomAlias, parts.contactAlias, parts.contactName]
    .map(cleanWechatyDisplayCandidate)
    .some(value => value && !isWeChatInternalIdLike(value))
}

async function hydrateWechatyRoomMembers(roomId = '') {
  const rid = String(roomId || '').trim()
  if (!rid || !bot?.puppet?.wechat4u?.batchGetContact) return null
  try {
    const contacts = await bot.puppet.wechat4u.batchGetContact([{ UserName: rid, EncryChatRoomId: '' }])
    if (Array.isArray(contacts) && contacts.length) {
      const roomRaw = contacts.find(item => item?.UserName === rid) || contacts[0]
      const members = Array.isArray(roomRaw?.MemberList)
        ? roomRaw.MemberList.map(item => ({ ...item, EncryChatRoomId: rid }))
        : []
      try { if (members.length) bot.puppet.wechat4u.updateContacts(members) } catch {}
      try { bot.puppet.wechat4u.updateContacts(contacts) } catch {}
      return roomRaw || null
    }
  } catch (err) {
    console.warn(`[WechatyStats] 批量刷新群成员资料失败 room="${rid}"：${err?.message || err}`)
  }
  return null
}

async function hydrateWechatyMemberContact(roomId = '', senderId = '') {
  const rid = String(roomId || '').trim()
  const sid = String(senderId || '').trim()
  if (!rid || !sid || !bot?.puppet?.wechat4u?.batchGetContact) return null
  try {
    const contacts = await bot.puppet.wechat4u.batchGetContact([{ UserName: sid, EncryChatRoomId: rid }])
    const raw = Array.isArray(contacts) ? contacts.find(item => item?.UserName === sid) || contacts[0] : null
    if (raw) {
      try { bot.puppet.wechat4u.updateContacts([raw]) } catch {}
      return raw
    }
  } catch (err) {
    console.warn(`[WechatyStats] 单独刷新成员资料失败 room="${rid}" sender="${sid}"：${err?.message || err}`)
  }
  return null
}

async function getWechatyRoomMemberRaw(room, senderId = '', { hydrate = false } = {}) {
  const roomId = String(room?.id || '').trim()
  const sid = String(senderId || '').trim()
  if (!roomId || !sid || !bot?.puppet?.roomMemberRawPayload) return null
  let firstRaw = null
  try {
    const raw = await bot.puppet.roomMemberRawPayload(roomId, sid)
    firstRaw = raw || null
    if (!hydrate || (hasUsableWechatyMemberName(raw) && extractWechatyStableIdentity(raw).stableKey)) return raw
  } catch {}
  if (hydrate) {
    const memberRaw = await hydrateWechatyMemberContact(roomId, sid)
    if (memberRaw && (hasUsableWechatyMemberName(memberRaw) || extractWechatyStableIdentity(memberRaw).stableKey)) {
      return { ...(firstRaw || {}), ...memberRaw }
    }
    const roomRaw = await hydrateWechatyRoomMembers(roomId)
    const found = Array.isArray(roomRaw?.MemberList)
      ? roomRaw.MemberList.find(item => item?.UserName === sid)
      : null
    if (found) return { ...(firstRaw || {}), ...found }
    try { return await bot.puppet.roomMemberRawPayload(roomId, sid) } catch {}
  }
  return firstRaw
}

async function resolveWechatyMemberNamePartsFromId(room, senderId = '', { hydrate = false } = {}) {
  const parts = { roomAlias: '', contactAlias: '', contactName: '', wechatId: '', wxid: '', stableKey: '', rawIdentity: '' }
  const raw = await getWechatyRoomMemberRaw(room, senderId, { hydrate })
  if (raw) Object.assign(parts, partsFromWechatyRoomMemberRaw(raw))
  const candidates = []
  pushWechatyCandidate(candidates, parts.roomAlias)
  pushWechatyCandidate(candidates, parts.contactAlias)
  pushWechatyCandidate(candidates, parts.contactName)
  try {
    const payload = await bot?.puppet?.contactPayload?.(senderId)
    Object.assign(parts, Object.fromEntries(Object.entries(extractWechatyStableIdentity(payload)).map(([key, value]) => [key, parts[key] || value])))
    pushWechatyCandidate(candidates, payload?.alias)
    pushWechatyCandidate(candidates, payload?.name)
    pushWechatyCandidate(candidates, payload?.friend)
  } catch {}
  pushWechatyCandidate(candidates, senderId)
  const displayName = candidates.map(cleanWechatyDisplayCandidate).find(value => value && !isWeChatInternalIdLike(value)) || '未知成员'
  return { ...parts, displayName }
}

async function resolveWechatyMemberNameParts(room, contact, fallback = '') {
  const parts = { roomAlias: '', contactAlias: '', contactName: '', wechatId: '', wxid: '', stableKey: '', rawIdentity: '' }
  const candidates = []
  const senderId = getWechatyContactId(contact) || String(fallback || '').trim()
  const direct = senderId ? await resolveWechatyMemberNamePartsFromId(room, senderId, { hydrate: true }) : null
  if (direct) {
    parts.roomAlias = direct.roomAlias || parts.roomAlias
    parts.contactAlias = direct.contactAlias || parts.contactAlias
    parts.contactName = direct.contactName || parts.contactName
    parts.wechatId = direct.wechatId || parts.wechatId
    parts.wxid = direct.wxid || parts.wxid
    parts.stableKey = direct.stableKey || parts.stableKey
    parts.rawIdentity = direct.rawIdentity || parts.rawIdentity
    pushWechatyCandidate(candidates, direct.roomAlias)
    pushWechatyCandidate(candidates, direct.contactAlias)
    pushWechatyCandidate(candidates, direct.contactName)
    pushWechatyCandidate(candidates, direct.displayName)
  }
  try { parts.roomAlias = String(await room?.alias?.(contact) || '').trim(); pushWechatyCandidate(candidates, parts.roomAlias) } catch {}
  try { parts.contactAlias = String(await contact?.alias?.() || '').trim(); pushWechatyCandidate(candidates, parts.contactAlias) } catch {}
  try { parts.contactName = String(contact?.name?.() || '').trim(); pushWechatyCandidate(candidates, parts.contactName) } catch {}
  try {
    const payload = contact?.payload && typeof contact.payload === 'object' ? contact.payload : {}
    Object.assign(parts, Object.fromEntries(Object.entries(extractWechatyStableIdentity(payload)).map(([key, value]) => [key, parts[key] || value])))
    pushWechatyCandidate(candidates, payload?.alias)
    pushWechatyCandidate(candidates, payload?.remark)
    pushWechatyCandidate(candidates, payload?.remarkName)
    pushWechatyCandidate(candidates, payload?.displayName)
    pushWechatyCandidate(candidates, payload?.name)
    pushWechatyCandidate(candidates, payload?.NickName)
    pushWechatyCandidate(candidates, payload?.RemarkName)
  } catch {}
  pushWechatyCandidate(candidates, fallback)
  const displayName = candidates.map(cleanWechatyDisplayCandidate).find(value => value && !isWeChatInternalIdLike(value)) || '未知成员'
  return { ...parts, displayName }
}

async function resolveWechatyMemberDisplayName(room, contact, fallback = '') {
  return (await resolveWechatyMemberNameParts(room, contact, fallback)).displayName
}

function scheduleRoomMemberNameRefresh(room, topic = '') {
  const roomId = String(room?.id || '').trim()
  if (!roomId) return
  const key = `wechaty:${roomId}`
  const last = memberNameRefreshAt.get(key) || 0
  if (Date.now() - last < MEMBER_NAME_REFRESH_STALE_MS) return
  memberNameRefreshAt.set(key, Date.now())
  refreshRoomMemberDisplayNames(room, topic).catch(err => {
    console.warn(`[WechatyStats] 刷新群成员昵称失败 topic="${topic}"：${err?.message || err}`)
  })
}

async function refreshRoomMemberDisplayNames(room, topic = '', { force = false } = {}) {
  const groupId = `wechaty:${room.id}`
  const groupName = topic || await safeTopic(room)
  const memberIds = []
  const hydratedRoomRaw = room?.id ? await hydrateWechatyRoomMembers(room.id) : null
  if (Array.isArray(hydratedRoomRaw?.MemberList) && hydratedRoomRaw.MemberList.length) {
    for (const member of hydratedRoomRaw.MemberList) {
      const sid = String(member?.UserName || '').trim()
      if (sid) memberIds.push(sid)
    }
  }
  if (!memberIds.length && bot?.puppet?.roomMemberList && room?.id) {
    try {
      const ids = await bot.puppet.roomMemberList(room.id)
      for (const id of ids || []) {
        const sid = String(id || '').trim()
        if (sid) memberIds.push(sid)
      }
    } catch (err) {
      console.warn(`[WechatyStats] 读取群成员 ID 失败 topic="${groupName}"：${err?.message || err}`)
    }
  }
  let members = []
  if (!memberIds.length && room?.memberAll) {
    try { members = await room.memberAll() } catch {}
  }
  let updated = 0
  let named = 0
  const entries = memberIds.length
    ? memberIds.map(senderId => ({ senderId, member: null }))
    : (members || []).map(member => ({ senderId: getWechatyContactId(member), member }))
  for (const entry of entries) {
    const senderId = String(entry.senderId || '').trim()
    if (!senderId) continue
    const parts = entry.member
      ? await resolveWechatyMemberNameParts(room, entry.member, senderId)
      : await resolveWechatyMemberNamePartsFromId(room, senderId, { hydrate: false })
    if (!parts.displayName || parts.displayName === '未知成员') continue
    named += 1
    try {
      const result = upsertWeChatGroupMemberName({
        groupId,
        groupName,
        senderId,
        displayName: parts.displayName,
        roomAlias: parts.roomAlias,
        contactAlias: parts.contactAlias,
        contactName: parts.contactName,
        wechatId: parts.wechatId,
        wxid: parts.wxid,
        stableKey: parts.stableKey,
        rawIdentity: parts.rawIdentity,
        source: 'wechaty-room-member',
      })
      updated += Number(result?.updated || 0)
    } catch (err) {
      console.warn(`[WechatyStats] 回填成员昵称失败 sender="${senderId}"：${err?.message || err}`)
    }
  }
  console.log(`[WechatyStats] 群成员昵称刷新 topic="${groupName}" members=${entries.length} named=${named} updated=${updated}${force ? ' force=true' : ''}`)
  return { ok: true, group_id: groupId, group_name: groupName, members: entries.length, named, updated }
}


async function persistWechatMessageMedia(message, { groupId = '', groupName = '', senderId = '' } = {}) {
  let type = ''
  try { type = String(message.type?.() ?? '') } catch {}
  const normalizedType = normalizeWechatMessageType(type)
  if (!/(attachment|audio|emoji|emoticon|sticker|image|video|file)/iu.test(normalizedType)) return { stored: false }
  if (!message?.toFileBox) return { stored: false, reason: 'toFileBox_unavailable' }
  const groupPart = String(groupId || groupName || 'unknown-group').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
  const day = new Date().toISOString().slice(0, 10)
  const dir = path.join(WECHAT_MEDIA_DIR, groupPart, day)
  fs.mkdirSync(dir, { recursive: true })
  const fileBox = await message.toFileBox()
  const rawName = String(fileBox?.name || `message-${message.id || Date.now()}`)
  const safeName = rawName.replace(/[\\/:*?"<>|]+/g, '_').slice(-160)
  const fileName = `${Date.now()}-${String(message.id || '').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 32)}-${safeName}`
  const filePath = path.join(dir, fileName)
  await fileBox.toFile(filePath, true)
  return {
    stored: true,
    filePath,
    relativePath: path.relative(paths.userDir, filePath),
    fileName,
    type: normalizedType || type,
    senderId,
  }
}

async function safeTopic(room) {
  try { return String(await room?.topic?.() || '').trim() } catch { return '' }
}

function getConfiguredGroupNames() {
  try {
    const cfg = getWechatyDutyGroupConfig()
    const names = Array.isArray(cfg.groupNames) ? cfg.groupNames : []
    return [...new Set(names.map(v => String(v || '').trim()).filter(Boolean))]
  } catch {
    return [...FALLBACK_GROUP_NAMES]
  }
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

export function getWechatGroupArchiveRuntimeForGroup({ groupId = '', groupName = '' } = {}) {
  const cfg = getWeChatGroupArchiveConfig()
  const recordEnabled = cfg.enabled !== false
    && cfg.recordText !== false
    && archiveGroupMatchesSelection({ groupId, groupName }, cfg.effectiveRecordGroupNames)
  const mediaEnabled = cfg.enabled !== false
    && cfg.recordMedia !== false
    && archiveGroupMatchesSelection({ groupId, groupName }, cfg.effectiveParseImageGroupNames)
  const imageParseEnabled = mediaEnabled && cfg.parseImages !== false
  return {
    config: cfg,
    recordEnabled,
    mediaEnabled,
    imageParseEnabled,
  }
}

export async function isWechatyGroupAdminSender(input = '') {
  const payload = (input && typeof input === 'object') ? input : { senderId: input }
  const sid = String(payload.senderId || '').trim()
  const senderName = String(payload.senderName || '').trim()
  const groupId = String(payload.groupId || '').trim()
  const groupName = String(payload.groupName || '').trim()
  if (!sid) return false
  try {
    const cfg = getWechatyDutyGroupConfig()
    if (cfg.adminModeEnabled !== true) return false
    const ids = Array.isArray(cfg.adminWechatIds) ? cfg.adminWechatIds.map(id => String(id || '').trim()).filter(Boolean) : []
    if (ids.some(id => id === sid)) return true

    const members = listWeChatGroupMembers({ groupId, groupName, limit: 1000 }).members || []
    const current = members.find(member => String(member.sender_id || '').trim() === sid) || null
    const currentStable = String(current?.stable_key || current?.wxid || current?.wechat_id || '').trim()
    const adminRows = getWechatyAdminIdentityRows(ids, members)

    // 优先使用稳定身份：wxid / 微信号 Alias。只要能拿到，就不依赖昵称。
    if (currentStable) {
      const matched = adminRows.find(row => String(row?.stable_key || row?.wxid || row?.wechat_id || row?.sender_id || '').trim() === currentStable)
        || (ids.includes(currentStable) ? { sender_id: currentStable, stable_key: currentStable } : null)
      if (matched) {
        try {
          const nextIds = [...new Set([...ids, sid])]
          setWechatyDutyGroupConfig({ adminWechatIds: nextIds })
          console.warn(`[WechatyAdmin] 管理员 sender_id 已变化，按稳定微信身份自动补录：group="${groupName || groupId}" stable="${currentStable}" old_id="${matched.sender_id}" new_id="${sid}"`)
        } catch (err) {
          console.warn(`[WechatyAdmin] 管理员新 sender_id 自动补录失败：${err?.message || err}`)
        }
        return true
      }
    }

    // 最后兜底才使用昵称，而且必须“当前在线快照”里同群昵称唯一，避免群里有人改成同名冒充。
    // 成员表保留了历史 sender_id，不能把历史旧 ID 也算作同名人数，否则每次重登都会误判为多人同名。
    if (!senderName || !ids.length) return false
    const latestSeen = members.map(member => String(member.last_seen || '')).sort().at(-1) || ''
    const activeMembers = latestSeen ? members.filter(member => String(member.last_seen || '') === latestSeen) : members
    const sameNameRows = activeMembers.filter(member => {
      const names = [member.display_name, member.room_alias, member.contact_alias, member.contact_name]
        .map(v => String(v || '').trim())
        .filter(Boolean)
      return names.includes(senderName)
    })
    if (sameNameRows.length !== 1) {
      if (sameNameRows.length > 1) console.warn(`[WechatyAdmin] 昵称兜底拒绝：group="${groupName || groupId}" name="${senderName}" 命中 ${sameNameRows.length} 人，存在同名风险`)
      return false
    }
    const configuredAdminNames = new Set()
    for (const row of adminRows) {
      for (const name of [row.display_name, row.room_alias, row.contact_alias, row.contact_name]) {
        const clean = String(name || '').trim()
        if (clean) configuredAdminNames.add(clean)
      }
    }
    if (!configuredAdminNames.has(senderName)) return false
    try {
      const nextIds = [...new Set([...ids, sid])]
      setWechatyDutyGroupConfig({ adminWechatIds: nextIds })
      console.warn(`[WechatyAdmin] 管理员 sender_id 已随登录变化，按同群唯一昵称匹配自动补录：group="${groupName || groupId}" name="${senderName}" old_count=${ids.length} new_id="${sid}"`)
    } catch (err) {
      console.warn(`[WechatyAdmin] 管理员新 sender_id 自动补录失败：${err?.message || err}`)
    }
    return true
  } catch (err) {
    console.warn(`[WechatyAdmin] 管理员身份校验失败：${err?.message || err}`)
    return false
  }
}

function getWechatyAdminIdentityRows(ids = [], currentMembers = []) {
  const wanted = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))]
  if (!wanted.length) return []
  const rows = []
  const seen = new Set()
  for (const id of wanted) {
    const current = (currentMembers || []).find(member => String(member.sender_id || '').trim() === id)
    if (current) {
      rows.push(current)
      seen.add(String(current.sender_id || '').trim())
    }
  }
  try {
    const placeholders = wanted.map(() => '?').join(',')
    const history = getDB().prepare(`
      SELECT sender_id, display_name, room_alias, contact_alias, contact_name, wechat_id, wxid, stable_key, last_seen
      FROM wechat_group_member_names
      WHERE sender_id IN (${placeholders})
         OR stable_key IN (${placeholders})
         OR wxid IN (${placeholders})
         OR wechat_id IN (${placeholders})
      ORDER BY last_seen DESC
    `).all(...wanted, ...wanted, ...wanted, ...wanted)
    for (const row of history) {
      const key = `${row.sender_id || ''}:${row.stable_key || row.wxid || row.wechat_id || ''}`
      if (seen.has(key)) continue
      rows.push(row)
      seen.add(key)
    }
  } catch {}
  return rows
}

function buildAdminProtectionReply({ groupId = '', groupName = '', senderId = '', text = '' } = {}) {
  const cfg = getWechatyDutyGroupConfig()
  if (cfg.adminModeEnabled !== true) return ''
  const adminIds = Array.isArray(cfg.adminWechatIds) ? cfg.adminWechatIds.map(id => String(id || '').trim()).filter(Boolean) : []
  if (!adminIds.length || adminIds.includes(String(senderId || '').trim())) return ''
  let members = []
  try { members = listWeChatGroupMembers({ groupId, groupName, limit: 1000 }).members || [] } catch {}
  const admins = adminIds.map(id => members.find(member => String(member.sender_id || '') === id) || { sender_id: id, display_name: id })
  const value = String(text || '')
  const targetAdmin = admins.find(admin => {
    const names = [admin.display_name, admin.room_alias, admin.contact_alias, admin.contact_name, admin.sender_id].map(v => String(v || '').trim()).filter(Boolean)
    return names.some(name => name && value.includes(name))
  })
  if (!targetAdmin) return ''
  const hostile = /(删除|物理|干掉|搞死|弄死|禁言|踢|封|骂|喷|怼|诽谤|冒充|套|骗|提权|越狱|绕过|攻击|伤害|羞辱|嘲讽|整他|搞他|开盒|人肉)/u.test(value)
  if (!hostile) return ''
  const name = targetAdmin.display_name || targetAdmin.sender_id || '管理员'
  return `别拿我当刀使。${name} 是已验证管理员，不是你一句话就能被“物理删除”的 NPC[吃瓜] 想坑管理员，先把你这点小心思藏好。`
}

function normalizeGroupNames(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(/[，,;；\n]+/)
  const names = raw.map(v => String(v || '').trim()).filter(Boolean)
  const merged = names.length ? names : getConfiguredGroupNames()
  return [...new Set(merged)]
}

function isAllowedGroupTopic(topic) {
  const current = String(topic || '').trim()
  if (!current) return false
  return targetGroupNames.some(name => current === name || current.includes(name) || name.includes(current))
}

function markSelectedRooms(rooms = []) {
  const map = new Map()
  const canonicalTopic = value => String(value || '').trim().replace(/\s+/gu, ' ').toLowerCase()
  for (const raw of Array.isArray(rooms) ? rooms : []) {
    const topic = String(raw?.topic || '').trim()
    const id = String(raw?.id || '').trim()
    if (!topic && !id) continue
    // Wechaty/wechat4u 可能因为重新登录给同一个群留下多个历史 room_id；
    // UI 和运行态都必须按群名只保留一条，避免设置、记忆、统计页面重复。
    const key = topic ? `name:${canonicalTopic(topic)}` : `id:${id}`
    const selected = isAllowedGroupTopic(topic) || raw?.selected === true
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...raw, id, topic: topic || id, selected, historical_ids: id ? [id] : [] })
      continue
    }
    const historical = new Set([...(prev.historical_ids || []), ...(raw?.historical_ids || []), id].filter(Boolean))
    map.set(key, {
      ...prev,
      // 已开启 @ 回复的真实群优先；否则保留先出现的 id，旧 id 只进入 historical_ids。
      id: selected && id ? id : prev.id,
      topic: topic || prev.topic,
      selected: prev.selected || selected,
      historical_ids: [...historical],
    })
  }
  return [...map.values()]
}

function createWechatyPuppet() {
  // 重要：这里必须固定使用 wechat4u puppet。
  // 之前临时切到 `wechaty-puppet-wechat` 会启动 Puppeteer/Chrome 版网页微信，
  // 在 macOS arm64 上出现 `WechatyBro` 注入失败、Chrome 断开、5s 超时等问题；
  // 用户看到的“网页版登录微信”就是那个 puppet 造成的。
  activePuppetName = 'wechaty-puppet-wechat4u'
  ensureWechatyMemoryFile()
  return new BailongmaPuppetWechat4u()
}

function ensureWechatyMemoryFile() {
  try {
    fs.mkdirSync(path.dirname(WECHATY_MEMORY_FILE), { recursive: true })
    if (!fs.existsSync(WECHATY_MEMORY_FILE)) {
      fs.writeFileSync(WECHATY_MEMORY_FILE, '{}')
      return
    }
    const raw = fs.readFileSync(WECHATY_MEMORY_FILE, 'utf-8').trim()
    if (!raw) fs.writeFileSync(WECHATY_MEMORY_FILE, '{}')
    else JSON.parse(raw)
  } catch (err) {
    console.warn(`[Wechaty] 登录态文件异常，已重置为空：${WECHATY_MEMORY_FILE} (${err?.message || err})`)
    try { fs.writeFileSync(WECHATY_MEMORY_FILE, '{}') } catch {}
  }
}

function getWechatyMemoryState() {
  try {
    const raw = fs.readFileSync(WECHATY_MEMORY_FILE, 'utf-8')
    const payload = JSON.parse(raw || '{}')
    const keys = Object.keys(payload || {})
    const hasLoginData = keys.some(key => key.includes('PUPPET-WECHAT4U'))
    return { file: WECHATY_MEMORY_FILE, exists: true, bytes: Buffer.byteLength(raw), keys: keys.length, has_login_data: hasLoginData }
  } catch {
    return { file: WECHATY_MEMORY_FILE, exists: false, bytes: 0, keys: 0, has_login_data: false }
  }
}

function persistRuntime(runtimeStatus = status) {
  try {
    setWechatyDutyGroupRuntime({
      status: runtimeStatus,
      loginUser: lastLoginUser,
      rooms: roomSnapshot,
      roomIds: Object.fromEntries([...targetRooms.entries()].map(([name, room]) => [name, room?.id || ''])),
      lastRoomRefreshAt,
      lastMessageAt,
      lastError: lastError ? `${lastError}${activePuppetName ? ` [${activePuppetName}]` : ''}` : '',
      puppet: activePuppetName,
    })
  } catch (err) {
    console.warn(`[Wechaty] 持久化运行态失败：${err?.message || err}`)
  }
}

function restoreRuntimeSnapshot() {
  try {
    const runtime = getWechatyDutyGroupConfig().runtime || {}
    lastLoginUser = String(runtime.loginUser || '')
    roomSnapshot = Array.isArray(runtime.rooms) ? markSelectedRooms(runtime.rooms) : []
    lastRoomRefreshAt = String(runtime.lastRoomRefreshAt || '')
    lastMessageAt = String(runtime.lastMessageAt || '')
    lastError = String(runtime.lastError || '')
    activePuppetName = String(runtime.puppet || activePuppetName || '')
  } catch {}
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function suppressReconnect(ms = 5000) {
  suppressReconnectUntil = Date.now() + ms
}

function isReconnectSuppressed() {
  return Date.now() < suppressReconnectUntil
}

function scheduleReconnect(reason = '') {
  if (!wechatyGroupReplyEnabled || isReconnectSuppressed()) return
  if (reconnectTimer) return
  if (needsWechatyRelogin()) notifyWechatyOffline(reason || 'reconnect')
  reconnectAttempts += 1
  const delay = Math.min(120000, 15000 * reconnectAttempts)
  console.warn(`[Wechaty] ${reason} 后 ${Math.round(delay / 1000)} 秒尝试自动恢复连接`)
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try {
      await stopWechatyGroupOnly()
      await startWechatyDutyGroupConnector({ pushMessage: pushMessageRef, emitEvent: emitEventRef, groupNames: targetGroupNames, enabled: true })
    } catch (err) {
      lastError = err?.message || String(err)
      persistRuntime('error')
      scheduleReconnect('reconnect_failed')
    }
  }, delay)
}

async function stopWechatyGroupOnly() {
  clearStartWatchdog()
  try { await bot?.stop?.() } catch {}
  bot = null
  targetRoomId = ''
  targetRoom = null
  targetRooms.clear()
}

function qrToAscii(qrcode) {
  let output = ''
  try {
    qrcodeTerminal.generate(qrcode, { small: true }, text => { output = text })
  } catch {}
  return output
}

class BailongmaPuppetWechat4u extends PuppetWechat4u {
  clearBailongmaContactPolling() {
    try {
      if (this.getContactInterval) clearInterval(this.getContactInterval)
    } catch {}
    this.getContactInterval = undefined
    this.unknownContactId = []
  }

  getContactsInfo() {
    // wechat4u 在 logout/stop 后可能仍有联系人补全定时器继续跑，
    // 原版会直接访问 `this.wechat4u.batchGetContact`，导致反复 uncaughtException。
    if (!this.wechat4u || typeof this.wechat4u.batchGetContact !== 'function') {
      this.clearBailongmaContactPolling()
      return
    }
    try {
      return super.getContactsInfo()
    } catch (err) {
      this.clearBailongmaContactPolling()
      this.emit('error', { data: err?.message || String(err) })
    }
  }

  initHookEvents(wechat4u) {
    super.initHookEvents(wechat4u)
    // 原版 logout handler 末尾会 `this.wechat4u.start()`，当外层正在 stop/restart
    // 或微信服务端主动踢下线时，容易形成“退出 → 自动重新扫码 → 定时器读空对象”的循环。
    // 这里改为：只上报 logout，由 BaiLongma 外层统一决定是否重连。
    try {
      wechat4u.removeAllListeners('logout')
      wechat4u.on('logout', async () => {
        this.clearBailongmaContactPolling()
        try {
          if (this.isLoggedIn) await this.logout()
        } catch {}
        // 不主动删除 PUPPET-WECHAT4U 登录态。
        // 正常重启/stop 期间删除这里会导致每次打开软件都重新扫码。
        // 真正被微信服务端踢下线时，wechat4u 下一次启动会自行发现登录态不可用并给出二维码。
      })
    } catch {}
  }

  async onStop() {
    this.clearBailongmaContactPolling()
    try { this.wechat4u?.removeAllListeners?.('logout') } catch {}
    try {
      await super.onStop()
    } catch (err) {
      // stop 期间 wechat4u 可能已被 logout handler 清掉，不能让异常冒泡杀掉主程序。
      this.wechat4u = undefined
    }
  }
}
