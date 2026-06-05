import assert from 'assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-image-reply-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const {
  resolveWeChatImageMediaFile,
  updateWeChatImageMediaItem,
  upsertWeChatImageMediaItem,
  waitForWeChatImageMediaDescription,
} = await import('../src/social/wechat-image-vision.js')
const { __wechatyVideoTestInternals } = await import('../src/social/wechaty-duty-group.js')

assert.equal(__wechatyVideoTestInternals.hasWechatImageUnderstandingIntent('别乱回复图片内容'), false)
assert.equal(__wechatyVideoTestInternals.hasWechatImageUnderstandingIntent('一会更新图片回复逻辑'), false)
assert.equal(__wechatyVideoTestInternals.hasWechatImageUnderstandingIntent('提到图片两个字就解释'), false)
assert.equal(__wechatyVideoTestInternals.hasWechatImageUnderstandingIntent('解释这张图内容'), true)
assert.equal(__wechatyVideoTestInternals.hasWechatStoredImageSendIntent('解释这张图内容'), false)
assert.equal(__wechatyVideoTestInternals.hasWechatStoredImageSendIntent('把刚才那张图发给我'), true)

const mediaDir = path.join(tmp, 'data', 'wechat-media', 'reply-hotfix')
fs.mkdirSync(mediaDir, { recursive: true })
const imagePath = path.join(mediaDir, 'image.png')
fs.writeFileSync(imagePath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
))

const inserted = upsertWeChatImageMediaItem({
  groupId: 'wechaty:@@image-reply',
  groupName: '图片回复测试群',
  senderId: 'sender-a',
  senderName: '风',
  messageType: 'image',
  sourceText: '[图片] 原始大小标记 4490',
  mediaInfo: {
    filePath: imagePath,
    relativePath: path.relative(tmp, imagePath),
    type: 'image/png',
  },
})
assert.equal(inserted.ok, true)
const absoluteResolved = resolveWeChatImageMediaFile({ relative_path: imagePath })
assert.equal(absoluteResolved.ok, true)
assert.equal(absoluteResolved.filePath, imagePath)
const dataResolved = resolveWeChatImageMediaFile({ relative_path: path.relative(path.join(tmp, 'data'), imagePath) })
assert.equal(dataResolved.ok, true)
assert.equal(dataResolved.filePath, imagePath)

const pending = await waitForWeChatImageMediaDescription({ mediaId: inserted.item.id, attempts: 1, intervalMs: 0 })
assert.equal(pending.ok, false)
assert.equal(pending.retryCount, 1)
assert.equal(pending.vision_status, 'pending')

const updated = updateWeChatImageMediaItem({
  id: inserted.item.id,
  description: '一张报错截图，页面显示 HTTP 502 和 provider 重试失败。',
  labels: ['截图', '报错', '502'],
})
assert.equal(updated.ok, true)

const done = await waitForWeChatImageMediaDescription({ mediaId: inserted.item.id, attempts: 1, intervalMs: 0 })
assert.equal(done.ok, true)
assert.match(done.description, /502/u)
assert.deepEqual(done.labels, ['截图', '报错', '502'])

const ctx = __wechatyVideoTestInternals.buildWechatImageReplyContext({
  result: done,
  item: done.item,
  senderName: '风',
  quoteMatched: true,
})
assert.equal(ctx.media_id, inserted.item.id)
assert.equal(ctx.quote_matched, true)

const enhanced = __wechatyVideoTestInternals.buildWechatImageEnhancedText({
  baseText: '<msg><img length="4490" cdnmidimgurl="https://wx.example/image" newmsgid="123456" /></msg> [图片] 原始大小标记 4490',
  imageContext: ctx,
})
assert.match(enhanced, /刚刚风发了一张图片/u)
assert.match(enhanced, /HTTP 502/u)
assert.doesNotMatch(enhanced, /原始大小标记|cdnmidimgurl|newmsgid|4490|<msg|https:\/\/wx/u)

console.log('[PASS] wechat image reply waits for vision and cleans raw placeholders')
