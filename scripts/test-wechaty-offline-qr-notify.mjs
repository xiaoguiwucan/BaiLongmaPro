import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildWechatyOfflineQrNotifyCaption,
  shouldThrottleWechatyOfflineQrNotify,
} from '../src/social/wechaty-duty-group.js'
import {
  getWechatyDutyGroupConfig,
  setWechatyDutyGroupConfig,
} from '../src/config.js'
import { paths } from '../src/paths.js'

const now = new Date('2026-05-29T12:34:56+08:00')
const caption = buildWechatyOfflineQrNotifyCaption({
  reason: 'health_check',
  hint: '微信连接已断开，请重新登录。',
  loginUser: '群助手微信',
  groupNames: ['值班群', 'PT站看片狂魔小群'],
  now,
})
assert.match(caption, /微信群助手已离线/)
assert.match(caption, /上次登录：群助手微信/)
assert.match(caption, /接入群组：值班群、PT站看片狂魔小群/)
assert.match(caption, /请扫描随附二维码恢复微信群助手登录/)
assert.ok(!/指定.*联系人|发给.*联系人|接收人/.test(caption), 'caption must not ask for a contact target')

const first = shouldThrottleWechatyOfflineQrNotify({ enabled: true, qr: 'qr-value', now: 1000 })
assert.equal(first.throttled, false)
assert.ok(first.key)

const cooldown = shouldThrottleWechatyOfflineQrNotify({
  enabled: true,
  qr: 'qr-value',
  lastKey: first.key,
  lastAt: 1000,
  cooldownMinutes: 15,
  now: 1000 + 5 * 60 * 1000,
})
assert.equal(cooldown.throttled, true)
assert.equal(cooldown.reason, 'cooldown')

const afterCooldown = shouldThrottleWechatyOfflineQrNotify({
  enabled: true,
  qr: 'qr-value',
  lastKey: first.key,
  lastAt: 1000,
  cooldownMinutes: 5,
  now: 1000 + 6 * 60 * 1000,
})
assert.equal(afterCooldown.throttled, false)

const forced = shouldThrottleWechatyOfflineQrNotify({
  enabled: true,
  qr: 'qr-value',
  lastKey: first.key,
  lastAt: 1000,
  cooldownMinutes: 60,
  now: 2000,
  force: true,
})
assert.equal(forced.throttled, false)

assert.equal(shouldThrottleWechatyOfflineQrNotify({ enabled: false, qr: 'qr-value' }).reason, 'disabled')
assert.equal(shouldThrottleWechatyOfflineQrNotify({ enabled: true, qr: '' }).reason, 'no_qr')

const originalConfig = fs.existsSync(paths.configFile) ? fs.readFileSync(paths.configFile, 'utf8') : null
try {
  for (const minutes of [5, 10, 15, 30, 60]) {
    setWechatyDutyGroupConfig({ offlineQrNotify: { enabled: true, autoRelogin: true, cooldownMinutes: minutes } })
    assert.equal(getWechatyDutyGroupConfig().offlineQrNotify.cooldownMinutes, minutes, `cooldown ${minutes} should persist`)
  }
  setWechatyDutyGroupConfig({ offlineQrNotify: { enabled: false, autoRelogin: false, cooldownMinutes: 10 } })
  assert.deepEqual(getWechatyDutyGroupConfig().offlineQrNotify, {
    enabled: false,
    autoRelogin: false,
    cooldownMinutes: 10,
  })
} finally {
  if (originalConfig === null) {
    try { fs.unlinkSync(paths.configFile) } catch {}
  } else {
    fs.writeFileSync(paths.configFile, originalConfig)
  }
}

console.log('[PASS] wechaty offline QR notify logic')
