import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-quote-citation-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const { executeTool } = await import('../src/capabilities/executor.js')
const { getRecentConversation } = await import('../src/db.js')

const quotedText = '「风的季节：公益啊」\n- - - - - - - - - - - - - - -\n@前夜 这句话啥意思'

const result = await executeTool('send_message', {
  target_id: 'wechat-quote-test-user',
  content: '他说的是公益站/公益服务，大概率不是商业收费。',
  channel: 'TUI',
}, {
  allowedTargetIds: ['wechat-quote-test-user'],
  visibleTargetIds: ['wechat-quote-test-user'],
  currentChannel: 'TUI',
  currentSocial: {
    platform: 'wechaty-duty-group',
    user_text: quotedText,
    raw_user_text: quotedText,
    mentioned_self: true,
  },
})

assert.match(String(result), /消息已发送/)
const rows = getRecentConversation('wechat-quote-test-user', 5, 24, { includeAbsorbed: true })
const sent = rows.find(row => row.role === 'jarvis')
assert.ok(sent, 'send_message should persist the reply')
assert.match(sent.content, /^引用 @风的季节：公益啊\n他说的是公益站\/公益服务/u)

const resultWithExistingCitation = await executeTool('send_message', {
  target_id: 'wechat-quote-test-user',
  content: '引用 @风的季节：公益啊\n这条已经带引用，不应该重复。',
  channel: 'TUI',
}, {
  allowedTargetIds: ['wechat-quote-test-user'],
  visibleTargetIds: ['wechat-quote-test-user'],
  currentChannel: 'TUI',
  currentSocial: {
    platform: 'wechaty-duty-group',
    user_text: quotedText,
    raw_user_text: quotedText,
    mentioned_self: true,
  },
})

assert.match(String(resultWithExistingCitation), /消息已发送/)
const latest = getRecentConversation('wechat-quote-test-user', 2, 24, { includeAbsorbed: true })
const latestSent = latest.find(row => row.role === 'jarvis')
assert.ok(latestSent, 'second send_message should persist the reply')
assert.equal((latestSent.content.match(/^引用/gmu) || []).length, 1, 'citation should not be duplicated')

console.log('[PASS] wechat quote visible citation')
