import assert from 'node:assert/strict'
import { isLikelyProgressOnlySendMessageContent } from '../src/llm.js'

const progressCases = [
  '我看一下，查个具体时间',
  '稍等，我上网确认一下具体日期。',
  'Let me check the exact date.',
]

const finalCases = [
  '部落冲突联赛（CWL）每个月举办一次，每次持续7天。当前赛季大概在6月10号左右结束。',
  '没查到官方明确日期，只能确认本月联赛仍按7天周期进行。',
  '这是最终答案，不需要再补充。',
]

for (const text of progressCases) {
  assert.equal(isLikelyProgressOnlySendMessageContent(text), true, `expected progress-only: ${text}`)
}

for (const text of finalCases) {
  assert.equal(isLikelyProgressOnlySendMessageContent(text), false, `expected final reply: ${text}`)
}

console.log('wechaty send_message stop policy ok')
