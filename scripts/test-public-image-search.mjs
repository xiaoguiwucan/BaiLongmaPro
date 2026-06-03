import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-public-image-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

const { setWebSearchConfig, getWebSearchConfig, getWebSearchCredentials } = await import('../src/config.js')
const { searchPublicImages } = await import('../src/social/public-image-search.js')

setWebSearchConfig({ braveKeys: ['brave-key-1', 'brave-key-2'] })
const view = getWebSearchConfig()
assert.equal(view.braveStoredCount, 2)
assert.equal(getWebSearchCredentials().braveKeys.length, 2)

const calls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), key: opts.headers?.['X-Subscription-Token'] || '' })
  if (calls.length === 1) {
    return new Response(JSON.stringify({ error: 'quota exceeded' }), { status: 429, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({
    results: [{
      title: '测试猫图',
      url: 'https://example.com/page',
      properties: { url: 'https://img.example.com/cat.jpg' },
      thumbnail: { src: 'https://img.example.com/cat-thumb.jpg' },
      source: 'example.com',
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

try {
  const result = await searchPublicImages({ query: '猫图', provider: 'brave', count: 3 })
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'brave_images')
  assert.equal(result.keyIndex, 1)
  assert.equal(result.items[0].url, 'https://img.example.com/cat.jpg')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].key, 'brave-key-1')
  assert.equal(calls[1].key, 'brave-key-2')
} finally {
  globalThis.fetch = originalFetch
}

setWebSearchConfig({ clearBraveKeyIndexes: [0, 1] })
assert.equal(getWebSearchConfig().braveStoredCount, 0)

console.log('[PASS] public image search brave key pool')
