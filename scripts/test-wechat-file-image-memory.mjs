import assert from 'assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-file-image-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const {
  createWechatReplyFile,
  defaultWechatReplyFileCaption,
  detectWechatReplyFileRequest,
  hasExplicitWechatReplyFileFormatRequest,
  isWechatReplyGeneratedFilePath,
  isWechatReplyAcknowledgementOnly,
  isWechatSubstantiveReplyRequest,
  normalizeWechatReplyFileFormat,
  shouldAutoCreateWechatReplyFile,
} = await import('../src/social/wechat-file-reply.js')
const {
  findWeChatImageMediaForRequest,
  resolveWeChatImageMediaFile,
  updateWeChatImageMediaItem,
  upsertWeChatImageMediaItem,
} = await import('../src/social/wechat-image-vision.js')
const { executeTool } = await import('../src/capabilities/executor.js')
const { getDB, getRecentConversation } = await import('../src/db.js')

assert.equal(normalizeWechatReplyFileFormat('text'), 'txt')
assert.equal(normalizeWechatReplyFileFormat('word'), 'docx')
assert.equal(normalizeWechatReplyFileFormat('excle'), 'xlsx')
assert.equal(normalizeWechatReplyFileFormat('', 'demo.ppt'), 'pptx')
assert.deepEqual(
  detectWechatReplyFileRequest('@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我'),
  { requested: true, format: 'txt', reason: 'format_mentioned' },
)
assert.equal(hasExplicitWechatReplyFileFormatRequest('@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我'), true)
assert.equal(hasExplicitWechatReplyFileFormatRequest('@小风 继续，让图图和力佬连动起来，3000字发给我'), false)
assert.equal(isWechatSubstantiveReplyRequest('@小风 继续，让图图和力佬连动起来，3000字发给我'), true)
assert.equal(isWechatReplyAcknowledgementOnly('好，接上，马上整理'), true)
assert.equal(shouldAutoCreateWechatReplyFile({
  userText: '@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我',
  content: '图图和力佬的联动故事。'.repeat(80),
}).create, true)
assert.equal(shouldAutoCreateWechatReplyFile({
  userText: '@小风 继续，让图图和力佬连动起来，3000字发给我',
  content: '图图和力佬的联动故事。'.repeat(80),
}).create, false, 'long-form text alone must not be auto-converted into a file')
assert.equal(shouldAutoCreateWechatReplyFile({
  userText: '@小风 用文本文档格式发给我',
  content: '好的，稍等。',
}).create, false, 'short acknowledgement should not be turned into a file')
assert.equal(detectWechatReplyFileRequest('整理成 excle 表格发给我').format, 'xlsx')
assert.equal(detectWechatReplyFileRequest('用 Word 文档发我').format, 'docx')

const roomId = '@@file-room'
const senderId = '@sender-file'
const replyTargetId = `wechaty:room:${encodeURIComponent(roomId)}:member:${encodeURIComponent(senderId)}`
const longReply = '图图和力佬开始联动：他们先把问题拆开，再把线索接上。'.repeat(80)
const ackResult = await executeTool('send_message', {
  target_id: replyTargetId,
  content: '好，接上，马上整理。',
  channel: 'WECHAT',
}, {
  allowedTargetIds: [replyTargetId],
  visibleTargetIds: [replyTargetId],
  currentChannel: 'WECHAT',
  currentExternalPartyId: `wechaty:room:${roomId}`,
  currentSocial: {
    platform: 'wechaty-duty-group',
    room_id: roomId,
    sender_id: senderId,
    sender_name: '真实群友',
    reply_mention_id: senderId,
    reply_mention_name: '真实群友',
    user_text: '@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我',
    raw_user_text: '@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我',
    mentioned_self: true,
  },
})
assert.match(ackResult, /不能只回复/u, 'ack-only WeChat substantive replies must be blocked')

const sendResult = await executeTool('send_message', {
  target_id: replyTargetId,
  content: longReply,
  channel: 'WECHAT',
}, {
  allowedTargetIds: [replyTargetId],
  visibleTargetIds: [replyTargetId],
  currentChannel: 'WECHAT',
  currentExternalPartyId: `wechaty:room:${roomId}`,
  currentSocial: {
    platform: 'wechaty-duty-group',
    room_id: roomId,
    sender_id: senderId,
    sender_name: '真实群友',
    reply_mention_id: senderId,
    reply_mention_name: '真实群友',
    user_text: '@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我',
    raw_user_text: '@小风 继续，让图图和力佬连动起来，3000字，用文本文档格式发给我',
    mentioned_self: true,
  },
})
assert.match(sendResult, /消息发送失败|消息已发送/u, 'send_message should run through delivery after creating the attachment')
const files = fs.readdirSync(path.join(tmp, 'data', 'wechat-reply-files')).filter(name => name.endsWith('.txt'))
assert.ok(files.length >= 1, 'send_message auto fallback should create a txt attachment')
const rows = getRecentConversation(replyTargetId, 3, 24, { includeAbsorbed: true })
const sent = rows.find(row => row.role === 'jarvis')
assert.match(sent?.content || '', /已按要求生成 TXT 文件/u)
assert.match(sent?.content || '', /\[生成附件正文\]/u)
assert.ok(getDB().prepare('SELECT COUNT(*) AS n FROM conversations').get().n >= 1)

const beforeNoFormatFiles = fs.existsSync(path.join(tmp, 'data', 'wechat-reply-files'))
  ? fs.readdirSync(path.join(tmp, 'data', 'wechat-reply-files')).length
  : 0
const noFormatResult = await executeTool('send_message', {
  target_id: replyTargetId,
  content: longReply,
  channel: 'WECHAT',
  attachment: { format: 'txt', file_name: '模型自作主张.txt' },
}, {
  allowedTargetIds: [replyTargetId],
  visibleTargetIds: [replyTargetId],
  currentChannel: 'WECHAT',
  currentExternalPartyId: `wechaty:room:${roomId}`,
  currentSocial: {
    platform: 'wechaty-duty-group',
    room_id: roomId,
    sender_id: senderId,
    sender_name: '真实群友',
    reply_mention_id: senderId,
    reply_mention_name: '真实群友',
    user_text: '@小风 继续，让图图和力佬连动起来，3000字发给我',
    raw_user_text: '@小风 继续，让图图和力佬连动起来，3000字发给我',
    mentioned_self: true,
  },
})
assert.match(noFormatResult, /消息发送失败|消息已发送/u)
const afterNoFormatFiles = fs.readdirSync(path.join(tmp, 'data', 'wechat-reply-files')).length
assert.equal(afterNoFormatFiles, beforeNoFormatFiles, 'model-provided attachment must be ignored when user did not request a concrete file format')

for (const format of ['txt', 'md', 'py', 'pdf', 'docx', 'xlsx', 'pptx']) {
  const file = await createWechatReplyFile({
    format,
    fileName: `测试回复.${format}`,
    content: '第一行\n第二行\n关键内容：白龙马文件发送测试',
  })
  assert.equal(file.ok, true)
  assert.equal(file.format, format)
  assert.ok(fs.existsSync(file.filePath), `${format} should exist`)
  assert.ok(fs.statSync(file.filePath).size > 0, `${format} should not be empty`)
  assert.equal(isWechatReplyGeneratedFilePath(file.filePath), true)
  assert.match(defaultWechatReplyFileCaption(file), new RegExp(format.toUpperCase(), 'u'))
}
assert.equal(isWechatReplyGeneratedFilePath(path.join(tmp, 'not-generated.txt')), false)

const mediaDir = path.join(tmp, 'data', 'wechat-media', 'image-memory')
fs.mkdirSync(mediaDir, { recursive: true })
const imagePath = path.join(mediaDir, 'tagged-image.png')
fs.writeFileSync(imagePath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
))
const groupId = 'wechaty:@@image-memory-room'
const inserted = upsertWeChatImageMediaItem({
  groupId,
  groupName: '图片记忆测试群',
  senderId: 'sender-a',
  senderName: '群友甲',
  messageType: 'image',
  sourceText: '引用图片打标签：白龙马测试图',
  mediaInfo: {
    filePath: imagePath,
    relativePath: path.relative(tmp, imagePath),
    type: 'image/png',
  },
})
assert.equal(inserted.ok, true)

const updated = updateWeChatImageMediaItem({
  id: inserted.item.id,
  description: '一张用于测试图库召回的图片，画面里有白龙马标签。',
  labels: ['白龙马测试图', '图库召回', '标签记忆'],
})
assert.equal(updated.ok, true)

const found = findWeChatImageMediaForRequest({
  groupId,
  query: '发那张 白龙马测试图 图片',
  limit: 5,
})
assert.equal(found.ok, true)
assert.equal(found.items[0]?.id, inserted.item.id)
assert.ok(found.items[0]?._score > 0)

const resolved = resolveWeChatImageMediaFile(found.items[0])
assert.equal(resolved.ok, true)
assert.equal(resolved.filePath, imagePath)

console.log('[PASS] wechat file attachment generation and image memory labels')
