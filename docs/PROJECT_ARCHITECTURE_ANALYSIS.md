# BaiLongma 项目源码架构分析报告

生成日期：2026-06-03

## 1. 项目定位

BaiLongma 当前本地代码是一个“Electron 桌面壳 + 本地 Node Agent 后端 + Brain UI 控制台 + 多渠道社交/语音能力”的混合型本地应用。

它不是传统的一问一答 Web Chat，而是一个持续运行的 Agent runtime：后台循环接收用户消息、社交平台事件、语音输入、提醒任务和自主 TICK 心跳，动态组装上下文后调用 LLM，再通过工具系统执行动作、分发回复并沉淀长期记忆。

核心运行目标可以概括为：

- 持续运行的本地数字意识/Agent。
- 可视化 Brain UI 控制台。
- 长短期记忆与上下文注入。
- 多模型 LLM profile 与自动 failover。
- 微信群、ClawBot、Discord、飞书、公众号、企业微信等社交通道。
- 本地/云端语音识别与 TTS。
- Agent 可主动调用本地工具、网页、文件、媒体、UI 卡片和技能。

## 2. 关键入口

| 文件 | 职责 |
| --- | --- |
| `package.json` | 项目脚本、依赖、Electron Builder 打包配置 |
| `electron/main.cjs` | Electron 主进程，负责窗口、日志、更新、端口选择、后端 bootstrap |
| `src/index.js` | Agent 后端主入口，负责意识循环、队列调度、LLM turn、记忆写入 |
| `src/api.js` | 原生 HTTP API、SSE、WebSocket、静态资源服务 |
| `src/db.js` | better-sqlite3 数据库初始化、迁移、读写接口 |
| `src/llm.js` | OpenAI SDK 流式调用、工具调用解析、模型 failover |
| `src/capabilities/executor.js` | 工具实际执行层 |
| `src/capabilities/schemas.js` | 暴露给 LLM 的工具 schema |
| `src/memory/injector.js` | 记忆召回与上下文注入 |
| `src/memory/recognizer.js` | 交互后的长期记忆识别与写入 |
| `src/ui/brain-ui/app.js` | Brain UI 主前端逻辑 |
| `src/social/index.js` | 社交连接器启动入口 |
| `src/social/dispatch.js` | 出站社交消息统一分发 |
| `src/voice/manager.js` | 本地 ASR Python 服务管理 |

## 3. 技术栈

### 3.1 桌面与打包

- Electron 33。
- electron-builder。
- electron-updater。
- Windows NSIS 安装包。
- macOS DMG/ZIP 打包脚本。
- 主窗口加载本地后端提供的 `/brain-ui`。

### 3.2 后端运行时

- Node.js ESM。
- 原生 `http` 服务。
- `ws` WebSocket。
- SSE 事件流。
- 无 Express/Koa/Fastify 等框架。
- 所有 API 路由集中在 `src/api.js` 中以条件分支实现。

### 3.3 LLM

- `openai` SDK。
- 使用 Chat Completions streaming。
- 支持 OpenAI-compatible endpoint。
- 内置 provider：
  - DeepSeek
  - MiniMax
  - OpenAI
  - Qwen
  - Moonshot
  - Zhipu
  - Custom
- 支持多 LLM profile。
- 支持失败冷却、自动切换、连通性监控。

### 3.4 数据层

- better-sqlite3。
- SQLite WAL。
- SQLite FTS5。
- FTS tokenizer 使用 trigram，便于中文子串检索。
- `memories.embedding` 支持可选向量召回。
- 数据库文件默认在 `data/jarvis.db`，Electron 打包后写入 `userData/data/jarvis.db`。

### 3.5 前端

- 原生 HTML/CSS/JavaScript SPA。
- D3。
- Web Components。
- EventSource。
- WebSocket。
- 不依赖 React/Vue/Svelte。

### 3.6 语音

- Python 本地 ASR 服务：
  - SenseVoice
  - Whisper
- WebSocket 音频流。
- 云 ASR 代理：
  - 阿里云
  - 腾讯云
  - 讯飞
  - 火山
- TTS provider：
  - 豆包/火山
  - MiniMax
  - OpenAI
  - ElevenLabs

### 3.7 社交平台

- `wechat-ilink-client`：ClawBot/个人微信通道。
- `wechaty` + `wechaty-puppet-wechat4u`：微信群助手。
- Discord Gateway。
- 飞书开放平台。
- 微信公众号客服消息。
- 企业微信 webhook。

### 3.8 文档与知识库

- `pdf-parse`。
- `mammoth`。
- `xlsx`。
- 知识库支持来源导入、解析、搜索、重解析、删除。

### 3.9 可选 Honcho 服务

仓库内嵌 `installer/services/honcho`，这是一个独立 Python/FastAPI 服务副本，依赖包括：

- FastAPI
- SQLAlchemy
- PostgreSQL/pgvector
- Redis
- LanceDB
- turbopuffer
- OpenAI/Gemini 等 LLM client

本地 Electron 默认不强制启动 Honcho，除非设置 `BAILONGMA_ENABLE_BUNDLED_HONCHO=1`。

## 4. 顶层目录职责

| 目录/文件 | 说明 |
| --- | --- |
| `electron/` | Electron 主进程、preload、专注横幅 preload |
| `src/` | 核心业务代码 |
| `src/ui/brain-ui/` | Brain UI 控制台 |
| `src/memory/` | 记忆识别、召回、注入、焦点栈、整理 |
| `src/capabilities/` | LLM 工具 schema、执行器、工具市场 |
| `src/social/` | 社交通道、微信群、统计、群记忆、图片/视频 Skill |
| `src/voice/` | ASR/TTS 与 Python 语音服务 |
| `installer/services/honcho/` | 可选外部 Honcho 服务副本 |
| `scripts/` | 测试、冒烟、启动、构建辅助脚本 |
| `build/` | 图标、NSIS 资源、after-pack |
| `images/` | README 和展示素材 |
| `music/` | 种子音乐资源 |
| `ACUI (Remix)/` | ACUI 设计稿/原型文件 |
| `CHANGES-*`、`BACKUP-*` | 历史变更、阶段文档、备份记录 |

## 5. 启动机制

### 5.1 Electron 桌面启动

`npm start` 执行 `electron .`。

`electron/main.cjs` 的核心启动链路：

1. Windows 下切换控制台编码为 UTF-8。
2. 初始化日志，写入 Electron `userData/logs/bailongma.log`。
3. 获取单实例锁，防止多开。
4. 可选准备并启动内嵌 Honcho Docker 服务。
5. 查找可用端口，优先 `3721`。
6. 设置环境变量：
   - `BAILONGMA_USER_DIR`
   - `BAILONGMA_RESOURCES_DIR`
   - `BAILONGMA_PORT`
7. 动态 import `src/index.js` 启动后端。
8. 等待 `/activation-status` 可访问。
9. 创建 BrowserWindow。
10. 加载 `http://127.0.0.1:<port>/brain-ui`。
11. 初始化托盘、自动更新、主窗口快捷键。

### 5.2 后端独立启动

`npm run start:backend` 执行：

```bash
node --env-file=.env src/index.js
```

此模式不启动 Electron 窗口，只启动 HTTP API、TUI、社交连接器和主循环。

### 5.3 路径策略

`src/paths.js` 抽象运行路径：

- 开发模式下：
  - `userDir = repo root`
  - `resourcesDir = repo root`
- Electron 打包后：
  - `userDir = Electron userData`
  - `resourcesDir = app resources`

可写数据放入 userDir：

- `data/jarvis.db`
- `config.json`
- `sandbox/`
- `music/`

只读资源从 resourcesDir 读取：

- HTML 页面
- Brain UI 静态资源
- build 图标资源

## 6. 后端主循环设计

`src/index.js` 是项目的核心调度器。

启动时先执行环境感知：

- 拷贝 sandbox 种子文件。
- 拷贝 music 种子文件。
- 收集系统信息。
- 扫描桌面。
- 扫描本地资源，例如 SSH、Git、本地 Agent。
- 获取地理位置和天气。
- 获取热点趋势。
- 扫描本地 AI Agent。
- 加载已安装工具。
- 初始化数据库。
- 注入默认种子记忆。
- 注册 MiniMax provider。

随后启动：

- HTTP API。
- 社交连接器。
- TUI。
- LLM 连通性监控。
- 微信群日报调度。
- 主意识循环。

### 6.1 循环优先级

主循环按队列优先级处理：

1. 用户消息。
2. 后台消息。
3. L2 TICK 心跳。
4. 任务模式 TICK。
5. 提醒任务。
6. 速率限制状态下延迟。

### 6.2 TICK 调度

调度逻辑在 `scheduleNextTick()` 中：

- 有用户消息：立即执行。
- 有后台消息：立即执行。
- 被限流：按配额间隔。
- 有自定义 ticker：按自定义间隔。
- 唤醒期：10 秒一次。
- 任务模式：30 秒一次。
- 普通空闲：使用 `config.tickInterval`。
- 有提醒快到期：缩短到提醒触发时间。

### 6.3 抢占与 Watchdog

单轮 `runTurn` 包装在 `runTurnWithWatchdog()` 中：

- 超过 180 秒未返回会 abort。
- 避免 UI 永久显示“思考中”。
- 新高优先级消息到达时可 abort 当前 LLM 调用。
- 微信群消息支持并行 batch，默认上限 3，最大 5。

## 7. 一次完整对话的数据流

1. 用户在 Brain UI 输入消息，或者社交/语音连接器收到消息。
2. 消息进入 `queue.js`。
3. `src/index.js` 的 `onTick()` 取出消息。
4. `memory/injector.js` 检索记忆、最近对话、焦点栈、时间词召回、工具日志。
5. `memory/tool-router.js` 根据当前消息选择本轮可用工具。
6. `prompt.js` 构造 system prompt 与 context block。
7. `src/llm.js` 调用 LLM streaming。
8. 如果模型产生工具调用，`capabilities/executor.js` 执行工具。
9. 工具结果回填给 LLM。
10. 模型通过 `send_message` 回复目标。
11. 回复写入 `conversations`。
12. `memory/recognizer.js` 在后台识别是否需要写长期记忆。
13. Brain UI 通过 SSE 和 WebSocket 展示思考流、工具调用、UI 卡片和状态变化。

## 8. HTTP API 设计

`src/api.js` 使用原生 `http.createServer` 实现所有路由。

主要 API 分类：

### 8.1 基础交互

- `POST /message`
- `GET /events`
- `GET /status`
- `GET /quota`
- `GET /activation-status`
- `POST /activate`

### 8.2 记忆与对话

- `GET /memories`
- `PATCH /memories/:id`
- `DELETE /memories/:id`
- `GET /conversations`
- `GET /settings/database`
- `GET /settings/database/export`
- `POST /settings/database/import`
- `POST /settings/database/backfill-vectors`
- `POST /settings/database/sync-honcho`
- `POST /settings/database/extract-wechat-memories`

### 8.3 设置

- `/settings`
- `/settings/model`
- `/settings/llm-profile`
- `/settings/llm-profile/select`
- `/settings/llm-profile/test`
- `/settings/llm-failover`
- `/settings/temperature`
- `/settings/security`
- `/settings/social`
- `/settings/voice`
- `/settings/tts`
- `/settings/web-search`
- `/settings/embedding`
- `/settings/skills/*`

### 8.4 社交与微信群

- `/social/wechat-clawbot/*`
- `/social/wechaty-duty-group/*`
- `/social/wechat-groups/*`
- `/social/meme/search`
- 社交 webhook：飞书、公众号等。

### 8.5 知识库

- `GET /knowledge/status`
- `GET /knowledge/sources`
- `GET /knowledge/search`
- `POST /knowledge/import/parse`
- `POST /knowledge/import/commit`
- `PATCH /knowledge/sources/:id`
- `POST /knowledge/sources/:id/reparse`
- `DELETE /knowledge/sources/:id`

### 8.6 媒体与语音

- `/media/history`
- `/media/video`
- `/media/music/*`
- `/audio/:filename`
- `/voice/local/status`
- `/voice/local/start`
- `/voice/local/restart`
- `/voice/local/stop`
- `/tts/stream`
- `/tts/interrupted`

### 8.7 WebSocket

- `/acui`：Agent 主动 UI 卡片通道。
- `/voice/cloud`：云 ASR 代理通道。

## 9. 数据库设计

数据库初始化集中在 `src/db.js`。

### 9.1 基础表

| 表 | 用途 |
| --- | --- |
| `conversations` | 用户与 Jarvis 的对话记录 |
| `memories` | 长期记忆 |
| `memories_fts` | FTS5 全文索引 |
| `config` | Key-value 配置 |
| `entities` | 实体索引 |
| `action_logs` | 工具调用审计 |
| `reminders` | 提醒任务 |
| `prefetch_tasks` | 预取任务配置 |
| `prefetch_cache` | 预取缓存 |
| `ui_signals` | UI 行为信号 |
| `media_history` | 媒体播放历史 |
| `music_library` | 本地音乐库 |
| `known_agents` | 本地 AI Agent 探测结果 |
| `user_identities` | 用户身份映射 |
| `focus_stack` | 焦点栈持久化 |
| `wechat_clawbot_tokens` | ClawBot context token |

### 9.2 记忆表特点

`memories` 字段包括：

- `event_type`
- `content`
- `detail`
- `title`
- `mem_id`
- `entities`
- `concepts`
- `tags`
- `links`
- `salience`
- `source_ref`
- `timestamp`
- `parent_id`
- `embedding`
- `visibility`
- `hidden_at`
- `merged_into`

检索策略：

- FTS5 trigram 做关键词和中文子串搜索。
- `embedding BLOB` 做语义向量检索。
- `visibility=1` 过滤软隐藏记忆。
- `mem_id` 做幂等 upsert 和去重。

### 9.3 迁移风格

项目没有独立 migration 框架。迁移逻辑直接写在 `initSchema()` 中：

- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE ADD COLUMN` 包在 try/catch 中。
- 部分迁移通过 `PRAGMA table_info` 做幂等检查。
- FTS5 tokenizer 从旧 schema 升级到 trigram 时会重建虚拟表和 trigger，但不删除真实 `memories` 表。

## 10. LLM 调用机制

### 10.1 配置层

`src/config.js` 管理：

- provider 列表。
- 默认模型。
- 激活流程。
- LLM profile。
- failover。
- 连通性测试。
- 温度。
- 安全配置。
- Honcho 配置。
- Wechaty 群助手配置。
- 社交配置。
- 语音/TTS 配置。
- embedding 配置。
- web search 配置。
- image/video Skill 渠道池。

### 10.2 调用层

`src/llm.js` 负责：

- 创建并缓存 OpenAI client。
- 构造 streaming request。
- 支持工具 schema。
- 解析流式 content。
- 解析 reasoning content。
- 解析增量 tool calls。
- 记录 token usage。
- 支持 AbortSignal。
- 区分 quota/rate limit/provider error。
- 在 failover 条件满足时切换备用 profile。

### 10.3 工具调用策略

模型不是每轮获得所有工具。`memory/tool-router.js` 根据当前消息意图选择工具：

- 核心工具默认保留：`send_message`、UI、记忆基础能力等。
- 文件意图命中时加入文件工具。
- 命令意图命中时加入 exec 工具。
- 网络意图命中时加入 web 工具。
- 媒体、提醒、微信记忆、热点、专注横幅等按关键词和上下文加入。

这样可以降低 prompt 体积，也减少模型误调用高风险工具的概率。

## 11. 工具系统

工具系统由三部分组成：

| 文件 | 职责 |
| --- | --- |
| `src/capabilities/schemas.js` | 工具 schema |
| `src/memory/tool-router.js` | 本轮工具选择 |
| `src/capabilities/executor.js` | 工具实际执行 |

### 11.1 主要工具能力

- `send_message`：统一出站消息。
- `read_file`、`write_file`、`delete_file`、`list_dir`、`make_dir`。
- `exec_command`、`kill_process`、`list_processes`。
- `web_search`、`fetch_url`、`browser_read`。
- `speak`。
- `media_mode`、`music`。
- `manage_reminder`。
- `manage_prefetch_task`。
- `ui_show`、`ui_update`、`ui_hide`、`ui_patch`、`ui_register`。
- `focus_banner`。
- `set_security`。
- `connect_wechat`。
- `wechat_member_memory_write`。
- `install_tool`、`uninstall_tool`、`list_tools`。
- `delegate_to_agent`。

### 11.2 安全审计

工具执行前会做风险分级：

- low
- medium
- high

执行后写入 `action_logs`，并通过 `tool_audit` 事件推给 UI。

部分高风险工具要求必须处于明确的用户驱动上下文中。

### 11.3 工具市场

`src/capabilities/marketplace/index.js` 支持安装自定义 JS 工具：

- 工具保存到 `sandbox/installed_tools`。
- 启动时加载。
- 工具名避免覆盖系统内置工具。
- 运行时注册到 schema。

## 12. 记忆系统

记忆系统位于 `src/memory/`。

### 12.1 注入器

`memory/injector.js` 做上下文召回：

- 当前消息关键词。
- FTS5 记忆搜索。
- embedding 召回。
- 时间词召回。
- 当前焦点栈。
- 最近对话。
- 任务知识。
- 工具日志。
- UI 信号。
- 预取缓存。
- 活跃 UI 卡片。

输出结果会格式化成 prompt 中的 context block。

### 12.2 识别器

`memory/recognizer.js` 在每轮完成后后台运行。

它不回答用户，只判断是否值得写长期记忆：

- 稳定事实。
- 用户偏好。
- 关系。
- 任务结论。
- 高成本工具结果。
- 长文章摘要。
- 外部资料索引。

无价值内容会调用 `skip_recognition`，避免污染记忆库。

### 12.3 焦点栈

`memory/focus.js` 维护多帧焦点：

- 新话题 push。
- 命中当前话题 keep。
- 回到旧话题 pop。
- 失活后自动清理。

`memory/focus-compress.js` 会把弹出的焦点帧压缩成结论，写回长期记忆。

### 12.4 记忆整理

`memory/consolidation-loop.js` 周期启动整理任务。

`memory/consolidator.js` 针对单个实体清理重复或过期记忆，支持：

- merge。
- downgrade。
- skip。

## 13. Brain UI 前端

Brain UI 是主操作界面，位于 `src/ui/brain-ui/`。

### 13.1 功能区

Brain UI 包含：

- 聊天界面。
- 思考流。
- 工具调用展示。
- 记忆展示。
- 热点面板。
- 人物卡片。
- 文档/知识库面板。
- 语音控制面板。
- 微信扫码弹窗。
- 设置页。
- 数据库页。
- 微信群统计与记忆管理。
- Skill 配置。
- LLM profile 管理。
- Web search 配置。
- 安全配置。

### 13.2 通信方式

前端通过：

- `fetch()` 调 REST API。
- `EventSource('/events')` 接收 SSE。
- `WebSocket('/acui')` 接收 Agent UI 卡片。
- `WebSocket('/voice/cloud')` 接云 ASR。
- `WebSocket('127.0.0.1:3723')` 接本地 ASR。

### 13.3 ACUI

ACUI 是 Agent Controlled UI。

核心文件：

- `src/ui/brain-ui/acui/bootstrap.js`
- `src/ui/brain-ui/acui/client.js`
- `src/ui/brain-ui/acui/renderer.js`
- `src/ui/brain-ui/acui/registry.js`
- `src/ui/brain-ui/acui/components/*`

Agent 可以通过工具主动推送 UI 卡片：

- `ui_show`
- `ui_update`
- `ui_hide`
- `ui_patch`
- `ui_register`

ACUI 卡片基于 Web Components，支持：

- 右侧通知。
- 居中弹窗。
- stage 模式。
- floating 模式。
- 拖动。
- enter/exit 动画。
- 用户 action 回传。

## 14. 社交系统

社交系统位于 `src/social/`。

### 14.1 连接器启动

`src/social/index.js` 启动：

- Discord connector。
- ClawBot connector。
- Wechaty 群助手 connector。
- 微信群日报调度。
- LLM 连通性监控调度。

### 14.2 出站分发

`src/social/dispatch.js` 统一处理发送：

- Discord。
- 飞书。
- 微信公众号。
- 企业微信 webhook。
- ClawBot。
- Wechaty 群助手。

目标 ID 解析在 `src/social/targets.js`。

### 14.3 微信群助手

`src/social/wechaty-duty-group.js` 是项目中最复杂的社交模块。

主要能力：

- Wechaty/wechat4u 扫码登录。
- 群列表同步。
- 群成员刷新。
- @ 触发识别。
- 多人 @ 排队。
- 并行处理群消息。
- 回复时锁定真实 sender_id。
- 管理员身份识别。
- 安全命令守卫。
- 引用消息解析。
- 图片、语音、视频、文件媒体处理。
- 图片识别 Skill。
- 视频分析 Skill。
- 生图 Skill。
- 群消息入库。
- 群统计。
- 群日报/阶段总结。
- 群长期记忆。
- 成员永久记忆。
- 掉线二维码自动通知。

### 14.4 微信群安全机制

微信群默认有命令守卫：

- 普通群友不能要求读取本地文件。
- 不能执行命令。
- 不能外传密钥/隐私。
- 不能控制电脑。
- 不能做高危群管理操作。

管理员绕过基于精确 sender_id/稳定微信身份，不依赖昵称自称。

## 15. 语音系统

语音系统分为前端采集、ASR、TTS 三层。

### 15.1 本地 ASR

`src/voice/manager.js` 负责启动 Python 服务：

- `sensevoice_server.py`
- `whisper_server.py`

默认模型是 `sensevoice-small`。

服务监听本地 WebSocket 端口 `3723`。

### 15.2 ASR 能力

本地服务支持：

- 音频流识别。
- 静音门控。
- 低置信度过滤。
- 重复幻觉文本过滤。
- 声纹注册与确认。
- speaker rejected。
- 视频播放抗干扰。

### 15.3 云 ASR

`src/voice/cloud-asr.js` 作为后端签名代理，避免前端暴露密钥。

支持：

- 阿里云。
- 腾讯云。
- 讯飞。
- 火山。

### 15.4 TTS

`src/voice/tts-providers.js` 支持：

- 豆包/火山 TTS。
- MiniMax TTS。
- OpenAI TTS。
- ElevenLabs TTS。

`/tts/stream` 负责生成音频流。

## 16. 知识库系统

知识库核心在 `src/knowledge-base.js`，API 暴露在 `src/api.js`。

功能包括：

- URL/text/file 解析。
- PDF、Word、Excel 等文档解析。
- 来源列表。
- 来源更新。
- 删除。
- 重解析。
- 搜索。
- 全局与群组 scope。

微信群回复可以结合群组知识和本地群记忆。

## 17. 配置系统

配置由两部分组成：

- 根目录 `config.json` 或 Electron userData 下的 `config.json`。
- SQLite `config` 表。

`src/config.js` 是统一配置门面。

主要配置域：

- LLM provider。
- LLM profile。
- failover。
- temperature。
- security。
- Honcho。
- social。
- Wechaty 群助手。
- 微信群日报。
- ClawBot credentials。
- meme search。
- voice。
- TTS。
- embedding。
- web search。
- image generation Skill。
- image vision Skill。
- video analysis Skill。

## 18. 打包与更新

`package.json` 中的 `build` 字段定义 Electron Builder：

- `appId`: `com.xiaoyuanda.bailongma`
- `productName`: `Bailongma`
- `asar`: true
- `asarUnpack`:
  - better-sqlite3
  - `src/voice/**`
- Windows target:
  - NSIS x64
- macOS:
  - `build:mac`
  - `publish:mac`
- publish:
  - GitHub owner: `xiaoguiwucan`
  - repo: `BaiLongma`

Electron 主进程还支持：

- 正式包使用 `electron-updater`。
- 开发模式下可通过 GitHub release 检查并自动拉取更新。

## 19. 与上游分叉差异

本地项目声明 fork 自：

https://github.com/xiaoyuanda666-ship-it/BaiLongma

我对照了上游公开 `package.json`：

https://raw.githubusercontent.com/xiaoyuanda666-ship-it/BaiLongma/main/package.json

观察到当前本地代码已经不是简单同步上游，而是明显分叉演进。

主要差异：

| 项 | 上游公开 package | 当前本地 |
| --- | --- | --- |
| version | `2.1.300` | `0.4.92` |
| publish owner | `xiaoyuanda666-ship-it` | `xiaoguiwucan` |
| Honcho 依赖 | 无 | `@honcho-ai/sdk`、`honcho-ai`、内嵌 Honcho 服务 |
| Wechaty 群助手 | package 中无 Wechaty 依赖 | 新增 `wechaty`、`wechaty-puppet`、`wechaty-puppet-wechat4u` |
| 文档解析 | package 中无 mammoth/pdf-parse/xlsx | 新增 `mammoth`、`pdf-parse`、`xlsx` |
| 二维码 | package 中无 qrcode | 新增 `qrcode`、`qrcode-terminal` |
| Playwright | 上游为 devDependency | 本地为 dependency |
| macOS 打包 | 上游 package 未见 mac 脚本 | 本地新增 `build:mac`、`publish:mac` |
| NSIS 卸载数据 | 上游 `deleteAppDataOnUninstall=false` | 本地 `true` |

从源码目录看，本地新增或显著强化的方向包括：

- Wechaty 群助手。
- 微信群消息数据库。
- 群统计和日报。
- 成员永久记忆。
- 图片/视频分析 Skill。
- 文档知识库。
- ACUI 组件系统。
- 语音系统。
- Honcho 可选服务。
- macOS 打包发布。

## 20. 当前架构优点

1. 部署模型简单  
   Electron 启动后本地 Node 后端与 UI 在同一应用内运行，用户不需要单独部署服务。

2. 运行时闭环完整  
   消息、TICK、提醒、语音、社交事件、工具调用、记忆写入都在同一个 runtime 中闭环。

3. 本地优先  
   默认 SQLite + 本地记忆引擎，不强依赖 Honcho/Docker。

4. 可观测性较强  
   Brain UI 能看到思考流、工具调用、记忆、状态、配额、设置。

5. 工具能力覆盖广  
   文件、网络、浏览器、媒体、UI、社交、语音、提醒、技能等都被纳入工具系统。

6. 微信群场景打磨深入  
   群消息入库、群记忆、成员记忆、引用上下文、媒体解析、安全守卫都做了大量工程处理。

## 21. 当前架构风险

1. 大文件过载  
   `src/api.js`、`src/index.js`、`src/capabilities/executor.js`、`src/social/wechaty-duty-group.js` 承担过多职责。

2. 路由不可组合  
   API 全部集中在原生 `http.createServer` 条件分支中，后续新增接口会继续增加维护成本。

3. 数据库迁移分散  
   `initSchema()` 中持续堆叠 `ALTER TABLE`，长期看容易出现顺序和兼容性问题。

4. 社交模块复杂度高  
   微信群助手耦合登录、媒体、统计、记忆、安全、发送和 UI 状态，后续改动风险较高。

5. 工具执行器过大  
   `executor.js` 包含文件、命令、网络、媒体、UI、社交、Agent 等大量执行逻辑。

6. 编码可读性问题  
   当前控制台读取部分中文注释和 README 出现乱码，说明部分文件或输出环境存在编码兼容问题。

7. 测试分散  
   虽然有大量 `scripts/test-*` 和 smoke 脚本，但缺少统一测试入口与分层测试策略。

## 22. 后续重构建议

按风险收益排序：

1. 拆分 `src/api.js`
   - `api/settings.js`
   - `api/social.js`
   - `api/knowledge.js`
   - `api/voice.js`
   - `api/media.js`
   - `api/admin.js`

2. 拆分 `src/capabilities/executor.js`
   - `tools/filesystem.js`
   - `tools/web.js`
   - `tools/media.js`
   - `tools/ui.js`
   - `tools/social.js`
   - `tools/admin.js`

3. 梳理微信群助手 pipeline
   - receive
   - normalize
   - archive
   - guard
   - enrich context
   - enqueue
   - dispatch reply
   - post-process memory/stats

4. 建立显式数据库 migration 层
   - 用版本表记录 schema version。
   - 每个 migration 独立文件。
   - 保留幂等检查。

5. 统一测试入口
   - `npm test`
   - `npm run test:unit`
   - `npm run test:smoke`
   - `npm run test:social`

6. 给关键链路补充回归测试
   - 启动和激活。
   - `/message` 到 `/events`。
   - `send_message` fallback。
   - 记忆写入。
   - 微信群安全守卫。
   - 文件附件回复。
   - LLM failover。

## 23. 总结

当前 BaiLongma 是一个高度本地化、强 Agent 化的 Electron 单体应用。它把 LLM、工具调用、记忆系统、可视化 UI、社交平台、语音系统和知识库整合到同一运行时中。

从架构形态看，它不是“前后端分离 Web 项目”，也不是“简单 Electron 套壳网页”，而是一个桌面 Agent 操作系统雏形：

- Electron 负责本地桌面容器。
- Node 后端负责意识循环和工具执行。
- SQLite 负责记忆和状态。
- Brain UI 负责观测和配置。
- 社交/语音连接器负责外部输入输出。
- LLM 是决策核心。
- 工具系统是行动层。
- 记忆系统是长期状态层。

本地代码相对上游已经发生明显分叉，尤其在微信群助手、记忆、语音、ACUI、知识库、Honcho 可选服务和 macOS 打包方向有大量新增。后续如果继续扩展，最关键的工程任务不是新增功能，而是拆分大文件、固化迁移、稳定测试和隔离高风险社交链路。
