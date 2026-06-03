import assert from 'node:assert/strict'
import { extractWeChatExplicitMemories } from '../src/social/wechat-memory-extractor.js'
import { buildWeChatMemeHints } from '../src/social/wechat-groups.js'
import { extractPublicImageUrlsFromWechatText } from '../src/social/wechaty-duty-group.js'

const alias = extractWeChatExplicitMemories({
  text: '@小风 以后叫我大哥',
  senderName: '张三',
  senderId: 'member-1',
})
assert.ok(alias.length >= 1, 'should extract alias memory')
assert.ok(alias.some(item => item.content.includes('大哥') && item.content.includes('张三')), 'alias memory should include nickname and member')
assert.ok(alias.some(item => item.groupContent?.includes('谁是大哥') || item.groupContent?.includes('谁是你')), 'group memory should support later who-is question')

const role = extractWeChatExplicitMemories({
  text: '@小风 我是你大哥',
  senderName: '李四',
  senderId: 'member-2',
})
assert.ok(role.some(item => item.category === 'member_role' && item.content.includes('大哥') && item.content.includes('李四')), 'should extract role memory')

const none = extractWeChatExplicitMemories({ text: '@小风 今天vw50', senderName: '王五' })
assert.equal(none.length, 0, 'meme should not create identity memory')

const memeHint = buildWeChatMemeHints('@小风 今天vw50')
assert.ok(memeHint.includes('v我50') || memeHint.includes('vw50'), 'prompt should include meme hint for vw50')
const mediaHint = buildWeChatMemeHints('@小风 找个表情包')
assert.ok(mediaHint.includes('公开网络图片') && mediaHint.includes('本机文件'), 'prompt should include media boundary')

const imageUrls = extractPublicImageUrlsFromWechatText('给你个图 ![meme](https://example.com/a.webp) 还有 https://img.example.com/b.jpg')
assert.deepEqual(imageUrls, ['https://example.com/a.webp', 'https://img.example.com/b.jpg'], 'should extract only public image urls')

console.log('[PASS] wechat memory extractor and meme hints')
