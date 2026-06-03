function normalizeText(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function truncate(value = '', max = 260) {
  const text = normalizeText(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

function stripTags(value = '') {
  return normalizeText(decodeXmlEntities(value).replace(/<br\s*\/?>/giu, '\n').replace(/<[^>]+>/gu, ' '))
}

function tagValue(xml = '', tag = '') {
  const safe = String(tag || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(xml || '').match(new RegExp(`<${safe}[^>]*>([\\s\\S]*?)<\\/${safe}>`, 'iu'))
  return match ? stripTags(match[1]) : ''
}

function attrValue(xml = '', attr = '') {
  const safe = String(attr || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(xml || '').match(new RegExp(`${safe}=["']([^"']+)["']`, 'iu'))
  return match ? decodeXmlEntities(match[1]) : ''
}

function firstUrl(text = '') {
  const match = String(text || '').match(/https?:\/\/[^\s<>'"）)]+/iu)
  return match ? match[0].replace(/[。。，，、；;]+$/u, '') : ''
}

function inferQuoteKind({ content = '', raw = '', messageType = '' } = {}) {
  const value = decodeXmlEntities(`${content}\n${raw}\n${messageType}`)
  if (/\[图片\]|<img\b|cdnmidimgurl|cdnbigimgurl|image\b|图片|照片|截图/iu.test(value)) return 'image'
  if (/\[语音\]|<voicemsg\b|voice|语音/iu.test(value)) return 'voice'
  if (/\[视频\]|<videomsg\b|video|视频/iu.test(value)) return 'video'
  if (/小程序|weappinfo|mini\s*program|mini_program/iu.test(value)) return 'mini_program'
  if (/\[链接\]|<url>|https?:\/\//iu.test(value)) return 'link'
  if (/\[表情\]|emoji|emoticon|sticker|表情/iu.test(value)) return 'emoji'
  return 'text'
}

function parseVisibleWechatQuote(text = '') {
  const value = normalizeText(text)
  if (!value) return null
  const patterns = [
    /^「([^：:\n]{1,80})[：:]([\s\S]{1,1200}?)」\s*(?:[-—–﹣－]\s*){2,}([\s\S]*)$/u,
    /^“([^”]{1,1200})”\s*(?:[-—–﹣－]\s*){2,}([\s\S]*)$/u,
  ]
  for (const re of patterns) {
    const match = value.match(re)
    if (!match) continue
    if (match.length === 4) {
      return {
        ok: true,
        source: 'visible_quote',
        sender: truncate(match[1], 80),
        content: truncate(match[2], 500),
        currentText: truncate(match[3], 500),
        kind: inferQuoteKind({ content: match[2] }),
      }
    }
    return {
      ok: true,
      source: 'visible_quote',
      sender: '',
      content: truncate(match[1], 500),
      currentText: truncate(match[2], 500),
      kind: inferQuoteKind({ content: match[1] }),
    }
  }
  return null
}

function parseReferMsg(raw = '') {
  const xml = decodeXmlEntities(String(raw || ''))
  if (!/<refermsg\b/i.test(xml)) return null
  const refer = xml.match(/<refermsg\b[^>]*>([\s\S]*?)<\/refermsg>/iu)?.[1] || xml
  const displayName = tagValue(refer, 'displayname') || tagValue(refer, 'nickname') || tagValue(refer, 'fromusr') || ''
  const content = tagValue(refer, 'content') || tagValue(refer, 'msgsource') || ''
  const svrid = tagValue(refer, 'svrid') || tagValue(refer, 'msgid') || tagValue(refer, 'newmsgid') || ''
  const createTime = tagValue(refer, 'createtime') || ''
  return {
    ok: true,
    source: 'refermsg_xml',
    sender: truncate(displayName, 80),
    content: truncate(content || '[引用消息]', 500),
    currentText: '',
    kind: inferQuoteKind({ content, raw: refer }),
    messageId: truncate(svrid, 80),
    createTime: truncate(createTime, 32),
  }
}

function parseAppMsg(raw = '') {
  const xml = decodeXmlEntities(String(raw || ''))
  if (!/<appmsg\b/i.test(xml) && !/<url>/i.test(xml) && !/<weappinfo\b/i.test(xml)) return null
  const title = tagValue(xml, 'title')
  const desc = tagValue(xml, 'des') || tagValue(xml, 'description')
  const url = tagValue(xml, 'url') || firstUrl(xml)
  const appName = tagValue(xml, 'appname') || tagValue(xml, 'sourcedisplayname')
  const type = tagValue(xml, 'type')
  const kind = /<weappinfo\b|小程序|\b33\b|\b36\b/iu.test(xml) ? 'mini_program'
    : /video|视频|\b4\b|\b6\b/iu.test(`${xml}\n${type}`) ? 'video'
      : 'link'
  if (!title && !desc && !url) return null
  return {
    ok: true,
    source: 'appmsg_xml',
    sender: appName,
    content: truncate([title, desc].filter(Boolean).join(' — ') || url || '[链接/小程序]', 520),
    currentText: '',
    kind,
    url: truncate(url, 260),
    appName: truncate(appName, 80),
  }
}

function parseMediaXml(raw = '') {
  const xml = decodeXmlEntities(String(raw || ''))
  if (/<voicemsg\b/i.test(xml)) {
    const len = attrValue(xml, 'voicelength') || attrValue(xml, 'length')
    return { ok: true, source: 'media_xml', sender: '', content: len ? `[语音] 时长约 ${len}ms` : '[语音]', currentText: '', kind: 'voice' }
  }
  if (/<videomsg\b|<video\b/i.test(xml)) {
    const len = attrValue(xml, 'length') || attrValue(xml, 'playlength')
    return { ok: true, source: 'media_xml', sender: '', content: len ? `[视频] 大小/时长标记 ${len}` : '[视频]', currentText: '', kind: 'video' }
  }
  if (/<img\b/i.test(xml)) {
    const len = attrValue(xml, 'length') || attrValue(xml, 'hdlength')
    return { ok: true, source: 'media_xml', sender: '', content: len ? `[图片] 原始大小标记 ${len}` : '[图片]', currentText: '', kind: 'image' }
  }
  return null
}

function extractMessageIds(raw = '') {
  const xml = decodeXmlEntities(String(raw || ''))
  const ids = new Set()
  for (const tag of ['svrid', 'msgid', 'newmsgid', 'clientmsgid']) {
    const value = tagValue(xml, tag)
    if (value) ids.add(value)
  }
  for (const attr of ['msgid', 'newmsgid', 'cdnthumbaeskey', 'cdnmidimgurl', 'cdnbigimgurl']) {
    const value = attrValue(xml, attr)
    if (value) ids.add(value)
  }
  for (const match of xml.matchAll(/\b(?:svrid|msgid|newmsgid|clientmsgid)\b["'\s:=]+([A-Za-z0-9_-]{4,})/giu)) {
    ids.add(match[1])
  }
  return [...ids].map(v => String(v || '').trim()).filter(Boolean).slice(0, 12)
}

export function extractWeChatQuoteContext({ text = '', rawText = '', messageType = '' } = {}) {
  const visible = parseVisibleWechatQuote(text) || parseVisibleWechatQuote(rawText)
  const refer = parseReferMsg(rawText)
  const appmsg = parseAppMsg(rawText)
  const media = parseMediaXml(rawText)
  const quote = visible || refer || appmsg || media
  if (!quote) return { ok: false }
  const kind = inferQuoteKind({ content: quote.content, raw: rawText, messageType: quote.kind || messageType })
  return {
    ok: true,
    ...quote,
    kind,
    messageIds: extractMessageIds(`${rawText}\n${quote.messageId || ''}`),
    content: truncate(quote.content, 520),
    currentText: truncate(quote.currentText || '', 520),
    tokenPolicy: 'compact_only_no_xml_no_base64',
  }
}

export function buildWeChatQuoteContextBlock({ text = '', rawText = '', messageType = '' } = {}) {
  const quote = extractWeChatQuoteContext({ text, rawText, messageType })
  if (!quote.ok) return ''
  const lines = [
    '<wechat-quoted-message compact="true">',
    `类型：${quote.kind || 'unknown'}；来源：${quote.source || 'unknown'}；省 token 策略：只给摘要/元数据，不给原始 XML、base64、完整历史。`,
  ]
  if (quote.sender) lines.push(`被引用发送者：${quote.sender}`)
  if (quote.createTime) lines.push(`被引用时间标记：${quote.createTime}`)
  if (quote.messageId) lines.push(`被引用消息ID：${quote.messageId}`)
  if (quote.appName) lines.push(`应用/来源：${quote.appName}`)
  if (quote.url) lines.push(`链接：${quote.url}`)
  lines.push(`被引用内容摘要：${quote.content || '[空引用]'}`)
  if (quote.currentText) lines.push(`引用后的当前请求：${quote.currentText}`)
  lines.push('回复规则：如果用户的问题依赖这条引用，优先基于这里回答；需要说明依据时只用一句短引用，例如“引用 @某某：……”。如果不依赖引用，就不要额外复述引用。')
  lines.push('媒体规则：图片引用优先结合 <wechat-image-memory> 的图片描述；语音没有转写时只能说明“我能看到是语音但没有转写内容”，不能编造语音文字；链接/小程序/视频只按标题、描述、URL 元数据判断。')
  lines.push('</wechat-quoted-message>')
  return lines.join('\n')
}
