import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const brainUiRoot = path.join(root, 'src', 'ui', 'brain-ui')

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    default: return 'text/plain; charset=utf-8'
  }
}

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function sendFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

const smokeProfiles = [
  {
    id: 'llm_main',
    name: '主力 DeepSeek',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyHint: 'sk-***main',
    configured: true,
    current: true,
    enabled: true,
    priority: 0,
    lastSuccessAt: new Date().toISOString(),
  },
  {
    id: 'llm_backup',
    name: '备用 Qwen 长名字用于换行验证',
    provider: 'qwen',
    providerLabel: 'Qwen',
    model: 'qwen-plus-very-long-model-name-for-layout-check',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyHint: 'sk-***back',
    configured: true,
    enabled: true,
    priority: 1,
    lastFailedAt: new Date().toISOString(),
    lastError: 'Smoke layout long error: upstream rate limit and a very long diagnostic message should wrap inside the card instead of stretching the modal.',
  },
  {
    id: 'llm_closed',
    name: '已关闭公司 OpenAI',
    provider: 'openai',
    providerLabel: 'OpenAI',
    model: 'gpt-4.1-mini',
    baseURL: 'https://api.openai.com/v1',
    apiKeyHint: 'sk-***off',
    configured: true,
    enabled: false,
    priority: 2,
  },
]

const smokeRooms = [
  { id: 'room_alpha', topic: '白龙马研发群', selected: true },
  { id: 'room_beta_with_a_very_long_identifier_for_layout', topic: '特别长名字的客户支持群用于布局验证', selected: true },
]

const smokeBackupGroups = [
  {
    backup_group_key: 'group_alpha_backup_key',
    group_id: 'wechaty:room_alpha',
    group_name: '白龙马研发群',
    counts: { activity: 24, messages: 18, memory_items: 5, member_names: 7, member_identities: 3, member_identity_aliases: 4, media_items: 2 },
    total_rows: 63,
    latest_message_at: new Date().toISOString(),
    media_bytes_estimate: 512 * 1024,
  },
  {
    backup_group_key: 'group_beta_backup_key_with_long_text',
    group_id: 'wechaty:room_beta_with_a_very_long_identifier_for_layout',
    group_name: '特别长名字的客户支持群用于布局验证和窄屏换行检查',
    counts: { activity: 128, messages: 96, memory_items: 21, member_names: 44, member_identities: 18, member_identity_aliases: 37, media_items: 11 },
    total_rows: 355,
    latest_message_at: new Date().toISOString(),
    media_bytes_estimate: 7 * 1024 * 1024,
  },
]

async function inspectWechatBackupUi(page, viewport) {
  await page.setViewportSize(viewport)
  await page.evaluate(() => {
    document.querySelector('.wechaty-backup-panel')?.scrollIntoView({ block: 'center', inline: 'nearest' })
  })
  await page.waitForTimeout(80)
  return page.evaluate(({ width, height }) => {
    const panel = document.querySelector('.wechaty-backup-panel')
    const content = document.querySelector('.settings-content')
    const modal = document.querySelector('.settings-modal')
    const failures = []
    if (!panel) return { viewport: { width, height }, failures: ['backup panel missing'] }

    const panelRect = panel.getBoundingClientRect()
    const contentRect = content?.getBoundingClientRect() || document.body.getBoundingClientRect()
    const modalRect = modal?.getBoundingClientRect() || document.body.getBoundingClientRect()
    const docOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
    if (docOverflow > 2) failures.push(`document horizontal overflow ${docOverflow}`)
    if (content && content.scrollWidth - content.clientWidth > 2) failures.push(`settings content overflow ${content.scrollWidth - content.clientWidth}`)
    if (panel.scrollWidth - panel.clientWidth > 2) failures.push(`backup panel overflow ${panel.scrollWidth - panel.clientWidth}`)

    const containedSelectors = [
      '.wechaty-backup-toolbar',
      '.wechaty-backup-import-head',
      '.wechaty-backup-summary',
      '.wechaty-backup-group',
      '.wechaty-backup-preview',
      '.wechaty-backup-result',
      '.wechaty-backup-column',
      '.settings-save-btn',
    ]
    const containedIssues = [...panel.querySelectorAll(containedSelectors.join(','))]
      .map(el => {
        const rect = el.getBoundingClientRect()
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
        const overflow = el.scrollWidth - el.clientWidth
        const outside = rect.width > 0 && (rect.left < contentRect.left - 2 || rect.right > contentRect.right + 2)
        return outside || overflow > 2 ? { text, className: String(el.className || el.tagName), width: rect.width, overflow, outside } : null
      })
      .filter(Boolean)
    if (containedIssues.length) failures.push(`contained overflow ${JSON.stringify(containedIssues.slice(0, 5))}`)

    const cardIssues = [...panel.querySelectorAll('.wechaty-backup-group, .wechaty-backup-preview-row')]
      .map(card => {
        const rect = card.getBoundingClientRect()
        const badChildren = [...card.children].filter(child => {
          const r = child.getBoundingClientRect()
          return r.width > 0 && (r.left < rect.left - 2 || r.right > rect.right + 2 || child.scrollWidth - child.clientWidth > 2)
        }).map(child => (child.textContent || child.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 40))
        return badChildren.length ? { text: (card.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), badChildren } : null
      })
      .filter(Boolean)
    if (cardIssues.length) failures.push(`card child overflow ${JSON.stringify(cardIssues.slice(0, 5))}`)

    const buttonIssues = [...panel.querySelectorAll('.settings-save-btn')]
      .map(btn => {
        const rect = btn.getBoundingClientRect()
        const text = (btn.textContent || '').trim()
        const charCount = Array.from(text).length
        const tooNarrow = charCount >= 4 && rect.width < 64
        const clipped = btn.scrollWidth - btn.clientWidth > 2 || btn.scrollHeight - btn.clientHeight > 2
        return tooNarrow || clipped ? { text, width: rect.width, height: rect.height, clipped, tooNarrow } : null
      })
      .filter(Boolean)
    if (buttonIssues.length) failures.push(`button readability ${JSON.stringify(buttonIssues)}`)

    const resultStyle = getComputedStyle(document.querySelector('.wechaty-backup-result'))
    if (['fixed', 'absolute'].includes(resultStyle.position)) failures.push(`result area uses ${resultStyle.position}`)
    const toolbarHeight = document.querySelector('.wechaty-backup-toolbar')?.getBoundingClientRect().height || 0
    if (toolbarHeight > 150) failures.push(`toolbar too tall ${toolbarHeight}`)

    return {
      viewport: { width, height },
      modal: { width: modalRect.width, left: modalRect.left, right: modalRect.right },
      panel: { width: panelRect.width, height: panelRect.height },
      toolbarHeight,
      groupCards: panel.querySelectorAll('.wechaty-backup-group').length,
      failures,
    }
  }, viewport)
}

function createServer() {
  const sseClients = new Set()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')

    if (url.pathname === '/brain-ui' || url.pathname === '/brain-ui.html' || url.pathname === '/') {
      sendFile(res, path.join(root, 'brain-ui.html'))
      return
    }

    if (url.pathname === '/vendor/d3/d3.min.js') {
      sendFile(res, path.join(root, 'node_modules', 'd3', 'dist', 'd3.min.js'))
      return
    }

    if (url.pathname.startsWith('/src/ui/brain-ui/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/src/ui/brain-ui/'.length))
      const assetPath = path.resolve(brainUiRoot, relativePath)
      if (!isPathInside(brainUiRoot, assetPath)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      sendFile(res, assetPath)
      return
    }

    if (url.pathname === '/agent-profile') {
      sendJson(res, { name: 'SmokeLongma' })
      return
    }

    if (url.pathname === '/memories') {
      sendJson(res, [
        { id: 1, mem_id: 'm1', type: 'fact', content: 'Alpha memory', detail: 'First smoke node', created_at: new Date().toISOString() },
        { id: 2, mem_id: 'm2', type: 'preference', content: 'Beta memory', detail: 'Second smoke node', created_at: new Date().toISOString() },
      ])
      return
    }

    if (url.pathname === '/conversations') {
      sendJson(res, [])
      return
    }

    if (url.pathname === '/settings') {
      sendJson(res, {
        llm: {
          activated: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
          models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat' }],
          activeProfileId: 'llm_main',
          profiles: smokeProfiles,
          failover: { enabled: true, cooldownSeconds: 180, maxAttempts: 4 },
          routing: {
            globalProfileId: 'llm_main',
            globalProfile: smokeProfiles[0],
            groupOverrides: [
              { groupId: 'room_beta_with_a_very_long_identifier_for_layout', groupName: '特别长名字的客户支持群用于布局验证', profileId: 'llm_backup', profile: smokeProfiles[1], updatedAt: new Date().toISOString() },
            ],
          },
          connectivityMonitor: { enabled: false, intervalMinutes: 60, notifyMode: 'changes', selectedProfileIds: ['llm_main'], selectedGroups: [], notifyMentionsByGroup: {} },
          connectivityMonitorStatus: { lastRunAt: null, lastResults: [] },
          temperature: 0.5,
        },
        providers: {
          deepseek: { models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat' }] },
          qwen: { models: [{ id: 'qwen-plus', label: 'Qwen Plus' }] },
          openai: { models: [{ id: 'gpt-4.1-mini', label: 'GPT 4.1 mini' }] },
        },
        minimax: { configured: false },
      })
      return
    }

    if (url.pathname === '/settings/voice') {
      sendJson(res, { ok: true, voice: { asrProvider: 'local', localAsrModel: 'base', speakerVerificationEnabled: false } })
      return
    }

    if (url.pathname === '/settings/llm-group-routing') {
      sendJson(res, {
        ok: true,
        routing: {
          globalProfileId: 'llm_main',
          globalProfile: smokeProfiles[0],
          groupOverrides: [
            { groupId: 'room_beta_with_a_very_long_identifier_for_layout', groupName: '特别长名字的客户支持群用于布局验证', profileId: 'llm_backup', profile: smokeProfiles[1], updatedAt: new Date().toISOString() },
          ],
        },
        profiles: smokeProfiles,
        wechatyDutyGroupStatus: { online: true, rooms: smokeRooms },
      })
      return
    }

    if (url.pathname === '/settings/llm-connectivity-monitor') {
      sendJson(res, {
        ok: true,
        config: { enabled: false, intervalMinutes: 60, notifyMode: 'changes', selectedProfileIds: ['llm_main'], selectedGroups: [], notifyMentionsByGroup: {} },
        status: { lastRunAt: null, lastResults: [] },
        profiles: smokeProfiles,
        wechatyDutyGroupStatus: { online: true, rooms: smokeRooms },
      })
      return
    }

    if (url.pathname === '/settings/tts') {
      sendJson(res, {
        ok: true,
        tts: { ttsProvider: 'minimax', ttsVoiceId: 'male-qn-qingse' },
        providers: [{ id: 'minimax', label: 'MiniMax', streaming: false }],
        voices: { minimax: [{ id: 'male-qn-qingse', label: '青涩男声' }] },
      })
      return
    }

    if (url.pathname === '/hotspots') {
      sendJson(res, {
        ok: true,
        refreshMinutes: 30,
        fetchedAt: new Date().toISOString(),
        stale: false,
        platforms: {
          douyin: [
            { rank: 1, title: 'Smoke 热点一', heat: '100万', trend: 'same', isNew: false, source: 'smoke' },
            { rank: 2, title: 'Smoke 热点二', heat: '80万', trend: 'same', isNew: true, source: 'smoke' },
          ],
        },
      })
      return
    }

    if (url.pathname === '/person-card') {
      const name = url.searchParams.get('name') || ''
      if (name.includes('马云')) {
        sendJson(res, {
          ok: true,
          card: {
            name: '马云',
            title: '人物卡片',
            summary: '暂时没有内置资料。可以让 Longma 补充身份、代表作品和为什么被提到。',
            knownFor: [],
            tags: ['待补充'],
            image: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 360%22%3E%3Crect width=%22640%22 height=%22360%22 fill=%22%23112332%22/%3E%3Ccircle cx=%22320%22 cy=%22130%22 r=%2260%22 fill=%22%2382d2ff%22/%3E%3Crect x=%22205%22 y=%22210%22 width=%22230%22 height=%2280%22 rx=%2240%22 fill=%22%2382d2ff%22/%3E%3C/svg%3E',
            source: 'fallback',
            updatedAt: new Date().toISOString(),
          },
        })
        return
      }
      sendJson(res, {
        ok: true,
        card: {
          name: '周杰伦',
          title: '歌手 / 音乐人',
          summary: '华语流行音乐代表人物之一。',
          knownFor: ['七里香', '青花瓷'],
          tags: ['华语音乐', '创作歌手'],
          image: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 360%22%3E%3Crect width=%22640%22 height=%22360%22 fill=%22%23112332%22/%3E%3Ccircle cx=%22320%22 cy=%22130%22 r=%2260%22 fill=%22%2382d2ff%22/%3E%3Crect x=%22205%22 y=%22210%22 width=%22230%22 height=%2280%22 rx=%2240%22 fill=%22%2382d2ff%22/%3E%3C/svg%3E',
          source: 'smoke',
          updatedAt: new Date().toISOString(),
        },
      })
      return
    }

    if (url.pathname === '/person-card-state') {
      sendJson(res, { ok: true, state: { active: true } })
      return
    }

    if (url.pathname === '/social/wechat-clawbot/qr') {
      sendJson(res, { ok: true, qr: null, status: 'unavailable' })
      return
    }

    if (url.pathname === '/social/wechat-groups/known') {
      sendJson(res, { ok: true, groups: smokeRooms.map(room => ({ id: room.id, topic: room.topic, selected: room.selected })) })
      return
    }

    if (url.pathname === '/settings/social/wechat-group-archive') {
      sendJson(res, {
        ok: true,
        wechatGroupArchive: { enabled: true, selectedGroups: ['room_alpha'], recordMediaFiles: true },
        wechatyDutyGroup: { enabled: true, rooms: smokeRooms, groupNames: smokeRooms.map(room => room.topic) },
      })
      return
    }

    if (url.pathname === '/settings/database') {
      sendJson(res, {
        ok: true,
        db_path: '/tmp/bailongma-smoke.db',
        tables: [
          { name: 'wechat_group_activity', count: 152, bytes: 120000 },
          { name: 'wechat_group_messages', count: 114, bytes: 90000 },
          { name: 'wechat_group_memory_items', count: 26, bytes: 26000 },
          { name: 'wechat_group_media_items', count: 13, bytes: 240000 },
        ],
        totals: { tables: 4, rows: 305, bytes: 476000 },
      })
      return
    }

    if (url.pathname === '/social/wechat-groups/memory-index/status') {
      sendJson(res, {
        ok: true,
        activity_fts: 152,
        chunks: 36,
        messages: 114,
        memories: 26,
        errors: [],
      })
      return
    }

    if (url.pathname === '/social/wechat-groups/images') {
      sendJson(res, {
        ok: true,
        rows: [],
        total: 0,
        offset: Number(url.searchParams.get('offset') || 0),
        limit: Number(url.searchParams.get('limit') || 24),
        has_more: false,
        counts: { total: 0, pending: 0, done: 0, error: 0 },
      })
      return
    }

    if (url.pathname === '/social/wechat-groups/backup/groups') {
      sendJson(res, {
        ok: true,
        generated_at: new Date().toISOString(),
        groups: smokeBackupGroups,
        totals: smokeBackupGroups.reduce((acc, group) => {
          acc.groups += 1
          acc.rows += group.total_rows
          acc.media_bytes_estimate += group.media_bytes_estimate
          for (const [key, value] of Object.entries(group.counts)) acc[key] = (acc[key] || 0) + value
          return acc
        }, { groups: 0, rows: 0, media_bytes_estimate: 0 }),
      })
      return
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'connected', data: {}, ts: new Date().toISOString() })}\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    if (url.pathname === '/message') {
      sendJson(res, { ok: true })
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  server.closeAllSse = () => {
    for (const client of sseClients) {
      try { client.end() } catch {}
    }
    sseClients.clear()
  }
  server.emitSse = (event) => {
    for (const client of sseClients) {
      try { client.write(`data: ${JSON.stringify(event)}\n\n`) } catch {}
    }
  }
  return server
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    server.on('error', reject)
  })
}

function resolveChromiumExecutable() {
  const candidates = []
  const add = file => {
    const value = String(file || '').trim()
    if (value) candidates.push(value)
  }
  try { add(chromium.executablePath()) } catch {}
  add(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
  add(process.env.CHROME_PATH)
  add(process.env.EDGE_PATH)
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  )
  const cacheDirs = [
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    path.join(process.env.HOME || '', 'Library/Caches/ms-playwright'),
    path.join(process.env.HOME || '', '.cache/ms-playwright'),
  ]
  try {
    for (const cacheDir of cacheDirs) {
      if (!cacheDir || !fs.existsSync(cacheDir)) continue
      for (const name of fs.readdirSync(cacheDir)) {
        const base = path.join(cacheDir, name)
        candidates.push(
          path.join(base, 'chrome-win64/chrome.exe'),
          path.join(base, 'chrome-headless-shell-win64/chrome-headless-shell.exe'),
          path.join(base, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
          path.join(base, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
          path.join(base, 'chrome-linux/chrome'),
          path.join(base, 'chrome-headless-shell-linux64/chrome-headless-shell'),
        )
      }
    }
  } catch {}
  return candidates.find(file => file && fs.existsSync(file)) || ''
}

const server = createServer()
const port = await listen(server)
const baseUrl = `http://127.0.0.1:${port}`
const executablePath = resolveChromiumExecutable()
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } })
await page.addInitScript(() => {
  localStorage.setItem('bailongma-memory-graph-enabled', 'true')
})
const errors = []
page.on('pageerror', err => errors.push(err.message))
page.on('console', msg => {
  if (msg.text().includes('/acui') && msg.text().includes('WebSocket connection')) return
  if (msg.text().includes('Failed to load resource: the server responded with a status of 404')) return
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
})

try {
  const vendorResponse = await page.goto(`${baseUrl}/vendor/d3/d3.min.js`)
  if (!vendorResponse?.ok()) throw new Error('local d3 vendor route failed')

  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#graph circle', { timeout: 5000 })
  await page.waitForFunction(() => window.d3 && document.querySelector('#agent-brand-name')?.textContent.includes('SmokeLongma'))
  await page.fill('#msg-input', '马云是谁')
  await page.click('#send-btn')
  await page.waitForTimeout(300)
  const appearedTooFast = await page.evaluate(() => document.body.classList.contains('person-card-mode'))
  if (appearedTooFast) throw new Error('person card appeared before the intended reveal delay')
  await page.waitForFunction(() => document.body.classList.contains('person-card-mode') && document.querySelector('#pc-name')?.textContent.includes('马云'))
  const enteringSeen = await page.evaluate(() => document.querySelector('#person-card-panel')?.classList.contains('pc-entering'))
  if (!enteringSeen) throw new Error('person card did not use the entering glitch state')
  server.emitSse({
    type: 'message',
    data: {
      from: 'consciousness',
      content: '马云，1964年生，浙江杭州人，阿里巴巴集团创始人，曾任董事局主席，创办了淘宝、支付宝，多次成为中国首富。',
    },
    ts: new Date().toISOString(),
  })
  await page.waitForFunction(() => document.querySelector('#pc-summary')?.textContent.includes('阿里巴巴集团创始人'))

  const snapshot = await page.evaluate(() => ({
    d3: Boolean(window.d3),
    nodes: document.querySelectorAll('#graph circle').length,
    links: document.querySelectorAll('#graph line').length,
    acuiHost: Boolean(document.getElementById('acui-host')),
    personCard: document.querySelector('#pc-name')?.textContent || '',
    personSummary: document.querySelector('#pc-summary')?.textContent || '',
    personKnownFor: [...document.querySelectorAll('#pc-known-list li')].map(li => li.textContent).join(' / '),
    personImage: !document.querySelector('#pc-hero-img')?.hidden,
    closeHidden: getComputedStyle(document.querySelector('#pc-exit-btn')).opacity === '0',
    brand: document.querySelector('#agent-brand-name')?.textContent || '',
  }))

  if (!snapshot.d3) throw new Error('d3 global missing')
  if (snapshot.nodes < 2) throw new Error(`expected at least 2 graph nodes, saw ${snapshot.nodes}`)
  if (!snapshot.acuiHost) throw new Error('ACUI host was not bootstrapped')
  if (!snapshot.personCard.includes('马云')) throw new Error('person card did not render the requested person')
  if (!snapshot.personSummary.includes('阿里巴巴集团创始人')) throw new Error('person card did not absorb assistant summary')
  if (!snapshot.personKnownFor.includes('淘宝')) throw new Error('person card did not absorb assistant known-for items')
  if (!snapshot.personImage) throw new Error('person card hero image was not visible')
  if (!snapshot.closeHidden) throw new Error('person card close button should be hidden until hover')
  await page.hover('.pc-card')
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#pc-exit-btn')).opacity) > 0.5)
  await page.click('#pc-exit-btn')
  const leavingSeen = await page.waitForFunction(() => document.querySelector('#person-card-panel')?.classList.contains('pc-leaving'), null, { timeout: 1000 })
  if (!leavingSeen) throw new Error('person card did not use the leaving glitch state')
  await page.waitForFunction(() => !document.body.classList.contains('person-card-mode') && !document.querySelector('#person-card-panel')?.classList.contains('pc-visible'))

  await page.click('#settings-btn')
  await page.click('.settings-nav-item[data-tab="llm"]')
  await page.waitForSelector('#settings-llm-test-all', { timeout: 3000 })
  await page.waitForFunction(() => document.querySelector('#settings-llm-pool-list')?.textContent.includes('测试连通'))
  const llmUi = await page.evaluate(() => {
    const modal = document.querySelector('.settings-modal')?.getBoundingClientRect()
    const content = document.querySelector('.settings-content')?.getBoundingClientRect()
    const cards = [...document.querySelectorAll('.llm-profile-card')].map(card => {
      const rect = card.getBoundingClientRect()
      const overflowingChildren = [...card.querySelectorAll('*')]
        .filter(el => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.left < rect.left - 1 || r.right > rect.right + 1)
        })
        .map(el => el.className || el.tagName)
      return { width: rect.width, overflowingChildren }
    })
    return {
      hasTestAll: Boolean(document.querySelector('#settings-llm-test-all')),
      hasTestSelected: Boolean(document.querySelector('#settings-llm-test-selected')),
      singleTests: document.querySelectorAll('.llm-profile-actions button[data-action="test"]').length,
      routingRows: document.querySelectorAll('.llm-routing-row').length,
      summaryCards: document.querySelectorAll('.llm-summary-card').length,
      modalWidth: modal?.width || 0,
      contentWidth: content?.width || 0,
      cards,
    }
  })
  if (!llmUi.hasTestAll || !llmUi.hasTestSelected) throw new Error('LLM batch test controls missing')
  if (llmUi.singleTests < 1) throw new Error('LLM single profile test control missing')
  if (llmUi.routingRows < 1) throw new Error('LLM group routing rows missing')
  if (llmUi.summaryCards < 5) throw new Error('LLM summary cards missing')
  const overflowingCards = llmUi.cards.filter(card => card.overflowingChildren.length)
  if (overflowingCards.length) throw new Error(`LLM profile card overflow: ${JSON.stringify(overflowingCards)}`)

  await page.click('.settings-nav-item[data-tab="database"]')
  await page.waitForFunction(() => document.querySelector('.settings-tab[data-tab="database"]')?.classList.contains('active'), null, { timeout: 3000 })
  await page.waitForFunction(() => document.querySelector('#wechaty-backup-group-list')?.textContent.includes('白龙马研发群'), null, { timeout: 3000 })
  const databaseVisibility = await page.evaluate(() => {
    const overlay = document.querySelector('.settings-overlay')
    const panel = document.querySelector('.wechaty-backup-panel')
    const tab = document.querySelector('.settings-tab[data-tab="database"]')
    const activeTabs = [...document.querySelectorAll('.settings-tab.active')].map(el => el.dataset.tab || '')
    return {
      overlayHidden: overlay?.hasAttribute('hidden') || getComputedStyle(overlay).display === 'none',
      tabActive: tab?.classList.contains('active') || false,
      tabDisplay: tab ? getComputedStyle(tab).display : '',
      panelWidth: panel?.getBoundingClientRect().width || 0,
      panelDisplay: panel ? getComputedStyle(panel).display : '',
      activeTabs,
    }
  })
  if (databaseVisibility.panelWidth <= 100) throw new Error(`database backup panel not visible: ${JSON.stringify(databaseVisibility)}`)
  const backupUi = []
  for (const viewport of [
    { width: 1280, height: 840 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    const report = await inspectWechatBackupUi(page, viewport)
    backupUi.push(report)
    if (report.failures.length) throw new Error(`WeChat backup UI overflow at ${viewport.width}x${viewport.height}: ${report.failures.join('; ')}`)
  }
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`)

  console.log('[PASS] brain-ui smoke')
  console.log(JSON.stringify({ ...snapshot, llmUi, backupUi }, null, 2))
} finally {
  await browser.close()
  server.closeAllSse()
  await new Promise(resolve => server.close(resolve))
}
