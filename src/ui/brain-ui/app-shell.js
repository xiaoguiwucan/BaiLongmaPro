import { createHotspotPanel } from './hotspot-panel.js';
import { createPersonCardPanel } from './person-card-panel.js';
import { createDocPanel } from './doc-panel.js';

const createGraphStage = () => `
<div class="grid-overlay"></div>
<svg id="graph" aria-label="Longma 记忆节点图"></svg>
`;

const createPrimaryPanel = () => `
<aside id="panel-l1" class="panel">
  <header class="panel-identity">
    <div class="brand-mark"></div>
    <div class="brand-copy">
      <div class="eyebrow">认知界面</div>
      <div class="brand-title" id="agent-brand-name">Longma AI Agent</div>
    </div>
    <button class="voice-btn" id="voice-btn" title="麦克风 开/关" type="button">🎤</button>
    <button class="hotspot-btn" id="hotspot-btn" title="实时舆情/热点平台 (H)" type="button">热</button>
    <button class="video-btn" id="video-btn" title="视频模式 (V)" type="button">⊞</button>
    <button class="music-btn" id="music-btn" title="音乐模式 (M)" type="button" hidden>♪</button>
    <button class="settings-btn" id="settings-btn" title="设置" type="button">⚙</button>
  </header>

  <div class="stream-meta">
    <div>
      <div class="stream-title-text">用户消息处理器</div>
      <!-- <div class="stream-subtitle">user message · react</div> -->
    </div>
    <span class="pill" id="pill-l1">实时</span>
  </div>

  ${createVoicePanel()}

  <div class="legend" id="legend"></div>

  <div class="stream">
    <div class="stream-inner" id="si-l1"></div>
  </div>

  <div class="panel-actions">
    <button class="reset-view" id="reset-view-btn" type="button">重置节点图</button>

    <section class="physics-control" id="physics-control">
      <button class="physics-toggle" id="physics-toggle" type="button" aria-expanded="false">
        <span class="physics-toggle-label">图谱调节</span>
        <span class="physics-toggle-icon">▾</span>
      </button>
      <div class="physics-panel" id="physics-panel">
        <div class="physics-panel-inner">
          <div class="physics-field">
            <div class="physics-field-head">
              <label class="physics-field-label" for="gravity-slider">引力</label>
              <span class="physics-field-value" id="gravity-value">1.00x</span>
            </div>
            <input class="physics-slider" id="gravity-slider" type="range" min="0" max="5" step="0.02" value="2">
          </div>
          <div class="physics-field">
            <div class="physics-field-head">
              <label class="physics-field-label" for="repulsion-slider">斥力</label>
              <span class="physics-field-value" id="repulsion-value">1.00x</span>
            </div>
            <input class="physics-slider" id="repulsion-slider" type="range" min="0" max="5" step="0.02" value="2">
          </div>
          <div class="physics-field">
            <div class="physics-field-head">
              <label class="physics-field-label" for="node-size-slider">节点大小</label>
              <span class="physics-field-value" id="node-size-value">1.00x</span>
            </div>
            <input class="physics-slider" id="node-size-slider" type="range" min="0" max="5" step="0.02" value="2">
          </div>
        </div>
      </div>
    </section>
  </div>
</aside>
`;

const createSecondaryPanel = () => `
<aside id="panel-l2" class="panel">
  <header class="panel-stats">
    <div class="stat">
      <span class="stat-label">状态</span>
      <div class="stat-value live" id="conn-state"><span class="live-dot"></span>Token流</div>
    </div>
    <div class="stat">
      <span class="stat-label">节点</span>
      <div class="stat-value" id="node-count">0</div>
    </div>
    <div class="stat">
      <span class="stat-label">连线</span>
      <div class="stat-value" id="link-count">0</div>
    </div>
    <div class="stat">
      <span class="stat-label">tok/s</span>
      <div class="stat-value" id="tok-rate">—</div>
    </div>
  </header>

  <!-- 专注帧 UI 已隐藏（后端 focus stack 仍在工作，给 LLM 注入上下文）。
       要恢复观察面板时把对应 HTML 还原即可——app.js 渲染逻辑保留着，靠 getElementById 返回 null 自动 no-op。 -->

  <div class="stream-meta">
    <div>
      <div class="stream-title-text">自主行动机制 · Tick</div>
      <div class="stream-subtitle">心跳 · 思考 · 工具</div>
    </div>
    <span class="pill pill-warm" id="pill-l2">流式传输</span>
  </div>

  <div class="stream">
    <div class="stream-inner" id="si-l2"></div>
  </div>
</aside>
`;

const createConsole = () => `
<section class="console" id="chat-area">
  <div id="chat-history">
    <div id="chat-messages"></div>
  </div>
  <div id="input-row">
    <span class="prompt-mark">▸</span>
    <input id="msg-input" type="text" placeholder="向 Longma 发送消息…" autocomplete="off">
    <button id="send-btn" type="button">发送</button>
  </div>
</section>
`;

const createThemeSwitcher = () => `
<div class="theme-switcher" id="theme-switcher">
  <div class="theme-dot active" data-t="midnight" title="Midnight Steel"></div>
  <div class="theme-dot" data-t="phosphor" title="Phosphor CRT"></div>
  <div class="theme-dot" data-t="violet" title="Violet Lab"></div>
  <div class="theme-dot" data-t="rose" title="Rose Dusk"></div>
  <div class="theme-dot" data-t="arctic" title="Arctic"></div>
  <div class="theme-dot" data-t="sand" title="Warm Sand"></div>
</div>
`;

const createTooltip = () => `
<div id="tip"></div>
`;

const createSettingsModal = () => `
<div class="settings-overlay" id="settings-overlay" hidden>
  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
    <div class="settings-header">
      <span class="settings-title">设置</span>
      <button class="settings-close" id="settings-close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="settings-body">

      <!-- 侧栏导航 -->
      <nav class="settings-nav">
        <button class="settings-nav-item active" data-tab="appearance" type="button">外观</button>
        <button class="settings-nav-item" data-tab="llm" type="button">LLM 模型</button>
        <button class="settings-nav-item" data-tab="media" type="button">媒体能力</button>
        <button class="settings-nav-item" data-tab="social" type="button">社交媒体</button>
        <button class="settings-nav-item" data-tab="wechat-groups" type="button">微信群助手</button>
        <button class="settings-nav-item" data-tab="database" type="button">数据库</button>
        <button class="settings-nav-item" data-tab="knowledge" type="button">知识库</button>
        <button class="settings-nav-item" data-tab="skills" type="button">多模态能力</button>
        <button class="settings-nav-item" data-tab="voice" type="button">语音识别</button>
        <button class="settings-nav-item" data-tab="web-search" type="button">网络能力</button>
        <button class="settings-nav-item" data-tab="security" type="button">安全沙箱</button>
        <button class="settings-nav-item" data-tab="update" type="button">更新</button>
      </nav>

      <!-- 内容区 -->
      <div class="settings-content">

        <!-- ── 外观 tab ── -->
        <div class="settings-tab active" data-tab="appearance">
          <div class="settings-section">
            <div class="settings-section-label">主题</div>
            ${createThemeSwitcher()}
          </div>
          <div class="settings-section">
            <div class="settings-section-label">记忆节点图</div>
            <p class="settings-hint">开启后在背景显示记忆节点力导向图，会占用额外 CPU/GPU 资源，低配设备建议关闭。修改后需刷新页面生效。</p>
            <div class="settings-row">
              <label class="settings-label" for="settings-memory-graph-toggle">显示记忆节点图</label>
              <input id="settings-memory-graph-toggle" type="checkbox" style="width:auto;flex:none;">
              <span class="settings-feedback" id="settings-memory-graph-feedback" style="margin-left:8px;"></span>
            </div>
          </div>
        </div>

        <!-- ── LLM 模型 tab ── -->
        <div class="settings-tab llm-settings-tab" data-tab="llm">
          <div class="llm-center-shell">
            <section class="settings-section llm-center-overview">
              <div class="llm-overview-copy">
                <div class="settings-section-label">模型配置中心</div>
                <div class="settings-config-row">
                  <span class="settings-config-type">LLM</span>
                  <span class="settings-config-info" id="settings-cfg-llm">—</span>
                  <span class="settings-config-dot" id="settings-cfg-llm-dot"></span>
                </div>
                <p class="settings-hint">集中管理对话模型池。当前模型就是全局默认；微信群可继承全局配置，也可指定专属 LLM。</p>
                <div class="llm-active-strip" id="settings-llm-current-profile">当前使用：—</div>
              </div>
              <div class="llm-summary-grid" id="settings-llm-summary-grid">
                <div class="llm-summary-card primary">
                  <small>当前模型</small>
                  <b id="settings-llm-summary-current">—</b>
                </div>
                <div class="llm-summary-card">
                  <small>已保存</small>
                  <b id="settings-llm-summary-total">0 个</b>
                </div>
                <div class="llm-summary-card ok">
                  <small>连通</small>
                  <b id="settings-llm-summary-ok">0 个</b>
                </div>
                <div class="llm-summary-card bad">
                  <small>失败 / 未知</small>
                  <b id="settings-llm-summary-bad">0 / 0</b>
                </div>
                <div class="llm-summary-card">
                  <small>最近检测</small>
                  <b id="settings-llm-summary-last">—</b>
                </div>
              </div>
            </section>

            <div class="llm-center-layout">
              <section class="settings-section llm-model-pool-section">
                <div class="llm-section-head">
                  <div>
                    <div class="settings-section-label">模型池优先级</div>
                    <p class="settings-hint">排在上面的优先使用。关闭后不参与自动切换；点击“设为当前”会成为全局默认模型。</p>
                  </div>
                  <span id="settings-llm-batch-count">已选 0 个</span>
                </div>
                <div class="llm-batch-toolbar">
                  <div class="llm-batch-actions">
                    <button class="settings-save-btn" id="settings-llm-batch-all" type="button">全选</button>
                    <button class="settings-save-btn" id="settings-llm-batch-clear" type="button">清空选择</button>
                    <button class="settings-save-btn" id="settings-llm-test-selected" type="button">测试选中</button>
                    <button class="settings-save-btn primary" id="settings-llm-test-all" type="button">测试全部</button>
                  </div>
                </div>
                <div class="llm-batch-result" id="settings-llm-batch-result">批量测试结果会显示在这里。</div>
                <div class="llm-profile-list" id="settings-llm-pool-list">
                  <div class="llm-profile-empty">还没有模型配置，先在右侧添加一个。</div>
                </div>
              </section>

              <aside class="llm-center-side">
                <section class="settings-section llm-editor-section" id="settings-llm-editor-section">
                  <div class="settings-section-label">新增 / 编辑模型</div>
                  <input id="settings-llm-editing-id" type="hidden" value="">
                  <div class="settings-row">
                    <label class="settings-label" for="settings-llm-profile-name">名称</label>
                    <input class="settings-input" id="settings-llm-profile-name" type="text" placeholder="如：主力 DeepSeek、备用 Qwen、公司 OpenAI">
                  </div>
                  <div class="settings-row">
                    <label class="settings-label" for="settings-provider-select">提供商</label>
                    <select class="settings-select" id="settings-provider-select">
                      <option value="auto">自动识别</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="minimax">MiniMax</option>
                      <option value="openai">OpenAI</option>
                      <option value="qwen">Qwen / 阿里百炼</option>
                      <option value="moonshot">Moonshot</option>
                      <option value="zhipu">智谱</option>
                      <option value="mimo">小米 MiMo</option>
                      <option value="custom">自定义端点（本地/其他）</option>
                    </select>
                  </div>
                  <div class="settings-row" id="settings-model-row">
                    <label class="settings-label" for="settings-model-select">模型</label>
                    <select class="settings-select" id="settings-model-select"></select>
                  </div>
                  <div id="settings-custom-llm-section" style="display:none;">
                    <div class="settings-row">
                      <label class="settings-label" for="settings-custom-baseurl">Base URL</label>
                      <input class="settings-input" id="settings-custom-baseurl" type="text" placeholder="如 http://localhost:11434/v1">
                    </div>
                    <div class="settings-row">
                      <label class="settings-label" for="settings-custom-model">模型名称</label>
                      <input class="settings-input" id="settings-custom-model" type="text" placeholder="如 llama3.2, qwen2.5, mistral">
                    </div>
                  </div>
                  <div class="settings-row">
                    <label class="settings-label" for="settings-llm-key">API Key</label>
                    <input class="settings-input" id="settings-llm-key" type="password" placeholder="新增必填；编辑时留空表示继续使用原 Key" autocomplete="new-password">
                  </div>
                  <div class="settings-row-action">
                    <button class="settings-save-btn" id="settings-save-llm" type="button">保存到模型池</button>
                    <button class="settings-save-btn" id="settings-save-llm-current" type="button">保存并设为当前</button>
                    <span class="settings-feedback" id="settings-llm-feedback"></span>
                  </div>
                </section>

                <section class="settings-section llm-routing-section">
                  <div class="settings-section-label">微信群模型路由</div>
                  <div class="llm-routing-panel">
                    <div class="llm-routing-head">
                      <div>
                        <b>全局默认由当前模型决定</b>
                        <em id="settings-llm-routing-global">全局默认：正在读取…</em>
                      </div>
                      <span id="settings-llm-routing-count">—</span>
                    </div>
                    <div class="llm-routing-list" id="settings-llm-routing-list">
                      <div class="llm-profile-empty">正在读取微信群与模型池…</div>
                    </div>
                    <div class="settings-row-action">
                      <button class="settings-save-btn primary" id="settings-save-llm-routing" type="button">保存群路由</button>
                      <span class="settings-feedback" id="settings-llm-routing-feedback"></span>
                    </div>
                  </div>
                </section>

                <section class="settings-section llm-policy-section">
                  <div class="settings-section-label">策略与温度</div>
                  <div class="llm-failover-panel">
                    <label class="llm-failover-toggle">
                      <input id="settings-llm-failover-enabled" type="checkbox">
                      <span>
                        <b>额度不足/限流时自动切换备用模型</b>
                        <em>只在回答尚未输出时切换，避免重复播报和内容断裂。</em>
                      </span>
                    </label>
                    <div class="settings-row compact">
                      <label class="settings-label" for="settings-llm-failover-cooldown">失败冷却</label>
                      <select class="settings-select" id="settings-llm-failover-cooldown">
                        <option value="60">1 分钟</option>
                        <option value="180">3 分钟（推荐）</option>
                        <option value="300">5 分钟</option>
                        <option value="600">10 分钟</option>
                      </select>
                      <label class="settings-label" for="settings-llm-failover-attempts">最多尝试</label>
                      <select class="settings-select" id="settings-llm-failover-attempts">
                        <option value="2">2 个模型</option>
                        <option value="3">3 个模型</option>
                        <option value="4">4 个模型（推荐）</option>
                        <option value="6">6 个模型</option>
                      </select>
                    </div>
                    <div class="settings-row-action">
                      <button class="settings-save-btn" id="settings-save-llm-failover" type="button">保存策略</button>
                      <span class="settings-feedback" id="settings-llm-failover-feedback"></span>
                    </div>
                  </div>
                  <div class="llm-temperature-panel">
                    <div class="llm-temperature-head">
                      <b>模型温度</b>
                      <span id="settings-temperature-val">0.50</span>
                    </div>
                    <input type="range" id="settings-temperature" min="0" max="1.5" step="0.05" value="0.5">
                    <div class="settings-row-action">
                      <button class="settings-save-btn" id="settings-save-temperature" type="button">保存温度</button>
                      <span class="settings-feedback" id="settings-temperature-feedback"></span>
                    </div>
                  </div>
                </section>
              </aside>
            </div>

            <section class="settings-section llm-monitor-section">
              <div class="settings-section-label">渠道连通通知</div>
              <p class="settings-hint">定时检测你选择的 LLM 渠道是否还能连通，并按策略把结果发到指定微信群；每个通知群都可以继续选择要 @ 的群成员。</p>
              <div class="llm-monitor-panel">
                <div class="llm-monitor-head">
                  <label class="llm-failover-toggle">
                    <input id="settings-llm-monitor-enabled" type="checkbox">
                    <span>
                      <b>启用 LLM 渠道连通通知</b>
                      <em>建议选择“异常/恢复变化通知”，避免群里被正常巡检刷屏。</em>
                    </span>
                  </label>
                  <div class="llm-monitor-status" id="settings-llm-monitor-status">尚未检测</div>
                </div>
                <div class="llm-monitor-controls">
                  <label>通知间隔
                    <select class="settings-select llm-monitor-select" id="settings-llm-monitor-interval">
                      <option value="5">每 5 分钟</option>
                      <option value="15">每 15 分钟</option>
                      <option value="30">每 30 分钟</option>
                      <option value="60">每 1 小时（推荐）</option>
                      <option value="180">每 3 小时</option>
                      <option value="360">每 6 小时</option>
                      <option value="720">每 12 小时</option>
                      <option value="1440">每天一次</option>
                    </select>
                  </label>
                  <label>通知策略
                    <select class="settings-select llm-monitor-select" id="settings-llm-monitor-mode">
                      <option value="changes">异常/恢复变化通知（推荐）</option>
                      <option value="failures">只通知不通渠道</option>
                      <option value="all">每次检测都通知</option>
                    </select>
                  </label>
                </div>
                <div class="llm-monitor-picker-grid">
                  <div class="llm-monitor-picker">
                    <div class="llm-monitor-picker-head"><b>选择检测渠道</b><span id="settings-llm-monitor-profile-count">—</span></div>
                    <div class="llm-monitor-list" id="settings-llm-monitor-profile-list">
                      <div class="llm-profile-empty">正在读取模型池…</div>
                    </div>
                  </div>
                  <div class="llm-monitor-picker">
                    <div class="llm-monitor-picker-head"><b>选择通知微信群</b><span id="settings-llm-monitor-group-count">—</span></div>
                    <div class="llm-monitor-list" id="settings-llm-monitor-group-list">
                      <div class="llm-profile-empty">先登录/恢复微信群助手后选择通知群。</div>
                    </div>
                  </div>
                </div>
                <div class="llm-monitor-result" id="settings-llm-monitor-result">检测结果会显示在这里。</div>
                <div class="settings-row-action">
                  <button class="settings-save-btn" id="settings-save-llm-monitor" type="button">保存通知设置</button>
                  <button class="settings-save-btn" id="settings-test-llm-monitor" type="button">立即检测</button>
                  <button class="settings-save-btn primary" id="settings-notify-llm-monitor" type="button">立即检测并通知</button>
                  <span class="settings-feedback" id="settings-llm-monitor-feedback"></span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <!-- ── 媒体能力 tab ── -->
        <div class="settings-tab" data-tab="media">
          <div class="settings-section">
            <div class="settings-section-label">当前状态</div>
            <div class="settings-config-row">
              <span class="settings-config-type">媒体</span>
              <span class="settings-config-info" id="settings-cfg-media">—</span>
              <span class="settings-config-dot" id="settings-cfg-media-dot"></span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">MiniMax API Key</div>
            <div class="settings-row">
              <label class="settings-label" for="settings-minimax-key">API Key</label>
              <input class="settings-input" id="settings-minimax-key" type="password" placeholder="填入 MiniMax API Key…" autocomplete="new-password">
            </div>
            <div class="settings-row-action">
              <button class="settings-save-btn" id="settings-save-minimax" type="button">保存</button>
              <span class="settings-feedback" id="settings-minimax-feedback"></span>
            </div>
          </div>
        </div>

        <!-- ── 社交媒体 tab ── -->
        <div class="settings-tab" data-tab="social">
          <div class="settings-section">
            <div class="settings-section-label">Discord</div>
            <div class="settings-platform-status" id="social-status-discord"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-discord-token">Bot Token</label>
              <input class="settings-input" id="social-discord-token" type="password" placeholder="留空保持原值不变…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">飞书</div>
            <div class="settings-platform-status" id="social-status-feishu"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-feishu-appid">App ID</label>
              <input class="settings-input" id="social-feishu-appid" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-feishu-secret">App Secret</label>
              <input class="settings-input" id="social-feishu-secret" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-feishu-token">Verify Token</label>
              <input class="settings-input" id="social-feishu-token" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">微信公众号</div>
            <div class="settings-platform-status" id="social-status-wechat"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-wechat-appid">App ID</label>
              <input class="settings-input" id="social-wechat-appid" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-wechat-secret">App Secret</label>
              <input class="settings-input" id="social-wechat-secret" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-wechat-token">Token</label>
              <input class="settings-input" id="social-wechat-token" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">企业微信</div>
            <div class="settings-platform-status" id="social-status-wecom"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-wecom-botkey">Bot Key</label>
              <input class="settings-input" id="social-wecom-botkey" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-wecom-token">Incoming Token</label>
              <input class="settings-input" id="social-wecom-token" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">微信 ClawBot（个人微信）</div>
            <div class="settings-platform-status" id="social-status-clawbot">○ 未连接</div>
            <p class="settings-hint">点击「连接微信」后会生成二维码，用微信扫码即可绑定个人账号。凭证保存在本地，重启后无需重新扫码。</p>
            <div class="settings-row" style="gap:8px;flex-wrap:wrap;">
              <button class="settings-save-btn" id="clawbot-connect-btn" type="button" style="width:auto;padding:0 16px;">连接微信</button>
              <button class="settings-save-btn" id="clawbot-logout-btn" type="button" style="width:auto;padding:0 16px;background:var(--danger,#c0392b);">断开</button>
            </div>
            <div id="clawbot-qr-area" style="display:none;margin-top:12px;text-align:center;">
              <p class="settings-hint" style="margin-bottom:8px;">用微信扫描下方二维码：</p>
              <img id="clawbot-qr-img" src="" alt="微信二维码" style="width:200px;height:200px;border:1px solid var(--border);border-radius:4px;">
              <p class="settings-hint" style="margin-top:6px;font-size:11px;" id="clawbot-qr-hint">等待扫码…</p>
            </div>
            <span class="settings-feedback" id="clawbot-feedback"></span>
          </div>
          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-social" type="button">保存所有</button>
            <span class="settings-feedback" id="settings-social-feedback"></span>
          </div>
        </div>


        <!-- ── 数据库 tab ── -->
        <div class="settings-tab" data-tab="database">
          <div class="settings-section database-settings">
            <div class="settings-section-label">数据库与知识库容量</div>
            <p class="settings-hint">这里集中查看本地数据库、微信群聊天记录、知识库记忆和媒体文件占用。微信群助手页只保留连接与回复设置，数据管理统一放到这里。</p>
            <div class="db-hero-card">
              <div>
                <small>总占用</small>
                <strong id="db-total-size">—</strong>
                <span id="db-path-hint">正在读取本机数据库…</span>
              </div>
              <div class="db-hero-actions"><button class="settings-save-btn primary" id="db-refresh-btn" type="button">刷新容量</button><button class="settings-save-btn" id="db-vector-backfill-btn" type="button">补齐向量</button><button class="settings-save-btn" id="db-memory-extract-btn" type="button">提取成员记忆</button><button class="settings-save-btn" id="db-honcho-sync-btn" type="button">同步到 Honcho</button><button class="settings-save-btn" id="db-export-all-btn" type="button">导出备份 JSON</button><label class="settings-save-btn"><input id="db-import-file" type="file" accept="application/json" hidden>导入 JSON</label></div>
            </div>
            <div class="db-health-grid" id="db-health-grid"></div>
            <div class="db-overview-grid" id="db-overview-grid">
              <div class="wechaty-empty">正在加载数据库统计…</div>
            </div>
            <div class="db-archive-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">聊天记录与图片解析范围</div>
                  <p class="settings-hint compact">自由回复群默认纳入有效记录范围；历史旧数据保留。</p>
                </div>
                <div class="db-image-actions">
                  <button class="settings-save-btn ghost" id="db-archive-sync-free-btn" type="button">同步自由回复群</button>
                  <button class="settings-save-btn primary" id="db-archive-save-record-btn" type="button">保存记录群</button>
                  <button class="settings-save-btn" id="db-archive-save-image-btn" type="button">保存图片解析群</button>
                </div>
              </div>
              <div class="db-archive-controls">
                <label class="db-archive-toggle"><span>启用记录范围</span><span class="settings-toggle"><input id="db-archive-enabled" type="checkbox"><span class="settings-toggle-track"></span></span></label>
                <label class="db-archive-toggle"><span>记录聊天内容</span><span class="settings-toggle"><input id="db-archive-record-text" type="checkbox"><span class="settings-toggle-track"></span></span></label>
                <label class="db-archive-toggle"><span>保存媒体文件</span><span class="settings-toggle"><input id="db-archive-record-media" type="checkbox"><span class="settings-toggle-track"></span></span></label>
                <label class="db-archive-toggle"><span>解析图片内容</span><span class="settings-toggle"><input id="db-archive-parse-images" type="checkbox"><span class="settings-toggle-track"></span></span></label>
                <label class="db-archive-toggle"><span>自由回复群自动纳入</span><span class="settings-toggle"><input id="db-archive-default-free" type="checkbox"><span class="settings-toggle-track"></span></span></label>
              </div>
              <div class="db-archive-grid">
                <label>搜索群
                  <input class="settings-input" id="db-archive-search" placeholder="输入群名筛选">
                </label>
                <label>长消息分块大小
                  <input class="settings-input" id="db-archive-chunk-size" type="number" min="500" max="8000" step="100">
                </label>
                <label>分块重叠
                  <input class="settings-input" id="db-archive-chunk-overlap" type="number" min="0" max="1000" step="20">
                </label>
              </div>
              <div class="db-archive-summary" id="db-archive-summary">正在读取记录范围…</div>
              <div class="db-archive-group-list" id="db-archive-group-list">
                <div class="wechaty-empty">正在加载群组…</div>
              </div>
            </div>
            <div class="wechaty-backup-panel">
              <div class="wechaty-records-head">
                <div>
                  <h5>群组备份与迁移</h5>
                  <p>按群导出聊天、图片解析、群记忆和成员记忆；导入前会校验当前微信号是否仍拥有对应群。</p>
                </div>
                <div class="wechaty-records-actions">
                  <button class="settings-save-btn ghost" id="wechaty-backup-refresh-btn" type="button">刷新群数据</button>
                  <button class="settings-save-btn primary" id="wechaty-backup-export-btn" type="button">导出选中</button>
                  <label class="settings-save-btn ghost" for="wechaty-backup-import-file">选择备份</label>
                  <input id="wechaty-backup-import-file" type="file" accept="application/json,.json" hidden>
                </div>
              </div>
              <div class="wechaty-backup-summary" id="wechaty-backup-summary">尚未加载可备份群组。</div>
              <div class="wechaty-backup-layout">
                <section class="wechaty-backup-column">
                  <div class="wechaty-backup-toolbar">
                    <input class="settings-input" id="wechaty-backup-search" type="search" placeholder="搜索群名">
                    <button class="settings-save-btn ghost" id="wechaty-backup-select-all-btn" type="button">全选</button>
                    <button class="settings-save-btn ghost" id="wechaty-backup-clear-btn" type="button">清空</button>
                  </div>
                  <div class="wechaty-backup-options">
                    <label><input id="wechaty-backup-include-media" type="checkbox" checked>包含图片文件</label>
                    <label><input id="wechaty-backup-include-deleted" type="checkbox" checked>包含已删除记忆</label>
                  </div>
                  <div class="wechaty-backup-group-list" id="wechaty-backup-group-list"></div>
                </section>
                <section class="wechaty-backup-column">
                  <div class="wechaty-backup-import-head">
                    <label><input id="wechaty-backup-allow-name-match" type="checkbox">允许唯一群名匹配</label>
                    <button class="settings-save-btn primary" id="wechaty-backup-import-btn" type="button" disabled>导入选中</button>
                  </div>
                  <div class="wechaty-backup-preview" id="wechaty-backup-preview">选择备份 JSON 后显示匹配结果。</div>
                  <div class="wechaty-backup-result" id="wechaty-backup-result"></div>
                </section>
              </div>
            </div>
            <div class="db-index-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">长期记忆索引状态</div>
                  <p class="settings-hint compact">FTS、长消息 chunk、本地记忆和 embedding 补齐进度。</p>
                </div>
                <div class="db-image-actions">
                  <button class="settings-save-btn ghost" id="db-index-refresh-btn" type="button">刷新索引</button>
                  <button class="settings-save-btn primary" id="db-index-backfill-btn" type="button">开始补齐长期记忆索引</button>
                </div>
              </div>
              <div class="db-index-grid" id="db-index-grid">
                <div class="wechaty-empty">正在读取长期记忆索引状态…</div>
              </div>
            </div>
            <div class="db-image-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">微信群图片解析库</div>
                  <p class="settings-hint compact">所有已接入微信群收到的图片会自动入库并后台识图；这里可以实时查看解析进度、筛选图片、浏览缩略图和识图内容。</p>
                </div>
                <div class="db-image-actions">
                  <button class="settings-save-btn primary" id="db-image-refresh-btn" type="button">刷新图片库</button>
                  <button class="settings-save-btn" id="db-image-process-btn" type="button">解析待处理</button>
                </div>
              </div>
              <div class="db-image-progress" id="db-image-progress">
                <div class="wechaty-empty">正在读取图片解析状态…</div>
              </div>
              <div class="db-image-filters">
                <label>群组
                  <select class="settings-select" id="db-image-group"></select>
                </label>
                <label>解析状态
                  <select class="settings-select" id="db-image-status">
                    <option value="">全部状态</option>
                    <option value="done">已解析</option>
                    <option value="pending">待解析</option>
                    <option value="running">解析中</option>
                    <option value="error">解析失败</option>
                    <option value="no_model">无可用模型</option>
                  </select>
                </label>
                <label>关键词
                  <input class="settings-input" id="db-image-query" placeholder="搜 newapi、截图文字、图片描述、文件名">
                </label>
                <label>发送人
                  <input class="settings-input" id="db-image-sender" placeholder="搜昵称/备注/sender_id">
                </label>
                <label>开始时间
                  <input class="settings-input" id="db-image-from" type="datetime-local">
                </label>
                <label>结束时间
                  <input class="settings-input" id="db-image-to" type="datetime-local">
                </label>
                <div class="db-image-filter-actions">
                  <button class="settings-save-btn primary" id="db-image-search-btn" type="button">查询图片</button>
                  <button class="settings-save-btn ghost" id="db-image-reset-btn" type="button">重置筛选</button>
                </div>
              </div>
              <div class="db-image-summary" id="db-image-summary">—</div>
              <div class="db-image-list" id="db-image-list">
                <div class="wechaty-empty">正在加载图片…</div>
              </div>
              <div class="wechaty-records-more">
                <button class="settings-save-btn ghost" id="db-image-more-btn" type="button" style="display:none;">加载更多图片</button>
              </div>
            </div>
            <div class="db-member-panel" id="db-member-panel"></div>
            <div class="db-search-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">聊天记录 / 长期记忆混合搜索</div>
                  <p class="settings-hint compact">同时搜微信群逐条聊天记录和长期记忆；未配置云端 embedding 时自动使用本地轻量向量兜底，不会因为 Honcho 不通而失忆。</p>
                </div>
              </div>
              <div class="db-search-row">
                <input class="settings-input" id="db-search-input" placeholder="输入要查的关键词、人物、梗或历史问题">
                <button class="settings-save-btn primary" id="db-search-btn" type="button">查询</button>
              </div>
              <div class="db-search-results" id="db-search-results"></div>
            </div>
            <div class="db-table-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">表级明细</div>
                  <p class="settings-hint compact">按估算占用从大到小排列；SQLite 的 WAL/SHM 与媒体文件会计入总占用。</p>
                </div>
              </div>
              <div class="db-table-list" id="db-table-list"></div>
            </div>
            <span class="settings-feedback" id="db-feedback"></span>
          </div>
        </div>

        <!-- ── 知识库 tab ── -->
        <div class="settings-tab" data-tab="knowledge">
          <div class="settings-section knowledge-console">
            <div class="knowledge-hero">
              <div>
                <small>Knowledge Command Center</small>
                <h2>群组知识控制台</h2>
                <p>导入文档、图片和公开链接，先预览编辑再入库；机器人只调用全局知识和当前群绑定知识。</p>
              </div>
              <div class="knowledge-hero-actions">
                <button class="settings-save-btn primary knowledge-import-toggle" id="knowledge-import-toggle" type="button">＋ 导入知识</button>
                <button class="settings-save-btn ghost" id="knowledge-refresh-btn" type="button">刷新</button>
              </div>
            </div>

            <div class="knowledge-drawer" id="knowledge-drawer" hidden>
              <div class="knowledge-drawer-head">
                <div><b>导入知识</b><span>上传文件/图片、粘贴链接或手动录入；解析完成后进入预览队列。</span></div>
                <button class="settings-close mini" id="knowledge-drawer-close" type="button">×</button>
              </div>
              <div class="knowledge-import-grid">
                <label class="knowledge-import-card">
                  <input id="knowledge-file-input" type="file" multiple hidden accept=".txt,.md,.markdown,.docx,.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.svg,image/*">
                  <em>📁</em><b>上传文件 / 图片</b><span>支持文档、表格、PDF 和多种图片格式。</span>
                </label>
                <label class="knowledge-field wide">
                  <span>公开链接（每行一个）</span>
                  <textarea id="knowledge-url-input" class="settings-input" rows="5" placeholder="https://mp.weixin.qq.com/...\nhttps://www.zhihu.com/..."></textarea>
                </label>
                <label class="knowledge-field wide">
                  <span>手动文本</span>
                  <input id="knowledge-manual-title" class="settings-input" placeholder="标题（可选）">
                  <textarea id="knowledge-manual-text" class="settings-input" rows="5" placeholder="粘贴要写入知识库的正文…"></textarea>
                </label>
                <div class="knowledge-target-box">
                  <label><span>知识范围</span><select class="settings-select" id="knowledge-scope"><option value="global">全局知识</option><option value="groups">绑定群组</option></select></label>
                  <label><span>绑定群组</span><select class="settings-select" id="knowledge-group-select" multiple size="6"></select></label>
                  <button class="settings-save-btn primary" id="knowledge-parse-btn" type="button">开始解析</button>
                  <span class="settings-feedback" id="knowledge-import-feedback"></span>
                </div>
              </div>
            </div>

            <div class="knowledge-preview-panel" id="knowledge-preview-panel" hidden>
              <div class="wechaty-subsection-head">
                <div><div class="wechaty-subsection-title">解析预览队列</div><p class="settings-hint compact">读取 → 提取正文/图片理解 → 分块 → 向量化 → 待确认。可编辑后再入库。</p></div>
                <button class="settings-save-btn primary" id="knowledge-commit-btn" type="button">确认入库</button>
              </div>
              <div class="knowledge-preview-list" id="knowledge-preview-list"></div>
            </div>

            <div class="knowledge-layout">
              <aside class="knowledge-space">
                <div class="knowledge-status-grid" id="knowledge-status-grid">
                  <div class="wechaty-empty">正在加载知识库状态…</div>
                </div>
                <div class="knowledge-space-list" id="knowledge-space-list"></div>
              </aside>
              <main class="knowledge-workbench">
                <div class="knowledge-toolbar">
                  <div class="knowledge-filter-pills" id="knowledge-filter-pills">
                    <button class="active" data-type="">全部</button><button data-type="image">图片</button><button data-type="url">网页</button><button data-type="pdf">PDF</button><button data-type="sheet">表格</button><button data-type="word">文档</button>
                  </div>
                  <input class="settings-input" id="knowledge-search-input" placeholder="搜索标题、来源、摘要或正文">
                </div>
                <div class="knowledge-source-grid" id="knowledge-source-grid">
                  <div class="wechaty-empty">暂无知识。点击“导入知识”开始建立档案。</div>
                </div>
              </main>
              <aside class="knowledge-detail" id="knowledge-detail">
                <div class="knowledge-detail-empty">选择一张知识卡查看详情、分块、来源和操作。</div>
              </aside>
            </div>

            <div class="knowledge-test-panel">
              <div>
                <b>模拟群内提问</b>
                <span>选择群组后测试机器人会召回哪些知识分块。</span>
              </div>
              <select class="settings-select" id="knowledge-test-group"></select>
              <input class="settings-input" id="knowledge-test-query" placeholder="例如：这个群的产品规则是什么？">
              <button class="settings-save-btn primary" id="knowledge-test-btn" type="button">测试召回</button>
            </div>
            <div class="knowledge-test-results" id="knowledge-test-results"></div>
            <span class="settings-feedback" id="knowledge-feedback"></span>
          </div>
        </div>

        <!-- ── 多模态能力 tab ── -->
        <div class="settings-tab" data-tab="skills">
          <div class="settings-section multimodal-settings">
            <div class="settings-section-label">多模态能力</div>
            <p class="settings-hint">集中配置图像生成、图片理解和视频理解。常用开关、模型、密钥和测试入口放在当前页；多渠道故障切换放在高级配置中。</p>
            <div class="multimodal-summary">
              <span id="skill-image-status">○ 图像生成未配置</span>
              <span id="skill-vision-status">○ 图片理解未检测</span>
              <span id="skill-video-status">○ 视频理解未配置</span>
            </div>
            <div class="multimodal-card-grid">
            <div class="wechaty-meme-panel multimodal-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">图像生成</div>
                  <p class="settings-hint compact">处理群内明确的生成图片请求，可配置质量、超时和每人频率上限。</p>
                </div>
              </div>
              <label class="wechaty-master-toggle">
                <input id="skill-image-enabled" type="checkbox" checked>
                <span>启用图像生成</span>
              </label>
              <label class="wechaty-master-toggle">
                <input id="skill-image-failover" type="checkbox" checked>
                <span>当前渠道失败时自动切换到下一个已启用渠道</span>
              </label>
              <div class="wechaty-meme-grid">
                <label>默认 Base URL
                  <input class="settings-input" id="skill-image-baseurl" type="text" placeholder="在渠道池第一行填写当前 API BaseURL">
                </label>
                <label>模型
                  <select class="settings-select" id="skill-image-model"></select>
                </label>
                <label>默认 API Key
                  <input class="settings-input" id="skill-image-key" type="password" placeholder="在渠道池第一行填写或更新密钥">
                </label>
                <label>每人每小时上限
                  <select class="settings-select" id="skill-image-limit">
                    <option value="5">5 张</option>
                    <option value="10">10 张（推荐）</option>
                    <option value="20">20 张</option>
                  </select>
                </label>
                <label>API 超时
                  <select class="settings-select" id="skill-image-timeout">
                    <option value="120">120 秒</option>
                    <option value="180">180 秒（推荐）</option>
                    <option value="240">240 秒</option>
                    <option value="300">300 秒</option>
                  </select>
                </label>
                <label>默认质量
                  <select class="settings-select" id="skill-image-default-quality">
                    <option value="low">low（最快）</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="auto">auto</option>
                  </select>
                </label>
                <label>高清质量
                  <select class="settings-select" id="skill-image-high-quality">
                    <option value="high">high（推荐）</option>
                    <option value="medium">medium</option>
                    <option value="auto">auto</option>
                  </select>
                </label>
              </div>
              <div class="settings-row-action">
                <button class="settings-save-btn primary" id="skill-image-save-btn" type="button">保存图像生成</button>
                <button class="settings-save-btn" id="skill-image-test-btn" type="button">测试当前模型</button>
                <button class="settings-save-btn" id="skill-image-add-channel-btn" type="button">新增渠道</button>
                <span class="settings-feedback skill-test-feedback" data-feedback-class="skill-test-feedback" id="skill-image-feedback"></span>
              </div>
              <details class="multimodal-advanced">
                <summary>高级渠道池</summary>
              <div class="wechaty-subsection-head" style="margin-top:14px;">
                <div>
                  <div class="wechaty-subsection-title">图像生成渠道</div>
                  <p class="settings-hint compact">当前渠道失败时按顺序尝试备用渠道；密钥只保存在本机配置。</p>
                </div>
              </div>
              <div class="wechaty-member-list" id="skill-image-channel-list"></div>
              </details>
            </div>

            <div class="wechaty-meme-panel multimodal-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">图片理解</div>
                  <p class="settings-hint compact">为微信群图片生成中文描述和标签，供图片库检索、记忆和后续上下文使用。</p>
                </div>
              </div>
              <label class="wechaty-master-toggle">
                <input id="skill-vision-enabled" type="checkbox" checked>
                <span>启用微信群识图与图片记忆</span>
              </label>
              <label class="wechaty-master-toggle">
                <input id="skill-vision-failover" type="checkbox" checked>
                <span>当前识图渠道失败时自动切换到下一个已启用渠道</span>
              </label>
              <label class="wechaty-master-toggle">
                <input id="skill-vision-prefer-current" type="checkbox" checked>
                <span>专用识图渠道都失败后，允许当前多模态 LLM 作为兜底</span>
              </label>
              <div class="wechaty-meme-grid">
                <label>默认识图 Base URL
                  <input class="settings-input" id="skill-vision-baseurl" type="text" placeholder="在渠道池第一行填写当前识图 API BaseURL">
                </label>
                <label>备用识图模型
                  <select class="settings-select" id="skill-vision-model"></select>
                </label>
                <label>默认识图 API Key
                  <input class="settings-input" id="skill-vision-key" type="password" placeholder="在渠道池第一行填写或更新密钥">
                </label>
                <label>识图超时
                  <select class="settings-select" id="skill-vision-timeout">
                    <option value="30">30 秒</option>
                    <option value="45">45 秒（推荐）</option>
                    <option value="60">60 秒</option>
                    <option value="90">90 秒</option>
                  </select>
                </label>
              </div>
              <div class="settings-row-action">
                <button class="settings-save-btn primary" id="skill-vision-save-btn" type="button">保存图片理解</button>
                <button class="settings-save-btn" id="skill-vision-test-btn" type="button">测试当前模型</button>
                <button class="settings-save-btn" id="skill-vision-add-channel-btn" type="button">新增渠道</button>
                <button class="settings-save-btn" id="skill-vision-refresh-btn" type="button">刷新状态</button>
                <span class="settings-feedback skill-test-feedback" data-feedback-class="skill-test-feedback" id="skill-vision-feedback"></span>
              </div>
              <details class="multimodal-advanced">
                <summary>高级渠道池</summary>
              <div class="wechaty-subsection-head" style="margin-top:14px;">
                <div>
                  <div class="wechaty-subsection-title">图片理解渠道</div>
                  <p class="settings-hint compact">当前渠道超时、503 或返回空时，会自动尝试下一个已启用渠道。</p>
                </div>
              </div>
              <div class="wechaty-member-list" id="skill-vision-channel-list"></div>
              </details>
              <p class="settings-hint compact" id="skill-vision-counts">图片入库：—</p>
            </div>

            <div class="wechaty-meme-panel multimodal-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">视频理解</div>
                  <p class="settings-hint compact">临时读取群内视频并调用多模态模型回答，解析后删除临时文件。</p>
                </div>
              </div>
              <label class="wechaty-master-toggle">
                <input id="skill-video-enabled" type="checkbox" checked>
                <span>启用视频理解</span>
              </label>
              <label class="wechaty-master-toggle">
                <input id="skill-video-failover" type="checkbox" checked>
                <span>当前视频解析渠道失败时自动切换到下一个已启用渠道</span>
              </label>
              <div class="wechaty-meme-grid">
                <label>默认视频 Base URL
                  <input class="settings-input" id="skill-video-baseurl" type="text" placeholder="在渠道池第一行填写当前视频 API BaseURL">
                </label>
                <label>视频模型
                  <select class="settings-select" id="skill-video-model"></select>
                </label>
                <label>默认视频 API Key
                  <input class="settings-input" id="skill-video-key" type="password" placeholder="在渠道池第一行填写或更新密钥">
                </label>
                <label>解析超时
                  <select class="settings-select" id="skill-video-timeout">
                    <option value="60">60 秒</option>
                    <option value="90">90 秒（推荐）</option>
                    <option value="120">120 秒</option>
                    <option value="180">180 秒</option>
                  </select>
                </label>
                <label>视频大小上限
                  <select class="settings-select" id="skill-video-max-mb">
                    <option value="10">10 MB</option>
                    <option value="25">25 MB（推荐）</option>
                    <option value="50">50 MB</option>
                    <option value="80">80 MB</option>
                  </select>
                </label>
              </div>
              <div class="settings-row-action">
                <button class="settings-save-btn primary" id="skill-video-save-btn" type="button">保存视频理解</button>
                <button class="settings-save-btn" id="skill-video-test-btn" type="button">测试当前模型</button>
                <button class="settings-save-btn" id="skill-video-add-channel-btn" type="button">新增渠道</button>
                <button class="settings-save-btn" id="skill-video-refresh-btn" type="button">刷新状态</button>
                <span class="settings-feedback skill-test-feedback" data-feedback-class="skill-test-feedback" id="skill-video-feedback"></span>
              </div>
              <details class="multimodal-advanced">
                <summary>高级渠道池</summary>
              <div class="wechaty-subsection-head" style="margin-top:14px;">
                <div>
                  <div class="wechaty-subsection-title">视频理解渠道</div>
                  <p class="settings-hint compact">渠道返回不支持视频、超时或空内容时，会按设置尝试备用渠道。</p>
                </div>
              </div>
              <div class="wechaty-member-list" id="skill-video-channel-list"></div>
              </details>
              <p class="settings-hint compact" id="skill-video-counts">临时视频：解析完成即删除，不写入图片库/媒体库。</p>
            </div>
            </div>
          </div>
        </div>

        <!-- ── 微信群助手 tab ── -->
        <div class="settings-tab" data-tab="wechat-groups">
          <div class="wechaty-settings-layout">
            <aside class="wechaty-subnav" aria-label="微信群助手二级菜单">
              <div class="wechaty-subnav-head">
                <b>微信群助手</b>
                <span>按模块快速定位</span>
              </div>
              <nav>
                <a href="#wechaty-connection-section"><em>01</em><span><b>连接与自由回复群</b><small>扫码、在线状态、接话范围</small></span></a>
                <a href="#wechaty-capability-section"><em>02</em><span><b>回复能力</b><small>管理员、屏蔽、斗图、性格</small></span></a>
                <a href="#wechaty-data-section"><em>03</em><span><b>记忆与战报</b><small>群记忆、统计、记录库</small></span></a>
                <a href="#wechaty-hotspot-panel"><em>04</em><span><b>舆情推送</b><small>平台、关键词、接收群</small></span></a>
                <a href="#wechaty-knowledge-section"><em>05</em><span><b>知识库连接</b><small>本地记忆、Honcho 后端</small></span></a>
                <a href="#wechaty-security-section"><em>06</em><span><b>安全边界</b><small>微信群强制拒绝规则</small></span></a>
              </nav>
              <div class="wechaty-subnav-note">
                参考插件化、统一配置和定时任务中心的演进方向，先把现有模块拆成可定位入口。
              </div>
            </aside>
            <div class="wechaty-settings-content">
          <div class="settings-section wechaty-group-settings">
            <div class="wechaty-console-hero">
              <div>
                <span class="wechaty-console-kicker">WECHAT COMMAND CENTER</span>
                <div class="settings-section-label">微信群助手（自由回复）</div>
                <p class="settings-hint">按下面 4 步配置：登录微信 → 选择开启自由回复的群 → 调整活跃度与并发 → 保存。未选择群只归档/记忆，不会回复。</p>
              </div>
              <div class="settings-platform-status" id="wechaty-duty-status">○ 未连接</div>
            </div>
            <section class="wechaty-feature-section connection" id="wechaty-connection-section">
              <div class="wechaty-feature-heading">
                <span>01</span>
                <div><b>连接与自由回复范围</b><small>只决定哪些群允许机器人自然接话；统计战报在下方单独选择。</small></div>
              </div>
            <div class="wechaty-command-grid">
              <div class="wechaty-command-main">
                <div class="wechaty-panel-title"><b>连接与自由回复群</b><span>先做这里，其他能力才有数据来源。</span></div>
            <div class="wechaty-login-card">
              <div>
                <div class="wechaty-login-title">微信登录状态</div>
                <div class="wechaty-login-sub" id="wechaty-login-sub">未登录。点击“登录/恢复微信”后，如本机没有登录态会显示二维码。</div>
              </div>
              <div class="wechaty-login-actions">
                <button class="settings-save-btn" id="wechaty-start-btn" type="button">登录/恢复微信</button>
                <button class="settings-save-btn danger" id="wechaty-relogin-btn" type="button">强制重新扫码</button>
              </div>
            </div>
            <div class="wechaty-qr-area" id="wechaty-qr-area" style="display:none;">
              <img id="wechaty-qr-img" src="" alt="Wechaty 微信登录二维码">
              <div>用要接入群聊的微信扫码登录；登录成功后会自动获取群列表。二维码如果过期，请点“强制重新扫码”。</div>
            </div>
            <div class="wechaty-toolbar">
              <label class="wechaty-master-toggle">
                <input id="wechaty-duty-enabled" type="checkbox" checked>
                <span>启用微信群自由回复</span>
              </label>
              <button class="settings-save-btn" id="wechaty-refresh-rooms-btn" type="button">刷新真实群列表</button>
            </div>
            <div class="wechaty-concurrency-card">
              <div class="wechaty-concurrency-copy">
                <div class="wechaty-login-title">并发回复上限</div>
                <p class="settings-hint compact">同时限制 @ 必回和自由接话任务；@ 必回优先，不会被自由接话挤掉。</p>
              </div>
              <div class="wechaty-concurrency-controls">
                <label>同时思考
                  <select class="settings-select" id="wechaty-concurrency-limit">
                    <option value="1">1 个</option>
                    <option value="2">2 个</option>
                    <option value="3">3 个</option>
                    <option value="4">4 个</option>
                    <option value="5">5 个</option>
                    <option value="6">6 个（默认）</option>
                    <option value="7">7 个</option>
                    <option value="8">8 个</option>
                    <option value="9">9 个</option>
                    <option value="10">10 个</option>
                    <option value="11">11 个</option>
                    <option value="12">12 个</option>
                    <option value="13">13 个</option>
                    <option value="14">14 个</option>
                    <option value="15">15 个</option>
                    <option value="16">16 个</option>
                    <option value="17">17 个</option>
                    <option value="18">18 个</option>
                    <option value="19">19 个</option>
                    <option value="20">20 个（上限）</option>
                  </select>
                </label>
                <button class="settings-save-btn" id="wechaty-save-concurrency-btn" type="button">保存并发上限</button>
                <span class="wechaty-concurrency-status" id="wechaty-concurrency-status">当前已保存：6 个</span>
              </div>
            </div>
            <div class="wechaty-ambient-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">群活跃度</div>
                  <p class="settings-hint compact">控制自由接话的门槛和节奏。显式 @ 机器人仍然必回，但只限已开启自由回复的群。</p>
                </div>
                <span class="wechaty-ambient-status" id="wechaty-ambient-status">正常</span>
              </div>
              <div class="wechaty-ambient-levels" id="wechaty-ambient-levels" role="radiogroup" aria-label="群活跃度">
                <label><input type="radio" name="wechaty-ambient-level" value="quiet"><span>安静</span></label>
                <label><input type="radio" name="wechaty-ambient-level" value="normal" checked><span>正常</span></label>
                <label><input type="radio" name="wechaty-ambient-level" value="active"><span>活跃</span></label>
                <label><input type="radio" name="wechaty-ambient-level" value="crazy"><span>发疯</span></label>
              </div>
              <div class="wechaty-ambient-summary" id="wechaty-ambient-summary">阈值 50；最小间隔 10 秒；每小时无限；连续发言无限。</div>
              <div class="settings-row-action">
                <button class="settings-save-btn primary" id="wechaty-save-ambient-btn" type="button">保存自由回复参数</button>
                <button class="settings-save-btn subtle" id="wechaty-reset-ambient-btn" type="button">恢复默认四档</button>
              </div>
            </div>
            <div class="wechaty-ambient-profile-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">活跃度参数编辑器</div>
                  <p class="settings-hint compact">0 表示无限；保存后实时生效。自由接话任务排队超过 TTL 会丢弃，避免旧话题延迟接梗。</p>
                </div>
                <label class="wechaty-ambient-ttl">自由任务 TTL
                  <input class="settings-input" id="wechaty-ambient-ttl" type="number" min="10" max="600" step="1" value="120">
                </label>
              </div>
              <div class="wechaty-ambient-profile-editor" id="wechaty-ambient-profile-editor"></div>
            </div>
            <div class="wechaty-ambient-rules-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">接话评分标准</div>
                  <p class="settings-hint compact">@ 机器人 = 强制触发，但仅限已开启自由回复的群；安全规则高于评分。</p>
                </div>
              </div>
              <div class="wechaty-ambient-rules" id="wechaty-ambient-rules"></div>
            </div>
            <div class="wechaty-ambient-last-card">
              <div class="wechaty-subsection-title">最近接话判断</div>
              <div class="wechaty-ambient-last" id="wechaty-ambient-last">暂无判断记录。</div>
            </div>
            <div class="wechaty-ambient-last-card">
              <div class="wechaty-subsection-title">图片接话策略</div>
              <p class="settings-hint compact">图片必须先完成识图再接话；默认查询 3 次，每次间隔 5 秒。三次后仍未解析完成，本轮直接放弃，不根据占位文本胡编。</p>
              <div class="wechaty-ambient-last" id="wechaty-ambient-image-last">暂无图片判断记录。</div>
            </div>
            <div class="wechaty-offline-notify-card">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">掉线二维码自动通知</div>
                  <p class="settings-hint compact">监控微信群助手真实在线状态；掉线并生成登录二维码后，会通过「社交媒体 → 微信 ClawBot（个人微信）」发送到 ClawBot 自己，不需要选择联系人。请确保 ClawBot 微信账号与进群回复的微信群助手账号不是同一个。</p>
                </div>
                <span class="wechaty-offline-notify-state" id="wechaty-offline-qr-notify-status">—</span>
              </div>
              <label class="wechaty-master-toggle">
                <input id="wechaty-offline-qr-notify-enabled" type="checkbox" checked>
                <span>掉线后自动用 ClawBot 发送登录二维码</span>
              </label>
              <label class="wechaty-master-toggle">
                <input id="wechaty-offline-qr-notify-autorelogin" type="checkbox" checked>
                <span>离线且暂无二维码时自动重新生成二维码</span>
              </label>
              <div class="wechaty-offline-notify-controls">
                <label>重复通知间隔
                  <select class="settings-select" id="wechaty-offline-qr-notify-cooldown">
                    <option value="5">5 分钟</option>
                    <option value="10">10 分钟</option>
                    <option value="15">15 分钟（推荐）</option>
                    <option value="30">30 分钟</option>
                    <option value="60">60 分钟</option>
                  </select>
                </label>
                <button class="settings-save-btn ghost" id="wechaty-offline-qr-notify-test-btn" type="button">立即重发 / 测试</button>
              </div>
            </div>
            <div class="wechaty-room-tools">
              <input class="settings-input" id="wechaty-room-filter" type="search" placeholder="搜索群名…">
              <span class="wechaty-selected-count" id="wechaty-selected-count">未获取群列表</span>
            </div>
            <div class="wechaty-room-list" id="wechaty-room-list">
              <div class="wechaty-empty">点击“连接/恢复微信”后刷新群列表</div>
            </div>
            <div class="settings-row-action wechaty-sticky-action">
              <button class="settings-save-btn primary" id="wechaty-save-groups-btn" type="button">保存自由回复群并生效</button>
              <span class="settings-feedback" id="wechaty-duty-feedback"></span>
            </div>
              </div>
              <aside class="wechaty-command-aside">
                <div class="wechaty-usage-card">
                  <b>怎么触发？</b>
                  <p>已勾选群会按语境评分自动接话；在这些群里 @ 当前扫码微信号会强制回复。</p>
                </div>
                <div class="wechaty-usage-card">
                  <b>群选择有两套</b>
                  <p>上方是「开启自由回复」；下面统计区是「参与统计/定时总结」。两者故意独立，避免误发。</p>
                </div>
                <div class="wechaty-usage-card warning">
                  <b>掉线通知</b>
                  <p>需要 ClawBot 是另一个微信号，并且它能收到自通知；否则页面仍会显示二维码。</p>
                </div>
              </aside>
            </div>
            </section>
            <section class="wechaty-feature-section capability" id="wechaty-capability-section">
            <div class="wechaty-feature-heading">
              <span>02</span>
              <div><b>回复能力配置</b><small>这些开关只改变被 @ 后的回复能力，每个模块独立保存，互不影响。</small></div>
            </div>
            <div class="wechaty-capability-map">
              <a href="#wechaty-admin-panel"><b>管理员</b><span>谁能执行敏感指令</span></a>
              <a href="#wechaty-blocked-panel"><b>屏蔽成员</b><span>不触发任何主动回复</span></a>
              <a href="#wechaty-meme-panel"><b>斗图</b><span>公开表情包/GIF</span></a>
              <a href="#wechaty-persona-panel"><b>性格</b><span>回复语气和边界</span></a>
              <a href="#wechaty-memory-manager"><b>群记忆</b><span>内置长期记忆</span></a>
              <a href="#wechaty-stats-panel"><b>统计总结</b><span>日报/阶段战报</span></a>
            </div>
            <div class="wechaty-capability-grid">
            <div class="wechaty-admin-panel" id="wechaty-admin-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">管理员模式（昵称选择，底层精确 ID）</div>
                  <p class="settings-hint">界面按微信昵称选择和显示，底层仍只保存 Wechaty sender_id 精确识别管理员；昵称改名或自称管理员都不会获得权限。</p>
                </div>
                <button class="settings-save-btn subtle" id="wechaty-refresh-admin-members-btn" type="button">刷新昵称</button>
              </div>
              <label class="wechaty-master-toggle wechaty-admin-toggle">
                <input id="wechaty-admin-enabled" type="checkbox">
                <span>启用管理员模式</span>
              </label>
              <input class="settings-input wechaty-admin-search" id="wechaty-admin-search" type="search" placeholder="搜索微信昵称，点成员卡片即可加入管理员…">
              <div class="wechaty-admin-editor">
                <textarea class="settings-textarea" id="wechaty-admin-ids" rows="4" readonly placeholder="这里显示已选管理员昵称。请从下方成员列表点击添加/取消，底层会自动保存精确 ID。"></textarea>
                <div class="wechaty-admin-side">
                  <button class="settings-save-btn primary" id="wechaty-save-admins-btn" type="button">保存管理员</button>
                  <span class="settings-feedback" id="wechaty-admin-feedback"></span>
                  <small>安全规则：页面显示昵称方便操作；真正授权仍是后台保存的精确 sender_id，昵称相同也不会误授权。</small>
                </div>
              </div>
              <div class="wechaty-admin-members" id="wechaty-admin-members">
                <div class="wechaty-empty">登录并刷新昵称后，这里会按微信昵称显示群成员，可一键加入管理员。</div>
              </div>
            </div>

            <div class="wechaty-admin-panel wechaty-blocked-panel" id="wechaty-blocked-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">屏蔽成员（昵称选择，底层精确 ID）</div>
                  <p class="settings-hint">被屏蔽成员的消息仍会入库、统计和写入群记忆，但无论 @ 助手还是开启非 @ 主动回复，都不会进入任何回复链路。</p>
                </div>
              </div>
              <input class="settings-input wechaty-admin-search" id="wechaty-blocked-search" type="search" placeholder="搜索微信昵称，点成员卡片即可屏蔽/取消…">
              <div class="wechaty-admin-editor">
                <textarea class="settings-textarea" id="wechaty-blocked-ids" rows="4" readonly placeholder="这里显示已屏蔽成员昵称。请从下方成员列表点击添加/取消，底层会自动保存精确 ID。"></textarea>
                <div class="wechaty-admin-side">
                  <button class="settings-save-btn primary" id="wechaty-save-blocked-btn" type="button">保存屏蔽成员</button>
                  <span class="settings-feedback" id="wechaty-blocked-feedback"></span>
                  <small>屏蔽规则：只按 Wechaty sender_id 精确匹配，不按昵称判断，避免同名成员或改名造成误屏蔽。</small>
                </div>
              </div>
              <div class="wechaty-admin-members" id="wechaty-blocked-members">
                <div class="wechaty-empty">登录并刷新昵称后，这里会按微信昵称显示群成员，可一键加入屏蔽名单。</div>
              </div>
            </div>

            <div class="wechaty-meme-panel" id="wechaty-meme-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">AI 斗图表情包</div>
                  <p class="settings-hint">接入慕名 API 表情搜索：群友 @ 后要求斗图/表情包/梗图时，AI 可搜索公开网络图片或 GIF 并发送到群里；不读取、不上传任何本机文件。</p>
                </div>
                <button class="settings-save-btn subtle" id="wechaty-test-meme-btn" type="button">测试搜索</button>
              </div>
              <label class="wechaty-master-toggle">
                <input id="wechaty-meme-enabled" type="checkbox" checked>
                <span>启用 AI 斗图</span>
              </label>
              <div class="wechaty-meme-grid">
                <label>表情源
                  <select class="settings-select" id="wechaty-meme-provider">
                    <option value="xiaoapi">慕名 API / xiaoapi</option>
                  </select>
                </label>
                <label>每次最多发送
                  <select class="settings-select" id="wechaty-meme-max">
                    <option value="1">1 张（推荐）</option>
                    <option value="2">2 张</option>
                    <option value="3">3 张</option>
                  </select>
                </label>
                <label>冷却时间
                  <select class="settings-select" id="wechaty-meme-cooldown">
                    <option value="15">15 秒</option>
                    <option value="30">30 秒（推荐）</option>
                    <option value="60">60 秒</option>
                    <option value="120">120 秒</option>
                  </select>
                </label>
                <label>测试关键词
                  <input class="settings-input" id="wechaty-meme-test-query" type="text" value="鄙视" placeholder="例如：无语、笑死、吃瓜">
                </label>
              </div>
              <div class="wechaty-meme-preview" id="wechaty-meme-preview">
                <div class="wechaty-empty">输入关键词后点击“测试搜索”，这里会显示将要发送的网络图片/GIF。</div>
              </div>
              <div class="settings-row-action">
                <button class="settings-save-btn primary" id="wechaty-save-meme-btn" type="button">保存斗图设置</button>
                <span class="settings-feedback" id="wechaty-meme-feedback"></span>
              </div>
              <p class="settings-hint compact">安全规则：只允许 HTTPS 公开图片/GIF，默认白名单域名为 biaoqing.gtimg.com 和 tugelepic.mse.sogou.com；本机文件、桌面图片、截图、相册、file:// 一律禁止发送。</p>
            </div>
            <div class="wechaty-persona-panel" id="wechaty-persona-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">微信群助手性格设定</div>
                  <p class="settings-hint">先选一个预设，再按需要微调。这里不会包含网页微信 DOM、浏览器脚本等旧项目流程；保存后会注入当前微信群回复 prompt。</p>
                </div>
                <button class="settings-save-btn subtle" id="wechaty-persona-reset-btn" type="button">恢复默认</button>
              </div>
              <div class="wechaty-persona-presets" id="wechaty-persona-presets">
                <div class="wechaty-empty">正在读取性格预设…</div>
              </div>
              <div class="wechaty-persona-current" id="wechaty-persona-current">
                <span class="wechaty-persona-current-label">当前生效</span>
                <b id="wechaty-persona-current-name">—</b>
                <em id="wechaty-persona-current-state">读取中</em>
              </div>
              <div class="wechaty-persona-editor-head">
                <span>当前提示词</span>
                <small id="wechaty-persona-active">未选择预设，可手动编辑</small>
              </div>
              <textarea class="settings-textarea wechaty-persona-textarea" id="wechaty-persona-prompt" rows="9" placeholder="例如：你是小白龙，回复要简洁、靠谱、有一点幽默；重要事情先给结论，再给步骤。"></textarea>
              <div class="wechaty-persona-actions">
                <button class="settings-save-btn primary" id="wechaty-save-persona-btn" type="button">保存性格并生效</button>
                <span class="settings-feedback" id="wechaty-persona-feedback"></span>
              </div>
              <p class="settings-hint compact">保存规则：点击预设只会填入上方文本，不会立刻生效；确认后点击“保存性格并生效”或上方“保存并生效”。危险电脑操作仍由安全黑名单强制拦截，性格设定不能绕过。</p>
            </div>
            </div>
            </section>
            <section class="wechaty-feature-section data" id="wechaty-data-section">
            <div class="wechaty-feature-heading">
              <span>03</span>
              <div><b>记忆、统计与图片战报</b><small>聊天记录库、长期记忆、统计群和 HTML/CSS 战报模板分开配置；多群预览一群一张，不混合。</small></div>
            </div>
            <div class="wechaty-data-grid">
            <div class="wechaty-memory-manager" id="wechaty-memory-manager">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">群记忆管理</div>
                  <p class="settings-hint">按微信群隔离显示：左侧选择群，右侧查看本群原始消息、自动摘要和长期结论。默认使用 App 内置本地记忆；Honcho 只作为可选同步后端。</p>
                </div>
                <div class="wechaty-memory-actions">
                  <button class="settings-save-btn" id="wechaty-refresh-memory-btn" type="button">刷新记忆</button>
                  <button class="settings-save-btn danger" id="wechaty-clear-group-memory-btn" type="button">清空本群</button>
                </div>
              </div>
              <div class="wechaty-memory-grid">
                <div class="wechaty-memory-groups" id="wechaty-memory-groups">
                  <div class="wechaty-empty">先获取并勾选群组</div>
                </div>
                <div class="wechaty-memory-detail">
                  <div class="wechaty-memory-toolbar">
                    <span class="wechaty-memory-title" id="wechaty-memory-title">未选择群</span>
                    <span class="wechaty-memory-stat" id="wechaty-memory-stat">—</span>
                  </div>
                  <div class="wechaty-manual-memory">
                    <input class="settings-input" id="wechaty-manual-memory-input" type="text" placeholder="手动添加一条本群长期记忆，例如：本群值班规则是先看监控再处理告警">
                    <button class="settings-save-btn" id="wechaty-add-memory-btn" type="button">添加记忆</button>
                  </div>
                  <div class="wechaty-memory-preview" id="wechaty-memory-preview"></div>
                </div>
              </div>
              <div class="wechaty-member-memory-manager" id="wechaty-member-memory-manager">
                <div class="wechaty-subsection-head compact">
                  <div>
                    <div class="wechaty-subsection-title">群友永久记忆</div>
                    <p class="settings-hint">选择一个群友，查看和编辑这个人的长期记忆。记忆会按稳定微信身份合并，重登后 sender_id 变化也尽量接回同一个人。</p>
                  </div>
                  <div class="wechaty-memory-actions">
                    <input class="settings-input member-memory-search" id="wechaty-member-memory-search" type="search" placeholder="搜索群友昵称/ID/记忆">
                    <button class="settings-save-btn" id="wechaty-refresh-member-memory-btn" type="button">刷新群友</button>
                    <button class="settings-save-btn primary" id="wechaty-open-member-memory-space-btn" type="button">打开独立空间</button>
                  </div>
                </div>
                <div class="wechaty-memory-grid member-memory-grid">
                  <div class="wechaty-memory-groups member-memory-members" id="wechaty-member-memory-members">
                    <div class="wechaty-empty">先选择上方微信群</div>
                  </div>
                  <div class="wechaty-memory-detail member-memory-detail">
                    <div class="wechaty-memory-toolbar">
                      <span class="wechaty-memory-title" id="wechaty-member-memory-title">未选择群友</span>
                      <span class="wechaty-memory-stat" id="wechaty-member-memory-stat">—</span>
                    </div>
                    <div class="wechaty-manual-memory member-memory-editor">
                      <textarea class="settings-input" id="wechaty-member-memory-input" rows="3" placeholder="给当前群友添加一条永久记忆，例如：他在本群喜欢别人叫他老登；他负责 PT 站相关话题。"></textarea>
                      <button class="settings-save-btn" id="wechaty-add-member-memory-btn" type="button">添加到此人</button>
                    </div>
                    <div class="wechaty-memory-preview" id="wechaty-member-memory-preview"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="wechaty-stats-panel" id="wechaty-stats-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">群统计与定时总结</div>
                  <p class="settings-hint">统计和定时总结有单独的群组选择：没在这里勾选的群不会进入统计，也不会自动发送总结，避免误发到所有群。</p>
                </div>
                <div class="wechaty-memory-actions">
                  <select class="settings-select wechaty-stats-scope-select" id="wechaty-stats-view-mode">
                    <option value="single">查看当前群</option>
                    <option value="all">已选统计群总览</option>
                  </select>
                  <button class="settings-save-btn" id="wechaty-refresh-stats-btn" type="button">刷新统计</button>
                  <button class="settings-save-btn primary" id="wechaty-send-digest-btn" type="button">立即发本群总结</button>
                </div>
              </div>
              <div class="wechaty-stats-scope" id="wechaty-stats-scope-label">当前查看：未选择群</div>
              <div class="wechaty-digest-group-picker">
                <div class="wechaty-digest-group-head">
                  <div>
                    <b>选择参与统计/定时总结的群组</b>
                    <small>这里独立于上方“自由回复群”；只有勾选并保存后，后续新消息才会写入本地统计库并参与定时总结。</small>
                  </div>
                  <span id="wechaty-digest-group-count">未选择</span>
                </div>
                <div class="wechaty-digest-group-list" id="wechaty-digest-group-list">
                  <div class="wechaty-empty">先在上方登录微信并获取群列表</div>
                </div>
              </div>
              <div class="wechaty-digest-config">
                <label class="wechaty-digest-toggle"><input id="wechaty-digest-enabled" type="checkbox" checked><span>启用群统计/自动总结</span></label>
                <label class="wechaty-digest-toggle"><input id="wechaty-digest-interval-enabled" type="checkbox"><span>阶段总结</span></label>
                <select class="settings-select" id="wechaty-digest-interval">
                  <option value="30">每 30 分钟</option>
                  <option value="60">每 1 小时</option>
                  <option value="180">每 3 小时</option>
                  <option value="360">每 6 小时</option>
                  <option value="720">每 12 小时</option>
                  <option value="1440">每天一次</option>
                </select>
                <label class="wechaty-digest-toggle"><input id="wechaty-digest-daily-enabled" type="checkbox" checked><span>每日统计</span></label>
                <input class="settings-input wechaty-digest-time" id="wechaty-digest-daily-time" type="time" value="00:00">
              </div>
              <div class="wechaty-digest-config wechaty-digest-ranks">
                <label><input id="wechaty-rank-message" type="checkbox" checked> 发言榜</label>
                <label><input id="wechaty-rank-image" type="checkbox" checked> 发图榜</label>
                <label><input id="wechaty-rank-emoji" type="checkbox" checked> 表情榜</label>
                <label><input id="wechaty-rank-link" type="checkbox" checked> 链接榜</label>
                <label><input id="wechaty-rank-brag" type="checkbox" checked> 装逼榜</label>
                <label class="wechaty-report-template-field">战报模板
                  <select class="settings-select" id="wechaty-report-template">
                    <option value="guochao-red-gold">国潮红金封神榜</option>
                    <option value="editorial-newspaper">报纸头版群聊时报</option>
                    <option value="ancient-scroll">古风卷轴值班战报</option>
                    <option value="ink-wash">水墨山水雅集榜</option>
                  </select>
                </label>
                <button class="settings-save-btn" id="wechaty-save-digest-btn" type="button">保存总结设置</button>
                <span class="settings-feedback" id="wechaty-digest-feedback"></span>
              </div>
              <div class="wechaty-report-preview-wrap">
                <div class="wechaty-report-preview-head"><b>HTML/CSS 战报模板预览</b><span>这里按完整海报等比缩放显示，不裁切；点击卡片可切到该群记录库。</span></div>
                <div id="wechaty-report-preview" class="wechaty-report-preview-list"></div>
              </div>
              <div class="wechaty-stats-cards" id="wechaty-stats-cards">
                <div class="wechaty-empty">选择左侧群并刷新统计后显示今日数据。</div>
              </div>
              <div class="wechaty-leaderboards" id="wechaty-leaderboards"></div>
              <div class="wechaty-records-panel">
                <div class="wechaty-records-head">
                  <div>
                    <h5>微信群聊天记录库</h5>
                    <p>显示已经写入本机 SQLite 的全量聊天记录，支持时间筛选、关键词检索、导入和导出。</p>
                  </div>
                  <div class="wechaty-records-actions">
                    <button class="settings-save-btn primary" id="wechaty-records-refresh-btn" type="button">🔎 查询记录</button>
                    <button class="settings-save-btn ghost" id="wechaty-records-today-btn" type="button">今天</button>
                    <button class="settings-save-btn ghost" id="wechaty-records-refresh-names-btn" type="button">刷新昵称</button>
                    <button class="settings-save-btn ghost" id="wechaty-records-export-json-btn" type="button">导出 JSON</button>
                    <button class="settings-save-btn ghost" id="wechaty-records-export-csv-btn" type="button">导出 CSV</button>
                    <label class="settings-save-btn ghost" for="wechaty-records-import-file">导入 JSON</label>
                    <input id="wechaty-records-import-file" type="file" accept="application/json,.json" hidden>
                  </div>
                </div>
                <div class="wechaty-records-help">
                  <b>聊天记录库</b>是原始流水账：谁在什么时候说了什么、发了什么图；<b>群记忆管理</b>是内置长期记忆：把聊天里有价值的偏好、约定、结论抽取成可供大模型下次回答使用的知识。
                </div>
                <div class="wechaty-records-filters">
                  <label><span>查看群组</span><select class="settings-select" id="wechaty-records-group">
                    <option value="">跟随左侧群选择</option>
                  </select></label>
                  <label><span>开始时间</span><input class="settings-input" id="wechaty-records-from" type="datetime-local"></label>
                  <label><span>结束时间</span><input class="settings-input" id="wechaty-records-to" type="datetime-local"></label>
                  <label><span>类型</span><select class="settings-select" id="wechaty-records-type">
                    <option value="">全部类型</option>
                    <option value="text">文字</option>
                    <option value="image">图片</option>
                    <option value="emoji">表情</option>
                    <option value="link">链接</option>
                    <option value="mixed">混合</option>
                  </select></label>
                  <label><span>关键词</span><input class="settings-input" id="wechaty-records-query" type="search" placeholder="搜索成员/内容/链接"></label>
                </div>
                <div class="wechaty-records-summary" id="wechaty-records-summary">尚未查询聊天记录。</div>
                <div class="wechaty-records-list" id="wechaty-records-list"></div>
                <div class="wechaty-records-more"><button class="settings-save-btn" id="wechaty-records-more-btn" type="button">加载更多</button></div>
              </div>
              <div class="wechaty-stats-recent" id="wechaty-stats-recent"></div>
            </div>
            <div class="wechaty-hotspot-panel" id="wechaty-hotspot-panel">
              <div class="wechaty-subsection-head">
                <div>
                  <div class="wechaty-subsection-title">舆情推送</div>
                  <p class="settings-hint">监测抖音、小红书、微信热点和微博公开榜单。命中新上榜、排名上升或关键词后，向下方单独勾选的微信群发送聚合提醒。</p>
                </div>
                <div class="wechaty-memory-actions">
                  <button class="settings-save-btn" id="wechaty-hotspot-check-btn" type="button">手动检查</button>
                  <button class="settings-save-btn primary" id="wechaty-hotspot-notify-btn" type="button">检查并推送</button>
                </div>
              </div>
              <div class="wechaty-hotspot-status" id="wechaty-hotspot-status">舆情推送未加载</div>
              <div class="wechaty-digest-group-picker wechaty-hotspot-group-picker">
                <div class="wechaty-digest-group-head">
                  <div>
                    <b>选择接收舆情提醒的微信群</b>
                    <small>这里独立于“自由回复群”和“统计/定时总结群组”；只有勾选并保存后，舆情提醒才会发到这些群。</small>
                  </div>
                  <span id="wechaty-hotspot-group-count">未选择</span>
                </div>
                <div class="wechaty-digest-group-list" id="wechaty-hotspot-group-list">
                  <div class="wechaty-empty">先登录/恢复微信，或等待程序识别到微信群。</div>
                </div>
              </div>
              <div class="wechaty-hotspot-config">
                <label class="wechaty-digest-toggle"><input id="wechaty-hotspot-enabled" type="checkbox"><span>启用舆情推送</span></label>
                <label>检测间隔
                  <select class="settings-select" id="wechaty-hotspot-interval">
                    <option value="5">每 5 分钟</option>
                    <option value="10">每 10 分钟</option>
                    <option value="30">每 30 分钟</option>
                    <option value="60">每 1 小时</option>
                  </select>
                </label>
                <label>通知策略
                  <select class="settings-select" id="wechaty-hotspot-mode">
                    <option value="changes">只推变化</option>
                    <option value="all">每次推 Top 榜</option>
                  </select>
                </label>
                <label>TopN
                  <input class="settings-input" id="wechaty-hotspot-topn" type="number" min="1" max="50" step="1" value="10">
                </label>
                <label>上升阈值
                  <input class="settings-input" id="wechaty-hotspot-rank-rise" type="number" min="1" max="50" step="1" value="5">
                </label>
                <label>去重小时
                  <input class="settings-input" id="wechaty-hotspot-dedupe-hours" type="number" min="1" max="168" step="1" value="6">
                </label>
              </div>
              <div class="wechaty-hotspot-platforms" aria-label="舆情平台">
                <label><input class="wechaty-hotspot-platform" type="checkbox" value="douyin" checked> 抖音</label>
                <label><input class="wechaty-hotspot-platform" type="checkbox" value="xiaohongshu" checked> 小红书</label>
                <label><input class="wechaty-hotspot-platform" type="checkbox" value="wechat" checked> 微信热点</label>
                <label><input class="wechaty-hotspot-platform" type="checkbox" value="weibo" checked> 微博</label>
              </div>
              <label class="wechaty-hotspot-keywords">关键词
                <textarea class="settings-textarea" id="wechaty-hotspot-keywords" rows="3" placeholder="每行一个关键词，例如：AI、新能源、白龙马"></textarea>
              </label>
              <pre class="wechaty-hotspot-result" id="wechaty-hotspot-result">手动检查结果会显示在这里。</pre>
              <div class="settings-row-action">
                <button class="settings-save-btn primary" id="wechaty-save-hotspot-btn" type="button">保存舆情推送设置</button>
                <span class="settings-feedback" id="wechaty-hotspot-feedback"></span>
              </div>
            </div>
            </div>
            </section>
          </div>
          <div class="settings-section wechaty-knowledge-section" id="wechaty-knowledge-section">
            <div class="wechaty-feature-heading compact"><span>05</span><div><b>知识库连接</b><small>默认使用 App 内置本地记忆；Honcho 只作为可选外部同步后端。</small></div></div>
            <div class="settings-section-label">群知识库后端</div>
            <div class="settings-platform-status" id="wechaty-honcho-status">○ 未启用</div>
            <p class="settings-hint">默认无需 Docker：群消息、群长期记忆、成员记忆和语义检索都会写入 App 本机数据库。需要连接外部 Honcho 时再启用下面开关。</p>
            <div class="settings-row">
              <label class="settings-label" for="honcho-enabled">启用外部 Honcho</label>
              <input id="honcho-enabled" type="checkbox" style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="honcho-environment">环境</label>
              <select class="settings-select" id="honcho-environment">
                <option value="local">local · 本地 Honcho</option>
                <option value="demo">demo · 官方测试</option>
                <option value="production">production · 官方生产</option>
              </select>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="honcho-baseurl">Base URL</label>
              <input class="settings-input" id="honcho-baseurl" type="text" placeholder="http://127.0.0.1:8018">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="honcho-apikey">API Key</label>
              <input class="settings-input" id="honcho-apikey" type="password" placeholder="已默认使用 bailongma-local-honcho；留空保持不变">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="honcho-appid">知识库 ID</label>
              <input class="settings-input" id="honcho-appid" type="text" placeholder="bailongma-wechat-memory">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="honcho-appname">App 名称</label>
              <input class="settings-input" id="honcho-appname" type="text" placeholder="BaiLongma WeChat Memory">
            </div>
            <div class="settings-row-action">
              <button class="settings-save-btn" id="honcho-save-btn" type="button">一键启用/保存群知识库</button>
              <span class="settings-feedback" id="honcho-feedback"></span>
            </div>
          </div>
          <div class="settings-section wechaty-security-section" id="wechaty-security-section">
            <div class="wechaty-feature-heading compact danger"><span>06</span><div><b>安全边界</b><small>微信群入口的强制拒绝规则。</small></div></div>
            <div class="settings-section-label">安全黑名单</div>
            <p class="settings-hint">微信群入口默认禁止让大模型执行危险电脑操作。命中后会直接拒绝，只允许解释风险或给安全手动步骤。不包含逆向和成人内容过滤。</p>
            <div class="wechaty-guard-list" id="wechaty-guard-list"></div>
          </div>
            </div>
          </div>
        </div>

        <!-- ── 语音 tab ── -->
        <div class="settings-tab" data-tab="voice">
          <div class="settings-section">
            <div class="settings-section-label">语音识别模式</div>
            <div class="settings-row">
              <label class="settings-label" for="voice-provider-select">服务商</label>
              <select class="settings-select" id="voice-provider-select">
                <option value="local">本地模型（默认）</option>
                <option value="aliyun">阿里云百炼（推荐）</option>
                <option value="tencent">腾讯云 ASR</option>
                <option value="xunfei">科大讯飞 RTASR</option>
                <option value="volcengine">火山引擎/豆包 ASR</option>
              </select>
            </div>
            <div id="voice-cred-local">
              <p class="settings-hint">本地模式会在 Mac 上启动离线语音识别服务，麦克风音频不上传云端。推荐 SenseVoiceSmall：中文优先、速度快、比 Whisper 更不容易空音频幻觉。</p>
              <div class="settings-row">
                <label class="settings-label" for="voice-local-asr-model">本地模型</label>
                <select class="settings-select" id="voice-local-asr-model">
                  <option value="sensevoice-small">SenseVoiceSmall（推荐：中文优先/更快/低幻觉）</option>
                  <option value="small">Whisper small（备用）</option>
                  <option value="base">Whisper base（更快，准确率低）</option>
                  <option value="medium">Whisper medium（更准，更慢）</option>
                  <option value="turbo">Whisper turbo（较快且较准）</option>
                </select>
              </div>
            </div>
            <div id="voice-cred-aliyun">
              <div class="settings-row">
                <label class="settings-label" for="voice-aliyun-key">阿里云 API Key</label>
                <input class="settings-input" type="password" id="voice-aliyun-key" placeholder="留空则不修改">
              </div>
            </div>
            <div id="voice-cred-tencent" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="voice-tencent-sid">SecretId</label>
                <input class="settings-input" type="password" id="voice-tencent-sid" placeholder="留空则不修改">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-tencent-skey">SecretKey</label>
                <input class="settings-input" type="password" id="voice-tencent-skey" placeholder="留空则不修改">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-tencent-appid">AppId</label>
                <input class="settings-input" type="text" id="voice-tencent-appid" placeholder="腾讯云 AppId">
              </div>
            </div>
            <div id="voice-cred-xunfei" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="voice-xunfei-appid">AppId</label>
                <input class="settings-input" type="text" id="voice-xunfei-appid" placeholder="讯飞 AppId">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-xunfei-apikey">ApiKey</label>
                <input class="settings-input" type="password" id="voice-xunfei-apikey" placeholder="留空则不修改">
              </div>
            </div>
            <div id="voice-cred-volcengine" style="display:none;">
              <p class="settings-hint">火山引擎/豆包流式语音识别。按控制台“服务接口认证信息”填写：APP ID 填到 APP ID，Access Token 填到 Access Token；Secret Key 当前不用填。</p>
              <div class="settings-row">
                <label class="settings-label" for="voice-volcengine-appkey">APP ID</label>
                <input class="settings-input" type="password" id="voice-volcengine-appkey" placeholder="控制台里的 APP ID">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-volcengine-accesskey">Access Token</label>
                <input class="settings-input" type="password" id="voice-volcengine-accesskey" placeholder="控制台里的 Access Token，留空则不修改">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-volcengine-resourceid">Resource ID</label>
                <input class="settings-input" type="text" id="voice-volcengine-resourceid" placeholder="默认 volc.bigasr.sauc.duration">
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-label">通用设置</div>
            <div class="settings-row">
              <label class="settings-label" for="voice-lang-select">识别语言</label>
              <select class="settings-select" id="voice-lang-select">
                <option value="zh-CN">中文（普通话）</option>
                <option value="en-US">English (US)</option>
              </select>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-auto-send">识别后自动发送</label>
              <input id="voice-auto-send" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-auto-mic">启动时自动开启麦克风</label>
              <input id="voice-auto-mic" type="checkbox" style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-fast-mode">极速语音模式（可打断 / 快速播报）</label>
              <input id="voice-fast-mode" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-wake-enabled">启用唤醒词</label>
              <input id="voice-wake-enabled" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-wake-words">唤醒词</label>
              <input class="settings-input" type="text" id="voice-wake-words" placeholder="贾维斯，Jarvis，小龙马，龙马，白龙马">
            </div>
            <p class="settings-hint">启用后，普通说话/视频声音会被忽略；只有识别到唤醒词才会把指令发送给助手。可以说“贾维斯，关闭视频”或“龙马，帮我查天气”；只说唤醒词后 8 秒内继续说指令也可以。</p>
          </div>


          <div class="settings-section">
            <div class="settings-section-label">视频播放时的语音唤醒</div>
            <p class="settings-hint">三个能力可同时开启：自动降噪/降音量负责“听得见你”，按住说话负责兜底，系统回声消除负责减少播放器声音进入麦克风。</p>
            <div class="settings-row">
              <label class="settings-label" for="voice-video-duck">检测到人声时自动降低/暂停视频</label>
              <input id="voice-video-duck" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-video-ptt">视频播放时启用空格按住说话</label>
              <input id="voice-video-ptt" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-video-aec">启用系统回声消除 AEC</label>
              <input id="voice-video-aec" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <p class="settings-hint">本地 mp4 可直接降音量；YouTube 会尝试通过播放器 API 降音量；Bilibili 等跨域播放器无法稳定调音量时会短暂停/恢复。</p>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">语音灵敏度</div>
            <p class="settings-hint">调节麦克风触发阈值。越低越灵敏，越高越需要大声说话。默认 0.008。</p>
            <div class="settings-row">
              <label class="settings-label" for="settings-voice-threshold">触发阈值</label>
              <input type="range" id="settings-voice-threshold" min="0.002" max="0.04" step="0.001" value="0.008" style="flex:1;cursor:pointer;">
              <span id="settings-voice-threshold-val" style="min-width:3.5em;text-align:right;color:var(--ink2);font-size:13px;">0.008</span>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-label">语音合成（TTS）</div>
            <p class="settings-hint">用语音发消息时，Agent 回复会自动转为语音播放。首选推荐豆包语音合成 2.0（https://console.volcengine.com/speech/new/），也支持 MiniMax、OpenAI、ElevenLabs、火山引擎。</p>
            <div class="settings-row">
              <label class="settings-label" for="tts-provider-select">服务商</label>
              <select class="settings-select" id="tts-provider-select">
                <option value="doubao">豆包（方舟，流式，中文最自然）</option>
                <option value="openai">OpenAI TTS（流式，$0.015/千字）</option>
                <option value="elevenlabs">ElevenLabs（流式，高质量）</option>
                <option value="volcano">火山引擎（中文，有免费额度）</option>
                <option value="minimax">MiniMax（已有配置）</option>
              </select>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="tts-voice-select">声音</label>
              <select class="settings-select" id="tts-voice-select"></select>
            </div>

            <div id="tts-creds-doubao" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="tts-doubao-key">API Key</label>
                <input class="settings-input" type="password" id="tts-doubao-key" placeholder="留空则不修改">
              </div>
              <p class="settings-hint">在<a href="https://console.volcengine.com/speech/new/" target="_blank" style="color:var(--cool)">豆包语音合成 2.0 控制台</a>获取 API Key（需先完成实名认证和服务开通）。音色默认使用 seed-tts-2.0。</p>
            </div>

            <div id="tts-creds-minimax" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="tts-minimax-key">MiniMax API Key</label>
                <input class="settings-input" type="password" id="tts-minimax-key" placeholder="留空则不修改（可与 LLM 共用）">
              </div>
              <p class="settings-hint">可用声音：male-qn-qingse · male-qn-jingying · female-shaonv · female-yujie · presenter_female 等。</p>
            </div>

            <div id="tts-creds-openai">
              <div class="settings-row">
                <label class="settings-label" for="tts-openai-key">OpenAI API Key</label>
                <input class="settings-input" type="password" id="tts-openai-key" placeholder="留空则不修改（可与 LLM 共用）">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="tts-openai-baseurl">Base URL（选填）</label>
                <input class="settings-input" type="text" id="tts-openai-baseurl" placeholder="自定义端点，如 https://api.deepseek.com">
              </div>
              <p class="settings-hint">可用声音：nova · shimmer · alloy · echo · fable · onyx</p>
            </div>

            <div id="tts-creds-elevenlabs" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="tts-elevenlabs-key">ElevenLabs API Key</label>
                <input class="settings-input" type="password" id="tts-elevenlabs-key" placeholder="留空则不修改">
              </div>
              <p class="settings-hint">免费套餐每月 10,000 字符。声音 ID 在 ElevenLabs 控制台获取。</p>
            </div>

            <div id="tts-creds-volcano" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="tts-volcano-appid">AppId</label>
                <input class="settings-input" type="text" id="tts-volcano-appid" placeholder="火山引擎 TTS AppId">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="tts-volcano-token">Access Token</label>
                <input class="settings-input" type="password" id="tts-volcano-token" placeholder="留空则不修改">
              </div>
              <p class="settings-hint">可用声音：BV001_streaming（通用女声）· BV002_streaming（通用男声）等，在火山引擎控制台查看全部。</p>
            </div>

            <div class="settings-row" style="margin-top:8px;">
              <button class="settings-save-btn" id="tts-test-btn" type="button" style="padding:4px 12px;font-size:12px;">试听</button>
              <span id="tts-test-status" style="color:var(--ink2);font-size:12px;margin-left:8px;"></span>
            </div>
          </div>

          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-voice" type="button">保存</button>
            <span class="settings-feedback" id="settings-voice-feedback"></span>
          </div>
        </div>

        <!-- ── 网络能力 tab ── -->
        <div class="settings-tab" data-tab="web-search">
          <div class="network-panel">
            <section class="network-hero" aria-label="网络能力总览">
              <div class="network-hero-copy">
                <div class="network-eyebrow">NETWORK CAPABILITY</div>
                <h3>网络能力中枢</h3>
                <p>把网页搜索、公开图片搜索、链接真实查看和 Brave Key 池放到一个清晰面板里。默认 Brave 优先，失败后自动走兜底链路。</p>
              </div>
              <div class="network-route-card" aria-label="搜索链路">
                <span>搜索链路</span>
                <strong>Brave</strong>
                <em>→ Serper → SearXNG → Bing → Jina → DuckDuckGo</em>
              </div>
            </section>

            <section class="network-stat-grid" aria-label="网络能力状态摘要">
              <article class="network-stat-card primary">
                <span class="network-stat-icon">B</span>
                <div>
                  <strong>Brave Key 池</strong>
                  <small>10 槽位自动轮换</small>
                </div>
              </article>
              <article class="network-stat-card">
                <span class="network-stat-icon">W</span>
                <div>
                  <strong>网页搜索</strong>
                  <small>优先 Brave，失败回落</small>
                </div>
              </article>
              <article class="network-stat-card">
                <span class="network-stat-icon">IMG</span>
                <div>
                  <strong>图片直发</strong>
                  <small>微信群直接发图/GIF</small>
                </div>
              </article>
              <article class="network-stat-card guard">
                <span class="network-stat-icon">✓</span>
                <div>
                  <strong>链接守卫</strong>
                  <small>禁止假装“正在查看”</small>
                </div>
              </article>
            </section>

            <section class="network-card network-card-main">
              <div class="network-card-head">
                <div>
                  <div class="settings-section-label">Brave Search Key 池</div>
                  <p>主力配置区：最多 10 个 Key。留空会保留原值；输入新 Key 覆盖当前槽；勾选清空会删除当前槽。</p>
                </div>
                <span class="network-status-pill is-empty" id="websearch-status-brave-pool">—</span>
              </div>

              <div class="network-key-grid" id="websearch-brave-key-grid">
                ${Array.from({ length: 10 }, (_, i) => `
                  <div class="network-key-card">
                    <div class="network-key-top">
                      <span class="network-key-index">KEY ${String(i + 1).padStart(2, '0')}</span>
                      <small class="network-key-status is-empty" id="websearch-status-brave-${i}">—</small>
                    </div>
                    <input class="settings-input websearch-brave-key" type="password" data-index="${i}" aria-label="Brave Key ${i + 1}" placeholder="粘贴新 Key；留空保留">
                    <label class="network-clear-row">
                      <input type="checkbox" class="websearch-brave-clear" data-index="${i}">
                      <span>清空此槽</span>
                    </label>
                  </div>
                `).join('')}
              </div>
            </section>

            <section class="network-provider-grid" aria-label="兜底搜索渠道">
              <article class="network-provider-card">
                <div class="network-provider-head">
                  <div>
                    <span>Serper</span>
                    <small>Google SERP JSON，稳定兜底</small>
                  </div>
                  <span class="network-status-pill is-empty" id="websearch-status-serper">—</span>
                </div>
                <label class="network-field" for="websearch-serper-key">
                  <span>API Key</span>
                  <input class="settings-input" type="password" id="websearch-serper-key" placeholder="留空则不修改">
                </label>
                <p>在 <a href="https://serper.dev" target="_blank">serper.dev</a> 获取；用于 Brave 不可用时继续搜索。</p>
              </article>

              <article class="network-provider-card">
                <div class="network-provider-head">
                  <div>
                    <span>Jina</span>
                    <small>s.jina.ai 搜索兜底</small>
                  </div>
                  <span class="network-status-pill is-empty" id="websearch-status-jina">—</span>
                </div>
                <label class="network-field" for="websearch-jina-key">
                  <span>API Key</span>
                  <input class="settings-input" type="password" id="websearch-jina-key" placeholder="留空则不修改">
                </label>
                <p>在 <a href="https://jina.ai" target="_blank">jina.ai</a> 获取；作为 Bing 失效时的额外兜底。</p>
              </article>

              <article class="network-provider-card">
                <div class="network-provider-head">
                  <div>
                    <span>SearXNG</span>
                    <small>自托管元搜索实例</small>
                  </div>
                  <span class="network-status-pill is-empty" id="websearch-status-searxng">—</span>
                </div>
                <label class="network-field" for="websearch-searxng-url">
                  <span>实例 URL</span>
                  <input class="settings-input" type="text" id="websearch-searxng-url" placeholder="https://your-searxng-instance.com">
                </label>
                <p>选填，必须带 <code>http://</code> 或 <code>https://</code>。清空输入并保存可删除本地 URL。</p>
              </article>
            </section>

            <section class="network-action-bar">
              <div>
                <strong>保存后立即生效</strong>
                <small>Key 明文不会回显；只显示“本地 / 环境变量 / 空”状态，避免泄露。</small>
              </div>
              <div class="network-action-controls">
                <button class="settings-save-btn primary" id="settings-save-web-search" type="button">保存网络能力设置</button>
                <span class="settings-feedback" id="settings-web-search-feedback"></span>
              </div>
            </section>
          </div>
        </div>

        <!-- ── 安全沙箱 tab ── -->
        <div class="settings-tab" data-tab="security">
          <div class="settings-section">
            <div class="settings-section-label">文件沙箱</div>
            <p class="settings-hint">开启后文件读写只允许在 sandbox/ 目录内。关闭后 Agent 可操作系统任意位置的文件，请谨慎使用。</p>
            <div class="settings-row">
              <label class="settings-label" for="security-file-sandbox">启用文件沙箱</label>
              <label class="settings-toggle">
                <input type="checkbox" id="security-file-sandbox" checked>
                <span class="settings-toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">命令执行沙箱</div>
            <p class="settings-hint">开启后 exec_command 工作目录锁定在 sandbox/，且禁止使用绝对路径和父目录引用。关闭后命令可访问系统任意目录。</p>
            <div class="settings-row">
              <label class="settings-label" for="security-exec-sandbox">启用执行沙箱</label>
              <label class="settings-toggle">
                <input type="checkbox" id="security-exec-sandbox" checked>
                <span class="settings-toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">工具黑名单</div>
            <p class="settings-hint">勾选后该工具将被拒绝执行，对话中 Agent 调用时会收到"已被安全策略禁用"错误。</p>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="exec_command"> exec_command &nbsp;<span style="color:var(--ink2);font-size:12px;">（执行 shell 命令）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="browser_read"> browser_read &nbsp;<span style="color:var(--ink2);font-size:12px;">（浏览器渲染访问）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="fetch_url"> fetch_url &nbsp;<span style="color:var(--ink2);font-size:12px;">（HTTP 请求）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="web_search"> web_search &nbsp;<span style="color:var(--ink2);font-size:12px;">（网页搜索）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="ui_show"> ui_show &nbsp;<span style="color:var(--ink2);font-size:12px;">（推送 UI 卡片 / 动态代码注入）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="ui_register"> ui_register &nbsp;<span style="color:var(--ink2);font-size:12px;">（注册新 UI 组件）</span></label></div>
          </div>
          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-security" type="button">保存</button>
            <span class="settings-feedback" id="settings-security-feedback"></span>
          </div>
        </div>

        <!-- ── 更新 tab ── -->
        <div class="settings-tab" data-tab="update">
          <div class="settings-section">
            <div class="settings-section-label">版本信息</div>
            <div class="settings-config-row">
              <span class="settings-config-type">当前版本</span>
              <span class="settings-config-info" id="settings-current-version">—</span>
            </div>
            <div class="settings-config-row">
              <span class="settings-config-type">状态</span>
              <span class="settings-config-info" id="settings-update-status">未检查</span>
            </div>
            <div class="settings-row-action" style="margin-top:12px;gap:8px;flex-wrap:wrap;">
              <button class="settings-save-btn" id="settings-check-update-btn" type="button" style="width:auto;padding:0 14px;">检查更新</button>
              <button class="settings-save-btn hidden" id="settings-download-update-btn" type="button" style="width:auto;padding:0 14px;">立即下载</button>
              <button class="settings-save-btn hidden" id="settings-install-update-btn" type="button" style="width:auto;padding:0 14px;">立即重启安装</button>
              <button class="settings-save-btn hidden" id="settings-ignore-update-btn" type="button" style="width:auto;padding:0 14px;background:transparent;border:1px solid var(--line);color:var(--ink2);">忽略此版本</button>
              <span class="settings-feedback" id="settings-update-feedback"></span>
            </div>
          </div>
            <div class="settings-section">
              <div class="settings-section-label">更新说明</div>
              <div class="release-notes-list">
              <article class="release-note-card">
                <div class="release-note-head">
	                  <span class="release-note-version">v0.4.98</span>
	                  <span class="release-note-date">2026-06-06</span>
                </div>
	                <p class="release-note-summary">新增微信群组备份与迁移，并修复多模态 Skill 真实模型测试与反馈。</p>
                <ul class="release-note-points">
                  <li>数据库页新增“群组备份与迁移”，支持搜索群组、勾选导出、完整媒体/仅元数据模式和导入预览。</li>
	                  <li>备份只包含微信群数据白名单，排除 LLM、Skill、知识库、密钥、token、embedding 和 Honcho 同步字段。</li>
	                  <li>导入前实时读取当前在线微信号的真实群列表；无群、同名重复、缓存列表或未登录都会跳过。</li>
	                  <li>导入默认合并去重并重建 FTS；唯一群名匹配需要手动确认，避免同名群误导入。</li>
	                  <li>生图、识图、视频解析模型测试改为真实运行链路，并增强错误诊断、备用渠道提示和长错误反馈布局。</li>
	                </ul>
	              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.92</span>
                  <span class="release-note-date">2026-06-03</span>
                </div>
                <p class="release-note-summary">深修微信群长文和文件附件回复：不再只回一句“好的/稍等”，并严格按用户明确文件格式决定是否发送附件。</p>
                <ul class="release-note-points">
                  <li>长文、续写、总结、故事、报告或文件格式请求会拦截“好的/马上/接上/稍等”等空承诺。</li>
                  <li>“3000字，用文本文档格式发给我”会在完整正文生成后作为 TXT 附件发送。</li>
                  <li>只有明确要求 txt/md/pdf/word/excel/ppt/代码等文件格式时才发附件。</li>
                  <li>没有明确文件格式时，即使模型自己传 attachment，也不会自动判断或偷偷转文件。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.91</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复微信群助手掉线二维码自动通知、重复通知间隔保存和测试发送链路。</p>
                <ul class="release-note-points">
                  <li>二维码已生成并停留在扫码状态时，也会按配置冷却间隔重复发送到 ClawBot 自己。</li>
                  <li>重复通知间隔改为修改即保存，5/10/15/30/60 分钟不会再被状态轮询跳回 15 分钟。</li>
                  <li>保存请求加入“最新请求胜出”保护，快速切换下拉框时旧响应不会覆盖新选择。</li>
                  <li>新增“立即重发 / 测试”按钮，可当场验证 ClawBot 是否能收到掉线登录二维码。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.90</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复微信群要求“用文本/文档格式发送”时仍然裸发长文本的问题。</p>
                <ul class="release-note-points">
                  <li>发送层新增自动附件兜底：模型忘传 attachment 时，也会按原始群消息里的文件格式要求生成附件。</li>
                  <li>支持文本文档、txt、md、py、js、ts、json、csv、html、pdf、word、excel/excle、ppt 等格式别名。</li>
                  <li>像“3000字，用文本文档格式发给我”会生成 TXT 文件发群，不再直接刷一大段文字。</li>
                  <li>短确认语不会误生成文件；只发送本轮生成目录里的附件，不开放任意本机文件外发。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.89</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复微信群视频引用窗口和图片解析误回复。</p>
                <ul class="release-note-points">
                  <li>视频引用不再只看最近 5 分钟，改为按微信普通图片/视频约 14 天过期的保守窗口保留可读取消息对象。</li>
                  <li>引用视频或追问视频时，每次都会重新下载临时解析，解析后删除，不复用旧临时文件。</li>
                  <li>视频请求优先于图片解析直回，避免“看看这个视频内容”误回复最近图片解析内容。</li>
                  <li>引用视频会优先按引用消息 ID 命中对应视频，找不到才回退到当前群最近视频。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.88</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">继续修复群友永久记忆成员列表不全。</p>
                <ul class="release-note-points">
                  <li>加载群友永久记忆成员列表时，会主动刷新当前微信群的 Wechaty room members。</li>
                  <li>成员 API、本地合并和前端请求上限提高到 20000，避免 500/1000 人大群截断。</li>
                  <li>成员列表不再只依赖已发过消息的人；在线时会先把当前群成员写入本地身份表。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.87</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">群友永久记忆 UI 更紧凑，并新增群友人设总结。</p>
                <ul class="release-note-points">
                  <li>每条群友记忆默认完整横向显示，分类输入和正文编辑框不再窄成竖条。</li>
                  <li>记忆卡片上下高度压缩，独立空间能一次看到更多条。</li>
                  <li>数据库提取成员记忆会归档可用发言素材，并为每个群友生成/更新人设总结。</li>
                  <li>跳过数量只代表纯媒体、空白、过短无信息或不可用文本。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.86</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复微信群视频解析真实入口，并给主页思考状态加收尾兜底。</p>
                <ul class="release-note-points">
                  <li>先发视频再说“看看这个视频”时，会回查同群最近视频消息并调用视频解析 Skill。</li>
                  <li>引用视频 @ 助手时，会从当前群最近视频里找可读取对象，不再只把 [视频] 占位交给模型。</li>
                  <li>找不到真实视频文件时会提示重发原视频，避免误说“微信里下不下来”。</li>
                  <li>主页思考流新增后端 turn_finished 收尾和前端超时兜底，避免一直显示“思考中”。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.85</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">群友永久记忆升级为独立工作区，并补齐自动归档和联动召回。</p>
                <ul class="release-note-points">
                  <li>群友永久记忆可一键打开独立空间，成员列表、输入框、编辑区和按钮更大更清楚。</li>
                  <li>修复大群成员显示不全，选中群组后成员不会再被 500 条来源限制截断。</li>
                  <li>新群消息会继续写入向量记忆，并自动提取稳定个人事实归档到群友永久记忆。</li>
                  <li>数据库页“提取成员记忆”会真实归档历史消息，并弹窗显示扫描、归档、去重和跳过数量。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.84</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">新增微信群视频解析 Skill。</p>
                <ul class="release-note-points">
                  <li>Skill 设置页新增视频解析配置和渠道池，支持保存、测试连通、获取模型、设为当前和自动切换。</li>
                  <li>微信群 @ 助手发送视频或要求解析视频时，会调用视频理解模型生成中文摘要。</li>
                  <li>视频只临时读取，解析结束后删除，不写入图片库或媒体数据库。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.83</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复群友个人永久记忆库写入工具缺失。</p>
                <ul class="release-note-points">
                  <li>新增 wechat_member_memory_write，群友要求记入个人永久记忆库时可直接写入。</li>
                  <li>长文本会自动分块写入，便于关键词和向量召回。</li>
                  <li>普通群友只能写自己的个人记忆，管理员可指定目标成员。</li>
                  <li>修复机器人误说“没有写接口/只能搜索”的问题。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.82</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">微信群新增文件附件回复和图片记忆图库标签召回。</p>
                <ul class="release-note-points">
                  <li>群友要求以 txt/md/pdf/word/excel/ppt/py 等格式发送时，会生成临时文件附件发群。</li>
                  <li>附件只允许发送本轮生成的回复文件，不能转发任意本机文件。</li>
                  <li>引用图片或最近图片可直接在群里打标签，标签会写入当前群图片库。</li>
                  <li>图库召回会按标签/描述检索，之后可直接让助手发某张已记住的图。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.81</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">新增群友永久记忆窗口，并强化管理员识别和管理员指令优先级。</p>
                <ul class="release-note-points">
                  <li>群记忆管理中新增“群友永久记忆”区域，左侧选择群友，右侧管理该成员记忆。</li>
                  <li>新增 canonical 成员身份映射，尽量按 wxid/微信号/稳定身份合并历史 sender_id。</li>
                  <li>管理员旧 sender_id 可按稳定微信身份自动补录；已验证管理员指令不再受性格提示词压制。</li>
                  <li>修复群记忆删除按钮的前端残留错误。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.80</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">优化生图/识图 Skill 渠道池：Key 保存状态更清楚，模型列表改为真实获取。</p>
                <ul class="release-note-points">
                  <li>Key 输入框明确提示“已保存尾号，留空保留；输入新 Key 替换”。</li>
                  <li>新增自动切换渠道开关；关闭后只使用当前渠道，开启后按渠道池顺序容灾。</li>
                  <li>每个渠道可真实请求 /models 获取模型列表，识图下拉不再混入当前 LLM 或 LLM 模型池。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.79</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">Skill 密钥安全热修：默认不再内置生图/识图渠道密钥，并增强渠道池管理。</p>
                <ul class="release-note-points">
                  <li>GitHub 仓库已转为私有；全新安装默认不再带生图/识图 BaseURL 或 API Key。</li>
                  <li>识图 Skill 不再默认复用生图 Key；设置页只显示 Key 尾号提示，不回显明文。</li>
                  <li>渠道池第一张卡显示当前使用渠道，可编辑渠道名、BaseURL、模型和 Key；失败时自动尝试下一个已启用渠道。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.78</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复 macOS 启动时可能出现两个窗口/黑屏空窗口。</p>
                <ul class="release-note-points">
                  <li>Electron 主窗口直接加载 Brain UI，并等 ready-to-show 后再显示。</li>
                  <li>根路径也改为服务 Brain UI，避开旧入口和公网 D3 资源。</li>
                  <li>修复旧入口卡住时出现标题为 Bailongma 的黑屏窗口。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.77</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">微信群多 @ 和引用图片识别热修。</p>
                <ul class="release-note-points">
                  <li>多 @ 消息会综合 mentionList 和 MsgSource atuserlist 检测，只要机器人被真实 @ 就回复。</li>
                  <li>除机器人外被 @ 的群友会进入上下文，便于理解“他/她/在吗”。</li>
                  <li>引用图片会按引用消息 ID/发送者/时间回查本地图片库，命中后直接识图。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.76</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">清理 macOS 安装包残留群信息，生产默认不预置任何微信群。</p>
                <ul class="release-note-points">
                  <li>默认微信群列表、fallback 群列表和测试接口默认群名全部清空。</li>
                  <li>打包继续排除数据库、登录态、缓存群成员和本机用户数据。</li>
                  <li>macOS 标准安装继续使用内置本地记忆引擎，不需要 Docker。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.75</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">修复微信群助手 @ 回复群选择：勾选群组后不会再被状态轮询或缓存群列表自动取消。</p>
                <ul class="release-note-points">
                  <li>用户手动勾选/取消群组后，未保存选择会被前端保护，不再被 5 秒状态轮询覆盖。</li>
                  <li>保存成功后按后端持久化的 groupNames 回填，旧缓存 rooms 只用于显示群列表，不再强行决定勾选状态。</li>
                  <li>继续保持无 Docker 默认运行和内置本地群记忆引擎。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.74</span>
                  <span class="release-note-date">2026-06-02</span>
                </div>
                <p class="release-note-summary">macOS 完整包改为无 Docker 默认运行：群记忆和聊天检索使用 App 内置本地引擎，安装后直接打开即可工作。</p>
                <ul class="release-note-points">
                  <li>安装版启动不再自动准备 Honcho/Docker，也不会要求 Docker Desktop。</li>
                  <li>微信群消息、群长期记忆、成员记忆和语义检索默认写入本机 SQLite/本地向量索引。</li>
                  <li>Honcho 保留为可选外部同步后端；未启用时设置页会显示“内置本地记忆已启用”。</li>
                  <li>自动更新仍使用 GitHub Release 的 DMG、blockmap 和 latest-mac.yml。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.73</span>
                  <span class="release-note-date">2026-05-31</span>
                </div>
                <p class="release-note-summary">知识库深测修复：PDF 解析、CSV 中文乱码和失败状态计数都已校准。</p>
                <ul class="release-note-points">
                  <li>适配新版 pdf-parse，PDF 文件可以正常进入解析预览。</li>
                  <li>CSV 按 UTF-8 文本表格解析，中文不再变成乱码。</li>
                  <li>失败任务数不再统计历史解析失败记录，避免状态页一直显示“失败”。</li>
                  <li>已验证手动文本、群组隔离、TXT/MD/CSV/XLSX/DOCX/PDF/SVG 解析和知识检索。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.72</span>
                  <span class="release-note-date">2026-05-31</span>
                </div>
                <p class="release-note-summary">新增独立“知识库”控制台：外部文档、图片和公开链接可解析成群组/全局知识，并能被微信群机器人调用。</p>
                <ul class="release-note-points">
                  <li>设置页新增“知识库”一级菜单，采用情报档案室三栏布局：知识空间、知识源工作台、详情预览。</li>
                  <li>支持 txt、md、Word、Excel/CSV、PDF、多格式图片、公开网页链接和手动文本导入。</li>
                  <li>导入默认先解析预览，可编辑标题、摘要和分块，再确认入库或重新解析。</li>
                  <li>微信群回复会检索全局知识和当前群绑定知识，严格避免跨群串知识，并在使用时提示来源。</li>
                  <li>Honcho 启动脚本新增 Docker Desktop 自动唤起和等待逻辑；Honcho 不通时外部知识库仍可本地工作。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.71</span>
                  <span class="release-note-date">2026-05-31</span>
                </div>
                <p class="release-note-summary">微信群图片战报改成人类观感版：低数据小报、隐藏空榜、动态梗和变化总结语。</p>
                <ul class="release-note-points">
                  <li>消息少或参与少时自动使用“小报/快报”结构，不再硬套完整大榜单。</li>
                  <li>没有数据的排行榜不再占大框，减少“暂无数据”刷屏和空白尴尬。</li>
                  <li>水墨、古风、国潮、报纸四套模板重新压缩高度，避免发送后底部截断。</li>
                  <li>图片战报和文字总结都会从关键词与文案池中随机变化，梗点和总结语不再每次一样。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.70</span>
                  <span class="release-note-date">2026-05-31</span>
                </div>
                <p class="release-note-summary">开发模式也支持自动更新：启动后拉取 GitHub 最新代码、安装依赖并重启。</p>
                <ul class="release-note-points">
                  <li>开发模式不再显示“开发模式不检查更新”，会检查 GitHub 最新 Release。</li>
                  <li>发现新版本后自动拉取 origin/main、必要时暂存本地改动、安装依赖并重启本地 Electron。</li>
                  <li>正式打包版改为启动发现更新后自动下载，并在下载完成后自动重启安装。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.69</span>
                  <span class="release-note-date">2026-05-31</span>
                </div>
                <p class="release-note-summary">图片战报预览再次缩放校准：在当前设置页视口内完整显示整张海报。</p>
                <ul class="release-note-points">
                  <li>限制预览海报最大宽度并居中显示，避免右侧或底部被设置页容器裁掉。</li>
                  <li>继续保持 1080×1350 原始海报比例，iframe 视觉尺寸与预览舞台一致。</li>
                  <li>已按 1552×1002 设置页视口截图验证，整张图片战报完整可见。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.68</span>
                  <span class="release-note-date">2026-05-31</span>
                </div>
                <p class="release-note-summary">微信群助手设置页重新分区：连接、能力、记忆战报、知识库和安全边界更清楚。</p>
                <ul class="release-note-points">
                  <li>新增四步流程导航和大分区卡片，避免回复群、统计群、能力开关混在一起。</li>
                  <li>管理员、斗图、性格、群记忆、统计战报保持原功能不变，只调整信息架构和视觉层级。</li>
                  <li>HTML/CSS 图片战报预览按 1080×1350 完整海报等比缩放，避免预览被裁切。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.67</span><span class="release-note-date">2026-05-31</span></div>
                <p class="release-note-summary">增强群总结/图片战报生成稳定性，降低重复文案和固定模板观感。</p>
                <ul class="release-note-points"><li>继续完善微信群统计摘要、战报模板和发送链路。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.66</span><span class="release-note-date">2026-05-31</span></div>
                <p class="release-note-summary">优化微信群统计摘要素材选择，让阶段总结更贴近真实聊天记录。</p>
                <ul class="release-note-points"><li>减少空泛总结，优先使用真实群消息线索。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.65</span><span class="release-note-date">2026-05-31</span></div>
                <p class="release-note-summary">继续完善微信群图片战报和日报发送链路，减少无数据榜单刷屏。</p>
                <ul class="release-note-points"><li>低数据场景会更克制地组织榜单和总结。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.64</span><span class="release-note-date">2026-05-31</span></div>
                <p class="release-note-summary">改进微信群助手离线/恢复状态在设置页的提示，区分缓存群和真实在线。</p>
                <ul class="release-note-points"><li>避免把历史群缓存误看成当前可用连接。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.63</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">为掉线二维码通知补充 UI 状态与冷却配置展示，方便确认 ClawBot 是否在线。</p>
                <ul class="release-note-points"><li>展示通知开关、自动生成二维码、冷却时间和最近错误。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.62</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">微信群助手掉线二维码自动通知：离线后通过 ClawBot 自己发送重新登录二维码。</p>
                <ul class="release-note-points">
                  <li>持续监控微信群助手真实在线状态，离线且暂无二维码时可自动重新生成二维码。</li>
                  <li>二维码会生成 PNG，并通过“微信 ClawBot（个人微信）”发送到 ClawBot 自己，不需要选择联系人。</li>
                  <li>新增通知开关、自动生成二维码开关、重复通知冷却和通知状态显示。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.61</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">网络能力设置页 UI 精修：Key 池、兜底渠道和保存动作更清楚。</p>
                <ul class="release-note-points">
                  <li>设置窗口加宽加高，网络能力页新增顶部总览、能力状态卡片和底部保存操作条。</li>
                  <li>Brave Key 1~10 改为卡片式槽位，状态显示本地 / ENV / 空，清空操作更直观。</li>
                  <li>Serper、Jina、SearXNG 改为独立兜底渠道卡片，状态统一为胶囊组件。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.60</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">网络能力大版本：Brave Key 池、网络图片直接发图、链接真实查看防假执行。</p>
                <ul class="release-note-points">
                  <li>网络能力菜单新增 10 个 Brave Search Key 槽位，无额度/限流会自动轮换。</li>
                  <li>web_search 优先 Brave，全部不可用时回落 Serper、SearXNG、Bing、Jina、DuckDuckGo。</li>
                  <li>微信群找图/发网络图片会直接发图片/GIF；链接查看必须真实 fetch_url/browser_read，禁止只说“正在查看”。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.59</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">微信群引用回复可见化：引用消息和聊天记录证据不再“看不出来”。</p>
                <ul class="release-note-points">
                  <li>引用文字/图片/语音/视频/链接/小程序后 @ 助手，依赖引用回答时会先显示一行“引用…”依据。</li>
                  <li>send_message 增加底层兜底，模型忘写引用行时会自动补上，不会再像没引用一样直接回答。</li>
                  <li>聊天记录检索类问题会要求显示一条关键历史证据，例如“引用聊天记录：时间 昵称：摘要”。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.58</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">修复微信群排行榜同一成员占多个名次的问题，统计会按稳定身份/群昵称合并。</p>
                <ul class="release-note-points">
                  <li>发言、发图、表情、链接、装逼榜统一合并历史 sender_id。</li>
                  <li>拿不到稳定 wxid 时按当前群昵称合并，避免同一人重复上榜。</li>
                  <li>参与人数也按合并后的成员身份计算，不再被历史 ID 虚高。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.57</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">修复微信群图片解析真实接口可用但后台报空内容的问题，当前识图状态已恢复正常。</p>
                <ul class="release-note-points">
                  <li>识图调用改为原始 fetch 解析中转响应，不再被 OpenAI SDK 响应格式兼容问题误判为空。</li>
                  <li>专用 Skill 识图渠道优先于当前 LLM，减少空返回和超时等待。</li>
                  <li>陈旧 running 图片任务会自动重排队，状态区会区分待处理、解析中和失败数。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.56</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">根据 5 张失败图片真实测试修复识图超时：gpt-5.4 可用但大图需要 22~33 秒。</p>
                <ul class="release-note-points">
                  <li>gpt-4o-mini 在指定渠道真实图片请求中 5/5 返回 502。</li>
                  <li>gpt-5.4 对小图成功，对大图可成功但需要更长等待。</li>
                  <li>识图调用不再硬压 25 秒，改为按设置里的超时执行。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.55</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">识图渠道测试改为真实多模态调用，不再把 /models 可用误判为图片识别可用。</p>
                <ul class="release-note-points">
                  <li>测试连通会发送一张测试图片到 chat.completions，返回非空才算识图可用。</li>
                  <li>识图状态区分“最近成功 / 最近失败 / 待真实识图”。</li>
                  <li>图片库状态会显示最近失败摘要，例如 503、超时或返回空内容。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.54</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">Skill 技能新增模型渠道池，生图/识图可配置多个渠道并自动故障切换。</p>
                <ul class="release-note-points">
                  <li>生图和识图渠道支持新增、删除、排序、设为默认和测试连通。</li>
                  <li>渠道失败时自动尝试下一个已启用渠道，失败原因会汇总反馈。</li>
                  <li>识图请求会先确认图片已入库并开始识别，避免坏模型表现为完全没响应。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.53</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">修复微信群图片理解链路：连续 @、补充文字、再发图片时不再只看到 [图片] 占位。</p>
                <ul class="release-note-points">
                  <li>纯 @ 或看图请求会短暂等待同一成员后续文字/图片入库，再合并处理。</li>
                  <li>命中“总结图片/看看图/解析截图”时直接从当前群图片库取最近图片调用识图模型。</li>
                  <li>识图候选模型去重并限制单候选超时，坏模型会明确反馈错误，不再让文本模型猜图。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.52</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">完成 Web 微信系统级 @ 实验：MsgSource 注入可发出消息，但不能触发「有人@我」。</p>
                <ul class="release-note-points">
                  <li>新增本机调试接口，可对指定群和成员测试 MsgSource/atuserlist。</li>
                  <li>真实微信群实测 4 种载荷均只显示普通文本 @，没有系统级提醒。</li>
                  <li>生产回复保持可见 @ 昵称兜底；真正系统 @ 需改走 Mac 微信 UI 自动化或真实 mention puppet。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.51</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">修复微信群可见 @ 昵称显示：回复和渠道告警不再出现空 @ 或 @ 后直接接正文。</p>
                <ul class="release-note-points">
                  <li>Web 微信链路会手动拼出真实群昵称，确保群里能看到明确 @ 对象。</li>
                  <li>普通群回复仍锁定真实提问人 sender_id，模型选错 target 也会被底层纠正。</li>
                  <li>模型自己写的开头 @ 会被清理并重建为正确群昵称。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.50</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">LLM 渠道连通通知新增按群选择 @ 人员，异常通知能精准提醒指定成员。</p>
                <ul class="release-note-points">
                  <li>每个通知微信群都能加载成员、按微信昵称搜索并勾选要 @ 的人。</li>
                  <li>底层保存真实 sender_id，避免改昵称或同名导致误 @。</li>
                  <li>不选择 @ 人员时只发群通知，不会误 @ 全员。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.49</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">新增 LLM 渠道连通通知，可定时检测模型池渠道并通知到指定微信群。</p>
                <ul class="release-note-points">
                  <li>可配置通知间隔、通知策略、检测渠道和通知群组。</li>
                  <li>设置页新增大尺寸下拉和卡片多选列表，避免控件太小不好用。</li>
                  <li>支持立即检测/立即检测并通知；通知不展示 API Key。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.48</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">微信群新增引用消息上下文理解，引用文字/图片/语音/视频/链接/小程序后能按引用回答。</p>
                <ul class="release-note-points">
                  <li>新增精简引用上下文块，只给类型、发送者、摘要、URL/标题和引用后的当前请求。</li>
                  <li>不把原始 XML、base64、完整历史塞进模型，减少 token 和误判。</li>
                  <li>图片引用优先结合图片解析库；语音无转写时明确说明，不编造内容。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.47</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">优化图片解析库控件可用性，并新增编辑/删除图片管理能力。</p>
                <ul class="release-note-points">
                  <li>群组、状态、关键词、发送人和时间筛选改为大尺寸控件，新增查询/重置按钮。</li>
                  <li>每张图片可编辑识图描述和标签，保存后立即刷新。</li>
                  <li>每张图片可删除数据库记录，并尝试删除本机已入库图片文件；不允许删除任意本机路径。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.46</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">数据库页新增微信群图片解析库，可看进度、浏览缩略图、搜索图片并后台补解析。</p>
                <ul class="release-note-points">
                  <li>显示图片总数、已解析、待解析、解析中、失败/无模型和 base64 备份数量。</li>
                  <li>支持按群组、解析状态、关键词、发送人和时间筛选图片。</li>
                  <li>数据库页每 10 秒自动刷新，并在存在待解析图片时自动触发后台补解析。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.45</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">增强微信群图片检索时间理解，可按时间、成员和图片内容联合找图。</p>
                <ul class="release-note-points">
                  <li>支持今天/昨天/几月几日/上午下午晚上/几点几分/刚才最近等自然时间表达。</li>
                  <li>图片转发会把时间范围、发送者昵称/别名、识图描述和 OCR 内容一起打分。</li>
                  <li>真实 PT 群图片库已验证“今天09:15力佬发的newapi图”可命中对应图片。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.44</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">修复微信群图片转发检索，能把“力佬发的 newapi 图”正确匹配到已入库图片。</p>
                <ul class="release-note-points">
                  <li>newapi / New API / New-API 统一归一化匹配。</li>
                  <li>图片库搜索加入发送者昵称、花体昵称标准化和“力佬/大力/Dali”别名兼容。</li>
                  <li>已入库但还没完成识图描述的图片也可作为兜底候选，避免刚收到图就说找不到。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.43</span>
                  <span class="release-note-date">2026-05-29</span>
                </div>
                <p class="release-note-summary">新增已入库群图片转发能力，并避免把“山水画”误判成生图。</p>
                <ul class="release-note-points">
                  <li>“把那张图发给我/转发刚才那张图”会优先从当前群图片库发送原图。</li>
                  <li>只允许发送当前群已入库微信图片，不允许任意本机文件外发。</li>
                  <li>生图触发词进一步收紧，避免名词里的“画”误触发。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.42</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">修复看图、识图、引用图片被误判成生图的问题。</p>
                <ul class="release-note-points"><li>包含看、识别、图里、引用、报错、内容等意图时，不会触发生图 Skill。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.41</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">修复 Skill 技能页输入框/下拉框过小的问题。</p>
                <ul class="release-note-points"><li>生图和识图配置项使用正常宽度、正常高度的大表单控件。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.40</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">新增识图 Skill，微信群图片可生成中文描述和标签。</p>
                <ul class="release-note-points"><li>保存本地图片、base64 和元数据，供后续图片库检索。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.39</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">微信群成员/昵称按群名和昵称聚合显示。</p>
                <ul class="release-note-points"><li>数据库页不再直接显示历史身份记录总数，减少误读。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.38</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">取消微信群统计总结的启动/登录自动补发。</p>
                <ul class="release-note-points"><li>程序启动、扫码登录或恢复连接后，不再立刻向群里发送阶段总结。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.37</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">Honcho 本地服务接通并完成健康检查。</p>
                <ul class="release-note-points"><li>记录外部记忆后端健康状态；后续版本逐步改为可选后端。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.36</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">清理错误记忆 fact_user_wechat_groups_18。</p>
                <ul class="release-note-points"><li>18 个微信群是历史 ID 混淆，不再作为事实使用。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.35</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">LLM 模型池每个模型卡片新增“测试连通”按钮。</p>
                <ul class="release-note-points"><li>可以直接验证某个模型配置是否可用。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.34</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">LLM 模型池新增直观连通状态显示。</p>
                <ul class="release-note-points"><li>设置页显示最近成功、失败和冷却状态。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.33</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">记录生图真实耗时测试结果。</p>
                <ul class="release-note-points"><li>low / 1024x1024 两次生图约 84 秒和 75 秒。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.32</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">修复微信群生图触发词过窄的问题。</p>
                <ul class="release-note-points"><li>支持“生成一张赛博朋克风格头像”等自然表达。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.31</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">新增 Skill 技能设置菜单，首个技能为生图 Skill。</p>
                <ul class="release-note-points"><li>为后续识图、视频理解等能力提供统一入口。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.30</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">尝试采集微信群成员稳定微信身份字段。</p>
                <ul class="release-note-points"><li>成员库新增 wechat_id、wxid、stable_key 和 raw_identity。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.29</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">修复 Wechaty 重新登录后管理员 sender_id 变化导致权限失效。</p>
                <ul class="release-note-points"><li>尽量按稳定微信身份补录新的 sender_id。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.28</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">修复已验证微信群管理员仍被发送层安全黑名单拦截的问题。</p>
                <ul class="release-note-points"><li>管理员入口检查通过后会把 wechat_admin 标记传递到发送层。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.27</span><span class="release-note-date">2026-05-29</span></div>
                <p class="release-note-summary">修复表情包搜索总是发送同一张的问题。</p>
                <ul class="release-note-points"><li>高质量候选池会按随机种子打散，不再永远取第一张。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.26</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">彻底修复斗图仍发送裸 URL 的问题。</p>
                <ul class="release-note-points"><li>同时剥离 Markdown 图片、Markdown 链接和纯 URL。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.25</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">修复微信群斗图发送时先显示图片/GIF URL 链接的问题。</p>
                <ul class="release-note-points"><li>默认隐藏 URL 文本，只直接发送图片或 GIF。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.24</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">新增 AI 斗图表情包能力。</p>
                <ul class="release-note-points"><li>接入慕名 API / xiaoapi 表情搜索接口。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.23</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">新增微信群助手掉线检测机制。</p>
                <ul class="release-note-points"><li>登录态恢复超时、logout、连接错误和健康检查失败会标记离线。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.22</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">修复微信群列表重复显示的问题。</p>
                <ul class="release-note-points"><li>重新登录后同名群按群名归并，只显示一个真实群。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.21</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">统一新增微信群显示来源。</p>
                <ul class="release-note-points"><li>已识别/有记录的新群会出现在 @ 回复、群记忆、聊天记录和统计候选中。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head"><span class="release-note-version">v0.4.20</span><span class="release-note-date">2026-05-28</span></div>
                <p class="release-note-summary">修复外部 Honcho 未启动时影响设置页和 LLM 模型操作的问题。</p>
                <ul class="release-note-points"><li>外部记忆后端离线会降级跳过，不再拖垮模型编辑和删除。</li></ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.19</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">管理员设置页改为昵称显示和昵称搜索，底层仍精确 ID 授权。</p>
                <ul class="release-note-points">
                  <li>已选管理员区域显示微信昵称，不再显示长 sender_id。</li>
                  <li>搜索框按微信昵称搜索，点击成员卡片添加/取消管理员。</li>
                  <li>后台仍保存精确 sender_id，昵称相同或自称管理员不会获得权限。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.18</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">修复微信群发送失败导致回复变慢，并支持多人同时 @ 并行处理。</p>
                <ul class="release-note-points">
                  <li>真实 sender_id 回复目标会进入本轮发送白名单，避免 target_id 校验先失败再重试。</li>
                  <li>短时间多条 Wechaty 群 @ 默认最多 3 条并行处理，继续使用同一套性格、安全和记忆逻辑。</li>
                  <li>并行回复仍分别锁定各自真实提问人，不会串 @。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.17</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">修复微信群 @ 错人和管理员模式：回复目标底层锁定真实提问人，管理员设置立即生效。</p>
                <ul class="release-note-points">
                  <li>send_message 在 Wechaty 群消息上下文下强制使用本轮真实 sender_id，不允许模型把回复 @ 到被讨论对象。</li>
                  <li>修复管理员模式勾选被状态轮询清掉的问题，保存后立即生效。</li>
                  <li>管理员选择新增昵称/群名/ID 搜索框，点成员卡片即可加入管理员。</li>
                  <li>普通群友暗算、嘲讽或要求伤害管理员时，会站在管理员一边短句回怼，不执行危险操作。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.16</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">修复微信群回答不查聊天记录库导致“记不完整”：历史问题会先查当前群 SQLite 流水。</p>
                <ul class="release-note-points">
                  <li>微信群 @ 回复新增聊天记录库证据检索，按问题关键词、@ 对象和称呼词查当前群历史消息。</li>
                  <li>新增 <code>wechat-group-archive-evidence</code> 证据区，回答“谁说过/老登是谁/称呼关系/之前记录”时优先基于数据库。</li>
                  <li>检索严格按当前微信群隔离，不把其他群记录混进来。</li>
                  <li>证据里没有时要求明确说明没查到，避免靠常识或最近上下文瞎猜。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.15</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">修复微信群聊天记录页“不更新”的误判：明确当前查看群，并让结束时间自动跟随现在。</p>
                <ul class="release-note-points">
                  <li>聊天记录库新增“查看群组”下拉框，不再只能跟随左侧 Honcho 记忆群选择。</li>
                  <li>默认结束时间会在每次查询前自动刷新到当前时间，避免设置页长开后新消息被旧时间过滤。</li>
                  <li>微信群助手页停留时会自动刷新聊天记录列表，不再只刷新统计榜单。</li>
                  <li>记录摘要显示当前查看群和 DB 最新入库时间，方便判断是选错群、筛选范围问题还是真没入库。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.14</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">修复微信群重复回复：成功回复一次后立即结束，不再外发内部结束语。</p>
                <ul class="release-note-points">
                  <li>微信群 @ 回合成功 send_message 后本轮立即停止，避免继续生成第二条/第三条。</li>
                  <li>拦截“已回复/回复完毕/发送完毕/本轮结束/无需补充”等内部状态外发。</li>
                  <li>如果已成功回复，后续 LLM 超时或报错不会重新排队该消息，避免重复刷屏。</li>
                  <li>模型收到更明确的微信群回复规则：只发一条自然回答，不发协议状态。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.13</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">清理后台内部 skip 日志显示：避免再把正常记忆空结果看成“跳过消息”。</p>
                <ul class="release-note-points">
                  <li>后台记忆识别/整合内部工具不再输出“工具调用 skip_recognition/skip_consolidation”。</li>
                  <li>“显式跳过”日志改为“无需写入记忆 / 无需整理”，含义更准确。</li>
                  <li>TICK 只做节奏/界面等运行时动作时不再进入记忆识别器。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.12</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">彻底修复后台一直“跳过识别/跳过整理”：内部记忆工具不再循环刷屏。</p>
                <ul class="release-note-points">
                  <li>记忆识别器遇到 skip_recognition / upsert_memory 后立即结束，不再继续问模型下一步。</li>
                  <li>记忆整合器遇到 skip_consolidation / merge / downgrade 后立即结束，避免内部整理循环熔断。</li>
                  <li>TICK 心跳没有实际工具动作时不再进入记忆识别，减少空闲状态的无意义识别。</li>
                  <li>内部记忆工具不写入审计流，前端思考流也隐藏这些内部协议工具。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.11</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">修复一直“跳过识别”不回复：记忆识别器内部工具不再污染主对话。</p>
                <ul class="release-note-points">
                  <li>主对话工具列表强制过滤 skip_recognition 等记忆识别/整理内部工具。</li>
                  <li>recent action log 注入也会过滤这些内部工具，避免历史 skip 状态影响新消息。</li>
                  <li>微信群 @ 消息即使模型返回“已回复/无需补充”，也会被 fallback 纠正，不再静默跳过。</li>
                  <li>新增 tool-router 测试，覆盖内部记忆工具不能通过 action log 保活进主对话。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.10</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">Wechaty 启动卡住自恢复修复：避免重启后假 starting 导致群消息进不来。</p>
                <ul class="release-note-points">
                  <li>启动 60 秒仍没有二维码、登录事件或真实在线状态时，自动重启 Wechaty 连接。</li>
                  <li>设置页“登录/恢复微信”不再把无二维码的 starting 当作已运行，会走重启恢复。</li>
                  <li>和 v0.4.9 的持续入库配合，确保“能收到消息”和“收到就入库”两层都稳定。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.9</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群聊天记录库持续入库修复：原始聊天流水不再被统计/日报群组勾选拦截。</p>
                <ul class="release-note-points">
                  <li>只要程序运行且 Wechaty 收到群消息，就会写入本机 SQLite 聊天记录库。</li>
                  <li>群统计与定时总结的勾选项只控制排行榜和自动发送，不再影响原始记录入库。</li>
                  <li>非微信群助手接入群只做本地记录，不进入 Honcho、大模型或自动回复链路。</li>
                  <li>修复前已为当前数据库创建 SQLite 备份，避免误判为数据丢失。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.8</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群 @ 回复目标链路热修复：正确解析带成员的 Wechaty 群目标，避免发送时 room_id 被拼坏。</p>
                <ul class="release-note-points">
                  <li>支持解析 <code>wechaty:room:&lt;room&gt;:member:&lt;member&gt;</code>，分开发送群 room_id 和 @ 对象 member_id。</li>
                  <li>如果模型只传 target_id，也会用 member_id 作为兜底 @ 对象。</li>
                  <li>继续坚持精确成员 ID 匹配，找不到真实成员就不 @，避免 @ 错主人或上一位提问人。</li>
                  <li>新增 social target 解析测试，覆盖旧格式、新编码格式和带成员格式。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.7</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群 @ 回复对象修复：按当前提问人的 sender_id / sender_name 精确 @ 回去，不再误 @ 管理员或上一位成员。</p>
                <ul class="release-note-points">
                  <li>每条群消息生成独立回复目标，send_message 会明确指向当前提问人。</li>
                  <li>发送时优先在当前群成员列表里按 contact.id 精确找人，找不到就不模糊猜测。</li>
                  <li>群消息 prompt 中会明确要求回复当前提问人，减少模型选错 target_id 的概率。</li>
                  <li>顺带解释了当前聊天记忆不是全库直塞，而是按群/成员/最近上下文分层注入。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.6</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">LLM 多模型池与自动故障切换：一个模型没额度或不可用时自动切备用模型。</p>
                <ul class="release-note-points">
                  <li>设置页 LLM 模型菜单新增模型池，可添加、编辑、启停、排序、删除和设为当前。</li>
                  <li>自动切换策略默认开启，支持失败冷却时间和最多尝试模型数。</li>
                  <li>额度不足、限流、认证失败、模型不可用、5xx、网络超时时会自动切换备用模型。</li>
                  <li>只在尚未输出内容时切换，避免回复重复、语音断裂；API 不返回明文 Key。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.5</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群多群统计、排队回复与管理员模式：多人 @ 不再吞消息，多群排行榜标明来源群。</p>
                <ul class="release-note-points">
                  <li>多人同时 @ 时按队列顺序逐条回复，不再被同群后一条消息覆盖。</li>
                  <li>统计页新增“当前群 / 已选统计群总览”，多群排行榜每行显示群名。</li>
                  <li>新增精确 sender_id 管理员模式，可从成员 ID 列表点选添加。</li>
                  <li>设置页停留在微信群助手时，榜单会自动刷新。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.4</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群昵称强制刷新与记录库 UI 优化：修复“未知成员”，并说明记录库和群记忆的区别。</p>
                <ul class="release-note-points">
                  <li>直接调用 wechat4u 群成员资料刷新，解决重新登录后昵称仍未知的问题。</li>
                  <li>新增“刷新昵称”按钮，在线时可手动回填群成员昵称。</li>
                  <li>重新扫码导致 room_id 变化时，统计和聊天记录按群名合并。</li>
                  <li>查询区新增主查询按钮、今天快捷按钮和更清晰的日期输入框。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.3</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群聊天记录库：按群查看完整入库消息，支持时间筛选、昵称映射、媒体预览和导入导出。</p>
                <ul class="release-note-points">
                  <li>新增“微信群聊天记录库”，显示已入库总数、完整时间、成员昵称、内容和媒体标记。</li>
                  <li>支持开始/结束时间、类型、关键词筛选和分页加载更多。</li>
                  <li>JSON 导出包含媒体 base64 备份，CSV 导出方便表格查看，JSON 导入会恢复记录和媒体。</li>
                  <li>新收到的图片/表情/音视频会尝试保存到本机数据目录，并可在设置页预览。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.2</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群排行榜昵称修复：发言榜/发图榜等优先显示微信群昵称，不再暴露内部 ID。</p>
                <ul class="release-note-points">
                  <li>优先读取群昵称、微信备注和微信昵称，过滤 @ 开头的 WeChaty 内部 ID。</li>
                  <li>接入群或收到消息后后台刷新成员列表，自动回填旧统计行。</li>
                  <li>排行榜按 sender_id 合并，昵称变化不会把同一个人拆成多条。</li>
                  <li>最近记录、链接列表和群总结重点线索同步清洗昵称。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.1</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">群统计选择修复：统计/定时总结必须手动勾选群组，统计数据和成员记忆更直观。</p>
                <ul class="release-note-points">
                  <li>新增统计/定时总结专用群组选择，未选择群不会统计也不会自动发送。</li>
                  <li>统计面板显示本机 SQLite 表位置，并展示最近写入的统计记录。</li>
                  <li>Honcho 群组长期记忆和成员长期记忆固定显示空状态。</li>
                  <li>历史英文内部协议误回复在记忆展示和上下文注入中隐藏。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.4.0</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群统计与定时总结大版本：全量记录群消息，新增排行榜、日报和阶段总结设置。</p>
                <ul class="release-note-points">
                  <li>修复群里偶发回复英文内部协议文本的问题。</li>
                  <li>全量统计文字、图片、表情、链接和装逼指数，不只记录 @ 消息。</li>
                  <li>新增每日 00:00 群日报、阶段总结、手动立即发送本群总结。</li>
                  <li>设置页新增统计卡片和发言/发图/表情/链接/装逼排行榜。</li>
                  <li>成员长期记忆从消息元数据补全 peer，展示更稳定。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.10</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">性格保存与记忆展示修复：预设不再跳自定义，新增性格保存按钮，成员记忆单独展示。</p>
                <ul class="release-note-points">
                  <li>修复状态轮询覆盖性格编辑区，导致预设卡片跳到自定义的问题。</li>
                  <li>性格设定区新增“保存性格并生效”按钮，保存后状态立即显示已生效。</li>
                  <li>Honcho 详情拆分“群组长期记忆”和“成员长期记忆”。</li>
                  <li>成员记忆明确只在当前微信群内生效，并与群组记忆共同参与匹配。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.9</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群网络图片发送补强：公开图片 URL 可作为图片发送，本机文件引用出站拦截。</p>
                <ul class="release-note-points">
                  <li>识别 https 图片 URL 和 Markdown 图片并用 FileBox.fromUrl 发送。</li>
                  <li>只允许 png/jpg/jpeg/gif/webp 公开网络图片，单条最多 3 张。</li>
                  <li>拦截 file://、/Users、~/、桌面/相册/截图等本机文件引用。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.8</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群体验增强：网络梗理解、网络图边界、性格状态更明显、称呼身份即时记忆。</p>
                <ul class="release-note-points">
                  <li>v我50 / vw50 / 疯狂星期四等中文网络梗会按群聊语境理解。</li>
                  <li>允许公开网络图片/表情包链接，禁止本机文件、桌面文件、截图、相册外发。</li>
                  <li>性格设定显示“当前生效 / 已生效 / 有未保存修改”，并加入自定义性格卡片。</li>
                  <li>“以后叫我大哥 / 我是你大哥 / 我叫xxx”会即时写入本群长期记忆。</li>
                  <li>新增 test:wechat-memory 自动测试。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.7</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">紧急安全修复：微信群黑名单补拦截查看桌面、本机文件列表和系统盘点请求。</p>
                <ul class="release-note-points">
                  <li>新增本机文件/目录盘点规则，拦截“查看桌面有啥文件”等请求。</li>
                  <li>新增本机系统信息盘点规则，拦截查看配置、进程、窗口、软件列表等请求。</li>
                  <li>扩展凭证规则，补上“把 .env 发群里”这类表达。</li>
                  <li>ClawBot 群聊路径也接入安全守卫，避免旁路绕过。</li>
                  <li>新增自动测试脚本 test:wechat-guard。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.6</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群助手性格预设：新增 3 种可一键套用的人格风格，并过滤旧项目网页微信流程。</p>
                <ul class="release-note-points">
                  <li>新增“主人数字分身 / 技术值班助手 / 幽默社交助手”三张预设卡片。</li>
                  <li>点击预设只填入提示词，不会立即生效；确认后仍需点“保存并生效”。</li>
                  <li>预设提示词适配当前 Wechaty + Honcho：不包含 wx.qq.com、DOM、browser_evaluate、浏览器轮询等旧流程。</li>
                  <li>可查看当前是否完全匹配某个预设；手动编辑后显示为自定义提示词。</li>
                  <li>危险电脑操作仍由安全黑名单强制拦截，性格设定不能绕过。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.5</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群助手记忆管理增强：按群查看/管理 Honcho 记忆，新增性格设定和完整安全隔离词库。</p>
                <ul class="release-note-points">
                  <li>设置页新增微信群助手性格提示词输入框，保存后直接注入群回复 prompt。</li>
                  <li>Honcho 群知识库改为左侧群列表、右侧详情，可查看原始消息、自动摘要、长期结论。</li>
                  <li>支持手动添加本群长期记忆、删除单条结论、清空本群 Honcho session。</li>
                  <li>安全黑名单扩展为 17 类危险指令规则，并以卡片展示说明、示例和替代方案。</li>
                  <li>设置窗口放大，保存群选择时不再因搜索过滤误取消隐藏群。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.4</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群助手真实状态修复：不再假在线，新增强制重新扫码入口。</p>
                <ul class="release-note-points">
                  <li>旧群列表只显示为缓存，不再当成当前在线证据。</li>
                  <li>没有真实刷新群列表时不会再提示“群列表已刷新”。</li>
                  <li>新增“强制重新扫码”，清空坏登录态并重新生成二维码。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.3</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">关闭行为修复：点击主窗口关闭按钮会彻底退出，不再只是隐藏到菜单栏。</p>
                <ul class="release-note-points">
                  <li>主窗口 close 不再拦截为 hide，避免用户以为关闭了但后台仍运行。</li>
                  <li>关闭最后一个窗口后调用 app.quit，菜单栏图标和后台服务会一起退出。</li>
                  <li>菜单栏“显示主界面 / 退出”仍保留，运行时可继续手动操作。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.2</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群登录态修复：扫码态写入 userData，正常重启后优先自动恢复。</p>
                <ul class="release-note-points">
                  <li>显式挂载 Wechaty MemoryCard，避免登录态写到项目临时目录。</li>
                  <li>正常 stop/restart 不再主动删除 PUPPET-WECHAT4U 登录数据。</li>
                  <li>状态接口新增 login_memory 诊断信息，区分真实在线和历史群列表快照。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.1</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群 @ 修复：只要微信元数据确认 @ 当前登录账号，就必须回复，不再看昵称关键词。</p>
                <ul class="release-note-points">
                  <li>修复群里 @ 后仍回复“没叫我，跳过”的问题。</li>
                  <li>移除固定昵称/唤醒词绑定，进群改名、改微信昵称、改备注都不影响 @ 回复。</li>
                  <li>send_message 和 fallback 增加保护，禁止把错误跳过文本发回微信群。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.3.0</span>
                  <span class="release-note-date">2026-05-28</span>
                </div>
                <p class="release-note-summary">微信群助手里程碑版：扫码登录、多群勾选、群里 @ 后调用大模型回复，并加入 Honcho 群知识库入口。</p>
                <ul class="release-note-points">
                  <li>新增独立“微信群助手”设置页，登录状态、群列表和已选群组都显示真实运行状态。</li>
                  <li>修复保存群组后 Wechaty 掉线、@ 后无响应、以及测试话术硬编码回复的问题。</li>
                  <li>群消息 @ 登录账号后会进入 LLM，并 @ 原提问人回复，避免暴露内部 ID。</li>
                  <li>新增 Honcho 群知识库配置和预览入口，每个微信群独立 session，避免记忆串群。</li>
                  <li>新增微信群高危指令黑名单，默认拒绝删除文件、外传密钥、执行命令、支付转账等危险请求。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.2.0</span>
                  <span class="release-note-date">2026-05-27</span>
                </div>
                <p class="release-note-summary">小智式语音会话状态机：每轮语音独立 turn，旧回调不再串入新一轮。</p>
                <ul class="release-note-points">
                  <li>新增 voiceTurnId 全链路隔离，覆盖语音输入、LLM 流式输出和 TTS 队列。</li>
                  <li>新增统一 abortSpeaking 打断控制，新一轮语音开始会取消旧播报。</li>
                  <li>设置页保持简洁，不新增复杂参数。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.1.1</span>
                  <span class="release-note-date">2026-05-27</span>
                </div>
                <p class="release-note-summary">修复语音输入不回复、以及下一次识别带上上一轮内容的问题。</p>
                <ul class="release-note-points">
                  <li>语音识别结果发送后会立刻清空缓存和自动发送计时器。</li>
                  <li>本地语音输入统一走 voice 通道，避免被错当成 TUI/外部消息。</li>
                  <li>语音通道默认直接回复正文，由运行时负责显示和播报。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v0.1.0</span>
                  <span class="release-note-date">2026-05-26</span>
                </div>
                <p class="release-note-summary">小智式极速语音交互内核：更快开口、分句播报、可打断。</p>
                <ul class="release-note-points">
                  <li>语音通道下，LLM 正式回答会边生成边按句触发 TTS，不再等整段回答结束。</li>
                  <li>TTS 改为队列式分句播放，用户打断时会取消后续队列和正在请求的语音。</li>
                  <li>设置页新增“极速语音模式”开关，默认开启，可随时回退整段播报。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v2.1.209</span>
                  <span class="release-note-date">2026-05-26</span>
                </div>
                <p class="release-note-summary">补齐版本更新记录机制，在文档和设置页加入更新说明。</p>
                <ul class="release-note-points">
                  <li>新增 CHANGELOG.md，集中记录每个版本的更新内容、改变原因和部署注意事项。</li>
                  <li>README 增加版本更新记录入口，备份文档增加每次备份必须更新的清单。</li>
                  <li>设置页更新 tab 增加最近版本摘要，打开软件就能看到当前版本改了什么。</li>
                </ul>
              </article>
              <article class="release-note-card">
                <div class="release-note-head">
                  <span class="release-note-version">v2.1.208</span>
                  <span class="release-note-date">2026-05-26</span>
                </div>
                <p class="release-note-summary">本地语音助手大版本：中文优先 ASR、唤醒词和视频抗干扰。</p>
                <ul class="release-note-points">
                  <li>默认本地 ASR 改为 SenseVoiceSmall，Whisper 保留为备用模型。</li>
                  <li>新增唤醒词开关、自定义唤醒词和视频抗干扰设置。</li>
                  <li>新增视频播放场景的自动降音/暂停、空格按住说话和系统 AEC 开关。</li>
                  <li>本地 ASR 增加静音门控、低置信度过滤和重复幻觉文本过滤。</li>
                  <li>新增 Mac 自部署与备份文档，说明模型、虚拟环境和个人数据如何恢复。</li>
                </ul>
              </article>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">通知偏好</div>
            <div class="settings-row">
              <label class="settings-label" for="settings-suppress-updates">不再提醒更新</label>
              <label class="settings-toggle">
                <input type="checkbox" id="settings-suppress-updates">
                <span class="settings-toggle-track"></span>
              </label>
            </div>
            <p class="settings-hint">开启后发现新版本时不会弹出提示卡片，仍可在此处手动检查。</p>
          </div>
          <div class="settings-section" id="settings-ignored-section" style="display:none;">
            <div class="settings-section-label">已忽略的版本</div>
            <div class="settings-row">
              <span class="settings-config-info" id="settings-ignored-version-val">—</span>
              <button class="settings-save-btn" id="settings-clear-ignored-btn" type="button" style="width:auto;padding:0 12px;margin-left:auto;">清除忽略</button>
            </div>
          </div>
        </div>

      </div><!-- /settings-content -->
    </div><!-- /settings-body -->
  </div>
</div>
`;

const createVoicePanel = () => `
<div class="voice-panel" id="voice-panel">
  <canvas id="voice-canvas" width="160" height="160"></canvas>
  <div class="voice-transcript" id="voice-transcript"></div>
</div>
`;

const createVideoPanel = () => `
<div class="video-panel" id="video-panel">
  <div class="media-stage-head">
    <div class="media-stage-title" id="video-title">视频</div>
    <button class="video-exit-btn" id="video-exit-btn" type="button" title="关闭视频">x</button>
  </div>
  <div class="video-surface" id="video-surface">
    <div class="video-backdrop" id="video-backdrop"></div>
    <video id="video-feed" playsinline controls></video>
    <iframe id="video-frame" title="视频播放器" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen hidden></iframe>
    <div class="video-empty" id="video-empty">
      <div class="video-empty-title">无视频源</div>
      <div class="video-open-row">
        <input id="video-url-input" class="video-url-input" type="text" placeholder="粘贴 YouTube / Bilibili / mp4 / webm / 本地视频路径" />
        <button id="video-open-btn" class="video-open-btn" type="button">播放</button>
      </div>
    </div>
  </div>
</div>
`;

const createMusicPanel = () => `
<div class="music-panel" id="music-panel">
  <div class="media-stage-head">
    <div class="media-stage-title" id="music-panel-title">音乐</div>
    <button class="music-exit-btn" id="music-exit-btn" type="button" title="退出音乐模式">×</button>
  </div>
  <div class="music-stage">
    <div class="music-turntable">
      <div class="music-vinyl" id="music-vinyl">
        <div class="music-groove music-groove-1"></div>
        <div class="music-groove music-groove-2"></div>
        <div class="music-groove music-groove-3"></div>
        <div class="music-groove music-groove-4"></div>
        <div class="music-cover" id="music-cover">
          <div class="music-cover-title" id="music-cover-title">♪</div>
          <div class="music-cover-artist" id="music-cover-artist"></div>
        </div>
        <div class="music-spindle"></div>
      </div>
      <div class="music-tonearm-group" id="music-tonearm-group">
        <div class="music-tonearm-pivot"></div>
        <div class="music-arm-shaft"></div>
        <div class="music-headshell">
          <div class="music-stylus"></div>
        </div>
      </div>
    </div>
    <div class="music-lyrics-pane" id="music-lyrics-pane">
      <div class="music-lyrics-scroll" id="music-lyrics-scroll"></div>
      <div class="music-no-lyrics" id="music-no-lyrics" hidden>— 无歌词 —</div>
    </div>
  </div>
  <div class="music-footer">
    <div class="music-meta">
      <div class="music-meta-title" id="music-meta-title">—</div>
      <div class="music-meta-artist" id="music-meta-artist">—</div>
    </div>
    <div class="music-progress-row">
      <span class="music-time" id="music-time-cur">0:00</span>
      <input class="music-seek" id="music-seek" type="range" min="0" max="100" step="0.1" value="0">
      <span class="music-time" id="music-time-total">0:00</span>
    </div>
    <div class="music-controls-row">
      <button class="music-ctrl" id="music-prev" type="button" title="上一首">⏮</button>
      <button class="music-ctrl music-ctrl-play" id="music-play" type="button" title="播放/暂停">▶</button>
      <button class="music-ctrl" id="music-next" type="button" title="下一首">⏭</button>
      <input class="music-vol" id="music-vol" type="range" min="0" max="1" step="0.01" value="0.8" title="音量">
    </div>
  </div>
  <audio id="music-audio" preload="auto"></audio>
</div>
`;

const createImagePanel = () => `
<div class="image-panel" id="image-panel">
  <div class="media-stage-head">
    <div class="media-stage-title" id="image-title">图片</div>
    <button class="image-exit-btn" id="image-exit-btn" type="button" title="关闭图片">x</button>
  </div>
  <div class="image-surface" id="image-surface">
    <img id="image-display" alt="" />
    <div class="image-empty" id="image-empty">无图片源</div>
  </div>
</div>
`;

const createPanelTabs = () => `
<button id="panel-l1-tab" class="panel-tab panel-tab-left" aria-label="切换左面板" title="切换左面板 [ "></button>
<button id="panel-l2-tab" class="panel-tab panel-tab-right" aria-label="切换右面板" title="切换右面板 ] "></button>
`;

export function createBrainUiMarkup() {
  return [
    createGraphStage(),
    createPrimaryPanel(),
    createSecondaryPanel(),
    createConsole(),
    createTooltip(),
    createSettingsModal(),
    createVideoPanel(),
    createMusicPanel(),
    createImagePanel(),
    createHotspotPanel(),
    createPersonCardPanel(),
    createDocPanel(),
  ].join("\n\n");
}

export function renderBrainUiApp(root = document.body) {
  root.dataset.theme = "midnight";
  root.innerHTML = createBrainUiMarkup();
}
