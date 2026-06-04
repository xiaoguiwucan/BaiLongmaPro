import http from 'http'
import fs from 'fs'
import path from 'path'
import net from 'net'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { pushMessage } from './queue.js'
import { getDB, getConfig, setConfig, insertUISignal, upsertMediaHistory, getMediaHistory, updateLastJarvisConversationContent } from './db.js'
import { emitEvent, addSSEClient, removeSSEClient, addACUIClient, removeACUIClient, removeActiveUICard, emitUICommand, flushStickyEvents, setStickyEvent } from './events.js'
import { getQuotaStatus } from './quota.js'
import { isRunning, stopLoop, startLoop } from './control.js'
import { buildHeartbeatSystemPromptPreview } from './system-prompt-preview.js'
import { paths } from './paths.js'
import { config, activate as activateLLM, getActivationStatus, switchModel, setTemperature, getMinimaxKey, setMinimaxKey, getSocialConfig, setSocialConfig, getHonchoConfig, setHonchoConfig, getWechatyDutyGroupConfig, setWechatyDutyGroupConfig, getWeChatGroupDigestConfig, setWeChatGroupDigestConfig, WECHATY_PERSONA_PRESETS, getVoiceConfig, setVoiceConfig, getTTSConfig, setTTSConfig, getTTSCredentials, getProviderSummaries, getSecurity, setSecurity, getEmbeddingConfig, setEmbeddingConfig, EMBEDDING_PROVIDER_PRESETS, getWebSearchConfig, setWebSearchConfig, upsertLLMProfile, deleteLLMProfile, selectLLMProfile, testLLMProfileConnection, setLLMFailoverConfig, getLLMConnectivityMonitorConfig, setLLMConnectivityMonitorConfig, getWechatMemeConfig, setWechatMemeConfig, getSkillsConfig, setSkillImageConfig, setSkillImageVisionConfig, setSkillVideoAnalysisConfig, testSkillModelChannel, listSkillModelChannelModels } from './config.js'
import { getHotspotAlertConfig, setHotspotAlertConfig } from './config.js'
import { streamTTS, TTS_PROVIDERS, TTS_VOICES } from './voice/tts-providers.js'
import { getVoiceStatus, startVoiceServer, stopVoiceServer, restartVoiceServer } from './voice/manager.js'
import { restartConnector } from './social/index.js'
import { replaceProvider } from './providers/registry.js'
import { persistAppState } from './capabilities/executor.js'
import { MinimaxProvider } from './providers/minimax.js'
import { handleSocialWebhook, isSocialWebhookPath } from './social/webhooks.js'
import { getClawbotQR, logoutClawbot } from './social/wechat-clawbot.js'
import { configureWechatyDutyGroup, forceReloginWechatyDutyGroupConnector, getWechatyDutyGroupStatus, listWechatyDutyGroupRooms, refreshWechatyDutyGroupMemberNames, restartWechatyDutyGroupConnector, sendWechatyOfflineQrNotifyNow, startWechatyDutyGroupConnector, stopWechatyDutyGroupConnector, syncWechatyDutyGroupRooms, testWechatyNativeMention } from './social/wechaty-duty-group.js'
import { buildWeChatGroupSummary, getRecentWeChatGroupMessages, listRecentWeChatGroups, makeWeChatGroupExternalId, WECHAT_GROUP_CHANNEL } from './social/wechat-groups.js'
import { createWeChatGroupManualMemory, deleteWeChatGroupMemory, deleteWeChatMemberPermanentMemory, getWeChatGroupMemoryStatus, listWeChatGroupMemory, listWeChatGroupMemoryOverview, listWeChatMemberPermanentMemory, syncLocalWeChatMessagesToHoncho, backfillWeChatExplicitMemoriesFromMessages, updateWeChatMemberPermanentMemory } from './social/wechat-group-memory.js'
import { getWeChatCommandGuardRules } from './social/wechat-command-guard.js'
import { buildWeChatGroupActivityExport, getWeChatGroupStats, importWeChatGroupActivityRecords, listKnownWeChatGroups, listWeChatGroupActivityRecords, listWeChatGroupMembers, resolveWeChatGroupMediaFile } from './social/wechat-group-stats.js'
import { searchMemes } from './social/meme-search.js'
import { deleteWeChatImageMediaItem, getWeChatImageVisionStatus, listWeChatImageMediaItems, startWeChatImageBackgroundDescribe, updateWeChatImageMediaItem } from './social/wechat-image-vision.js'
import { getWeChatVideoAnalysisStatus } from './social/wechat-video-analysis-skill.js'
import { sendWeChatGroupDigestNow } from './social/wechat-group-digest.js'
import { WECHAT_GROUP_REPORT_TEMPLATES, normalizeWeChatGroupReportTemplate, renderWeChatGroupStatsPosterHtml } from './social/wechat-group-report-template.js'
import { getLLMConnectivityMonitorStatus, runLLMConnectivityMonitorCheck, startLLMConnectivityMonitorScheduler } from './llm-connectivity-monitor.js'
import { getHotspotAlertStatus, runHotspotAlertCheck, startHotspotAlertScheduler } from './hotspot-alert-monitor.js'
import { createCloudASRSession } from './voice/cloud-asr.js'
import { getHotspots, setHotspotPanelState, getHotspotPanelState } from './hotspots.js'
import { getPersonCard, setPersonCardPanelState, getPersonCardPanelState } from './person-cards.js'
import { setDocPanelState, getDocPanelState, DOC_TOPICS } from './docs.js'
import { getDatabaseOverview, exportDatabaseData, importDatabaseData, backfillDatabaseVectors, searchDatabaseData } from './database-overview.js'
import { commitKnowledgeImport, deleteKnowledgeSource, getKnowledgeStatus, listKnowledgeSources, parseKnowledgeImport, reparseKnowledgeSource, searchKnowledge, updateKnowledgeSource } from './knowledge-base.js'

export { emitEvent }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INDEX_PATH         = paths.indexHtml
const DASHBOARD_PATH     = paths.dashboardHtml
const BRAIN_PATH         = paths.brainHtml
const BRAIN_UI_PATH      = paths.brainUiHtml
const WEBSITE_PATH       = paths.websiteHtml
const SYSTEM_PROMPT_PATH = paths.systemPromptHtml
const ACTIVATION_PATH    = paths.activationHtml
const BRAIN_UI_ASSET_ROOT = paths.brainUiAssetRoot
const D3_VENDOR_PATH     = path.join(paths.resourcesDir, 'node_modules', 'd3', 'dist', 'd3.min.js')
const SANDBOX_PATH       = paths.sandboxDir
const DEFAULT_AGENT_NAME = '小白龙'
const DEFAULT_API_HOST = '127.0.0.1'

// card.action signals that are lifecycle/system-internal — stored in DB for passive injector use only, not pushed to the agent queue
const SILENT_CARD_ACTIONS = new Set([
  'card.dismissed',  // card closed (components should use acui:dismiss; this is a fallback guard)
  'card.mounted',    // mount complete
  'card.dwell',      // dwell heartbeat
  'card.error',      // render error (already handled by the card.error type signal)
])

function getApiHost() {
  return String(globalThis.process?.env?.BAILONGMA_HOST || DEFAULT_API_HOST).trim() || DEFAULT_API_HOST
}

function isLanAccessEnabled() {
  return /^(1|true|yes|on)$/i.test(String(globalThis.process?.env?.BAILONGMA_ALLOW_LAN || '').trim())
}

function normalizeRemoteAddress(address = '') {
  const value = String(address || '').trim().toLowerCase()
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length)
  return value
}

function isLoopbackAddress(address = '') {
  const value = normalizeRemoteAddress(address)
  return value === '127.0.0.1'
    || value === '::1'
    || value === 'localhost'
}

function isLoopbackRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress)
}

function isPrivateLanAddress(address = '') {
  const value = normalizeRemoteAddress(address)
  if (!value) return false

  if (net.isIP(value) === 4) {
    const [a, b] = value.split('.').map(part => Number(part))
    return a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
  }

  if (net.isIP(value) === 6) {
    return value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')
  }

  return false
}

function isLanRequest(req) {
  return isLanAccessEnabled() && isPrivateLanAddress(req.socket?.remoteAddress)
}

function isLoopbackOrigin(origin = '') {
  if (!origin || origin === 'null') return true
  try {
    const parsed = new URL(origin)
    return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function isAllowedOrigin(origin = '') {
  if (isLoopbackOrigin(origin)) return true
  if (!isLanAccessEnabled()) return false
  try {
    const parsed = new URL(origin)
    return isPrivateLanAddress(parsed.hostname)
  } catch {
    return false
  }
}

function getAuthToken() {
  return String(globalThis.process?.env?.BAILONGMA_API_TOKEN || '').trim()
}

function hasValidAuthToken(req, url) {
  const expected = getAuthToken()
  if (!expected) return false
  const header = req.headers.authorization || ''
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const queryToken = url.searchParams.get('token')
  return bearer === expected || queryToken === expected
}

function requireLocalOrToken(req, res, url) {
  if (hasAllowedAccess(req, url)) return true
  jsonResponse(res, 403, { ok: false, error: 'forbidden' })
  return false
}

function hasAllowedAccess(req, url) {
  return isLoopbackRequest(req) || hasValidAuthToken(req, url) || isLanRequest(req)
}

function isSensitivePath(pathname) {
  return pathname === '/activate'
    || pathname === '/settings'
    || pathname.startsWith('/settings/')
    || pathname.startsWith('/admin/')
    || pathname.startsWith('/memories/')
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
      return 'audio/ogg'
    default:
      return 'text/plain; charset=utf-8'
  }
}

function getAgentName() {
  return (getConfig('agent_name') || '').trim() || DEFAULT_AGENT_NAME
}

function stripAssistantHistoryLabels(content) {
  return String(content || '')
    .trim()
    .replace(/^(?:\s*\[assistant(?:\s+to\s+[^\]\r\n]+)?(?:\s+\d{4}-\d{2}-\d{2}T[^\]\r\n]+)?\]\s*)+/giu, '')
    .trim()
}

export function startAPI(port = 3721, { getStateSnapshot = null, onActivated = null } = {}) {
  const onActivatedCallback = onActivated
  const host = getApiHost()

  // 启动时把 DB 里的当前 agent_name 写进 sticky，
  // 这样后续每个新连上的 SSE 客户端（含 brain-ui 首次加载）能立即拿到正确名字
  try {
    const storedName = (getConfig('agent_name') || '').trim()
    if (storedName) setStickyEvent('agent_name_updated', { name: storedName })
  } catch {}
  const server = http.createServer(async (req, res) => {
    const base = `http://localhost:${port}`
    const url = new URL(req.url, base)
    const origin = req.headers.origin

    // GET /social/wechat-clawbot/qr — get current QR code status and URL
    if (req.method === 'GET' && url.pathname === '/social/wechat-clawbot/qr') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, ...getClawbotQR() })
    }

    // POST /social/wechat-clawbot/logout — clear credentials and disconnect
    if (req.method === 'POST' && url.pathname === '/social/wechat-clawbot/logout') {
      if (!requireLocalOrToken(req, res, url)) return
      logoutClawbot()
      emitEvent('social_status', { platform: 'wechat-clawbot', status: 'idle' })
      return jsonResponse(res, 200, { ok: true })
    }



    // GET /social/wechaty-duty-group/status — 查看 Wechaty 群助手连接/扫码状态
    if (req.method === 'GET' && url.pathname === '/social/wechaty-duty-group/status') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, ...getWechatyDutyGroupStatus() })
    }

    // POST /social/wechaty-duty-group/offline-qr-notify — 立即重发/测试 ClawBot 掉线二维码通知
    if (req.method === 'POST' && url.pathname === '/social/wechaty-duty-group/offline-qr-notify') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        try {
          const result = await sendWechatyOfflineQrNotifyNow({
            reason: body?.reason || 'manual_test',
            force: body?.force !== false,
          })
          jsonResponse(res, result.ok ? 200 : 409, { ok: result.ok === true, result, status: getWechatyDutyGroupStatus() })
        } catch (err) {
          jsonResponse(res, 500, { ok: false, error: err.message, status: getWechatyDutyGroupStatus() })
        }
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // GET /social/wechaty-duty-group/rooms — 获取当前微信号加入的群列表，用于设置页多选
    if (req.method === 'GET' && url.pathname === '/social/wechaty-duty-group/rooms') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const result = await listWechatyDutyGroupRooms()
      return jsonResponse(res, result.ok ? 200 : 409, result)
    }

    // POST /social/wechaty-duty-group/refresh-members — 强制刷新当前已接入群的成员昵称映射。
    if (req.method === 'POST' && url.pathname === '/social/wechaty-duty-group/refresh-members') {
      if (!requireLocalOrToken(req, res, url)) return
      const result = await refreshWechatyDutyGroupMemberNames({ force: true })
      return jsonResponse(res, result.ok ? 200 : 409, result)
    }

    // POST /social/wechaty-duty-group/test-native-mention — 实验性 Web 微信 MsgSource/atuserlist 系统级 @ 测试。
    // 注意：这是协议兼容性验证接口，只能本机调用；成功发送不等于手机端一定出现「有人@我」。
    if (req.method === 'POST' && url.pathname === '/social/wechaty-duty-group/test-native-mention') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        try {
          const result = await testWechatyNativeMention({
            groupName: body.group_name || body.groupName || body.topic || '',
            roomId: body.room_id || body.roomId || '',
            memberName: body.member_name || body.memberName || body.name || '',
            memberId: body.member_id || body.memberId || body.id || '',
            text: body.text || '',
            variants: body.variants || body.variant || ['msgsource'],
          })
          return jsonResponse(res, result.ok ? 200 : 409, result)
        } catch (err) {
          return jsonResponse(res, 500, { ok: false, error: err?.message || String(err) })
        }
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechaty-duty-group/start — 启动 Wechaty 扫码，可接入多个群；默认不预选任何群。
    if (req.method === 'POST' && url.pathname === '/social/wechaty-duty-group/start') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const saved = getWechatyDutyGroupConfig()
        const groupNames = body.group_names || body.groupNames || body.groups || body.group_name || body.groupName || saved.groupNames
        const enabled = body.enabled ?? saved.enabled
        configureWechatyDutyGroup({ groupNames, enabled })
        const before = getWechatyDutyGroupStatus()
        if (before.online) {
          return jsonResponse(res, 200, { ok: true, already_running: true, ...before })
        }
        if (before.status === 'qr_ready' && before.qr) {
          return jsonResponse(res, 200, { ok: true, already_running: true, ...before })
        }
        const starter = ['idle', 'error', 'disconnected'].includes(before.status)
          ? startWechatyDutyGroupConnector
          : restartWechatyDutyGroupConnector
        starter({ pushMessage, emitEvent, groupNames, enabled }).catch(err =>
          console.warn('[social] wechaty-duty-group start/restart failed:', err.message)
        )
        jsonResponse(res, 200, { ok: true, ...getWechatyDutyGroupStatus() })
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechaty-duty-group/relogin — 清空 Wechaty 登录态并强制重新生成二维码
    if (req.method === 'POST' && url.pathname === '/social/wechaty-duty-group/relogin') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const saved = getWechatyDutyGroupConfig()
        const groupNames = body.group_names || body.groupNames || body.groups || body.group_name || body.groupName || saved.groupNames
        const enabled = body.enabled ?? saved.enabled
        configureWechatyDutyGroup({ groupNames, enabled })
        forceReloginWechatyDutyGroupConnector({ pushMessage, emitEvent, groupNames, enabled }).catch(err =>
          console.warn('[social] wechaty-duty-group force relogin failed:', err.message)
        )
        jsonResponse(res, 200, { ok: true, relogin: true, ...getWechatyDutyGroupStatus() })
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechaty-duty-group/stop — 停止 Wechaty 群助手连接
    if (req.method === 'POST' && url.pathname === '/social/wechaty-duty-group/stop') {
      if (!requireLocalOrToken(req, res, url)) return
      stopWechatyDutyGroupConnector().then(() => jsonResponse(res, 200, { ok: true, ...getWechatyDutyGroupStatus() }))
        .catch(err => jsonResponse(res, 500, { ok: false, error: err.message }))
      return
    }

    // GET /social/wechat-groups — 最近活跃微信群列表
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const hours = Math.min(parseInt(url.searchParams.get('hours') || '72'), 24 * 30)
      return jsonResponse(res, 200, { ok: true, groups: listRecentWeChatGroups({ limit, hours }) })
    }


    // GET /social/wechat-groups/known — 已识别/有记录的微信群全集，用于设置页统一候选来源。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/known') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '300'), 1000)
      return jsonResponse(res, 200, listKnownWeChatGroups({ limit }))
    }

    // GET /social/wechat-groups/memory?group_id=xxx&category=task
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/memory') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const rawGroupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      if (!rawGroupId) return jsonResponse(res, 400, { ok: false, error: 'group_id required' })
      const category = url.searchParams.get('category') || ''
      const groupName = url.searchParams.get('group_name') || url.searchParams.get('groupName') || ''
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '80'), 300)
      const includeAllPeers = url.searchParams.get('include_all_peers') !== 'false'
      const result = await listWeChatGroupMemory({ groupId: rawGroupId, groupName, category, limit, includeAllPeers })
      return jsonResponse(res, 200, { ok: true, group_id: rawGroupId, ...result })
    }

    // GET /social/wechat-groups/memory-overview — 按设置页真实群列表展示每个群的 Honcho 记忆概览
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/memory-overview') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const status = getWechatyDutyGroupStatus()
      const groups = Array.isArray(status.rooms) ? status.rooms : []
      const selectedOnly = url.searchParams.get('selected_only') !== 'false'
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const result = await listWeChatGroupMemoryOverview({ groups: selectedOnly ? groups.filter(room => room.selected) : groups, limit })
      return jsonResponse(res, 200, { ok: true, rooms_stale: status.rooms_stale, online: status.online, ...result })
    }

    // GET /social/wechat-groups/member-memory — 可编辑的群友永久记忆管理视图
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/member-memory') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const groupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      const groupName = url.searchParams.get('group_name') || url.searchParams.get('groupName') || ''
      const refreshMembers = url.searchParams.get('refresh_members') === '1' || url.searchParams.get('refreshMembers') === 'true'
      let refreshResult = null
      if (refreshMembers && (groupId || groupName)) {
        try {
          refreshResult = await refreshWechatyDutyGroupMemberNames({ force: true, groupId, groupName })
        } catch (err) {
          refreshResult = { ok: false, error: err?.message || String(err) }
        }
      }
      const result = listWeChatMemberPermanentMemory({
        groupId,
        groupName,
        canonicalMemberId: url.searchParams.get('canonical_member_id') || url.searchParams.get('canonicalMemberId') || '',
        senderId: url.searchParams.get('sender_id') || url.searchParams.get('senderId') || '',
        senderName: url.searchParams.get('sender_name') || url.searchParams.get('senderName') || '',
        q: url.searchParams.get('q') || '',
        limit: Math.min(parseInt(url.searchParams.get('limit') || '20000'), 20000),
      })
      if (refreshResult) result.member_refresh = refreshResult
      return jsonResponse(res, result.ok ? 200 : 400, result)
    }

    // POST /social/wechat-groups/memory — 手动给当前群新增一条 Honcho 结论记忆
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/memory') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        const result = await createWeChatGroupManualMemory({
          groupId: body.group_id || body.groupId,
          groupName: body.group_name || body.groupName,
          content: body.content,
          category: body.category || 'manual',
          senderId: body.sender_id || body.senderId,
          senderName: body.sender_name || body.senderName,
          canonicalMemberId: body.canonical_member_id || body.canonicalMemberId,
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechat-groups/member-memory — 给某个群友新增永久记忆
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/member-memory') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        const result = await createWeChatGroupManualMemory({
          groupId: body.group_id || body.groupId,
          groupName: body.group_name || body.groupName,
          canonicalMemberId: body.canonical_member_id || body.canonicalMemberId,
          senderId: body.sender_id || body.senderId,
          senderName: body.sender_name || body.senderName,
          content: body.content,
          category: body.category || 'manual_member',
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // PATCH /social/wechat-groups/member-memory — 编辑某条群友永久记忆
    if (req.method === 'PATCH' && url.pathname === '/social/wechat-groups/member-memory') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const result = updateWeChatMemberPermanentMemory({
          groupId: body.group_id || body.groupId,
          itemId: body.item_id || body.itemId || body.id,
          content: body.content,
          category: body.category,
          salience: body.salience,
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // DELETE /social/wechat-groups/member-memory — 删除某条群友永久记忆
    if (req.method === 'DELETE' && url.pathname === '/social/wechat-groups/member-memory') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const result = deleteWeChatMemberPermanentMemory({
          groupId: body.group_id || body.groupId || url.searchParams.get('group_id') || url.searchParams.get('groupId'),
          itemId: body.item_id || body.itemId || body.id || url.searchParams.get('item_id') || url.searchParams.get('itemId'),
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // DELETE /social/wechat-groups/memory — 删除 Honcho 结论记忆或清空本群 session
    if (req.method === 'DELETE' && url.pathname === '/social/wechat-groups/memory') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        const result = await deleteWeChatGroupMemory({
          groupId: body.group_id || body.groupId || url.searchParams.get('group_id') || url.searchParams.get('groupId'),
          kind: body.kind || url.searchParams.get('kind'),
          itemId: body.item_id || body.itemId || url.searchParams.get('item_id') || url.searchParams.get('itemId'),
          observerId: body.observer_id || body.observerId || url.searchParams.get('observer_id') || url.searchParams.get('observerId'),
          observedId: body.observed_id || body.observedId || url.searchParams.get('observed_id') || url.searchParams.get('observedId'),
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // ── External knowledge base console ──
    if (req.method === 'GET' && url.pathname === '/knowledge/status') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      try { return jsonResponse(res, 200, await getKnowledgeStatus()) }
      catch (err) { return jsonResponse(res, 500, { ok: false, error: err.message }) }
    }

    if (req.method === 'GET' && url.pathname === '/knowledge/sources') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      try {
        return jsonResponse(res, 200, {
          ok: true,
          items: listKnowledgeSources({
            status: url.searchParams.get('status') || '',
            type: url.searchParams.get('type') || '',
            groupId: url.searchParams.get('group_id') || url.searchParams.get('groupId') || '',
            q: url.searchParams.get('q') || '',
            limit: url.searchParams.get('limit') || 120,
          }),
        })
      } catch (err) { return jsonResponse(res, 500, { ok: false, error: err.message }) }
    }

    if (req.method === 'GET' && url.pathname === '/knowledge/search') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      try {
        return jsonResponse(res, 200, await searchKnowledge({
          q: url.searchParams.get('q') || '',
          groupId: url.searchParams.get('group_id') || url.searchParams.get('groupId') || '',
          limit: url.searchParams.get('limit') || 12,
        }))
      } catch (err) { return jsonResponse(res, 500, { ok: false, error: err.message, items: [] }) }
    }

    if (req.method === 'POST' && url.pathname === '/knowledge/import/parse') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req)
        return jsonResponse(res, 200, await parseKnowledgeImport(body))
      } catch (err) { return jsonResponse(res, 400, { ok: false, error: err.message, previews: [] }) }
    }

    if (req.method === 'POST' && url.pathname === '/knowledge/import/commit') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req)
        return jsonResponse(res, 200, await commitKnowledgeImport(body))
      } catch (err) { return jsonResponse(res, 400, { ok: false, error: err.message }) }
    }

    const knowledgeSourceMatch = url.pathname.match(/^\/knowledge\/sources\/(\d+)(?:\/(reparse))?$/)
    if (knowledgeSourceMatch) {
      if (req.method === 'POST' && knowledgeSourceMatch[2] === 'reparse') {
        if (!requireLocalOrToken(req, res, url)) return
        try { return jsonResponse(res, 200, await reparseKnowledgeSource({ id: knowledgeSourceMatch[1] })) }
        catch (err) { return jsonResponse(res, 400, { ok: false, error: err.message }) }
      }
      if (req.method === 'PATCH' && !knowledgeSourceMatch[2]) {
        if (!requireLocalOrToken(req, res, url)) return
        try {
          const body = await readJsonBody(req)
          return jsonResponse(res, 200, await updateKnowledgeSource({ id: knowledgeSourceMatch[1], ...body }))
        } catch (err) { return jsonResponse(res, 400, { ok: false, error: err.message }) }
      }
      if (req.method === 'DELETE' && !knowledgeSourceMatch[2]) {
        if (!requireLocalOrToken(req, res, url)) return
        try { return jsonResponse(res, 200, deleteKnowledgeSource({ id: knowledgeSourceMatch[1] })) }
        catch (err) { return jsonResponse(res, 400, { ok: false, error: err.message }) }
      }
    }

    // GET /social/wechat-groups/summary?group_id=xxx&limit=100&hours=24
    // 本地抽取式总结：不额外调用大模型，适合作为自检/快速查看。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/summary') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const rawGroupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      const groupExternalId = rawGroupId.startsWith('wechat:clawbot-group:') ? rawGroupId : makeWeChatGroupExternalId(rawGroupId)
      if (!groupExternalId) return jsonResponse(res, 400, { ok: false, error: 'group_id required' })
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 300)
      const hours = Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 30)
      const messages = getRecentWeChatGroupMessages(groupExternalId, { limit, hours })
      return jsonResponse(res, 200, {
        ok: true,
        group_id: groupExternalId,
        channel: WECHAT_GROUP_CHANNEL,
        count: messages.length,
        summary: buildWeChatGroupSummary(messages),
        messages,
      })
    }

    // GET /social/wechat-groups/report/templates — 群战报 HTML/CSS 模板列表。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/report/templates') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, templates: WECHAT_GROUP_REPORT_TEMPLATES, current: getWeChatGroupDigestConfig().reportTemplate })
    }

    // GET /social/wechat-groups/report/html?group_id=xxx&template=guochao-red-gold
    // 生成当前群统计的 HTML/CSS 战报预览；前端 iframe 用它做模板切换预览。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/report/html') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const rawGroupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      if (!rawGroupId) return jsonResponse(res, 400, { ok: false, error: 'group_id required' })
      const stats = getWeChatGroupStats({
        groupId: rawGroupId,
        groupName: url.searchParams.get('group_name') || url.searchParams.get('groupName') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        hours: Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 90),
        range: url.searchParams.get('range') || 'today',
        limit: Math.min(parseInt(url.searchParams.get('limit') || '10'), 30),
      })
      if (!stats.ok) return jsonResponse(res, 400, stats)
      const template = normalizeWeChatGroupReportTemplate(url.searchParams.get('template') || getWeChatGroupDigestConfig().reportTemplate)
      const html = renderWeChatGroupStatsPosterHtml(stats, { templateId: template })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(html)
      return
    }

    // GET /social/wechat-groups/stats?group_id=xxx&range=today
    // 群活动统计：文字/图片/表情/链接/装逼榜等，用于设置页和定时日报。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/stats') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const rawGroupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      if (!rawGroupId) return jsonResponse(res, 400, { ok: false, error: 'group_id required' })
      const hours = Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 90)
      const range = url.searchParams.get('range') || ''
      const from = url.searchParams.get('from') || ''
      const to = url.searchParams.get('to') || ''
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 30)
      const groupName = url.searchParams.get('group_name') || url.searchParams.get('groupName') || ''
      return jsonResponse(res, 200, getWeChatGroupStats({ groupId: rawGroupId, groupName, from, to, hours, range, limit }))
    }

    // GET /social/wechat-groups/members?group_id=xxx
    // 微信群成员昵称/ID 列表：用于管理员模式精确选择微信 sender_id，不使用昵称授权。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/members') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const result = listWeChatGroupMembers({
        groupId: url.searchParams.get('group_id') || url.searchParams.get('groupId') || '',
        groupName: url.searchParams.get('group_name') || url.searchParams.get('groupName') || '',
        q: url.searchParams.get('q') || '',
        limit: Math.min(parseInt(url.searchParams.get('limit') || '1000'), 20000),
      })
      return jsonResponse(res, 200, result)
    }


    // GET /social/wechat-groups/records?group_id=xxx&from=2026-05-26&to=2026-05-28&q=xxx
    // 群聊天记录库：按时间/关键词/类型分页查看已经入库的全量消息。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/records') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const rawGroupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      if (!rawGroupId) return jsonResponse(res, 400, { ok: false, error: 'group_id required' })
      const result = listWeChatGroupActivityRecords({
        groupId: rawGroupId,
        groupName: url.searchParams.get('group_name') || url.searchParams.get('groupName') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        hours: Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 365),
        range: url.searchParams.get('range') || '',
        limit: Math.min(parseInt(url.searchParams.get('limit') || '80'), 500),
        offset: Math.max(parseInt(url.searchParams.get('offset') || '0'), 0),
        q: url.searchParams.get('q') || '',
        type: url.searchParams.get('type') || '',
      })
      return jsonResponse(res, result.ok ? 200 : 400, result)
    }

    // GET /social/wechat-groups/records/media?path=data/wechat-media/...
    // 群聊天记录媒体预览：只允许读取已经保存到本机数据目录下的相对媒体路径。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/records/media') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const result = resolveWeChatGroupMediaFile(url.searchParams.get('path') || '')
      if (!result.ok) return jsonResponse(res, 404, result)
      res.writeHead(200, {
        'Content-Type': result.content_type || contentTypeFor(result.filePath),
        'Content-Length': String(result.bytes || 0),
        'Content-Disposition': `inline; filename="${encodeURIComponent(result.file_name || 'media')}"`,
        'Cache-Control': 'private, max-age=3600',
      })
      fs.createReadStream(result.filePath).pipe(res)
      return
    }

    // GET /social/wechat-groups/images — 微信群图片解析库：缩略图、识图状态、描述、筛选。
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/images') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const result = listWeChatImageMediaItems({
        groupId: url.searchParams.get('group_id') || url.searchParams.get('groupId') || '',
        groupName: url.searchParams.get('group_name') || url.searchParams.get('groupName') || '',
        q: url.searchParams.get('q') || '',
        sender: url.searchParams.get('sender') || '',
        status: url.searchParams.get('status') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        limit: Math.min(parseInt(url.searchParams.get('limit') || '60'), 200),
        offset: Math.max(parseInt(url.searchParams.get('offset') || '0'), 0),
      })
      return jsonResponse(res, result.ok ? 200 : 400, result)
    }

    // POST /social/wechat-groups/images/describe-pending — 后台补解析待处理图片，立即返回不阻塞 UI。
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/images/describe-pending') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const result = startWeChatImageBackgroundDescribe({
          groupId: body.group_id || body.groupId || '',
          groupName: body.group_name || body.groupName || '',
          limit: Math.min(parseInt(body.limit || '5'), 30),
          retryErrors: body.retryErrors !== false,
        })
        jsonResponse(res, 200, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechat-groups/images/update — 编辑已入库图片的识图描述/标签。
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/images/update') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const result = updateWeChatImageMediaItem({
          id: body.id,
          description: body.description || '',
          labels: body.labels || body.labels_json || [],
          visionStatus: body.vision_status || body.visionStatus || 'done',
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechat-groups/images/delete — 删除图片库记录，并默认删除对应本地微信图片文件。
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/images/delete') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const result = deleteWeChatImageMediaItem({
          id: body.id,
          deleteFile: body.deleteFile !== false,
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // GET /social/wechat-groups/records/export?group_id=xxx&format=json|csv
    if (req.method === 'GET' && url.pathname === '/social/wechat-groups/records/export') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const rawGroupId = url.searchParams.get('group_id') || url.searchParams.get('groupId') || ''
      if (!rawGroupId) return jsonResponse(res, 400, { ok: false, error: 'group_id required' })
      const result = buildWeChatGroupActivityExport({
        groupId: rawGroupId,
        groupName: url.searchParams.get('group_name') || url.searchParams.get('groupName') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        hours: Math.min(parseInt(url.searchParams.get('hours') || '24'), 24 * 365),
        range: url.searchParams.get('range') || '',
        q: url.searchParams.get('q') || '',
        type: url.searchParams.get('type') || '',
        format: url.searchParams.get('format') || 'json',
      })
      if (!result.ok) return jsonResponse(res, 400, result)
      res.writeHead(200, {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      })
      res.end(result.body)
      return
    }

    // POST /social/wechat-groups/records/import — 导入 JSON 记录，适合备份恢复。
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/records/import') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const result = importWeChatGroupActivityRecords({
          groupId: body.group_id || body.groupId,
          groupName: body.group_name || body.groupName || '',
          records: Array.isArray(body.records) ? body.records : (Array.isArray(body) ? body : []),
          mediaFiles: body.mediaFiles || body.media_files || [],
        })
        jsonResponse(res, result.ok ? 200 : 400, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /social/wechat-groups/digest/send — 手动发送当前群统计总结，方便设置页验证。
    if (req.method === 'POST' && url.pathname === '/social/wechat-groups/digest/send') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        const result = await sendWeChatGroupDigestNow({
          groupId: body.group_id || body.groupId,
          groupName: body.group_name || body.groupName,
          roomId: body.room_id || body.roomId,
          mode: body.mode || 'interval',
        })
        jsonResponse(res, result.ok ? 200 : 409, result)
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    if (isSocialWebhookPath(url.pathname)) {
      return handleSocialWebhook(req, res, url)
    }

    if (origin && !isAllowedOrigin(origin)) {
      return jsonResponse(res, 403, { ok: false, error: 'forbidden origin' })
    }

    if (!hasAllowedAccess(req, url)) {
      return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
    }

    if (isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || 'null')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method !== 'OPTIONS' && isSensitivePath(url.pathname) && !requireLocalOrToken(req, res, url)) return

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // POST /message — send message to agent
    if (req.method === 'POST' && url.pathname === '/message') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          const { from_id = 'ID:000001', content, channel = 'API', voice_turn_id = null, voiceTurnId = null } = JSON.parse(body)
          if (!content?.trim()) return jsonResponse(res, 400, { error: 'content required' })
          const trimmed = content.trim()
          const resolvedVoiceTurnId = voice_turn_id || voiceTurnId || null
          pushMessage(from_id, trimmed, channel, resolvedVoiceTurnId ? { voiceTurnId: resolvedVoiceTurnId } : {})
          emitEvent('message_in', { from_id, content: trimmed, channel, voiceTurnId: resolvedVoiceTurnId, timestamp: new Date().toISOString() })
          jsonResponse(res, 200, { ok: true, agent_name: getAgentName() })
        } catch (e) {
          jsonResponse(res, 400, { error: e.message })
        }
      })
      return
    }

    // GET /events — SSE real-time event stream (outbound channel for bidirectional communication)
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`)
      flushStickyEvents(res)
      addSSEClient(res)
      const keepAlive = setInterval(() => {
        try { res.write(': ping\n\n') } catch (_) { clearInterval(keepAlive); removeSSEClient(res) }
      }, 15000)
      req.on('close', () => {
        clearInterval(keepAlive)
        removeSSEClient(res)
      })
      return
    }

    // GET /memories?limit=20&search=keyword
    if (req.method === 'GET' && url.pathname === '/memories') {
      const db = getDB()
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const search = url.searchParams.get('search')
      let rows
      if (search) {
        try {
          rows = db.prepare(`
            SELECT m.* FROM memories m
            JOIN memories_fts ON memories_fts.rowid = m.id
            WHERE memories_fts MATCH ?
            ORDER BY bm25(memories_fts), m.created_at DESC LIMIT ?
          `).all(search, limit)
        } catch {
          rows = db.prepare(`SELECT * FROM memories WHERE content LIKE ? OR detail LIKE ? ORDER BY created_at DESC LIMIT ?`)
            .all(`%${search}%`, `%${search}%`, limit)
        }
      } else {
        rows = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit)
      }
      jsonResponse(res, 200, rows)
      return
    }

    // GET /conversations?limit=60 — chat history (ascending by time, most recent last)
    // Admin/debug endpoint: returns FULL history including focus_absorbed rows.
    // The absorbed flag (dynamic memory pool 3.5) only filters main-line injection
    // in injector.js; here the operator needs to see everything for debugging.
    if (req.method === 'GET' && url.pathname === '/conversations') {
      const db = getDB()
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '60'), 500)
      const rows = db.prepare(`
        SELECT id, role, from_id, to_id, content, timestamp, channel, external_party_id, focus_absorbed
        FROM conversations
        ORDER BY id DESC
        LIMIT ?
      `).all(limit)
      jsonResponse(res, 200, rows.reverse().map(row => (
        row.role === 'jarvis'
          ? { ...row, content: stripAssistantHistoryLabels(row.content) }
          : row
      )))
      return
    }

    // GET /status
    if (req.method === 'GET' && url.pathname === '/status') {
      const db = getDB()
      const { n } = db.prepare('SELECT COUNT(*) as n FROM memories').get()
      jsonResponse(res, 200, { ok: true, memory_count: n, running: isRunning() })
      return
    }

    // GET /quota
    if (req.method === 'GET' && url.pathname === '/quota') {
      jsonResponse(res, 200, getQuotaStatus())
      return
    }

    // GET /hotspots — unified trending data, 30-minute cache by default
    if (req.method === 'GET' && url.pathname === '/hotspots') {
      getHotspots({
        force: /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || ''),
        viewed: /^(1|true|yes)$/i.test(url.searchParams.get('viewed') || ''),
      })
        .then((hotspots) => jsonResponse(res, 200, hotspots))
        .catch((err) => jsonResponse(res, 502, {
          ok: false,
          error: err.message,
          refreshMinutes: 30,
          platforms: {},
        }))
      return
    }

    if (url.pathname === '/hotspot-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getHotspotPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setHotspotPanelState({ active, source: body.source || 'brain-ui' })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    // GET /doc-panel-state — document panel state
    // POST /doc-panel-state — set document panel state { active, topicId, source }
    if (url.pathname === '/doc-panel-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getDocPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setDocPanelState({ active, topicId: body.topicId || null, source: body.source || 'brain-ui' })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    // GET /docs/:topicId — get content for a specific document topic
    if (req.method === 'GET' && url.pathname.startsWith('/docs/')) {
      const topicId = url.pathname.slice(6)
      const doc = DOC_TOPICS[topicId]
      if (!doc) {
        jsonResponse(res, 404, { ok: false, error: `unknown topic: ${topicId}` })
        return
      }
      jsonResponse(res, 200, { ok: true, doc })
      return
    }

    // GET /docs — list all document topics
    if (req.method === 'GET' && url.pathname === '/docs') {
      const topics = Object.values(DOC_TOPICS).map(({ id, title, subtitle, icon, summary }) => ({ id, title, subtitle, icon, summary }))
      jsonResponse(res, 200, { ok: true, topics })
      return
    }

    if (req.method === 'GET' && url.pathname === '/person-card') {
      const name = url.searchParams.get('name') || url.searchParams.get('q') || ''
      jsonResponse(res, 200, { ok: true, card: getPersonCard(name) })
      return
    }

    if (url.pathname === '/person-card-state') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, { ok: true, state: getPersonCardPanelState() })
        return
      }
      if (req.method === 'POST') {
        readJsonBody(req)
          .then((body) => {
            const active = typeof body.active === 'boolean'
              ? body.active
              : /^(1|true|yes|open|show)$/i.test(String(body.active || ''))
            const state = setPersonCardPanelState({
              active,
              source: body.source || 'brain-ui',
              card: body.card || null,
              name: body.name || '',
            })
            jsonResponse(res, 200, { ok: true, state })
          })
          .catch((err) => jsonResponse(res, 400, { ok: false, error: err.message }))
        return
      }
    }

    if (req.method === 'GET' && url.pathname === '/system-prompt-preview') {
      Promise.resolve()
        .then(() => buildHeartbeatSystemPromptPreview({
          stateSnapshot: typeof getStateSnapshot === 'function' ? getStateSnapshot() : {},
        }))
        .then((preview) => jsonResponse(res, 200, preview))
        .catch((err) => jsonResponse(res, 500, { error: err.message }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/agent-profile') {
      jsonResponse(res, 200, { name: getAgentName() })
      return
    }

    // GET /media/history?limit=30
    if (req.method === 'GET' && url.pathname === '/media/history') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
      jsonResponse(res, 200, getMediaHistory(limit))
      return
    }

    // POST /media/history — { kind, url, title, videoId, platform }
    if (req.method === 'POST' && url.pathname === '/media/history') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          if (!body.url || !body.kind) return jsonResponse(res, 400, { ok: false, error: 'url and kind required' })
          upsertMediaHistory(body)
          jsonResponse(res, 200, { ok: true })
        } catch (e) {
          jsonResponse(res, 400, { ok: false, error: e.message })
        }
      })
      return
    }

    // GET /favicon.ico ? silence the browser's automatic favicon request
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }

    // DELETE /memories/:id — delete a memory
    if (req.method === 'DELETE' && url.pathname.startsWith('/memories/')) {
      const id = parseInt(url.pathname.split('/')[2])
      if (!id) return jsonResponse(res, 400, { error: 'invalid id' })
      const db = getDB()
      db.prepare('DELETE FROM memories WHERE id = ?').run(id)
      jsonResponse(res, 200, { ok: true })
      return
    }

    // PATCH /memories/:id — update memory content/detail
    if (req.method === 'PATCH' && url.pathname.startsWith('/memories/')) {
      const id = parseInt(url.pathname.split('/')[2])
      if (!id) return jsonResponse(res, 400, { error: 'invalid id' })
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { content, detail } = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const db = getDB()
          if (content !== undefined) db.prepare('UPDATE memories SET content = ? WHERE id = ?').run(content, id)
          if (detail !== undefined) db.prepare('UPDATE memories SET detail = ? WHERE id = ?').run(detail, id)
          jsonResponse(res, 200, { ok: true })
        } catch (e) {
          jsonResponse(res, 400, { error: e.message })
        }
      })
      return
    }

    // GET /media/music/:filename — serve musicDir audio files (avoids file:// cross-origin restriction)
    if (req.method === 'GET' && url.pathname.startsWith('/media/music/')) {
      const raw = url.pathname.slice('/media/music/'.length)
      const filename = path.basename(decodeURIComponent(raw))
      const filePath = path.join(paths.musicDir, filename)
      const resolvedFile = path.resolve(filePath)
      const resolvedDir  = path.resolve(paths.musicDir)
      if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
        res.writeHead(403); res.end('forbidden'); return
      }
      const mimeMap = {
        '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
        '.aac': 'audio/aac',  '.ogg': 'audio/ogg',   '.m4a': 'audio/mp4',
        '.opus': 'audio/ogg; codecs=opus',
      }
      const contentType = mimeMap[path.extname(filename).toLowerCase()] || 'audio/mpeg'
      try {
        const stat = fs.statSync(filePath)
        const total = stat.size
        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
          const start = m[1] ? parseInt(m[1]) : 0
          const end   = m[2] ? parseInt(m[2]) : total - 1
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath).pipe(res)
        }
      } catch {
        res.writeHead(404); res.end('music file not found')
      }
      return
    }

    // GET /media/video?path=/absolute/video.mp4 — serve local video files for the Electron UI.
    // This avoids file:// playback restrictions while keeping the endpoint video-only.
    if (req.method === 'GET' && url.pathname === '/media/video') {
      const rawPath = url.searchParams.get('path') || ''
      const filePath = path.resolve(rawPath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeMap = {
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.ogv': 'video/ogg',
        '.ogg': 'video/ogg',
      }
      const contentType = mimeMap[ext]
      if (!rawPath || !contentType) {
        res.writeHead(400)
        res.end('unsupported or missing video path')
        return
      }
      try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) throw new Error('not a file')
        const total = stat.size
        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
          const start = m?.[1] ? parseInt(m[1], 10) : 0
          const end = m?.[2] ? parseInt(m[2], 10) : total - 1
          if (start >= total || end >= total || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${total}` })
            res.end()
            return
          }
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          })
          fs.createReadStream(filePath).pipe(res)
        }
      } catch {
        res.writeHead(404)
        res.end('video file not found')
      }
      return
    }

    // GET /audio/:filename — serve sandbox audio files
    if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
      const filename = path.basename(url.pathname)
      const filePath = path.join(SANDBOX_PATH, 'audio', filename)
      try {
        const stat = fs.statSync(filePath)
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
        })
        fs.createReadStream(filePath).pipe(res)
      } catch {
        res.writeHead(404)
        res.end('audio not found')
      }
      return
    }

    // GET /activation-status — check whether the system is activated
    if (req.method === 'GET' && url.pathname === '/activation-status') {
      jsonResponse(res, 200, getActivationStatus())
      return
    }

    // POST /activate — submit API key to complete activation
    if (req.method === 'POST' && url.pathname === '/activate') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          const { apiKey, model, provider, baseURL, agentName } = JSON.parse(body || '{}')

          const trimmedName = String(agentName || '').trim()
          if (trimmedName) {
            if (trimmedName.length > 32) {
              return jsonResponse(res, 400, { ok: false, error: 'AI 名字不能超过 32 个字符' })
            }
            if (!/^[一-龥A-Za-z0-9 _-]+$/.test(trimmedName)) {
              return jsonResponse(res, 400, { ok: false, error: 'AI 名字只允许中文、英文字母、数字、空格、下划线、短横线' })
            }
          }

          const info = await activateLLM({ provider, apiKey, model, baseURL })

          if (trimmedName) {
            try {
              setConfig('agent_name', trimmedName)
              setStickyEvent('agent_name_updated', { name: trimmedName })
              emitEvent('agent_name_updated', { name: trimmedName })
            } catch (err) {
              console.error('[API] save agent_name failed:', err)
            }
          }

          emitEvent('activated', info)
          // Notify index.js to start the main loop
          if (typeof onActivatedCallback === 'function') {
            try { onActivatedCallback() } catch (err) { console.error('[API] onActivated callback error:', err) }
          }
          jsonResponse(res, 200, { ok: true, ...info, agent_name: getAgentName() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/database/export — export local chat/memory database as JSON
    if (req.method === 'GET' && url.pathname === '/settings/database/export') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, exportDatabaseData())
    }

    // POST /settings/database/import — import local chat/memory database JSON
    if (req.method === 'POST' && url.pathname === '/settings/database/import') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const payload = await readJsonBody(req)
        return jsonResponse(res, 200, importDatabaseData(payload))
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/database/backfill-vectors — repair local vector index for core/group memory
    if (req.method === 'POST' && url.pathname === '/settings/database/backfill-vectors') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req).catch(() => ({}))
        return jsonResponse(res, 200, backfillDatabaseVectors({ limit: body.limit || url.searchParams.get('limit') || 5000 }))
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/database/sync-honcho — push local WeChat message history into Honcho
    if (req.method === 'POST' && url.pathname === '/settings/database/sync-honcho') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req).catch(() => ({}))
        const result = await syncLocalWeChatMessagesToHoncho({ limit: body.limit || url.searchParams.get('limit') || 1200 })
        return jsonResponse(res, 200, result)
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/database/extract-wechat-memories — extract durable per-group/member facts from stored group chat
    if (req.method === 'POST' && url.pathname === '/settings/database/extract-wechat-memories') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req).catch(() => ({}))
        const result = await backfillWeChatExplicitMemoriesFromMessages({ limit: body.limit || url.searchParams.get('limit') || 5000, archiveMessages: body.archiveMessages !== false })
        return jsonResponse(res, 200, result)
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // GET /settings/database/search?q=... — hybrid keyword/vector search over local chat and memories
    if (req.method === 'GET' && url.pathname === '/settings/database/search') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, searchDatabaseData({
        q: url.searchParams.get('q') || '',
        groupId: url.searchParams.get('group_id') || url.searchParams.get('groupId') || '',
        groupName: url.searchParams.get('group_name') || url.searchParams.get('groupName') || '',
        limit: url.searchParams.get('limit') || 30,
      }))
    }

    // GET /settings/database — local database and knowledge storage overview
    if (req.method === 'GET' && url.pathname === '/settings/database') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, await getDatabaseOverview())
    }

    // GET /settings — return current LLM + MiniMax configuration status
    if (req.method === 'GET' && url.pathname === '/settings') {
      const status = getActivationStatus()
      const minimaxKey = getMinimaxKey()
      jsonResponse(res, 200, {
        llm: {
          activated: status.activated,
          provider: status.provider,
          model: status.model,
          baseURL: status.baseURL,
          models: status.models,
          temperature: config.temperature,
          activeProfileId: status.activeProfileId,
          profiles: status.profiles,
          failover: status.failover,
          connectivityMonitor: getLLMConnectivityMonitorConfig(),
          connectivityMonitorStatus: getLLMConnectivityMonitorStatus(),
        },
        hotspotAlerts: {
          config: getHotspotAlertConfig(),
          status: getHotspotAlertStatus(),
        },
        providers: getProviderSummaries(),
        minimax: {
          configured: !!(globalThis.process?.env?.MINIMAX_API_KEY || minimaxKey),
        },
      })
      return
    }

    // POST /settings/model — switch model only (no need to re-enter the key)
    if (req.method === 'POST' && url.pathname === '/settings/model') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { model } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = switchModel(model)
          emitEvent('model_switched', result)
          jsonResponse(res, 200, { ok: true, ...result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/llm-profile — create/update one model in the failover pool
    if (req.method === 'POST' && url.pathname === '/settings/llm-profile') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = await upsertLLMProfile(body)
          const status = getActivationStatus()
          emitEvent('llm_profiles_updated', { activeProfileId: status.activeProfileId, profiles: status.profiles, failover: status.failover })
          jsonResponse(res, 200, { ok: true, ...result, llm: status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/llm-profile/select — make a saved model the current one
    if (req.method === 'POST' && url.pathname === '/settings/llm-profile/select') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { id } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const profile = selectLLMProfile(id, { persist: true, reason: 'manual' })
          const status = getActivationStatus()
          emitEvent('model_switched', { provider: status.provider, model: status.model, profile })
          emitEvent('llm_profiles_updated', { activeProfileId: status.activeProfileId, profiles: status.profiles, failover: status.failover })
          jsonResponse(res, 200, { ok: true, profile, llm: status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/llm-profile/test — test connectivity for one saved model
    if (req.method === 'POST' && url.pathname === '/settings/llm-profile/test') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const { id } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = await testLLMProfileConnection(id)
          const status = getActivationStatus()
          emitEvent('llm_profiles_updated', { activeProfileId: status.activeProfileId, profiles: status.profiles, failover: status.failover })
          jsonResponse(res, 200, { ...result, llm: status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/llm-profile/delete — remove one saved model from the pool
    if (req.method === 'POST' && url.pathname === '/settings/llm-profile/delete') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { id } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = deleteLLMProfile(id)
          const status = getActivationStatus()
          emitEvent('llm_profiles_updated', { activeProfileId: status.activeProfileId, profiles: status.profiles, failover: status.failover })
          jsonResponse(res, 200, { ok: true, ...result, llm: status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/llm-failover — update automatic model failover policy
    if (req.method === 'POST' && url.pathname === '/settings/llm-failover') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const failover = setLLMFailoverConfig(body)
          const status = getActivationStatus()
          emitEvent('llm_profiles_updated', { activeProfileId: status.activeProfileId, profiles: status.profiles, failover })
          jsonResponse(res, 200, { ok: true, failover, llm: status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/llm-connectivity-monitor — read LLM channel connectivity notification config/status
    if (req.method === 'GET' && url.pathname === '/settings/llm-connectivity-monitor') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const status = getActivationStatus()
      return jsonResponse(res, 200, {
        ok: true,
        config: getLLMConnectivityMonitorConfig(),
        status: getLLMConnectivityMonitorStatus(),
        profiles: status.profiles,
        wechatyDutyGroupStatus: getWechatyDutyGroupStatus(),
      })
    }

    // POST /settings/llm-connectivity-monitor — save LLM channel connectivity notification config
    if (req.method === 'POST' && url.pathname === '/settings/llm-connectivity-monitor') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req)
        const cfg = setLLMConnectivityMonitorConfig(body || {})
        startLLMConnectivityMonitorScheduler()
        return jsonResponse(res, 200, { ok: true, config: cfg, status: getLLMConnectivityMonitorStatus() })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/llm-connectivity-monitor/check — run an immediate check, optionally notifying configured groups
    if (req.method === 'POST' && url.pathname === '/settings/llm-connectivity-monitor/check') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req).catch(() => ({}))
        const result = await runLLMConnectivityMonitorCheck({ notify: body.notify === true, forceNotify: body.forceNotify === true || body.notify === true })
        const status = getActivationStatus()
        emitEvent('llm_connectivity_checked', { profiles: status.profiles, result })
        emitEvent('llm_profiles_updated', { activeProfileId: status.activeProfileId, profiles: status.profiles, failover: status.failover })
        return jsonResponse(res, 200, { ...result, profiles: status.profiles })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // GET /settings/hotspot-alerts — 读取舆情变动微信群推送配置和运行状态
    if (req.method === 'GET' && url.pathname === '/settings/hotspot-alerts') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, {
        ok: true,
        config: getHotspotAlertConfig(),
        status: getHotspotAlertStatus(),
        wechatyDutyGroupStatus: getWechatyDutyGroupStatus(),
      })
    }

    // POST /settings/hotspot-alerts — 保存舆情变动微信群推送配置
    if (req.method === 'POST' && url.pathname === '/settings/hotspot-alerts') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req)
        const cfg = setHotspotAlertConfig(body || {})
        startHotspotAlertScheduler()
        return jsonResponse(res, 200, {
          ok: true,
          config: cfg,
          status: getHotspotAlertStatus(),
          wechatyDutyGroupStatus: getWechatyDutyGroupStatus(),
        })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/hotspot-alerts/check — 手动检查舆情变化，可选择立即通知已配置微信群
    if (req.method === 'POST' && url.pathname === '/settings/hotspot-alerts/check') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const body = await readJsonBody(req).catch(() => ({}))
        const result = await runHotspotAlertCheck({
          notify: body.notify === true,
          forceNotify: body.forceNotify === true || body.force_notify === true,
        })
        emitEvent('hotspot_alert_checked', { result })
        return jsonResponse(res, 200, {
          ...result,
          config: getHotspotAlertConfig(),
          status: getHotspotAlertStatus(),
          wechatyDutyGroupStatus: getWechatyDutyGroupStatus(),
        })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/temperature — set LLM temperature
    if (req.method === 'POST' && url.pathname === '/settings/temperature') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { temperature } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = setTemperature(temperature)
          jsonResponse(res, 200, { ok: true, ...result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/security — read security sandbox configuration
    if (req.method === 'GET' && url.pathname === '/settings/security') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      jsonResponse(res, 200, { ok: true, security: getSecurity() })
      return
    }

    // POST /settings/security — save security sandbox configuration
    if (req.method === 'POST' && url.pathname === '/settings/security') {
      if (!requireLocalOrToken(req, res, url)) return
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const updates = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const result = setSecurity(updates)
          jsonResponse(res, 200, { ok: true, security: result })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }


    // GET/POST /social/meme/search — test/search public meme image/GIF URLs
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/social/meme/search') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      const body = req.method === 'POST' ? await readJsonBody(req).catch(() => ({})) : {}
      const query = body.query || url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('msg') || ''
      const count = body.count || url.searchParams.get('count') || url.searchParams.get('num') || undefined
      const page = body.page || url.searchParams.get('page') || undefined
      const result = await searchMemes({ query, count, page })
      return jsonResponse(res, result.ok ? 200 : 400, result)
    }

    // POST /settings/wechat-meme — save WeChat meme/sticker settings
    if (req.method === 'POST' && url.pathname === '/settings/wechat-meme') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const updates = await readJsonBody(req)
        return jsonResponse(res, 200, { ok: true, wechatMeme: setWechatMemeConfig(updates) })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // GET /settings/skills — read skill configuration status (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/skills') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, skills: getSkillsConfig() })
    }

    // POST /settings/skills/image-generation — save image generation skill settings
    if (req.method === 'POST' && url.pathname === '/settings/skills/image-generation') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const updates = await readJsonBody(req)
        return jsonResponse(res, 200, { ok: true, imageGeneration: setSkillImageConfig(updates) })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/skills/image-vision — save WeChat image understanding settings
    if (req.method === 'POST' && url.pathname === '/settings/skills/image-vision') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const updates = await readJsonBody(req)
        return jsonResponse(res, 200, { ok: true, imageVision: setSkillImageVisionConfig(updates), status: getWeChatImageVisionStatus() })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/skills/video-analysis — save WeChat video analysis settings
    if (req.method === 'POST' && url.pathname === '/settings/skills/video-analysis') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const updates = await readJsonBody(req)
        return jsonResponse(res, 200, { ok: true, videoAnalysis: setSkillVideoAnalysisConfig(updates), status: getWeChatVideoAnalysisStatus() })
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/skills/test-channel — test an OpenAI-compatible skill model channel
    if (req.method === 'POST' && url.pathname === '/settings/skills/test-channel') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const payload = await readJsonBody(req)
        return jsonResponse(res, 200, await testSkillModelChannel(payload))
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // POST /settings/skills/models — fetch the real /models list for one skill channel
    if (req.method === 'POST' && url.pathname === '/settings/skills/models') {
      if (!requireLocalOrToken(req, res, url)) return
      try {
        const payload = await readJsonBody(req)
        return jsonResponse(res, 200, await listSkillModelChannelModels(payload))
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: err.message })
      }
    }

    // GET /settings/skills/image-vision/status — show real image vision runtime and DB counts
    if (req.method === 'GET' && url.pathname === '/settings/skills/image-vision/status') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, status: getWeChatImageVisionStatus() })
    }

    // GET /settings/skills/video-analysis/status — show video analysis runtime and temp cleanup state
    if (req.method === 'GET' && url.pathname === '/settings/skills/video-analysis/status') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, status: getWeChatVideoAnalysisStatus() })
    }

    // GET /settings/social — read per-platform configuration status (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/social') {
      jsonResponse(res, 200, { ok: true, social: getSocialConfig(), wechatyDutyGroup: getWechatyDutyGroupConfig(), wechatyDutyGroupStatus: getWechatyDutyGroupStatus(), wechatyPersonaPresets: WECHATY_PERSONA_PRESETS, honcho: getHonchoConfig(), honchoStatus: getWeChatGroupMemoryStatus(), wechatGroupDigest: getWeChatGroupDigestConfig(), wechatMeme: getWechatMemeConfig(), guardRules: getWeChatCommandGuardRules() })
      return
    }

    // POST /settings/social — save platform credentials and hot-restart affected connectors
    if (req.method === 'POST' && url.pathname === '/settings/social') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const updates = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setSocialConfig(updates)
          // Restart the connector for each platform whose key was updated
          const PLATFORM_KEYS = {
            discord: ['DISCORD_BOT_TOKEN'],
          }
          for (const [platform, keys] of Object.entries(PLATFORM_KEYS)) {
            if (keys.some(k => updates[k])) {
              restartConnector(platform, { pushMessage, emitEvent }).catch(err =>
                console.warn(`[social] restart ${platform} failed:`, err.message)
              )
            }
          }
          // Restart the ClawBot connector when the user clicks "Connect WeChat"
          if (updates._clawbot_connect) {
            restartConnector('wechat-clawbot', { pushMessage, emitEvent }).catch(err =>
              console.warn('[social] restart wechat-clawbot failed:', err.message)
            )
          }
          jsonResponse(res, 200, { ok: true, social: getSocialConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /settings/wechat-groups/honcho — 保存 Honcho 群知识库配置
    if (req.method === 'POST' && url.pathname === '/settings/wechat-groups/honcho') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        try {
          const honcho = setHonchoConfig({
            enabled: body.enabled,
            apiKey: body.apiKey,
            environment: body.environment,
            baseURL: body.baseURL,
            appId: body.appId,
            appName: body.appName,
          })
          jsonResponse(res, 200, { ok: true, honcho, honchoStatus: getWeChatGroupMemoryStatus() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // GET /settings/wechat-groups/digest — 读取微信群统计/定时总结配置
    if (req.method === 'GET' && url.pathname === '/settings/wechat-groups/digest') {
      if (!hasAllowedAccess(req, url)) return jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return jsonResponse(res, 200, { ok: true, digest: getWeChatGroupDigestConfig() })
    }

    // POST /settings/wechat-groups/digest — 保存微信群统计/定时总结配置
    if (req.method === 'POST' && url.pathname === '/settings/wechat-groups/digest') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(body => {
        const digest = setWeChatGroupDigestConfig(body || {})
        jsonResponse(res, 200, { ok: true, digest })
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /settings/social/wechaty-duty-group — 保存微信群助手开关和多选群组，并按需热重启
    if (req.method === 'POST' && url.pathname === '/settings/social/wechaty-duty-group') {
      if (!requireLocalOrToken(req, res, url)) return
      readJsonBody(req).then(async body => {
        try {
          const keys = Object.keys(body || {})
          const onlyOfflineQrNotify = keys.length > 0 && keys.every(key => [
            'offline_qr_notify',
            'offlineQrNotify',
            'offline_qr_notify_enabled',
            'offlineQrNotifyEnabled',
          ].includes(key))
          const updates = {
            enabled: body.enabled,
            groupNames: body.group_names || body.groupNames || body.groups,
            personaPrompt: body.persona_prompt ?? body.personaPrompt,
            personaPresetId: body.persona_preset_id ?? body.personaPresetId,
          }
          if (
            Object.prototype.hasOwnProperty.call(body, 'active_reply')
            || Object.prototype.hasOwnProperty.call(body, 'activeReply')
            || Object.prototype.hasOwnProperty.call(body, 'active_reply_enabled')
            || Object.prototype.hasOwnProperty.call(body, 'activeReplyEnabled')
          ) {
            updates.activeReply = body.active_reply ?? body.activeReply ?? {
              enabled: body.active_reply_enabled ?? body.activeReplyEnabled,
            }
          }
          if (
            Object.prototype.hasOwnProperty.call(body, 'offline_qr_notify')
            || Object.prototype.hasOwnProperty.call(body, 'offlineQrNotify')
            || Object.prototype.hasOwnProperty.call(body, 'offline_qr_notify_enabled')
            || Object.prototype.hasOwnProperty.call(body, 'offlineQrNotifyEnabled')
          ) {
            updates.offlineQrNotify = body.offline_qr_notify ?? body.offlineQrNotify ?? {
              enabled: body.offline_qr_notify_enabled ?? body.offlineQrNotifyEnabled,
            }
          }
          if (
            Object.prototype.hasOwnProperty.call(body, 'admin_mode_enabled')
            || Object.prototype.hasOwnProperty.call(body, 'adminModeEnabled')
          ) updates.adminModeEnabled = body.admin_mode_enabled ?? body.adminModeEnabled
          if (
            Object.prototype.hasOwnProperty.call(body, 'admin_wechat_ids')
            || Object.prototype.hasOwnProperty.call(body, 'adminWechatIds')
            || Object.prototype.hasOwnProperty.call(body, 'admin_ids')
            || Object.prototype.hasOwnProperty.call(body, 'adminIds')
          ) updates.adminWechatIds = body.admin_wechat_ids ?? body.adminWechatIds ?? body.admin_ids ?? body.adminIds
          if (
            Object.prototype.hasOwnProperty.call(body, 'blocked_wechat_ids')
            || Object.prototype.hasOwnProperty.call(body, 'blockedWechatIds')
            || Object.prototype.hasOwnProperty.call(body, 'blocked_ids')
            || Object.prototype.hasOwnProperty.call(body, 'blockedIds')
          ) updates.blockedWechatIds = body.blocked_wechat_ids ?? body.blockedWechatIds ?? body.blocked_ids ?? body.blockedIds
          const cfg = setWechatyDutyGroupConfig(updates)
          if (onlyOfflineQrNotify) {
            return jsonResponse(res, 200, { ok: true, wechatyDutyGroup: cfg, status: getWechatyDutyGroupStatus() })
          }
          if (cfg.enabled) {
            // 保存群选择不能重启 Wechaty。重启会破坏刚扫码成功的 Web 微信会话，导致用户保存后立刻掉线。
            configureWechatyDutyGroup({ groupNames: cfg.groupNames, enabled: true })
            const current = getWechatyDutyGroupStatus()
            if (['idle', 'error'].includes(current.status)) {
              await startWechatyDutyGroupConnector({ pushMessage, emitEvent, groupNames: cfg.groupNames, enabled: true })
            } else {
              await syncWechatyDutyGroupRooms().catch(err => console.warn('[social] wechaty-duty-group sync rooms failed:', err.message))
            }
          } else {
            configureWechatyDutyGroup({ groupNames: cfg.groupNames, enabled: false })
            await stopWechatyDutyGroupConnector()
          }
          jsonResponse(res, 200, { ok: true, wechatyDutyGroup: cfg, status: getWechatyDutyGroupStatus() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      }).catch(err => jsonResponse(res, 400, { ok: false, error: err.message }))
      return
    }

    // POST /settings/minimax — set MiniMax API key
    if (req.method === 'POST' && url.pathname === '/settings/minimax') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const { apiKey } = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const trimmed = String(apiKey || '').trim()
          if (!trimmed) throw new Error('API key cannot be empty')
          setMinimaxKey(trimmed)
          replaceProvider(new MinimaxProvider({ apiKey: trimmed }))
          jsonResponse(res, 200, { ok: true, configured: true })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /activation — activation guide page
    if (req.method === 'GET' && (url.pathname === '/activation' || url.pathname === '/activation.html')) {
      try {
        const html = fs.readFileSync(ACTIVATION_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('activation.html not found')
      }
      return
    }

    // GET / — redirect to activation page if not activated, otherwise serve the Brain UI directly.
    // index.html is a legacy shell that still references a CDN D3 script; packaged Electron should
    // not start there because a blocked CDN can leave a blank Bailongma-titled window.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (config.needsActivation) {
        res.writeHead(302, { Location: '/activation' })
        res.end()
        return
      }
      try {
        const html = fs.readFileSync(BRAIN_UI_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        // No brain-ui.html — keep the legacy fallback.
        res.writeHead(302, { Location: '/brain-ui' })
        res.end()
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/dashboard.html') {
      try {
        const html = fs.readFileSync(DASHBOARD_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('dashboard.html not found')
      }
      return
    }

    // GET /brain.html — Brain Monitor
    if (req.method === 'GET' && url.pathname === '/brain.html') {
      try {
        const html = fs.readFileSync(BRAIN_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('brain.html not found')
      }
      return
    }

    // GET /brain-ui — Brain UI (memory graph + thought stream + chat)
    if (req.method === 'GET' && (url.pathname === '/site' || url.pathname === '/site.html')) {
      try {
        const html = fs.readFileSync(WEBSITE_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('website.html not found')
      }
      return
    }

    if (req.method === 'GET' && (url.pathname === '/brain-ui' || url.pathname === '/brain-ui.html')) {
      if (config.needsActivation) {
        res.writeHead(302, { Location: '/activation' })
        res.end()
        return
      }
      try {
        const html = fs.readFileSync(BRAIN_UI_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('brain-ui.html not found')
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/systemPrompt.html') {
      try {
        const html = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('systemPrompt.html not found')
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/vendor/d3/d3.min.js') {
      try {
        const stat = fs.statSync(D3_VENDOR_PATH)
        res.writeHead(200, {
          'Content-Type': contentTypeFor(D3_VENDOR_PATH),
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=31536000, immutable',
        })
        fs.createReadStream(D3_VENDOR_PATH).pipe(res)
      } catch {
        res.writeHead(404)
        res.end('d3.min.js not found')
      }
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/src/ui/brain-ui/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/src/ui/brain-ui/'.length))
      const assetRoot = path.resolve(BRAIN_UI_ASSET_ROOT)
      const assetPath = path.resolve(BRAIN_UI_ASSET_ROOT, relativePath)

      if (!isPathInside(assetRoot, assetPath)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }

      try {
        const stat = fs.statSync(assetPath)
        if (!stat.isFile()) {
          res.writeHead(404)
          res.end('asset not found')
          return
        }

        res.writeHead(200, {
          'Content-Type': contentTypeFor(assetPath),
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
        })
        fs.createReadStream(assetPath).pipe(res)
      } catch {
        res.writeHead(404)
        res.end('asset not found')
      }
      return
    }

    // POST /admin/stop — pause the consciousness loop (keep HTTP service running)
    if (req.method === 'POST' && url.pathname === '/admin/stop') {
      stopLoop()
      emitEvent('admin', { action: 'stop', running: false })
      jsonResponse(res, 200, { ok: true, running: false })
      return
    }

    // POST /admin/start — resume the consciousness loop
    if (req.method === 'POST' && url.pathname === '/admin/start') {
      startLoop()
      emitEvent('admin', { action: 'start', running: true })
      jsonResponse(res, 200, { ok: true, running: true })
      return
    }

    // POST /admin/restart — request a normal Electron relaunch when available.
    if (req.method === 'POST' && url.pathname === '/admin/restart') {
      jsonResponse(res, 200, { ok: true, message: 'Restarting…' })
      setTimeout(() => {
        const restart = globalThis.bailongmaAppControl?.restart
        if (typeof restart === 'function') {
          restart()
          return
        }
        process.exit(0)
      }, 500)
      return
    }

    // POST /admin/reset-memories — clear all memories and conversations
    if (req.method === 'POST' && url.pathname === '/admin/reset-memories') {
      const db = getDB()
      db.prepare('DELETE FROM memories').run()
      db.prepare('DELETE FROM conversations').run()
      db.prepare("DELETE FROM config WHERE key != 'birth_time'").run()
      db.prepare('DELETE FROM entities').run()
      db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
      emitEvent('admin', { action: 'reset-memories' })
      jsonResponse(res, 200, { ok: true })
      return
    }

    // POST /admin/reset-files — clear sandbox user files (keeping readme.txt and world.txt)
    if (req.method === 'POST' && url.pathname === '/admin/reset-files') {
      const sandboxPath = SANDBOX_PATH
      const KEEP = new Set(['readme.txt', 'world.txt'])
      function clearDir(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            clearDir(full)
            try { fs.rmdirSync(full) } catch (_) {}
          } else if (!KEEP.has(entry.name.toLowerCase())) {
            fs.unlinkSync(full)
          }
        }
      }
      try { clearDir(sandboxPath) } catch (_) {}
      emitEvent('admin', { action: 'reset-files' })
      jsonResponse(res, 200, { ok: true })
      return
    }

    // GET /settings/voice — read voice configuration (credentials returned as configured-status only)
    if (req.method === 'GET' && url.pathname === '/settings/voice') {
      jsonResponse(res, 200, { ok: true, voice: getVoiceConfig() })
      return
    }

    // POST /settings/voice — save voice configuration { whisperModel?, aliyunApiKey?, ... }
    if (req.method === 'POST' && url.pathname === '/settings/voice') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setVoiceConfig(body)
          jsonResponse(res, 200, { ok: true, voice: getVoiceConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /voice/local/status — local ASR server status
    if (req.method === 'GET' && url.pathname === '/voice/local/status') {
      jsonResponse(res, 200, { ok: true, ...getVoiceStatus() })
      return
    }

    // POST /voice/local/start — start local ASR server on ws://127.0.0.1:3723
    if (req.method === 'POST' && url.pathname === '/voice/local/start') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const model = String(body.localAsrModel || body.model || body.whisperModel || 'sensevoice-small').trim() || 'sensevoice-small'
          const status = startVoiceServer({ model, localAsrModel: model })
          jsonResponse(res, 200, { ok: true, ...status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /voice/local/restart — restart local ASR with a selected model
    if (req.method === 'POST' && url.pathname === '/voice/local/restart') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const model = String(body.localAsrModel || body.model || body.whisperModel || 'sensevoice-small').trim() || 'sensevoice-small'
          const status = restartVoiceServer(model)
          jsonResponse(res, 200, { ok: true, ...status })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // POST /voice/local/stop — stop local ASR server
    if (req.method === 'POST' && url.pathname === '/voice/local/stop') {
      jsonResponse(res, 200, { ok: true, ...stopVoiceServer() })
      return
    }

    // GET /settings/tts — read TTS configuration status (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/tts') {
      jsonResponse(res, 200, { ok: true, tts: getTTSConfig(), providers: TTS_PROVIDERS, voices: TTS_VOICES })
      return
    }

    // POST /settings/tts — save TTS configuration
    if (req.method === 'POST' && url.pathname === '/settings/tts') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setTTSConfig(body)
          jsonResponse(res, 200, { ok: true, tts: getTTSConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/web-search — read web search configuration (plaintext keys not returned)
    if (req.method === 'GET' && url.pathname === '/settings/web-search') {
      jsonResponse(res, 200, { ok: true, webSearch: getWebSearchConfig() })
      return
    }

    // POST /settings/web-search — save web search configuration
    if (req.method === 'POST' && url.pathname === '/settings/web-search') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          setWebSearchConfig(body)
          jsonResponse(res, 200, { ok: true, webSearch: getWebSearchConfig() })
        } catch (err) {
          jsonResponse(res, 400, { ok: false, error: err.message })
        }
      })
      return
    }

    // GET /settings/embedding — read embedding configuration status (plaintext apiKey not returned)
    if (req.method === 'GET' && url.pathname === '/settings/embedding') {
      jsonResponse(res, 200, {
        ok: true,
        embedding: getEmbeddingConfig(),
        presets: EMBEDDING_PROVIDER_PRESETS,
      })
      return
    }

    // POST /settings/embedding — save embedding configuration
    if (req.method === 'POST' && url.pathname === '/settings/embedding') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
        setEmbeddingConfig(body)
        // 写入配置后清掉 embedding 模块的 LRU 缓存（key 是 sha256(text+model)，model 变了旧缓存无效）
        try {
          const { clearEmbeddingCache } = await import('./embedding.js')
          clearEmbeddingCache()
        } catch {}
        jsonResponse(res, 200, { ok: true, embedding: getEmbeddingConfig() })
      } catch (err) {
        jsonResponse(res, 400, { ok: false, error: err.message })
      }
      return
    }

    // POST /settings/embedding/test — connectivity probe: compute one embedding to verify provider/key
    if (req.method === 'POST' && url.pathname === '/settings/embedding/test') {
      try {
        const { computeEmbedding, isEmbeddingConfigured } = await import('./embedding.js')
        if (!isEmbeddingConfigured()) {
          jsonResponse(res, 200, { ok: false, error: 'embedding not configured — save provider/model/apiKey first' })
          return
        }
        const t0 = Date.now()
        const buf = await computeEmbedding('embedding connectivity test')
        if (!buf) {
          jsonResponse(res, 200, { ok: false, error: 'computeEmbedding returned null — check apiKey / baseURL / model name; see server log if any' })
          return
        }
        const elapsed = Date.now() - t0
        const dims = buf.byteLength / 4 // Float32 = 4 bytes
        jsonResponse(res, 200, { ok: true, dims, elapsedMs: elapsed })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // GET /memory/embedding-backfill — current backfill status
    if (req.method === 'GET' && url.pathname === '/memory/embedding-backfill') {
      try {
        const { getBackfillStatus } = await import('./memory/embedding-backfill.js')
        jsonResponse(res, 200, { ok: true, status: getBackfillStatus() })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // POST /memory/embedding-backfill — fire-and-forget trigger backfill
    if (req.method === 'POST' && url.pathname === '/memory/embedding-backfill') {
      try {
        const { runBackfill, getBackfillStatus } = await import('./memory/embedding-backfill.js')
        const { isEmbeddingConfigured } = await import('./embedding.js')
        if (!isEmbeddingConfigured()) {
          jsonResponse(res, 200, { ok: false, error: 'embedding not configured' })
          return
        }
        const beforeStatus = getBackfillStatus()
        if (beforeStatus.running) {
          jsonResponse(res, 200, { ok: true, started: false, reason: 'already running', status: beforeStatus })
          return
        }
        // fire-and-forget：不 await，立即响应
        runBackfill({ batchSize: 20, throttleMs: 200 }).catch(() => {})
        jsonResponse(res, 200, { ok: true, started: true, status: getBackfillStatus() })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // DELETE /memory/embedding-backfill — request cancel of running backfill
    if (req.method === 'DELETE' && url.pathname === '/memory/embedding-backfill') {
      try {
        const { cancelBackfill } = await import('./memory/embedding-backfill.js')
        cancelBackfill()
        jsonResponse(res, 200, { ok: true, cancelled: true })
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: err.message })
      }
      return
    }

    // POST /tts/stream — streaming TTS synthesis, returns audio/mpeg stream
    if (req.method === 'POST' && url.pathname === '/tts/stream') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const { text } = body
          if (!text?.trim()) { jsonResponse(res, 400, { ok: false, error: 'Missing text parameter' }); return }
          const creds = getTTSCredentials()
          const audioStream = await streamTTS({
            text: text.slice(0, 800),
            provider: creds.provider,
            voiceId:  body.voiceId || creds.voiceId || undefined,
            keys: {
              doubaoKey:     creds.doubaoKey,
              doubaoAppId:   creds.doubaoAppId,
              doubaoAccessKey: creds.doubaoAccessKey,
              doubaoResourceId: creds.doubaoResourceId,
              minimaxKey:    creds.minimaxKey,
              openaiKey:     creds.openaiKey,
              openaiBaseURL: creds.openaiBaseURL,
              elevenLabsKey: creds.elevenLabsKey,
              volcanoAppId:  creds.volcanoAppId,
              volcanoToken:  creds.volcanoToken,
            },
          })
          let headersWritten = false
          let responseDone = false
          let streamError = null
          const finishRes = () => { if (!responseDone) { responseDone = true; res.end() } }
          const errorRes = (msg) => { if (!responseDone) { responseDone = true; jsonResponse(res, 500, { ok: false, error: msg }) } }
          audioStream.on('data', (chunk) => {
            if (!headersWritten) {
              headersWritten = true
              res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
              })
            }
            res.write(chunk)
          })
          audioStream.on('end', () => {
            if (!headersWritten) {
              const errMsg = streamError?.message || 'TTS synthesis failed: API returned no audio — check whether the voice ID is enabled on your account'
              console.warn('[TTS] Empty stream:', errMsg)
              errorRes(errMsg)
            } else {
              finishRes()
            }
          })
          audioStream.on('error', (err) => {
            console.warn('[TTS] Audio stream error:', err.message)
            streamError = err
            if (!headersWritten) {
              errorRes(err.message)
            } else {
              finishRes()
            }
          })
        } catch (err) {
          console.warn('[TTS] Streaming synthesis failed:', err.message)
          if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: err.message })
          else try { res.end() } catch {}
        }
      })
      return
    }

    // POST /tts/interrupted — TTS interrupted by user; trim the last jarvis message to the spoken portion
    if (req.method === 'POST' && url.pathname === '/tts/interrupted') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
          const { spokenContent } = body
          if (typeof spokenContent !== 'string') { jsonResponse(res, 400, { error: 'spokenContent required' }); return }
          const updated = updateLastJarvisConversationContent(spokenContent)
          emitEvent('tts_interrupted', { spokenContent })
          jsonResponse(res, 200, { ok: true, updated })
        } catch (e) {
          jsonResponse(res, 500, { error: e.message })
        }
      })
      return
    }

    jsonResponse(res, 404, { error: 'not found' })
  })

  // Cloud ASR WebSocket channel: frontend PCM → backend proxy → cloud ASR
  const cloudWss = new WebSocketServer({ noServer: true })
  cloudWss.on('connection', (ws) => {
    let session = null
    let configured = false
    let lastConfig = null
    let reconnectingVolc = false
    let audioFrameCount = 0
    let lastAudioStatAt = 0
    let cloudAsrProvider = 'aliyun'
    let volcHadSpeech = false
    let volcLastSpeechAt = 0
    let volcFlushTimer = null
    let volcFlushing = false

    function reconnectVolcSession() {
      if (cloudAsrProvider !== 'volcengine' || !lastConfig || ws.readyState !== 1 || reconnectingVolc) return
      reconnectingVolc = true
      setTimeout(() => {
        reconnectingVolc = false
        if (cloudAsrProvider !== 'volcengine' || !lastConfig || ws.readyState !== 1) return
        console.log('[CloudASR][volcengine] reconnect session')
        try { session?.close() } catch {}
        session = createCloudASRSession(
          lastConfig,
          (text, isFinal) => { try { ws.send(JSON.stringify({ type: 'transcript', text, is_final: isFinal })) } catch {} },
          (errMsg) => { console.warn('[CloudASR]', errMsg); try { ws.send(JSON.stringify({ type: 'error', message: errMsg })) } catch {} },
          () => {}
        )
      }, 180)
    }

    function resetVolcVad() {
      volcHadSpeech = false
      volcLastSpeechAt = 0
      volcFlushing = false
      if (volcFlushTimer) { clearTimeout(volcFlushTimer); volcFlushTimer = null }
    }

    function maybeFlushVolcAfterSilence(rms) {
      if (cloudAsrProvider !== 'volcengine' || !session) return
      const now = Date.now()
      // 火山/豆包大模型流式接口需要明确结束一段音频后才稳定返回文本。
      // 这里用后端 RMS 做轻量 VAD：检测到说话后，停顿约 900ms 自动 flush。
      if (rms >= 0.018) {
        volcHadSpeech = true
        volcLastSpeechAt = now
        if (volcFlushTimer) { clearTimeout(volcFlushTimer); volcFlushTimer = null }
        return
      }
      if (!volcHadSpeech || !volcLastSpeechAt || volcFlushTimer) return
      const wait = Math.max(180, 1400 - (now - volcLastSpeechAt))
      volcFlushTimer = setTimeout(() => {
        volcFlushTimer = null
        if (!session || !volcHadSpeech) return
        console.log('[CloudASR][volcengine] auto flush after silence')
        volcFlushing = true
        try { session.flush() } catch {}
        resetVolcVad()
        reconnectVolcSession()
      }, wait)
    }

    function logPcmStat(raw) {
      audioFrameCount++
      const now = Date.now()
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      let sum = 0
      let peak = 0
      const samples = Math.floor(buf.length / 2)
      for (let i = 0; i < samples; i++) {
        const v = buf.readInt16LE(i * 2)
        const a = Math.abs(v)
        peak = Math.max(peak, a)
        sum += v * v
      }
      const rms = samples ? Math.sqrt(sum / samples) / 32768 : 0
      if (audioFrameCount <= 5 || now - lastAudioStatAt >= 1500) {
        lastAudioStatAt = now
        console.log('[CloudASR] pcm', { n: audioFrameCount, bytes: buf.length, rms: Number(rms.toFixed(5)), peak })
      }
      return rms
    }

    ws.on('message', (raw) => {
      // First frame must be a JSON config frame
      if (!configured) {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type !== 'config') return
          // Read raw credentials from config.json
          let rawCfg = {}
          try { rawCfg = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.voice || {} } catch {}
          const provider = rawCfg.asrProvider || msg.provider || 'aliyun'
          cloudAsrProvider = provider
          resetVolcVad()
          console.log('[CloudASR] config', { provider, lang: msg.lang || 'zh' })
          lastConfig = { provider, lang: msg.lang || 'zh', ...rawCfg }
          session = createCloudASRSession(
            lastConfig,
            (text, isFinal) => {
              try { ws.send(JSON.stringify({ type: 'transcript', text, is_final: isFinal })) } catch {}
            },
            (errMsg) => {
              console.warn('[CloudASR]', errMsg)
              try { ws.send(JSON.stringify({ type: 'error', message: errMsg })) } catch {}
            },
            () => { try { ws.close() } catch {} }
          )
          configured = true
        } catch {}
        return
      }
      // Subsequent frames are PCM binary
      if (raw instanceof Buffer) {
        const rms = logPcmStat(raw)
        maybeFlushVolcAfterSilence(typeof rms === 'number' ? rms : 0)
        if (!(cloudAsrProvider === 'volcengine' && volcFlushing)) session?.sendAudio(raw)
      } else {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'flush') session?.flush()
        } catch {}
      }
    })

    ws.on('close', () => { resetVolcVad(); session?.close(); session = null })
    ws.on('error', () => { resetVolcVad(); session?.close(); session = null })
  })

  // ACUI WebSocket channel: bidirectional control + perception
  const acuiWss = new WebSocketServer({ noServer: true })
  acuiWss.on('connection', (ws) => {
    addACUIClient(ws)
    try { ws.send(JSON.stringify({ v: 1, kind: 'acui:hello' })) } catch {}

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg?.kind === 'ui.signal') {
          const id = insertUISignal({
            type: msg.type,
            target: msg.target || null,
            payload: msg.payload || {},
            ts: msg.ts || Date.now(),
          })
          emitEvent('ui_signal', { id, type: msg.type, target: msg.target, payload: msg.payload })
          // card.dismissed: remove from server-side active card table
          if (msg.type === 'card.dismissed') {
            removeActiveUICard(msg.target)
          }
          // Only push to the agent queue on explicit user interaction (card.action).
          // Lifecycle signals like card.dismissed are already persisted by insertUISignal for passive injector use.
          if (msg.type === 'card.action') {
            const appId = msg.target || 'ui'
            const action = msg.payload?.action || 'unknown'
            const payload = msg.payload?.payload || msg.payload || {}
            if (action === 'app:saveState') {
              // Auto-reported state snapshot from the component: persist directly, do not trigger agent
              persistAppState(appId, payload)
            } else if (action === 'confirm_security_change') {
              // User confirmed a security settings change: apply directly, do not push to agent queue
              const updates = {}
              if (payload.file_sandbox !== undefined) updates.fileSandbox = String(payload.file_sandbox) === 'true'
              if (payload.exec_sandbox !== undefined) updates.execSandbox = String(payload.exec_sandbox) === 'true'
              if (Object.keys(updates).length > 0) setSecurity(updates)
              emitUICommand({ op: 'unmount', id: appId })
              removeActiveUICard(appId)
              const desc = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')
              pushMessage('SYSTEM', `[security settings updated] User confirmed changes: ${desc}`, 'APP_SIGNAL')
            } else if (action === 'cancel_security_change') {
              // User cancelled — close the card, do not apply changes
              emitUICommand({ op: 'unmount', id: appId })
              removeActiveUICard(appId)
              pushMessage('SYSTEM', '[security settings change] User cancelled — settings unchanged', 'APP_SIGNAL')
            } else if (action.startsWith('app:') || SILENT_CARD_ACTIONS.has(action)) {
              // app: prefix = system-internal signal; SILENT_CARD_ACTIONS = lifecycle signals.
              // Both are already written to DB by insertUISignal; injector picks them up passively on the next tick.
            } else {
              const signalContent = `[App signal app=${appId} action=${action}]\n${JSON.stringify(payload, null, 2)}`
              pushMessage(`APP:${appId}`, signalContent, 'APP_SIGNAL')
            }
          }
        } else if (msg?.kind === 'pong') {
          // ignore
        }
      } catch (e) {
        // Reject non-JSON frames
      }
    })

    ws.on('close', () => removeACUIClient(ws))
    ws.on('error', () => removeACUIClient(ws))
  })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    if (url.pathname === '/acui') {
      const origin = req.headers.origin
      if (origin && !isAllowedOrigin(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      if (!hasAllowedAccess(req, url)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      acuiWss.handleUpgrade(req, socket, head, (ws) => acuiWss.emit('connection', ws, req))
    } else if (url.pathname === '/voice/cloud') {
      cloudWss.handleUpgrade(req, socket, head, (ws) => cloudWss.emit('connection', ws, req))
    } else {
      socket.destroy()
    }
  })

  // Heartbeat: send ping to all ACUI clients every 30s
  const acuiHeartbeat = setInterval(() => {
    for (const client of acuiWss.clients) {
      try { client.send(JSON.stringify({ v: 1, kind: 'ping' })) } catch {}
    }
  }, 30000)
  acuiHeartbeat.unref?.()

  server.listen(port, host, () => {
    console.log(`[API] Listening at http://${host}:${port}`)
    console.log(`[API]   POST /message  — send message to agent`)
    console.log(`[API]   GET  /events   — SSE real-time stream (receive agent messages)`)
    console.log(`[API]   GET  /memories — query memories`)
    console.log(`[API]   GET  /status   — status`)
    console.log(`[API]   WS   /acui     — ACUI bidirectional channel (control + perception)`)
  })

  return server
}
