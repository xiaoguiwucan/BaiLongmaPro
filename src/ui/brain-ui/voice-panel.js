// 声波点云球 + ASR 语音输入面板
// 默认本地 Whisper；也可切换云端 ASR（阿里云/腾讯云/讯飞），通过后端 WebSocket 代理
//
// 点云算法移植自 ACUI (Remix)/Voice Component.html

// ─── 球面采样（Fibonacci） ───
function fibSphere(n, radius) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r * radius, y: y * radius, z: Math.sin(theta) * r * radius });
  }
  return pts;
}

const BASE_PTS  = fibSphere(3200, 1.0);
const BASE_PTS2 = fibSphere(1200, 0.88);

// ─── 正弦噪声 ───
function sn(x, y, z, t) {
  return (
    Math.sin(x * 2.3 + t * 1.1) * Math.cos(y * 1.9 + t * 0.8) * 0.38 +
    Math.sin(y * 3.1 + t * 1.4) * Math.cos(z * 2.7 + t * 0.6) * 0.30 +
    Math.sin(z * 1.7 + t * 0.9) * Math.cos(x * 3.3 + t * 1.2) * 0.30 +
    Math.sin(x * 5.1 + y * 4.3 + t * 2.1) * 0.14
  );
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpArr(a, b, t) { return a.map((v, i) => lerp(v, b[i], t)); }

// ─── 状态配置 ───
// idle = 麦克风关闭（灰色）  listening = 麦克风开启待命（白色）
// recognizing = 正在识别（蓝色）  done = 识别完成（绿色，2s 后回 listening）
// speaking = AI 正在说话（紫色，可打断）
const STATE_CFG = {
  idle:        { amp: 0.003, spd: 0.10, r: [50,68,80],    g: [50,68,80],    b: [55,73,85]   },
  listening:   { amp: 0.055, spd: 0.75, r: [185,215,245], g: [185,215,245], b: [195,225,255] },
  recognizing: { amp: 0.55,  spd: 4.50, r: [25,75,165],   g: [95,155,230],  b: [195,230,255] },
  done:        { amp: 0.10,  spd: 1.20, r: [30,105,65],   g: [145,200,135], b: [45,90,60]   },
  processing:  { amp: 0.15,  spd: 1.10, r: [100,60,200],  g: [80,60,180],   b: [220,190,255] },
  error:       { amp: 0.10,  spd: 0.70, r: [200,240,255], g: [20,30,40],    b: [20,30,40]   },
  event:       { amp: 0.60,  spd: 4.00, r: [255,200,50],  g: [200,160,30],  b: [50,80,150]   },
  speaking:    { amp: 0.09,  spd: 1.00, r: [130,95,185],  g: [105,80,170],  b: [225,200,255] },
};

// ─── 打断检测参数 ───
const BARGEIN_WARMUP_MS  = 350  // TTS 开始后前 600ms 不检测（等 AEC 适应）
const BARGEIN_FRAMES     = 8    // 需要连续 8 帧高振幅（约 130ms）才触发
const BARGEIN_THRESHOLD  = 0.09 // 振幅阈值（高于环境噪声和 AEC 残留）
// 4096 samples @ 16kHz = 256ms/块；保留 1500ms ≈ 6 块
const BARGEIN_PRE_BUFFER_MS   = 1500
const BARGEIN_MAX_CHUNKS      = Math.ceil(BARGEIN_PRE_BUFFER_MS * 16000 / 1000 / 4096)

// ─── Duck 模式参数（两阶段检测：先压制音量再判断是否打断） ───
// 检测到高振幅先 duck（降音量），持续高振幅才真正打断；冲击噪音消退后直接恢复音量
const DUCK_TRIGGER_FRAMES  = 2    // 连续 3 帧高振幅 → 进入 duck 模式（≈50ms）
const DUCK_SUSTAIN_FRAMES  = 3   // duck 中再持续 10 帧高振幅 → 判定为语音，触发真正打断
const DUCK_DECAY_FRAMES    = 6    // duck 中连续 6 帧低振幅（≈100ms）→ 判定为噪音，恢复音量
const DUCK_MAX_MS          = 2600 // duck 最长持续时间，超时自动恢复

// ─── 快速非语音检测参数（真正打断后仍保留，用于误打断的快速恢复） ───
const BARGEIN_FAST_WINDOW_MS    = 500
const BARGEIN_FAST_SILENT_THR   = BARGEIN_THRESHOLD * 0.65
const BARGEIN_FAST_SILENT_NEED  = 7

// ─── TTS 防自激参数 ───
// 唤醒词关闭时，AI 自己的播报最容易被麦克风重新识别。默认在 TTS 期间关闭 ASR 上行，
// 只保留本地音量检测；疑似用户插话时先压低 TTS，再短暂打开 ASR 窗口。
const TTS_SELF_ECHO_GUARD_KEY = 'bailongma-tts-self-echo-guard'
const TTS_SELF_ECHO_GUARD_DEFAULT = true

// ─── 声音事件图标映射 ───
const SOUND_EVENT_ICONS = {
  clapping:        '👏',
  finger_snapping: '🤌',
  keyboard_typing: '⌨️',
  typing:          '⌨️',
  writing:         '✍️',
  footsteps:       '👟',
  walking:         '🚶',
  running:         '🏃',
  knock:           '🚪',
  knock_door:      '🚪',
};

const CLOUD_WS_URL  = 'ws://127.0.0.1:3721/voice/cloud';
const LOCAL_WS_URL  = 'ws://127.0.0.1:3723';
const LOCAL_START_URL = 'http://127.0.0.1:3721/voice/local/start';
const VOICE_THRESHOLD_KEY = 'bailongma-voice-threshold';
const VOICE_PROVIDER_KEY = 'bailongma-voice-provider';
const VOICE_WHISPER_MODEL_KEY = 'bailongma-voice-whisper-model'; // 兼容旧版本
const VOICE_LOCAL_ASR_MODEL_KEY = 'bailongma-voice-local-asr-model';
const VOICE_WAKE_ENABLED_KEY = 'bailongma-voice-wake-enabled';
const VOICE_WAKE_WORDS_KEY = 'bailongma-voice-wake-words';
const VOICE_VIDEO_DUCK_KEY = 'bailongma-voice-video-duck';
const VOICE_VIDEO_AEC_KEY = 'bailongma-voice-video-aec';

// 从 localStorage 读取灵敏度阈值，支持运行时动态修改
function getVoiceThreshold() {
  return parseFloat(localStorage.getItem(VOICE_THRESHOLD_KEY) || '0.008');
}

// 派生阈值（ambient = near/2.67，和原始比例保持一致）
function getAmbientThreshold() { return getVoiceThreshold() * 0.375; }
function getBargeinThreshold() { return Math.max(0.045, getVoiceThreshold() * 7); }

export function initVoicePanel({
  btnId, panelId, canvasId, statusId, transcriptId,
  getChatInput, getSendBtn, getSendMessage, getLang, getAutoSend, getAutoMic,
}) {
  const btn        = document.getElementById(btnId);
  const panel      = document.getElementById(panelId);
  const canvas     = document.getElementById(canvasId);
  const transcript = document.getElementById(transcriptId);

  if (!panel || !canvas) return;

  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, cx = 0, cy = 0, scale = 0;

  function resizeCanvasToDisplay() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const nextW = Math.max(1, Math.round(rect.width * dpr));
    const nextH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    W = nextW; H = nextH; cx = W / 2; cy = H / 2;
    scale = Math.min(W, H) * 0.34;
  }

  // ─── 渲染状态 ───
  let sk = 'idle';
  let animState = {
    amp: STATE_CFG.idle.amp, spd: STATE_CFG.idle.spd,
    col: [STATE_CFG.idle.r, STATE_CFG.idle.g, STATE_CFG.idle.b],
    t: 0, rotY: 0, rotX: 0.25,
  };
  let rafId = null;
  let eventFlashCount = 0;
  let doneTimer = null;

  function setStatus(newSk) { sk = newSk; }

  function triggerDone() {
    setStatus('done');
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      doneTimer = null;
      if (sk === 'done') setStatus(micActive ? 'listening' : 'idle');
    }, 2000);
  }

  function drawFrame() {
    resizeCanvasToDisplay();
    const cfg = STATE_CFG[sk];
    const s = animState;
    const ls = 0.025;

    s.amp = lerp(s.amp, cfg.amp, ls * 8);
    s.spd = lerp(s.spd, cfg.spd, ls * 6);
    s.col = [
      lerpArr(s.col[0], cfg.r, ls * 1.5),
      lerpArr(s.col[1], cfg.g, ls * 1.5),
      lerpArr(s.col[2], cfg.b, ls * 1.5),
    ];

    if (micData) {
      micData.analyser.getByteFrequencyData(micData.dataArray);
      const sum = micData.dataArray.reduce((a, b) => a + b, 0);
      const vol = (sum / micData.dataArray.length) / 255;

      // 视频播放中：检测到近场人声时通知媒体层先降音量/暂停，让唤醒词有机会听清。
      if (mediaModeActive && localStorage.getItem(VOICE_VIDEO_DUCK_KEY) !== 'false' && vol > BARGEIN_THRESHOLD) {
        const now = Date.now();
        if (now - lastMediaVoiceActivityAt > 900) {
          lastMediaVoiceActivityAt = now;
          window.dispatchEvent(new CustomEvent('bailongma:voice-activity', { detail: { volume: vol } }));
        }
      }

      // 打断检测：TTS 播放中持续检测用户声音（两阶段：duck → 判断语音/噪音）
      if (suspendedByMedia) {
        const aecReady = Date.now() - ttsStartTime > BARGEIN_WARMUP_MS;
        if (aecReady) {
          if (!duckActive) {
            // 阶段一：等待触发 duck
            if (vol > getBargeinThreshold()) {
              if (++bargeinFrames >= DUCK_TRIGGER_FRAMES) {
                bargeinFrames = 0;
                duckActive = true;
                duckStartTime = Date.now();
                duckHighFrames = 0;
                duckLowFrames = 0;
                // 先给用户声音让路：检测到疑似插话就立刻大幅降低 TTS。
                window.duckTTS?.({ strong: true });
              }
            } else {
              bargeinFrames = 0;
            }
          } else {
            // 阶段二：duck 中判断是语音还是冲击噪音
            const duckElapsed = Date.now() - duckStartTime;
            if (vol > getBargeinThreshold()) {
              duckHighFrames++;
              duckLowFrames = 0;
              if (duckHighFrames >= DUCK_SUSTAIN_FRAMES) {
                // 声音持续高振幅 → 用户插话概率高。先停 TTS，让 ASR 捕获完整指令。
                duckActive = false;
                duckHighFrames = 0;
                console.warn('[Voice] barge-in fast stop, opening ASR window', { vol, threshold: getBargeinThreshold(), duckElapsed });
                abortSpeaking('user_speech');
                // ASR 已保持在线，这里不重连，只保留误触发恢复窗口。
                startBargeinNoSpeechTimer();
                bargeinFastCheckActive = true;
                bargeinFastCheckStart = Date.now();
                bargeinFastSilentFrames = 0;
              }
            } else {
              duckLowFrames++;
              duckHighFrames = 0;
              if (duckLowFrames >= DUCK_DECAY_FRAMES || duckElapsed >= DUCK_MAX_MS) {
                // 声音迅速消退 → 冲击噪音 → 恢复原音量，TTS 不中断
                duckActive = false;
                duckLowFrames = 0;
                window.unduckTTS?.();
              }
            }
          }
        }
      }

      // 快速非语音检测（仅在真正打断后作为兜底：防止极短语音触发打断后继续重播）
      if (bargeinFastCheckActive) {
        const elapsed = Date.now() - bargeinFastCheckStart;
        if (vol < BARGEIN_FAST_SILENT_THR) {
          if (++bargeinFastSilentFrames >= BARGEIN_FAST_SILENT_NEED) {
            bargeinFastCheckActive = false;
            bargeinFastSilentFrames = 0;
            clearBargeinNoSpeechTimer();
            window.resumeTTSIfNoSpeech?.();
          }
        } else {
          bargeinFastSilentFrames = 0;
        }
        if (elapsed >= BARGEIN_FAST_WINDOW_MS) {
          bargeinFastCheckActive = false;
          bargeinFastSilentFrames = 0;
        }
      }

      if (vol > 0.02) {
        s.amp = lerp(s.amp, 0.08 + vol * 1.2, 0.4);
        s.spd = lerp(s.spd, 1.0 + vol * 5.0, 0.2);
        // speaking 状态下用户开口 → 视觉反馈但不覆盖状态（等 barge-in 触发后自然切换）
        if (sk !== 'recognizing' && sk !== 'event' && sk !== 'speaking')
          setStatus(vol > 0.15 ? 'recognizing' : 'listening');
        else if (sk === 'speaking' && vol > BARGEIN_THRESHOLD)
          setStatus('recognizing');
      } else if (sk !== 'idle' && sk !== 'event' && sk !== 'processing' && sk !== 'done' && sk !== 'speaking') {
        setStatus('idle');
      }
    }

    // 声音事件闪烁效果自动恢复
    if (sk === 'event') {
      eventFlashCount--;
      if (eventFlashCount <= 0) setStatus(micActive ? 'listening' : 'idle');
    }

    s.t    += 0.016 * s.spd;
    s.rotY += 0.008;
    s.rotX  = 0.22 + Math.sin(s.t * 0.15) * 0.06;

    ctx.clearRect(0, 0, W, H);

    const cY = Math.cos(s.rotY), sY = Math.sin(s.rotY);
    const cX = Math.cos(s.rotX), sX = Math.sin(s.rotX);

    const project = (orig) => {
      const d = 1.0 + sn(orig.x, orig.y, orig.z, s.t) * s.amp;
      const px = orig.x * d, py = orig.y * d, pz = orig.z * d;
      const rx  =  px * cY + pz * sY;
      const ry0 = py;
      const rz  = -px * sY + pz * cY;
      const ry  = ry0 * cX - rz * sX;
      const rz2 = ry0 * sX + rz * cX;
      return { sx: cx + rx * scale, sy: cy - ry * scale, z: rz2 };
    };

    const allPts = [
      ...BASE_PTS.map(p  => ({ ...project(p), inner: false })),
      ...BASE_PTS2.map(p => ({ ...project(p), inner: true  })),
    ];
    allPts.sort((a, b) => a.z - b.z);

    for (const pt of allPts) {
      const depth = (pt.z + 1.5) / 3.0;
      const r = Math.round(lerp(s.col[0][0], s.col[0][2], depth));
      const g = Math.round(lerp(s.col[1][0], s.col[1][2], depth));
      const b = Math.round(lerp(s.col[2][0], s.col[2][2], depth));
      const alpha = 0.25 + depth * 0.75;
      const dotR = pt.inner ? (0.4 + depth * 0.5) : (0.6 + depth * 0.8 + s.amp * 2);
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(drawFrame);
  }

  // ─── 麦克风捕获（共用于两种模式） ───
  let micData = null;
  let micActive = false;
  let userWantedMic = false;
  let suspendedByMedia = false;
  let mediaModeActive = false;
  let mediaStartedMic = false;
  let lastMediaVoiceActivityAt = 0;
  let ttsStartTime = 0;
  let ttsSpeakingActive = false;
  let bargeinFrames = 0;
  let nearFieldGate = {
    noiseFloor: getAmbientThreshold(),
    nearChunks: 0,
    tailChunks: 0,
    ambientChunks: 0,
  };
  // Cloud 专用
  let cloudAudioCtx = null;
  let cloudProcessor = null;
  let cloudWs = null;
  // 打断预缓冲：TTS 期间把 PCM 写入环形缓冲，打断后一并发给 ASR
  let bargeinBuffer = []  // Int16Array 块的环形队列
  let bargeinBuffering = false // true = 正在 TTS，写缓冲而非发 WS
  // 噪音误触发恢复：barge-in 后若 ASR 一直无输出则重新播放 TTS
  let bargeinNoSpeechTimer = null
  const BARGEIN_NO_SPEECH_MS = 3500 // 3.5s 内没有识别到语音 → 视为误触发
  // Duck 状态（两阶段检测：先降音量，再判断是语音还是噪音）
  let duckActive = false
  let duckHighFrames = 0    // duck 中持续高振幅帧数（→判语音→打断）
  let duckLowFrames = 0     // duck 中持续低振幅帧数（→判噪音→恢复）
  let duckStartTime = 0
  // 快速非语音检测状态（真正打断后仍保留作为兜底）
  let bargeinFastCheckActive = false
  let bargeinFastCheckStart = 0
  let bargeinFastSilentFrames = 0
  // 自动发送防抖
  let lastTranscriptText = '';
  let autoSendTimer = null;
  let lastFinalTranscript = '';
  // PTT 按住期间禁用自动发送（由 pttEnd 在松手时统一发送）
  let pttHolding = false;
  // 多句累积：Paraformer 按句回调，需拼接完整段落
  let accumulatedText = '';
  let wakeActiveUntil = 0;

  const voiceSession = {
    activeTurnId: '',
    state: 'idle',
    updatedAt: 0,
  };

  function makeVoiceTurnId(prefix = 'voice') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function setVoiceSessionState(state, detail = {}) {
    voiceSession.state = state || voiceSession.state || 'idle';
    voiceSession.updatedAt = Date.now();
    window.dispatchEvent(new CustomEvent('bailongma:voice-session-state', {
      detail: { turnId: voiceSession.activeTurnId || null, state: voiceSession.state, ...detail },
    }));
  }

  function beginVoiceTurn(reason = 'speech') {
    if (voiceSession.activeTurnId) abortSpeaking('new_turn');
    voiceSession.activeTurnId = makeVoiceTurnId(reason);
    setVoiceSessionState('listening', { reason });
    return voiceSession.activeTurnId;
  }

  function ensureVoiceTurn(reason = 'speech') {
    return voiceSession.activeTurnId || beginVoiceTurn(reason);
  }

  function isCurrentVoiceTurn(turnId) {
    return !!turnId && !!voiceSession.activeTurnId && turnId === voiceSession.activeTurnId;
  }

  function isTtsSelfEchoGuardEnabled() {
    return localStorage.getItem(TTS_SELF_ECHO_GUARD_KEY) !== 'false' && TTS_SELF_ECHO_GUARD_DEFAULT;
  }

  function abortSpeaking(reason = 'user_speech') {
    setVoiceSessionState('interrupted', { reason });
    ttsSpeakingActive = false;
    bargeinBuffering = false;
    window.stopTTS?.({ reason, voiceTurnId: voiceSession.activeTurnId || null });
  }

  async function startMic() {
    try {
      const useAec = localStorage.getItem(VOICE_VIDEO_AEC_KEY) !== 'false';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: useAec,
          noiseSuppression: true,
          // 云端 ASR 对输入音量更敏感，开启系统自动增益，避免 Mac 麦克风采集过低导致火山/豆包一直返回空文本。
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
      micData = { analyser, dataArray, stream, actx, src };
      nearFieldGate = { noiseFloor: getAmbientThreshold(), nearChunks: 0, tailChunks: 0, ambientChunks: 0 };
      return stream;
    } catch (e) {
      // 权限拒绝时球体变红，不在 transcript 显示文字
      setStatus('error');
      return null;
    }
  }

  function stopMic() {
    micData?.stream.getTracks().forEach(t => t.stop());
    micData = null;
  }

  // ─── 语音识别结果发送 ───
  function resetRecognitionText({ clearInput = false, endTurn = false } = {}) {
    lastTranscriptText = '';
    accumulatedText = '';
    lastFinalTranscript = '';
    if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
    if (transcript) transcript.textContent = '';
    if (clearInput) {
      const input = getChatInput?.();
      if (input) input.value = '';
    }
    if (endTurn) {
      voiceSession.activeTurnId = '';
      setVoiceSessionState(micActive ? 'listening' : 'idle', { reason: 'reset' });
    }
  }

  function sendRecognizedVoiceText() {
    const textToSend = String(lastTranscriptText || '').trim();
    if (!textToSend) return;
    if (looksLikeAsrHallucination(textToSend)) {
      resetRecognitionText({ clearInput: true });
      setStatus('listening');
      return;
    }
    const turnId = ensureVoiceTurn('send');
    const input = getChatInput?.();
    if (input) input.value = textToSend;
    resetRecognitionText({ clearInput: false });
    setVoiceSessionState('thinking', { reason: 'sent', text: textToSend });
    getSendMessage?.({ channel: 'voice', label: 'You · 语音识别', voiceTurnId: turnId });
  }

  function getWakeConfig() {
    const enabled = localStorage.getItem(VOICE_WAKE_ENABLED_KEY) !== 'false';
    const words = (localStorage.getItem(VOICE_WAKE_WORDS_KEY) || '贾维斯，Jarvis，小龙马，龙马，白龙马')
      .split(/[,，、\s]+/)
      .map(w => w.trim())
      .filter(Boolean);
    return { enabled, words: words.length ? words : ['贾维斯', 'Jarvis', '小龙马', '龙马', '白龙马'] };
  }

  function normalizeWakeText(text = '') {
    return String(text || '').replace(/[\s,，、。.！!？?：:；;"“”'‘’]/g, '').toLowerCase();
  }

  function applyWakeWordGate(text = '') {
    const raw = String(text || '').trim();
    const cfg = getWakeConfig();
    if (!cfg.enabled) return { accepted: true, text: raw, wokeOnly: false };

    const now = Date.now();
    if (wakeActiveUntil > now) return { accepted: true, text: raw, wokeOnly: false };

    const normalized = normalizeWakeText(raw);
    for (const word of cfg.words) {
      const nw = normalizeWakeText(word);
      if (!nw) continue;
      const idx = normalized.indexOf(nw);
      if (idx < 0) continue;

      // 从原文里按未归一化唤醒词尽量切掉前缀；切不准时再做宽松替换。
      let remainder = raw;
      const directIdx = raw.indexOf(word);
      if (directIdx >= 0) remainder = raw.slice(directIdx + word.length);
      else remainder = raw.replace(new RegExp(word.split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,，、。.！!？?：:；;]*'), 'i'), '');
      remainder = remainder.replace(/^[\s,，、。.！!？?：:；;]+/, '').trim();
      wakeActiveUntil = Date.now() + 8000;
      if (!remainder) return { accepted: false, text: '', wokeOnly: true };
      return { accepted: true, text: remainder, wokeOnly: false };
    }
    return { accepted: false, text: '', wokeOnly: false };
  }

  function looksLikeAsrHallucination(text = '') {
    const t = String(text || '').trim();
    if (!t) return true;
    if (/(我不想说了|我只想说了|我想说了).*(我不想说了|我只想说了|我想说了)/.test(t)) return true;
    if (/(嗨|嘿|喂)[,，。\s]*(三毛|三猫)/.test(t)) return true;
    const segs = t.split(/[,，、。.！!？?\s]+/).map(s => s.trim()).filter(Boolean);
    if (segs.length >= 4 && new Set(segs).size <= 2) return true;
    if (segs.length >= 6) {
      const counts = new Map();
      for (const s of segs) counts.set(s, (counts.get(s) || 0) + 1);
      if (Math.max(...counts.values()) / segs.length >= 0.45) return true;
    }
    return false;
  }

  // 防抖自动发送：收到任意转录文字就重置 2s 计时器，停说 2s 后自动发
  function scheduleAutoSend() {
    if (pttHolding) return;
    if (autoSendTimer) clearTimeout(autoSendTimer);
    autoSendTimer = setTimeout(() => {
      autoSendTimer = null;
      setStatus('processing');
      sendRecognizedVoiceText();
    }, 2000);
  }

  // ─── ASR 模式：本地 SenseVoice/Whisper 或云端代理 ───
  let cloudWsIntentional = false; // stopCloudStream 主动关闭时置 true，避免触发重连

  function getAsrProvider() {
    const provider = localStorage.getItem(VOICE_PROVIDER_KEY) || 'local';
    return ['local', 'aliyun', 'tencent', 'xunfei', 'volcengine'].includes(provider) ? provider : 'local';
  }

  async function ensureLocalAsrServer() {
    const model = localStorage.getItem(VOICE_LOCAL_ASR_MODEL_KEY) || 'sensevoice-small';
    const resp = await fetch(LOCAL_START_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, localAsrModel: model }),
    });
    if (!resp.ok) throw new Error(`本地语音识别启动失败: HTTP ${resp.status}`);
    const data = await resp.json().catch(() => ({}));
    if (data.ok === false) throw new Error(data.error || '本地语音识别启动失败');
    return data;
  }

  async function createRecognitionWs() {
    const provider = getAsrProvider();
    if (provider === 'local') {
      setStatus('recognizing');
      if (transcript) transcript.textContent = '正在启动本地语音模型…';
      await ensureLocalAsrServer();
      return { ws: new WebSocket(LOCAL_WS_URL), provider };
    }
    setStatus('recognizing');
    if (transcript) transcript.textContent = `正在连接${provider === 'volcengine' ? '火山引擎/豆包' : provider}语音识别…`;
    return { ws: new WebSocket(CLOUD_WS_URL), provider };
  }

  function sendRecognitionConfig(ws, provider) {
    const lang = getLang?.()?.split('-')[0] || 'zh';
    const payload = provider === 'local'
      ? {
          type: 'config',
          lang,
        }
      : { type: 'config', provider, lang };
    ws.send(JSON.stringify(payload));
  }

  function handleRecognitionMessage(ev, ws, turnId = voiceSession.activeTurnId) {
    if (cloudWs !== ws) return;
    if (!isCurrentVoiceTurn(turnId)) return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'config_ok') {
        setStatus('listening');
        if (transcript && /^正在(启动本地语音模型|连接.+语音识别)/.test(transcript.textContent || '')) transcript.textContent = '';
        return;
      }
      if (msg.type === 'transcript') {
        ensureVoiceTurn('transcript');
        setVoiceSessionState(msg.is_final ? 'recognizing' : 'listening', { source: 'asr' });
        const text = (msg.text || '').trim();
        if (!text) return;
        if (looksLikeAsrHallucination(text)) return;
        if (msg.is_final) {
          if (text === lastFinalTranscript) return;
          const gated = applyWakeWordGate(text);
          if (!gated.accepted) {
            if (gated.wokeOnly) {
              if (transcript) transcript.textContent = '已唤醒，请继续说指令…';
              setStatus('listening');
            }
            return;
          }
          const acceptedText = gated.text;
          if (!acceptedText || looksLikeAsrHallucination(acceptedText)) return;
          if (ttsSpeakingActive) {
            console.warn('[Voice] wake/input recognized during TTS, aborting speech', { acceptedText });
            abortSpeaking('voice_input_during_tts');
          }
          lastFinalTranscript = acceptedText;
          accumulatedText = accumulatedText ? accumulatedText + '，' + acceptedText : acceptedText;
          lastTranscriptText = accumulatedText;
          if (transcript) transcript.textContent = accumulatedText;
          const input = getChatInput?.();
          if (input) input.value = accumulatedText;
          window.dispatchEvent(new CustomEvent('bailongma:assistant-wake', { detail: { text: acceptedText } }));
          triggerDone();
        } else {
          lastTranscriptText = accumulatedText ? accumulatedText + '，' + text : text;
          if (transcript) transcript.textContent = lastTranscriptText;
        }
        scheduleAutoSend();
      } else if (msg.type === 'speaker_rejected') {
        setStatus('listening');
        return;
      } else if (msg.type === 'sound_event') {
        // 本地语音服务可选返回环境声音事件。这里保持静默，不干扰转写文本。
      } else if (msg.type === 'error') {
        setStatus('error');
        if (transcript) transcript.textContent = msg.message || '语音识别错误';
      }
    } catch {}
  }

  async function connectCloudWs(turnId = voiceSession.activeTurnId) {
    cloudWsIntentional = false; // 新连接建立时清除上一次主动关闭的标记
    let ws, provider;
    try {
      ({ ws, provider } = await createRecognitionWs());
    } catch (err) {
      setStatus('error');
      if (transcript) transcript.textContent = err?.message || '本地语音识别启动失败';
      return;
    }
    ws.binaryType = 'arraybuffer';
    cloudWs = ws;

    ws.onopen = () => {
      if (cloudWs !== ws) return;
      sendRecognitionConfig(ws, provider);
      setStatus('listening');
      if (transcript && /^正在(启动本地语音模型|连接.+语音识别)/.test(transcript.textContent || '')) transcript.textContent = '';
      // 如果本地服务已连接但 config_ok 因旧连接/竞态未回来，也不要让界面一直卡在启动文案。
      setTimeout(() => {
        if (cloudWs === ws && micActive && transcript && /^正在(启动本地语音模型|连接.+语音识别)/.test(transcript.textContent || '')) {
          transcript.textContent = '';
          setStatus('listening');
        }
      }, 900);
      // 注意：此处不重置 accumulatedText，由调用方在首次启动时负责清空
    };

    ws.onmessage = (ev) => handleRecognitionMessage(ev, ws, turnId);

    ws.onerror = () => { if (cloudWs === ws) setStatus('error'); };

    ws.onclose = () => {
      if (cloudWs !== ws) return; // 已被新连接取代，忽略旧连接的 close 事件
      cloudWs = null;
      if (!cloudWsIntentional && micActive) {
        // 非主动断开（超时/网络抖动）且用户仍在录音 → 自动重连，保留已识别文字
        setTimeout(() => { if (micActive) connectCloudWs(turnId); }, 800);
      } else {
        cloudWsIntentional = false;
        if (micActive) setStatus('idle');
      }
    };
  }

  function startCloudStream(stream, preferredTurnId = null) {
    const targetSR = 16000;
    if (micData?.actx?.sampleRate !== targetSR) {
      cloudAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: targetSR });
      const src = cloudAudioCtx.createMediaStreamSource(stream);
      setupCloudProcessor(src, cloudAudioCtx);
    } else {
      setupCloudProcessor(micData.src, micData.actx);
    }

    // 首次启动清空累积文字；重连时由 connectCloudWs 直接调用，不经过此处
    resetRecognitionText({ clearInput: true });
    const turnId = preferredTurnId || beginVoiceTurn('mic_start');
    if (preferredTurnId) setVoiceSessionState('listening', { reason: 'mic_start' });
    connectCloudWs(turnId);
  }

  function setupCloudProcessor(srcNode, audioCtx) {
    const bufferSize = 4096;
    cloudProcessor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    srcNode.connect(cloudProcessor);
    cloudProcessor.connect(audioCtx.destination);

    cloudProcessor.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      const provider = getAsrProvider();
      // 火山/豆包对近场音量要求更明显。Mac 默认输入有时非常低，导致服务端持续返回空 result.text。
      // 仅对云端 ASR 做温和软件增益，本地模型保持原始音量，避免改变本地 VAD 行为。
      const inputGain = provider === 'volcengine' ? 6 : 1;
      for (let i = 0; i < f32.length; i++) {
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768 * inputGain));
      }
      if (bargeinBuffering) {
        // TTS 播报期间防自激：默认不把麦克风音频送给 ASR，避免 AI 自己说的话被识别成用户输入。
        // 仍保留近端音频环形缓冲；只有检测到用户插话并停止 TTS 后，才短暂打开 ASR 窗口。
        bargeinBuffer.push(i16);
        if (bargeinBuffer.length > BARGEIN_MAX_CHUNKS) bargeinBuffer.shift();
        if (isTtsSelfEchoGuardEnabled()) return;
      }
      if (!cloudWs || cloudWs.readyState !== WebSocket.OPEN) return;
      cloudWs.send(i16.buffer);
    };
  }

  function stopCloudStream({ preserveProcessor = false } = {}) {
    cloudWsIntentional = true; // 标记为主动关闭，防止 onclose 触发重连
    try {
      if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(JSON.stringify({ type: 'flush' }));
        setTimeout(() => { try { cloudWs?.close(); } catch {} }, 200);
      } else {
        cloudWs?.close();
      }
    } catch {}
    cloudWs = null;

    if (!preserveProcessor) {
      try { cloudProcessor?.disconnect(); } catch {}
      cloudProcessor = null;
      try { if (cloudAudioCtx) { cloudAudioCtx.close(); cloudAudioCtx = null; } } catch {}
    }
  }

  // ─── 统一开关 ───
  async function toggleVoice(preferredTurnId = null) {
    if (!micActive) {
      micActive = true;
      userWantedMic = true;
      suspendedByMedia = false;
      btn?.classList.add('active');
      const stream = await startMic();
      if (!stream) { micActive = false; userWantedMic = false; btn?.classList.remove('active'); return; }
      startCloudStream(stream, preferredTurnId);
    } else {
      stopVoiceInput();
    }
  }

  function stopVoiceInput({ keepIntent = false, reason = '', endTurn = true } = {}) {
    pttHolding = false;
    if (doneTimer) { clearTimeout(doneTimer); doneTimer = null; }
    if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
    clearBargeinNoSpeechTimer();
    bargeinFastCheckActive = false;
    bargeinFastSilentFrames = 0;
    duckActive = false;
    duckHighFrames = 0;
    duckLowFrames = 0;
    resetRecognitionText({ clearInput: true, endTurn });
    micActive = false;
    if (!keepIntent) userWantedMic = false;
    btn?.classList.toggle('active', Boolean(keepIntent && userWantedMic));
    bargeinBuffer = [];
    bargeinBuffering = false;
    stopCloudStream();
    stopMic();
    setStatus('idle');
    if (transcript) transcript.textContent = '';
  }

  function clearBargeinNoSpeechTimer() {
    if (bargeinNoSpeechTimer) {
      clearTimeout(bargeinNoSpeechTimer);
      bargeinNoSpeechTimer = null;
    }
  }

  // 启动误触发恢复计时：若 N 毫秒内没有真实语音输入，则续播 TTS
  function startBargeinNoSpeechTimer() {
    clearBargeinNoSpeechTimer();
    bargeinNoSpeechTimer = setTimeout(() => {
      bargeinNoSpeechTimer = null;
      // 没有收到任何语音 → 噪音误触发，让 agent 继续说
      window.resumeTTSIfNoSpeech?.();
    }, BARGEIN_NO_SPEECH_MS);
  }

  async function resumeVoiceInputFromMedia(fromBargein = false, preferredTurnId = null) {
    if (!suspendedByMedia || !userWantedMic) return;
    suspendedByMedia = false;
    bargeinFrames = 0;

    // 拿走缓冲区快照并立刻停止写入，避免 WS 重连期间继续堆积
    const bufferedChunks = bargeinBuffer.slice();
    bargeinBuffer = [];
    bargeinBuffering = false;

    if (micActive && micData && cloudProcessor) {
      // TTS 模式：ScriptProcessor 仍存活，只需重连 WebSocket
      setStatus('listening');

      // barge-in 触发的恢复：等待真实语音，超时则续播
      if (fromBargein) startBargeinNoSpeechTimer();

      resetRecognitionText({ clearInput: true });
      const resumeTurnId = preferredTurnId || beginVoiceTurn(fromBargein ? 'bargein' : 'resume');
      if (resumeTurnId && voiceSession.activeTurnId !== resumeTurnId) voiceSession.activeTurnId = resumeTurnId;
      let bargeinWs, bargeinProvider;
      try {
        ({ ws: bargeinWs, provider: bargeinProvider } = await createRecognitionWs());
      } catch (err) {
        setStatus('error');
        if (transcript) transcript.textContent = err?.message || '语音识别启动失败';
        return;
      }
      bargeinWs.binaryType = 'arraybuffer';
      cloudWs = bargeinWs;
      bargeinWs.onopen = () => {
        if (cloudWs !== bargeinWs) return;
        sendRecognitionConfig(bargeinWs, bargeinProvider);
        // 先把预缓冲的历史音频一次性发出，补回打断前说的内容
        for (const chunk of bufferedChunks) {
          if (bargeinWs.readyState === WebSocket.OPEN) bargeinWs.send(chunk.buffer);
        }
      };
      bargeinWs.onmessage = (ev) => {
        // 收到真实语音 → 取消所有误触发恢复机制
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'transcript' && (msg.text || '').trim()) {
            bargeinFastCheckActive = false;
            bargeinFastSilentFrames = 0;
            clearBargeinNoSpeechTimer();
          }
        } catch {}
        handleRecognitionMessage(ev, bargeinWs, resumeTurnId);
      };
      bargeinWs.onerror = () => { if (cloudWs === bargeinWs) setStatus('error'); };
      bargeinWs.onclose = () => {
        if (cloudWs !== bargeinWs) return;
        cloudWs = null;
        if (!cloudWsIntentional && micActive) {
          setTimeout(() => { if (micActive) connectCloudWs(turnId); }, 800);
        } else {
          cloudWsIntentional = false;
          if (micActive) setStatus('idle');
        }
      };
    } else {
      // 视频/音乐模式，或 Processor 已被销毁：完整重启
      if (fromBargein) startBargeinNoSpeechTimer();
      micActive = true;
      btn?.classList.add('active');
      const stream = await startMic();
      if (!stream) {
        micActive = false;
        userWantedMic = false;
        btn?.classList.remove('active');
        return;
      }
      startCloudStream(stream);
    }
  }

  // PTT（按住空格说话）：press → 开 mic / 从 TTS 恢复，release → 立即发送
  let pttStartedMic = false;

  async function pttStart() {
    // 让 release 时不会发出旧的累积识别结果
    pttHolding = true;
    resetRecognitionText({ clearInput: true });
    beginVoiceTurn('ptt');

    if (suspendedByMedia) {
      // mic 硬件仍在，只是 ASR WS 被 TTS 暂停 → 重连即可，不算 PTT 开的 mic
      pttStartedMic = false;
      await resumeVoiceInputFromMedia(false, voiceSession.activeTurnId);
      return;
    }
    if (micActive) {
      // 已经在听 → 不改状态，但 release 时仍要"立即发送"
      pttStartedMic = false;
      return;
    }
    pttStartedMic = true;
    await toggleVoice(voiceSession.activeTurnId);
  }

  function pttEnd() {
    pttHolding = false;
    const startedMic = pttStartedMic;
    pttStartedMic = false;
    if (!micActive) return;

    // 通知云端 ASR 立刻给最终结果
    try {
      if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(JSON.stringify({ type: 'flush' }));
      }
    } catch {}

    const finalize = () => {
      if (lastTranscriptText) {
        if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
        setStatus('processing');
        sendRecognizedVoiceText();
        if (startedMic) setTimeout(() => stopVoiceInput(), 120);
      } else if (startedMic) {
        stopVoiceInput();
      }
    };

    // 给云端 800ms 把最终结果吐出来
    let waited = 0;
    const tick = () => {
      if (lastTranscriptText) { finalize(); return; }
      if (waited >= 800) { finalize(); return; }
      waited += 100;
      setTimeout(tick, 100);
    };
    tick();
  }

  function shouldKeepMicDuringMedia() {
    return localStorage.getItem(VOICE_VIDEO_DUCK_KEY) !== 'false'
      || localStorage.getItem(VOICE_VIDEO_AEC_KEY) !== 'false';
  }

  async function handleMediaModeActive() {
    mediaModeActive = true;
    if (shouldKeepMicDuringMedia()) {
      suspendedByMedia = false;
      if (!micActive) {
        mediaStartedMic = true;
        userWantedMic = true;
        await toggleVoice();
      }
      return;
    }
    window.bailongmaVoice.suspendForMedia();
  }

  function handleMediaModeInactive() {
    mediaModeActive = false;
    if (mediaStartedMic) {
      mediaStartedMic = false;
      stopVoiceInput({ keepIntent: false, reason: '视频结束，关闭自动监听' });
      return;
    }
    window.bailongmaVoice.resumeAfterMedia();
  }

  window.bailongmaVoice = {
    isActive: () => micActive,
    // 视频/音乐模式：完全停止 mic（不需要打断能力）
    suspendForMedia: () => {
      if (!micActive) return;
      suspendedByMedia = true;
      stopVoiceInput({ keepIntent: true, reason: '视频模式中，语音已暂停', endTurn: false });
    },
    // TTS 模式：保持麦克风硬件和本地音量检测，但默认阻断 ASR 上行，防止 AI 播报被自己识别。
    // 如检测到用户插话，会先停止/压低 TTS，再打开 ASR 窗口捕获用户指令。
    suspendForTTS: (turnId = null) => {
      if (turnId && voiceSession.activeTurnId && turnId !== voiceSession.activeTurnId) return;
      if (turnId && !voiceSession.activeTurnId) voiceSession.activeTurnId = turnId;
      if (!micActive) return;
      suspendedByMedia = true;
      ttsStartTime = Date.now();
      bargeinFrames = 0;
      duckActive = false;
      duckHighFrames = 0;
      duckLowFrames = 0;
      bargeinBuffer = [];
      bargeinBuffering = true;
      ttsSpeakingActive = true;
      if (isTtsSelfEchoGuardEnabled()) {
        // 直接关掉 ASR WebSocket，避免服务端收到 TTS 回放造成转写/自循环。
        // preserveProcessor=true：不释放麦克风处理器，仍可做本地打断检测。
        stopCloudStream({ preserveProcessor: true });
      }
      setStatus('speaking');
    },
    resumeAfterMedia: () => {
      clearBargeinNoSpeechTimer(); // TTS 正常结束，不需要续播
      ttsSpeakingActive = false;
      bargeinBuffering = false;
      if (suspendedByMedia) resumeVoiceInputFromMedia(false);
      else if (micActive) setStatus('listening');
    },
    abortSpeaking,
    syncTurn: (turnId, state = 'event') => {
      if (turnId && voiceSession.activeTurnId && turnId !== voiceSession.activeTurnId) return false;
      if (turnId && !voiceSession.activeTurnId) voiceSession.activeTurnId = turnId;
      setVoiceSessionState(state, { source: 'runtime' });
      return true;
    },
    getTurnId: () => voiceSession.activeTurnId || null,
    isCurrentTurn: (turnId) => isCurrentVoiceTurn(turnId),
    stop: () => stopVoiceInput(),
    pttStart,
    pttEnd,
  };

  window.addEventListener('bailongma:video-mode', (event) => {
    if (event.detail?.active) {
      handleMediaModeActive();
    } else {
      handleMediaModeInactive();
    }
  });

  window.addEventListener('bailongma:music-mode', (event) => {
    if (event.detail?.active) {
      handleMediaModeActive();
    } else {
      handleMediaModeInactive();
    }
  });

  // 阈值实时更新（设置面板保存后立即生效，无需重启语音）
  window.addEventListener('bailongma:voice-threshold', (event) => {
    const t = Number(event.detail?.threshold);
    if (!isNaN(t) && t > 0) {
      nearFieldGate.noiseFloor = t * 0.375;
    }
  });

  // ─── 面板初始化 ───
  function openPanel() {
    panel.hidden = false;
    if (!rafId) drawFrame();
  }

  btn?.addEventListener('click', toggleVoice);
  canvas.addEventListener('click', toggleVoice);

  setStatus('idle');
  openPanel();
  if (getAutoMic?.()) toggleVoice();
}
