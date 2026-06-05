import { getWebSearchCredentials } from '../config.js'
import { isLikelyPublicImageUrl, normalizePublicImageUrl } from './public-image-url.js'

const IMAGE_TITLE_MAX = 160
const IMAGE_SEARCH_TIMEOUT_MS = 12000
const IMAGE_SAFE_QUERY_BLOCK_RE = /(?:裸照|色情|成人视频|未成年|身份证|银行卡|密码|token|api\s*key|私钥|本机|桌面|相册|截图|file:\/\/|\/Users\/)/iu

function normalizeText(value = '', max = IMAGE_TITLE_MAX) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function dedupeImages(items = [], limit = 8) {
  const out = []
  const seen = new Set()
  for (const item of items) {
    const url = normalizePublicImageUrl(item?.url)
    if (!url || !isLikelyPublicImageUrl(url)) continue
    const key = url.replace(/[?#].*$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      title: normalizeText(item.title || item.source || '网络图片'),
      url,
      thumbnail: normalizePublicImageUrl(item.thumbnail || ''),
      pageUrl: normalizePublicImageUrl(item.pageUrl || ''),
      source: normalizeText(item.source || '', 80),
      provider: item.provider || 'unknown',
    })
    if (out.length >= limit) break
  }
  return out
}

function createTimeoutSignal(ms = IMAGE_SEARCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(ms || IMAGE_SEARCH_TIMEOUT_MS)))
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) }
}

function parseBraveImageResults(data = {}, limit = 8) {
  const rows = Array.isArray(data.results) ? data.results : Array.isArray(data.images?.results) ? data.images.results : []
  const items = rows.map(row => {
    const direct = row.properties?.url || row.thumbnail?.src || row.url || row.src || ''
    return {
      title: row.title || row.alt || row.source || '',
      url: direct,
      thumbnail: row.thumbnail?.src || row.thumbnail || '',
      pageUrl: row.url || row.page_url || '',
      source: row.source || row.meta_url?.hostname || '',
      provider: 'brave_images',
    }
  })
  return dedupeImages(items, limit)
}

async function braveImageSearchWithKey({ query, count, key, keyIndex = 0, signal }) {
  const url = new URL('https://api.search.brave.com/res/v1/images/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(Math.max(count, 1), 20)))
  url.searchParams.set('safesearch', 'moderate')
  url.searchParams.set('search_lang', /[㐀-鿿豈-﫿]/.test(query) ? 'zh-hans' : 'en')
  const timeout = createTimeoutSignal()
  const finalSignal = signal || timeout.signal
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
        'User-Agent': 'Bailongma/BraveImageSearch',
      },
      signal: finalSignal,
    })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch {}
    if (!res.ok) {
      return { ok: false, provider: 'brave_images', keyIndex, status: res.status, quotaLike: [401, 402, 403, 429].includes(res.status), reason: `http ${res.status}: ${text.slice(0, 180)}` }
    }
    const items = parseBraveImageResults(data || {}, count)
    if (!items.length) return { ok: false, provider: 'brave_images', keyIndex, reason: 'empty image results' }
    return { ok: true, provider: 'brave_images', keyIndex, items }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return { ok: false, provider: 'brave_images', keyIndex, reason: `network: ${err?.message || err}` }
  } finally {
    timeout.cleanup()
  }
}

function parseBingImageResults(html = '', limit = 8) {
  const items = []
  const patterns = [
    /"murl"\s*:\s*"([^"]+)"/giu,
    /&quot;murl&quot;\s*:\s*&quot;([^&]+)&quot;/giu,
  ]
  for (const re of patterns) {
    let match
    while ((match = re.exec(html)) !== null) {
      const raw = match[1]
      let url = raw
      try { url = decodeURIComponent(raw.replace(/\\u0026/g, '&').replace(/\\\//g, '/')) } catch {}
      items.push({ title: 'Bing 图片结果', url, provider: 'bing_images', source: 'bing' })
      if (items.length >= limit * 3) break
    }
    if (items.length) break
  }
  return dedupeImages(items, limit)
}

async function searchViaBingImages({ query, count, signal }) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`
  const timeout = createTimeoutSignal(15000)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: signal || timeout.signal,
    })
    if (!res.ok) return { ok: false, provider: 'bing_images', reason: `http ${res.status}` }
    const html = await res.text()
    const items = parseBingImageResults(html, count)
    if (!items.length) return { ok: false, provider: 'bing_images', reason: 'parsed 0 images' }
    return { ok: true, provider: 'bing_images', items }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return { ok: false, provider: 'bing_images', reason: `network: ${err?.message || err}` }
  } finally {
    timeout.cleanup()
  }
}

export async function searchPublicImages({ query = '', count = 8, provider = 'auto', signal } = {}) {
  const clean = normalizeText(query, 80)
  const limit = Math.min(Math.max(Number(count) || 8, 1), 12)
  if (!clean) return { ok: false, tool: 'public_image_search', error: 'missing query' }
  if (IMAGE_SAFE_QUERY_BLOCK_RE.test(clean)) return { ok: false, tool: 'public_image_search', error: 'query blocked by image safety filter', query: clean }
  const failures = []
  const { braveKeys = [] } = getWebSearchCredentials()

  if ((provider === 'auto' || provider === 'brave') && braveKeys.length) {
    for (let i = 0; i < braveKeys.length; i++) {
      const result = await braveImageSearchWithKey({ query: clean, count: limit, key: braveKeys[i], keyIndex: i, signal })
      if (result.ok) return { ok: true, tool: 'public_image_search', provider: result.provider, keyIndex: result.keyIndex, query: clean, count: result.items.length, items: result.items }
      failures.push({ provider: result.provider, keyIndex: result.keyIndex, reason: result.reason || `status ${result.status || 'unknown'}` })
      if (!result.quotaLike && provider === 'brave') break
    }
  } else if (provider === 'brave') {
    failures.push({ provider: 'brave_images', reason: 'no brave key configured' })
  }

  if (provider === 'auto' || provider === 'bing') {
    const result = await searchViaBingImages({ query: clean, count: limit, signal })
    if (result.ok) return { ok: true, tool: 'public_image_search', provider: result.provider, query: clean, count: result.items.length, items: result.items }
    failures.push({ provider: result.provider, reason: result.reason || 'unknown' })
  }

  return { ok: false, tool: 'public_image_search', query: clean, error: `all image search providers failed (${failures.map(f => `${f.provider}${Number.isInteger(f.keyIndex) ? `#${f.keyIndex + 1}` : ''}: ${f.reason}`).join('; ') || 'no provider'})`, failures }
}
