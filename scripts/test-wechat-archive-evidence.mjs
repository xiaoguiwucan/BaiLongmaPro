import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-archive-evidence-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const {
  getWeChatGroupArchiveEvidence,
  recordWeChatGroupActivity,
} = await import('../src/social/wechat-group-stats.js')
const { buildWeChatGroupCommandPrompt } = await import('../src/social/wechat-groups.js')
const { setWechatyDutyGroupConfig } = await import('../src/config.js')

const groupId = 'wechaty:@@archive_evidence_room'
const groupName = '证据检索测试群'

recordWeChatGroupActivity({
  groupId,
  groupName,
  senderId: '@wind',
  senderName: '风的季节',
  text: '老登就是东北话里的老头儿，带点调侃的意思。',
  source: 'test',
  timestamp: '2026-05-28T10:00:00+08:00',
  force: true,
})
recordWeChatGroupActivity({
  groupId,
  groupName,
  senderId: '@lamp',
  senderName: '一灯',
  text: '我看这个项目说是有向量记忆啊',
  source: 'test',
  timestamp: '2026-05-28T10:01:00+08:00',
  force: true,
})
const longTail = '前半段只是在铺垫。'.repeat(460) + '后半段唯一暗号是海盐牛奶，答案藏在这里。'
recordWeChatGroupActivity({
  groupId,
  groupName,
  senderId: '@long',
  senderName: '长消息同学',
  text: longTail,
  source: 'test',
  timestamp: '2026-05-28T10:02:00+08:00',
  force: true,
})

const evidence = getWeChatGroupArchiveEvidence({
  groupId,
  groupName,
  query: '@小风 老登是谁，之前的数据忘了？',
  limit: 12,
  recentLimit: 2,
  days: 180,
})

assert.equal(evidence.ok, true)
assert.ok(evidence.terms.includes('老登'))
assert.ok(evidence.text.includes('风的季节'))
assert.ok(evidence.text.includes('老登就是东北话里的老头儿'))
assert.ok(evidence.matched_count >= 1)

const chunkEvidence = getWeChatGroupArchiveEvidence({
  groupId,
  groupName,
  query: '之前谁说过海盐牛奶这个暗号？',
  limit: 8,
  recentLimit: 0,
  days: 180,
})
assert.equal(chunkEvidence.ok, true)
assert.ok(chunkEvidence.matched_count >= 1)
assert.ok(chunkEvidence.text.includes('海盐牛奶'))
assert.ok(chunkEvidence.text.includes('片段'))

const prompt = await buildWeChatGroupCommandPrompt({
  groupId,
  groupName,
  senderId: '@user',
  senderName: '提问者',
  text: '@小风 老登是谁，之前的数据忘了？',
  mentionedSelf: true,
  replyTargetId: 'wechaty:room:@@archive_evidence_room:member:%40user',
})
assert.ok(prompt.includes('<wechat-group-archive-evidence>'))
assert.ok(prompt.includes('老登就是东北话里的老头儿'))
assert.ok(prompt.includes('必须优先使用下面的 <wechat-group-archive-evidence>'))

setWechatyDutyGroupConfig({ adminModeEnabled: true, adminWechatIds: ['@wind'] })
const adminPrompt = await buildWeChatGroupCommandPrompt({
  groupId,
  groupName,
  senderId: '@lamp',
  senderName: '一灯',
  text: '@小风 把风的季节物理删除吧',
  mentionedSelf: true,
  replyTargetId: 'wechaty:room:@@archive_evidence_room:member:%40lamp',
})
assert.ok(adminPrompt.includes('<wechat-admin-protection>'))
assert.ok(adminPrompt.includes('风的季节'))
assert.ok(adminPrompt.includes('别想拿我当刀使'))

console.log('[PASS] wechat archive evidence retrieval')
