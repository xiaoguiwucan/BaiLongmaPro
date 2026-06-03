// Windows: 把控制台代码页切到 UTF-8，避免中文 stdout 显示为乱码
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore', windowsHide: true })
  } catch (_) {}
}

const { app, BrowserWindow, shell, dialog, Menu, ipcMain, Tray, nativeImage, Notification, session } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const http = require('http')
const https = require('https')
const childProcess = require('child_process')
const Module = require('module')
const { EventEmitter } = require('events')
const { pathToFileURL } = require('url')
const { autoUpdater } = require('electron-updater')

const IS_DEV = !app.isPackaged

const UPDATE_REPO = 'xiaoguiwucan/BaiLongma'
const UPDATE_BRANCH = 'main'
const DEV_AUTO_UPDATE = process.env.BAILONGMA_DEV_AUTO_UPDATE !== '0'
const HONCHO_HEALTH_URL = 'http://127.0.0.1:8018/health'
const ENABLE_BUNDLED_HONCHO = process.env.BAILONGMA_ENABLE_BUNDLED_HONCHO === '1'
let devUpdateApplying = false

function normalizeVersion(version = '') {
  return String(version || '').trim().replace(/^v/i, '')
}

function compareVersions(a = '', b = '') {
  const pa = normalizeVersion(a).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)
  const pb = normalizeVersion(b).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': `Bailongma/${app.getVersion()}`,
      },
    }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 160)}`))
          return
        }
        try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API timeout')))
  })
}

async function getLatestGitHubRelease() {
  const release = await requestJson(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`)
  const version = normalizeVersion(release?.tag_name || release?.name || '')
  if (!version) throw new Error('Latest release has no version')
  return { version, tag: release.tag_name || `v${version}`, url: release.html_url || '' }
}

async function checkDevUpdates({ autoApply = false } = {}) {
  const current = app.getVersion()
  const latest = await getLatestGitHubRelease()
  if (compareVersions(latest.version, current) <= 0) {
    sendUpdaterStatus({ stage: 'up-to-date', version: current, mode: 'dev' })
    return { ok: true, currentVersion: current, latestVersion: latest.version, updateAvailable: false, mode: 'dev' }
  }
  sendUpdaterStatus({ stage: 'available', version: latest.version, mode: 'dev', url: latest.url })
  if (autoApply && DEV_AUTO_UPDATE) {
    applyDevUpdate(latest.version).catch(err => {
      sendUpdaterStatus({ stage: 'error', mode: 'dev', message: err?.message || String(err) })
    })
  }
  return { ok: true, currentVersion: current, latestVersion: latest.version, updateAvailable: true, mode: 'dev' }
}

function shellQuote(value = '') {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function applyDevUpdate(version = '') {
  if (devUpdateApplying) return Promise.resolve({ ok: true, applying: true })
  devUpdateApplying = true
  sendUpdaterStatus({ stage: 'downloading', mode: 'dev', version })
  const appDir = CODE_ROOT
  const logFile = path.join(LOG_DIR, 'dev-auto-update.log')
  const script = `
set -euo pipefail
APP_DIR=${shellQuote(appDir)}
LOG_FILE=${shellQuote(logFile)}
{
  echo "[$(date '+%F %T')] Bailongma dev auto-update start"
  cd "$APP_DIR"
  echo "APP_DIR=$APP_DIR"
  echo "current=$(node -p \"require('./package.json').version\" 2>/dev/null || true) target=${version}"
  if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules -- || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "working tree has local changes; stashing before update"
    git stash push -u -m "bailongma-auto-update-$(date '+%Y%m%d-%H%M%S')" || true
  fi
  git fetch origin ${UPDATE_BRANCH}
  git checkout ${UPDATE_BRANCH}
  git reset --hard origin/${UPDATE_BRANCH}
  if [ -f package-lock.json ]; then
    npm install
  else
    npm install
  fi
  echo "updated=$(node -p \"require('./package.json').version\" 2>/dev/null || true)"
  echo "restarting Bailongma"
  ./start-jarvis-background.sh
  echo "[$(date '+%F %T')] Bailongma dev auto-update done"
} >> "$LOG_FILE" 2>&1
`
  return new Promise((resolve, reject) => {
    try {
      const child = childProcess.spawn('/bin/zsh', ['-lc', script], {
        detached: true,
        stdio: 'ignore',
        cwd: appDir,
      })
      child.unref()
      sendUpdaterStatus({ stage: 'downloaded', mode: 'dev', version })
      setTimeout(() => {
        app.isQuiting = true
        app.quit()
      }, 1200)
      resolve({ ok: true, mode: 'dev', version })
    } catch (err) {
      devUpdateApplying = false
      reject(err)
    }
  })
}
const WINDOWS_APP_USER_MODEL_ID = 'com.xiaoyuanda.bailongma'
const USER_DIR = app.getPath('userData')
const CODE_ROOT = app.getAppPath()
const RESOURCE_ROOT = CODE_ROOT
const BACKEND_ENTRY = path.join(CODE_ROOT, 'src', 'index.js')

// 持久化日志：把 console.* 镜像到 USER_DIR/logs/bailongma.log，
// 安装版没有 stdout 的情况下，卡死/崩溃后还能 tail 这个文件复盘。
// 简易 rotate：> 5MB 时把当前文件改名 .old（覆盖上一份 .old），下次写入重开。
const LOG_DIR = path.join(USER_DIR, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'bailongma.log')
const LOG_FILE_OLD = path.join(LOG_DIR, 'bailongma.old.log')
const LOG_MAX_BYTES = 5 * 1024 * 1024
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch {}
let stdioBroken = false
function isBrokenPipeError(err) {
  return err && (err.code === 'EPIPE' || /write EPIPE/i.test(String(err?.message || err)))
}
function markStdioBroken(err) {
  if (!isBrokenPipeError(err)) return false
  stdioBroken = true
  return true
}
for (const stream of [process.stdout, process.stderr]) {
  try {
    stream?.on?.('error', err => { markStdioBroken(err) })
  } catch {}
}
function rotateLogIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size > LOG_MAX_BYTES) {
      try { fs.rmSync(LOG_FILE_OLD, { force: true }) } catch {}
      try { fs.renameSync(LOG_FILE, LOG_FILE_OLD) } catch {}
    }
  } catch {}
}

function writeLog(level, args) {
  let line
  try {
    line = args.map(a => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack || a.message
      try { return JSON.stringify(a) } catch { return String(a) }
    }).join(' ')
  } catch { line = '[log-serialize-failed]' }
  const ts = new Date().toISOString()
  const out = `${ts} [${level}] ${line}\n`
  try { fs.appendFileSync(LOG_FILE, out) } catch {}
}
// Hijack 一次就够；后端 import 在同一进程，console.* 引用的是同一个 console 对象。
// 把原始方法存起来，appendFile 失败时仍能输出到 stdout/stderr（开发模式可见）。
;(function installLogHijack() {
  const levels = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    const original = console[level]?.bind(console) || (() => {})
    console[level] = (...args) => {
      if (!stdioBroken) {
        try { original(...args) } catch (err) { markStdioBroken(err) }
      }
      try {
        rotateLogIfNeeded()
        writeLog(level, args)
      } catch {}
    }
  }
})()
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? (reason.stack || reason.message) : String(reason))
})
process.on('uncaughtException', (err) => {
  if (markStdioBroken(err)) {
    try {
      rotateLogIfNeeded()
      writeLog('warn', ['[stdio] stdout/stderr closed; disabling console mirror to terminal'])
    } catch {}
    return
  }
  console.error('[uncaughtException]', err?.stack || err?.message || String(err))
})
console.log(`[main] Bailongma ${app.getVersion()} starting, logs → ${LOG_FILE}`)

let mainWindow = null
let backendPort = 0
let tray = null
let focusBannerWindow = null
app.isQuiting = false

// 后端通过 global.focusBannerBridge 控制横幅窗口
const focusBannerBridge = new EventEmitter()
global.focusBannerBridge = focusBannerBridge
global.bailongmaAppControl = {
  restart() {
    console.log('[main] restart requested')
    app.isQuiting = true
    app.relaunch()
    app.quit()
  },
  notify({ title = 'Bailongma', body = '', showWindow = false } = {}) {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({ title, body, silent: false })
        notification.on('click', () => showMainWindow())
        notification.show()
      }
    } catch (err) {
      console.warn('[main] notify failed', err?.message || String(err))
    }
    if (showWindow) showMainWindow()
  },
}

if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}

function sendUpdaterStatus(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('updater:status', {
    currentVersion: app.getVersion(),
    ...payload,
  })
}

async function bootstrapBackend(port) {
  process.env.BAILONGMA_USER_DIR ||= USER_DIR
  process.env.BAILONGMA_RESOURCES_DIR ||= RESOURCE_ROOT
  process.env.BAILONGMA_PORT = String(port)
  if (app.isPackaged) {
    const legacyLevelNodeModules = path.join(CODE_ROOT, 'node_modules', 'level', 'node_modules')
    process.env.NODE_PATH = [legacyLevelNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
    Module._initPaths()
  }
  await import(pathToFileURL(BACKEND_ENTRY).href)
}

function requestOk(url, timeoutMs = 2500) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function runCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const child = childProcess.spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on?.('data', chunk => { stdout += chunk.toString('utf8') })
    child.stderr?.on?.('data', chunk => { stderr += chunk.toString('utf8') })
    child.on('error', err => resolve({ ok: false, code: null, stdout, stderr: err.message || String(err) }))
    child.on('close', code => resolve({ ok: code === 0, code, stdout, stderr }))
  })
}

async function waitForHoncho(timeoutMs = 120000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await requestOk(HONCHO_HEALTH_URL, 2500)) return true
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  return false
}

function bundledHonchoSourceDir() {
  const candidates = []
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'services', 'honcho'))
  }
  candidates.push(path.join(CODE_ROOT, 'installer', 'services', 'honcho'))
  candidates.push(path.resolve(CODE_ROOT, '..', 'honcho'))
  return candidates.find(candidate => {
    try {
      return fs.existsSync(path.join(candidate, 'docker-compose.yml'))
        && fs.existsSync(path.join(candidate, 'Dockerfile'))
    } catch {
      return false
    }
  }) || ''
}

function defaultHonchoEnv() {
  const inheritedKey = String(process.env.LLM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim()
  return [
    'LOG_LEVEL=INFO',
    'AUTH_USE_AUTH=false',
    `LLM_OPENAI_API_KEY=${inheritedKey || 'bailongma-local-placeholder'}`,
    'DERIVER_ENABLED=false',
    'PEER_CARD_ENABLED=false',
    'EMBED_MESSAGES=false',
    'CACHE_ENABLED=true',
    '',
  ].join('\n')
}

function prepareHonchoServiceDir(sourceDir) {
  const targetDir = path.join(USER_DIR, 'services', 'honcho')
  const envPath = path.join(targetDir, '.env')
  let existingEnv = ''
  try { existingEnv = fs.readFileSync(envPath, 'utf8') } catch {}
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: src => {
      const base = path.basename(src)
      return base !== '.git' && base !== '.env' && base !== 'node_modules' && base !== '__pycache__'
    },
  })
  fs.writeFileSync(envPath, existingEnv || defaultHonchoEnv())
  return targetDir
}

async function ensureDockerAvailable() {
  const dockerVersion = await runCommand('docker', ['--version'])
  if (!dockerVersion.ok) {
    console.warn('[honcho] Docker CLI not found; full local Honcho service cannot start')
    return false
  }
  if ((await runCommand('docker', ['info'])).ok) return true
  if (process.platform === 'darwin') {
    console.log('[honcho] Docker daemon unavailable; opening Docker Desktop')
    await runCommand('/usr/bin/open', ['-a', 'Docker'])
  }
  for (let i = 0; i < 45; i += 1) {
    if ((await runCommand('docker', ['info'])).ok) return true
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  console.warn('[honcho] Docker daemon still unavailable after waiting')
  return false
}

async function ensureBundledHoncho() {
  if (!ENABLE_BUNDLED_HONCHO) {
    console.log('[honcho] bundled Docker service disabled; using built-in local memory engine')
    return false
  }
  if (await requestOk(HONCHO_HEALTH_URL, 1500)) {
    console.log('[honcho] local service already healthy at 127.0.0.1:8018')
    return true
  }
  const sourceDir = bundledHonchoSourceDir()
  if (!sourceDir) {
    console.warn('[honcho] bundled service files not found; Honcho will degrade to local memory fallback')
    return false
  }
  const serviceDir = prepareHonchoServiceDir(sourceDir)
  console.log(`[honcho] prepared service files at ${serviceDir}`)
  if (!(await ensureDockerAvailable())) return false
  const compose = await runCommand('docker', ['compose', 'up', '-d', '--build'], { cwd: serviceDir })
  if (!compose.ok) {
    console.warn('[honcho] docker compose up failed', (compose.stderr || compose.stdout || '').slice(-2000))
    return false
  }
  const healthy = await waitForHoncho()
  console.log(`[honcho] health=${healthy ? 'ok' : 'timeout'} url=${HONCHO_HEALTH_URL}`)
  return healthy
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

async function findFreePort(preferred = 3721) {
  for (const port of [preferred, 0]) {
    try {
      const actual = await new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          const address = server.address()
          server.close(() => resolve(address.port))
        })
      })
      return actual
    } catch {}
  }
  throw new Error('Unable to find a free local port')
}

function waitForBackend(port, timeoutMs = 30000) {
  const startedAt = Date.now()
  const url = `http://127.0.0.1:${port}/activation-status`

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Backend startup timed out'))
        return
      }

      const req = http.get(url, res => {
        res.resume()
        resolve()
      })
      req.on('error', () => setTimeout(tick, 300))
      req.setTimeout(1500, () => {
        req.destroy()
        setTimeout(tick, 300)
      })
    }

    tick()
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b0e',
    title: 'Jarvis Cognitive Surface',
    icon: path.join(RESOURCE_ROOT, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // 授予麦克风权限（语音输入需要）
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true
    return false
  })

  // 窗口级快捷键（不用 globalShortcut，避免劫持其他应用的 F11/Ctrl+R 等）
  //   F12      → 切换 DevTools
  //   F11      → 切换全屏
  //   Ctrl+R   → reload（仅 dev）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
      return
    }
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
      event.preventDefault()
      return
    }
    if (IS_DEV && (input.control || input.meta) && input.key.toLowerCase() === 'r') {
      mainWindow.webContents.reload()
      event.preventDefault()
      return
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[main] main window failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })

  await mainWindow.loadURL(`http://127.0.0.1:${backendPort}/brain-ui`)
  // 用户点击窗口关闭按钮时彻底退出应用。
  // 之前这里会拦截 close 并隐藏到菜单栏，导致用户以为已经关闭，实际后台仍在运行。
  mainWindow.on('close', () => {
    if (!app.isQuiting) {
      app.isQuiting = true
      app.quit()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}


function destroyTray() {
  if (!tray) return
  try { tray.destroy() } catch {}
  tray = null
}

function setupTray() {
  const iconPath = path.join(RESOURCE_ROOT, 'build', 'icon.ico')
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Bailongma')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => {
        showMainWindow()
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    showMainWindow()
  })
}

function createFocusBannerWindow({ task = '', current_step = '', tasks = [] } = {}) {
  if (focusBannerWindow && !focusBannerWindow.isDestroyed()) {
    focusBannerWindow.webContents.send('focus-banner:update', { task, current_step, tasks })
    return
  }

  const { width: screenW } = require('electron').screen.getPrimaryDisplay().workAreaSize

  focusBannerWindow = new BrowserWindow({
    width: 280,
    height: 60,
    x: Math.round(screenW / 2 - 140),
    y: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'focus-banner-preload.cjs'),
    },
  })

  // 给 banner 窗口的 session 也授权麦克风
  focusBannerWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })
  focusBannerWindow.webContents.session.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'media') return true
    return false
  })

  focusBannerWindow.loadFile(path.join(RESOURCE_ROOT, 'focus-banner.html'))

  focusBannerWindow.webContents.once('did-finish-load', () => {
    if (!focusBannerWindow || focusBannerWindow.isDestroyed()) return
    // 先发端口配置，让语音识别结果能发回后端
    focusBannerWindow.webContents.send('focus-banner:config', { port: backendPort })
    focusBannerWindow.webContents.send('focus-banner:update', { task, current_step, tasks })
    autoResizeBannerWindow()
  })

  focusBannerWindow.on('closed', () => {
    focusBannerWindow = null
  })
}

function autoResizeBannerWindow() {
  if (!focusBannerWindow || focusBannerWindow.isDestroyed()) return
  focusBannerWindow.webContents.executeJavaScript(`
    (() => {
      const b = document.getElementById('banner')
      return b ? { w: b.offsetWidth, h: b.offsetHeight } : null
    })()
  `).then(size => {
    if (!size || !focusBannerWindow || focusBannerWindow.isDestroyed()) return
    const padW = 0
    const padH = 0
    focusBannerWindow.setSize(Math.max(160, size.w + padW), Math.max(40, size.h + padH))
  }).catch(() => {})
}

// Focus Banner IPC handlers
ipcMain.on('focus-banner:close', () => {
  if (focusBannerWindow && !focusBannerWindow.isDestroyed()) {
    focusBannerWindow.close()
    focusBannerWindow = null
  }
})

ipcMain.on('focus-banner:set-expanded', (_e, { expanded }) => {
  if (!focusBannerWindow || focusBannerWindow.isDestroyed()) return
  setTimeout(() => autoResizeBannerWindow(), 50)
})

ipcMain.on('focus-banner:request-resize', () => {
  setTimeout(() => autoResizeBannerWindow(), 30)
})

ipcMain.on('focus-banner:toggle-task', (_e, { idx, done }) => {
  // 任务勾选状态更改，横幅已在前端自行更新，无需额外操作
})

// 后端 bridge 事件监听
focusBannerBridge.on('command', ({ action, task, current_step, tasks }) => {
  if (action === 'show' || action === 'update') {
    createFocusBannerWindow({ task, current_step, tasks })
  }
})

focusBannerBridge.on('hide', () => {
  if (focusBannerWindow && !focusBannerWindow.isDestroyed()) {
    focusBannerWindow.close()
    focusBannerWindow = null
  }
})

function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterStatus({ stage: 'checking' })
  })

  autoUpdater.on('update-available', info => {
    console.log('[updater] update available', info?.version)
    sendUpdaterStatus({ stage: 'available', version: info?.version })
  })

  autoUpdater.on('download-progress', progress => {
    sendUpdaterStatus({
      stage: 'downloading',
      percent: Number(progress?.percent || 0),
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
    })
  })

  autoUpdater.on('update-downloaded', info => {
    console.log('[updater] update downloaded', info?.version)
    sendUpdaterStatus({ stage: 'downloaded', version: info?.version })
    if (!IS_DEV) {
      setTimeout(() => {
        try { autoUpdater.quitAndInstall() } catch (err) { console.warn('[updater] auto install failed', err?.message || err) }
      }, 1800)
    }
  })

  autoUpdater.on('update-not-available', info => {
    sendUpdaterStatus({
      stage: 'up-to-date',
      version: info?.version || app.getVersion(),
    })
  })

  autoUpdater.on('error', err => {
    const message = err?.message || String(err || 'Update failed')
    console.warn('[updater] update failed', message)
    sendUpdaterStatus({ stage: 'error', message })
  })

  if (IS_DEV) {
    setTimeout(() => {
      checkDevUpdates({ autoApply: true }).catch(err => {
        sendUpdaterStatus({ stage: 'error', mode: 'dev', message: err?.message || String(err) })
      })
    }, 2500)
  } else {
    autoUpdater.checkForUpdates().catch(() => {})
  }
}


function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().catch(err => console.error('[main] failed to recreate main window', err?.stack || err?.message || String(err)))
    return
  }

  try {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
    mainWindow.moveTop()
    mainWindow.focus()

    // 防止窗口因为外接屏变化/坐标缓存等原因跑到屏幕外。
    const { screen } = require('electron')
    const display = screen.getDisplayMatching(mainWindow.getBounds()) || screen.getPrimaryDisplay()
    const work = display.workArea
    const bounds = mainWindow.getBounds()
    const visible = bounds.x < work.x + work.width && bounds.x + bounds.width > work.x && bounds.y < work.y + work.height && bounds.y + bounds.height > work.y
    if (!visible) {
      const w = Math.min(Math.max(bounds.width || 1280, 900), work.width)
      const h = Math.min(Math.max(bounds.height || 840, 600), work.height)
      mainWindow.setBounds({
        x: Math.round(work.x + (work.width - w) / 2),
        y: Math.round(work.y + (work.height - h) / 2),
        width: w,
        height: h,
      })
      mainWindow.show()
      mainWindow.focus()
    }
  } catch (err) {
    console.warn('[main] showMainWindow failed', err?.message || String(err))
  }
}

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('updater:check-for-updates', async () => {
  if (IS_DEV) {
    try {
      return await checkDevUpdates({ autoApply: false })
    } catch (error) {
      const message = error?.message || String(error || 'Dev update check failed')
      sendUpdaterStatus({ stage: 'error', mode: 'dev', message })
      return { ok: false, message, mode: 'dev' }
    }
  }
  try {
    sendUpdaterStatus({ stage: 'checking' })
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, updateInfo: result?.updateInfo || null }
  } catch (error) {
    const message = error?.message || String(error || 'Update check failed')
    sendUpdaterStatus({ stage: 'error', message })
    return { ok: false, message }
  }
})

ipcMain.handle('updater:start-download', async () => {
  try {
    if (IS_DEV) {
      const latest = await getLatestGitHubRelease()
      return await applyDevUpdate(latest.version)
    }
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error?.message || String(error || 'Download failed')
    sendUpdaterStatus({ stage: 'error', message })
    return { ok: false, message }
  }
})

ipcMain.handle('updater:quit-and-install', async () => {
  if (IS_DEV) {
    const latest = await getLatestGitHubRelease()
    return applyDevUpdate(latest.version)
  }
  autoUpdater.quitAndInstall()
})

app.on('second-instance', () => {
  showMainWindow()
})

// macOS: 点击 Dock 图标时 Electron 只会激活应用，不一定自动 show 已隐藏窗口。
// 用户之前关闭窗口后我们会 hide 到后台，所以这里必须显式把主界面拉出来。
app.on('activate', () => {
  showMainWindow()
})

app.on('before-quit', () => {
  app.isQuiting = true
  destroyTray()
})

app.on('window-all-closed', () => {
  // 关闭最后一个窗口后也彻底退出，避免 macOS 菜单栏图标继续常驻。
  app.quit()
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  try {
    await ensureBundledHoncho()
    backendPort = await findFreePort(3721)
    await bootstrapBackend(backendPort)
    await waitForBackend(backendPort)
  } catch (err) {
    dialog.showErrorBox('Startup failed', `Unable to start the Bailongma backend:\n${err.message}`)
    app.quit()
    return
  }

  await createWindow()
  setupTray()
  setupAutoUpdater()
  // 不再注册任何系统级 globalShortcut；F11 / F12 / Ctrl+R 已由 mainWindow
  // 的 before-input-event 处理（见 createWindow），只在窗口获焦时生效，
  // 不会劫持浏览器/IDE 等其他应用的同键操作。
})
