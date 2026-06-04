import { nowTimestamp } from './time.js'
import { normalizeConversationPartyId, upsertEntity, insertConversation } from './db.js'
import { resolveCanonicalUserId } from './identity.js'

// 分级内存消息队列：用户消息永远优先于后台消息（提醒、系统消息等）
const queues = {
  user: [],
  background: [],
}

const PRIORITY = {
  user: 100,
  background: 50,
}

// 消息到达时的打断回调（由 index.js 注册）
let interruptCallback = null
export function setInterruptCallback(fn) { interruptCallback = fn }

function resolvePriority(fromId, channel, meta = {}) {
  if (typeof meta.priority === 'number') return meta.priority
  if (meta.queue === 'background') return PRIORITY.background
  if (channel === 'REMINDER' || channel === 'SYSTEM' || normalizeConversationPartyId(fromId) === 'SYSTEM') {
    return PRIORITY.background
  }
  return PRIORITY.user
}

function resolveQueueName(priority, meta = {}) {
  if (meta.queue === 'background') return 'background'
  return priority >= PRIORITY.user ? 'user' : 'background'
}

function pruneSupersededUserMessages(entry) {
  if (!entry || entry.queueName !== 'user') return
  // 微信群 @ 消息必须逐条排队回复，不能按群覆盖前一条。
  if (entry.noPrune === true || entry.disablePrune === true) return

  // 按 (fromId, channel) 联合 key 去重：避免同一用户跨渠道时一个吞掉另一个
  for (let i = queues.user.length - 1; i >= 0; i--) {
    const pending = queues.user[i]
    if (!pending) continue
    if (pending.fromId !== entry.fromId) continue
    if ((pending.channel || '') !== (entry.channel || '')) continue
    queues.user.splice(i, 1)
  }
}


function sanitizeIncomingText(value = '') {
  return String(value || '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
}

export function pushMessage(rawFromId, content, channel = 'TUI', meta = {}) {
  content = sanitizeIncomingText(content)
  const normalizedRaw = normalizeConversationPartyId(rawFromId)
  const canonicalId = resolveCanonicalUserId({ rawFromId: normalizedRaw, channel })
  const externalPartyId = meta.externalPartyIdOverride || (canonicalId !== normalizedRaw ? normalizedRaw : '')
  const timestamp = nowTimestamp()
  const priority = resolvePriority(canonicalId, channel, meta)
  const queueName = resolveQueueName(priority, meta)
  upsertEntity(canonicalId)
  // 消息一到就写入聊天记录（微信式：打开即可见所有未处理消息）。
  // 若随后 LLM 处理被新消息打断，本条仍然保留在 conversations 表中，
  // 下一轮处理最新消息时通过 conversationWindow 自动作为上下文可见。
  if (!meta.noPersist) {
    insertConversation({
      role: 'user',
      from_id: canonicalId,
      content,
      timestamp,
      channel: channel || '',
      external_party_id: externalPartyId,
    })
  }
  const entry = {
    raw: `[${canonicalId}${externalPartyId ? ` via ${externalPartyId}` : ''}] ${timestamp} [${channel}] ${content}`,
    fromId: canonicalId,
    externalPartyId,
    content,
    timestamp,
    channel,
    priority,
    queueName,
    ...meta,
  }
  pruneSupersededUserMessages(entry)
  queues[queueName].push(entry)
  // 通知主循环打断当前处理
  interruptCallback?.(entry)
}

function takeFirstMatching(queue, predicate = null) {
  if (typeof predicate !== 'function') return queue.shift() || null
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]
    let ok = false
    try { ok = !!predicate(item) } catch { ok = false }
    if (!ok) continue
    queue.splice(i, 1)
    return item
  }
  return null
}

export function popMessage(predicate = null) {
  const userMsg = takeFirstMatching(queues.user, predicate)
  if (userMsg) return userMsg
  return takeFirstMatching(queues.background, predicate)
}

export function drainUserMessages(predicate = () => true, max = 0) {
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.floor(Number(max))) : 0
  if (!limit) return []
  const picked = []
  for (let i = 0; i < queues.user.length && picked.length < limit;) {
    const item = queues.user[i]
    let ok = false
    try { ok = !!predicate(item) } catch { ok = false }
    if (ok) {
      picked.push(item)
      queues.user.splice(i, 1)
    } else {
      i += 1
    }
  }
  return picked
}

// 把消息重新放回队列头部（LLM 失败后重试用），保留原始字段并带上 retryCount
export function requeueMessage(msg, retryCount) {
  const queueName = msg?.queueName === 'background' ? 'background' : 'user'
  queues[queueName].unshift({ ...msg, retryCount, queueName })
}

export function hasMessages() {
  return queues.user.length > 0 || queues.background.length > 0
}

export function hasUserMessages() {
  return queues.user.length > 0
}

export function hasQueuedMessage(predicate = null) {
  if (typeof predicate !== 'function') return hasMessages()
  for (const queue of [queues.user, queues.background]) {
    for (const item of queue) {
      try {
        if (predicate(item)) return true
      } catch {}
    }
  }
  return false
}

export function countQueuedMessages(predicate = null) {
  if (typeof predicate !== 'function') return queues.user.length + queues.background.length
  let count = 0
  for (const queue of [queues.user, queues.background]) {
    for (const item of queue) {
      try {
        if (predicate(item)) count += 1
      } catch {}
    }
  }
  return count
}

export function getQueueSnapshot() {
  return {
    user: queues.user.length,
    background: queues.background.length,
  }
}
