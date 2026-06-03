// 语音服务进程管理：启动/停止本地 ASR Python 服务
// 兼容开发模式和 Electron 打包后（asarUnpack）两种路径
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const VOICE_WS_PORT = 3723

const DEFAULT_LOCAL_MODEL = 'sensevoice-small'
const SENSEVOICE_MODELS = new Set(['sensevoice-small'])
const WHISPER_MODELS = new Set(['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large', 'large-v2', 'large-v3', 'turbo'])

let proc = null
let status = 'stopped'  // 'stopped' | 'starting' | 'running' | 'error'
let statusMessage = ''
let currentModel = null
let currentEngine = null

export function normalizeLocalAsrModel(model = DEFAULT_LOCAL_MODEL) {
  const value = String(model || '').trim().toLowerCase()
  if (SENSEVOICE_MODELS.has(value)) return value
  if (WHISPER_MODELS.has(value)) return value
  // 兼容旧配置：之前只保存了 whisperModel=small。
  if (value === 'whisper') return 'small'
  return DEFAULT_LOCAL_MODEL
}

function engineForModel(model) {
  const normalized = normalizeLocalAsrModel(model)
  return SENSEVOICE_MODELS.has(normalized) ? 'sensevoice' : 'whisper'
}

// 解析语音服务的启动方式：
//   打包模式 → 优先用 extraResources 中的 exe（无需 Python）
//   开发模式 → 用 Python + 对应 server.py
function resolveServer(engine) {
  const scriptName = engine === 'sensevoice' ? 'sensevoice_server.py' : 'whisper_server.py'
  const exeName = engine === 'sensevoice' ? 'sensevoice_server.exe' : 'whisper_server.exe'
  const resourcesDir = process.env.BAILONGMA_RESOURCES_DIR
  if (resourcesDir && resourcesDir.endsWith('.asar')) {
    const resourcesPath = path.dirname(resourcesDir)
    const exe = path.join(resourcesPath, 'voice', exeName)
    if (fs.existsSync(exe)) return { mode: 'exe', path: exe }

    const py = path.join(
      resourcesDir.replace(/\.asar$/, '.asar.unpacked'),
      'src', 'voice', scriptName,
    )
    if (fs.existsSync(py)) return { mode: 'python', path: py }
  }
  return { mode: 'python', path: path.join(__dirname, scriptName) }
}

function findPython() {
  const candidates = []
  if (process.env.BAILONGMA_PYTHON) candidates.push(process.env.BAILONGMA_PYTHON)
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.cwd(), '.venv-whisper', 'Scripts', 'python.exe'),
      'python',
    )
  } else {
    candidates.push(
      path.join(process.cwd(), '.venv-whisper', 'bin', 'python'),
      path.join(path.resolve(__dirname, '..', '..'), '.venv-whisper', 'bin', 'python'),
      'python3.11',
      'python3.12',
      'python3',
    )
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue
    return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function getVoiceStatus() {
  return {
    status,
    message: statusMessage,
    port: VOICE_WS_PORT,
    pid: proc?.pid ?? null,
    engine: currentEngine,
    model: currentModel,
  }
}

export function startVoiceServer({ model = DEFAULT_LOCAL_MODEL, localAsrModel } = {}) {
  const requestedModel = normalizeLocalAsrModel(localAsrModel || model)
  const requestedEngine = engineForModel(requestedModel)

  if (proc) {
    if (currentModel === requestedModel && currentEngine === requestedEngine) return getVoiceStatus()
    return restartVoiceServer(requestedModel)
  }

  const server = resolveServer(requestedEngine)

  if (server.mode !== 'exe' && !fs.existsSync(server.path)) {
    status = 'error'
    statusMessage = `找不到语音服务脚本: ${server.path}`
    console.error(`[Voice] ${statusMessage}`)
    return getVoiceStatus()
  }

  status = 'starting'
  currentModel = requestedModel
  currentEngine = requestedEngine
  statusMessage = requestedEngine === 'sensevoice'
    ? '正在加载 SenseVoiceSmall（中文优先）…'
    : `正在加载 Whisper (${requestedModel})…`

  const spawnArgs = ['--model', requestedModel, '--port', String(VOICE_WS_PORT)]
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  if (server.mode === 'exe') {
    console.log(`[Voice] 启动语音服务 (${requestedEngine}/exe): ${server.path} --model ${requestedModel}`)
    proc = spawn(server.path, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
  } else {
    console.log(`[Voice] 启动语音服务 (${requestedEngine}/python): ${server.path} --model ${requestedModel}`)
    proc = spawn(findPython(), [server.path, ...spawnArgs], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
  }

  proc.stdout.on('data', (data) => {
    for (const line of data.toString('utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      console.log(`[Voice] ${trimmed}`)
      if (trimmed.includes('WebSocket 服务启动') || trimmed.includes('ws://')) {
        status = 'running'
        statusMessage = `运行中 (${currentEngine}, port ${VOICE_WS_PORT})`
      } else if (trimmed.includes('加载') || trimmed.includes('load')) {
        statusMessage = trimmed.replace('[语音] ', '')
      }
    }
  })

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim()
    if (text) console.error(`[Voice] ${text}`)
  })

  proc.on('exit', (code, signal) => {
    console.log(`[Voice] 进程退出: code=${code} signal=${signal}`)
    proc = null
    status = code === 0 ? 'stopped' : 'error'
    statusMessage = code === 0 ? '已停止' : `异常退出 (code ${code})`
    if (code === 0) {
      currentModel = null
      currentEngine = null
    }
  })

  proc.on('error', (err) => {
    console.error('[Voice] 无法启动语音服务:', err.message)
    proc = null
    status = 'error'
    statusMessage = `语音服务启动失败: ${err.message}`
    currentModel = null
    currentEngine = null
  })

  return getVoiceStatus()
}

export function stopVoiceServer() {
  if (!proc) return getVoiceStatus()
  try { proc.kill('SIGTERM') } catch {}
  proc = null
  status = 'stopped'
  statusMessage = '已停止'
  currentModel = null
  currentEngine = null
  return getVoiceStatus()
}

export function restartVoiceServer(model = DEFAULT_LOCAL_MODEL) {
  stopVoiceServer()
  const nextModel = normalizeLocalAsrModel(model)
  setTimeout(() => startVoiceServer({ model: nextModel }), 500)
  return getVoiceStatus()
}
