function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stripLeadingWechatMentions(text = '') {
  let value = String(text || '').trim()
  for (let i = 0; i < 5; i++) {
    const next = value.replace(/^[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]{1,40}[\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]*/u, '').trim()
    if (next === value) break
    value = next
  }
  return value
}

function cleanAlias(value = '') {
  return normalizeText(value)
    .replace(/[。！？!?，,；;：:、"'“”‘’`~]+$/u, '')
    .replace(/^(叫|为|成|是)/u, '')
    .trim()
    .slice(0, 24)
}

function isUsableAlias(alias = '') {
  if (!alias) return false
  if (alias.length > 24) return false
  if (/^(一下|看看|这个|那个|什么|谁|你|我|他|她|它|大家|群友|文件|桌面)$/u.test(alias)) return false
  return /[\u4e00-\u9fa5A-Za-z0-9]/u.test(alias)
}

function displayMember(senderName = '', senderId = '') {
  return normalizeText(senderName || senderId || '这个群成员')
}

export function extractWeChatExplicitMemories({ text = '', senderName = '', senderId = '' } = {}) {
  const body = stripLeadingWechatMentions(text)
  const value = normalizeText(body || text)
  if (!value) return []

  const member = displayMember(senderName, senderId)
  const results = []

  const aliasPatterns = [
    /(?:以后|以后都|之后|以后你|你以后|以后在群里|从今以后)?(?:就)?(?:叫|喊|称呼)我(?:为|叫|做)?\s*([\u4e00-\u9fa5A-Za-z0-9_·.\-]{1,24})/u,
    /(?:你可以|可以|以后可以)?叫我\s*([\u4e00-\u9fa5A-Za-z0-9_·.\-]{1,24})/u,
    /(?:我的名字|我名字|我的昵称|我昵称|我在群里叫|我叫)\s*(?:是|叫)?\s*([\u4e00-\u9fa5A-Za-z0-9_·.\-]{1,24})/u,
  ]
  for (const pattern of aliasPatterns) {
    const match = value.match(pattern)
    const alias = cleanAlias(match?.[1] || '')
    if (!isUsableAlias(alias)) continue
    results.push({
      category: 'member_alias',
      content: `群成员「${member}」希望小白龙在本群称呼他/她为「${alias}」。以后在本群回复该成员时优先使用这个称呼。`,
      groupContent: `本群称呼记忆：群成员「${member}」希望小白龙称呼他/她为「${alias}」。如果有人问“谁是${alias}”或“谁让你这么叫”，应根据本群记忆回答。`,
    })
    break
  }

  const rolePatterns = [
    /我(?:就是|是|当|做)?你(?:的)?\s*(大哥|哥|老大|老板|师傅|师父|领导|主人)/u,
    /以后(?:我|你)?(?:就是|叫我|喊我|称呼我为?)\s*(大哥|哥|老大|老板|师傅|师父|领导|主人)/u,
  ]
  for (const pattern of rolePatterns) {
    const match = value.match(pattern)
    const role = cleanAlias(match?.[1] || '')
    if (!isUsableAlias(role)) continue
    results.push({
      category: 'member_role',
      content: `群成员「${member}」在本群设定自己是小白龙的「${role}」。以后该成员或本群其他人问相关身份时，应回答「${member}」是小白龙的「${role}」。`,
      groupContent: `本群身份记忆：群成员「${member}」是小白龙的「${role}」。如果有人问“小白龙的${role}是谁”或“谁是你${role}”，应回答「${member}」。`,
    })
    break
  }

  const rememberPattern = value.match(/(?:记住|记一下|记住了).{0,8}(我|我是|我的称呼是|我的身份是)\s*([\u4e00-\u9fa5A-Za-z0-9_·.\-]{1,24})/u)
  const remembered = cleanAlias(rememberPattern?.[2] || '')
  if (isUsableAlias(remembered)) {
    results.push({
      category: 'member_declared_memory',
      content: `群成员「${member}」要求小白龙在本群记住：他/她是「${remembered}」。后续本群相关提问应优先使用这条记忆。`,
      groupContent: `本群成员记忆：群成员「${member}」声明自己是「${remembered}」。`,
    })
  }

  const seen = new Set()
  return results.filter(item => {
    const key = `${item.category}:${item.content}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
