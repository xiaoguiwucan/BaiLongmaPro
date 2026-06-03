import assert from 'assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-member-memory-tool-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const { selectTools } = await import('../src/memory/tool-router.js')
const { executeTool } = await import('../src/capabilities/executor.js')
const { listWeChatMemberPermanentMemory } = await import('../src/social/wechat-group-memory.js')

const routed = selectTools({
  messageBody: '@小风 能记多少记多少，记入群友个人永久记忆库中',
  senderId: 'wechaty:room:test:member:a',
})
assert.ok(routed.includes('wechat_member_memory_write'), 'memory write tool should be injected for group member memory requests')

const longText = [
  '《力哥的风流生活》是一篇群友创作小说。',
  '主角王大力被设定为芜湖PT群首富，故事包含九号电动车、陈若曦、群聊玩梗等元素。',
  '这条记忆用于验证群友个人永久记忆库写入工具。',
  '后续检索“力哥的风流生活”时应能命中。',
].join('\n\n').repeat(80)

const resultText = await executeTool('wechat_member_memory_write', {
  title: '力哥的风流生活',
  category: 'novel',
  content: longText,
}, {
  currentSocial: {
    platform: 'wechaty-duty-group',
    room_id: '@@memory-tool-room',
    group_name: '记忆工具测试群',
    sender_id: 'sender-wind',
    sender_name: '风',
    wechat_admin: false,
  },
})
const result = JSON.parse(resultText)
assert.equal(result.ok, true)
assert.ok(result.chunks > 1, 'long memory should be split into searchable chunks')
assert.equal(result.member_sender_id, 'sender-wind')

const list = listWeChatMemberPermanentMemory({
  groupId: 'wechaty:@@memory-tool-room',
  senderId: 'sender-wind',
  senderName: '风',
  q: '力哥的风流生活',
})
assert.equal(list.ok, true)
assert.ok(list.memories.length >= 1)
assert.ok(list.memories.some(item => item.content.includes('力哥的风流生活')))

console.log('[PASS] wechat member memory write tool')
