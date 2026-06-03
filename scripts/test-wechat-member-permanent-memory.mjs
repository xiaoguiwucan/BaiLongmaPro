import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-member-memory-'))
process.env.BAILONGMA_USER_DIR = tmpDir

try {
  const { getDB } = await import('../src/db.js')
  const {
    createWeChatGroupManualMemory,
    backfillWeChatExplicitMemoriesFromMessages,
    deleteWeChatMemberPermanentMemory,
    listWeChatMemberPermanentMemory,
    recordWeChatGroupMessage,
    updateWeChatMemberPermanentMemory,
  } = await import('../src/social/wechat-group-memory.js')

  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_group_member_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      sender_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      room_alias TEXT NOT NULL DEFAULT '',
      contact_alias TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      wechat_id TEXT NOT NULL DEFAULT '',
      wxid TEXT NOT NULL DEFAULT '',
      stable_key TEXT NOT NULL DEFAULT '',
      raw_identity TEXT NOT NULL DEFAULT '',
      UNIQUE(group_id, sender_id)
    );
  `)
  const now = new Date().toISOString()
  const insertMember = db.prepare(`
    INSERT INTO wechat_group_member_names (
      group_id, group_name, sender_id, display_name, room_alias, contact_alias, contact_name,
      source, first_seen, last_seen, wechat_id, wxid, stable_key, raw_identity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', ?, ?, ?, ?, ?, '{}')
    ON CONFLICT(group_id, sender_id) DO UPDATE SET last_seen=excluded.last_seen
  `)
  insertMember.run('wechaty:room-a', '测试群', 'sender-old', '大哥', '大哥', '', '', now, now, 'wechat-alias-1', 'wxid_same_person', 'wxid_same_person')
  insertMember.run('wechaty:room-a', '测试群', 'sender-new', '大哥', '大哥', '', '', now, now, 'wechat-alias-1', 'wxid_same_person', 'wxid_same_person')

  await recordWeChatGroupMessage({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderId: 'sender-old',
    senderName: '大哥',
    text: '我负责 PT 站话题',
  })
  await recordWeChatGroupMessage({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderId: 'sender-old',
    senderName: '大哥',
    text: '今天这个种子规则我觉得要按老办法来，别太花。',
  })
  const created = await createWeChatGroupManualMemory({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderId: 'sender-old',
    senderName: '大哥',
    content: '大哥负责 PT 站相关话题',
    category: 'member_role',
  })
  if (!created.ok) throw new Error(`create failed: ${created.error || 'unknown'}`)

  const listed = listWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderId: 'sender-new',
    senderName: '大哥',
  })
  if (!listed.ok) throw new Error('list should succeed')
  if (!listed.members.length) throw new Error('member list should include merged identity')
  if (!listed.memories.some(item => item.content.includes('PT 站'))) throw new Error('memory should survive sender_id change')

  const item = listed.memories.find(row => row.content.includes('PT 站'))
  const updated = updateWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-a',
    itemId: item.id,
    content: '大哥负责 PT 站和种子规则相关话题',
    category: 'member_role',
  })
  if (!updated.ok) throw new Error('update should succeed')
  const edited = listWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    canonicalMemberId: listed.selected.canonical_member_id,
  })
  if (!edited.memories.some(row => row.content.includes('种子规则'))) throw new Error('edited content not found')

  const deleted = deleteWeChatMemberPermanentMemory({ groupId: 'wechaty:room-a', itemId: item.id })
  if (!deleted.ok) throw new Error('delete should succeed')
  const afterDelete = listWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    canonicalMemberId: listed.selected.canonical_member_id,
  })
  if (afterDelete.memories.some(row => row.id === item.id)) throw new Error('deleted memory should be hidden')

  for (let i = 0; i < 1200; i++) {
    const senderId = `bulk-sender-${i}`
    const senderName = `群友${i}`
    insertMember.run('wechaty:room-big', '大群测试', senderId, senderName, senderName, '', '', now, now, '', '', '')
    await recordWeChatGroupMessage({
      groupId: 'wechaty:room-big',
      groupName: '大群测试',
      senderId,
      senderName,
      text: `我是${senderName}，我负责第 ${i} 号测试事项`,
    })
  }
  const bigList = listWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-big',
    groupName: '大群测试',
    limit: 2000,
  })
  if (bigList.members.length < 1200) throw new Error(`large group member list truncated: ${bigList.members.length}`)

  const backfill = await backfillWeChatExplicitMemoriesFromMessages({ limit: 2000, archiveMessages: true })
  if (!backfill.ok) throw new Error(`backfill failed: ${(backfill.errors || []).join('; ')}`)
  if ((backfill.archived || 0) < 1 && (backfill.deduped || 0) < 1) throw new Error('backfill should archive member permanent memories from old messages')
  if ((backfill.utterance_archived || 0) < 1 && (backfill.deduped || 0) < 1) throw new Error('backfill should archive member utterance material')
  if ((backfill.persona_summaries || 0) < 1 && (backfill.persona_updated || 0) < 1) throw new Error('backfill should create or update member persona summaries')
  const archived = listWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-big',
    groupName: '大群测试',
    senderName: '群友12',
    q: '第 12 号测试事项',
  })
  if (!archived.memories.some(row => row.content.includes('第 12 号测试事项'))) throw new Error('archived member memory not found after backfill')
  const persona = listWeChatMemberPermanentMemory({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderName: '大哥',
  })
  if (!persona.memories.some(row => row.category === 'member_persona_summary' && row.content.includes('群友人设总结'))) throw new Error('member persona summary not found')
  if (!persona.memories.some(row => row.category === 'member_utterance' && row.content.includes('种子规则'))) throw new Error('member utterance memory not found')

  console.log('[PASS] WeChat member permanent memory CRUD and identity merge')
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
