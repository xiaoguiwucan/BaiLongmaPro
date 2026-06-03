import { startDiscordConnector } from './discord.js'
import { startClawbotConnector } from './wechat-clawbot.js'
import { startWechatyDutyGroupConnector } from './wechaty-duty-group.js'
import { startWeChatGroupDigestScheduler } from './wechat-group-digest.js'
import { getWechatyDutyGroupConfig } from '../config.js'
import { startLLMConnectivityMonitorScheduler } from '../llm-connectivity-monitor.js'

const running = new Map() // platform → connector

export async function startSocialConnectors({ pushMessage, emitEvent } = {}) {
  const starters = [
    { platform: 'discord', start: () => startDiscordConnector({ pushMessage, emitEvent }) },
    { platform: 'wechat-clawbot', start: () => startClawbotConnector({ pushMessage, emitEvent }) },
    // 群聊必须走 Wechaty；ClawBot/iLink 只保留为私聊通道，不能因为 ClawBot 有凭证就跳过微信群助手。
    ...(getWechatyDutyGroupConfig().enabled ? [{ platform: 'wechaty-duty-group', start: () => startWechatyDutyGroupConnector({ pushMessage, emitEvent }) }] : []),
  ]

  for (const { platform, start } of starters) {
    try {
      const connector = await start()
      if (connector) {
        running.set(platform, connector)
        emitEvent?.('social_status', { platform, status: 'started' })
      }
    } catch (error) {
      console.error(`[social] ${platform} connector failed to start: ${error.message}`)
      emitEvent?.('social_status', { status: 'start_error', platform, error: error.message })
    }
  }

  try {
    startWeChatGroupDigestScheduler()
  } catch (error) {
    console.warn('[social] wechat group digest scheduler failed:', error?.message || error)
  }

  try {
    startLLMConnectivityMonitorScheduler()
  } catch (error) {
    console.warn('[social] llm connectivity monitor scheduler failed:', error?.message || error)
  }

  return [...running.values()]
}

// 热重启单个平台连接器（用于设置界面保存 token 后立即生效）
export async function restartConnector(platform, { pushMessage, emitEvent } = {}) {
  const existing = running.get(platform)
  if (existing) {
    try { existing.stop() } catch {}
    running.delete(platform)
  }

  const starters = {
    discord: () => startDiscordConnector({ pushMessage, emitEvent }),
    'wechat-clawbot': () => startClawbotConnector({ pushMessage, emitEvent }),
    'wechaty-duty-group': () => startWechatyDutyGroupConnector({ pushMessage, emitEvent }),
  }

  const start = starters[platform]
  if (!start) return

  try {
    const connector = await start()
    if (connector) {
      running.set(platform, connector)
      emitEvent?.('social_status', { platform, status: 'restarted' })
    }
  } catch (error) {
    console.error(`[social] ${platform} restart failed: ${error.message}`)
    emitEvent?.('social_status', { status: 'start_error', platform, error: error.message })
  }
}
