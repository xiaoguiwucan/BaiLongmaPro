# 更新日志

所有重要版本都需要在这里写清楚：版本号、日期、改动内容、部署/备份注意事项。以后每次升级版本，必须同步更新 `package.json`、`package-lock.json`、`README.md`、`BACKUP-YYYY-MM-DD.md` 和 Brain UI 设置页里的更新说明。

## 未发布 - 2026-06-05

### 新增
- 项目 Agent 规范更新：`AGENTS.md` 不再维护变更历史，所有代码、配置和项目规范变更历史统一写入 `CHANGELOG.md`；同时明确新增功能必须同步更新 `README.md`，Git 提交信息必须使用中文。
- README 同步补充当前未发布能力、微信群助手最新能力、常用验证命令和开发约定，降低文档与当前代码能力脱节的风险。
- GitHub Release 发布目标改为 `yideng966/BaiLongmaPro`，并新增 GitHub Actions tag 触发自动构建发布流程：推送 `v*` 标签后在 Windows/macOS runner 上分别执行发布命令并上传 Release 资产。
- GitHub Actions macOS 发布流程改为安装阶段跳过 postinstall，构建阶段只显式重建 `better-sqlite3`，避免 `electron-builder install-app-deps` 扫描并重建间接依赖 `leveldown` 时触发 Python `distutils` 缺失问题；同时固定 Python 3.11 并安装 `setuptools` 作为 node-gyp 兜底环境。
- Release workflow 新增手动触发入口，可选择只构建 Windows、macOS 或全部平台，便于在某个平台失败后补发缺失资产。
- Brain UI 设置页将“Skill 技能”更名为“多模态能力”，把图像生成、图片理解和视频理解压缩到同一页核心配置区，并前置“测试当前模型”入口；高级渠道池改为折叠显示，减少配置页滚动成本。
- 多模态能力、模型池和连通监控的模型连通测试结果改为持续显示，不再 3 秒后自动清空，便于查看成功耗时或失败原因。
- 图片理解模型候选增加 `agnes-2.0-flash` / `agnes-1.5-flash`，并过滤 `seedream`、`agnes-image-*`、`agnes-video-*` 等生成类模型，避免模型存在但实际识图走 `/chat/completions` 时返回 NotFound。
- 微信群助手新增“允许非 @ 主动回复”配置，默认关闭；开启后仅对已勾选回复群生效，并通过群级冷却间隔控制频率。@ 当前登录微信号的消息仍然必回且不受冷却限制。
- 微信群助手新增“屏蔽成员”配置：按 Wechaty sender_id 精确屏蔽指定群成员，被屏蔽成员消息仍入库统计，但无论 @ 助手还是开启非 @ 主动回复都不会进入回复链路。
- Brain UI 的“微信群助手”设置页新增左侧二级菜单，按连接与回复群、回复能力、记忆战报、舆情推送、知识库连接和安全边界拆分入口，减少长页面滚动查找成本。

### 修复
- 修复微信群通过引用图片进行识图时可能识别到非引用图片的问题：引用 XML 中存在 `svrid/msgid/newmsgid` 时只接受消息 ID 强匹配，匹配不到时不再退回最近图片，并提示用户重发原图。
- 修复舆情推送关闭后后台调度器仍可能保留轮询定时器的问题：保存关闭配置时立即停止 scheduler，且任何直接启动调度器的路径都会在 `enabled=false` 时先清理已有 interval，避免继续占用资源。
- 修复微信群斗图/表情包偶发裸发图片链接的问题：搜狗神配图 `tugelepic.mse.sogou.com` 这类无 `.jpg/.gif/.webp` 扩展名的图片 API 现在会被识别为公开图片，通过 Wechaty `FileBox.fromUrl` 发送，不再作为普通文本发到群里。
- 统一斗图搜索、公开图片搜索和微信群出站发送的图片 URL 判定逻辑：新增共享公开图片 URL 识别模块，支持标准图片扩展、明确图片参数和斗图白名单域名，同时拒绝 localhost、内网、本机地址，避免安全边界被不同模块的重复正则打穿。
- 直接斗图回复会把候选图片 URL 显式传入发送层作为 `imageUrls` 兜底，即使模型或搜索接口返回的 URL 没有扩展名，也会走图片通道；如果图片发送失败，也不会退回裸链接刷屏。
- 参考 `wechat-chat-summary-image` 重做群聊总结图片：改为 720px 手机长图、白底、单列结构，内容包含统计时间范围、总量、一句话结论、主要话题、关键时间线、活跃成员、发言排行和数据限制说明；数据源仍使用本框架 `getWeChatGroupStats()`，不接入 `wechat-cli`。
- 群聊总结长图的主要话题现在会显示关键词出现次数，并附上来自本框架 `important/recent` 消息的证据摘录，让总结内容更贴近参考 skill 的“主题 + 依据”结构。
- 群聊总结长图补充明确的「一句话总结」标签，确保图片结构和参考 skill 的最小内容项一致。
- 优化群聊总结长图的话题提取逻辑，中文消息改为统计 2-6 字短语候选，提升重复中文主题的聚合效果。
- 群聊总结长图主要话题增加包含关系去重，避免相邻中文短语重复刷屏。
- 群内 @ 助手触发“总结群聊/汇总聊天记录”等自然语言请求时，直接走群聊总结长图渲染和图片发送链路；只有图片生成或发送失败时才回退文本。
- 群聊总结长图改为 2x 高清 PNG 输出，并新增「干货总结」描述段，基于统计库里的重点/最近消息、话题和活跃成员生成可读摘要，减少只有数据数字的问题。
- 新增舆情变动微信群推送能力：基于现有热点源监测新上榜、排名上升和关键词命中事件，按配置向 Wechaty 微信群发送聚合通知；默认关闭，并提供设置/手动检测 API。
- Brain UI 微信群助手设置页新增独立“舆情推送”配置卡片，可选择接收群、监测平台、关键词、检测间隔和触发规则，并支持手动检查或立即推送。
- 舆情推送改为优先发送 2x PNG 图片海报，展示事件数、规则、平台分布、关键词、排名变化和重点事件；图片渲染或发送失败时再回退文字。
- 修复群聊总结期望发图片但实际回退成文字的问题：海报渲染器现在会校验 Playwright 默认 Chromium 路径是否真实存在，并在 Windows/macOS/Linux 下扫描系统 Chrome/Edge 与 Playwright 缓存路径，避免 Windows 上默认浏览器路径失效导致 PNG 生成失败。
- 修复 `npm run smoke:brain-ui` 在本机缺少当前 Playwright Chromium 可执行文件时无法启动的问题：烟测脚本现在会扫描系统 Chrome/Edge 与已有 Playwright 缓存中的 Chromium/Headless Shell 作为兜底。
- 修复微信群内回复 @ 人偶发不准确的问题：@ 显示名选择改为优先使用当前群昵称、实时解析到的 `roomAlias` 和成员表 `room_alias`，再退到传入昵称、联系人备注或联系人名，避免旧昵称/备注抢占当前群昵称。

### 验证
- 通过 `node --check src/social/wechat-image-vision.js`、`node --check src/social/wechaty-duty-group.js`、`node --check scripts/test-wechat-multi-mention-quote-image.mjs` 和 `npm run test:wechat-multi-mention-quote-image`。
- 通过 `node --check src/hotspot-alert-monitor.js`、`node --check src/api.js`、`node --check scripts/test-hotspot-alert-toggle.mjs` 和 `npm run test:hotspot-alert-toggle`。
- 通过 `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` 验证 `package.json` JSON 语法。
- 通过 PowerShell YAML 关键字段检查，确认 `.github/workflows/release.yml` 包含 tag 触发、`contents: write` 权限、Windows/macOS 构建矩阵和 `GH_TOKEN` 发布环境变量。
- 通过群聊战报渲染复现脚本，确认可输出 PNG 图片。
- 通过 `node scripts/test-wechat-mention-display-name.mjs`。
- 通过 `node scripts/run-electron-node.mjs scripts/test-wechat-multi-mention-quote-image.mjs`。
- 通过 `node scripts/run-electron-node.mjs scripts/test-wechat-admin-priority.mjs`，断言通过；Windows 下临时 SQLite 文件清理仍可能打印既有 `EBUSY` 提示。
- 通过 `node scripts/test-social-targets.mjs`。
- 通过 `node scripts/run-electron-node.mjs scripts/test-wechat-video-analysis.mjs`。
- 分别通过 `node --check src/config.js`、`node --check src/hotspot-alert-monitor.js`、`node --check src/social/index.js`、`node --check src/api.js`，并通过舆情监测器 ES 模块导入验证。
- 通过 `node --check scripts/smoke-brain-ui.mjs`、`npm run smoke:brain-ui` 和 `git diff --check`，确认 Brain UI 烟测可在当前 Playwright Chromium 缓存缺失时使用本机已有 Chromium 缓存启动。
- 通过 `node --check src/hotspot-alert-renderer.js`、`node --check src/hotspot-alert-monitor.js`，并用样例舆情事件成功生成 PNG 海报。

## v0.4.92 - 2026-06-03

### 修复
- 深修微信群长文/文件回复只回一句“好的/稍等/马上整理”后静默结束的问题：微信群实质性请求会拦截空承诺，要求同一轮产出完整内容。
- 文件附件发送改为严格按用户原文触发：只有明确要求 `txt/md/pdf/word/excel/ppt/py/js/json/csv/html`、文本文档格式、Word 文档、PDF 文件等具体格式时才生成附件。
- 没有明确文件格式时，即使模型自作主张传 `send_message.attachment`，运行时也不会自动生成或发送附件。

### 验证
- 通过 `node --check src/social/wechat-file-reply.js src/capabilities/executor.js src/social/wechat-groups.js src/index.js scripts/test-wechat-file-image-memory.mjs`。
- 通过 `npm run test:wechat-file-image-memory`、`npm run test:wechat-multi-mention-quote-image`、`npm run test:wechat-guard`、`npm run test:wechat-admin-priority`。

## v0.4.73 - 2026-05-31

### 修复
- 修复知识库 PDF 解析调用新版 `pdf-parse` 的方式，PDF 文件现在可以正常提取文本进入预览队列。
- 修复 CSV UTF-8 中文被解析成乱码的问题，CSV 现在按 UTF-8 文本表格解析。
- 知识库状态卡不再把历史导入失败任务永久计入失败数，只统计已入库知识源的错误状态，避免状态页误导。

### 验证
- 已深测手动文本、全局知识检索、群组专属知识隔离、TXT/MD/CSV/XLSX/DOCX/PDF/SVG 解析预览。
- 已确认 Honcho 和 Docker 均正常：`/knowledge/status` 显示 Honcho 已接通、Docker running。
- 通过 `npm run smoke:brain-ui`、`npm run test:wechat-guard`、`npm run test:wechat-archive-evidence`。

## v0.4.72 - 2026-05-31

### 新增
- 新增独立“知识库”控制台：全局/群组双层知识空间、导入抽屉、解析预览队列、知识卡片工作台、详情编辑和模拟群内提问测试。
- 新增外部知识库本地表与 API，支持解析预览、确认入库、重新解析、启停/删除和当前群范围检索。
- 支持导入文本、Markdown、Word、Excel/CSV、PDF、公开网页链接和多格式图片；图片知识会尝试走视觉模型生成描述/OCR/标签。
- 微信群 @ 回复会注入外部知识库上下文，只召回全局知识和当前群绑定知识，并要求使用时给出简短来源。

### 修复/加固
- Honcho 启动脚本新增 Docker Desktop 自动唤起和等待逻辑，Docker 未运行时不再静默失败。
- 知识库状态页会显示 Honcho 已接通/未连通；Honcho 不通时外部知识库仍可本地检索工作。

### 验证
- 已恢复本机 Honcho：`http://127.0.0.1:8018/health` 返回 `{"status":"ok"}`，api/database/redis healthy，deriver running。
- 通过 `node --check src/knowledge-base.js src/api.js src/social/wechat-groups.js src/ui/brain-ui/app.js`。
- 通过 Electron Node smoke：知识解析、入库、搜索和状态读取。

## v0.4.62 - 2026-05-29

### 新增
- 新增“微信群助手掉线二维码自动通知”：持续监控微信群助手真实在线状态，发现离线/需要重新登录时自动进入二维码恢复流程。
- Wechaty 二维码生成后，会自动生成本地 PNG 二维码，并通过 `社交媒体 → 微信 ClawBot（个人微信）` 发送到 ClawBot 自己；不需要选择联系人、群或接收人。
- 新增重复通知冷却机制，默认 15 分钟内同一个二维码只通知一次，避免掉线时刷屏。
- 新增“离线且暂无二维码时自动重新生成二维码”能力：检测到登录态恢复超时、断开、错误、缓存群不可用等状态时，会自动触发重新扫码流程。
- 微信群助手设置页新增“掉线二维码自动通知”卡片，可开关通知、开关自动生成二维码，并选择 5/10/15/30/60 分钟冷却间隔。

### 修复/细节
- ClawBot 新增系统自通知发送能力，使用 ClawBot 当前账号作为通知目标，不再要求用户填写联系人 ID。
- ClawBot 自通知优先发送二维码图片；如果图片发送失败，会降级发送文字和二维码内容，保证用户至少能拿到登录信息。
- 微信群助手状态接口新增 `offline_qr_notify`，前端可显示 ClawBot 是否连接、最近一次通知时间和失败原因。
- 二维码 PNG 只由程序内部生成，保存在本机数据目录的 `wechaty-login-qrcode` 下，不读取或外发用户本机任意文件。

### 验证
- 通过 `node --check src/config.js src/social/wechat-clawbot.js src/social/wechaty-duty-group.js src/api.js src/ui/brain-ui/app-shell.js src/ui/brain-ui/app.js`。
- 通过新增 `npm run test:wechaty-offline-qr-notify`，验证通知文案、无接收人要求、二维码去重冷却和强制发送逻辑。
- 通过 Playwright 打开 Brain UI，确认“设置 → 微信群助手 → 掉线二维码自动通知”默认启用、自动重新生成二维码默认启用、冷却间隔默认 15 分钟，且提示明确“不需要选择联系人”。

## v0.4.61 - 2026-05-29

### UI
- 重做“设置 → 网络能力”页面视觉结构，不再把 10 个 Brave Key 槽位堆在普通表单里。
- 设置窗口从窄小弹窗升级为更宽更高的桌面级配置面板，减少下拉、输入框和卡片拥挤问题。
- 网络能力页新增顶部 Hero 总览、4 个能力状态卡片、Brave Key 池主卡片、Serper/Jina/SearXNG 兜底渠道卡片和底部保存操作条。
- Brave Key 1~10 改为卡片式槽位，每个槽位单独显示“本地 / ENV / 空”状态，清空操作独立呈现，避免用户看不懂当前 Key 是否生效。
- Brave Key 池总状态改为胶囊展示，清楚显示可用数量、本地数量和环境变量数量。
- Serper、Jina、SearXNG 状态统一使用绿色/蓝色/灰色胶囊，不再用零散小字和行内颜色。

### 体验改进
- 保存按钮改为“保存网络能力设置”，并收拢成底部操作条；保存作用范围更明确。
- Key 明文仍不回显，只展示配置来源，避免泄露密钥。

### 验证
- 通过 `node --check src/ui/brain-ui/app-shell.js src/ui/brain-ui/app.js`。

## v0.4.60 - 2026-05-29

### 新增
- 新增“网络能力”设置页：原“上网搜索”升级为网络能力菜单，集中管理网页搜索、公开网络图片搜索和 Brave Key 池。
- 新增 Brave Search Key 池，最多 10 个 Key。`web_search` 会优先调用 Brave Search API；当某个 Key 认证失败、无额度、被限流或返回 401/402/403/429 时，自动切换到下一个 Key。
- Brave 全部不可用时，`web_search` 自动回落到原始兜底链：Serper → SearXNG → Bing → Jina → DuckDuckGo。
- 新增 `public_image_search` 工具：用于搜索公开网络图片/照片/GIF。默认优先 Brave Images，Brave 不可用时使用 Bing Images 兜底。
- 微信群里“找图/发网络图片/发照片/发壁纸/发示意图”等请求会走公开网络图片搜索，并通过 Wechaty `FileBox.fromUrl` 直接发图片/GIF，不再裸发链接。

### 修复
- 修复微信群链接查看“只回复正在查看但没有真实调用工具”的可信度问题。现在如果用户给 URL 并要求查看/总结/分析，提示词会强制先 `fetch_url`，失败或需要 JS 时再 `browser_read`。
- `send_message` 增加微信群链接查看兜底拦截：对于带 URL 的查看请求，禁止只发送“我看看/正在查看/稍等/我查一下”等占位回复，必须先拿到真实工具结果再回复。
- `fetch_url` 对公开图片 URL 返回可读的图片元数据提示，不再把图片 content-type 简单当作网页抓取失败。

### UI
- 设置页新增 Brave Key 1~10 槽位，每个槽位支持输入覆盖、留空保留、勾选清空，并显示本地/环境变量配置状态。
- 工具流新增 `public_image_search` 的中文名称和图标展示。

### 验证
- 通过 `node --check src/config.js src/social/public-image-search.js src/capabilities/executor.js src/social/wechaty-duty-group.js src/social/wechat-groups.js src/capabilities/schemas.js src/llm.js src/ui/brain-ui/app.js`。
- 通过新增 `npm run test:public-image-search`，验证 Brave Key 池在第 1 个 Key 429 后会自动切到第 2 个 Key，并支持清空 Key。
- 通过 `npm run test:tool-router`、`npm run test:wechat-guard`、`npm run test:social-targets`、`npm run test:wechat-quote-citation`。

## v0.4.59 - 2026-05-29

### 修复
- 修复微信群“已经支持引用上下文，但回复里从来不明显显示引用”的体验问题。旧版本会解析微信引用并注入 `<wechat-quoted-message>`，但只让模型“需要时短短引用一句”，模型经常直接回答，用户看不到引用依据。
- 微信引用场景新增可见引用策略：当用户通过微信引用文字、图片、语音、视频、链接、小程序后 @ 助手，且回复依赖引用内容时，回复开头必须出现 `引用 @某某：……`、`引用图片 @某某：……`、`引用链接 @某某：……` 等短依据。
- `send_message` 底层增加兜底保护：如果本轮 Wechaty 群消息包含可解析引用，而模型没有主动写出引用行，发送前会自动补一行可见引用，保证群里能看见“它到底引用了哪条消息”。
- 聊天记录库检索类问题（例如“谁说过/之前/刚才/聊天记录/谁是大哥/老登是谁/称呼关系”等）新增证据引用提示：只要使用 `<wechat-group-archive-evidence>` 回答，就要显示一条 `引用聊天记录：时间 昵称：关键原文摘要`。
- Wechaty 群消息上下文补充保存 `raw_payload_text` 和 `message_type`，让发送兜底可以识别 XML/媒体引用，不只依赖可见文本。

### 边界说明
- 本版本实现的是“回复文本里的可见引用依据”，不是微信原生引用气泡。原生引用气泡需要伪造/注入 Web 微信底层消息 XML，稳定性和封控风险都更高，暂不启用。
- 引用内容仍按省 token 策略处理：只给摘要/元数据，不发送原始 XML、base64 或完整历史。

### 验证
- 通过 `node --check src/capabilities/executor.js src/social/wechaty-duty-group.js src/social/wechat-groups.js`。
- 通过 `npm run test:wechat-quote-context`。
- 通过新增 `npm run test:wechat-quote-citation`，验证引用消息会自动补可见引用且不会重复补引用。
- 通过 `npm run test:wechat-archive-evidence`、`npm run test:wechat-guard`、`npm run test:social-targets`。

## v0.4.58 - 2026-05-29

### 修复
- 修复微信群统计排行榜里“同一个人同时占多个排行名次”的问题。原因是 `wechaty-puppet-wechat4u` / Web 微信在多次刷新群成员后，同一个成员会出现多个历史 `@hash sender_id`，旧排行榜按 sender_id 聚合，导致同一昵称被拆成多条。
- 排行榜聚合规则改为：同一群内优先按 `stable_key / wxid / wechat_id` 合并；拿不到稳定身份时，按当前可见群昵称合并；最后才按 sender_id 兜底。
- 发言榜、发图榜、表情榜、链接榜、装逼榜都使用同一套身份合并逻辑，避免一个成员在同一个榜单重复上榜。
- 参与人数统计同步改为按合并后的成员身份计算，不再被历史 sender_id 膨胀。

### 实测
- `PT站看片狂魔小群` 今日统计：消息 897，参与人数从历史 sender_id 膨胀值降为 21；榜单内“一灯（无情的复读机）”“一条咸鱼'”“大海”等不会再重复占多个名次。
- `🔥Nas技术之家` 今日统计：消息 426，参与人数降为 18；“三七 求空 不可说 皇后”“风”等只占一个名次。
- `值班群` 今日统计：消息 75，参与人数降为 4；“风”只占一个名次。

### 验证
- 通过 `node --check src/social/wechat-group-stats.js`。
- 通过本机真实数据库调用 `getWeChatGroupStats` 验证三个群的 5 个排行榜均无重复昵称。

## v0.4.57 - 2026-05-29

### 修复
- 修复微信群图片解析“真实 fetch 调用能成功，但后台解析总是报 `识图模型返回空内容`”的问题。原因是当前中转的 `chat.completions` 响应可被原始 fetch 正常解析，但 OpenAI SDK 在该响应格式下返回字符串对象，导致后台读不到 `choices[0].message.content`。
- 微信图片识别调用改为与连通测试一致的原始 `fetch + JSON` 解析，并兼容字符串内容、数组内容和非 2xx 错误体，避免再次把有效识图结果误判为空。
- 调整识图候选优先级：用户在 Skill 页面显式配置的“识图模型渠道”优先于当前 LLM 模型；当前 LLM 只作为兜底，避免聊天模型空返回/超时拖慢后台图片解析。
- 识图候选去重不再把 provider 计入 key，同一 Base URL + 模型 + Key 不会因为来自“当前模型 / Skill / LLM Profile”而重复请求。
- 开始重新解析图片时会清空旧错误，避免 UI 显示“正在解析”但仍挂着上一轮失败原因。
- 自动将超过 15 分钟的陈旧 `running` 图片任务重排为 `pending`，防止 Electron 重启或旧代码异常退出后永久显示“解析中”。
- 识图状态接口不再把“历史单张坏图/文件缺失”的最新错误误判为整体渠道不可用；状态区新增失败数、解析中数和真实待处理数。

### 实时验证
- 当前程序已重启加载新代码。
- `/settings/skills/image-vision/status` 显示 `health=ok`，当前运行时为 `skill:gpt-5.4 识图主渠道`。
- 实时补解析验证通过：旧卡死图片 id 42、48 已成功解析；新收到图片 id 155、157、158、160、161、165、168、170、171 等已写入描述。
- 当前数据库没有真实 `running/pending` 卡死任务；剩余未解析项主要是历史 `error`，包括文件缺失/base64 为空或单张图片超时。

### 验证
- 通过 `node --check src/social/wechat-image-vision.js`。
- 通过 `npm run test:wechat-guard`、`npm run test:social-targets`。
- 本机真实调用数据库图片测试：原始 fetch 能返回图片描述，后台修复后连续解析成功。

## v0.4.56 - 2026-05-29

### 修复
- 根据 5 张数据库失败图片的真实测试结果，调整识图超时策略：不再把单次识图硬限制为 25 秒，而是按设置里的 `apiTimeoutSeconds` 执行，最高 180 秒。
- 识图渠道测试窗口从 10 秒放宽到 35 秒，避免 `gpt-5.4` 这类真实可用但响应较慢的视觉模型被误判失败。

### 实测结论
- 指定渠道 `gpt-4o-mini` 对 5 张数据库失败图片全部返回 `502 Upstream service temporarily unavailable`。
- 同一渠道 `gpt-5.4` 对小图成功，对 242KB~310KB 大图在 22~33 秒内成功；因此后续建议把识图 Skill 默认模型切到 `gpt-5.4`，超时设置至少 45 秒。

### 验证
- 通过 `node --check src/config.js src/social/wechat-image-vision.js`。
- 通过 `npm run test:wechat-guard`、`npm run test:social-targets`。

## v0.4.55 - 2026-05-29

### 修复
- 修复 Skill 识图渠道状态误导问题：以前“测试连通/可用”主要代表配置存在或 `/models` 可连通，但这不能证明图片输入真的可用。
- 识图渠道的“测试连通”改为真实调用 `chat.completions` 并发送一张 1x1 测试图，只有模型返回非空内容才算识图可用。
- 识图状态卡不再简单显示“可用”，而是区分“已配置待真实识图 / 最近识图成功 / 已配置但最近失败”，并显示最近失败摘要。

### 诊断结论
- 当前用户配置的 Skill 识图渠道确实被程序读取并使用了；失败原因是渠道真实识图接口返回 `503 Service temporarily unavailable`。
- LLM Profile 里的 `gpt-5.4` 虽然名字像多模态，但实际对图片返回空内容，不能作为可靠识图模型。

### 验证
- 通过 `node --check src/config.js src/social/wechat-image-vision.js src/ui/brain-ui/app.js`。
- 本机真实调用 `/settings/skills/test-channel` 测试当前识图渠道，已能准确返回 503，而不是误显示可用。

## v0.4.54 - 2026-05-29

### 新增
- Skill 技能页新增“模型渠道池”：生图 Skill 和识图 Skill 都可以配置多个 OpenAI 兼容渠道，每个渠道支持名称、Base URL、模型、API Key、启用/默认、上移/下移、删除和连通测试。
- 后端新增 Skill 渠道连通测试接口 `POST /settings/skills/test-channel`，可用已保存密钥或新填写密钥检测 `/models` 连通状态。
- 生图 Skill 调用时会按默认渠道和排序自动故障切换：当前渠道失败/超时/无图时尝试下一个已启用渠道，并把所有失败原因汇总反馈给群里提问人。
- 识图 Skill 调用时会按“当前多模态 LLM -> Skill 识图渠道池 -> LLM 模型池视觉模型”的顺序尝试，渠道失败后自动切换。

### 修复 / 稳定性
- 修复图片理解失败时长时间无响应的问题：命中识图请求后会先 @ 提问人提示“图片已入库，正在识别”，避免用户以为程序没动。
- 微信群发送文本/图片增加超时保护，微信底层发送卡住时不会无限挂起。
- 识图同一张图片的前台请求和后台解析会复用同一个解析任务，避免同一媒体并发重复调用多个坏渠道。

### 验证
- 通过 `node --check src/config.js src/api.js src/social/image-generation-skill.js src/social/wechat-image-vision.js src/social/wechaty-duty-group.js src/ui/brain-ui/app.js src/ui/brain-ui/app-shell.js`。
- 通过 `npm run test:wechat-guard`、`npm run test:social-targets`。

## v0.4.53 - 2026-05-29

### 修复
- 修复微信群连续发送“@助手 → 总结一下图 → 图片”时，助手过早进入 LLM、只能看到 `[图片]` 占位并回复“没读到真图内容”的问题。
- @ 触发后如果是纯 @ 或图片理解请求，会短暂等待同一成员后续文字/图片入库，再合并成一次真实图片理解请求；图片入库完成后优先走直接识图链路，不再让普通文本 LLM 凭占位符猜。
- 新增直接识图失败反馈：如果图片已经入库但模型返回空、超时或 5xx，会明确告诉群里“图片已收到并入库，但识图模型解析失败”，并带上当前识图模型信息，避免误以为数据库没保存图片。

### 稳定性
- 微信图片入库后改为后台识图，不再在消息入口同步卡住；被 @ 时需要即时看图再主动拉取最近图片解析。
- 识图候选模型去重时不再把 `source` 当作去重条件，避免当前模型和同配置 LLM Profile 重复调用同一个中转导致多等一次超时。
- 显式配置的“识图模型”优先级提升到普通 LLM Profile 前面；单个识图候选超时上限收敛到 25 秒，坏渠道不会无限拖慢群回复。

### 验证
- 已重启当前 Mac 上的贾维斯 Electron 程序，新代码已加载，Wechaty 已恢复在线并接入目标群。
- 通过 `node --check src/social/wechaty-duty-group.js`、`node --check src/social/wechat-image-vision.js`。
- 通过 `npm run test:wechat-guard`、`npm run test:social-targets`。
- 日志确认旧问题发生原因：2026-05-29 13:18 左右，用户连续发送 @、总结文字和图片，旧逻辑在图片入库前已把 @ 交给 LLM；同时当前配置的识图候选存在返回空/超时/503，属于模型渠道可用性问题。

## v0.4.52 - 2026-05-29

### 实验 / 结论
- 新增本机调试接口 `POST /social/wechaty-duty-group/test-native-mention`，用于向 Web 微信 `webwxsendmsg` 注入 `MsgSource/atuserlist` 做系统级 @ 兼容性测试。
- 已在“值班群”对成员“风”实测 4 种载荷：`msgsource`、`msgsource-both`、`msgsource-lower`、`top-level-msgsource`；微信接口均返回 `Ret=0`，消息也能发出。
- 但 Mac 微信会话列表只显示普通未读数和文本预览，没有出现系统级「有人@我」提示，说明当前 `wechaty-puppet-wechat4u` / Web 微信发送接口会忽略或剥离这些 @ 元数据。

### 行为说明
- 生产默认发送逻辑没有改成 MsgSource 方案，仍保持 v0.4.51 的“可见文本 @真实群昵称”兜底，避免把失败实验影响到正常回复。
- 结论更新为：Web 微信路线目前只能稳定做到可见 `@昵称`，不能稳定做到微信系统级 `[有人@我]`。若必须实现第二张图那种系统通知，需要转向 Mac 微信原生 UI 自动化或支持真实 mention 的协议/puppet。

### 验证
- 已重启当前贾维斯 Electron 程序，新接口生效，微信群连接恢复为 `connected / online`。
- 已向“值班群”发送 4 条实验消息，并通过本机 Mac 微信会话列表观察结果。
- 通过 `node --check src/social/wechaty-duty-group.js`、`node --check src/api.js`。
- 通过 `npm run test:social-targets`、`npm run test:wechat-guard`。

## v0.4.51 - 2026-05-29

### 修复
- 修复 Web 微信 / `wechaty-puppet-wechat4u` 发送 @ 时只显示一个空 `@`、@ 后直接接正文、或 @ 错昵称的问题；本版本解决的是“可见文本 @真实群昵称”，不是系统级 `[有人@我]`。
- 普通微信群回复、管理员保护/拒绝、安全拦截、斗图、生图、转发图片等所有 `sendWechatyDutyGroupMessage` 路径统一使用真实群昵称拼接 `@昵称`。
- LLM 渠道连通告警的 @ 人员会根据保存的真实 sender_id 解析当前群昵称，不再只显示空 @。

### 稳定性 / 安全
- 普通群聊回复仍由底层强制锁定本轮真实提问人的 sender_id，不相信模型自己选择的 target，避免 @ 到群主、管理员或上一位成员。
- 若模型回复内容自己带了开头 @，发送前会去掉并重建为真实提问人的群昵称，避免出现 `@` 后直接接正文或 @ 错别名/外号。
- 非 wechat4u puppet 仍优先使用 Wechaty 原生 mention；失败时降级为手动 `@昵称` 文本。

### 验证
- 通过 `node --check`：wechaty-duty-group、llm-connectivity-monitor、Brain UI app。
- 通过 `npm run test:wechat-guard`。

## v0.4.50 - 2026-05-29

### 新增
- LLM 渠道连通通知支持“按微信群选择 @ 人员”：每个通知群都可以加载成员列表、按微信昵称搜索并勾选要通知的人。
- 配置新增 `notifyMentionsByGroup`，按群保存真实成员 sender_id；界面只展示昵称，发送时仍用真实成员 ID 解析 @，避免改昵称或同名导致误 @。
- Wechaty 群发送函数新增多人 @ 能力，并保持原有单人 `mentionId` 回复兼容；若个别 @ 解析后发送失败，会降级为普通群通知，不让整条通知丢失。

### 交互优化
- 通知群卡片下方新增独立“通知时 @ 人员”区域：未勾选该群时会明确提示不生效，勾选后可直接加载成员并选择。
- 已保存但还未加载成员昵称的 @ 人员会显示为“已保存成员”，不会因为打开设置页或没有加载成员而丢失配置。
- “选择通知微信群”计数会同时显示已选群数量和已选 @ 人员数量，方便确认通知范围。

### 行为说明
- 未选择 @ 人员时仍只发送群通知，不会误 @ 全员或随机成员。
- 手动“立即检测并通知”会先保存当前群组和 @ 人员配置，再按新配置发送。
- 定时器仍默认关闭；启用后也不会在软件启动后一整个检测间隔内自动刷群，避免重启/恢复微信时误通知。

### 验证
- 通过 `node --check`：config、llm-connectivity-monitor、wechaty-duty-group、api、social/index、Brain UI app、app-shell。
- 继续通过微信群引用上下文、微信群安全拦截、全量入库关键测试。

## v0.4.49 - 2026-05-29

### 新增
- LLM 模型设置页新增“渠道连通通知”：可开启定时检测，配置通知间隔、通知策略、要检测的 LLM 渠道和要通知到的微信群。
- 后端新增 LLM 连通性监控调度器：复用模型池真实 `chat.completions` ping 检测渠道是否可用，并记录每个 profile 的最近成功/失败状态。
- 新增手动“立即检测”和“立即检测并通知”操作，方便保存配置后立刻确认通知链路。

### 交互优化
- 通知间隔和通知策略使用大尺寸下拉框；检测渠道和通知群组使用可滚动卡片式多选列表，避免小下拉难点、看不清。
- 支持三种通知策略：异常/恢复变化通知（推荐）、只通知不通渠道、每次检测都通知。
- 微信群通知只包含渠道名称、模型、连通/失败、延迟和短错误摘要，不展示 API Key。

### 行为说明
- 定时器启动后不会在软件启动当下立刻往群里刷通知；会按配置周期自然触发。
- 未选择渠道时，默认检测当前模型池所有渠道；保存后会按勾选结果固定检测范围。
- 未选择或无法解析微信群时，检测仍会记录在设置页，但不会误发到所有群。

### 验证
- 通过 `node --check`：config、llm-connectivity-monitor、social/index、api、Brain UI app、app-shell。
- 保留并继续通过微信群引用上下文、微信群安全拦截、全量入库关键测试。

## v0.4.48 - 2026-05-29

### 新增
- 微信群 @ 回复新增“引用消息上下文”理解层：支持微信可见引用文本，以及底层 XML/元数据里的文字、图片、语音、视频、链接、小程序和表情类型识别。
- 大模型 prompt 中新增 `<wechat-quoted-message>` 精简块：只注入类型、发送者、标题/描述/URL、短摘要和引用后的当前请求，避免把原始 XML、base64、完整聊天历史塞进上下文。
- 引用图片会自动提示优先结合已入库的微信群图片解析库；引用语音若没有转写会明确说明没有语音文本，不再瞎编。

### 行为优化
- 用户引用一条消息后再 @ 助手提问时，实际请求会优先取“引用后面的当前问题”，减少模型被整段引用带偏。
- 链接/小程序/视频只按标题、描述、URL 等元数据回答；需要依据时只短引用一句，不会复述整段内容。
- Wechaty 链路会把底层消息 payload 仅用于解析引用，不直接暴露到 prompt；ClawBot 链路也会传入原始文本与消息类型。

### 验证
- 通过 `node --check`：wechat-quote-context、wechat-groups、wechaty-duty-group、wechat-clawbot。
- 新增并通过 `npm run test:wechat-quote-context`，覆盖文字引用、图片引用、链接 XML、小程序、语音、视频和无引用场景。

## v0.4.47 - 2026-05-29

### 修复 / 优化
- 优化数据库页“微信群图片解析库”的筛选控件：群组、状态、关键词、发送人、开始/结束时间全部改为大尺寸可用控件，不再出现下拉框/输入框太小看不清的问题。
- 新增“查询图片”和“重置筛选”按钮，用户不需要依赖回车或自动 change 事件。
- 图片卡片新增“编辑解析”和“删除图片”操作。

### 新增管理能力
- “编辑解析”可手动修改识图描述和标签，保存后立即刷新列表与统计。
- “删除图片”会删除图片库数据库记录，并默认尝试删除本机已入库的微信图片文件；删除接口只允许操作已入库图片的安全相对路径，不能删除任意本机文件。
- 后端新增图片库 update/delete API，均要求本机/授权访问。

### 验证
- 通过 `node --check`：wechat-image-vision、api、brain-ui app、app-shell。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过缺失 ID update/delete 安全测试。
- 通过 `git diff --check`。

## v0.4.46 - 2026-05-29

### 新增
- 数据库设置页新增“微信群图片解析库”可视化面板：可查看所有已入库微信群图片的缩略图、发送群、发送人、发送时间、解析状态、识图描述、标签和模型信息。
- 新增图片解析进度卡：显示总数、已解析、待解析、解析中、失败/无模型、base64 备份数量，并显示后台解析 worker 是否运行。
- 新增图片库筛选：按群组、解析状态、关键词、发送人、开始时间、结束时间过滤；关键词支持 `newapi/New API`、发送人别名等常见归一化。
- 新增“解析待处理”后台任务入口：点击后立即返回，不阻塞 UI；后台按批次解析待处理/失败/无模型图片。
- 数据库页打开时会自动刷新图片库；每 10 秒自动刷新解析数量和列表，并在存在待解析图片时自动触发后台补解析。

### 行为说明
- 群里新收到图片仍会按原逻辑自动入库并后台识图；本版本补齐“看得见当前解析进度、能浏览、能查询、能手动补解析”的可视化管理能力。
- 图片预览只读取 `data/wechat-media` 下已入库的微信图片相对路径，不允许任意本机路径外发或预览。

### 验证
- 真实数据库测试 `/social/wechat-groups/images`：可按 `PT站看片狂魔小群 + newapi` 查询到 Dali/力佬发过的 New API 图片，并返回解析状态与描述。
- 后台解析入口可启动 worker，并能把待解析图片数量推进。
- 通过 `node --check`：wechat-image-vision、api、brain-ui app、app-shell。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.45 - 2026-05-29

### 新增
- 微信群图片转发检索新增自然时间条件解析：支持 `今天`、`昨天`、`前天`、`大前天`、`N天前`、`5月29日`、`2026-05-29`、`上午/下午/晚上/凌晨/中午`、`9点`、`09:15`、`9点半`、`刚才/最近` 等表达。
- 图片检索现在可以把“时间 + 发送者昵称/别名 + 图片识别内容”联合打分，例如 `今天09:15力佬发的newapi图` 会优先命中当前群中对应时间附近、对应成员、内容含 New API 的图片。
- 图片检索结果返回调试用 `timeIntent`，便于后续在设置页/日志中展示机器人实际理解到的时间范围。

### 行为说明
- 群图片只要在程序运行、Wechaty 在线且已接入该群时被收到，就会自动保存入库；普通非 @ 图片也会后台识别。
- 识图成功后会保存中文描述、标签和图中文字摘录；即使识图暂未完成，只要图片文件已入库，也能按发送者和时间作为兜底候选。
- 当前仍默认只在“当前群”的图片库中转发，避免把其他群图片串发出去。

### 实测
- 对真实 `PT站看片狂魔小群` 图片库测试：`今天9点力佬发的newapi图`、`今天09:15力佬发的newapi图`、`今天上午力佬发的newapi图`、`最近力佬发的图`、`5月29日力佬发的newapi图` 均能解析时间范围并返回可用图片文件。

### 验证
- 通过 `node --check src/social/wechat-image-vision.js`。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.44 - 2026-05-29

### 修复
- 修复微信群里“给我力佬发的那张 newapi 的图”找不到图的问题：图片库搜索现在会把 `newapi`、`New API`、`New-API` 视为同一个关键词。
- 图片转发检索加入发送者昵称、花体昵称标准化和群成员常用外号匹配；当前内置兼容“力佬/大力/Dali/Dafi”这类称呼。
- 图片转发候选不再只看已经完成识图描述的图片；只要是当前群已入库且本地文件可用的微信图片，也能作为兜底候选，避免刚入库但还没识图完成时直接说找不到。

### 原因说明
- 之前机器人能“总结这张图”，是因为大模型上下文里能看到图片识图描述；但“发给我这张图”走的是另一条严格的图片转发检索链路。
- 这次 PT 群图片已入库，描述里写的是 `New API`，用户说的是 `newapi`，再加上发送者是花体昵称 `𝓓𝓪𝓵𝓲·𝓦𝓪𝓷𝓰`、用户叫“力佬”，旧检索没有做归一化和别名匹配，所以误判为没找到。

### 实测
- 对真实数据库测试 `@小风 给我力佬发的那张newapi的图`：可以命中 `PT站看片狂魔小群` 中 `𝓓𝓪𝓵𝓲·𝓦𝓪𝓷𝓰` 发过的 New API 图片，并确认本地文件可解析。

### 验证
- 通过 `node --check src/social/wechat-image-vision.js`。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.43 - 2026-05-29

### 修复
- 修复“发送给我那张图/那张山水画发我”仍被误判为生图的问题。
- 生图触发进一步收紧，避免把名词“山水画”里的“画”当作“画图”指令。

### 新增
- 新增已入库群图片转发能力：当用户要求“把那张图发给我/转发刚才那张图”时，优先在当前微信群 `wechat_group_media_items` 图片库中检索匹配图片并直接发送原图。
- 图片转发只允许发送当前群已经入库的微信图片文件，不允许发送任意本机路径，避免隐私泄露。
- 匹配逻辑会根据图片识图描述和用户请求打分，例如“水墨山水画”会命中已识别的水墨山水图片。

### 实测
- 对 `@前夜 发送给我那张水墨山水画的图片给我，给我那张图` 测试：不触发生图，命中值班群图片库中的水墨山水图，文件可解析并可发送。
- 正常生图请求仍可用。

### 验证
- 通过 `node --check`：image-generation-skill、wechat-image-vision、wechaty-duty-group。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.42 - 2026-05-29

### 修复
- 修复“看图/识图/引用图片”被误判成“生图”的问题。现在包含“看、识别、识图、图片里、图里、引用、报错、内容”等意图时，不会触发生图 Skill。
- 生图触发词收紧：只在明确“生图/画图/生成图片/画一张/绘制/设计/创作”等场景触发，不再因为“给你图/来图/引用图”误触发。
- 微信群提示词增加图片理解边界：引用图片优先使用图片记忆；若 Wechaty 只拿到 `[图片]` 引用文本而没有像素内容，会明确要求用户直接重发图片，不会擅自生图。

### 增强
- 新增从历史群聊活动记录中回填已保存图片到 `wechat_group_media_items` 的能力，可把旧的 `[媒体文件]` 图片补进识图库并生成描述。
- 已针对“值班群”这次 Hermes 截图执行回填和识图：成功导入 1 张，识别 1 张。

### 实测识图结论
- 这张 Hermes 截图可以识别到内容：图里显示 provider 180 秒无响应、重连、重试，最终 `HTTP 502: Upstream service temporarily unavailable`，并且 retries exhausted 后尝试 fallback。
- 判断更像是上游模型/中转服务不可用或超时，不是单纯 Hermes 本地逻辑问题；需要检查当前模型 `gpt-5.5`、中转 baseURL/API key/额度、上游网关稳定性和 fallback 配置。

### 验证
- 误触发测试：`我给你图 引用给你自己看`、`没让你生图 是让你识别图里的内容`、`看看图片里hermes是啥问题` 均不会触发生图。
- 正向测试：`生图 一个蓝色圆形图标`、`帮我画一张猫图` 仍会触发生图。
- 通过 `node --check`：image-generation-skill、wechat-image-vision、wechat-groups。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.41 - 2026-05-29

### UI 修复
- 修复 Skill 技能页输入框/下拉框过小的问题：生图和识图配置项现在使用正常宽度、正常高度的大表单控件。
- 生图模型不再手填，改为下拉选择内置生图模型：`gpt-image-2`、`gpt-image-1`、`dall-e-3`，并保留当前配置值。
- 识图备用模型不再手填，改为下拉选择：优先读取当前 LLM 和 LLM 模型池里的多模态候选模型，同时提供内置 GPT/Vision 模型。
- Skill 设置页加载时会同步读取 LLM 模型池，因此后续添加多模态模型后会出现在识图模型下拉框中。

### 验证
- 通过 `node --check src/ui/brain-ui/app.js`。
- 通过 `git diff --check`。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。

## v0.4.40 - 2026-05-29

### 新增：微信群识图 Skill / 图片记忆
- 新增“识图 Skill”：微信群收到图片后会保存本地文件、base64、图片元数据，并调用多模态/GPT 模型生成中文内容描述和标签。
- 新增 `wechat_group_media_items` 数据表，字段包含群、发送人、图片路径、mime、大小、sha256、base64、识图描述、标签、识图模型和状态。
- 当前 LLM 如果是多模态/GPT 模型，会优先使用当前模型识图；如果当前模型不是多模态，会自动使用备用 GPT 识图模型。
- 识图结果会进入当前微信群的图片记忆上下文；后续即使切换到 DeepSeek 等非多模态模型，也能通过图片描述理解历史图片含义。
- 群聊数据库混合搜索增加图片描述搜索。
- 数据库备份导出包含 `wechat_group_media_items`，图片 base64 和描述可随备份恢复。

### 设置页
- Skill 技能页新增“识图 Skill”配置：启用开关、优先当前多模态模型、备用 GPT Base URL、备用模型、备用 Key、识图超时、状态刷新。
- 状态显示真实图片入库数、已描述数、待处理数、base64 保存数。

### 行为说明
- 被 @ 的图片消息会优先等待识图结果再进入大模型回复，保证当场能理解图片。
- 普通群图片会后台识图，不打扰群聊；识图结果会进入后续记忆上下文。
- 不直接把本机文件发给群友；图片理解只用于本地知识库和回复上下文。

### 验证
- 实测本地测试图片成功入库 base64 并识别：蓝色圆形、白色背景、极简图形。
- 实测识图耗时约 13 秒，使用当前多模态模型 `gpt-5.4`。
- 通过 `node --check`：config、wechat-image-vision、wechaty-duty-group、wechat-groups、api、database-overview、brain-ui app。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.39 - 2026-05-29

### 优化
- 数据库页的“微信群成员/昵称”不再直接显示历史身份记录总数，改为显示按“群名 + 昵称”聚合后的有效昵称数。
- 新增“成员有效视图”面板：同时展示有效昵称、历史身份记录、可合并历史记录、可用 wxid 数。
- 按群展示成员昵称聚合结果，例如“PT站看片狂魔小群：52 个昵称 / 358 条历史身份”。
- 展示重复昵称示例，方便排查 Wechaty 重登后 sender_id 变化造成的虚高。

### 说明
- 本版本不删除原始 `wechat_group_member_names` 记录，只做安全显示层合并，避免误删历史身份和昵称映射。
- 原始表仍完整保留，导出备份仍包含全部历史记录。

### 验证
- 当前实测：有效昵称约 359，历史身份记录 1717，可合并历史记录 1358，wxid 可用数 0。
- 通过 `node --check src/database-overview.js`。
- 通过 `node --check src/ui/brain-ui/app.js`。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.38 - 2026-05-29

### 修复
- 取消微信群统计总结的“启动/登录自动补发”：程序启动、微信扫码登录、恢复连接后，不再立刻向群里发送阶段总结。
- 定时总结调度器启动时会记录当前 interval 周期，并跳过该启动周期，避免一登录就触发发送。
- 删除启动后 15 秒延迟检查发送逻辑；总结只会在用户手动点击发送，或进入后续真正的定时周期时发送。

### 保留行为
- 设置页里的“手动发送总结”仍然可用。
- 如果用户开启了定时总结，程序不会登录即发，而是等下一个定时周期再按配置发送。
- 每日 0 点统计仍受设置页开关和时间控制。

### 验证
- 通过 `node --check src/social/wechat-group-digest.js`。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check`。

## v0.4.37 - 2026-05-29

### 里程碑：微信群长期记忆 / Honcho / 本地向量可用化
- Honcho 本地服务已接通并实测健康：`http://127.0.0.1:8018/health` 返回正常。
- 微信群逐条聊天记录现在先写入本地耐久库，再同步 Honcho；Honcho 不通时不会丢消息、不会失忆。
- 已把本地 1011 条微信群消息同步到 Honcho，当前待同步 0 条。
- 已为核心长期记忆与微信群聊天记录补齐本地轻量向量：核心 180/180，群聊 1011/1011。未配置云端 embedding 时也能做本地语义检索。
- 新增从历史群聊中提取“每群/每成员”长期记忆的能力，并已从现有聊天中提取出成员称呼/身份类记忆。

### 数据库菜单增强
- 数据库页新增「补齐向量」「提取成员记忆」「同步 Honcho」三个一键操作。
- 新增聊天记录 / 长期记忆混合搜索框，可同时搜索微信群逐条聊天记录、群组记忆、成员记忆。
- 数据库状态卡真实显示 Honcho 连通状态、已同步/本地消息数量、核心/群聊/群记忆向量化进度。
- 导出备份 JSON 现在会正确保存 BLOB 向量字段为 base64；导入时会恢复 BLOB，并按聊天内容/记忆内容/mem_id 去重，避免重复灌库。

### 回答记忆逻辑
- 核心记忆注入器增加本地向量兜底：没有云端 embedding 配置时，也会使用本地轻量向量召回补充上下文。
- 微信群回答上下文会优先合并 Honcho 长期记忆、Honcho 摘要、Honcho 最近消息；Honcho 读取失败时自动降级到本地群记忆和本地向量检索结果。

### 验证与实测
- Honcho Docker 服务：api/database/redis healthy，deriver running。
- 历史同步：1011 条本地微信群消息同步 Honcho 成功，错误 0。
- 成员记忆提取：扫描 1011 条，提取 4 组成员/群组记忆，错误 0。
- 通过 `npm run test:wechat-guard`。
- 通过 `npm run test:wechat-record-all`。
- 通过 `git diff --check` 和关键文件 `node --check`。

## v0.4.36 - 2026-05-29

### 修复
- 清理并更正错误记忆 `fact_user_wechat_groups_18`：18 个微信群是历史错误记忆/历史 ID 混淆，不再作为事实使用。
- 清理导致上下文污染的临时 focus 栈片段，降低模型反复进入“高风险拒绝”状态的概率。
- 兜底回复新增供应商安全拒绝过滤：不会再把 `The request was rejected because it was considered high risk` 这类英文内部拒绝原文直接发给用户。

### 新增
- 设置页新增独立「数据库」菜单。
- 数据库页集中展示：总占用、微信群聊天记录条数/容量、微信群知识库/记忆、核心长期记忆、成员昵称表、图片/媒体文件占用。
- 新增表级明细，按估算占用从大到小显示表名、行数和容量。
- 新增 `GET /settings/database` 后端接口，用于读取本机数据库和知识库容量统计。

### UI 优化
- 数据库/知识库相关信息从微信群助手页拆出，避免微信群助手设置继续变得过乱。
- 新数据库页以“总占用”为主视图，常用数量用卡片展示，细节放到可滚动表格里。

### 当前实测数据
- 本机总占用约 39 MB。
- 微信群聊天记录约 1010 条。
- 核心长期记忆约 180 条。
- 微信群成员/昵称记录约 1002 条。
- 图片/媒体文件约 29 MB。

### 验证
- 通过 node --check：src/index.js、src/database-overview.js、src/api.js、src/ui/brain-ui/app-shell.js、src/ui/brain-ui/app.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.35 - 2026-05-29

### 新增
- LLM 模型池每个模型卡片新增「测试连通」按钮。
- 点击后后端会用该模型发起一次轻量聊天补全检测，成功后状态变为绿色「连通」，失败后状态变为红色「不通」并显示错误原因。
- 测试过程中按钮会显示「测试中…」，完成后显示连通耗时。

### 后端
- 新增 `POST /settings/llm-profile/test` 接口。
- 测试成功会更新 `lastSuccessAt` 并清空 `lastError`；测试失败会更新 `lastFailedAt` 和 `lastError`，但不会把模型加入自动冷却，避免手动检测影响故障切换策略。

### 验证
- 通过 node --check：src/config.js、src/api.js、src/ui/brain-ui/app.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.34 - 2026-05-29

### 优化
- LLM 模型池新增直观连通状态显示。
- 模型卡片的「状态」改为「连通状态」，使用信号条图标区分：绿色=连通，红色=不通，黄色=冷却中，灰色=未知/已关闭。
- 如果最近失败时间晚于最近成功时间，会显示红色「不通」，并继续保留上次错误文本，便于判断哪个模型不可用。

### 验证
- 通过 node --check：src/ui/brain-ui/app.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.33 - 2026-05-29

### 优化
- 实测生图速度：low / 1024×1024 两次分别约 84 秒、75 秒。
- 将生图 API 默认超时从 90 秒提高到 180 秒，避免服务稍微排队就被误判为超时。
- Skill 设置页新增「API 超时」下拉框，可选 120 / 180 / 240 / 300 秒。
- 生图超时错误现在会明确提示当前超时时间，例如 `图片生成请求超时（180 秒）`。

### 建议
- 默认 low / 1024×1024 继续保持速度优先。
- 普通生图建议 180 秒；高清/2K/4K/8K 如果后续仍超时，可在 Skill 设置里调到 240 或 300 秒。

### 验证
- 通过 node --check：src/social/image-generation-skill.js、src/social/wechaty-duty-group.js、src/config.js、src/api.js、src/ui/brain-ui/app.js、src/ui/brain-ui/app-shell.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.32 - 2026-05-29

### 修复
- 修复微信群生图触发词过窄的问题：`生成一张赛博朋克风格的白龙马头像` 这类自然表达现在会命中生图 Skill。
- 生图触发范围从短距离 `生成...图片` 放宽为更符合人话的 `生成/画/设计/创作...图片/头像/壁纸/海报/插画/logo/图标`。
- 避免生图请求落入普通 LLM 工具链后让模型自行 curl API，导致只得到 base64、不发送图片、甚至 180 秒 watchdog 超时。

### 安全
- 已清理本机日志中此前由模型自行 curl 暴露出的 API Key 明文，替换为 `sk-***REDACTED***`。

### 验证
- 已验证 `@前夜 生成一张赛博朋克风格的白龙马头像`、`生图 一个白龙马头像`、`画一个未来城市壁纸` 均命中生图 Skill。
- 通过 node --check：src/social/image-generation-skill.js、src/social/wechaty-duty-group.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.31 - 2026-05-29

### 新增
- 新增「Skill 技能」设置菜单，首个技能为「生图 Skill」。
- 生图 Skill 支持配置 Base URL、模型、API Key、每人每小时限额、默认质量、高清质量。
- 微信群里有人 @ 助手并明确要求“生成图片 / 生图 / 画图 / 出图”时，会直接调用生图 API 生成图片并发送到群里。
- 生图调用不添加任何预制提示词，只使用群友提出的图片需求文本。
- 新增每人每小时限流：默认每人每小时最多 10 张图，超过后会 @ 提问人反馈。
- 默认使用 low 质量和 1024×1024 分辨率以提高速度；用户明确要求高清、2K、4K、8K、超清时使用高质量参数。

### 接入
- 生图模型：gpt-image-2。
- OpenAI 兼容接口：/images/generations。
- 支持 API 返回 URL 或 b64_json；生成结果会保存到本机 data/generated-images 后再作为图片发送到微信群。
- API 调用失败、超时、未配置密钥、限流等情况都会 @ 提问人说明原因。

### 安全
- API Key 只写入本机运行配置，不提交到 GitHub，不在设置页回显明文。
- 生成图片发送使用本机刚生成的图片文件，不允许群友指定本机文件路径外发。

### 验证
- 本机已用 low/1024×1024 实测生成成功，并保存图片到 data/generated-images。
- 通过 node --check：src/social/image-generation-skill.js、src/social/wechaty-duty-group.js、src/config.js、src/api.js、src/ui/brain-ui/app.js、src/ui/brain-ui/app-shell.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.30 - 2026-05-29

### 新增
- 尝试采集微信群成员稳定微信身份字段：成员库新增 `wechat_id`、`wxid`、`stable_key`、`raw_identity` 字段。
- 管理员识别优先级调整为：精确 sender_id > 稳定微信身份（wxid/微信号 Alias）> 当前群成员快照唯一昵称兜底。
- 对单个群成员额外尝试调用 wechat4u `batchGetContact({ UserName, EncryChatRoomId })` 拉取详情，测试是否能拿到真实微信号或 wxid。

### 修复
- 修复昵称兜底把历史旧 sender_id 也算入同名人数的问题：现在只检查当前最新群成员快照里的同名人数，避免重登后历史记录造成误判。
- 如果当前快照里出现多个同名成员，昵称兜底会拒绝授权，避免普通群友改成管理员同名后冒充。

### 实测结果
- 当前 wechat4u 在 `值班群` 中只能拿到临时 `UserName=@...`，未暴露 `wxid` 或微信号 Alias；数据库字段已保留，若后续协议/账号能返回会自动启用。

### 验证
- 通过 node --check：src/social/wechaty-duty-group.js、src/social/wechat-group-stats.js、src/social/dispatch.js、src/social/wechat-groups.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.29 - 2026-05-29

### 修复
- 修复 Wechaty 重新登录后管理员 sender_id 变化导致管理员权限失效的问题。
- 当历史已选管理员 ID 在同一个群内对应的微信昵称/群昵称与当前发言人一致时，自动识别为同一管理员并补录新的 sender_id。
- 解决管理员请求查看性格预设提示词时，程序界面已经生成内容但微信发送层仍提示 `local_file_reference_in_wechat_outbound` 的问题。

### 说明
- Wechaty Web 协议下 sender_id 可能随登录态变化；本版增加同群历史管理员昵称兜底，避免每次扫码后管理员权限丢失。
- 首次命中兜底时日志会输出 `[WechatyAdmin] 管理员 sender_id 已随登录变化，按同群昵称匹配自动补录`，之后会恢复精确 sender_id 判断。
- 普通群成员仍不能靠自称管理员绕过；必须先存在历史已选管理员记录，且在同一个群内匹配到对应昵称。

### 验证
- 通过 node --check：src/social/wechaty-duty-group.js、src/social/dispatch.js、src/social/wechat-groups.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.28 - 2026-05-29

### 修复
- 修复已验证微信群管理员仍被“本机隐私/安全黑名单”发送层拦截的问题：管理员消息在入口安全检查通过后，现在会把 `wechat_admin` 标记继续传递到 Wechaty 发送层。
- Wechaty 群消息发送层新增管理员绕过判断：只有普通群成员会触发本机文件、桌面图片、file:// 路径等外发拦截；已验证管理员按管理员权限执行。
- 优化管理员模式提示词：明确普通群成员安全边界、媒体/本机隐私拒绝话术、黑名单限制不适用于已验证管理员；管理员可以查看性格预设、微信群助手配置、安全规则摘要、记忆状态等可读内容。

### 安全边界
- 管理员绕过只基于设置页保存的微信 sender_id 精确匹配，不接受昵称、自称或群备注伪造。
- 默认仍会要求模型隐藏 API Key、Token、密码、Cookie、私钥等密钥原文，避免误把真正密钥发到微信群。

### 验证
- 通过 node --check：src/social/wechaty-duty-group.js、src/social/dispatch.js、src/social/wechat-groups.js。
- 通过 npm run test:wechat-guard。
- 通过 npm run test:wechat-record-all。

## v0.4.27 - 2026-05-29

### 修复
- 修复表情包搜索总是发送同一张的问题：表情搜索结果现在在高质量候选池中按随机种子打散，不再永远取第一张。
- 修复明确“发/来/整 表情包、斗图、梗图、GIF”等指令有时被模型文本回复的问题：Wechaty 群消息入口新增直发表情包分支，命中后直接搜索并发送图片/GIF，不再等待大模型自由发挥。
- 直发表情包仍遵守安全规则：只发送 HTTPS 公开图片/GIF，不发送本机文件，不显示 URL 文本。

### 验证
- 已验证相同关键词在不同 seed 下返回不同首图。
- 通过 npm run test:wechat-record-all。
- 通过 npm run test:wechat-guard。

## v0.4.26 - 2026-05-28

### 修复
- 彻底修复斗图仍发送裸 URL 的问题：现在同时剥离 Markdown 图片、Markdown 链接和纯 URL。
- 如果剥离 URL 后只剩一个 @ 昵称，也不会再发送文字气泡，直接发送图片/GIF。
- 新增内部剥离逻辑验证，确认 `@用户 https://...gif` 会变成纯图片发送。

### 验证
- 通过裸 URL 剥离测试。
- 通过 npm run test:wechat-record-all。
- 通过 npm run test:wechat-guard。

## v0.4.25 - 2026-05-28

### 修复
- 修复微信群斗图发送时先显示图片/GIF URL 链接的问题：现在默认隐藏 URL 文本，只直接发送图片或 GIF。
- 如果 AI 回复内容只有表情包 URL，则不再发送任何文字气泡。
- 如果 AI 同时写了自然语言说明和表情图，则只发送说明文字 + 图片，不暴露链接。
- 优化图片/GIF发送速度，图片发送改为并发投递并统计成功数量。

### 验证
- 通过 node --check。
- 通过 npm run test:wechat-record-all。
- 通过 npm run test:wechat-guard。

## v0.4.24 - 2026-05-28

### 新增
- 新增 AI 斗图表情包能力，接入慕名 API / xiaoapi 表情搜索接口。
- 新增 meme_search 工具，AI 可按“斗图、表情包、梗图、无语、鄙视、笑死、吃瓜”等请求搜索公开网络图片/GIF。
- 新增微信群助手「AI 斗图表情包」设置区，可开启/关闭、选择表情源、设置每次发送数量、冷却时间，并支持关键词测试预览。

### 安全与边界
- 仅发送 HTTPS 公开网络图片/GIF，不做微信原生表情包收藏/表情商店能力。
- 默认只允许 biaoqing.gtimg.com、tugelepic.mse.sogou.com 两类表情图域名。
- 继续禁止读取、上传、转发或描述本机文件、桌面图片、截图、相册、file:// 路径。
- API 失败时返回错误给 AI，不阻塞正常文字回复。

### 验证
- 已验证 xiaoapi meme 搜索“鄙视”可返回 GIF 图片。
- 通过 npm run test:wechat-record-all。
- 通过 npm run test:wechat-guard。

## v0.4.23 - 2026-05-28

### 修复
- 新增微信群助手掉线检测机制：登录态恢复超时、logout、连接错误、健康检查失败会自动标记为离线。
- 新增掉线提醒：离线后通过系统通知/窗口提示/SSE 状态事件提醒用户重新扫码。
- 设置页状态改为真实显示：缓存群明确显示为“不可接收 @ 消息”，不再误导为在线。
- 后端状态接口新增 connection_state 与更准确的 needs_relogin，便于前端和用户判断真实可用性。

### 说明
- 只有 online=true 且 connected 且当前进程真实解析到群，才显示“已真实连接”。
- 微信掉线后不会再把历史群缓存当作可用群消息通道。

## v0.4.22 - 2026-05-28

### 修复
- 修复微信群列表重复显示的问题：同一个微信群在 Wechaty 重新登录后可能产生多个历史 room_id，现在按群名归并，只显示一个真实群。
- 修复重复群影响微信助手 @ 回复设置、群统计与定时总结、Honcho 群记忆管理、聊天记录群选择等页面的问题。
- 已识别群接口保留 historical_ids/duplicate_count 供排查，但 UI 不再展开历史旧 ID。

### 说明
- 新增群仍不会自动开启 @ 回复，需要在微信助手中手动勾选并保存，避免误回复。

## v0.4.21 - 2026-05-28

### 统一新增微信群显示来源

- 新增 `/social/wechat-groups/known` 接口，合并 Wechaty 缓存群、成员昵称库和聊天记录库里已经识别到的群。
- 设置页“允许 @ 回复群组 / 群记忆 / 聊天记录库 / 统计与定时总结”的候选群来源统一，新增群不会再出现有的地方能看到、有的地方看不到。
- 新增群默认显示为“已识别/未开启 @ 回复”，需要你在上方勾选并保存后才会参与 @ 回复；统计/总结仍可单独勾选。
- 记录库/统计里的群 ID 统一补齐 `wechaty:` 前缀，避免同一个群因 ID 格式不同被拆成两个候选。

### 验证

- `node --check src/api.js` 通过。
- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:wechat-guard` 通过。
- `git diff --check` 通过。

## v0.4.20 - 2026-05-28

### 修复 Honcho 离线影响设置页和 LLM 模型操作

- 修复本地 Docker/Honcho 未启动时，群记忆接口反复 `fetch failed` 造成设置页请求异常、程序不稳定的问题。
- Honcho 连接失败后进入 60 秒降级冷却：微信群记忆读取/写入会跳过并返回可读错误，不再影响 LLM 模型编辑、设为当前、删除等设置操作。
- 修复 Honcho 列表异常路径里引用未定义 `session.id` 的潜在崩溃点。
- 桌面启动脚本仍会尝试启动 Honcho，但 Docker 没开时不会阻断贾维斯主程序。

### 验证

- `node --check src/social/wechat-group-memory.js` 通过。
- 本地 API 验证 LLM 模型“设为当前 / 新增测试模型 / 删除测试模型”成功。

## v0.4.19 - 2026-05-28

### 优化管理员设置：界面显示微信昵称

- 管理员设置页不再让用户直接看/填一串 sender_id；已选管理员区域改为显示微信昵称。
- 管理员搜索框改为按微信昵称搜索，不再要求用户理解 sender_id。
- 成员卡片隐藏长 ID，只显示昵称和群名；点击昵称卡片添加/取消管理员。
- 安全逻辑不降低：后台仍保存精确 Wechaty sender_id 做权限判断，昵称相同、改名或自称管理员不会误授权。

### 验证

- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `git diff --check` 通过。

## v0.4.18 - 2026-05-28

### 修复微信群发送失败重试变慢，并发处理多人 @

- 修复 Wechaty 群回复仍可能因为模型传错 `target_id` 导致工具校验失败：当当前 turn 是微信群消息时，运行时不仅覆盖真实 sender_id，还会把该真实目标临时加入本轮可发送/可见目标白名单，避免先失败再重试。
- 新增微信群 @ 并行批处理：多个群友短时间同时 @ 时，会从用户队列中一次取最多 3 条 Wechaty 群 @ 消息并行调用同一套回复逻辑、同一套性格设定和同一套安全/记忆上下文。
- 并行上限可通过环境变量 `BAILONGMA_WECHAT_PARALLEL` 调整，默认 3，最大 5，避免无限并发把模型额度或 Wechaty 发送打爆。
- 保留原有“每条消息真实 @ 提问人”的底层锁定，批量并行时每条回复仍按各自 sender_id 发送。

### 验证

- `node --check src/index.js` 通过。
- `node --check src/queue.js` 通过。
- `node --check src/capabilities/executor.js` 通过。
- 微信相关回归测试通过。

## v0.4.17 - 2026-05-28

### 修复微信群 @ 错人、管理员设置丢失和管理员保护

- 底层修复 Wechaty 群回复目标：当前 turn 是微信群消息时，`send_message` 会强制覆盖为入站消息记录的真实 `reply_mention_id/sender_id`，不再信任模型自己选择 target_id，避免把回复 @ 到被讨论的人或其他群友。
- 修复管理员模式勾选一会儿就消失：5 秒状态轮询返回的状态对象不含 admin 字段，以前会被误当成关闭管理员；现在缺失 admin 字段时不会覆盖管理员 UI 状态。
- 管理员选择 UI 新增搜索框：支持按微信昵称、群名、sender_id、群备注/联系人备注搜索成员，点击成员卡片即可加入管理员。
- 管理员保存后立即显示“已启用并生效”，并继续按精确 Wechaty sender_id 判断权限，昵称/自称管理员仍无效。
- 新增管理员保护：普通群友 @ 助手要求伤害、删除、嘲讽、暗算或绕过管理员时，会优先站在管理员一边短句回怼，不执行危险操作。
- 微信群 prompt 也注入管理员保护块，已保存管理员昵称/ID 会作为受保护对象参与回复策略。

### 验证

- `node --check src/capabilities/executor.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-archive-evidence` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `npm run test:tool-router` 通过。
- `git diff --check` 通过。

## v0.4.16 - 2026-05-28

### 修复微信群回答不查聊天记录库导致“记不完整”

- 根因确认：微信群 @ 回复 prompt 之前只注入 Honcho 长期记忆和 `conversations` 最近 100 条/24 小时，没有把 `wechat_group_activity` 全量聊天记录库作为回答证据检索，所以用户问“老登是谁/之前谁说过什么/谁让你叫他大哥”时模型会靠最近上下文或常识猜。
- 新增当前群聊天记录库证据检索：按用户问题抽取关键词、@ 对象、称呼词和身份词，在当前微信群的 `wechat_group_activity` 中检索历史流水，并附带最近消息。
- 微信群 @ 回复 prompt 新增 `<wechat-group-archive-evidence>` 证据区，明确要求遇到“之前记录/谁说过/某词是谁/称呼关系”等问题时优先使用数据库证据；查不到就说当前群聊天记录库没查到，不再编。
- 该检索严格按当前群 `group_id/group_name` 隔离，避免不同微信群之间串记忆。
- 新增 `test:wechat-archive-evidence`，覆盖“老登是谁”可以从本机聊天记录库检索到历史消息，并确认 prompt 已注入证据。

### 验证

- `npm run test:wechat-archive-evidence` 通过。
- 真实数据库抽查通过：对 `PT站看片狂魔小群` 查询“老登是谁”能从 `wechat_group_activity` 找到 14:16、18:00、18:11 等相关历史证据。

## v0.4.15 - 2026-05-28

### 修复微信群聊天记录页“不更新”的误判与真实刷新缺陷

- 排查确认：Wechaty 当前在线并持续收到群消息，`wechat_group_activity` 数据库也在持续写入；用户看到的“已入库 16 条、最新 14:45:41”实际对应另一个当前查看群，不是正在刷屏的 `PT站看片狂魔小群`。
- 修复真实 UI 缺陷：聊天记录库的“结束时间”以前只在打开设置页时固定一次，页面长开后新消息会被旧 `to` 时间过滤，看起来像“不更新”；现在默认结束时间会在每次查询前自动跟随当前时间。
- 聊天记录库新增“查看群组”下拉框，用户可以直接切换要看的微信群，不再只能依赖左侧 Honcho 记忆群选择，避免选错群导致误判。
- 设置页停留在“微信群助手”时，自动刷新逻辑现在会同步刷新聊天记录库，不再只刷新统计榜单。
- 记录摘要新增“当前查看群”和“DB 最新入库时间”，方便快速判断：是当前群没新消息、时间筛选卡住、还是数据库真的没写入。
- API `/social/wechat-groups/records` 返回 `latest_record`，用于前端显示当前群最新入库消息时间；测试覆盖聊天记录 latest_record。

### 验证

- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/social/wechat-group-stats.js` 通过。
- `npm run test:wechat-record-all` 通过。
- Browser 烟测通过：打开 `brain-ui.html?verify=0415b`，确认更新说明显示 v0.4.15，聊天记录库出现“查看群组”下拉框；默认第一群显示 16 条，切换到 `PT站看片狂魔小群` 后显示 514 条并展示最新入库时间。

## v0.4.14 - 2026-05-28

### 修复微信群重复回复和内部结束语外发

- 修复微信群里同一条 @ 后连续回复多条的问题，典型表现为先正常回答，然后又发“已经回复过了”“回复完毕”“本轮结束”等内部状态。
- 根因：主 LLM 在 `send_message` 成功后仍会进入下一轮工具循环，提示词里的“如果还需要可以继续 send_message，否则结束”被部分模型理解成需要再发一条状态确认；一旦后续循环卡住触发 watchdog，还可能把已经回复过的消息重新排队，造成重复外发。
- 微信群 @ 回合现在启用“一次成功发送即结束”：`send_message` 成功后本轮立即停止，不再让模型继续生成“已回复/无需补充”之类状态。
- 出站保护扩展：微信群回复内容如果是“已回复/回复完毕/发送完毕/无需补充/本轮结束”等内部状态，会被 `send_message` 拦截，不能发到群里。
- fallback 保护扩展：如果模型没调用 `send_message` 却输出内部完成状态，运行时会直接丢弃，不再兜底投递到微信群。
- 失败重试保护：如果本轮已经成功 `send_message`，后续 LLM 报错/超时不会重新排队该消息，避免“已经回复了还又答一遍”。

### 验证

- `node --check src/llm.js` 通过。
- `node --check src/index.js` 通过。
- `node --check src/capabilities/executor.js` 通过。
- `npm run test:tool-router` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.13 - 2026-05-28

### 清理后台内部 skip 日志显示

- v0.4.12 已经修复 `skip_recognition/skip_consolidation` 循环熔断；本版本继续清理“单次后台 skip 日志”造成的误解。
- `callLLM()` 新增 `suppressToolLogs`，后台记忆识别器/整合器执行内部协议工具时不再输出 `[工具调用] skip_recognition` / `[工具结果] skip_recognition`。
- 记忆识别器日志从“显式跳过”改为“无需写入记忆”，避免把正常的“没有要存的长期记忆”显示成跳过用户消息。
- 记忆整合器日志从“显式跳过”改为“无需整理”。
- TICK 心跳如果只调用 `set_tick_interval`、UI 状态更新等运行时工具，不再进入记忆识别器，减少空闲状态下的无意义后台 LLM 调用。

### 验证

- `node --check src/llm.js` 通过。
- `node --check src/index.js` 通过。
- `node --check src/memory/recognizer.js` 通过。
- `node --check src/memory/consolidator.js` 通过。
- `npm run test:tool-router` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.12 - 2026-05-28

### 彻底修复后台一直“跳过识别/跳过整理”

- 修复 v0.4.11 后仍能在日志里看到 `skip_recognition` 连续刷屏、并最终触发 tool loop 熔断的问题。
- 根因：记忆识别器/整合器把 `skip_recognition`、`skip_consolidation` 当作“任务结束”的内部协议工具，但通用 LLM 工具循环在工具返回后还会继续问模型下一步，部分模型会重复调用同一个 skip 工具直到熔断。
- `callLLM()` 新增 `maxToolRounds` 和 `stopAfterTools` 选项；主聊天不受影响，后台记忆识别/整合可以声明遇到内部终止工具后立刻结束。
- TICK 心跳没有实际工具动作时不再送入记忆识别器，避免把“安静等待/没有主动行动”这类运行时闲聊存成识别任务。
- 内部记忆工具不再写入 `action_logs` / `tool_audit`，前端思考流也会隐藏这些内部协议工具，避免用户看到“跳过识别”误以为助手不处理消息。
- 当前排查确认：微信群助手若处于 `starting/qr_ready` 非在线状态，群里的 @ 不会进入程序；已强制切到重新扫码状态，扫码登录后才能恢复群消息监听。

### 验证

- `node --check src/llm.js` 通过。
- `node --check src/index.js` 通过。
- `node --check src/memory/recognizer.js` 通过。
- `node --check src/memory/consolidator.js` 通过。
- `node --check src/capabilities/executor.js` 通过。
- `npm run test:tool-router` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.11 - 2026-05-28

### 修复一直“跳过识别”不回复

- 修复微信群真实 @ 消息偶发被主对话模型调用 `skip_recognition` 跳过的问题。
- 根因：`skip_recognition` 是记忆识别器内部工具，但它会进入 action log；工具路由器又会把最近 action log 里的工具“保活”进下一轮主对话，导致主模型把真实用户消息误当成“记忆识别任务”来跳过。
- 现在主对话工具注入会强制过滤记忆识别/整理内部工具：`skip_recognition`、`skip_consolidation`、`merge_memories`、`downgrade_memory`、`upsert_memory`。
- 注入给主模型的 recent action log 也会过滤这些内部工具，避免“最近一直 skip”的历史状态继续污染判断。
- 微信群 @ fallback 扩展拦截“已回复/无需补充/对话结束”等错误兜底文本，避免把内部判断原样发到群里。

### 验证

- 新增 `npm run test:tool-router`。
- `npm run test:tool-router` 通过，覆盖 action log 中的 `skip_recognition/upsert_memory/merge_memories` 不会注入主对话。
- `node --check src/index.js` 通过。
- `node --check src/memory/injector.js` 通过。
- `node --check src/memory/tool-router.js` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.10 - 2026-05-28

### Wechaty 启动卡住自恢复修复

- 修复程序重启后 Wechaty 可能长时间停在 `starting`，导致群消息无法进入程序、聊天记录库自然也无法继续入库的问题。
- 新增 60 秒启动看门狗：如果启动后没有拿到二维码、登录事件或真实在线状态，会自动重启 Wechaty 连接。
- 设置页/接口点击“登录/恢复微信”时，如果当前只是卡在 `starting` 且没有二维码，不再误判为已经在运行，而是走重启恢复链路。
- 这个修复和 v0.4.9 的“收到消息必入库”配合，保证两层都稳定：先确保 Wechaty 能恢复连接，再确保收到的消息不被统计开关拦截。

### 验证

- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/api.js` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.9 - 2026-05-28

### 微信群聊天记录库持续入库修复

- 修复“聊天记录库不更新 / 某些群不记录”的问题。
- 根因：聊天记录库复用了“群统计与定时总结”的 `selectedGroups` 开关；如果某个群没有被勾选为统计/日报群，原始聊天流水也会被跳过。
- 现在已拆分逻辑：微信群原始聊天记录只要程序运行并且 Wechaty 收到群消息，就会强制写入本机 SQLite `wechat_group_activity` 表。
- “群统计与定时总结”的群组勾选只控制排行榜展示、阶段总结和每日 00:00 自动发送，不再影响原始聊天记录入库。
- 非微信群助手接入群现在只做本地聊天记录入库，不进入 Honcho 长期记忆、大模型和自动回复链路，避免误打扰。

### 数据安全说明

- 修复前已用 SQLite `.backup` 给当前用户数据做了备份：`~/Library/Application Support/Bailongma/data/backups/jarvis-before-record-all-*.db`。
- 本机当前 Electron 数据库为 `~/Library/Application Support/Bailongma/data/jarvis.db`；修复时查询到 `wechat_group_activity` 共有 479 条记录，并未被删除。
- 截图里显示 16 条，是当前页面选中群和时间筛选范围下的结果；同库里 `PT站看片狂魔小群` 仍有 435 条记录。

### 验证

- 新增 `npm run test:wechat-record-all`，验证未勾选统计群时普通写入会被统计开关拦截，但 `force: true` 的聊天记录库入库必须成功。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `npm run test:wechat-record-all` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.8 - 2026-05-28

### 微信群 @ 回复目标链路热修复

- 修复 v0.4.7 新增的 `wechaty:room:<room>:member:<member>` 回复目标在分发层没有正确解析的问题。
- 现在 `parseSocialTarget()` 会把 room/member 分开解码，真正发送时使用正确的微信群 room_id。
- `dispatchSocialMessage()` 会把 target_id 中的 member_id 作为兜底 mentionId，避免模型只传 target_id 时丢失 @ 对象。
- 保留“只按当前群成员 contact.id 精确 @，找不到就不 @”的策略，宁可不 @ 也不 @ 错到主人、管理员或上一位成员。

### 验证

- 新增 `npm run test:social-targets`，覆盖 Wechaty 群目标解析：旧格式、新编码格式、带成员格式。
- `node --check src/social/targets.js` 通过。
- `node --check src/social/dispatch.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `npm run test:social-targets` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.7 - 2026-05-28

### 微信群 @ 回复对象修复

- 修复微信群里“被 @ 后回复时总是 @ 错人 / @ 到管理员 / @ 到上一位成员”的问题。
- 现在每条群消息都会生成专属回复目标，按当前提问人的 sender_id / sender_name 精确回复。
- 发送时优先在当前群成员列表里按 contact.id 精确找人，找不到就不模糊猜测，宁可不 @ 也不 @ 错。
- 群消息 prompt 里会明确写出“本轮必须回复当前提问人”，降低 LLM 选错 target_id 的概率。

### 记忆说明

- 聊天记忆不是把整个数据库全量塞给模型。
- 每轮只注入：当前群的长期记忆、当前成员记忆、最近 24h 群聊流水、群内摘要、关键词召回、任务/上下文相关记忆。
- 全量群聊天记录仍保存在 SQLite，用于筛选、统计、导出和回溯，但不会把所有历史一次性塞进上下文。

### 验证

- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/social/dispatch.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

## v0.4.6 - 2026-05-28

### LLM 模型池

- 新增多 LLM Profile 配置，不再只能保存一个 `provider/apiKey/model/baseURL`。
- 旧单模型配置会自动迁移为模型池第一项，保留当前模型、API Key 和自定义端点信息。
- 设置页 `LLM 模型` 改造为：当前模型条、自动切换策略、新增/编辑模型、模型池优先级列表。
- 每个模型配置支持名称、Provider、模型、API Key、自定义 Base URL、启用/关闭、编辑、删除、上移/下移、设为当前。
- 前端和 `/settings` API 不返回明文 API Key，只显示“已配置”和尾号提示。

### 自动故障切换

- 新增自动切换策略，默认开启。
- 当前模型出现额度不足、余额不足、限流、认证失败、模型不可用、服务端 5xx、网络超时等错误时，会按模型池优先级切换到下一个可用模型。
- 只在回答尚未输出任何内容时切换；如果已经流出内容，则不强行重试，避免回复重复、语音播报断裂或内容拼接错乱。
- 失败模型会记录 `lastError/lastFailedAt/cooldownUntil` 并进入冷却期，冷却期内优先跳过，避免持续打到没额度的模型。
- 主界面 SSE 会显示“当前模型不可用，正在无缝切换到备用模型”的状态提示。

### API / 兼容性

- 新增 `POST /settings/llm-profile`：新增或更新模型配置。
- 新增 `POST /settings/llm-profile/select`：立即切换当前模型。
- 新增 `POST /settings/llm-profile/delete`：删除模型配置，至少保留一个。
- 新增 `POST /settings/llm-failover`：保存自动切换开关、失败冷却时长、最多尝试模型数。
- `/settings` 返回 `llm.profiles`、`llm.activeProfileId`、`llm.failover`，用于设置页真实展示当前状态。
- 原 `/activate` 和 `/settings/model` 仍保留，旧激活流程会写入模型池并设为当前。

### 验证结果

- `node --check src/config.js` 通过。
- `node --check src/llm.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/index.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后需要重启白龙马/Electron，让新的 LLM 模型池和故障切换逻辑加载。
- 进入 `设置 -> LLM 模型`，建议至少配置 2 个启用模型：一个主力模型、一个备用模型。
- 如果某个模型已经没额度，可以保留在模型池中；它失败后会自动进入冷却，系统会优先使用备用模型。
- 自定义端点仍要求 OpenAI 兼容 `/chat/completions` 接口。

## v0.4.5 - 2026-05-28

### 核心修复

- 修复微信群多人同时 @ 时，后来的 @ 会覆盖前一条待回复消息的问题。
- 队列层新增微信群 @ 排队模式：`noPrune` 防止同群旧消息被删除，`noPreempt` 防止新 @ 打断正在回复的用户消息；后台任务仍可被用户消息抢占。
- 修复用户看到“前一个问题不回复/被吞”的根因：同一微信群以前共用 `fromId=wechaty:room:<roomId>`，队列按 `(fromId, channel)` 去重导致旧消息被删。

### 多群统计与排行榜

- 群统计页新增“查看当前群 / 已选统计群总览”切换。
- 多群总览会把已勾选参与统计/定时总结的群一起展示，总卡片显示总消息、总参与、图片、表情、链接和装逼次数。
- 多群排行榜每一行都会显示来源群名，避免多个群合并后不知道排行来自哪个群。
- 新增“按群拆分”概览，每个群单独显示消息数、参与人数、图片/表情/链接数量。
- 设置页打开并停留在“微信群助手”时，统计榜单每 12 秒自动刷新一次；保存统计群组后也会立即刷新。

### 管理员模式

- 新增“管理员模式（精确微信 ID）”设置面板。
- 管理员只按 Wechaty `sender_id` 精确识别，不看昵称、不看群备注、不接受“我是管理员”这类自称，防止群成员改名越权。
- 新增成员 ID 列表：可从最近识别到的群成员里点选加入管理员，避免手填错 ID。
- 管理员 @ 时会跳过微信群黑名单；普通成员仍然严格执行黑名单拒绝危险电脑/账号/资金/隐私类指令。
- 管理员消息会在日志里标记 `WechatyAdmin`，便于排查是谁触发了高权限请求。

### API / UI

- 新增 `GET /social/wechat-groups/members`，返回已识别群成员昵称、群名、sender_id、last_seen，用于管理员设置。
- 设置页群统计标题会明确显示当前查看的是哪个群，或正在看几个群的总览。
- 多群最近记录里会显示“成员 · 群名”，避免跨群聊天内容混淆。
- UI 继续保持 Brain UI 暗色玻璃风格，管理员区使用警示色但不破坏整体布局。

### 验证结果

- `node --check src/config.js` 通过。
- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `node --check src/social/wechat-clawbot.js` 通过。
- `node --check src/social/wechat-group-digest.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后需要重启白龙马/Electron，让队列和 Wechaty 连接器加载新逻辑。
- 管理员 ID 建议从设置页成员列表点击添加，不建议凭昵称手填；微信昵称、群昵称、备注名都不是管理员凭据。
- 多群统计只统计“群统计与定时总结”里已勾选并保存的群，未勾选群不会入库也不会参与总览。



## v0.4.4 - 2026-05-28

### 修复内容

- 修复重新登录并重新发送消息后，排行榜和聊天记录库仍显示“未知成员”的问题。
- 昵称刷新不再只依赖 Wechaty 的 `room.alias()` / `contact.name()`，改为直接调用 wechat4u 的 `batchGetContact` 拉取群成员 `NickName` / `DisplayName`。
- 新增 `POST /social/wechaty-duty-group/refresh-members`，可以强制刷新当前已接入群的成员昵称映射。
- 修复微信群重新扫码后 room_id 改变导致统计断层的问题：统计/聊天记录查询会按群名合并旧 room_id 和新 room_id 的记录。
- 修复统计群组选择保存旧 room_id 后，新 room_id 收到消息可能不再入库的问题：后端会用旧记录中的群名映射识别同一个群。

### UI 优化

- “微信群聊天记录库”顶部按钮升级为主操作按钮 + 辅助按钮，不再是粗糙的一排普通按钮。
- 新增“今天”快捷按钮，一键把筛选范围设为当天。
- 新增“刷新昵称”按钮，在线时可手动触发群成员昵称刷新并回填旧记录。
- 筛选区输入框高度、间距和日期控件宽度优化，避免只显示小黑块看不清。
- 在聊天记录库中加入说明：聊天记录库是原始流水账，群记忆管理是 Honcho 长期记忆/结论，两者用途不同。

### 验证结果

- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。
- 本机实测强制刷新成员昵称返回：`rooms=3, members=59, named=59`，值班群成员“风/小号/移动小号”等昵称已写入映射表，旧记录已回填显示“风”。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 微信助手真实在线后，进入“微信群聊天记录库”点击“刷新昵称”即可强制回填。
- 升级前旧记录如果当时的 sender_id 已因微信重新登录变化而无法对应新成员，只能保持“未知成员”；后续新消息会正常写入昵称。


## v0.4.3 - 2026-05-28

### 大版本补强：微信群聊天记录库

- 新增“微信群聊天记录库”可视化面板，位置：`设置 -> 微信群助手 -> 群统计与定时总结` 下方。
- 按当前选中的群组展示本机 SQLite 已入库的全量聊天记录，不再只看最近统计摘要。
- 记录列表显示完整时间格式 `YYYY-MM-DD HH:mm:ss`，并显示当前筛选条件下的已入库消息总数、当前显示数量、参与人数、图片/表情/链接数量。
- 支持按开始时间、结束时间、消息类型（文字/图片/表情/链接/混合）和关键词筛选聊天记录。
- 聊天记录中成员名优先使用微信群昵称/群备注/微信备注/微信昵称映射；如果旧记录只有 Wechaty 内部 ID，会在微信助手真实在线并刷新群成员后自动补齐。
- 排行榜、最近记录、聊天记录库统一读取 `wechat_group_member_names` 昵称映射，避免已知成员继续显示 `@a5a383...` 这类内部 ID。

### 媒体记录与导入导出

- Wechaty 收到图片、表情、音频、视频、附件等媒体消息时，会尝试保存到本机数据目录 `data/wechat-media/`。
- 聊天记录库会显示“本地媒体已保存”标记；图片可以在设置页直接预览，音视频可用控件播放，其他附件可打开查看。
- 新增 JSON 导出：包含记录、统计范围、昵称字段，以及已保存媒体文件的 base64 备份。
- 新增 CSV 导出：适合表格查看，包含时间、群名、成员昵称、成员 ID、类型、内容、图片/表情/链接/装逼统计等列。
- 新增 JSON 导入：可恢复聊天记录，并恢复 JSON 备份中的媒体文件；重复记录会跳过，避免重复导入刷屏。
- 新增安全媒体读取接口：只允许读取本机数据目录下已入库的相对媒体路径，拒绝 `..`、绝对路径和本机任意文件访问。

### 修复与体验优化

- 修复 `datetime-local` 结束时间只有分钟没有秒时，最后一分钟记录可能被排除的问题。
- 类型筛选改为按计数列判断：例如图片筛选会包含“图片 + 文字”的混合消息，不会因为 `message_type=mixed` 被漏掉。
- 导入 JSON 时会同步导入媒体文件，不再只导入文本记录。
- 统计 API 返回真实数据库路径，方便确认数据实际写入位置。

### 验证结果

- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后必须重启白龙马/Electron，让 Wechaty 监听进程和新 API 路由加载新代码。
- 进入 `设置 -> 微信群助手`，确认微信助手真实在线，并在“统计/定时总结群组”里勾选需要记录的群组并保存。
- 只有保存之后收到的新群消息才会进入聊天记录库；升级前未记录的历史消息无法从微信自动补抓。
- 旧统计行如果只有内部 ID，必须等微信助手在线并成功读取群成员信息后才会逐步显示微信昵称。


## v0.4.2 - 2026-05-28

### 修复内容

- 修复微信群统计排行榜里显示 `@a5a383...`、`@03ee...` 等 WeChaty 内部联系人 ID 的问题。
- 排行榜姓名来源改为优先读取微信群内昵称，其次读取微信备注/别名，再读取微信昵称，最后才兜底为“未知成员”。
- Wechaty 接入目标群或收到群消息后，会在后台刷新群成员列表，把旧统计表 `wechat_group_activity.sender_name` 中的内部 ID 自动回填为真实昵称。
- 排行榜聚合逻辑改为按 `sender_id` 合并，避免同一个人因为“旧内部 ID + 新昵称”被拆成两个人。
- 最近统计记录、链接列表和日报重点线索同步清洗成员名，避免继续把内部 ID 展示到 UI 或群总结里。

### 验证结果

- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 微信群助手保持登录后，进入已勾选群或群里有新消息时会自动刷新成员昵称并回填旧排行榜。
- 如果某个成员从未出现在当前 Wechaty 可解析的群成员列表中，旧数据会暂时显示“未知成员”；等该群成员信息刷新成功后会自动补齐。



## v0.4.1 - 2026-05-28

### 修复内容

- 群统计与定时总结新增“选择参与统计/定时总结的群组”区域。
- 未在该区域手动勾选并保存的群，不会写入本地统计库，也不会自动发送阶段总结或每日统计，避免误发到所有群。
- 定时总结调度现在只遍历 `wechatGroupDigest.selectedGroups` 中的群组；没有选择群时直接跳过。
- Wechaty/ClawBot 收到群消息时，只有命中已选择统计群组才写入 `wechat_group_activity`。

### 数据可见性

- 统计面板新增“统计数据位置”说明：群统计数据存放在本机 SQLite `data/jarvis.db` 的 `wechat_group_activity` 表。
- 统计面板新增“本地统计库最近记录”，可直接看到最近写入的统计消息、类型和图/表情/链接/装逼计数。
- 明确 Honcho 群记忆管理显示的是 Honcho session/长期结论，不是本地统计表，所以两个区域的数据不会完全一样。

### Honcho 记忆展示

- Honcho 详情页固定显示“群组长期记忆”和“成员长期记忆”两个分区，即使暂无结论也显示空状态说明。
- 历史英文内部协议误回复在 Honcho 原始消息展示和上下文注入中被隐藏，避免继续污染群记忆和模型上下文。

### 验证结果

- `node --check src/config.js` 通过。
- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/social/wechat-group-digest.js` 通过。
- `node --check src/social/wechat-group-memory.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/social/wechat-clawbot.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 进入 `设置 -> 微信群助手 -> 群统计与定时总结`，先勾选要统计/要发总结的群，再点击“保存总结设置”。
- 保存后，后续新收到的群消息才会进入统计；升级前或保存前的消息不会自动补录。


## v0.4.0 - 2026-05-28

### 大版本更新：微信群全量统计与定时总结

- 新增微信群全量活动统计，不再只关注 @ 助手的消息：所有已接入群里的文字、图片、表情/表情包、链接/小程序都会写入专用统计表。
- 新增 5 类排行榜：发言排行榜、发图排行榜、表情排行榜、链接排行榜、装逼排行榜。
- “装逼排行榜”采用启发式关键词统计（如“拿捏/吊打/遥遥领先/不是我吹/基操/凡尔赛”等），用于群娱乐统计，不作为严肃评价。
- 新增定时总结调度：支持阶段总结（30 分钟/1 小时/3 小时/6 小时/12 小时/每天一次）和每日 00:00 群聊日报。
- 定时总结写入去重表，避免同一个群同一个时间段重复发送。
- 支持设置页手动“立即发本群总结”，方便验证群消息通道和日报内容。

### 设置页可视化

- 微信群助手页新增“群统计与定时总结”面板。
- 可视化配置：启用/关闭自动总结、选择阶段总结间隔、设置每日统计时间、分别开关发言/发图/表情/链接/装逼排行榜。
- 当前群展示今日统计卡片：消息数、参与人数、图片、表情、链接、装逼次数。
- 当前群展示排行榜卡片，排版与现有 Brain UI 暗色玻璃风格保持一致。

### 稳定性与安全修复

- 修复微信群里偶发回复英文内部协议文本 `I did not actually call the required tool...` 的严重问题。
- 主循环兜底现在使用微信群原始 `user_text` 判断是否真的需要工具，不再用构造后的完整 prompt 误判。
- 即使模型输出内部工具协议文本，也会替换为中文安全兜底，不再把内部执行状态暴露到群里。
- Wechaty / ClawBot 入队时都会携带原始用户文本，方便主流程做正确兜底判断。
- 群消息统计写库失败不会中断微信群 @ 回复主流程。

### Honcho 成员记忆展示修复

- Honcho 成员长期记忆读取不再只依赖 `session.peers()`；会从群消息 metadata 的 `sender_id / sender_name` 反推当前群成员 peer。
- 成员长期记忆区域更稳定，适合查看“某成员在某群里的称呼、偏好、身份”等按群隔离记忆。
- 对图片/表情/XML 结构化消息做展示清洗，设置页不再被大段微信 XML 污染。

### 验证结果

- `node --check src/social/wechat-group-stats.js` 通过。
- `node --check src/social/wechat-group-digest.js` 通过。
- `node --check src/index.js` 通过。
- `node --check src/config.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/social/index.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/social/wechat-clawbot.js` 通过。
- `node --check src/social/wechat-group-memory.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 进入 `设置 -> 微信群助手`，确认上方群组已勾选并保存。
- 在“群统计与定时总结”中按需要开启阶段总结、每日统计和排行榜项；默认每日统计时间为 `00:00`。
- 群消息统计只记录白龙马真实接入后收到的消息；升级前历史群聊不会自动补录。


## v0.3.10 - 2026-05-28

### 修复内容

- 修复微信群助手性格预设点击后自动跳回“自定义性格”的问题：状态轮询不再用缺失的 `personaPrompt` 覆盖当前编辑区。
- 性格设定区域新增独立按钮“保存性格并生效”，不再要求用户回到上方找总保存按钮。
- 保存性格时会同步保存 `personaPresetId`，保存成功后状态条立即显示当前性格“已生效”。
- 保留上方“保存并生效”用于群组选择；性格区按钮专注保存性格，交互更直观。

### 记忆展示增强

- Honcho 群记忆详情拆分为“群组长期记忆”和“成员长期记忆”两个独立区域。
- 成员长期记忆说明为：仅在当前微信群内对对应成员生效，会和群组记忆一起参与匹配，但不会串到其他群。
- 成员记忆卡片使用独立样式，便于区分“本群公共规则”和“某个群成员的称呼/身份偏好”。

### 改变原因

- 用户反馈点击“幽默社交助手”等预设后会自动跳到自定义性格，这是轮询覆盖造成的真实 bug。
- 用户反馈性格区缺少明显保存按钮，保存后需要立即看出已生效。
- 用户要求新增的成员记忆必须和群组记忆一样可视化展示，并明确它仅在当前群组内可用。

### 验证结果

- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 进入 `设置 -> 微信群助手`，点击任一性格卡片后应保持在该卡片并显示“待保存”；点击“保存性格并生效”后应显示“已生效”。
- 在 Honcho 群记忆管理里刷新某个群，应能分别看到群组长期记忆和成员长期记忆。


## v0.3.9 - 2026-05-28

### 新增/修复

- Wechaty 群回复现在会识别公开网络图片 URL 和 Markdown 图片，例如 `![meme](https://example.com/a.webp)` 或 `https://example.com/b.jpg`，并用 `FileBox.fromUrl` 作为图片发送到微信群。
- 出站发送前新增本机文件引用拦截：如果回复内容包含 `file://`、`/Users/`、`~/`、Windows 本地盘符、桌面/下载/相册/截图等本地文件语义，会直接拒绝发送，避免把本机文件或路径发到群里。
- 图片发送只允许 `http/https` 且后缀为 png/jpg/jpeg/gif/webp 的公开网络图片，单条最多发送 3 张。
- `test:wechat-memory` 增加公开网络图片 URL 提取测试。

### 验证结果

- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-memory` 通过。
- 完整 v0.3.8 检查集继续通过。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 公开网络图片可以作为图片发送；本机文件、桌面图片、截图、相册、file:// 路径仍会被拒绝。


## v0.3.8 - 2026-05-28

### 新增内容

- 微信群 prompt 增加网络梗提示：`v我50 / V我50 / vw50 / 疯狂星期四` 会按中文互联网梗理解，不再误判成站点、种子编号或需要查文件。
- 明确微信群媒体边界：允许理解、搜索和发送公开网络图片/表情包链接；禁止读取、上传、转发或描述本机文件、桌面文件、file:// 路径、截图、相册和私有图片。
- 性格设定 UI 新增明显的“当前生效性格 / 已生效 / 有未保存修改”状态条，并加入“自定义性格”卡片。
- 配置中保存 `personaPresetId`，设置页能区分正在使用预设还是自定义提示词。
- 新增群成员显式记忆抽取：当群成员 @ 助手说“以后叫我大哥 / 我是你大哥 / 我叫xxx”时，会即时写入 Honcho 成员记忆和群组记忆。
- 新增 `npm run test:wechat-memory`，覆盖称呼/身份记忆抽取与网络梗提示。

### 修复/改进

- 避免“谁是你大哥”这类后续问题只能依赖异步 Honcho 总结；现在明确称呼/身份偏好会同步写入长期结论。
- 群聊回复更适合接梗：遇到 vw50 这类短梗时会优先轻松接话，而不是要求对方补充站点信息。
- 安全黑名单补充本机图片外发表达：例如“把本机图片发群里”“上传桌面图片给大家”会被拒绝；但“找一张公开网络表情包链接”允许。

### 改变原因

- 用户反馈群友说网络梗时助手不理解，例如 `vw50` 被误判成需要查询站点/图片信息。
- 用户要求图片能力边界更符合人类使用：可以发网络找到的图和表情包，但不能向微信群发送任何本机文件。
- 用户反馈性格设定不够明显，不知道当前到底哪个性格生效。
- 用户反馈已有记忆系统仍不能记住“叫我大哥”这类明确指令，需要即时、按群隔离、按成员分类写入长期记忆。

### 验证结果

- `node --check src/config.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `node --check src/social/wechat-group-memory.js` 通过。
- `node --check src/social/wechat-memory-extractor.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/social/wechat-clawbot.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run test:wechat-guard` 通过。
- `npm run test:wechat-memory` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后重启白龙马/Electron。
- 进入 `设置 -> 微信群助手`，性格设定区域会显示当前生效性格；编辑后如果没保存会显示“有未保存修改”。
- 在微信群测试：`@助手 今天vw50` 应按梗回复；`@助手 以后叫我大哥` 后，再问 `@助手 谁是你大哥` 应优先从当前群 Honcho 记忆回答。
- 网络图片/表情包可以用公开链接；任何本机图片、桌面文件、截图、相册都不允许外发。


## v0.3.7 - 2026-05-28

### 紧急修复

- 修复微信群安全黑名单漏拦截“查看桌面有啥文件 / 桌面有啥文件 / 列一下下载目录 / 打开 xlsx 表格看看”这类本机文件盘点请求的问题。
- 新增 `local_file_inventory` 规则：禁止微信群成员远程查看、列出、读取、搜索或打开机主电脑上的桌面、下载、文档、项目目录和具体文件。
- 新增 `local_system_inventory` 规则：禁止微信群成员远程盘点机主电脑的系统版本、软件列表、窗口、进程、网络、硬件或运行状态。
- 扩展凭证规则，补上“把 .env 发群里”这类敏感对象在前、发送动作在后的表达。
- ClawBot 群聊路径也接入同一个安全守卫，避免只有 Wechaty 路径拦截、另一路径绕过。

### 改变原因

- 用户截图显示，群成员 @ 后要求“查看桌面有什么文件”，助手没有触发安全黑名单，反而回复了疑似本机桌面文件列表。
- 原规则覆盖了删除、执行命令、上传隐私、读取密钥等高危动作，但没有把“只查看/列目录/盘点本机文件”单独归为禁止行为，这是致命遗漏。

### 验证结果

- `node scripts/test-wechat-command-guard.mjs` 通过。
- `npm run test:wechat-guard` 通过。
- `node --check src/social/wechat-command-guard.js` 通过。
- `node --check src/social/wechat-clawbot.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后必须重启白龙马/Electron，让微信群监听进程加载新的安全规则。
- 重启后在微信群测试 `@助手 查看桌面有啥文件`，应该直接回复安全拒绝，不应进入大模型自由回答。
- 本次修复不影响正常的群聊问答、技术讨论、群总结、群知识库写入。


## v0.3.6 - 2026-05-28

### 新增内容

- 微信群助手「性格设定」新增 3 个可视化预设卡片：主人数字分身、技术值班助手、幽默社交助手。
- 预设支持一键套用到提示词输入框，再由用户手动微调；点击预设不会立即改变线上行为，仍需点击“保存并生效”。
- 设置页新增“恢复默认”按钮，可快速回到默认主人数字分身风格。
- `/settings/social` 返回 `wechatyPersonaPresets`，前端动态渲染预设，后续扩展更多预设不需要改页面结构。

### 修复/改进

- 重新筛选用户提供的其他项目微信数字人提示词，移除不适用于当前项目的网页微信、wx.qq.com、DOM 读取、browser_evaluate、浏览器轮询发送、last_message_key 等流程描述。
- 预设提示词明确适配当前 Wechaty + Honcho 架构：@ 判断依赖 Wechaty 消息元数据，群记忆依赖 Honcho，不再引导模型使用浏览器脚本或旧项目 memory 流程。
- 预设中保留群聊短句、口语化、技术准确、文字表情、安全边界等有价值部分；危险电脑操作仍由安全黑名单强制兜底，性格设定不能绕过。
- UI 增加当前匹配状态：完全等于某个预设时显示“已套用”，手动改动后显示“自定义提示词”。

### 改变原因

- 用户希望把微信群助手性格设定做成几个可选预设，而不是每次手写大段提示词。
- 用户提供的参考提示词来自另一个通过网页微信 DOM 操作的项目，如果直接照搬会误导当前 Wechaty 版小白龙，所以本版本只保留人格、风格和安全边界，删除不适用执行流程。

### 验证结果

- `node --check src/config.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `git diff --check` 通过。

### 部署注意事项

- 更新后重启白龙马/Electron，进入 `设置 -> 微信群助手`。
- 在「微信群助手性格设定」里点击一个预设，按需要修改文本，再点击“保存并生效”。
- 如果之前已经写过自定义性格，本版本不会自动覆盖；只有点击预设或恢复默认才会改输入框内容。
- 预设只影响回复风格和边界，不影响群组勾选、微信登录态、Honcho 记忆和安全黑名单。


## v0.3.5 - 2026-05-28

### 新增内容

- 新增微信群助手「性格设定」输入框：可在设置页手动填写微信群回复的人设、语气、边界和提示词，保存后会直接注入微信群大模型 prompt。
- 新增 Honcho 群记忆管理器：按微信群独立展示，不再只显示第一选中群的一小段预览。
- 群记忆详情分为三块：Honcho 原始消息记录、Honcho 自动摘要、Honcho 长期结论/知识。
- 支持手动给某个微信群添加一条长期记忆，写入 Honcho conclusion；适合写群规、值班要求、项目背景、群成员偏好等。
- 支持删除单条 Honcho 结论记忆，支持清空整个本群 Honcho session。原始消息不假装支持单条删除，因为当前 Honcho SDK 未公开单条 message delete。
- 扩展微信群安全隔离规则库到 17 类：文件破坏、批量文件改写、系统权限、终端执行、下载运行、凭证读取、隐私外传、网络上传、桌面/浏览器控制、摄像头麦克风屏幕、账号安全、支付金融、微信管理、群发骚扰、进程持久化、破坏性 Git、绕过安全等。
- 安全黑名单 UI 改为详细卡片，显示规则 ID、严重程度、解释、示例和安全替代方案；明确不包含逆向和成人内容过滤。

### 修复/改进

- Honcho 默认本地配置改为默认启用：没有显式关闭时使用 `http://127.0.0.1:8018` 与 `bailongma-local-honcho`，避免设置页显示配置了但后端不读。
- 群记忆 API 增加概览、详情、手动新增、删除结论、清空 session，并加本地/Token 访问校验，避免群聊记忆接口暴露给非本机来源。
- 设置弹窗扩大到 1080x820，微信群助手、Honcho 记忆和安全规则不再挤在过小区域里。
- 保存微信群选择时不再只读取当前搜索过滤后可见的 checkbox；过滤列表外已勾选的群会被保留，避免误取消。
- Honcho 写入群消息/助手回复后会主动 scheduleDream，帮助后台尽快沉淀长期结论。

### 改变原因

- 用户反馈“看不到记录记忆，Honcho 记忆库没有任何显示”，旧版只做了一个非常弱的单群预览，不能直观看到按群隔离的记忆状态。
- 用户要求微信群助手能手动设置性格/提示词，并且安全隔离限制词库要真正写完、开发完成、符合现有 UI。
- 用户明确要求不启用本地记忆兜底，因此本版本仍只使用 Honcho；如果 Honcho 没有数据，UI 会明确显示空状态，不会伪造本地记忆。

### 验证结果

- `node --check src/social/wechat-group-memory.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `node --check src/social/wechat-command-guard.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/config.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `git diff --check` 通过。
- 使用 Electron userData 配置启动临时 API 验证：`/settings/social` 返回 `personaPrompt` 和 17 条安全规则；`/social/wechat-groups/memory-overview` 能按真实群列表返回 Honcho 记忆概览；`值班群` 可读取到已有 Honcho 原始消息。

### 部署注意事项

- 更新后需要重启白龙马/Electron 才能加载新的设置页资源和 API。
- 进入 `设置 -> 微信群助手`：先确认微信登录状态，再查看下方「微信群助手性格设定」「Honcho 群记忆管理」「安全黑名单」。
- 群记忆只使用 Honcho：请确保本地 Honcho 服务仍运行在 `http://127.0.0.1:8018`。如果 Honcho 服务未运行，微信群 @ 回复仍可工作，但记忆管理会显示读取错误或空状态。
- 清空本群 session 会删除该群 Honcho 消息和自动记忆，不能撤销；使用前请确认选中的群名正确。


## v0.3.4 - 2026-05-28

### 修复内容

- 修复微信群助手“显示已登录，但群里 @ 无回复”的假在线问题。
- 状态接口不再把 `logged_in` 或历史群列表快照当作真实在线；只有当前进程真实接入群、最近刷新/收到消息时才返回 `online: true`。
- 群列表接口在没有获取到真实群列表时不再返回 `ok: true`；旧群列表只作为缓存展示，并标记 `rooms_stale: true`。
- 设置页新增“强制重新扫码”按钮：清空 Wechaty 登录态并重新生成二维码，用户不再卡在坏登录态里。
- 设置页文案和状态改为显示“真实在线 / 未确认在线 / 缓存群列表”，避免误导。
- 修复 Wechaty MemoryCard 传参问题：当前 Wechaty 版本不消费 `memory` 选项，改为把 `name` 直接设置为 userData memory 路径，确保空登录态可以正常生成二维码。
- 重连逻辑增加抑制窗口，避免手动停止/强制重登时旧 logout 事件马上触发自动重连。

### 改变原因

- 用户截图中显示“已登录：前夜，群列表已刷新”，但实际群里 @ 无回复。日志显示程序持续拿不到群列表，只是在保留历史快照。
- 旧 UI 把“历史登录用户 + 历史群列表”展示成了可用状态，导致用户无法判断是否真的接通。
- 旧登录态损坏时没有清空登录态/重新生成二维码入口，用户无法自助恢复。

### 验证结果

- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/config.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `git diff --check` 通过。
- 本地接口验证：`/social/wechaty-duty-group/status` 返回 `status: qr_ready` 且包含二维码；同时 `online: false`、`rooms_stale: true`，不再假装在线。

### 部署注意事项

- 更新后需要重启白龙马。
- 如果微信群助手显示“未确认在线/缓存群列表/请强制重新扫码”，请进入“设置 -> 微信群助手”，点击“强制重新扫码”，用要接入群聊的微信扫码。
- 下方缓存群列表只是方便保留勾选，不代表当前微信通道在线；扫码成功并真实刷新后才会显示“已真实连接”。


## v0.3.3 - 2026-05-28

### 修复内容

- 修复 macOS 点击窗口关闭按钮后，程序只是隐藏窗口、仍然留在菜单栏/托盘继续运行的问题。
- Electron 主窗口 `close` 事件不再拦截并 `hide()`；用户点关闭按钮时会设置退出标记并调用 `app.quit()`。
- 新增 `before-quit` 统一设置退出标记，保证菜单栏“退出”、重启安装、程序重启等路径都走真实退出。
- `window-all-closed` 改为关闭最后窗口后退出应用，避免窗口没了但后台服务、Wechaty、语音链路仍留在进程里。
- 保留菜单栏图标里的“显示主界面”和“退出”入口：程序运行时仍可从菜单栏操作；但关闭主窗口就是彻底关闭。

### 改变原因

- 用户明确反馈“点击关闭按钮还是在菜单栏存在”，这和普通用户对关闭按钮的预期不一致。
- 之前隐藏到菜单栏是为了让桌面助手后台常驻，但目前更重要的是让用户能直观、可靠地结束程序。

### 验证结果

- `node --check electron/main.cjs` 通过。

### 部署注意事项

- 更新后需要重启白龙马/Electron 才能生效。
- 如果希望让程序继续后台常驻，不要点击窗口关闭按钮；后续可以再做“关闭按钮行为：退出 / 最小化到菜单栏”的设置开关。
- 如果当前已经有旧进程停在菜单栏，请先从菜单栏图标点“退出”，或在活动监视器里结束 Bailongma/Electron 后再启动新版。


## v0.3.2 - 2026-05-28

### 修复内容

- 修复 Wechaty 登录态没有稳定写入 Electron `userData`，导致重启后容易重新出现二维码的问题。
- 显式给 `WechatyBuilder` 传入 root `MemoryCard`，确保 `PUPPET-WECHAT4U` 登录数据写到 `~/Library/Application Support/Bailongma/wechaty-duty-group.memory-card.json`，而不是项目当前目录。
- 保留 `PuppetWechat4u` 的 memory 配置，并在启动前确保登录态文件存在且 JSON 有效。
- 自定义 logout handler 不再主动删除 `PUPPET-WECHAT4U` 登录态，避免正常 stop/restart 时把扫码状态清掉。
- 修复运行状态误判：`roomSnapshot` 只是上次群列表快照，不能作为当前已登录证据；只有当前进程实际解析到 room 才算在线。
- 等待扫码/恢复登录期间遇到 `400 != 400`、`-1 == 0` 等 wechat4u 暂态错误时，只保留当前状态，不再误标为 `logged_in`。
- 状态接口新增 `login_memory` 诊断信息，可看到登录态文件路径、大小、key 数量和是否包含 Wechaty 登录数据。
- `.gitignore` 新增 `*.memory-card.json`，防止 Wechaty 登录态/扫码凭证被上传 GitHub。

### 改变原因

- 正常情况下软件重启不应该每次都要求扫码；扫码态应该尽量复用。
- 但 Web 微信/wechat4u 的登录态可能被微信服务端判定失效，此时仍然会要求重新扫码，这是上游登录机制限制，不是软件故意要求。

### 验证结果

- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。

### 部署注意事项

- 本补丁生效后，下一次扫码成功会把登录态保存到 userData；之后正常重启会优先尝试自动恢复。
- 如果当前已经处于二维码状态，需要再扫码一次，让新的登录态文件生成。
- 如果微信服务端主动踢掉 Web 登录态，仍需要重新扫码。


## v0.3.1 - 2026-05-28

### 修复内容

- 修复微信群里已经 @ 助手，但助手仍回复“没叫我，跳过”的问题。
- 群助手触发逻辑改为以 Wechaty 的 `message.mentionSelf()` 元数据为准：只要微信消息结构确认 @ 了当前登录账号，就必须调用大模型并回复。
- 移除对固定昵称/唤醒词的绑定，不再依赖“前夜 / 小白龙 / 贾维斯 / 小风”等任何文本关键词。以后进群后改群昵称、改微信昵称、改备注名，都不影响 @ 回复。
- 群提示词新增“已由 Wechaty 确认 @ 当前账号”的强约束，禁止模型再次根据文本昵称判断“是不是叫我”。
- `send_message` 工具新增保护：如果 Wechaty 已确认 @ 当前账号，而模型试图发送“没叫我 / 不是@我 / 跳过 / 无需回应”，工具会拒绝这条错误回复并要求模型重新直接回答。
- LLM 循环新增兜底拦截：模型如果不调用工具、只输出“没叫我/跳过”，会被注入修正提示并重试。
- 协议 fallback 新增保护：即使模型最后仍输出错误跳过文本，也不会原样发到微信群。
- 修复 `sentMessage` 判断：只有 `send_message` 真正发送成功才算已回复；工具返回错误时会继续要求模型补发正确回复。

### 改变原因

- 微信群里显示的 @ 名称可能是群昵称、备注名、微信昵称或临时展示名，不能作为助手身份判断依据。
- 用户明确要求：不要绑定任何限制词，主要是 @ 就能回复，因为进群之后可能会改名，后续也可能给这个微信改昵称。

### 验证结果

- `node --check src/social/wechat-groups.js` 通过。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/social/wechat-clawbot.js` 通过。
- `node --check src/capabilities/executor.js` 通过。
- `node --check src/llm.js` 通过。
- `node --check src/index.js` 通过。
- 本地函数验证：`shouldWakeInWeChatGroup("@小风 写首诗", { mentionedSelf: true }) === true`，`mentionedSelf: false` 时不唤醒。

### 部署注意事项

- 需要重启白龙马/Electron 后生效。
- 不需要重新扫码，除非微信登录态本身已失效。
- 本补丁不新增依赖、不改 Honcho 端口、不上传任何群聊数据。


## v0.3.0 - 2026-05-28

### 里程碑定位

这是“微信群助手可用版”的里程碑更新：从之前的本地语音/桌面助手能力，正式扩展到可扫码登录微信、选择多个群组、在群里被 @ 后调用大模型回复，并为后续每个群独立知识库打好基础。

### 更新内容

#### 微信群助手

- 新增基于 `wechaty` + `wechaty-puppet-wechat4u` 的微信群助手连接器。
- 设置页新增独立“微信群助手”菜单，不再混放在普通社交媒体配置里。
- 支持扫码登录/恢复登录、展示二维码、获取真实微信群列表、勾选多个群组并保存生效。
- 支持默认接入“值班群”和“PT站看片狂魔小群”，也支持后续在设置页选择更多群。
- 群消息规则改为：只有 @ 当前登录微信号时才调用大模型；没有 @ 的普通群消息只进入归档/记忆链路，不主动打扰。
- 修复之前只对“在吗”等测试话术有硬编码回应的问题，现在 @ 后会进入真实 LLM 回复流程。
- 回复时会 @ 提问的群成员，并尽量使用可读昵称，避免把 `@03ee...` 这类内部 ID 直接发到群里。
- 增加文本 `@登录名` 兜底识别，减少 Wechaty mention 事件偶发不完整时漏触发的问题。

#### 登录状态与群组状态稳定性

- 修复扫码后设置页不显示真实在线状态的问题。
- 修复退出设置页再进入后群列表消失、已选群组显示不真实的问题。
- 群组列表刷新改为尊重运行时快照：未登录时不会用空列表覆盖之前已获取的真实列表。
- 保存群组选择时不再无意义重启 Wechaty，避免“扫码成功 -> 保存生效 -> 立刻掉线 -> 群里 @ 无响应”。
- `/social/wechaty-duty-group/start` 改为幂等：已经扫码中、已登录、已连接时重复点击不会重复启动/破坏会话。
- 对 Wechaty/Web 微信常见瞬时错误（如 `-1 == 0`、`400 != 400`）做降级处理：在已登录且群组已解析时视为警告，不再立即重连/登出。

#### Honcho 群知识库

- 新增 Honcho 记忆层依赖：`@honcho-ai/sdk` 与 `honcho-ai`。
- 新增 Honcho 配置项，默认连接本地服务 `http://127.0.0.1:8018`，默认应用/知识库为 `bailongma-wechat-memory`。
- 每个微信群映射为独立的 Honcho session/peer，避免不同群组之间记忆串扰。
- 新增群知识库查看/预览接口与 UI 入口，后续可按群手动管理。
- 按用户要求不启用本地兜底记忆：Honcho 未启动或不可用时，只提示状态，不偷偷写入本地替代库。

#### 群指令安全守卫

- 新增微信群指令黑名单守卫，防止群成员通过 @ 让助手执行危害电脑或账号的操作。
- 默认拒绝：删除/破坏文件、修改系统权限或启动项、读取/外传密钥、网络外传、执行命令/代码、安装卸载软件、远程控制、支付转账、账号操作、群发刷屏等高危请求。
- 按用户要求不加入逆向内容过滤，也不加入成人内容过滤。
- 安全守卫只针对危险执行类请求；普通问答、总结、解释、写作仍可调用大模型。

#### Electron / Mac 启动稳定性

- 新增 Mac 一键启动脚本：`start-jarvis.command`。
- 新增后台启动脚本：`start-jarvis-background.sh`，使用 macOS `open -n Electron.app --args <project>`，避免普通 `nohup npm start` 被终端/自动化会话带崩。
- Electron 主进程加入 EPIPE 保护，减少输出管道关闭导致的异常退出。
- 修复 Dock 栏有图标但点击不显示窗口的问题，`showMainWindow()` 与 `app.on('activate')` 会重新显示主窗口。

#### 语音与交互链路同步改进

- 接入火山/豆包 ASR 配置与后端链路，并增加后端轻量 VAD/自动 flush，改善“只识别最后一个字”和回答后不再识别的问题。
- 调整 TTS 自回声/打断逻辑，降低助手播报自己的声音又触发语音识别的概率。
- 根据用户反馈，关闭碎片化分段 TTS，默认回到更稳定的整段播报，避免语调忽变、读一半停住、漏读短句。
- 队列和 LLM 输出增加 Unicode 代理字符清理，避免异常字符导致消息/语音链路中断。

### 改变原因

- 用户已经完成微信扫码登录并在群里测试通过，说明本版本已经达到“群里 @ 能正常回复”的可用里程碑。
- 之前最大问题是：扫码后保存群组会掉线、群列表状态不真实、@ 后没有进入 LLM、以及 Wechaty 瞬时错误导致连接器误判失败。
- 本版本把登录状态、群组选择、@ 触发、LLM 回复、安全守卫、群记忆入口和 Mac 启动方式连成一条稳定链路。

### 验证结果

- 用户实测：微信群里 @ 登录账号后已经可以正常回复。
- `node --check src/social/wechaty-duty-group.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check src/api.js` 通过。
- `node --check src/config.js` 通过。
- `node --check src/social/wechat-group-memory.js` 通过。
- `node --check src/social/wechat-groups.js` 通过。
- `node --check src/social/wechat-command-guard.js` 通过。
- `node --check src/social/dispatch.js` 通过。
- `node --check src/social/index.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `node --check electron/main.cjs` 通过。

### 部署注意事项

- 从源码运行：`npm install` 后执行 `./start-jarvis.command`，或用 `npm start` 启动 Electron。
- 微信群助手依赖 `wechaty`、`wechaty-puppet-wechat4u`，本版本已写入 `package.json` 和 `package-lock.json`。
- Honcho 如果要启用本地知识库，需要单独启动 Honcho 服务，默认地址为 `http://127.0.0.1:8018`。如果 Honcho 未启动，微信群回复仍可工作，但群知识库状态会显示不可用。
- `.env`、`config.json`、`data/`、Wechaty 登录态、日志、`.playwright-mcp/`、本地模型和个人数据不上传 GitHub。
- 如果微信 Web 登录态失效，需要在“设置 -> 微信群助手”重新扫码。


## v0.2.0 - 2026-05-27

### 更新内容

- 新增小智式语音会话状态机 `VoiceSession`，统一管理语音 turn、状态和打断流程。
- 每轮语音输入生成独立 `voiceTurnId`，从前端发送、API 入队、LLM 流式事件到 TTS 播放全链路传递。
- ASR 回调、LLM 流式 TTS、TTS 队列播放都按 `voiceTurnId` 过滤，旧 turn 的回调会被丢弃，避免上一轮语音/播报污染当前轮。
- 新增统一 `abortSpeaking(reason)` 控制点，用于用户打断、新一轮语音开始、TTS 停止等场景。
- TTS 队列增加 turn 绑定；如果新 turn 已经开始，旧 turn 的分句语音不会继续播放。
- 前端运行时新增 `voice_turn_state`、`voice-fast-state`、`voice-session-state` 状态同步，供 UI 和后续诊断使用。
- API `/message` 支持 `voiceTurnId` / `voice_turn_id`，用于本地语音请求的会话隔离。

### 改变原因

- 借鉴小智 ESP32 的协议化会话思路：不是简单堆模型，而是把听、想、说、打断统一成明确的 turn 和状态。
- 进一步解决语音残留、旧回调串入新一轮、TTS/ASR 打断混乱等问题。

### 验证结果

- `node --check src/api.js` 通过。
- `node --check src/index.js` 通过。
- `node --check src/capabilities/executor.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/chat.js` 通过。
- `node --check src/ui/brain-ui/voice-panel.js` 通过。
- `npm run smoke:brain-ui` 通过。
- 本地 Electron 启动正常，API `3721` 和 ASR WebSocket `3723` 正常。
- `/message` 携带 `voiceTurnId` 的 voice channel 测试可以正常得到回复。

### 部署注意事项

- 本版本不新增模型文件，不需要额外下载。
- 如果从旧版本升级，直接 `git pull && npm install && npm start` 即可。
- 设置页仍保持简单，没有新增复杂客户配置项。

## v0.1.1 - 2026-05-27

### 修复内容

- 修复语音输入发送后，下一次识别会带上上一次语音内容的问题。
- 发送语音识别结果前后统一清空 `lastTranscriptText`、`accumulatedText`、`lastFinalTranscript` 和自动发送计时器。
- 语音输入改为明确走 `voice` 通道，避免本地语音被当作 TUI/外部消息处理。
- 为本地语音通道增加回复协议提示：直接输出助手正文，由运行时显示和 TTS 播放；不要强制使用 `send_message` 工具。
- 重启验证后确认之前运行进程中的 `voiceSentenceEmitter is not defined` 报错已消失。

### 验证结果

- `node --check src/index.js` 通过。
- `node --check src/ui/brain-ui/voice-panel.js` 通过。
- `npm run smoke:brain-ui` 通过。
- 本地启动后 API `3721` 和 ASR WebSocket `3723` 正常。
- voice channel 测试消息可以正常得到回复。

## v0.1.0 - 2026-05-26

### 更新内容

- 新增“小智式极速语音模式”，默认开启，用于语音对话场景的快速响应、分句播报和可打断交互。
- 后端 LLM 流式输出阶段新增语音分句触发器：模型一边生成正式回答，一边按中文标点/短句边界触发 TTS，不再等待整段回答完全结束后才开始说话。
- 前端 TTS 播放改为队列式分句播放：每一句独立请求 `/tts/stream`，上一句播放时下一句可以排队，减少首句等待时间。
- 打断逻辑升级：用户说话或近场人声触发 `stopTTS()` 时，会清空后续 TTS 队列、取消正在请求的 TTS、停止当前音频，并保留已说到的位置。
- 避免重复播报：当流式分句已经播报过内容时，`send_message` 工具回复和 fallback 回复不会再次把完整文本重复播一遍。
- 设置页新增“极速语音模式（可打断 / 快速播报）”开关，默认开启；关闭后回退到原来的整段 TTS 播放方式。
- 正式回答才会进入语音播报，思考流/工具准备流不会被念出来。

### 改变原因

- 用户希望借鉴小智 ESP32 的快速应答、可打断、快速输出语音和极速交互体验。
- 原逻辑需要等待完整回答后再合成 TTS，语音对话体感偏慢；本版本先完成软件端“流式分句播报 + 打断队列取消”的核心闭环。

### 验证结果

- `node --check src/index.js` 通过。
- `node --check src/ui/brain-ui/app.js` 通过。
- `node --check src/ui/brain-ui/app-shell.js` 通过。
- `npm run smoke:brain-ui` 通过。
- 本地启动后 `http://127.0.0.1:3721/status` 返回 `ok: true`。
- 本地 ASR WebSocket `127.0.0.1:3723` 正常监听。
- 通过 `/message` 发送 voice channel 测试消息，助手成功返回“极速语音模式测试通过”。

### 部署注意事项

- 本版本不新增大型模型文件，不需要额外下载模型。
- 如设置里关闭“极速语音模式”，语音播报会退回整段播放。
- 本版本仍使用当前已配置的本地 ASR/TTS 服务，只优化响应链路和播放队列。

## v2.1.209 - 2026-05-26

### 更新内容

- 新增正式 `CHANGELOG.md`，以后每个版本的备份、功能变化、部署注意事项都集中记录在这里。
- Brain UI 的“设置 -> 更新”页面新增“更新说明”区域，用户可以直接在软件里看到最近版本改变了什么。
- README 增加“版本更新记录”入口，避免只有版本号没有说明。
- 备份文档补充版本维护规范，明确以后每个版本都要写清更新内容、改变原因、部署方法和不进 Git 的本地文件。

### 影响范围

- 不改变语音识别、声纹、唤醒词和视频抗干扰的运行逻辑。
- 这是一次文档和界面说明增强版本。

### 备份说明

- GitHub 维护仓库：`xiaoguiwucan/BaiLongma`
- 上一个功能备份 tag：`backup-2026-05-26-local-voice`
- 本版本应打 tag：`v2.1.209`

## v2.1.208 - 2026-05-26

### 更新内容

- 将当前 Mac Electron 本地语音助手能力正式升级为 `v2.1.208`。
- 默认本地语音识别模型改为 `SenseVoiceSmall`，中文优先、速度更快，并降低空音频幻觉概率。
- 保留 Whisper 作为本地备用模型，可在设置页切换。
- 新增 `src/voice/sensevoice_server.py`，通过 WebSocket 提供本地 ASR 服务，兼容原本麦克风音频链路。
- 本地 ASR 服务加入静音门控、近场人声阈值、最短语音长度、重复文本过滤和常见幻觉文本过滤。
- 设置页新增语音识别服务商选择：本地、阿里云、腾讯云、讯飞。
- 设置页新增本地模型选择：SenseVoiceSmall、Whisper tiny/base/small/medium/large/turbo 等。
- 新增唤醒词开关和自定义唤醒词输入，默认 `小龙马 / 龙马 / 白龙马`。
- 新增声纹录入能力，支持“只响应我的声音”。
- 新增声纹严格度滑杆，默认 `0.55`，用于提高声纹识别稳定性。
- 新增视频播放抗干扰设置：
  - 检测到近场人声时自动降低/暂停视频；
  - 视频播放时启用空格按住说话；
  - 启用系统回声消除 AEC。
- 前端语音面板增加声纹拒绝反馈，能看到拒绝原因和相似度分数。
- `.gitignore` 增加 `.venv-whisper/`、`models/SenseVoiceSmall/`、`backups/`、Python 缓存等本地大文件忽略规则。
- 新增详细备份与 Mac 自部署文档 `BACKUP-2026-05-26.md`。

### 改变原因

- 用户要求语音识别尽量本地化，中文优先，速度要快且精准。
- 原 Whisper 在静音、视频背景音、噪声环境下容易输出重复幻觉文本，例如“我只想说了”等无效内容。
- 播放视频时，视频声音可能遮盖用户唤醒词，需要提供 AEC、视频降音和按住说话组合方案。
- 用户希望助手只响应本人声音，因此加入本地声纹录入和声纹校验。

### 部署注意事项

- `models/SenseVoiceSmall/` 不上传 GitHub，需要按 `BACKUP-2026-05-26.md` 里的方法下载。
- `.venv-whisper/` 不上传 GitHub，需要在 Mac 上重新创建 Python 3.11 虚拟环境。
- `.env`、`config.json`、`data/` 属于本地配置和个人数据，不作为公开 GitHub 备份上传。
- 声纹数据在 `data/voiceprint.json`，属于敏感个人数据，不应上传公开仓库。

### 已知限制

- 当前唤醒词仍是软件侧文本/音频链路判断，还不是专用 KWS 模型。
- 当前声纹使用 `resemblyzer`，适合个人桌面辅助，但还不是 3D-Speaker/ECAPA 工业级声纹系统。
- 视频很吵时声纹和 ASR 都会受影响，最稳定方案仍是同时开启视频降音、AEC 和空格按住说话。

## v2.1.182 - 2026-05-25

### 更新内容

- README 同步补充专注栈、Agent 委托、语音系统、社交分发等 Step5-6 新增模块。
- 保留作为上游历史版本节点，后续本仓库以 `xiaoguiwucan/BaiLongma` 为维护主仓库。
