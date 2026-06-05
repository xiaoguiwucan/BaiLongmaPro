import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-archive-config-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

try {
  const {
    getWeChatGroupArchiveConfig,
    setWeChatGroupArchiveConfig,
    setWechatyDutyGroupConfig,
  } = await import('../src/config.js')
  const { getWechatGroupArchiveRuntimeForGroup } = await import('../src/social/wechaty-duty-group.js')

  setWechatyDutyGroupConfig({ groupNames: ['自由回复群'] })
  let cfg = getWeChatGroupArchiveConfig()
  assert.deepEqual(cfg.recordGroupNames, [])
  assert.deepEqual(cfg.parseImageGroupNames, [])
  assert.ok(cfg.effectiveRecordGroupNames.includes('自由回复群'))
  assert.ok(cfg.effectiveParseImageGroupNames.includes('自由回复群'))

  let runtime = getWechatGroupArchiveRuntimeForGroup({ groupId: 'wechaty:@@free-room', groupName: '自由回复群' })
  assert.equal(runtime.recordEnabled, true)
  assert.equal(runtime.mediaEnabled, true)
  assert.equal(runtime.imageParseEnabled, true)

  setWeChatGroupArchiveConfig({
    record_group_names: ['记录群'],
    parse_image_group_names: ['图片群'],
    default_from_free_reply_groups: false,
    long_message_chunk_size: 300,
    long_message_chunk_overlap: 9999,
  })
  cfg = getWeChatGroupArchiveConfig()
  assert.deepEqual(cfg.effectiveRecordGroupNames, ['记录群'])
  assert.deepEqual(cfg.effectiveParseImageGroupNames, ['图片群'])
  assert.equal(cfg.longMessageChunkSize, 500)
  assert.equal(cfg.longMessageChunkOverlap, 1000)

  runtime = getWechatGroupArchiveRuntimeForGroup({ groupId: 'wechaty:@@free-room', groupName: '自由回复群' })
  assert.equal(runtime.recordEnabled, false)
  assert.equal(runtime.mediaEnabled, false)
  assert.equal(runtime.imageParseEnabled, false)

  runtime = getWechatGroupArchiveRuntimeForGroup({ groupId: 'wechaty:@@record-room', groupName: '记录群' })
  assert.equal(runtime.recordEnabled, true)
  assert.equal(runtime.mediaEnabled, false)

  runtime = getWechatGroupArchiveRuntimeForGroup({ groupId: 'wechaty:@@image-room', groupName: '图片群' })
  assert.equal(runtime.recordEnabled, false)
  assert.equal(runtime.mediaEnabled, true)
  assert.equal(runtime.imageParseEnabled, true)

  console.log('[PASS] wechat group archive range config')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
