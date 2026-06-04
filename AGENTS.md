# AGENTS

## 修改记录

- 2026-06-03：补充 `.gitignore`，忽略本地配置、缓存、数据库、虚拟环境和临时产物，避免把运行态文件推到 GitHub。
- 2026-06-04：修复群聊总结发图回退文字的问题。原因是 `src/social/wechat-group-report-renderer.js` 只在 macOS 路径里找 Playwright Chromium，Windows 下默认可执行文件失效会导致海报渲染失败。已补充 Windows/macOS/Linux 的 Chromium/Edge/Playwright 缓存路径兜底，渲染脚本已验证可输出 PNG。
- 2026-06-04：修复微信群回复时 @ 人偶发不准确的问题。`src/social/wechaty-duty-group.js` 的 @ 显示名选择已改为当前群昵称/成员表 `room_alias` 优先于传入的旧昵称或联系人备注，并补充回归测试。
- 2026-06-04：按要求把当前仓库 Git 提交用户配置为 `yideng966 <yideng966@users.noreply.github.com>`，并准备重写历史提交的作者/提交者信息后推送 GitHub。
- 2026-06-04：参考 `D:\JiangShuai\temp\wechat-chat-summary-image` 重新实现群聊总结图片设计和内容结构。迁移 720px 手机长图、白底、单列布局，并输出时间范围、总量、主要话题、关键时间线、活跃成员和数据限制说明；数据来源继续使用本框架 `getWeChatGroupStats()`，不接入 `wechat-cli`。
- 2026-06-04：继续对齐 `wechat-chat-summary-image` 的总结内容要求，群聊总结长图的主要话题改为展示关键词出现次数和来自本框架 `important/recent` 消息的证据摘录，避免只输出装饰性话题名。
- 2026-06-04：群聊总结长图补充明确的「一句话总结」标签，确保输出结构与参考 skill 的最小内容项一致。
- 2026-06-04：优化群聊总结长图的话题提取逻辑，中文消息改为统计 2-6 字短语候选，提升“主要话题”对重复中文主题的聚合能力。
- 2026-06-04：为群聊总结长图主要话题增加包含关系去重，避免相邻中文短语重复刷屏。
- 2026-06-04：准备把微信群内 @ 助手触发的“总结群聊/汇总聊天记录”等自然语言请求接入群聊总结长图渲染和图片发送链路，图片失败时再回退文本。
- 2026-06-04：记录本机网络代理（`192.168.3.5:1082`）与 npm 原生依赖安装的 node PATH 注意事项（见下「环境与网络」）；微信群能力已以插件形式移植到 BaiLongma 仓库（`feature/wechat-group-plugin` 分支）。

## 环境与网络

- **网络代理**：`https://192.168.3.5:1082`。当 npm / git / 下载等连网失败时使用（`npm config set proxy/https-proxy`，或设 `HTTPS_PROXY` 环境变量）。注意本机 npm registry 已是 `https://registry.npmmirror.com` 国内镜像，通常无需代理即可安装。
- **Node 与原生依赖安装**：bash 环境的 node 在 `D:\Program Files\nodejs`（v22.x），但该目录**不在 Windows 系统 PATH 中**。直接在 bash 里 `npm install` 含 native postinstall 的包（`better-sqlite3`、`leveldown` 的 `node-gyp-build` 等）时，npm 派生的 `cmd.exe` 子进程找不到 `node` 而报「'node' 不是内部或外部命令」，导致整体安装失败回滚。解决：经 cmd.exe 执行并前置 node 目录到 PATH：
  ```
  cmd.exe /c 'set "PATH=D:\Program Files\nodejs;%PATH%" && cd /d <项目目录> && npm install --no-fund --no-audit'
  ```

## 规则

- 后续每次涉及代码或配置修改时，先在这里补一条简短修改记录，再继续提交。
