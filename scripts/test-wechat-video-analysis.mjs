import assert from 'assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-video-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const { getDB } = await import('../src/db.js')
const { setSkillVideoAnalysisConfig } = await import('../src/config.js')
const { getWeChatImageVisionStatus } = await import('../src/social/wechat-image-vision.js')
const {
  analyzeWechatVideoMessage,
  getWeChatVideoAnalysisStatus,
  isWechatVideoAnalysisIntent,
  isWechatVideoMessageType,
} = await import('../src/social/wechat-video-analysis-skill.js')
const { __wechatyVideoTestInternals } = await import('../src/social/wechaty-duty-group.js')

getWeChatImageVisionStatus()

setSkillVideoAnalysisConfig({
  enabled: true,
  failoverEnabled: true,
  activeChannelId: 'video_test',
  channels: [{
    id: 'video_test',
    name: '测试视频渠道',
    enabled: true,
    baseUrl: 'https://video.example/v1',
    model: 'video-test-model',
    apiKey: 'test-key',
  }],
  apiTimeoutSeconds: 30,
  maxVideoBytesMB: 5,
})

let requestBody = null
globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, 'https://video.example/v1/chat/completions')
  assert.equal(options.headers.Authorization, 'Bearer test-key')
  requestBody = JSON.parse(options.body)
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: '这个视频主要展示了白龙马测试流程，包含临时读取、模型解析和清理。' } }],
      })
    },
  }
}

const videoBytes = Buffer.from('00000018667479706d703432000000006d703432', 'hex')
const fakeMessage = {
  id: 'msg-video-1',
  async toFileBox() {
    return {
      name: '群视频.mp4',
      async toFile(filePath) {
        fs.writeFileSync(filePath, videoBytes)
      },
    }
  },
}

assert.equal(isWechatVideoMessageType('video'), true)
assert.equal(isWechatVideoMessageType(15), true)
assert.equal(isWechatVideoMessageType('image'), false)
assert.equal(isWechatVideoAnalysisIntent('@白龙马 看下这个视频讲了啥'), true)

const beforeCount = getDB().prepare('SELECT COUNT(*) AS n FROM wechat_group_media_items').get().n
const result = await analyzeWechatVideoMessage({
  message: fakeMessage,
  text: '@白龙马 解析这个视频讲了啥',
  messageType: 'video',
  messageId: fakeMessage.id,
})
const afterCount = getDB().prepare('SELECT COUNT(*) AS n FROM wechat_group_media_items').get().n

assert.equal(result.ok, true)
assert.match(result.content, /白龙马测试流程/)
assert.equal(result.tempDeleted, true)
assert.equal(fs.existsSync(result.tempDir), false)
assert.equal(afterCount, beforeCount, 'video analysis must not write image media DB rows')
assert.equal(requestBody.model, 'video-test-model')
assert.equal(requestBody.messages[0].content[1].type, 'video_url')
assert.match(requestBody.messages[0].content[1].video_url.url, /^data:video\/mp4;base64,/)

const status = getWeChatVideoAnalysisStatus()
assert.equal(status.configured, true)
assert.equal(status.lastRun.ok, true)
assert.equal(status.lastRun.tempDeleted, true)

__wechatyVideoTestInternals.clearRecentWechatVideos()
__wechatyVideoTestInternals.rememberRecentWechatUserMessage({
  groupId: 'wechaty:test-room',
  senderId: 'member-a',
  senderName: '风',
  text: '[视频]',
  messageType: 'video',
  message: fakeMessage,
  messageId: fakeMessage.id,
})
assert.equal(__wechatyVideoTestInternals.hasWechatVideoReferenceIntent('看看这个视频什么电影或者影视的片段'), true)
assert.equal(__wechatyVideoTestInternals.hasWechatVideoReferenceIntent('看看这个视频', { quote: { ok: true, kind: 'video' } }), true)
assert.equal(__wechatyVideoTestInternals.hasWechatImageUnderstandingIntent('看看这个视频内容'), true, 'legacy image regex still sees 看看...内容')
assert.equal(__wechatyVideoTestInternals.getWechatImageUnderstandingGate({ text: '看看这个视频内容' }).handle, false, 'video wording must not trigger direct image parsing')
const sameSenderVideo = __wechatyVideoTestInternals.getRecentWechatVideoCandidate({
  groupId: 'wechaty:test-room',
  senderId: 'member-a',
  senderName: '风',
})
assert.equal(sameSenderVideo.message, fakeMessage, 'follow-up text should find the sender recent video message')
__wechatyVideoTestInternals.ageRecentWechatVideosForTest(13 * 24 * 60 * 60 * 1000)
const thirteenDayVideo = __wechatyVideoTestInternals.getRecentWechatVideoCandidate({
  groupId: 'wechaty:test-room',
  senderId: 'member-a',
  senderName: '风',
})
assert.equal(thirteenDayVideo.message, fakeMessage, 'wechat video reference cache should follow the 14-day retention window')
__wechatyVideoTestInternals.ageRecentWechatVideosForTest(2 * 24 * 60 * 60 * 1000)
const expiredVideo = __wechatyVideoTestInternals.getRecentWechatVideoCandidate({
  groupId: 'wechaty:test-room',
  senderId: 'member-a',
  senderName: '风',
})
assert.equal(expiredVideo, null, 'wechat video reference cache should expire after 14 days')
__wechatyVideoTestInternals.clearRecentWechatVideos()
__wechatyVideoTestInternals.rememberRecentWechatUserMessage({
  groupId: 'wechaty:test-room',
  senderId: 'member-a',
  senderName: '风',
  text: '<svrid>msg-video-1</svrid>',
  messageType: 'video',
  message: fakeMessage,
  messageId: fakeMessage.id,
})
const quotedVideo = __wechatyVideoTestInternals.getRecentWechatVideoCandidate({
  groupId: 'wechaty:test-room',
  senderId: 'member-b',
  senderName: '另一个人',
  preferSender: false,
  quote: { ok: true, kind: 'video', messageIds: ['msg-video-1'] },
})
assert.equal(quotedVideo.message, fakeMessage, 'quoted video request should fall back to the recent group video message')

console.log('[PASS] wechat video analysis skill temp cleanup and no media DB writes')
