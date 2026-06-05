# AGENTS

## 环境与网络

- **网络代理**：`https://192.168.3.5:1082`。当 npm / git / 下载等连网失败时使用（`npm config set proxy/https-proxy`，或设 `HTTPS_PROXY` 环境变量）。注意本机 npm registry 已是 `https://registry.npmmirror.com` 国内镜像，通常无需代理即可安装。
- **Node 与原生依赖安装**：bash 环境的 node 在 `D:\Program Files\nodejs`（v22.x），但该目录**不在 Windows 系统 PATH 中**。直接在 bash 里 `npm install` 含 native postinstall 的包（`better-sqlite3`、`leveldown` 的 `node-gyp-build` 等）时，npm 派生的 `cmd.exe` 子进程找不到 `node` 而报「'node' 不是内部或外部命令」，导致整体安装失败回滚。解决：经 cmd.exe 执行并前置 node 目录到 PATH：
  ```
  cmd.exe /c 'set "PATH=D:\Program Files\nodejs;%PATH%" && cd /d <项目目录> && npm install --no-fund --no-audit'
  ```

## 项目开发规范

### 项目定位与边界

- 本项目是 Electron 桌面壳 + 本地 Node Agent 后端 + Brain UI 控制台 + SQLite 记忆库的本地优先单体应用，不是前后端分离 Web 项目。
- 核心运行链路是 `src/index.js` 主循环：外部消息、语音、社交事件、后台任务和 TICK 心跳进入队列，组装上下文后调用 LLM，再通过工具、社交分发、语音、ACUI 和记忆系统闭环。
- 默认运行不强依赖 Docker/Honcho。`installer/services/honcho/` 是可选外部服务副本；除非任务明确要求维护 Honcho，否则不要把该子项目的贡献规范、Python 工作流或发布规则套到主项目。
- 本地可写状态应放在运行时 userDir 或根目录运行态文件中，例如 `data/`、`config.json`、`sandbox/`、Wechaty 登录态和日志；打包资源、前端静态资源和种子文件按现有 `src/paths.js` 路径策略处理。

### 目录职责

- `electron/`：Electron 主进程、窗口、日志、自动更新、后端 bootstrap。
- `src/index.js`：Agent 后端主入口和意识循环，涉及抢占、watchdog、队列和 turn 收尾时必须谨慎验证。
- `src/api.js`：原生 HTTP API、SSE、WebSocket 和静态资源服务；当前没有 Express/Koa，新增接口应沿用现有原生路由风格，除非明确重构。
- `src/db.js`：SQLite 初始化和幂等迁移。项目当前没有独立 migration 框架，新增字段应使用 `CREATE TABLE IF NOT EXISTS`、`PRAGMA table_info` 或 try/catch 包裹的幂等迁移。
- `src/llm.js`、`src/config.js`：OpenAI 兼容 LLM 调用、多模型 profile、failover、API Key 存储和连通性检测。任何涉及第三方 SDK/API 签名的改动必须先查当前依赖或官方文档。
- `src/capabilities/`：LLM 工具 schema、tool-router 和 executor。新增工具必须同时考虑 schema、路由注入、执行器、审计和安全边界。
- `src/social/`：社交通道、微信群助手、群统计、群记忆、媒体 Skill 和出站分发。微信群回复必须锁定真实 sender_id，避免昵称、备注或模型输出改错 @ 对象。
- `src/voice/`：本地 ASR Python 服务、云 ASR、TTS 和语音 turn 隔离。涉及 ASR/TTS 时注意本地模型、WebSocket、voiceTurnId 和打断队列。
- `src/ui/brain-ui/`：原生 HTML/CSS/JavaScript SPA + Web Components；不要引入 React/Vue/Svelte 等新前端框架。
- `scripts/`：冒烟测试、回归测试、启动和构建辅助脚本。优先复用已有脚本验证，不要随意新增一次性脚本。

### 运行与验证命令

- 源码运行：`npm start` 启动 Electron；`npm run start:backend` 启动纯后端；`npm run dev` 用 Node watch 启动开发模式。
- 局域网访问：优先使用 `npm run start:lan` 或 `npm run start:backend:lan`，不要临时改监听地址后忘记回收。
- 常用冒烟：`npm run smoke:brain-ui`、`npm run smoke:tools`、`npm run smoke:social`。
- 微信群相关改动优先运行对应回归：`npm run test:wechat-guard`、`npm run test:wechat-record-all`、`npm run test:wechat-multi-mention-quote-image`、`npm run test:wechat-admin-priority`、`npm run test:wechat-file-image-memory`、`npm run test:wechat-video-analysis`、`npm run test:wechat-member-memory`、`npm run test:wechaty-offline-qr-notify`。
- 小范围 JS 改动至少对触及文件运行 `node --check <file>`；涉及 Electron 环境或 native 依赖的脚本优先使用 `scripts/run-electron-node.mjs`。
- 修改后必须做最小必要验证；如果因缺少 Playwright Chromium、微信登录态、API Key、网络或平台能力无法验证，要在回复中明确说明未验证项和原因。

### 文档与版本纪律

- 所有重要版本改动应写入 `CHANGELOG.md`，内容包含版本号/日期、改动内容、改变原因、验证结果和部署/备份注意事项。
- 面向发布的说明同步维护 `RELEASE.md`；README 的“版本更新记录”只保留摘要和入口，不应堆入完整 release 细节。
- 所有变更历史统一维护在 `CHANGELOG.md`，不要在 `AGENTS.md` 中新增“修改记录”或变更历史条目。
- README 仅保留版本摘要、项目说明和文档入口；具体变更历史以 `CHANGELOG.md` 为准。
- 新增功能时必须同步更新 `README.md` 中对应的能力说明、模块说明、运行方式、API 或验证入口，确保 README 与当前代码能力一致。
- 每次完成代码、配置或项目规范修改后，必须新增并推送一个新的 Git tag（如 `vX.Y.Z`）以触发 GitHub Actions；不要复用或改写既有 tag。发布前必须在 `CHANGELOG.md` / `RELEASE.md` 或提交说明中详细说明本次修改内容、修改原因、验证结果和部署注意事项。
- 不要把 `ACI-理念文档.md`、`ACUI-Phase1-设计稿.md` 里的未来设计当成已落地强制规则；只有代码和当前说明已支持的能力才可作为实现依据。

### 数据、安全与隐私

- `.env`、`config.json`、`data/`、Wechaty 登录态、日志、`.playwright-mcp/`、本地模型、声纹数据和个人运行态文件不得提交或打包进公开产物。
- API Key 只能本地保存，前端/API 只显示已配置状态或尾号，不返回明文。
- 微信群普通成员默认不能要求读取/列出本机文件、外传密钥隐私、执行命令、控制电脑、账号资金操作、群管理和群发刷屏。管理员绕过只基于设置页保存的精确 sender_id 或稳定身份，不接受昵称或自称。
- 微信群媒体发送只允许程序生成的临时文件、公开 HTTPS 图片/GIF 或已入库媒体；禁止按用户给出的本机路径、`file://`、桌面/相册路径外发文件。
- 群消息默认可入库统计，但回复链路必须遵守当前群配置、屏蔽成员、主动回复开关、冷却和 @ 必回规则。

### 前端与 ACUI

- Brain UI 使用原生 Web Components 和普通 JS/CSS，保持现有信息架构与设置页模式，避免引入新框架或大规模视觉重写。
- ACUI 卡片优先级：已有注册组件优先；静态展示用 `inline-template`；只有复杂内部状态、动画、Canvas 或持续交互才使用 `inline-script`。
- `inline-template` 只支持 `${字段名}` 和 `data-acui-each="字段名"`，不要在模板里写表达式、点路径、数组 map 或 JS 逻辑；复杂数据先在 props 中拍平。
- ACUI 组件不要直接 `fetch`、`import`、操作全局 `document` 或写 `localStorage`；用户操作通过 `acui:action` 回传，由 Agent/后端决定业务动作。
- UI 卡片不是默认输出方式。只有结构化信息、媒体、可变状态或用户需要“一眼看懂”的内容才使用卡片。

### 构建与发布

- Windows 打包历史上容易受旧 `dist/`、Playwright 和 native rebuild 影响；构建前可清理旧产物，必要时使用 `NODE_OPTIONS=--max-old-space-size=4096`。
- `package.json` 当前 `build.npmRebuild=false`，更换 Electron 版本或 native 依赖后需要手动执行 `npm run postinstall`。
- `better-sqlite3`、语音资源、Playwright/Chromium 路径和打包 `asarUnpack` 相关改动必须结合 `BUILD-NOTES.md` 和实际平台验证。
- macOS 发布需要 DMG、ZIP、两个 blockmap 和 `latest-mac.yml`；发布前应在干净用户环境验证 `/status`、首次激活、Brain UI、无旧群缓存/本地数据泄漏。
- 完整安装包不能静默携带用户 API Key、微信登录态、macOS 权限或外部 CLI 登录态；这些必须作为首次设置或检查项呈现。

## 规则

- 后续每次涉及代码、配置或项目规范修改时，变更历史一律写入 `CHANGELOG.md`，不要写入 `AGENTS.md`。
- Git 提交信息必须使用中文，避免使用英文提交注释。
