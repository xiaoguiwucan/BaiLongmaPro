const IMAGE_URL_MAX = 900
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/iu
const IMAGE_HINT_QUERY_RE = /[?&](?:(?:format|type|mime|image|img|pic|photo|thumb)=|[^=&#]*(?:image|img|pic|photo|thumb)[^=&#]*=)/iu
const DEFAULT_EXTENSIONLESS_IMAGE_HOSTS = ['biaoqing.gtimg.com', 'tugelepic.mse.sogou.com']

function normalizeDomain(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
}

function hostMatchesDomain(host = '', domain = '') {
  const h = normalizeDomain(host)
  const d = normalizeDomain(domain)
  return !!h && !!d && (h === d || h.endsWith(`.${d}`))
}

function isPrivateOrLocalHost(host = '') {
  const h = normalizeDomain(host)
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (/^(?:127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.)/u.test(h)) return true
  if (/^172\.(?:1[6-9]|2\d|3[0-1])\./u.test(h)) return true
  if (/^\[?::1\]?$/u.test(h)) return true
  return false
}

export function normalizePublicImageUrl(value = '', { httpsOnly = false, maxLength = IMAGE_URL_MAX } = {}) {
  const raw = String(value || '').trim().replace(/&amp;/g, '&')
  if (!raw || raw.length > maxLength || /[\s<>"'`]/u.test(raw)) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) return ''
    if (isPrivateOrLocalHost(url.hostname)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function isLikelyPublicImageUrl(value = '', {
  allowedDomains = [],
  extensionlessImageHosts = DEFAULT_EXTENSIONLESS_IMAGE_HOSTS,
  httpsOnly = false,
} = {}) {
  const url = normalizePublicImageUrl(value, { httpsOnly })
  if (!url) return false
  let parsed = null
  try { parsed = new URL(url) } catch { return false }
  const host = parsed.hostname.toLowerCase()
  if (IMAGE_EXT_RE.test(url) || IMAGE_HINT_QUERY_RE.test(url)) return true
  const trustedHosts = [...extensionlessImageHosts, ...allowedDomains]
    .map(normalizeDomain)
    .filter(Boolean)
  return trustedHosts.some(domain => hostMatchesDomain(host, domain))
}

export function extractPublicImageUrlsFromText(content = '', options = {}) {
  const text = String(content || '')
  const urls = new Set()
  for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/giu)) {
    const url = normalizePublicImageUrl(match[1], options)
    if (url && isLikelyPublicImageUrl(url, options)) urls.add(url)
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`）)]+/giu)) {
    const raw = match[0].replace(/[。。，，、；;]+$/u, '')
    const url = normalizePublicImageUrl(raw, options)
    if (url && isLikelyPublicImageUrl(url, options)) urls.add(url)
  }
  return [...urls].slice(0, 3)
}

export function stripImageUrlsFromText(content = '', imageUrls = []) {
  let text = String(content || '')
  for (const url of imageUrls) {
    const escaped = String(url || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!escaped) continue
    text = text.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    text = text.replace(new RegExp(`\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    text = text.replace(new RegExp(escaped, 'g'), '')
  }
  return text
    .replace(/https?:\/\/[^\s<>"'`）)]+/giu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
