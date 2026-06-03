import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-local-memory-'))
process.env.BAILONGMA_USER_DIR = tmpDir

try {
  const { getHonchoConfig } = await import('../src/config.js')
  const {
    getHonchoConfig: _unused,
  } = { getHonchoConfig }
  void _unused
  const {
    getWeChatGroupMemoryStatus,
    recordWeChatGroupMessage,
    recordWeChatGroupAssistantReply,
    createWeChatGroupManualMemory,
    listWeChatGroupMemory,
    listWeChatGroupMemoryOverview,
    getWeChatGroupMemoryContext,
    deleteWeChatGroupMemory,
  } = await import('../src/social/wechat-group-memory.js')

  const cfg = getHonchoConfig()
  if (cfg.enabled !== false) throw new Error('Honcho should be disabled by default')

  const status = getWeChatGroupMemoryStatus()
  if (status.provider !== 'local') throw new Error('memory status should report local provider')

  await recordWeChatGroupMessage({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderId: 'u1',
    senderName: '大哥',
    text: '以后叫我大哥',
    mentionedSelf: true,
  })
  await recordWeChatGroupAssistantReply({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    reply: '好的大哥',
    targetMemberName: '大哥',
  })
  await createWeChatGroupManualMemory({
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    senderId: 'u1',
    senderName: '大哥',
    content: '大哥喜欢直接可执行的安装包',
    category: 'preference',
  })

  const listed = await listWeChatGroupMemory({ groupId: 'wechaty:room-a', groupName: '测试群' })
  if (listed.provider !== 'local') throw new Error('local list should use local provider')
  if (listed.counts.totalMessages < 2) throw new Error('local messages were not recorded')
  if (listed.counts.conclusions < 1) throw new Error('local memory was not recorded')

  const overview = await listWeChatGroupMemoryOverview({ groups: [{ id: 'room-a', topic: '测试群', selected: true }] })
  if (overview.provider !== 'local' || overview.groups.length !== 1) throw new Error('local overview failed')

  const context = await getWeChatGroupMemoryContext({
    groupId: 'wechaty:room-a',
    senderId: 'u1',
    senderName: '大哥',
    query: '安装包',
  })
  if (!context.includes('直接可执行的安装包')) throw new Error('local context recall failed')

  const deleted = await deleteWeChatGroupMemory({ groupId: 'wechaty:room-a', kind: 'session' })
  if (!deleted.ok || deleted.provider !== 'local') throw new Error('local delete failed')

  console.log('[PASS] local WeChat group memory engine')
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
