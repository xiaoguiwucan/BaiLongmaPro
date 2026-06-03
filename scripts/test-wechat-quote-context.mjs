import assert from 'node:assert/strict'
import { buildWeChatQuoteContextBlock, extractWeChatQuoteContext } from '../src/social/wechat-quote-context.js'

function expectQuote(name, input, expected = {}) {
  const quote = extractWeChatQuoteContext(input)
  assert.equal(quote.ok, true, `${name}: should detect quote`)
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(quote[key], value, `${name}: ${key}`)
  }
  const block = buildWeChatQuoteContextBlock(input)
  assert.match(block, /<wechat-quoted-message compact="true">/, `${name}: block`)
  assert.doesNotMatch(block, /<refermsg|<appmsg|CDATA/i, `${name}: prompt block must stay compact`)
  return quote
}

expectQuote('visible text quote', {
  text: '「𝓓𝓪𝓵𝓲·𝓦𝓪𝓷𝓰：公益啊」\n- - - - - - - - - - - - - - -\n@前夜 有 ds 公益站？',
}, {
  source: 'visible_quote',
  kind: 'text',
})

expectQuote('visible image quote', {
  text: '「风：[图片]」\n- - - - - - - - - - - - - - -\n@前夜 看看图片里 hermes 是啥问题',
}, {
  source: 'visible_quote',
  kind: 'image',
})

expectQuote('refermsg xml link', {
  rawText: '<msg><appmsg><refermsg><displayname>张三</displayname><content>&lt;msg&gt;&lt;appmsg&gt;&lt;title&gt;New API 文档&lt;/title&gt;&lt;des&gt;接口说明&lt;/des&gt;&lt;url&gt;https://example.com/doc&lt;/url&gt;&lt;/appmsg&gt;&lt;/msg&gt;</content><svrid>123</svrid></refermsg></appmsg></msg>',
}, {
  source: 'refermsg_xml',
  sender: '张三',
  kind: 'link',
})

expectQuote('mini program appmsg', {
  rawText: '<msg><appmsg><title>站点监控</title><des>点击查看</des><type>33</type><url>https://servicewechat.com/demo</url><weappinfo><username>gh_demo</username></weappinfo></appmsg></msg>',
}, {
  source: 'appmsg_xml',
  kind: 'mini_program',
})

expectQuote('voice xml', {
  rawText: '<msg><voicemsg voicelength="2800" /></msg>',
}, {
  source: 'media_xml',
  kind: 'voice',
})

expectQuote('video xml', {
  rawText: '<msg><videomsg playlength="12" /></msg>',
}, {
  source: 'media_xml',
  kind: 'video',
})

const noQuote = extractWeChatQuoteContext({ text: '@前夜 你好' })
assert.equal(noQuote.ok, false, 'plain text should not be detected as quote')

console.log('test-wechat-quote-context ok')
