import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert/strict'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-hotspot-alert-toggle-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

try {
  const { setHotspotAlertConfig } = await import('../src/config.js')
  const {
    getHotspotAlertStatus,
    startHotspotAlertScheduler,
    stopHotspotAlertScheduler,
  } = await import('../src/hotspot-alert-monitor.js')

  setHotspotAlertConfig({ enabled: true, intervalMinutes: 5 })
  let started = startHotspotAlertScheduler()
  assert.equal(started.ok, true)
  assert.equal(getHotspotAlertStatus().scheduler_running, true, 'scheduler should start when enabled')

  setHotspotAlertConfig({ enabled: false })
  const disabled = startHotspotAlertScheduler()
  assert.equal(disabled.ok, true)
  assert.equal(disabled.reason, 'hotspot_alert_disabled')
  assert.equal(getHotspotAlertStatus().scheduler_running, false, 'disabled config should stop existing scheduler')

  setHotspotAlertConfig({ enabled: true, intervalMinutes: 5 })
  started = startHotspotAlertScheduler()
  assert.equal(started.ok, true)
  assert.equal(getHotspotAlertStatus().scheduler_running, true, 'scheduler should restart after enabling')

  stopHotspotAlertScheduler()
  assert.equal(getHotspotAlertStatus().scheduler_running, false)
  console.log('[PASS] hotspot alert scheduler toggle')
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}
