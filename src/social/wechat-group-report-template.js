const TEMPLATE_IDS = ['guochao-red-gold', 'editorial-newspaper', 'ancient-scroll', 'ink-wash']

export const WECHAT_GROUP_REPORT_TEMPLATES = [
  { id: 'guochao-red-gold', name: '国潮红金封神榜' },
  { id: 'editorial-newspaper', name: '报纸头版群聊时报' },
  { id: 'ancient-scroll', name: '古风卷轴值班战报' },
  { id: 'ink-wash', name: '水墨山水雅集榜' },
]

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

function formatRange(from = '', to = '') {
  const f = formatDateTime(from)
  const t = formatDateTime(to)
  if (!f && !t) return '本时段'
  if (!f) return `${t.slice(11)} 前后`
  if (!t) return `${f.slice(11)} 至现在`
  const fd = f.slice(0, 10)
  const td = t.slice(0, 10)
  const ft = f.slice(11)
  const tt = t.slice(11)
  if (fd === td && ft === tt) return `${ft} 附近`
  if (fd === td) return `${ft} – ${tt}`
  return `${f} – ${t}`
}

function first(rows = []) {
  return Array.isArray(rows) && rows.length ? rows[0] : { name: '暂无', value: 0 }
}

function positiveRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(row => Number(row?.value || 0) > 0)
}

function pick(list = []) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : ''
}

function shuffle(list = []) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function activityLevel(total = 0) {
  if (total < 10) return { key: 'quiet', title: '群聊快报', label: '轻微冒泡', line: '本时段消息不多，先记一张轻量小报。' }
  if (total < 50) return { key: 'warm', title: '群聊小报', label: '小范围升温', line: '群里有来有回，榜单开始有看头。' }
  if (total < 180) return { key: 'hot', title: '群聊战报', label: '热度在线', line: '水花已经起来，榜单有点江湖味。' }
  return { key: 'boom', title: '群聊战报', label: '全群开麦', line: '消息量拉满，今天不做榜都说不过去。' }
}

function extractHotWords(stats = {}, fallback = []) {
  const source = [
    ...(stats.hot || []),
    ...(stats.hot_words || []),
    ...(stats.keywords || []),
    ...((stats.important || []).map(row => row.display_text || row.raw_text || '')),
  ].join(' ')
  const stop = new Set('这个 那个 什么 怎么 为啥 为什么 不是 没有 一下 可以 已经 现在 今天 明天 群聊 消息 图片 表情 链接 还是 继续 时候 一个 起来'.split(' '))
  const words = []
  for (const token of source.match(/[\u4e00-\u9fa5A-Za-z0-9_]{2,12}/gu) || []) {
    const value = token.trim()
    if (value && !stop.has(value) && !/^\d+$/.test(value)) words.push(value)
  }
  const defaults = fallback.length ? fallback : ['轻微冒泡', '表情接力', '情报搬运', '素材开闸', '键盘冒烟', '群友上线', '水群小浪花']
  return [...new Set([...words, ...shuffle(defaults)])].slice(0, 8)
}

function makeMood(totals = {}) {
  const total = Number(totals.message_count || 0)
  const participants = Number(totals.participant_count || 0)
  const links = Number(totals.link_count || 0)
  const images = Number(totals.image_count || 0)
  const emojis = Number(totals.emoji_count || 0)
  const level = activityLevel(total)
  const small = total < 20 || participants <= 2
  const labelPool = small
    ? ['轻轻冒泡', '低声开麦', '小范围营业', '群里亮了一下', '几朵小水花']
    : ['热度在线', '键盘冒烟', '榜单开张', '群聊升温', '水花四起']
  const summaryPool = small
    ? [
        '今天群里是小火慢炖局，消息不多但都留下了痕迹。',
        '本时段属于轻量冒泡，先把有效动静记下来。',
        '群聊没有炸锅，但有人上线、有人递图、有人搬情报。',
        '水面很平，偶尔几条消息划过，也算今日小浪花。',
      ]
    : [
        '群里热度已经起来，发言、图片和链接各有选手上桌。',
        '今天榜单有点东西，水群、发图、搬运都没缺席。',
        '群聊气氛到位，榜上名字开始有江湖味。',
        '消息流开始加速，今天的热闹已经能做成战报。',
      ]
  const subPool = small
    ? ['榜单先轻装上阵，等群友继续加戏。', '不硬凑空榜，只记录真正发生的热闹。', '低频不尴尬，小报刚刚好。']
    : ['不服明天继续冲榜。', '榜单只记热闹，胜负交给消息数量。', '今日水花已收录，明天继续翻盘。']
  const bars = [
    ['活跃度', Math.min(99, Math.max(4, Math.round(total / (small ? 2 : 12))))],
    ['参与度', Math.min(99, Math.max(4, participants * 12))],
    ['图文感', Math.min(99, Math.max(4, images * 18 + emojis * 4))],
    ['情报量', Math.min(99, Math.max(4, links * 12))],
  ]
  return { ...level, small, label: pick(labelPool), summary: pick(summaryPool), sub: pick(subPool), bars }
}

function metricCards(metrics, limit = 6) {
  return metrics.slice(0, limit).map(m => `<div class="metric"><span>${esc(m.label)}</span><b>${esc(m.value)}</b><small>${esc(m.unit)}</small><em>${esc(m.tip)}</em></div>`).join('')
}

function rankRows(rows = [], unit = '次', notes = []) {
  const safe = positiveRows(rows).slice(0, 5)
  if (!safe.length) return ''
  return safe.map((row, i) => `<div class="rank-row ${i === 0 ? 'first' : ''}"><i>${i + 1}</i><span>${esc(shortName(row.name, 9))}</span><b>${esc(row.value || 0)}${unit}</b><em>${esc(notes[i] || '继续冲榜')}</em></div>`).join('')
}

function board(title, icon, rows, unit, notes, cls = '') {
  const body = rankRows(rows, unit, notes)
  if (!body) return ''
  return `<section class="board ${cls}"><h3><em>${icon}</em><span>${esc(title)}</span><small>TOP ${Math.min(5, positiveRows(rows).length)}</small></h3>${body}</section>`
}

function champCards(champs, limit = 4) {
  return champs.filter(c => Number(c.raw || 0) > 0).slice(0, limit).map((c, i) => `<div class="champ"><strong>${String(i + 1).padStart(2, '0')}</strong><small>${esc(c.title)}</small><b>${esc(shortName(c.name, 8))}</b><span>${esc(c.value)}</span><em>${esc(c.note)}</em></div>`).join('')
}

function hotTags(tags = []) {
  return tags.slice(0, 6).map(t => `<span>${esc(t)}</span>`).join('')
}

function moments(items = []) {
  return items.slice(0, 3).map((t, i) => `<div class="moment"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(t)}</span></div>`).join('')
}

function bars(items = []) {
  return items.slice(0, 4).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i><u style="width:${Math.max(6, Math.min(100, Number(v || 0)))}%"></u></i><b>${esc(v)}</b></div>`).join('')
}

function buildData(stats = {}) {
  const totals = stats.totals || {}
  const boards = stats.leaderboards || {}
  const msg = first(boards.messages)
  const img = first(boards.images)
  const link = first(boards.links)
  const emoji = first(boards.emojis)
  const brag = first(boards.brag)
  const from = formatDateTime(stats.from)
  const to = formatDateTime(stats.to)
  const mood = makeMood(totals)
  const hot = extractHotWords(stats, mood.small
    ? ['轻微冒泡', '小群快报', '表情接力', '情报搬运', '今日小浪花', '群友上线']
    : ['键盘冒烟', '图片补刀', '链接搬运', '表情接力', '群聊升温', '榜单开张'])
  const meaningful = [
    Number(msg.value || 0) > 0 ? `${shortName(msg.name, 6)}：发言 ${msg.value} 条，成为本时段嘴替。` : '',
    Number(img.value || 0) > 0 ? `${shortName(img.name, 6)}：发图 ${img.value} 张，素材库开了一下。` : '',
    Number(link.value || 0) > 0 ? `${shortName(link.name, 6)}：搬来 ${link.value} 条链接，情报味有了。` : '',
    Number(emoji.value || 0) > 0 ? `${shortName(emoji.name, 6)}：甩出 ${emoji.value} 个表情，沉默也能上分。` : '',
    Number(brag.value || 0) > 0 ? `${shortName(brag.name, 6)}：高光 ${brag.value} 次，气场短暂上线。` : '',
  ].filter(Boolean)
  if (!meaningful.length) meaningful.push('本时段暂时安静，等下一波群友开麦。')
  const metrics = [
    { label: '消息', value: totals.message_count || 0, unit: '条', tip: mood.label },
    { label: '参与', value: totals.participant_count || 0, unit: '人', tip: '冒泡人数' },
    { label: '图片', value: totals.image_count || 0, unit: '张', tip: Number(totals.image_count || 0) ? '图力输出' : '暂未刷屏' },
    { label: '表情', value: totals.emoji_count || 0, unit: '个', tip: Number(totals.emoji_count || 0) ? '表情接力' : '表情蓄力' },
    { label: '链接', value: totals.link_count || 0, unit: '条', tip: Number(totals.link_count || 0) ? '情报搬运' : '暂无情报' },
    { label: '高光', value: totals.brag_count || 0, unit: '次', tip: Number(totals.brag_count || 0) ? '气场上线' : '低调路过' },
  ]
  return {
    group: stats.group_name || stats.group_id || '本群',
    date: (from || to || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    range: formatRange(stats.from, stats.to),
    metrics,
    boards,
    mood,
    hot,
    moments: meaningful,
    bars: mood.bars,
    champs: [
      { title: '话痨王', name: msg.name || '暂无', value: `${msg.value || 0} 条发言`, raw: msg.value || 0, note: mood.small ? '轻量输出' : '稳定输出' },
      { title: '图王', name: img.name || '暂无', value: `${img.value || 0} 张图片`, raw: img.value || 0, note: '素材开闸' },
      { title: '链接王', name: link.name || '暂无', value: `${link.value || 0} 条链接`, raw: link.value || 0, note: '情报中枢' },
      { title: '表情王', name: emoji.name || '暂无', value: `${emoji.value || 0} 个表情`, raw: emoji.value || 0, note: '无声控场' },
    ],
  }
}

const commonCss = `
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}.poster{position:relative;width:1080px;height:1350px;overflow:hidden}.safe{position:relative;z-index:2}.metric,.champ,.board,.panel,.note,.fillcard,.story,.quick-card{min-width:0;overflow:hidden}.metric span,.metric small,.metric em{display:block;line-height:1.12}.metric b{display:block;line-height:.95}.champ em,.rank-row em{font-style:normal}.tags{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.rank-row{display:grid;grid-template-columns:25px minmax(48px,.9fr) 62px minmax(0,1fr);align-items:center;gap:7px;line-height:1.12}.rank-row i{font-style:normal;font-weight:950;text-align:center}.rank-row span,.rank-row b,.rank-row em{font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.board h3{margin:0 0 8px;display:flex;align-items:center;gap:7px;line-height:1.1}.board h3 em{font-style:normal}.board h3 small{margin-left:auto}.moment{display:grid;grid-template-columns:31px minmax(0,1fr);align-items:center}.moment span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar{display:grid;grid-template-columns:58px 1fr 30px;align-items:center;gap:9px}.bar span,.bar b{font-weight:950;white-space:nowrap}.bar i{height:10px;border-radius:99px;overflow:hidden}.bar u{display:block;height:100%;border-radius:99px}.footer{position:absolute;z-index:2;left:54px;right:54px;bottom:30px;display:flex;justify-content:space-between;align-items:center}.grain:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.1;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='80' height='80' filter='url(%23n)' opacity='.28'/%3E%3C/svg%3E")}.filldeck{display:grid;grid-template-columns:1.2fr .9fr .9fr;gap:12px}.fillcard{border-radius:20px;padding:12px 16px;text-align:center}.fillcard h3{margin:0 0 7px;font-size:18px;line-height:1.15}.fillcard p{margin:0;font-size:12.5px;font-weight:850;line-height:1.34}.fillcard ul{margin:0;padding:0;list-style:none;display:grid;gap:3px}.fillcard li{font-size:12.5px;font-weight:900;line-height:1.25}@media (max-width:1079px){body{transform:scale(calc(100vw / 1080));transform-origin:top left}}
`

function commonBlocks(d) {
  const b = d.boards || {}
  const boards = [
    board('发言榜','💬',b.messages,'条',['稳定输出','句句在线','冒泡成功','留下痕迹','继续冲榜'],'msg'),
    board('发图榜','🖼️',b.images,'张',['图片洪峰','素材在线','随手一张','图力上分','继续发光'],'img'),
    board('表情榜','😁',b.emojis,'个',['表情开大','用图说话','无声控场','萌系火力','情绪到位'],'emoji'),
    board('链接榜','🔗',b.links,'条',['情报中枢','链接搬运','资料上桌','瓜已送达','继续投喂'],'link'),
    board('高光榜','😎',b.brag,'次',['气场在线','关键三分','轻轻一秀','低频高光','继续发光'],'brag'),
  ].filter(Boolean)
  return {
    metrics: metricCards(d.metrics, d.mood.small ? 4 : 6),
    allMetrics: metricCards(d.metrics, 6),
    champs: champCards(d.champs, d.mood.small ? 3 : 4),
    boards,
    boardHtml: boards.slice(0, d.mood.small ? 3 : 4).join('') || `<section class="note empty-note"><h3>📭 榜单候场</h3><p>本时段数据还少，等群友继续开麦后自动展开榜单。</p></section>`,
    tags: hotTags(d.hot),
    moments: moments(d.moments),
    bars: bars(d.bars),
  }
}

function fillDeck(d, theme = '') {
  const tips = d.mood.small
    ? ['先冒个泡就能上榜', '发图发链接都会记录', '空榜不硬凑，等你来填']
    : ['潜水员先冒泡', '表情包别省着', '链接记得带瓜']
  return `<div class="safe filldeck ${theme}"><div class="fillcard big"><h3>🧠 群聊复盘</h3><p>${esc(d.mood.line)}关键词：${esc(d.hot.slice(0, 3).join('、'))}。</p></div><div class="fillcard"><h3>🎯 下回攻略</h3><ul>${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div><div class="fillcard"><h3>⚠️ 温馨提示</h3><p>${esc(d.mood.sub)}</p></div></div>`
}

const css = {
  'guochao-red-gold': `.poster{padding:32px 44px;color:#ffe9b0;background:radial-gradient(circle at 18% 8%,rgba(255,216,101,.25),transparent 22%),radial-gradient(circle at 88% 32%,rgba(255,127,62,.18),transparent 20%),linear-gradient(145deg,#4d0508,#b80f17 48%,#330407)}.poster:before{content:"";position:absolute;inset:22px;border:3px solid rgba(255,213,100,.42);border-radius:34px}.poster:after{content:"";position:absolute;inset:0;opacity:.16;background-image:linear-gradient(90deg,rgba(255,219,120,.55) 1px,transparent 1px),linear-gradient(rgba(255,219,120,.5) 1px,transparent 1px);background-size:74px 74px}.head{display:grid;grid-template-columns:142px 1fr 142px;align-items:center;gap:14px;text-align:center}.badge{height:118px;border:3px solid #ffd66f;border-radius:50%;display:grid;place-items:center;color:#ffd66f;font-size:25px;font-weight:1000;background:rgba(50,0,0,.42)}.plaque{display:inline-block;background:linear-gradient(#3b0602,#150201);border:4px solid #ffd66f;border-radius:22px;padding:12px 40px;box-shadow:0 12px 0 rgba(32,0,0,.35)}.k{font-size:20px;font-weight:1000;letter-spacing:.22em}.title{font-family:"Songti SC","STSong",serif;font-size:68px;line-height:1;font-weight:950;color:#fff4c8}.sub{font-size:20px;font-weight:950;color:#ffe0a1;margin-top:7px}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:18px}.metric{height:106px;border-radius:18px;background:rgba(48,8,5,.84);border:1px solid rgba(255,214,111,.38);text-align:center;padding:10px 8px}.metric span{font-size:15px;font-weight:900}.metric b{font-size:32px}.metric small{font-size:12px;color:#efbd65}.metric em{font-size:11px;margin-top:5px}.quick{display:grid;grid-template-columns:1.05fr .95fr;gap:14px;margin-top:22px;align-items:start}.quick-card{border-radius:26px;background:linear-gradient(180deg,rgba(255,214,111,.22),rgba(46,7,5,.9));border:2px solid rgba(255,214,111,.34);padding:24px;min-height:228px}.quick-card h2{margin:0 0 14px;font-family:"Songti SC",serif;font-size:42px}.quick-card p{font-size:24px;line-height:1.55;font-weight:950;margin:0}.quick-list{display:grid;gap:12px}.champ{min-height:112px;border-radius:22px;background:linear-gradient(180deg,rgba(255,214,111,.24),rgba(46,7,5,.9));border:2px solid rgba(255,214,111,.34);padding:13px;text-align:center}.champ b{display:block;font-family:"Songti SC",serif;font-size:31px;color:#fff}.champ small{font-size:16px;color:#ffd66f;font-weight:950}.champ span,.champ em{display:block;font-size:12px;font-weight:900}.layout{display:grid;grid-template-columns:1.05fr .8fr;gap:12px;margin-top:14px}.boards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.board{height:194px;border-radius:20px;background:rgba(42,7,5,.86);border:2px solid rgba(255,214,111,.3);padding:13px}.board h3{font-family:"Songti SC",serif;font-size:22px;color:#ffd66f}.rank-row{height:30px;border-top:1px solid rgba(255,214,111,.14);font-size:12.2px}.side{display:grid;grid-template-rows:126px 160px 124px;gap:10px}.panel,.note{border-radius:20px;background:rgba(255,214,111,.15);border:2px solid rgba(255,214,111,.28);padding:10px 12px}.panel p,.note p{margin:0;font-size:15px;line-height:1.55;font-weight:850}.panel h3,.note h3{text-align:center;margin:0 0 8px;font-size:21px}.tags span{background:#ffd66f;color:#4c0905;border-radius:999px;padding:6px 10px;font-size:13px;font-weight:950}.moment{height:22px;font-size:11.5px;border-top:1px solid rgba(255,214,111,.13)}.bar{height:23px;font-size:12px}.bar i{background:rgba(255,255,255,.15)}.bar u{background:#ffd66f}.summary{margin-top:12px;height:82px;border-radius:24px;background:#ffd66f;color:#3a0804;display:grid;place-items:center;text-align:center;font-size:23px;font-weight:1000;padding:12px 22px}.summary small{display:block;font-size:13px;margin-top:4px}.filldeck{height:126px;margin-top:10px}.fillcard{background:rgba(42,7,5,.86);border:2px solid rgba(255,214,111,.28);color:#ffe9b0}.footer{font-size:14px;color:#ffd66f}`,
  'editorial-newspaper': `.poster{padding:38px 52px;color:#151515;background:#f4ecd8}.mast{border-top:6px solid #151515;border-bottom:6px solid #151515;padding:12px 0;text-align:center}.paper{font-family:Georgia,serif;font-size:26px;letter-spacing:.24em;font-weight:900}.title{font-family:Georgia,"Songti SC",serif;font-size:76px;line-height:.92;font-weight:950;letter-spacing:-.04em}.title b{color:#a96c12}.sub{margin-top:8px;font-size:18px;font-weight:900}.front{display:grid;grid-template-columns:1.18fr .82fr;gap:16px;margin-top:16px}.story{border:3px solid #151515;background:#fffaf0;padding:18px;height:240px}.story h2{margin:0;font-family:Georgia,serif;font-size:30px}.story b{display:block;font-size:62px;line-height:1;color:#a96c12}.story p{font-size:18px;line-height:1.35;font-weight:850}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.metric{height:80px;border:2px solid #151515;background:#fffaf0;text-align:center;padding:7px}.metric span{font-size:12px;font-weight:900;color:#666}.metric b{font-size:26px}.metric small{font-size:11px}.metric em{font-size:10px;color:#87570e}.columns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.board{height:185px;border:2px solid #151515;background:#fffaf0;padding:12px}.board h3{font-size:22px}.rank-row{height:30px;border-top:1px solid #d2c4ad;font-size:12px}.champgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.champ{height:104px;border:2px solid #151515;background:#fffaf0;padding:9px;text-align:center}.champ strong{display:none}.champ small{font-size:13px;color:#a96c12;font-weight:950}.champ b{display:block;font-size:25px}.champ span,.champ em{font-size:11px;font-weight:900;display:block}.digest{margin-top:12px;height:145px;border:3px solid #151515;background:#151515;color:#fffaf0;padding:16px;text-align:center}.digest h3{font-size:25px;margin:0 0 8px;color:#e3b45c}.tags span{border:1px solid #151515;background:#fffaf0;color:#151515;padding:5px 8px;font-size:12px;font-weight:900}.summary{margin-top:14px;height:88px;border-top:4px solid #151515;border-bottom:4px solid #151515;display:grid;place-items:center;text-align:center;font-family:Georgia,serif;font-size:24px;font-weight:900}.summary small{display:block;font-size:13px;color:#666;margin-top:5px}.footer{font-size:13px}`,
  'ancient-scroll': `.poster{padding:34px 50px;color:#45240e;background:radial-gradient(circle at 50% 9%,rgba(255,255,255,.55),transparent 24%),linear-gradient(90deg,#c69a56 0 5%,#fae9bc 13% 87%,#bf904c 95% 100%)}.poster:before{content:"";position:absolute;inset:28px;border:7px double rgba(96,50,17,.34);border-radius:36px}.scroll{display:grid;grid-template-columns:118px 1fr;gap:20px}.vertical{height:1210px;border-right:2px solid rgba(92,49,18,.2);writing-mode:vertical-rl;text-align:center;font-family:"Kaiti SC","Songti SC",serif;font-size:44px;line-height:1.1;font-weight:950;letter-spacing:.08em;color:#6a2b12;padding-top:22px}.vertical b{color:#a51f15}.head{display:grid;grid-template-columns:1fr 110px;align-items:center;gap:14px;text-align:center}.k{font-family:"Songti SC",serif;font-size:21px;letter-spacing:.18em;color:#8a4b19;font-weight:900}.title{font-family:"Songti SC",serif;font-size:62px;font-weight:950}.sub{font-size:18px;font-weight:850;color:#7b5a35}.seal{width:104px;height:104px;border:5px solid #a51f15;color:#a51f15;border-radius:50%;display:grid;place-items:center;font-family:"Kaiti SC",serif;font-size:27px;font-weight:950;transform:rotate(-10deg)}.ribbon{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:16px}.metric{height:88px;border-radius:999px;background:rgba(255,248,220,.78);border:2px solid rgba(111,69,27,.22);text-align:center;padding:9px}.metric span{font-size:13px;font-weight:900}.metric b{font-size:28px;font-family:Georgia,serif}.metric small{font-size:11px}.metric em{display:none}.main{display:grid;grid-template-columns:.72fr 1.28fr;gap:12px;margin-top:14px}.edict{min-height:322px;border-radius:24px;background:linear-gradient(#fff5cf,#ecca8a);border:2px solid rgba(104,61,20,.28);padding:16px;text-align:center}.champ{min-height:78px;border-bottom:1px dashed rgba(92,49,18,.25);padding:6px 8px}.champ strong{float:left;color:#a51f15}.champ small{display:block;font-size:15px;font-weight:950;color:#a51f15}.champ b{display:block;font-size:25px;font-family:"Songti SC",serif}.champ span,.champ em{display:block;font-size:11.5px;font-weight:900}.boards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.board{height:174px;border-radius:22px;background:rgba(255,248,220,.83);border:2px solid rgba(111,69,27,.23);padding:12px}.board h3{font-family:"Kaiti SC",serif;font-size:22px;color:#5c2b0e}.rank-row{height:29px;border-top:1px dashed rgba(99,57,18,.28);font-size:12px}.lower{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px}.note{height:134px;border-radius:22px;background:rgba(255,248,220,.82);border:2px solid rgba(111,69,27,.23);padding:12px}.note h3{margin:0 0 8px;text-align:center;color:#a51f15;font-family:"Kaiti SC",serif;font-size:21px}.tags span{background:#6a2f12;color:#ffe8b0;border-radius:999px;padding:5px 8px;font-size:12px;font-weight:900}.moment{height:21px;font-size:11px;border-top:1px dashed rgba(99,57,18,.2)}.bar{height:22px;font-size:11.5px}.bar i{background:#ead3a0}.bar u{background:#6a2f12}.summary{margin-top:12px;height:86px;border-radius:26px;background:#5c2b0e;color:#ffe8b0;display:grid;place-items:center;text-align:center;font-family:"Kaiti SC",serif;font-size:24px;font-weight:950}.summary small{display:block;font-size:13px;margin-top:4px}.filldeck{height:118px;margin-top:10px}.fillcard{background:rgba(255,248,220,.82);border:2px solid rgba(111,69,27,.22)}.footer{font-family:"Songti SC",serif;font-size:14px}`,
  'ink-wash': `.poster{padding:38px 48px;color:#14231e;background:#edf3ea}.mountain{position:absolute;inset:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1080' height='1350' viewBox='0 0 1080 1350'%3E%3Crect fill='%23edf3ea' width='1080' height='1350'/%3E%3Cg opacity='.18' fill='%2327352f'%3E%3Cpath d='M-40 360 C120 260 230 340 350 210 C500 40 650 310 760 180 C900 20 1000 250 1130 120 L1130 590 L-40 590z'/%3E%3Cpath opacity='.5' d='M-20 720 C150 560 290 680 430 500 C570 330 760 620 890 450 C1010 310 1080 510 1130 410 L1130 1010 L-20 1010z'/%3E%3C/g%3E%3C/svg%3E") center/cover no-repeat}.poster:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.86) 76%)}.head{display:grid;grid-template-columns:1fr 108px;gap:16px;align-items:center}.kicker{font-family:"Kaiti SC",serif;font-size:23px;letter-spacing:.16em;color:#4d675e;font-weight:900}.title{font-family:"Kaiti SC",serif;font-size:68px;line-height:1;font-weight:950}.title b{color:#1f5b47}.sub{font-size:18px;color:#5a7169;font-weight:850}.seal{width:102px;height:102px;border-radius:50%;border:4px solid #b42222;color:#b42222;display:grid;place-items:center;font-family:"Kaiti SC",serif;font-size:27px;font-weight:950;transform:rotate(8deg);background:rgba(255,255,255,.36)}.flow{display:grid;grid-template-columns:.34fr .66fr;gap:14px;margin-top:16px}.left{display:grid;gap:9px}.metric{height:66px;background:rgba(255,255,255,.72);border:1px solid rgba(24,36,31,.16);border-radius:28px 10px 28px 10px;padding:7px 12px;text-align:center}.metric span{font-size:12px;color:#506b61;font-weight:900}.metric b{font-size:27px;font-family:Georgia,serif}.metric small{font-size:10px}.metric em{display:none}.right{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:126px;align-content:start;gap:10px}.champ{height:126px;background:rgba(255,255,255,.74);border:1px solid rgba(24,36,31,.16);border-radius:14px 30px 14px 30px;padding:8px 10px;text-align:center;display:flex;flex-direction:column;justify-content:center}.champ strong{color:#b42222}.champ small{display:block;font-family:"Kaiti SC",serif;font-size:16px;color:#1f5b47;font-weight:950}.champ b{display:block;font-size:25px;font-family:"Songti SC",serif}.champ span,.champ em{display:block;font-size:10.5px;font-weight:900}.boards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.board{height:160px;background:rgba(255,255,255,.78);border:1px solid rgba(24,36,31,.16);border-radius:30px 10px 30px 10px;padding:12px}.board h3{font-family:"Kaiti SC",serif;font-size:22px;color:#1e4e3e}.rank-row{height:28px;border-top:1px solid rgba(24,36,31,.1);font-size:11.6px}.notes{display:grid;grid-template-columns:.9fr 1.1fr .9fr;gap:12px;margin-top:12px}.note{height:120px;background:rgba(255,255,255,.76);border:1px solid rgba(24,36,31,.16);border-radius:30px 10px 30px 10px;padding:12px}.note h3{margin:0 0 8px;text-align:center;font-family:"Kaiti SC",serif;font-size:21px;color:#1e4e3e}.tags span{background:#1e4e3e;color:#edf5ec;border-radius:999px;padding:5px 8px;font-size:12px;font-weight:900}.moment{height:20px;font-size:11px;border-top:1px solid rgba(24,36,31,.1)}.bar{height:21px;font-size:11.5px}.bar i{background:#d7e2dc}.bar u{background:#1e4e3e}.summary{margin-top:11px;height:76px;border-radius:32px 10px 32px 10px;background:rgba(21,38,32,.92);color:#edf5ec;display:grid;place-items:center;text-align:center;font-family:"Kaiti SC",serif;font-size:23px;font-weight:950}.summary small{display:block;font-size:12px;color:#c9d6cf;margin-top:4px}.filldeck{height:98px;margin-top:9px}.fillcard{background:rgba(255,255,255,.76);border:1px solid rgba(24,36,31,.16);border-radius:26px 10px 26px 10px}.footer{font-size:14px;color:#587169}`,
}

function quickBody(template, d, c) {
  if (template === 'editorial-newspaper') {
    return `<div class="poster"><div class="safe mast"><div class="paper">BAILONGMA GROUP TIMES</div><div class="title">群聊<b>快报</b></div><div class="sub">${esc(d.group)} · ${esc(d.date)} · ${esc(d.range)} · LIGHT EDITION</div></div><div class="safe front"><div class="story"><h2>HEADLINE · ${esc(d.mood.label)}</h2><b>${esc(shortName(first(d.boards.messages).name, 9))}</b><p>${esc(d.mood.summary)}</p></div><div class="metrics">${c.allMetrics}</div></div><div class="safe columns">${c.boardHtml}</div><div class="digest"><h3>本时段梗点</h3><div class="tags">${c.tags}</div></div><div class="safe summary">${esc(d.mood.summary)}<small>${esc(d.mood.sub)}</small></div><div class="footer"><span>Light Broadsheet</span><b>BaiLongma</b></div></div>`
  }
  if (template === 'ancient-scroll') {
    return `<div class="poster grain"><div class="safe scroll"><div class="vertical"><b>小报</b><br>今日群聊</div><div><div class="head"><div><div class="k">白龙马自动誊录 · 不硬凑榜</div><div class="title">${esc(d.group)}快报</div><div class="sub">${esc(d.date)} · ${esc(d.range)} · ${esc(d.mood.label)}</div></div><div class="seal">小报</div></div><div class="ribbon">${c.allMetrics}</div><div class="main"><div class="edict">${c.champs || `<div class="quick-card"><h2>${esc(d.mood.label)}</h2><p>${esc(d.mood.summary)}</p></div>`}</div><div class="boards">${c.boardHtml}</div></div><div class="lower"><div class="note"><h3>热梗签</h3><div class="tags">${c.tags}</div></div><div class="note"><h3>群贤小记</h3>${c.moments}</div><div class="note"><h3>水群脉象</h3>${c.bars}</div></div><div class="summary">${esc(d.mood.summary)}<small>${esc(d.mood.sub)}</small></div>${fillDeck(d, 'scroll-fill')}<div class="footer"><span>卷轴古风 · 小报版</span><b>BaiLongma</b></div></div></div></div>`
  }
  if (template === 'ink-wash') {
    return `<div class="poster grain"><div class="mountain"></div><div class="safe head"><div><div class="kicker">水墨小报 · 留痕不硬凑</div><div class="title">今日群聊<b>快报</b></div><div class="sub">${esc(d.group)} · ${esc(d.date)} · ${esc(d.range)} · ${esc(d.mood.label)}</div></div><div class="seal">小报</div></div><div class="safe flow"><div class="left">${c.metrics}</div><div class="right">${c.champs || `<div class="quick-card"><h2>${esc(d.mood.label)}</h2><p>${esc(d.mood.summary)}</p></div>`}</div></div><div class="safe boards">${c.boardHtml}</div><div class="safe notes"><div class="note"><h3>本时段梗</h3><div class="tags">${c.tags}</div></div><div class="note"><h3>雅集札记</h3>${c.moments}</div><div class="note"><h3>水群指数</h3>${c.bars}</div></div><div class="safe summary">${esc(d.mood.summary)}<small>${esc(d.mood.sub)}</small></div>${fillDeck(d, 'ink-fill')}<div class="footer"><span>水墨风 · 小报版</span><b>BaiLongma</b></div></div>`
  }
  return `<div class="poster grain"><div class="safe head"><div class="badge">小报</div><div><div class="plaque"><div class="k">国潮群聊快报</div><div class="title">本时段小榜</div></div><div class="sub">${esc(d.group)} · ${esc(d.date)} · ${esc(d.range)} · ${esc(d.mood.label)}</div></div><div class="badge">留痕</div></div><div class="safe metrics">${c.allMetrics}</div><div class="safe quick"><div class="quick-card"><h2>${esc(d.mood.label)}</h2><p>${esc(d.mood.summary)}</p></div><div class="quick-list">${c.champs || `<section class="note"><h3>榜单候场</h3><p>${esc(d.mood.line)}</p></section>`}<section class="note"><h3>🔥 本时段梗点</h3><div class="tags">${c.tags}</div></section></div></div><div class="safe layout"><div class="boards">${c.boardHtml}</div><div class="side"><div class="panel"><h3>📜 小传</h3>${c.moments}</div><div class="panel"><h3>📊 指数</h3>${c.bars}</div><div class="panel"><h3>📝 备注</h3><p>${esc(d.mood.sub)}</p></div></div></div><div class="safe summary">${esc(d.mood.summary)}<small>${esc(d.mood.sub)}</small></div><div class="footer"><span>国潮红金 · 小报版</span><b>BaiLongma</b></div></div>`
}

function fullBody(template, d, c) {
  if (template === 'editorial-newspaper') {
    const top = first(d.boards.messages)
    return `<div class="poster"><div class="safe mast"><div class="paper">BAILONGMA GROUP TIMES</div><div class="title">群聊<b>头版</b></div><div class="sub">${esc(d.group)} · ${esc(d.date)} · ${esc(d.range)} · EXTRA EDITION</div></div><div class="safe front"><div class="story"><h2>HEADLINE · 今日话痨王</h2><b>${esc(shortName(top.name, 9))}</b><p>${esc(top.value || 0)} 条发言。${esc(d.mood.summary)}</p></div><div class="metrics">${c.allMetrics}</div></div><div class="safe columns">${c.boardHtml}</div><div class="champgrid">${c.champs}</div><div class="digest"><h3>今日热梗</h3><div class="tags">${c.tags}</div></div><div class="safe summary">${esc(d.mood.summary)}<small>${esc(d.mood.sub)}</small></div><div class="footer"><span>Editorial Broadsheet</span><b>BaiLongma</b></div></div>`
  }
  if (template === 'ancient-scroll') {
    return quickBody(template, d, c).replace('<b>小报</b><br>今日群聊', '<b>金榜</b><br>今日群聊').replace('白龙马自动誊录 · 不硬凑榜', '白龙马自动誊录 · 字字有梗').replace('<div class="seal">小报</div>', '<div class="seal">群榜</div>').replace(`${esc(d.group)}快报`, `${esc(d.group)}战报`).replace('小报版', '榜文版')
  }
  if (template === 'ink-wash') {
    return quickBody(template, d, c).replace('水墨小报 · 留痕不硬凑', '水墨群山 · 聊天留痕').replace('<div class="seal">小报</div>', '<div class="seal">水墨</div>').replace('今日群聊<b>快报</b>', '今日群聊<b>雅集榜</b>').replace('小报版', '雅集版')
  }
  return `<div class="poster grain"><div class="safe head"><div class="badge">群榜</div><div><div class="plaque"><div class="k">国潮群聊战报</div><div class="title">今日封神榜</div></div><div class="sub">${esc(d.group)} · ${esc(d.date)} · ${esc(d.range)} · ${esc(d.mood.label)}</div></div><div class="badge">封神</div></div><div class="safe metrics">${c.allMetrics}</div><div class="safe quick"><div class="quick-card"><h2>${esc(d.mood.label)}</h2><p>${esc(d.mood.summary)}</p></div><div class="quick-list">${c.champs}<section class="note"><h3>🔥 今日热梗弹幕</h3><div class="tags">${c.tags}</div></section></div></div><div class="safe layout"><div class="boards">${c.boardHtml}</div><div class="side"><div class="panel"><h3>📜 封神小传</h3>${c.moments}</div><div class="panel"><h3>📊 群聊体征</h3>${c.bars}</div><div class="panel"><h3>📝 今日备注</h3><p>${esc(d.mood.sub)}</p></div></div></div><div class="safe summary">${esc(d.mood.summary)}<small>${esc(d.mood.sub)}</small></div><div class="footer"><span>国潮红金 · 封神版</span><b>BaiLongma</b></div></div>`
}

function renderBody(template, d) {
  const c = commonBlocks(d)
  return d.mood.small ? quickBody(template, d, c) : fullBody(template, d, c)
}

export function renderWeChatGroupStatsPosterHtml(stats = {}, { templateId = 'guochao-red-gold' } = {}) {
  const template = normalizeWeChatGroupReportTemplate(templateId)
  const d = buildData(stats)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,initial-scale=1"><title>${esc(d.group)} 群聊战报</title><style>${commonCss}\n${css[template]}</style></head><body>${renderBody(template, d)}</body></html>`
}
