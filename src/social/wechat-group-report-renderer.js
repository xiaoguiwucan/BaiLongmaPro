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
  try { candidates.push(chromium.executablePath()) } catch {}
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  )
  try {
    const cacheDir = path.join(paths.homeDir || process.env.HOME || '', 'Library/Caches/ms-playwright')
    if (fsSync.existsSync(cacheDir)) {
      for (const name of fsSync.readdirSync(cacheDir)) {
        candidates.push(
          path.join(cacheDir, name, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
          path.join(cacheDir, name, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
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
  // Playwright newer versions default to the smaller `chromium_headless_shell`.
  // In local/release installs that shell is often missing while the regular
  // "Chrome for Testing" binary exists, causing digest posters to fall back to
  // plain text. Force the regular Chromium executable so HTML/CSS reports
  // render into a PNG reliably.
  const executablePath = resolveChromiumExecutable()
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })
    await page.goto('file://' + htmlPath, { waitUntil: 'load' })
    await page.screenshot({ path: pngPath, fullPage: false, type: 'png' })
    await page.close()
  } finally {
    await browser.close().catch(() => {})
  }
  return { ok: true, template, htmlPath, filePath: pngPath, contentType: 'image/png' }
}
