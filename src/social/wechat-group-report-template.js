const TEMPLATE_IDS = ['guochao-red-gold', 'editorial-newspaper', 'ancient-scroll', 'ink-wash']

export const WECHAT_GROUP_REPORT_TEMPLATES = [
  { id: 'guochao-red-gold', name: '手机长图 · 朱砂重点' },
  { id: 'editorial-newspaper', name: '手机长图 · 报告黑白' },
  { id: 'ancient-scroll', name: '手机长图 · 宣纸棕墨' },
  { id: 'ink-wash', name: '手机长图 · 青墨摘要' },
]

const THEMES = {
  'guochao-red-gold': { accent: '#b42318', soft: '#fff4f0', ink: '#211715', label: '朱砂重点' },
  'editorial-newspaper': { accent: '#111111', soft: '#f5f2ea', ink: '#151515', label: '报告黑白' },
  'ancient-scroll': { accent: '#8a4b16', soft: '#fff7df', ink: '#3c2614', label: '宣纸棕墨' },
  'ink-wash': { accent: '#1d5b4a', soft: '#eef7f3', ink: '#14231e', label: '青墨摘要' },
}

export function normalizeWeChatGroupReportTemplate(value = '') {
  const id = String(value || '').trim()
  return TEMPLATE_IDS.includes(id) ? id : 'guochao-red-gold'
}

function esc(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanText(value = '', max = 160) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .replace(/\[媒体文件\]\s+\S+/gu, '')
    .trim()
    .slice(0, max)
}

function shortName(value = '', max = 8) {
  const text = String(value || '未知成员').trim() || '未知成员'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function formatDateTime(value = '') {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).replace('T', ' ').slice(0, 16)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatClock(value = '') {
  const text = formatDateTime(value)
  return text ? text.slice(11) : ''
}

function formatRange(from = '', to = '') {
  const f = formatDateTime(from)
  const t = formatDateTime(to)
  if (!f && !t) return '本时段'
  if (!f) return `${t} 前`
  if (!t) return `${f} 至现在`
  const fd = f.slice(0, 10)
  const td = t.slice(0, 10)
  if (fd === td) return `${fd} ${f.slice(11)}-${t.slice(11)}`
  return `${f} 至 ${t}`
}

function positiveRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(row => Number(row?.value || 0) > 0)
}

function first(rows = []) {
  return positiveRows(rows)[0] || { name: '暂无', value: 0 }
}

function rowName(row = {}) {
  return row.sender_display_name || row.sender_name || row.sender_id || row.name || '群成员'
}

function rowText(row = {}, max = 120) {
  return cleanText(row.display_text || row.raw_text || '', max)
}

function extractKeywords(stats = {}, limit = 8) {
  const rows = [
    ...(Array.isArray(stats.important) ? stats.important : []),
    ...(Array.isArray(stats.recent) ? stats.recent : []),
  ]
  const source = rows.map(row => rowText(row, 200)).join(' ')
  const stop = new Set('这个 那个 什么 怎么 为啥 为什么 不是 没有 一下 可以 已经 现在 今天 明天 群聊 消息 图片 表情 链接 还是 继续 时候 一个 起来 我们 你们 他们 这里 那里 真的 感觉 进行 需要 问题'.split(' '))
  const counts = new Map()
  const add = (token = '', score = 1) => {
    const value = token.trim()
    if (!value || stop.has(value) || /^\d+$/.test(value)) return
    const prev = counts.get(value) || { count: 0, score: 0 }
    counts.set(value, { count: prev.count + 1, score: prev.score + score })
  }
  for (const match of source.matchAll(/[“"「『']([^”"」』']{2,16})[”"」』']/gu)) {
    add(match[1], 6)
  }
  for (const token of source.match(/[A-Za-z0-9_][A-Za-z0-9_.-]{1,30}/gu) || []) {
    add(token, 3)
  }
  for (const block of source.match(/[\u4e00-\u9fa5]{2,32}/gu) || []) {
    if (block.length <= 6) add(block, block.length)
    const maxLen = Math.min(6, block.length)
    for (let len = maxLen; len >= 2; len -= 1) {
      for (let i = 0; i <= block.length - len; i += 1) {
        add(block.slice(i, i + len), len)
      }
    }
  }
  const picked = []
  for (const item of [...counts.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count || b[0].length - a[0].length || a[0].localeCompare(b[0], 'zh-Hans-CN'))
  ) {
    const [word] = item
    if (picked.some(([prev]) => prev.includes(word) || word.includes(prev))) continue
    picked.push(item)
    if (picked.length >= limit) break
  }
  return picked.map(([word, item]) => ({ word, count: item.count }))
}

function pickTimelineRows(stats = {}, limit = 8) {
  const important = Array.isArray(stats.important) ? stats.important : []
  const recent = Array.isArray(stats.recent) ? stats.recent : []
  const source = important.length ? important : recent
  return source
    .filter(row => rowText(row, 80))
    .slice(-limit)
}

function buildConclusion(stats = {}, keywords = []) {
  const totals = stats.totals || {}
  const total = Number(totals.message_count || 0)
  const participants = Number(totals.participant_count || 0)
  const images = Number(totals.image_count || 0)
  const links = Number(totals.link_count || 0)
  if (!total) return '这个时间段内没有记录到可统计的群聊消息。'
  const topicText = keywords.length ? `主要线索集中在 ${keywords.slice(0, 3).map(item => `“${item.word}”`).join('、')}。` : '没有形成明显高频关键词。'
  const mediaText = images || links
    ? `图片 ${images} 张、链接 ${links} 条，说明群里既有聊天也有素材/信息流动。`
    : '本时段以文字聊天为主，图片和链接较少。'
  return `本时段共记录 ${total} 条消息，${participants || 0} 位成员参与。${topicText}${mediaText}`
}

function metricBlock(label, value, unit = '') {
  return `<div class="metric"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(unit)}</small></div>`
}

function rankList(title, rows = [], unit = '次', limit = 5) {
  const safe = positiveRows(rows).slice(0, limit)
  if (!safe.length) return `<section class="section"><h2>${esc(title)}</h2><p class="empty">暂无可展示排行。</p></section>`
  return `<section class="section"><h2>${esc(title)}</h2><ol class="rank-list">${safe.map((row, i) => `
    <li>
      <i>${i + 1}</i>
      <strong>${esc(shortName(row.name, 12))}</strong>
      <span>${esc(row.value || 0)}${esc(unit)}</span>
    </li>`).join('')}</ol></section>`
}

function topicSections(keywords = [], timeline = []) {
  if (!keywords.length && !timeline.length) {
    return '<section class="section"><h2>主要话题</h2><p class="empty">消息量不足，暂未提取到稳定话题。</p></section>'
  }
  const rows = keywords.slice(0, 5).map((item, index) => {
    const evidence = timeline.find(row => rowText(row, 140).includes(item.word)) || timeline[index] || null
    const text = evidence ? rowText(evidence, 110) : '该关键词在本时段多次出现，作为话题线索保留。'
    return `<li><strong>${esc(item.word)}<em>出现 ${esc(item.count || 1)} 次</em></strong><span>${esc(text)}</span></li>`
  }).join('')
  return `<section class="section"><h2>主要话题</h2><ul class="topic-list">${rows}</ul></section>`
}

function timelineSection(rows = []) {
  if (!rows.length) return '<section class="section"><h2>关键时间线</h2><p class="empty">暂无明显关键消息。</p></section>'
  return `<section class="section"><h2>关键时间线</h2><div class="timeline">${rows.map(row => `
    <div class="timeline-row">
      <time>${esc(formatClock(row.timestamp) || '--:--')}</time>
      <div><b>${esc(shortName(rowName(row), 10))}</b><p>${esc(rowText(row, 128))}</p></div>
    </div>`).join('')}</div></section>`
}

function activePeopleSection(boards = {}) {
  const top = [
    ['发言最活跃', first(boards.messages), '条'],
    ['图片贡献', first(boards.images), '张'],
    ['表情贡献', first(boards.emojis), '个'],
    ['链接贡献', first(boards.links), '条'],
  ].filter(([, row]) => Number(row.value || 0) > 0)
  if (!top.length) return '<section class="section"><h2>活跃成员</h2><p class="empty">暂无明显活跃成员。</p></section>'
  return `<section class="section"><h2>活跃成员</h2><div class="people-grid">${top.map(([label, row, unit]) => `
    <div class="person">
      <span>${esc(label)}</span>
      <b>${esc(shortName(row.name, 10))}</b>
      <small>${esc(row.value || 0)}${esc(unit)}</small>
    </div>`).join('')}</div></section>`
}

function buildData(stats = {}) {
  const totals = stats.totals || {}
  const boards = stats.leaderboards || {}
  const keywords = extractKeywords(stats)
  const timeline = pickTimelineRows(stats)
  return {
    group: stats.group_name || stats.group_id || '本群',
    range: formatRange(stats.from, stats.to),
    conclusion: buildConclusion(stats, keywords),
    totals,
    boards,
    keywords,
    timeline,
    generatedAt: formatDateTime(new Date().toISOString()),
  }
}

const css = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:720px;background:#fff;color:#1f2328;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif}
body{overflow-x:hidden}
.summary-card{width:720px;margin:0;background:#fff;padding:52px 46px 42px}
.hero{border-bottom:4px solid var(--accent);padding-bottom:28px}
.eyebrow{margin:0 0 18px;color:var(--accent);font-size:20px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0;color:var(--ink);font-size:46px;line-height:1.16;font-weight:950;letter-spacing:0}
.meta{display:grid;grid-template-columns:1fr;gap:8px;margin-top:18px;color:#4d5562;font-size:22px;line-height:1.35;font-weight:700}
.lead{margin:30px 0 0;padding:24px 0;border-bottom:1px solid #d8dee7;color:#20252c}
.lead b{display:block;margin-bottom:10px;color:var(--accent);font-size:20px;line-height:1.2;font-weight:950}
.lead span{display:block;font-size:25px;line-height:1.55;font-weight:800}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #1f2328;border-left:1px solid #1f2328;margin:34px 0 4px}
.metric{min-height:112px;border-right:1px solid #1f2328;border-bottom:1px solid #1f2328;padding:16px 14px;background:var(--soft)}
.metric span{display:block;color:#4d5562;font-size:17px;font-weight:850}
.metric b{display:block;margin-top:8px;color:var(--ink);font-size:34px;line-height:1;font-weight:950}
.metric small{display:block;margin-top:5px;color:#6a737d;font-size:16px;font-weight:800}
.section{padding:34px 0;border-bottom:1px solid #d8dee7}
h2{margin:0 0 18px;color:var(--ink);font-size:30px;line-height:1.2;font-weight:950}
.topic-list,.rank-list{margin:0;padding:0;list-style:none}
.topic-list{display:grid;gap:18px}
.topic-list li{border-left:5px solid var(--accent);padding-left:16px}
.topic-list strong{display:flex;align-items:baseline;gap:12px;color:var(--ink);font-size:24px;line-height:1.2}
.topic-list em{font-style:normal;color:#6a737d;font-size:17px;font-weight:850;white-space:nowrap}
.topic-list span{display:block;margin-top:7px;color:#3a424d;font-size:21px;line-height:1.48;font-weight:650}
.timeline{display:grid;gap:20px}
.timeline-row{display:grid;grid-template-columns:76px minmax(0,1fr);gap:18px;align-items:start}
.timeline-row time{color:var(--accent);font-size:21px;font-weight:950;line-height:1.2}
.timeline-row b{display:block;color:#30363d;font-size:21px;line-height:1.2}
.timeline-row p{margin:6px 0 0;color:#3f4752;font-size:21px;line-height:1.5;font-weight:650}
.people-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#1f2328;border:1px solid #1f2328}
.person{min-height:116px;background:#fff;padding:18px}
.person span{display:block;color:#6a737d;font-size:17px;font-weight:850}
.person b{display:block;margin-top:8px;color:var(--ink);font-size:25px;line-height:1.15;font-weight:950;word-break:break-all}
.person small{display:block;margin-top:7px;color:var(--accent);font-size:19px;font-weight:900}
.rank-list{display:grid;gap:1px;background:#d8dee7}
.rank-list li{display:grid;grid-template-columns:44px minmax(0,1fr) 86px;align-items:center;gap:12px;background:#fff;padding:14px 0}
.rank-list i{font-style:normal;color:var(--accent);font-size:24px;font-weight:950;text-align:center}
.rank-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:22px;color:#24292f}
.rank-list span{text-align:right;font-size:20px;color:#4d5562;font-weight:900}
.note{margin:0;color:#4d5562;font-size:20px;line-height:1.55;font-weight:650}
.empty{margin:0;color:#6a737d;font-size:21px;line-height:1.5}
.footer{padding-top:30px;color:#6a737d;font-size:18px;line-height:1.45;font-weight:700}
.footer b{color:var(--accent)}
`

export function renderWeChatGroupStatsPosterHtml(stats = {}, { templateId = 'guochao-red-gold' } = {}) {
  const template = normalizeWeChatGroupReportTemplate(templateId)
  const theme = THEMES[template] || THEMES['guochao-red-gold']
  const d = buildData(stats)
  const totals = d.totals || {}
  const styleVars = `--accent:${theme.accent};--soft:${theme.soft};--ink:${theme.ink}`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=720,initial-scale=1"><title>${esc(d.group)} 群聊总结</title><style>${css}</style></head><body><main id="summary-card" class="summary-card" style="${styleVars}">
    <header class="hero">
      <p class="eyebrow">BAILONGMA · ${esc(theme.label)}</p>
      <h1>${esc(d.group)}<br>群聊总结</h1>
      <div class="meta"><span>统计范围：${esc(d.range)}</span><span>生成时间：${esc(d.generatedAt)}</span></div>
    </header>
    <p class="lead"><b>一句话总结</b><span>${esc(d.conclusion)}</span></p>
    <section class="metrics" aria-label="数据概览">
      ${metricBlock('消息总量', totals.message_count || 0, '条')}
      ${metricBlock('参与成员', totals.participant_count || 0, '人')}
      ${metricBlock('图片', totals.image_count || 0, '张')}
      ${metricBlock('表情', totals.emoji_count || 0, '个')}
      ${metricBlock('链接', totals.link_count || 0, '条')}
      ${metricBlock('高光', totals.brag_count || 0, '次')}
    </section>
    ${topicSections(d.keywords, d.timeline)}
    ${timelineSection(d.timeline)}
    ${activePeopleSection(d.boards)}
    ${rankList('发言排行', d.boards.messages, '条')}
    <section class="section"><h2>数据限制</h2><p class="note">本图只使用白龙马当前框架已经入库的群聊统计数据生成，不读取 wechat-cli。图片、表情、链接按消息占位和计数统计；除非消息文本或已入库识图结果可用，否则不会推断图片内部内容。</p></section>
    <footer class="footer">由 <b>BaiLongma</b> 根据本地群聊统计生成。</footer>
  </main></body></html>`
}
