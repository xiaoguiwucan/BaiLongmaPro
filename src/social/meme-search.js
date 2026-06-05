import crypto from 'crypto'
import { getWechatMemeConfig } from '../config.js'
import { isLikelyPublicImageUrl, normalizePublicImageUrl } from './public-image-url.js'

const SAFE_QUERY_BLOCK_RE = /(裸|色情|成人视频|黄色|三级片|露点|血腥|恐怖袭击|自杀|身份证|银行卡|密码|token|api\s*key)/iu

function toolResult(payload) {
  return JSON.stringify(payload, null, 2)
}

function cleanQuery(value = '') {
  return String(value || '')
    .replace(/^[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]{1,40}/u, '')
    .replace(/(?:来|发|给|整|找|搜|搞)?(?:一?个|一?张|点)?(?:表情包|表情|梗图|斗图|gif|GIF|图片|图)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

function isAllowedMemeUrl(url = '', config = getWechatMemeConfig()) {
  const normalized = normalizePublicImageUrl(url, { httpsOnly: true })
  if (!normalized) return false
  let host = ''
  try { host = new URL(normalized).hostname.toLowerCase() } catch { return false }
  const domains = Array.isArray(config.allowedDomains) ? config.allowedDomains : []
  if (domains.length && !domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return false
  if (!config.allowGif && /\.gif(?:[?#].*)?$/iu.test(normalized)) return false
  return isLikelyPublicImageUrl(normalized, { allowedDomains: domains, httpsOnly: true })
}

function scoreMemeItem(item = {}, query = '') {
  const url = String(item.url || item.img_url || '')
  const width = Number(item.width || item.img_width || 0)
  const height = Number(item.height || item.img_height || 0)
  const size = Number(item.size || item.img_size || 0)
  let score = 0
  if (/\.gif(?:[?#].*)?$/iu.test(url)) score += 3
  if (width >= 120 && height >= 120) score += 2
  if (width <= 600 && height <= 600) score += 1
  if (size > 0 && size <= 2 * 1024 * 1024) score += 1
  if (/biaoqing\.gtimg\.com/iu.test(url)) score += 2
  if (/tugelepic\.mse\.sogou\.com/iu.test(url)) score += 1
  if (query && decodeURIComponent(url).includes(query)) score += 1
  return score
}


function shuffleDeterministic(items = [], seed = '') {
  const list = [...items]
  const salt = seed || `${Date.now()}-${Math.random()}`
  return list
    .map((item, index) => {
      const hash = crypto.createHash('sha1').update(`${salt}:${item.url}:${index}`).digest('hex')
      return { item, rank: hash }
    })
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map(row => row.item)
}

function diversifyMemeItems(items = [], query = '', seed = '') {
  if (!items.length) return []
  const scored = items.map(item => ({ ...item, _score: scoreMemeItem(item, query) }))
  const maxScore = Math.max(...scored.map(item => item._score || 0))
  // 只在高质量候选池里随机，避免永远第一张，也避免随机到尺寸/域名明显差的图。
  const pool = scored.filter(item => Number(item._score || 0) >= maxScore - 2)
  const picked = shuffleDeterministic(pool.length >= 3 ? pool : scored, seed)
  return picked.map(({ _score, ...item }) => item)
}

export async function searchMemes({ query = '', provider = 'xiaoapi', count = null, page = 1, seed = '' } = {}) {
  const config = getWechatMemeConfig()
  if (config.enabled === false) return { ok: false, tool: 'meme_search', error: 'meme search disabled' }
  const clean = cleanQuery(query) || '表情包'
  if (SAFE_QUERY_BLOCK_RE.test(clean)) return { ok: false, tool: 'meme_search', error: 'query blocked by meme safety filter', query: clean }
  const limit = Math.min(Math.max(Number(count || config.searchCount || 10), 1), 40)
  const endpoint = config.endpoint || 'https://api.suol.cc/v1/meme.php'
  if (provider && provider !== 'xiaoapi') return { ok: false, tool: 'meme_search', error: `unsupported provider: ${provider}` }
  const url = new URL(endpoint)
  url.searchParams.set('msg', clean)
  url.searchParams.set('page', String(Math.max(Number(page || 1), 1)))
  url.searchParams.set('num', String(limit))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Bailongma/WechatMemeSearch' }, signal: controller.signal })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    if (!res.ok || !json) return { ok: false, tool: 'meme_search', status: res.status, error: 'invalid meme api response', preview: text.slice(0, 300) }
    const rawItems = Array.isArray(json.data) ? json.data : []
    const itemsRaw = rawItems.map(row => {
      const imageUrl = normalizePublicImageUrl(row.img_url || row.url || '', { httpsOnly: true })
      return {
        url: imageUrl,
        width: Number(row.img_width || row.width || 0),
        height: Number(row.img_height || row.height || 0),
        size: Number(row.img_size || row.size || 0),
        type: /\.gif(?:[?#].*)?$/iu.test(imageUrl) ? 'gif' : 'image',
        source: 'xiaoapi',
      }
    }).filter(item => item.url && isAllowedMemeUrl(item.url, config))
    const items = diversifyMemeItems(itemsRaw, clean, seed || `${clean}:${Date.now()}`).slice(0, limit)
    return { ok: true, tool: 'meme_search', provider: 'xiaoapi', query: clean, endpoint: url.toString(), randomized: true, count: items.length, items }
  } catch (err) {
    return { ok: false, tool: 'meme_search', provider: 'xiaoapi', query: clean, error: err?.name === 'AbortError' ? 'request timeout' : (err?.message || String(err)) }
  } finally {
    clearTimeout(timer)
  }
}

export function execMemeSearch(args = {}) {
  return searchMemes(args).then(toolResult)
}

export function getMemeSafetySummary() {
  const config = getWechatMemeConfig()
  return {
    enabled: config.enabled,
    provider: config.provider,
    maxPerMessage: config.maxPerMessage,
    cooldownSeconds: config.cooldownSeconds,
    allowedDomains: config.allowedDomains,
  }
}
