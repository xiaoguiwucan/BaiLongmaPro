import assert from 'node:assert/strict'
import { parseSocialTarget } from '../src/social/targets.js'

const roomId = '@@69795002bd418807fb98fa14d265bd29d26c8353b007880132a885343cee912a'
const memberId = '@73eef5ef1cc32eb441a51298a8b4ed53827cc87f62a7491296fc8d5be4c7667d'

const groupTarget = parseSocialTarget(`wechaty:room:${encodeURIComponent(roomId)}:member:${encodeURIComponent(memberId)}`)
assert.deepEqual(groupTarget, {
  platform: 'wechaty-duty-group',
  roomId,
  memberId,
  raw: `wechaty:room:${encodeURIComponent(roomId)}:member:${encodeURIComponent(memberId)}`,
})

const legacyTarget = parseSocialTarget(`wechaty:room:${roomId}`)
assert.equal(legacyTarget.platform, 'wechaty-duty-group')
assert.equal(legacyTarget.roomId, roomId)
assert.equal(legacyTarget.memberId, undefined)

const encodedLegacyTarget = parseSocialTarget(`wechaty:room:${encodeURIComponent(roomId)}`)
assert.equal(encodedLegacyTarget.platform, 'wechaty-duty-group')
assert.equal(encodedLegacyTarget.roomId, roomId)

console.log('[PASS] social target parser')
