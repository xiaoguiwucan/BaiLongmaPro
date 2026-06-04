import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { paths } from '../paths.js'
import { normalizeWeChatGroupReportTemplate, renderWeChatGroupStatsPosterHtml } from './wechat-group-report-template.js'

function safeFilePart(value = '') {
  return String(value || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'group'
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
    path.join(paths.homeDir || process.env.HOME || '', 'Library/Caches/ms-playwright'),
    path.join(paths.homeDir || process.env.HOME || '', '.cache/ms-playwright'),
  ]
  try {
    for (const cacheDir of cacheDirs) {
      if (!cacheDir || !fsSync.existsSync(cacheDir)) continue
      for (const name of fsSync.readdirSync(cacheDir)) {
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
  return candidates.find(file => file && fsSync.existsSync(file)) || ''
}

export async function renderWeChatGroupStatsPosterPng(stats = {}, { templateId = 'guochao-red-gold', outDir = '' } = {}) {
  if (!stats?.ok) return { ok: false, error: 'stats unavailable' }
  const template = normalizeWeChatGroupReportTemplate(templateId)
  const dir = path.resolve(outDir || path.join(paths.dataDir, 'wechat-report-posters'))
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
  const base = `${safeFilePart(stats.group_name || stats.group_id)}-${template}-${stamp}`
  const htmlPath = path.join(dir, `${base}.html`)
  const pngPath = path.join(dir, `${base}.png`)
  const html = renderWeChatGroupStatsPosterHtml(stats, { templateId: template })
  await fs.writeFile(htmlPath, html)
  // Playwright 新版本默认找体积更小的 chromium_headless_shell。
  // 本地/发布环境经常只有普通 Chromium 或 Chrome/Edge，因此这里主动兜底，
  // 避免群聊总结长图渲染失败后回退成文字。
  const executablePath = resolveChromiumExecutable()
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 })
    await page.goto('file://' + htmlPath, { waitUntil: 'load' })
    await page.screenshot({ path: pngPath, fullPage: true, type: 'png' })
    await page.close()
  } finally {
    await browser.close().catch(() => {})
  }
  return { ok: true, template, htmlPath, filePath: pngPath, contentType: 'image/png' }
}
