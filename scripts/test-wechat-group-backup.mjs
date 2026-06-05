import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-backup-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

try {
  const { getDB } = await import('../src/db.js')
  const { recordWeChatGroupActivity } = await import('../src/social/wechat-group-stats.js')
  const { recordWeChatGroupMessage, createWeChatGroupManualMemory } = await import('../src/social/wechat-group-memory.js')
  const { upsertWeChatGroupMemberName } = await import('../src/social/wechat-group-stats.js')
  const { upsertWeChatImageMediaItem, updateWeChatImageMediaItem } = await import('../src/social/wechat-image-vision.js')
  const {
    buildWeChatGroupBackupExport,
    importWeChatGroupBackup,
    listWeChatGroupBackupGroups,
    previewWeChatGroupBackupImport,
  } = await import('../src/social/wechat-group-backup.js')

  const sourceGroupId = 'wechaty:@@backup-source-room'
  const targetRoomId = '@@backup-target-room'
  const targetGroupId = `wechaty:${targetRoomId}`
  const groupName = '备份迁移测试群'

  recordWeChatGroupActivity({
    groupId: sourceGroupId,
    groupName,
    senderId: '@member-a',
    senderName: '成员A',
    text: '这是一条需要完整迁移的群聊天记录',
    messageType: 'text',
    source: 'test',
    timestamp: '2026-06-01T10:00:00.000Z',
    force: true,
  })
  const messageResult = await recordWeChatGroupMessage({
    groupId: sourceGroupId,
    groupName,
    senderId: '@member-a',
    senderName: '成员A',
    text: '成员A喜欢把迁移方案写清楚',
    source: 'test',
    timestamp: '2026-06-01T10:01:00.000Z',
  })
  const memoryResult = await createWeChatGroupManualMemory({
    groupId: sourceGroupId,
    groupName,
    senderId: '@member-a',
    senderName: '成员A',
    category: 'manual_member',
    content: '成员A需要保留成员记忆',
  })
  const sourceMessageId = Number(messageResult.local?.id || messageResult.id || 0)
  const sourceMemoryId = Number(memoryResult.items?.[0]?.id || memoryResult.id || 0)
  assert.ok(sourceMessageId, 'source local message id should exist')
  assert.ok(sourceMemoryId, 'source local memory id should exist')
  const db = getDB()
  db.prepare('UPDATE wechat_group_memory_items SET source_message_id = ?, source_text = ? WHERE id = ?')
    .run(sourceMessageId, '成员A喜欢把迁移方案写清楚', sourceMemoryId)
  upsertWeChatGroupMemberName({
    groupId: sourceGroupId,
    groupName,
    senderId: '@member-a',
    displayName: '成员A',
    roomAlias: 'A同学',
    stableKey: 'stable-member-a',
    source: 'test',
  })

  const mediaDir = path.join(tmp, 'data', 'wechat-media', 'source')
  fs.mkdirSync(mediaDir, { recursive: true })
  const imagePath = path.join(mediaDir, 'backup.png')
  fs.writeFileSync(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ))
  const media = upsertWeChatImageMediaItem({
    groupId: sourceGroupId,
    groupName,
    senderId: '@member-a',
    senderName: '成员A',
    messageType: 'image',
    sourceText: '这张图需要迁移解析结果',
    mediaInfo: {
      filePath: imagePath,
      relativePath: path.relative(tmp, imagePath),
      type: 'image/png',
    },
  })
  assert.equal(media.ok, true)
  const updated = updateWeChatImageMediaItem({
    id: media.item.id,
    description: '备份测试图片解析结果',
    labels: ['备份', '迁移'],
  })
  assert.equal(updated.ok, true)

  const groups = listWeChatGroupBackupGroups()
  assert.equal(groups.ok, true)
  const sourceGroup = groups.groups.find(group => group.group_id === sourceGroupId)
  assert.ok(sourceGroup, 'source group should be exportable')

  const exported = buildWeChatGroupBackupExport({
    groupIds: [sourceGroup.backup_group_key],
    includeMediaFiles: true,
    includeDeletedMemory: true,
    roomStatus: { login_user: '当前微信号' },
  })
  assert.equal(exported.ok, true)
  const backup = exported.backup
  const groupKey = sourceGroup.backup_group_key
  assert.match(backup.manifest.groups[0].source_login_user_hash, /^[a-f0-9]{64}$/u)
  assert.ok(backup.groups[groupKey], 'backup should include selected group payload')
  assert.deepEqual(Object.keys(backup.groups[groupKey]).sort(), [
    'activity',
    'media_items',
    'member_identities',
    'member_identity_aliases',
    'member_names',
    'memory_items',
    'messages',
  ].sort())
  const backupText = JSON.stringify(backup.groups[groupKey])
  assert.equal(backupText.includes('knowledge_sources'), false)
  assert.equal(backupText.includes('llmProfiles'), false)
  assert.equal(backupText.includes('wechat_clawbot_tokens'), false)
  assert.ok(backup.groups[groupKey].media_items[0]?.base64, 'media base64 should be included')

  const damagedBackup = JSON.parse(JSON.stringify(backup))
  damagedBackup.groups[groupKey].messages.push({ content: 'tampered' })
  const damagedPreview = previewWeChatGroupBackupImport({
    backup: damagedBackup,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: targetRoomId, topic: groupName }] },
  })
  assert.equal(damagedPreview.groups[0].match_status, 'invalid_payload')
  assert.equal(damagedPreview.groups[0].importable, false)

  const offlinePreview = previewWeChatGroupBackupImport({
    backup,
    roomStatus: { ok: false, online: false, rooms_stale: false, rooms: [], error: 'offline' },
  })
  assert.equal(offlinePreview.groups[0].match_status, 'wechat_not_ready')
  assert.equal(offlinePreview.groups[0].importable, false)

  const stalePreview = previewWeChatGroupBackupImport({
    backup,
    roomStatus: { ok: true, fresh: false, online: true, rooms_stale: true, rooms: [{ id: targetRoomId, topic: groupName }] },
  })
  assert.equal(stalePreview.groups[0].match_status, 'wechat_not_ready')
  assert.equal(stalePreview.groups[0].importable, false)

  const duplicateNamePreview = previewWeChatGroupBackupImport({
    backup,
    roomStatus: {
      ok: true,
      fresh: true,
      online: true,
      rooms_stale: false,
      rooms: [{ id: '@@duplicate-a', topic: groupName }, { id: '@@duplicate-b', topic: groupName }],
    },
  })
  assert.equal(duplicateNamePreview.groups[0].match_status, 'ambiguous_name')
  assert.equal(duplicateNamePreview.groups[0].importable, false)

  const exactPreview = previewWeChatGroupBackupImport({
    backup,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: '@@backup-source-room', topic: '同一个群改名后仍按 room id 匹配' }] },
  })
  assert.equal(exactPreview.groups[0].match_status, 'exact_id')
  assert.equal(exactPreview.groups[0].importable, true)

  const missingPreview = previewWeChatGroupBackupImport({
    backup,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: '@@other-room', topic: '别的群' }] },
  })
  assert.equal(missingPreview.groups[0].match_status, 'missing')
  assert.equal(missingPreview.groups[0].importable, false)

  const preview = previewWeChatGroupBackupImport({
    backup,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: targetRoomId, topic: groupName }] },
  })
  assert.equal(preview.ok, true)
  assert.equal(preview.groups[0].match_status, 'unique_name')
  assert.equal(preview.groups[0].requires_name_confirmation, true)

  const blocked = importWeChatGroupBackup({
    backup,
    selectedGroupKeys: [groupKey],
    allowUniqueNameMatch: false,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: targetRoomId, topic: groupName }] },
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.skipped_groups[0].match_status, 'unique_name')

  const imported = importWeChatGroupBackup({
    backup,
    selectedGroupKeys: [groupKey],
    allowUniqueNameMatch: true,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: targetRoomId, topic: groupName }] },
  })
  assert.equal(imported.ok, true)
  assert.equal(imported.groups.length, 1)
  assert.equal(imported.groups[0].target_group_id, targetGroupId)

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wechat_group_activity WHERE group_id = ?').get(targetGroupId).n, 1)
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM wechat_group_messages WHERE group_id = ?').get(targetGroupId).n >= 1)
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM wechat_group_memory_items WHERE group_id = ?').get(targetGroupId).n >= 1)
  const importedMessage = db.prepare('SELECT id FROM wechat_group_messages WHERE group_id = ? AND content = ?').get(targetGroupId, '成员A喜欢把迁移方案写清楚')
  const importedMemory = db.prepare('SELECT source_message_id FROM wechat_group_memory_items WHERE group_id = ? AND content = ?').get(targetGroupId, '成员A需要保留成员记忆')
  assert.ok(importedMessage?.id, 'imported source message should exist')
  assert.equal(Number(importedMemory?.source_message_id || 0), Number(importedMessage.id), 'memory source_message_id should be remapped')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wechat_group_media_items WHERE group_id = ?').get(targetGroupId).n, 1)
  const mediaRow = db.prepare('SELECT relative_path, description FROM wechat_group_media_items WHERE group_id = ?').get(targetGroupId)
  assert.match(mediaRow.description, /备份测试图片解析结果/u)
  assert.ok(mediaRow.relative_path)
  assert.equal(fs.existsSync(path.join(tmp, mediaRow.relative_path)), true)

  const beforeActivity = db.prepare('SELECT COUNT(*) AS n FROM wechat_group_activity WHERE group_id = ?').get(targetGroupId).n
  const duplicate = importWeChatGroupBackup({
    backup,
    selectedGroupKeys: [groupKey],
    allowUniqueNameMatch: true,
    roomStatus: { ok: true, fresh: true, online: true, rooms_stale: false, rooms: [{ id: targetRoomId, topic: groupName }] },
  })
  assert.equal(duplicate.ok, true)
  const afterActivity = db.prepare('SELECT COUNT(*) AS n FROM wechat_group_activity WHERE group_id = ?').get(targetGroupId).n
  assert.equal(afterActivity, beforeActivity, 'duplicate import must not duplicate activity rows')
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM wechat_group_activity_fts').get().n >= 1)
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM wechat_group_messages_fts').get().n >= 1)

  console.log('[PASS] wechat group backup export/import')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
