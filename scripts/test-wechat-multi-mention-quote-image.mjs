import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-mention-quote-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const { detectWechatyLoginMention } = await import('../src/social/wechaty-duty-group.js')
const { extractWeChatQuoteContext } = await import('../src/social/wechat-quote-context.js')
const { findWeChatImageMediaForQuote, upsertWeChatImageMediaItem } = await import('../src/social/wechat-image-vision.js')

assert.equal(detectWechatyLoginMention({
  text: '@前夜 @小号 你看看他在吗？',
  rawPayload: {
    MsgSource: '<msgsource><atuserlist>@bot-login-id,@friend-id</atuserlist></msgsource>',
  },
  loginName: '前夜',
  loginId: '@bot-login-id',
  mentionedContactIds: ['@friend-id'],
}), true, 'MsgSource atuserlist should detect bot mention even with another mentioned member')

const mediaDir = path.join(tmp, 'data', 'wechat-media', 'quote-test')
fs.mkdirSync(mediaDir, { recursive: true })
const imagePath = path.join(mediaDir, 'quoted-image.png')
fs.writeFileSync(imagePath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l3v/+wAAAABJRU5ErkJggg==',
  'base64',
))
const otherImagePath = path.join(mediaDir, 'other-image.png')
fs.writeFileSync(otherImagePath, Buffer.concat([fs.readFileSync(imagePath), Buffer.from('other')]))

const groupId = 'wechaty:@@quote-image-room'
const groupName = '引用图片测试群'
const messageId = '9876543210123456789'
const inserted = upsertWeChatImageMediaItem({
  groupId,
  groupName,
  senderId: '@friend-id',
  senderName: '小号',
  messageType: 'image',
  sourceText: `<msg><img msgid="${messageId}" /></msg>`,
  mediaInfo: {
    filePath: imagePath,
    relativePath: path.relative(tmp, imagePath),
    type: 'image/png',
  },
})
assert.equal(inserted.ok, true, 'image media should be inserted')

const otherInserted = upsertWeChatImageMediaItem({
  groupId,
  groupName,
  senderId: '@friend-id',
  senderName: 'friend',
  messageType: 'image',
  sourceText: '<msg><img msgid="other-message-id" /></msg>',
  mediaInfo: {
    filePath: otherImagePath,
    relativePath: path.relative(tmp, otherImagePath),
    type: 'image/png',
  },
})
assert.equal(otherInserted.ok, true, 'other image media should be inserted')

const quote = extractWeChatQuoteContext({
  text: `「小号：[图片]」\n- - - - - - - - - - - - - - -\n@前夜 你看看他在吗？`,
  rawText: `<msg><appmsg><refermsg><displayname>小号</displayname><content>[图片]</content><svrid>${messageId}</svrid><createtime>1770000000</createtime></refermsg></appmsg></msg>`,
  messageType: 'text',
})
assert.equal(quote.ok, true)
assert.equal(quote.kind, 'image')
assert.ok(quote.messageIds.includes(messageId), 'quote should expose referenced message id')

const found = findWeChatImageMediaForQuote({ groupId, groupName, quote, query: '@前夜 你看看他在吗？' })
assert.equal(found.ok, true)
assert.equal(found.items[0]?.id, inserted.item.id, 'quoted image lookup should match stored media by message id')

const missingQuote = extractWeChatQuoteContext({
  text: '"friend: [image]"\n----------\n@bot look at this quoted image',
  rawText: '<msg><appmsg><refermsg><displayname>friend</displayname><content>[image]</content><svrid>1234567890000000000</svrid><createtime>1770000000</createtime></refermsg></appmsg></msg>',
  messageType: 'text',
})
assert.equal(missingQuote.ok, true)
assert.equal(missingQuote.kind, 'image')
assert.ok(missingQuote.messageIds.includes('1234567890000000000'), 'missing quote should expose referenced message id')
const missingFound = findWeChatImageMediaForQuote({ groupId, groupName, quote: missingQuote, query: '@bot look at this quoted image' })
assert.equal(missingFound.ok, true)
assert.equal(missingFound.strict, true)
assert.equal(missingFound.items.length, 0, 'quoted image lookup must not fall back to another image when message id is present but missing')

console.log('[PASS] wechat multi-mention and quoted-image lookup')
