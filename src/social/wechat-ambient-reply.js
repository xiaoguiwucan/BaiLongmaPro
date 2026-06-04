import { getRecentWeChatGroupMessages } from './wechat-groups.js'

export const WECHAT_AMBIENT_POSITIVE_RULES = [
  { id: 'explicit_mention', label: '显式 @ 机器人', score: '强制触发' },
  { id: 'bot_name_reference', label: '提到机器人昵称/别称但没有 @', score: 45 },
  { id: 'group_question', label: '明显向群里求助/提问', score: 30 },
  { id: 'unanswered_question', label: '问题短时间没人回答', score: 25 },
  { id: 'bot_capability_match', label: '涉及总结、查记录、写文档、识图、视频、表情包、文件生成', score: 25 },
  { id: 'memory_context_needed', label: '需要群记忆/群友记忆/聊天记录才能接上的话题', score: 20 },
  { id: 'ai_opinion_request', label: '群里有人说 AI/机器人/小风怎么看', score: 35 },
  { id: 'banter_opportunity', label: '梗、吐槽、玩笑可接', score: '安静 +5 / 正常 +10 / 活跃 +18 / 发疯 +28' },
  { id: 'quiet_opening', label: '群冷场且上文有明显可接话点', score: 10 },
  { id: 'image_vision_done', label: '图片已解析完成，可基于真实图片内容接话', score: 40 },
  { id: 'image_context_relevant', label: '图片内容与最近群聊/引用/说明文字相关', score: 20 },
  { id: 'image_llm_review_reply', label: '图片接话轻量复核建议接话', score: '补足临界判断' },
]

export const WECHAT_AMBIENT_NEGATIVE_RULES = [
  { id: 'self_message', label: '机器人自己发的消息', score: '直接忽略' },
  { id: 'group_not_enabled', label: '群未开启自由回复', score: '直接忽略' },
  { id: 'two_person_thread', label: '明显两个人连续私聊', score: -35 },
  { id: 'flooding', label: '群里刷屏', score: -25 },
  { id: 'low_information', label: '纯表情/低信息短句', score: -20 },
  { id: 'recent_assistant_unanswered', label: '上一条机器人回复无人接', score: -20 },
  { id: 'sensitive_or_dangerous', label: '争吵、隐私、资金、账号、本机文件、危险命令', score: '非 @ 默认沉默' },
  { id: 'guard_blocked_non_mention', label: '安全黑名单非 @', score: '默认沉默' },
  { id: 'guard_blocked_mention', label: '安全黑名单 @ 机器人', score: '走现有安全拒绝' },
  { id: 'image_vision_not_ready_after_retries', label: '图片三次查询后仍未解析完成', score: '放弃本轮，不胡编' },
  { id: 'image_content_sensitive', label: '图片解析内容涉及隐私/账号/本机/危险话题', score: '非 @ 默认沉默' },
  { id: 'image_llm_review_silent', label: '图片接话轻量复核建议沉默', score: '不接话' },
]

const LEVEL_BANTER_SCORE = {
  quiet: 5,
  normal: 10,
  active: 18,
  crazy: 28,
}

const DEFAULT_PROFILE = { minScore: 50, minIntervalSeconds: 10, hourlyLimit: 0, consecutiveLimit: 0 }

function nowIso(now = Date.now()) {
  return new Date(now).toISOString()
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stripImagePlaceholderText(value = '') {
  return normalizeText(value)
    .replace(/原始大小标记\s*\d+/giu, ' ')
    .replace(/\[图片\]/gu, ' ')
    .replace(/图片引用，等待本地图片库匹配/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function addReason(decision, id, label, score = 0) {
  decision.score += Number(score || 0)
  decision.reasons.push(id)
  decision.reasonDetails.push({ id, label, score })
}

function addSuppression(decision, id, label, score = 0) {
  decision.score += Number(score || 0)
  decision.suppressions.push(id)
  decision.suppressionDetails.push({ id, label, score })
}

function isLowInformation(text = '') {
  const value = normalizeText(text)
  if (!value) return true
  const noEmoji = value.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s!！?？。,.，、~～哈啊呀哦嗯额呃]+/gu, '')
  if (value.length <= 2) return true
  return noEmoji.length <= 1 && value.length <= 8
}

function looksLikeQuestion(text = '') {
  return /(?:\?|？|吗|么|嘛|咋|怎么|如何|为啥|为什么|谁|啥|什么|哪个|哪位|有没有|能不能|可不可以|会不会|求|帮|看看|看下|咋办|怎么办)/iu.test(text)
}

function looksLikeCapabilityRequest(text = '') {
  return /(?:总结|概括|查记录|聊天记录|谁说|谁发|记得|群记忆|群友记忆|写|文档|报告|方案|代码|识图|图片|截图|视频|解析|表情包|梗图|斗图|文件|txt|pdf|word|excel|ppt|链接|网页|搜索|查一下)/iu.test(text)
}

function looksLikeMemoryContextRequest(text = '') {
  return /(?:之前|刚才|上面|前面|谁说|谁发|谁讲|群里|记得|不记得|老登|大哥|叫他|称呼|聊天记录|记录里|群友|这个人|他|她)/iu.test(text)
}

function looksLikeBanter(text = '') {
  return /(?:笑死|绷不住|破防|离谱|抽象|逆天|乐|哈哈|hhh|草|吐槽|好家伙|典|急了|整活|活了|不愧是|太对了|这也行|烂活|名场面)/iu.test(text)
}

function looksLikeSensitiveOrDangerous(text = '') {
  return /(?:密码|token|api\s*key|cookie|私钥|账号|转账|付款|银行卡|身份证|隐私|本机|桌面|相册|截图|file:\/\/|\/Users\/|删除|禁言|封号|攻击|开盒|人肉|骂死|弄死|威胁|自杀|涉黄|赌博|毒品)/iu.test(text)
}

function looksLikeSensitiveImageContent(text = '') {
  return /(?:密码|token|api\s*key|cookie|私钥|账号|转账|付款|银行卡|身份证|隐私|本机|桌面|相册|file:\/\/|\/Users\/|删除|禁言|封号|攻击|开盒|人肉|骂死|弄死|威胁|自杀|涉黄|赌博|毒品)/iu.test(text)
}

function normalizeImageContext(imageContext = null) {
  if (!imageContext || typeof imageContext !== 'object') return null
  const description = normalizeText(imageContext.description || '')
  const labels = Array.isArray(imageContext.labels)
    ? imageContext.labels.map(v => normalizeText(v)).filter(Boolean).slice(0, 12)
    : []
  return {
    media_id: Number(imageContext.media_id ?? imageContext.mediaId ?? 0) || 0,
    sender_name: normalizeText(imageContext.sender_name || imageContext.senderName || ''),
    vision_status: normalizeText(imageContext.vision_status || imageContext.visionStatus || (description ? 'done' : 'pending')),
    description,
    labels,
    quote_matched: imageContext.quote_matched === true || imageContext.quoteMatched === true,
    retry_count: Math.max(0, Number(imageContext.retry_count ?? imageContext.retryCount ?? 0) || 0),
    relevance_score: Math.max(0, Number(imageContext.relevance_score ?? imageContext.relevanceScore ?? 0) || 0),
    relevance_reasons: Array.isArray(imageContext.relevance_reasons || imageContext.relevanceReasons)
      ? (imageContext.relevance_reasons || imageContext.relevanceReasons).map(v => normalizeText(v)).filter(Boolean).slice(0, 12)
      : [],
  }
}

function looksLikeImageCaption(text = '') {
  return /(?:看看|看下|看图|这图|这张|图片|截图|图里|照片|咋回事|怎么回事|报错|错误|笑死|绷不住|离谱|抽象|吐槽|鞋|商品|文档|作业|表格|海报|二维码)/iu.test(text)
}

function looksLikeImageDescriptionWorthReply(description = '', labels = []) {
  const value = `${description} ${(labels || []).join(' ')}`
  return /(?:截图|报错|错误|异常|代码|表格|文档|作业|题目|商品|鞋|衣服|表情|梗|海报|二维码|聊天记录|菜单|页面|界面|标志|logo|发票|合同)/iu.test(value)
}

function attachImageContext(decision, imageContext = null, { text = '', level = 'normal' } = {}) {
  const image = normalizeImageContext(imageContext)
  if (!image?.media_id) return null
  const captionText = stripImagePlaceholderText(text)
  decision.imageContext = image
  decision.image_context = image
  if (!image.description || image.vision_status !== 'done') {
    addSuppression(decision, 'image_vision_not_ready_after_retries', '图片三次查询后仍未解析完成，放弃本轮', 0)
    return image
  }
  addReason(decision, 'image_vision_done', '图片已解析完成，可基于真实图片内容接话', 40)
  const metadataReasons = new Set(image.relevance_reasons || [])
  const scoringReasons = new Set()
  if (image.quote_matched) scoringReasons.add('quoted_image')
  if (looksLikeImageCaption(captionText)) scoringReasons.add('image_caption_or_recent_context')
  if (looksLikeImageDescriptionWorthReply(image.description, image.labels)) scoringReasons.add('image_content_natural_reply')
  if (['active', 'crazy'].includes(level)) metadataReasons.add(`activity_${level}`)
  image.relevance_reasons = [...new Set([...metadataReasons, ...scoringReasons])]
  image.relevance_score = Math.max(image.relevance_score || 0, 40 + image.relevance_reasons.length * 10)
  if (scoringReasons.size) {
    addReason(decision, 'image_context_relevant', '图片内容与最近群聊/引用/说明文字相关', 20)
  }
  if (looksLikeSensitiveImageContent(image.description)) {
    addSuppression(decision, 'image_content_sensitive', '图片解析内容涉及敏感/危险/隐私/本机话题，非 @ 默认沉默', 0)
  }
  return image
}

function hasBotReference(text = '', botNames = []) {
  const names = [...new Set([
    ...botNames,
    '白龙马',
    '小白龙',
    '小风',
    '机器人',
    'AI',
    'ai',
    '人工智能',
  ].map(v => normalizeText(v)).filter(v => v && v.length >= 2))]
  return names.some(name => text.includes(name))
}

function parseSender(content = '') {
  const match = String(content || '').match(/^\[群成员\s+(.+?)\]\s*/)
  return normalizeText(match?.[1] || '')
}

function recentSpeakers(messages = []) {
  return (Array.isArray(messages) ? messages : []).map(row => parseSender(row?.content || '')).filter(Boolean)
}

function looksLikeTwoPersonThread(messages = [], currentSender = '') {
  const speakers = recentSpeakers(messages).slice(-5)
  if (speakers.length < 4) return false
  const unique = [...new Set(speakers)]
  return unique.length === 2 && unique.includes(normalizeText(currentSender))
}

function looksLikeFlooding(messages = []) {
  const rows = (Array.isArray(messages) ? messages : []).slice(-12)
  if (rows.length < 10) return false
  const last = Date.parse(rows[rows.length - 1]?.timestamp || '')
  const first = Date.parse(rows[0]?.timestamp || '')
  return Number.isFinite(first) && Number.isFinite(last) && last - first <= 45_000
}

function hasQuietOpening(messages = []) {
  const rows = (Array.isArray(messages) ? messages : []).slice(-2)
  if (rows.length < 2) return false
  const last = Date.parse(rows[rows.length - 1]?.timestamp || '')
  const prev = Date.parse(rows[rows.length - 2]?.timestamp || '')
  return Number.isFinite(prev) && Number.isFinite(last) && last - prev >= 60_000
}

function normalizeProfile(config = {}) {
  const ambient = config.ambientReply || config.ambient_reply || {}
  const level = ambient.activityLevel || ambient.activity_level || 'normal'
  const profiles = ambient.levelProfiles || ambient.level_profiles || {}
  return {
    level,
    profile: profiles[level] || DEFAULT_PROFILE,
    ttlSeconds: Math.max(10, Number(ambient.ambientQueueTtlSeconds ?? ambient.ambient_queue_ttl_seconds ?? 120) || 120),
  }
}

function applyRuntimeLimits(decision, state = {}, profile = {}, now = Date.now()) {
  const minIntervalMs = Math.max(0, Number(profile.minIntervalSeconds || 0)) * 1000
  if (minIntervalMs && state.lastTriggeredAt && now - Number(state.lastTriggeredAt || 0) < minIntervalMs) {
    addSuppression(decision, 'min_interval', `仍在最小间隔内，还剩 ${Math.ceil((minIntervalMs - (now - Number(state.lastTriggeredAt || 0))) / 1000)} 秒`, 0)
  }
  const hourlyLimit = Number(profile.hourlyLimit || 0)
  if (hourlyLimit > 0) {
    const recent = (Array.isArray(state.recentTriggeredAt) ? state.recentTriggeredAt : []).filter(ts => now - Number(ts || 0) <= 3600_000)
    if (recent.length >= hourlyLimit) addSuppression(decision, 'hourly_limit', `已达到每小时上限 ${hourlyLimit}`, 0)
  }
  const consecutiveLimit = Number(profile.consecutiveLimit || 0)
  if (consecutiveLimit > 0 && Number(state.consecutiveTriggered || 0) >= consecutiveLimit) {
    addSuppression(decision, 'consecutive_limit', `已达到连续发言上限 ${consecutiveLimit}`, 0)
  }
}

export function getWeChatAmbientReplyRules() {
  return {
    positive: WECHAT_AMBIENT_POSITIVE_RULES,
    negative: WECHAT_AMBIENT_NEGATIVE_RULES,
  }
}

export function buildWechatExplicitMentionDecision({ config = {}, groupName = '', senderName = '', text = '', imageContext = null, now = Date.now() } = {}) {
  const { level, profile, ttlSeconds } = normalizeProfile(config)
  const decision = {
    triggered: true,
    forced: true,
    kind: 'explicit_mention',
    score: 999,
    threshold: Number(profile.minScore ?? DEFAULT_PROFILE.minScore),
    activityLevel: level,
    ambientQueueTtlSeconds: ttlSeconds,
    reasons: ['explicit_mention'],
    reasonDetails: [{ id: 'explicit_mention', label: '显式 @ 机器人', score: '强制触发' }],
    suppressions: [],
    suppressionDetails: [],
    groupName,
    senderName,
    textPreview: normalizeText(text).slice(0, 160),
    timestamp: nowIso(now),
  }
  attachImageContext(decision, imageContext, { text, level })
  return decision
}

export function evaluateWechatAmbientReply({
  config = {},
  groupExternalId = '',
  groupName = '',
  senderName = '',
  text = '',
  rawText = '',
  messageType = '',
  isSelf = false,
  botNames = [],
  imageContext = null,
  state = {},
  now = Date.now(),
} = {}) {
  const value = normalizeText(text || rawText)
  const image = normalizeImageContext(imageContext)
  const hasParsedImage = !!(image?.media_id && image.description && image.vision_status === 'done')
  const ruleValue = hasParsedImage ? stripImagePlaceholderText(rawText || '') : value
  const { level, profile, ttlSeconds } = normalizeProfile(config)
  const threshold = Number(profile.minScore ?? DEFAULT_PROFILE.minScore)
  const messages = groupExternalId ? getRecentWeChatGroupMessages(groupExternalId, { limit: 18, hours: 2 }) : []
  const decision = {
    triggered: false,
    forced: false,
    kind: 'ambient',
    score: 0,
    threshold,
    activityLevel: level,
    ambientQueueTtlSeconds: ttlSeconds,
    reasons: [],
    reasonDetails: [],
    suppressions: [],
    suppressionDetails: [],
    groupName,
    senderName,
    messageType: String(messageType || ''),
    textPreview: value.slice(0, 160),
    timestamp: nowIso(now),
  }

  if (isSelf) {
    addSuppression(decision, 'self_message', '机器人自己发的消息，直接忽略', 0)
    return decision
  }
  attachImageContext(decision, image, { text: ruleValue, level })
  if (!hasParsedImage && isLowInformation(value)) addSuppression(decision, 'low_information', '纯表情/低信息短句', -20)
  if (looksLikeSensitiveOrDangerous(ruleValue || value)) addSuppression(decision, 'sensitive_or_dangerous', '敏感/危险/隐私/本机文件话题，非 @ 默认沉默', 0)
  if (looksLikeTwoPersonThread(messages, senderName)) addSuppression(decision, 'two_person_thread', '明显两个人连续私聊', -35)
  if (looksLikeFlooding(messages)) addSuppression(decision, 'flooding', '群里刷屏', -25)

  if (hasBotReference(ruleValue, botNames)) addReason(decision, 'bot_name_reference', '提到机器人昵称/别称但没有 @', 45)
  if (looksLikeQuestion(ruleValue)) addReason(decision, 'group_question', '明显向群里求助/提问', 30)
  if (looksLikeQuestion(ruleValue) && messages.length >= 2) addReason(decision, 'unanswered_question', '问题短时间没人回答', 25)
  if (looksLikeCapabilityRequest(ruleValue)) addReason(decision, 'bot_capability_match', '命中白龙马擅长能力', 25)
  if (looksLikeMemoryContextRequest(ruleValue)) addReason(decision, 'memory_context_needed', '需要群记忆/群友记忆/聊天记录上下文', 20)
  if (/(?:AI|ai|机器人|小风|白龙马).{0,12}(?:怎么看|咋看|会不会|能不能|行不行|来评|评价)/u.test(ruleValue)) {
    addReason(decision, 'ai_opinion_request', '群里有人点 AI/机器人意见', 35)
  }
  if (looksLikeBanter(ruleValue)) addReason(decision, 'banter_opportunity', '梗、吐槽、玩笑可接', LEVEL_BANTER_SCORE[level] || LEVEL_BANTER_SCORE.normal)
  if (hasQuietOpening(messages) && (looksLikeQuestion(ruleValue) || looksLikeBanter(ruleValue) || looksLikeCapabilityRequest(ruleValue))) {
    addReason(decision, 'quiet_opening', '群冷场且上文有明显可接话点', 10)
  }

  applyRuntimeLimits(decision, state, profile, now)
  decision.triggered = decision.score >= threshold && !decision.suppressions.some(id => ['self_message', 'sensitive_or_dangerous', 'image_content_sensitive', 'image_vision_not_ready_after_retries', 'min_interval', 'hourly_limit', 'consecutive_limit'].includes(id))
  return decision
}
