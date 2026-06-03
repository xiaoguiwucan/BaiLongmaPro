import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-record-all-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const {
  listWeChatGroupActivityRecords,
  recordWeChatGroupActivity,
} = await import('../src/social/wechat-group-stats.js')

const groupId = 'wechaty:@@record_all_test_room'
const groupName = '未勾选统计但必须入库的测试群'

const skipped = recordWeChatGroupActivity({
  groupId,
  groupName,
  senderId: '@member-a',
  senderName: '成员A',
  text: '这条没有 force，保持统计开关拦截行为',
  source: 'test',
})
assert.equal(skipped.skipped, true)
assert.equal(skipped.reason, 'group_not_selected_for_stats')

const inserted = recordWeChatGroupActivity({
  groupId,
  groupName,
  senderId: '@member-a',
  senderName: '成员A',
  text: '这条有 force，聊天记录库必须入库',
  source: 'test',
  force: true,
})
assert.equal(inserted.ok, true)
assert.ok(inserted.id)

const listed = listWeChatGroupActivityRecords({
  groupId,
  groupName,
  from: '2026-01-01',
  to: '2099-12-31',
  limit: 20,
})
assert.equal(listed.ok, true)
assert.equal(listed.total, 1)
assert.equal(listed.records[0].sender_display_name, '成员A')
assert.equal(listed.records[0].display_text, '这条有 force，聊天记录库必须入库')
assert.equal(listed.latest_record.sender_display_name, '成员A')
assert.equal(listed.latest_record.display_text, '这条有 force，聊天记录库必须入库')

console.log('[PASS] wechat record-all ingestion')
