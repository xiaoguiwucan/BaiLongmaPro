// 云端 ASR WebSocket 代理
// 前端 → ws://127.0.0.1:3721/voice/cloud → 后端签名/鉴权 → 云端 ASR
//
// 支持三家服务商：
//   aliyun  — 阿里云百炼 Paraformer（首选）
//   tencent — 腾讯云 ASR
//   xunfei  — 科大讯飞 RTASR
//   volcengine — 火山引擎/豆包大模型流式语音识别

import crypto from 'crypto'
import { WebSocket } from 'ws'

// ─── 阿里云 Paraformer ───
// 协议：run-task → PCM binary chunks → finish-task
// 结果：{header:{event:"result-generated"}, payload:{output:{sentence:{text,status}}}}
// 连接建立前的待发音频上限（~4s，防止连接失败时无限堆积）
const MAX_PENDING_CHUNKS = 16

function createAliyunSession(apiKey, lang, onTranscript, onError, onClose) {
  const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'
  const taskId = crypto.randomUUID()

  let ready = false
  const pending = []

  const ws = new WebSocket(WS_URL, {
    headers: { Authorization: `bearer ${apiKey}` },
  })

  ws.on('open', () => {
    const langCode = (lang === 'zh' || !lang) ? 'zh' : lang
    ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'paraformer-realtime-v2',
        parameters: {
            sample_rate: 16000,
            format: 'pcm',
            language_hints: [langCode],
            punctuation_prediction: true,
            inverse_text_normalization: true,
          },
        input: {},
      },
    }))
    ready = true
    for (const buf of pending) {
      try { ws.send(buf) } catch {}
    }
    pending.length = 0
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const event = msg?.header?.event
      if (event === 'result-generated') {
        const sentence = msg?.payload?.output?.sentence
        if (sentence?.text) {
          const isFinal = sentence.status === 'sentence_end'
          onTranscript(sentence.text, isFinal)
        }
      } else if (event === 'task-failed') {
        onError(msg?.header?.error_message || '阿里云 ASR 错误')
      }
    } catch {}
  })

  ws.on('error', (err) => { pending.length = 0; onError(err.message) })
  ws.on('close', () => { pending.length = 0; onClose() })

  return {
    sendAudio(pcmBuffer) {
      if (!ready) {
        if (pending.length < MAX_PENDING_CHUNKS) pending.push(pcmBuffer)
        return
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(pcmBuffer)
    },
    flush() {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({
        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: {} },
      }))
    },
    close() { try { ws.close() } catch {} },
  }
}

function isValidAliyunAsrKey(value) {
  return /^sk-[A-Za-z0-9_\-.]{20,}$/.test(String(value || '').trim())
}

// ─── 腾讯云 ASR ───
// 签名：HMAC-SHA256(SecretKey, host+path+?+sorted_query) → base64 → URL 参数
// 结果：{code:0, result:{slice_type:0|2, ...}}，slice_type=2 为最终结果
function createTencentSession(secretId, secretKey, appId, lang, onTranscript, onError, onClose) {
  const host = 'asr.cloud.tencent.com'
  const path = `/asr/v2/${appId}`
  const ts = Math.floor(Date.now() / 1000)
  const nonce = Math.floor(Math.random() * 1000000)

  const params = {
    secretid: secretId,
    timestamp: ts,
    expired: ts + 86400,
    nonce,
    engine_model_type: lang === 'zh' ? '16k_zh' : '16k_en',
    voice_format: 1,
    needvad: 1,
  }

  const sortedQuery = Object.keys(params).sort()
    .map(k => `${k}=${params[k]}`).join('&')
  const signStr = `${host}${path}?${sortedQuery}`
  const signature = crypto.createHmac('sha256', secretKey)
    .update(signStr).digest('base64')

  const url = `wss://${host}${path}?${sortedQuery}&signature=${encodeURIComponent(signature)}`
  const ws = new WebSocket(url)

  let ready = false
  const pending = []

  ws.on('open', () => {
    ready = true
    for (const buf of pending) {
      try { ws.send(buf) } catch {}
    }
    pending.length = 0
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.code !== 0) { onError(`腾讯云 ASR 错误: ${msg.message}`); return }
      const result = msg.result
      if (result?.voice_text_str) {
        const isFinal = result.slice_type === 2
        onTranscript(result.voice_text_str, isFinal)
      }
    } catch {}
  })

  ws.on('error', (err) => { pending.length = 0; onError(err.message) })
  ws.on('close', () => { pending.length = 0; onClose() })

  return {
    sendAudio(pcmBuffer) {
      if (!ready) {
        if (pending.length < MAX_PENDING_CHUNKS) pending.push(pcmBuffer)
        return
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(pcmBuffer)
    },
    flush() {
      // 腾讯 ASR 通过关闭连接来结束会话
      try { ws.close() } catch {}
    },
    close() { try { ws.close() } catch {} },
  }
}

// ─── 科大讯飞 RTASR ───
// 签名：base64(hmac-sha1(md5(appid+ts), apiKey))
// 结果：JSON data 字段，type="1" 为最终
function createXunfeiSession(appId, apiKey, lang, onTranscript, onError, onClose) {
  const ts = Math.floor(Date.now() / 1000).toString()
  const md5Base = crypto.createHash('md5').update(appId + ts).digest('hex')
  const signa = crypto.createHmac('sha1', apiKey).update(md5Base).digest('base64')

  const langParam = lang === 'en' ? 'en_us' : 'cn'
  const url = `wss://rtasr.xfyun.cn/v1/ws?appid=${appId}&ts=${ts}&signa=${encodeURIComponent(signa)}&lang=${langParam}`
  const ws = new WebSocket(url)

  let ready = false
  const pending = []

  ws.on('open', () => {
    ready = true
    for (const buf of pending) {
      try { ws.send(buf) } catch {}
    }
    pending.length = 0
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.action === 'error') { onError(`讯飞 RTASR 错误: ${msg.desc}`); return }
      if (msg.action === 'result') {
        const parsed = JSON.parse(msg.data)
        const isFinal = parsed.type === '1'
        const text = (parsed.ws || [])
          .flatMap(w => w.cw || [])
          .map(c => c.w || '').join('')
        if (text) onTranscript(text, isFinal)
      }
    } catch {}
  })

  ws.on('error', (err) => { pending.length = 0; onError(err.message) })
  ws.on('close', () => { pending.length = 0; onClose() })

  return {
    sendAudio(pcmBuffer) {
      if (!ready) {
        if (pending.length < MAX_PENDING_CHUNKS) pending.push(pcmBuffer)
        return
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(pcmBuffer)
    },
    flush() {
      if (ws.readyState !== WebSocket.OPEN) return
      // 讯飞要求发送结束帧
      ws.send(JSON.stringify({ end: true }))
    },
    close() { try { ws.close() } catch {} },
  }
}


// ─── 火山引擎/豆包大模型流式 ASR ───
// 说明：火山语音大模型 WebSocket 使用二进制协议，不同开通资源的 endpoint/resource id
// 可能不同。这里实现火山官方“大模型流式语音识别”常见协议：full client request
// + audio-only request，并提供清晰错误提示。若控制台给出的 resourceId/endpoint 不同，
// 只需通过设置里的 Resource ID 覆盖。
const VOLC_DEFAULT_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const VOLC_DEFAULT_RESOURCE_ID = 'volc.bigasr.sauc.duration'
const VOLC_PROTOCOL_VERSION = 0b0001
const VOLC_HEADER_SIZE = 0b0001
const VOLC_SERIALIZATION_JSON = 0b0001
const VOLC_COMPRESSION_NONE = 0b0000
const VOLC_MSG_FULL_CLIENT_REQUEST = 0b0001
const VOLC_MSG_AUDIO_ONLY_REQUEST = 0b0010
const VOLC_MSG_FULL_SERVER_RESPONSE = 0b1001
const VOLC_MSG_SERVER_ACK = 0b1011
const VOLC_MSG_SERVER_ERROR = 0b1111
const VOLC_FLAG_NONE = 0b0000
const VOLC_FLAG_POS_SEQUENCE = 0b0001
const VOLC_FLAG_NEG_SEQUENCE = 0b0010
const VOLC_FLAG_LAST_NO_SEQUENCE = 0b0011

function volcHeader(messageType, flags = VOLC_FLAG_NONE, serialization = VOLC_SERIALIZATION_JSON, compression = VOLC_COMPRESSION_NONE) {
  return Buffer.from([
    (VOLC_PROTOCOL_VERSION << 4) | VOLC_HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0,
  ])
}

function int32be(n) {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n, 0)
  return b
}

function volcPayloadFrame(messageType, flags, payload, sequence = null, serialization = VOLC_SERIALIZATION_JSON) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '')
  const parts = [volcHeader(messageType, flags, serialization)]
  if (flags === VOLC_FLAG_POS_SEQUENCE || flags === VOLC_FLAG_NEG_SEQUENCE) parts.push(int32be(sequence || 1))
  parts.push(int32be(body.length), body)
  return Buffer.concat(parts)
}

function parseVolcMessage(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (buf.length < 4) return null
  const messageType = buf[1] >> 4
  const flags = buf[1] & 0x0f
  const serialization = buf[2] >> 4
  let offset = (buf[0] & 0x0f) * 4
  let sequence = null
  if (flags === VOLC_FLAG_POS_SEQUENCE || flags === VOLC_FLAG_NEG_SEQUENCE) {
    if (buf.length < offset + 4) return null
    sequence = buf.readInt32BE(offset)
    offset += 4
  }
  if (buf.length < offset + 4) return { messageType, flags, sequence, payload: null }
  const payloadSize = buf.readInt32BE(offset)
  offset += 4
  const payload = buf.subarray(offset, offset + Math.max(0, payloadSize))
  if (messageType === VOLC_MSG_SERVER_ERROR) {
    let error = payload.toString('utf8')
    try { error = JSON.parse(error)?.message || JSON.parse(error)?.error || error } catch {}
    return { messageType, flags, sequence, error }
  }
  if (serialization === VOLC_SERIALIZATION_JSON && payload.length) {
    try { return { messageType, flags, sequence, payload: JSON.parse(payload.toString('utf8')) } } catch {}
  }
  return { messageType, flags, sequence, payload }
}

function extractVolcTranscript(payload) {
  const texts = []
  const finals = []
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (typeof obj.text === 'string' && obj.text.trim()) texts.push(obj.text.trim())
    if (typeof obj.utterance === 'string' && obj.utterance.trim()) texts.push(obj.utterance.trim())
    if (typeof obj.result === 'string' && obj.result.trim()) texts.push(obj.result.trim())
    if (obj.definite === true || obj.is_final === true || obj.final === true) finals.push(true)
    if (Array.isArray(obj)) obj.forEach(walk)
    else Object.values(obj).forEach(walk)
  }
  walk(payload)
  const text = texts[texts.length - 1] || ''
  return { text, isFinal: finals.length > 0 }
}

function createVolcengineSession(config, lang, onTranscript, onError, onClose) {
  console.log('[CloudASR][volcengine] connecting', { resourceId: config.volcengineResourceId || VOLC_DEFAULT_RESOURCE_ID, lang })
  const appKey = String(config.volcengineAppKey || '').trim()
  const accessKey = String(config.volcengineAccessKey || '').trim()
  const resourceId = String(config.volcengineResourceId || VOLC_DEFAULT_RESOURCE_ID).trim() || VOLC_DEFAULT_RESOURCE_ID
  const wsUrl = String(config.volcengineWsUrl || VOLC_DEFAULT_WS_URL).trim() || VOLC_DEFAULT_WS_URL
  const connectId = crypto.randomUUID()
  const reqId = crypto.randomUUID()
  let sequence = 1
  let ready = false
  let audioFramesSent = 0
  let serverFramesReceived = 0
  let lastAudioLogAt = 0
  let bestText = ''
  const pending = []

  const ws = new WebSocket(wsUrl, {
    headers: {
      'X-Api-App-Key': appKey,
      'X-Api-Access-Key': accessKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Connect-Id': connectId,
    },
  })

  ws.on('open', () => {
    console.log('[CloudASR][volcengine] websocket open')
    const request = {
      user: { uid: 'bailongma' },
      audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1, language: lang === 'en' ? 'en-US' : 'zh-CN' },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_nonstream: true,
        show_utterances: true,
        result_type: 'full',
        reqid: reqId,
      },
    }
    ws.send(volcPayloadFrame(VOLC_MSG_FULL_CLIENT_REQUEST, VOLC_FLAG_POS_SEQUENCE, JSON.stringify(request), sequence++))
    ready = true
    for (const buf of pending) {
      try { ws.send(volcPayloadFrame(VOLC_MSG_AUDIO_ONLY_REQUEST, VOLC_FLAG_POS_SEQUENCE, buf, sequence++, 0)) } catch {}
    }
    pending.length = 0
  })

  ws.on('message', (data) => {
    serverFramesReceived++
    const msg = parseVolcMessage(data)
    if (!msg) {
      console.warn('[CloudASR][volcengine] unparsed server frame', { bytes: Buffer.byteLength(data) })
      return
    }
    console.log('[CloudASR][volcengine] server frame', {
      n: serverFramesReceived,
      type: msg.messageType,
      flags: msg.flags,
      sequence: msg.sequence,
      payloadKeys: msg.payload && typeof msg.payload === 'object' ? Object.keys(msg.payload).slice(0, 12) : null,
      error: msg.error || null,
    })
    if (msg.messageType === VOLC_MSG_SERVER_ERROR) {
      onError(`火山 ASR 错误: ${msg.error || 'unknown error'}`)
      return
    }
    if (msg.messageType === VOLC_MSG_FULL_SERVER_RESPONSE || msg.messageType === VOLC_MSG_SERVER_ACK) {
      const { text, isFinal } = extractVolcTranscript(msg.payload)
      if (text) {
        // 火山有时会返回局部修订片段，例如前面是“你好”，后面突然给“吗”。
        // 对语音助手场景，保留当前会话内最长文本，避免前端只剩最后一个字。
        let mergedText = text
        if (bestText) {
          if (text.includes(bestText) || text.length >= bestText.length + 2) {
            mergedText = text
          } else if (bestText.includes(text)) {
            mergedText = bestText
          } else if (text.length <= 4) {
            // 火山偶发返回单字/短片段作为后续修订，例如 “你好” 后返回 “吗”。
            mergedText = bestText + text
          } else {
            mergedText = text.length >= bestText.length ? text : bestText
          }
        }
        if (mergedText.length >= bestText.length || isFinal) bestText = mergedText
        console.log('[CloudASR][volcengine] transcript', { text, mergedText, isFinal })
        onTranscript(mergedText, isFinal)
      } else if (serverFramesReceived <= 5 || serverFramesReceived % 20 === 0) {
        try {
          console.log('[CloudASR][volcengine] payload sample', JSON.stringify(msg.payload).slice(0, 1200))
        } catch {}
      }
    }
  })

  ws.on('error', (err) => { pending.length = 0; onError(`火山 ASR 连接失败: ${err.message}`) })
  ws.on('close', () => { pending.length = 0; onClose() })

  return {
    sendAudio(pcmBuffer) {
      if (!ready) {
        if (pending.length < MAX_PENDING_CHUNKS) pending.push(Buffer.from(pcmBuffer))
        return
      }
      if (ws.readyState === WebSocket.OPEN) {
        audioFramesSent++
        const now = Date.now()
        if (audioFramesSent <= 5 || now - lastAudioLogAt > 1500) {
          lastAudioLogAt = now
          console.log('[CloudASR][volcengine] audio frame sent', { n: audioFramesSent, bytes: Buffer.byteLength(pcmBuffer), sequence })
        }
        ws.send(volcPayloadFrame(VOLC_MSG_AUDIO_ONLY_REQUEST, VOLC_FLAG_POS_SEQUENCE, Buffer.from(pcmBuffer), sequence++, 0))
      }
    },
    flush() {
      console.log('[CloudASR][volcengine] flush/close', { audioFramesSent, sequence, bestText })
      if (bestText) {
        try { onTranscript(bestText, true) } catch {}
      }
      try { ws.close() } catch {}
    },
    close() { try { ws.close() } catch {} },
  }
}

// ─── 工厂函数 ───
// config: { provider, lang, aliyunApiKey?, tencentSecretId?, tencentSecretKey?,
//           tencentAppId?, xunfeiAppId?, xunfeiApiKey?, volcengineAppKey?,
//           volcengineAccessKey?, volcengineResourceId? }
export function createCloudASRSession(config, onTranscript, onError, onClose) {
  const { provider = 'aliyun', lang = 'zh' } = config

  if (provider === 'aliyun') {
    if (!config.aliyunApiKey) { onError('未配置阿里云 API Key'); return null }
    if (!isValidAliyunAsrKey(config.aliyunApiKey)) {
      onError('阿里云 ASR Key 格式不正确：请填写百炼/DashScope 控制台的 sk- 开头 API Key')
      return null
    }
    return createAliyunSession(config.aliyunApiKey, lang, onTranscript, onError, onClose)
  }

  if (provider === 'tencent') {
    if (!config.tencentSecretId || !config.tencentSecretKey) {
      onError('未配置腾讯云 SecretId/SecretKey'); return null
    }
    const appId = config.tencentAppId || ''
    return createTencentSession(config.tencentSecretId, config.tencentSecretKey, appId, lang, onTranscript, onError, onClose)
  }

  if (provider === 'xunfei') {
    if (!config.xunfeiAppId || !config.xunfeiApiKey) {
      onError('未配置讯飞 AppId/ApiKey'); return null
    }
    return createXunfeiSession(config.xunfeiAppId, config.xunfeiApiKey, lang, onTranscript, onError, onClose)
  }

  if (provider === 'volcengine') {
    if (!config.volcengineAppKey || !config.volcengineAccessKey) {
      onError('未配置火山引擎 App Key/Access Key'); return null
    }
    return createVolcengineSession(config, lang, onTranscript, onError, onClose)
  }

  onError(`未知云端 ASR 服务商: ${provider}`)
  return null
}
