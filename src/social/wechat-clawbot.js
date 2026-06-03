import { WeChatClient, sendText as sendIlinkText, sendImage as sendIlinkImage } from 'wechat-ilink-client'
import fs from 'fs'
import { getClawbotCredentials, setClawbotCredentials, clearClawbotCredentials } from '../config.js'
import { upsertClawbotToken, getAllClawbotTokens } from '../db.js'
import { archiveWeChatGroupMessage, buildWeChatGroupCommandPrompt, formatGroupLine, makeWeChatGroupExternalId, shouldWakeInWeChatGroup, WECHAT_GROUP_CHANNEL } from './wechat-groups.js'
import { checkWeChatGroupCommandSafety } from './wechat-command-guard.js'
import { recordWeChatGroupMessage, recordWeChatGroupAssistantReply, recordWeChatGroupExplicitMemories } from './wechat-group-memory.js'
import { normalizeWeChatGroupDisplayText, recordWeChatGroupActivity } from './wechat-group-stats.js'

let client = null
let currentQrUrl = null   // set during login, cleared after scan
let clawbotStatus = 'idle' // idle | qr_pending | connected | error

function getClawbotAccountId() {
  try {
    const fromClient = client?.getAccountId?.()
    if (fromClient) return String(fromClient || '').trim()
  } catch {}
  try {
    return String(getClawbotCredentials()?.accountId || '').trim()
  } catch {
    return ''
  }
}

function getClawbotNotifyTargetIds() {
  const ids = []
  const push = (value = '') => {
    const id = String(value || '').trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  const accountId = getClawbotAccountId()
  try {
    const c = getClawbotCredentials() || {}
    push(c.notifyUserId || c.notify_user_id || c.userId || c.user_id || '')
  } catch {}
  try {
    const rows = getAllClawbotTokens()
      .slice()
      .sort((a, b) => Date.parse(b?.updated_at || '') - Date.parse(a?.updated_at || ''))
    for (const row of rows) {
      const id = String(row?.from_user_id || '').trim()
      if (id && id !== accountId) push(id)
    }
  } catch {}
  push(accountId)
  return ids
}

function getClawbotNotifyTargetId() {
  return getClawbotNotifyTargetIds()[0] || ''
}

function getClawbotContextTokenFor(userId = '') {
  const id = String(userId || '').trim()
  if (!id) return ''
  try {
    if (client?.contextTokens instanceof Map) return String(client.contextTokens.get(id) || '').trim()
  } catch {}
  return ''
}

function isMissingContextTokenError(err) {
  return /No context_token|context_token/i.test(String(err?.message || err || ''))
}

async function sendClawbotTextAllowingSelf(userId, content, contextToken = '') {
  const target = String(userId || '').trim()
  const text = String(content || '')
  const token = String(contextToken || '').trim()
  if (!target) throw new Error('clawbot target user id missing')
  try {
    return await client.sendText(target, text, token || undefined)
  } catch (err) {
    // “发送到 ClawBot 自己”没有普通好友会话 context_token 时，尝试走 iLink 底层 sendMessage。
    // 这样不需要用户再配置联系人；若服务端仍拒绝，调用方会拿到真实错误并可降级。
    if (!isMissingContextTokenError(err) || !client?.api) throw err
    return await sendIlinkText(client.api, target, text, token || '')
  }
}

async function sendClawbotImageAllowingSelf(userId, imagePath, caption = '', contextToken = '') {
  const target = String(userId || '').trim()
  const file = String(imagePath || '').trim()
  const token = String(contextToken || '').trim()
  if (!target) throw new Error('clawbot target user id missing')
  if (!file || !fs.existsSync(file)) throw new Error(`clawbot image file missing: ${file}`)
  const uploaded = await client.uploadImage(file, target)
  try {
    return await client.sendUploadedImage(target, uploaded, caption || undefined, token || undefined)
  } catch (err) {
    if (!isMissingContextTokenError(err) || !client?.api) throw err
    return await sendIlinkImage(client.api, target, uploaded, token || '', caption || undefined)
  }
}

export function getClawbotStatus() {
  const accountId = getClawbotAccountId()
  const selfContextToken = getClawbotContextTokenFor(accountId)
  return {
    status: clawbotStatus,
    connected: !!client && clawbotStatus === 'connected',
    accountId,
    self_context_ready: !!selfContextToken,
  }
}

// 系统通知专用：发送到 ClawBot 自己，不让用户选择联系人/群。
export async function sendClawbotSelfNotification({ text = '', imagePath = '', fallbackText = '' } = {}) {
  if (!client || clawbotStatus !== 'connected') {
    return { ok: false, reason: 'wechat-clawbot not connected', status: clawbotStatus }
  }
  const targetIds = getClawbotNotifyTargetIds()
  if (!targetIds.length) return { ok: false, reason: 'clawbot notify target missing', status: clawbotStatus }
  const body = String(text || '').trim()
  const fallback = String(fallbackText || body || '').trim()
  let lastErr = null
  for (const targetId of targetIds) {
    const contextToken = getClawbotContextTokenFor(targetId)
    try {
      if (imagePath) {
        try {
          const id = await sendClawbotImageAllowingSelf(targetId, imagePath, body, contextToken)
          return { ok: true, platform: 'wechat-clawbot', self: true, image: true, id, targetId }
        } catch (imageErr) {
          console.warn(`[ClawBot] 自通知图片发送失败 target=${targetId}，降级文本/下个目标：${imageErr?.message || imageErr}`)
          lastErr = imageErr
          if (!fallback) throw imageErr
          const id = await sendClawbotTextAllowingSelf(targetId, fallback, contextToken)
          return { ok: true, platform: 'wechat-clawbot', self: true, image: false, fallback: true, id, targetId, image_error: imageErr?.message || String(imageErr) }
        }
      }
      if (!body) return { ok: false, reason: 'empty notification content' }
      const id = await sendClawbotTextAllowingSelf(targetId, body, contextToken)
      return { ok: true, platform: 'wechat-clawbot', self: true, image: false, id, targetId }
    } catch (err) {
      lastErr = err
      console.warn(`[ClawBot] 自通知目标失败 target=${targetId}: ${err?.message || err}`)
    }
  }
  console.error(`[ClawBot] 自通知发送失败: ${lastErr?.message || lastErr || 'all targets failed'}`)
  return { ok: false, error: lastErr?.message || String(lastErr || 'all targets failed'), targetId: targetIds[0], triedTargetIds: targetIds }
}

// Called by dispatch.js to send replies back to WeChat
export async function sendClawbotMessage(userId, content) {
  if (!client || clawbotStatus !== 'connected') {
    return { ok: false, reason: 'wechat-clawbot not connected' }
  }
  try {
    const rawUserId = String(userId || '')
    if (rawUserId.startsWith('group:')) {
      const [groupId, contextToken = ''] = rawUserId.slice('group:'.length).split(':ctx:')
      await client.sendText(groupId, content, contextToken || undefined)
      return { ok: true, platform: 'wechat-clawbot', group: true }
    }
    await client.sendText(rawUserId, content)
    return { ok: true, platform: 'wechat-clawbot' }
  } catch (err) {
    console.error(`[ClawBot] sendText 失败: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

// Called by api.js for GET /social/wechat-clawbot/qr
export function getClawbotQR() {
  return { status: clawbotStatus, qr_url: currentQrUrl }
}

// Called by api.js for POST /social/wechat-clawbot/logout
export function logoutClawbot() {
  clearClawbotCredentials()
  clawbotStatus = 'idle'
  currentQrUrl = null
  try { client?.stop?.() } catch {}
  client = null
}

export function startClawbotConnector({ pushMessage, emitEvent } = {}) {
  const saved = getClawbotCredentials()

  client = new WeChatClient(saved ? {
    accountId: saved.accountId,
    token: saved.botToken,
    baseUrl: saved.baseUrl,
  } : {})

  // Monkey-patch client.api.apiFetch：库内部 sendMessage 只 await apiFetch、丢掉响应文本，
  // 而 apiFetch 仅在 HTTP !res.ok 时抛错——HTTP 200 + body 里 {"ret": -1} 这种业务失败被完全吞掉，
  // 导致 sendText 报"成功"但消息没投递。这里拦响应：sendmessage 端点解析 JSON，
  // 发现非零 ret/code 时显式抛错，让上层 sendClawbotMessage 的 catch 拿到真实失败原因。
  try {
    const rawApiFetch = client.api?.apiFetch?.bind(client.api)
    if (typeof rawApiFetch === 'function') {
      client.api.apiFetch = async (params) => {
        const rawText = await rawApiFetch(params)
        if (params?.endpoint === 'ilink/bot/sendmessage') {
          let body = null
          try { body = JSON.parse(rawText) } catch {}
          if (body && typeof body === 'object') {
            const ret = body.ret ?? body.code ?? body.errcode
            if (ret != null && ret !== 0) {
              const errMsg = body.err_msg || body.errmsg || body.message || body.msg || ''
              console.error(`[ClawBot] sendMessage 服务端拒绝 ret=${ret} ${errMsg} raw=${rawText.slice(0, 500)}`)
              throw new Error(`iLink sendmessage rejected: ret=${ret} ${errMsg}`)
            }
          }
        }
        if (params?.endpoint === 'ilink/bot/getuploadurl') {
          let body = null
          try { body = JSON.parse(rawText) } catch {}
          if (body && typeof body === 'object' && !body.upload_param && body.upload_full_url) {
            try {
              const parsed = new URL(String(body.upload_full_url))
              const uploadParam = parsed.searchParams.get('encrypted_query_param')
              if (uploadParam) {
                body.upload_param = uploadParam
                return JSON.stringify(body)
              }
            } catch {}
          }
        }
        return rawText
      }
      console.log('[ClawBot] sendMessage 响应校验已启用')
    } else {
      console.warn('[ClawBot] client.api.apiFetch 不可访问，跳过响应校验（库实现可能已变化）')
    }
  } catch (err) {
    console.warn(`[ClawBot] 安装响应校验失败（不致命，继续启动）: ${err.message}`)
  }

  // 启动时把上次落盘的 context_token 回填到内存 Map：
  // ilink 库 sendText 用的是 this.contextTokens.get(to)，重启后这个 Map 是空的；
  // 不回填则只能等用户先发一条新消息才能回复。token 可能服务端已过期，所以
  // sendText 仍可能失败，executor 已有兜底提示，这里只是尽量恢复。
  // contextTokens 在 .d.ts 里是 private 但运行时是普通 class field —— 加 guard 防作者哪天换成 # 真私有。
  try {
    if (client.contextTokens instanceof Map) {
      const rows = getAllClawbotTokens()
      if (rows.length) {
        for (const row of rows) {
          client.contextTokens.set(row.from_user_id, row.context_token)
        }
        console.log(`[ClawBot] 已从持久化恢复 ${rows.length} 条 context_token`)
      }
    } else {
      console.warn('[ClawBot] client.contextTokens 不可访问（库实现可能已变化），跳过 token 恢复')
    }
  } catch (err) {
    console.warn(`[ClawBot] 恢复 context_token 失败（不致命，继续启动）: ${err.message}`)
  }

  client.on('message', async (msg) => {
    // 每条入站消息都带新鲜的 context_token —— 库已经在内部 set 到 Map 了，
    // 这里只是同步落盘一份，让下次重启能继承当前会话。
    if (msg?.context_token && msg?.from_user_id) {
      try { upsertClawbotToken(msg.from_user_id, msg.context_token) } catch {}
    }
    const rawText = (WeChatClient.extractText?.(msg) ?? extractText(msg)).trim()
    const text = normalizeWeChatGroupDisplayText(rawText, msg?.type || msg?.msg_type || '') || rawText
    if (!text) return

    const groupId = String(msg?.group_id || '').trim()
    if (groupId) {
      const senderId = String(msg?.from_user_id || '').trim()
      const groupExternalId = makeWeChatGroupExternalId(groupId)
      const contextToken = String(msg?.context_token || '').trim()
      // 群聊的 context_token 也按 group_id 保存一份；部分 iLink 后端回群需要按群会话 token 投递。
      if (contextToken) {
        try { upsertClawbotToken(groupId, contextToken) } catch {}
        try { if (client.contextTokens instanceof Map) client.contextTokens.set(groupId, contextToken) } catch {}
      }

      try {
        recordWeChatGroupActivity({ groupId, senderId, senderName: senderId, text: rawText || text, messageType: msg?.type || msg?.msg_type || '', mentionedSelf: false, source: 'clawbot' })
      } catch (err) {
        console.warn(`[ClawBotStats] 写入群统计失败：${err?.message || err}`)
      }
      const archived = archiveWeChatGroupMessage({ groupId, senderId, text })
      recordWeChatGroupMessage({ groupId, senderId, senderName: senderId, text, mentionedSelf: false, source: 'clawbot' }).catch(err => console.warn(`[Honcho] 写入群记忆失败：${err?.message || err}`))
      console.log(`[ClawBot] 群消息已归档 group=${groupId} sender=${senderId} text=${text.slice(0, 80)}`)
      emitEvent?.('message_in', {
        from_id: archived?.groupExternalId || groupExternalId,
        content: formatGroupLine(senderId, text),
        channel: WECHAT_GROUP_CHANNEL,
        external_party_id: groupExternalId,
        social: { platform: 'wechat-clawbot', group_id: groupId, sender_id: senderId, user_text: text, raw_user_text: rawText || text },
        timestamp: new Date().toISOString(),
      })

      const woke = shouldWakeInWeChatGroup(text, { mentionedSelf: false })
      if (!woke) return
      console.log(`[ClawBot] 群 @/唤醒已命中，调用大模型 group=${groupId} sender=${senderId} text=${text.slice(0, 120)}`)

      const safety = checkWeChatGroupCommandSafety(text)
      if (!safety.allowed) {
        const refusal = safety.reason
        const outboundId = contextToken
          ? `group:${groupId}:ctx:${contextToken}`
          : `group:${groupId}`
        await sendClawbotMessage(outboundId, refusal)
        recordWeChatGroupAssistantReply({ groupId, reply: refusal, targetMemberName: senderId, source: 'clawbot' }).catch(() => {})
        console.warn(`[ClawBot] 群高危请求已拦截 group=${groupId} sender=${senderId} rules=${safety.hits.map(h => h.id).join(',')}`)
        return
      }

      recordWeChatGroupExplicitMemories({ groupId, senderId, senderName: senderId, text, source: 'clawbot' })
        .then(result => {
          if (result?.count) console.log(`[Honcho] 已沉淀 ClawBot 群显式记忆 group=${groupId} sender=${senderId} count=${result.count}`)
        })
        .catch(err => console.warn(`[Honcho] ClawBot 显式群记忆写入失败：${err?.message || err}`))

      const prompt = await buildWeChatGroupCommandPrompt({
        groupId,
        senderId,
        senderName: senderId,
        text,
        rawText: rawText || text,
        messageType: msg?.type || msg?.msg_type || '',
        mentionedSelf: true,
      })
      // 无 token 时仍可入队让本地窗口显示/处理；出站回群可能失败并在日志中提示。
      const outboundId = contextToken
        ? `wechat:clawbot:group:${groupId}:ctx:${encodeURIComponent(contextToken)}`
        : `wechat:clawbot:group:${groupId}`
      pushMessage(groupExternalId, prompt, WECHAT_GROUP_CHANNEL, {
        noPersist: true,
        noPrune: true,
        noPreempt: true,
        externalPartyIdOverride: outboundId,
        social: { platform: 'wechat-clawbot', group_id: groupId, sender_id: senderId, context_token: contextToken, user_text: text, raw_user_text: rawText || text },
      })
      return
    }

    const fromId = `wechat:clawbot:${msg.from_user_id}`
    pushMessage(fromId, text, 'WECHAT_CLAWBOT', {
      social: { platform: 'wechat-clawbot', user_id: msg.from_user_id },
    })
    emitEvent?.('message_in', {
      from_id: fromId,
      content: text,
      channel: 'WECHAT_CLAWBOT',
      timestamp: new Date().toISOString(),
    })
  })

  client.on('error', (err) => {
    console.error(`[ClawBot] 错误: ${err.message}`)
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'error', error: err.message })
  })

  client.on('sessionExpired', () => {
    console.warn('[ClawBot] 会话已过期，请重新扫码登录')
    clearClawbotCredentials()
    clawbotStatus = 'idle'
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'session_expired' })
  })

  if (!saved) {
    // 首次登录：发起扫码流程
    clawbotStatus = 'qr_pending'
    console.log('[ClawBot] 未找到已保存凭证，开始扫码登录...')
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'qr_pending' })

    client.login({
      onQRCode(url) {
        currentQrUrl = url
        clawbotStatus = 'qr_ready'
        console.log(`[ClawBot] 二维码已就绪，请在设置面板扫码`)
        emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'qr_ready', qr_url: url })
      },
    }).then(result => {
      currentQrUrl = null
      // wechat-ilink-client 的 login() 在超时/取消等情况下不会 reject，
      // 而是 resolve 一个 { connected: false, message } —— 必须显式检查 connected 字段，
      // 否则会误把超时当成扫码成功，UI 卡在虚假的"已连接"
      if (!result?.connected || !result?.accountId || !result?.botToken) {
        clawbotStatus = 'idle'
        const reason = result?.message || '未知原因'
        console.warn(`[ClawBot] 扫码登录未完成: ${reason}`)
        emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'idle', reason })
        return
      }
      clawbotStatus = 'connected'
      setClawbotCredentials({
        accountId: result.accountId,
        botToken: result.botToken,
        baseUrl: result.baseUrl,
        userId: result.userId,
        notifyUserId: result.userId,
      })
      console.log(`[ClawBot] 扫码登录成功，已保存凭证`)
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'connected', accountId: result.accountId })
      client.start().catch(err => console.error(`[ClawBot] start 失败: ${err.message}`))
    }).catch(err => {
      clawbotStatus = 'error'
      console.error(`[ClawBot] 扫码登录失败: ${err.message}`)
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'error', error: err.message })
    })
  } else {
    // 凭证已存，直接启动
    clawbotStatus = 'connected'
    console.log(`[ClawBot] 使用已保存凭证启动（accountId: ${saved.accountId}）`)
    emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'connected', accountId: saved.accountId })
    client.start().catch(err => {
      // start 失败说明凭证已失效或后端连不上 —— 必须同步把内存状态打回去，
      // 否则 popup 查询时仍会拿到 'connected'，UI 显示"已连接"但实际啥都不通
      clawbotStatus = 'error'
      console.error(`[ClawBot] start 失败: ${err.message}`)
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'error', error: err.message })
    })
  }

  return {
    platform: 'wechat-clawbot',
    stop() {
      clawbotStatus = 'idle'
      try { client?.stop?.() } catch {}
    },
  }
}

// 从消息结构中提取文本（兼容 extractText 未导出的情况）
function extractText(msg) {
  if (!msg) return ''
  const items = msg.item_list || msg.itemList || []
  for (const item of items) {
    if (item.type === 1 || item.type === 'text') {
      return item.text_item?.text || item.textItem?.text || ''
    }
  }
  return ''
}
