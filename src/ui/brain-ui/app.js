import { renderBrainUiApp } from "./app-shell.js";
import { API } from "./api-client.js";
import { bootstrapACUI } from "./acui/bootstrap.js";
import { initChat, friendlyChannelLabel } from "./chat.js";
import { initPanelCollapse } from "./panel-collapse.js";
import { ThoughtStream } from "./thought-stream.js";
import { initVoicePanel } from "./voice-panel.js";
import { initHotspot, toggleHotspot, setHotspotMode, moveVoicePanelToBody, restoreVoicePanel } from "./hotspot.js";
import { enrichVisiblePersonCardFromText, initPersonCard, setPersonCardMode, showPersonCardByName } from "./person-card.js";
import { initDocPanel, setDocPanelMode } from "./doc.js";
import { initWechatPopup, showWechatPopup } from "./wechat-popup.js";
renderBrainUiApp(document.body);
const THEME_KEY = "jarvis-brain-ui-theme";
const PHYSICS_STORAGE_KEY = "jarvis-brain-ui-physics";
const ACTIVATION_WARMUP_KEY = "bailongma_activation_warmup_until";
const UI_ZOOM_STORAGE_KEY = "bailongma_ui_zoom_factor";
const MAX_CHAT_HISTORY = 60;
const DEFAULT_AGENT_NAME = "小白龙";
const DEFAULT_UI_ZOOM = 1.1;
const MIN_UI_ZOOM = 0.8;
const MAX_UI_ZOOM = 1.8;
const UI_ZOOM_STEP = 0.1;
const UI_ZOOM_WHEEL_STEP = 0.05;
const MEMORY_GRAPH_STORAGE_KEY = "bailongma-memory-graph-enabled";
const MEMORY_GRAPH_ENABLED = localStorage.getItem(MEMORY_GRAPH_STORAGE_KEY) !== "false";

const themeSwitcher = document.getElementById("theme-switcher");
const resetViewBtn = document.getElementById("reset-view-btn");
const physicsControl = document.getElementById("physics-control");
const physicsToggle = document.getElementById("physics-toggle");
const gravitySlider = document.getElementById("gravity-slider");
const repulsionSlider = document.getElementById("repulsion-slider");
const nodeSizeSlider = document.getElementById("node-size-slider");
const gravityValue = document.getElementById("gravity-value");
const repulsionValue = document.getElementById("repulsion-value");
const nodeSizeValue = document.getElementById("node-size-value");
const brandNameEl = document.getElementById("agent-brand-name");
const graphEl = document.getElementById("graph");
const focusBlockEl = document.getElementById("focus-block");
const focusStackEl = document.getElementById("focus-stack");
const focusDepthEl = document.getElementById("focus-depth");

const IGNORED_VERSION_KEY = "bailongma_ignored_update_version";
const SUPPRESS_UPDATES_KEY = "bailongma_suppress_update_notifications";

let agentName = DEFAULT_AGENT_NAME;
let currentUiZoom = DEFAULT_UI_ZOOM;
let chat = null;

function addMsg(...args) { return chat?.addMsg(...args); }
function openChat(...args) { return chat?.openChat(...args); }
function updateLastJarvisMsg(...args) { return chat?.updateLastJarvisMsg(...args); }
function isTyping() { return chat?.isTyping() || false; }

function defaultInputPlaceholder() {
  return `向 ${agentName} 发消息…`;
}

function clampZoomFactor(factor) {
  return Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, Number(factor) || DEFAULT_UI_ZOOM));
}

function saveUiZoom(factor) {
  try {
    localStorage.setItem(UI_ZOOM_STORAGE_KEY, String(factor));
  } catch {}
}

function loadSavedUiZoom() {
  try {
    const raw = Number(localStorage.getItem(UI_ZOOM_STORAGE_KEY));
    if (Number.isFinite(raw)) return clampZoomFactor(raw);
  } catch {}
  return DEFAULT_UI_ZOOM;
}

function applyUiZoom(factor, { persist = true } = {}) {
  const nextZoom = clampZoomFactor(factor);
  currentUiZoom = nextZoom;

  const bridge = window.bailongma;
  if (bridge?.isElectron && typeof bridge.setZoomFactor === "function") {
    bridge.setZoomFactor(nextZoom);
  } else {
    document.documentElement.style.zoom = String(nextZoom);
  }

  if (persist) saveUiZoom(nextZoom);
}

function stepUiZoom(delta) {
  const nextZoom = Math.round((currentUiZoom + delta) * 100) / 100;
  applyUiZoom(nextZoom);
}

function initUiZoom() {
  const bridge = window.bailongma;
  const initialZoom = loadSavedUiZoom();

  if (!bridge?.isElectron) {
    applyUiZoom(initialZoom, { persist: false });
  } else {
    try {
      const bridgeZoom = bridge.getZoomFactor?.();
      if (typeof bridgeZoom === "number" && Number.isFinite(bridgeZoom)) {
        currentUiZoom = clampZoomFactor(bridgeZoom);
      }
    } catch {}
    applyUiZoom(initialZoom, { persist: false });
  }

  window.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    stepUiZoom(event.deltaY < 0 ? UI_ZOOM_WHEEL_STEP : -UI_ZOOM_WHEEL_STEP);
  }, { passive: false, capture: true });

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;

    const key = event.key;
    if (key === "+" || key === "=" || key === "Add") {
      event.preventDefault();
      stepUiZoom(UI_ZOOM_STEP);
      return;
    }

    if (key === "-" || key === "_" || key === "Subtract") {
      event.preventDefault();
      stepUiZoom(-UI_ZOOM_STEP);
      return;
    }

    if (key === "0") {
      event.preventDefault();
      applyUiZoom(DEFAULT_UI_ZOOM);
    }
  });
}

function setAgentName(nextName) {
  const normalized = String(nextName || "").trim() || DEFAULT_AGENT_NAME;
  agentName = normalized;
  document.title = `${normalized} · Cognitive Surface`;
  if (brandNameEl) brandNameEl.textContent = `${normalized} AI Agent`;
  if (graphEl) graphEl.setAttribute("aria-label", `${normalized} memory graph`);
  const input = document.getElementById("msg-input");
  if (input && !chat?.isComposerLocked?.()) input.placeholder = defaultInputPlaceholder();
  document.querySelectorAll(".msg-jarvis .msg-label").forEach((el) => {
    el.textContent = normalized;
  });
}

async function loadAgentProfile() {
  try {
    const res = await fetch(`${API}/agent-profile`);
    if (!res.ok) return;
    const data = await res.json();
    setAgentName(data.name);
  } catch {}
}

const physicsSettings = {
  gravity: 1,
  repulsion: 1.35,
  nodeSize: 1,
};

requestAnimationFrame(() => {
  themeSwitcher.classList.add("visible");
  resetViewBtn.classList.add("visible");
  physicsControl.classList.add("visible");
});

function readCSSVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function readPhysicsSettings() {
  try {
    const raw = localStorage.getItem(PHYSICS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.gravity === "number") physicsSettings.gravity = parsed.gravity;
      if (typeof parsed.repulsion === "number") physicsSettings.repulsion = parsed.repulsion;
      if (typeof parsed.nodeSize === "number") physicsSettings.nodeSize = parsed.nodeSize;
    }
  } catch {}
}

function savePhysicsSettings() {
  try {
    localStorage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify(physicsSettings));
  } catch {}
}

function updatePhysicsReadout() {
  gravitySlider.value = String(physicsSettings.gravity);
  repulsionSlider.value = String(physicsSettings.repulsion);
  nodeSizeSlider.value = String(physicsSettings.nodeSize);
  gravityValue.textContent = `${physicsSettings.gravity.toFixed(2)}x`;
  repulsionValue.textContent = `${physicsSettings.repulsion.toFixed(2)}x`;
  nodeSizeValue.textContent = `${physicsSettings.nodeSize.toFixed(2)}x`;
}

let themeColors = {};
function refreshThemeColors() {
  themeColors = {
    cool: readCSSVar("--cool"),
    warm: readCSSVar("--warm"),
    nodeLow: readCSSVar("--node-low"),
    nodeHigh: readCSSVar("--node-high"),
    dim: readCSSVar("--dim"),
    ink2: readCSSVar("--ink2"),
    linkStroke: readCSSVar("--link-stroke"),
    bg0: readCSSVar("--bg0"),
  };
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  document.querySelectorAll(".theme-dot").forEach(el => {
    el.classList.toggle("active", el.dataset.t === theme);
  });
  setTimeout(() => {
    refreshThemeColors();
    renderLegend();
    if (MEMORY_GRAPH_ENABLED && nodeSel && !nodeSel.empty()) {
      refreshNodeVisuals();
      linkSel.attr("stroke", themeColors.linkStroke);
    }
  }, 20);
}

(function initTheme() {
  let saved = "midnight";
  try { saved = localStorage.getItem(THEME_KEY) || "midnight"; } catch {}
  applyTheme(saved);
})();

themeSwitcher.querySelectorAll(".theme-dot").forEach(el => {
  el.addEventListener("click", () => applyTheme(el.dataset.t));
});

physicsToggle.addEventListener("click", () => {
  const nextOpen = !physicsControl.classList.contains("open");
  physicsControl.classList.toggle("open", nextOpen);
  physicsToggle.setAttribute("aria-expanded", String(nextOpen));
});

gravitySlider.addEventListener("input", () => {
  physicsSettings.gravity = Number(gravitySlider.value);
  applyPhysicsSettings();
});

repulsionSlider.addEventListener("input", () => {
  physicsSettings.repulsion = Number(repulsionSlider.value);
  applyPhysicsSettings();
});

nodeSizeSlider.addEventListener("input", () => {
  physicsSettings.nodeSize = Number(nodeSizeSlider.value);
  applyPhysicsSettings();
});

let W = window.innerWidth;
let H = window.innerHeight;

const svg = d3.select("#graph").attr("width", W).attr("height", H);
const tip = d3.select("#tip");

const defs = svg.append("defs");
defs.html(`
  <filter id="neb-glow" x="-70%" y="-70%" width="240%" height="240%">
    <feGaussianBlur stdDeviation="3.2" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
`);

const world = svg.append("g");
const gLink = world.append("g").attr("stroke-linecap", "round");
const gNode = world.append("g");

const zoom = d3.zoom()
  .scaleExtent([0.1, 5])
  .filter(event => event.type === "wheel")
  .on("zoom", event => world.attr("transform", event.transform));

svg.call(zoom);
svg.on("wheel.zoom", null);
svg.on("dblclick.zoom", null);

svg.node().addEventListener("wheel", event => {
  event.preventDefault();
  const current = d3.zoomTransform(svg.node());
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nextScale = Math.max(0.1, Math.min(5, current.k * factor));
  const k = nextScale / current.k;
  const px = W / 2, py = H / 2;
  const nextX = px - (px - current.x) * k;
  const nextY = py - (py - current.y) * k;
  svg.call(zoom.transform, d3.zoomIdentity.translate(nextX, nextY).scale(nextScale));
}, { passive: false });

function resetZoom() {
  svg.transition().duration(420).call(
    zoom.transform,
    d3.zoomIdentity
  );
}

const glowSet = new Map();
const usePulseSet = new Map();
let linkData = [];
let nodeData = [];
let linkSel = gLink.selectAll("line");
let nodeSel = gNode.selectAll("circle");

const nodeCountEl = document.getElementById("node-count");
const linkCountEl = document.getElementById("link-count");
const connStateEl = document.getElementById("conn-state");

function updateStats() {
  nodeCountEl.textContent = String(nodeData.length);
  linkCountEl.textContent = String(linkData.length);
}

function setConnectionState(text, live = true) {
  connStateEl.innerHTML = live
    ? `<span class="live-dot"></span>${text}`
    : text;
  connStateEl.classList.toggle("live", live);
}

function isGlowing(nid) {
  const expiry = glowSet.get(nid);
  if (!expiry) return false;
  if (Date.now() > expiry) { glowSet.delete(nid); return false; }
  return true;
}

function highlightNodes(nids, duration = 2400) {
  if (!MEMORY_GRAPH_ENABLED || !sim) return;
  if (!nids || !nids.length) return;
  const now = Date.now();
  const expiry = now + duration;
  nids.forEach(nid => {
    const key = String(nid);
    glowSet.set(key, expiry);
    usePulseSet.set(key, { start: now, end: expiry });
  });
  refreshNodeVisuals();
  sim.alpha(Math.max(sim.alpha(), 2)).restart();
  setTimeout(() => {
    nids.forEach(nid => {
      const key = String(nid);
      glowSet.delete(key);
      usePulseSet.delete(key);
    });
    refreshNodeVisuals();
  }, duration + 80);
}

function nodeUseProgress(nid) {
  const key = String(nid);
  const pulse = usePulseSet.get(key);
  if (!pulse) return 0;
  const now = Date.now();
  if (now >= pulse.end) {
    usePulseSet.delete(key);
    return 0;
  }
  const total = Math.max(1, pulse.end - pulse.start);
  return 1 - ((now - pulse.start) / total);
}

function nodeStrength(d) {
  if (typeof d._strength !== "number") {
    const deg = Math.min(1, (d._deg || 0) / 12);
    d._strength = 0.35 + deg * 0.55;
  }
  return d._strength;
}

function nodeColor(d) {
  if (d._core) return themeColors.warm || "#d39872";
  const age = (Date.now() - (d._ts || Date.now())) / 18000;
  const fade = Math.max(0.25, 1 - age);
  const t = 0.18 + nodeStrength(d) * 0.5 * fade;
  const interp = d3.interpolateRgb(themeColors.nodeLow || "#3a556e", themeColors.nodeHigh || "#cfe3f5");
  let color = interp(Math.min(1, t));
  const base = d3.color(color);
  if (base) color = base.darker(0.55) + "";
  const useBoost = nodeUseProgress(d._nid);
  if (isGlowing(d._nid) || useBoost > 0) {
    const c = d3.color(color);
    if (c) return c.brighter(2 + useBoost * 2) + "";
  }
  return color;
}

function nodeRadius(d) {
  const base = d._core ? 9 : 3.4 + Math.min((d._deg || 0) * 0.9, 5.4);
  const childScale = 1 + Math.min(1.5, (d._childCount || 0) * 0.18);
  const useBoost = nodeUseProgress(d._nid);
  const glowScale = isGlowing(d._nid) ? 1.08 : 1;
  const pulseScale = 1 + (Math.sin((1 - useBoost) * Math.PI * 3) * 0.04 + useBoost * 0.12);
  const scaledBase = base * physicsSettings.nodeSize;
  return Math.min(scaledBase * 2.5, scaledBase * childScale * glowScale * Math.max(1, pulseScale));
}

const sim = MEMORY_GRAPH_ENABLED
  ? d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d._nid))
    .force("charge", d3.forceManyBody())
    .force("center", d3.forceCenter(W / 2, H / 2 - 10))
    .force("x", d3.forceX(W / 2))
    .force("y", d3.forceY(H / 2 - 10))
    .force("radial", d3.forceRadial(180, W / 2, H / 2 - 10))
    .force("collision", d3.forceCollide())
    .alphaDecay(0.028)
    .velocityDecay(0.3)
    .on("tick", tick)
  : null;

function linkDistance(link) {
  const countFactor = Math.min(34, Math.sqrt(Math.max(1, nodeData.length)) * 4.2);
  if (link._kind === "visual_parent") return 82 + countFactor * 0.45;
  if (link._kind === "visual_random") return 108 + countFactor;
  return 76 + countFactor * 0.55;
}

function linkStrength(link) {
  if (link._kind === "visual_parent") return 0.2;
  if (link._kind === "visual_random") return 0.035;
  return 0.16;
}

function chargeStrength(node) {
  const countBoost = Math.min(76, Math.sqrt(Math.max(1, nodeData.length)) * 3.5);
  const baseCharge = -92 - countBoost * 0.4 - (node._deg || 0) * 2.4 - (node._childCount || 0) * 1.2;
  return baseCharge * physicsSettings.repulsion;
}

function radialStrength() {
  const baseSpread = nodeData.length > 36 ? 0.1 : 0.1;
  return baseSpread * physicsSettings.gravity;
}

function centerPullStrength() {
  const basePull = nodeData.length > 36 ? 0.04 : 0.055;
  return basePull * physicsSettings.gravity;
}

function collisionRadius(node) {
  const countPadding = nodeData.length > 36 ? 6 : 4;
  return nodeRadius(node) + countPadding;
}

function updateSimulationForces() {
  if (!MEMORY_GRAPH_ENABLED || !sim) return;
  sim.force("link")
    .distance(linkDistance)
    .strength(linkStrength);

  sim.force("charge")
    .strength(chargeStrength);

  sim.force("x")
    .x(W / 2)
    .strength(centerPullStrength());

  sim.force("y")
    .y(H / 2 - 10)
    .strength(centerPullStrength());

  sim.force("radial")
    .radius(Math.min(Math.max(24, Math.sqrt(Math.max(1, nodeData.length)) * 6), 64))
    .x(W / 2)
    .y(H / 2 - 10)
    .strength(radialStrength());

  sim.force("collision")
    .radius(collisionRadius)
    .strength(0.82)
    .iterations(nodeData.length > 40 ? 2 : 1);
}

function applyPhysicsSettings(restartAlpha = 2) {
  updatePhysicsReadout();
  if (!MEMORY_GRAPH_ENABLED || !sim) {
    savePhysicsSettings();
    return;
  }
  updateSimulationForces();
  refreshNodeVisuals();
  sim.alpha(Math.max(sim.alpha(), restartAlpha)).restart();
  savePhysicsSettings();
}

function refreshNodeVisuals() {
  if (!MEMORY_GRAPH_ENABLED) return;
  if (!nodeSel || nodeSel.empty()) return;
  nodeSel
    .attr("r", nodeRadius)
    .attr("fill", nodeColor)
    .attr("filter", d => (d._core || isGlowing(d._nid) || nodeUseProgress(d._nid) > 0) ? "url(#neb-glow)" : null)
    .style("animation", d => nodeUseProgress(d._nid) > 0 ? "neb-node-use 10s ease-out" : null);
}

function dampTangentialMotion() {
  if (!MEMORY_GRAPH_ENABLED || !sim) return;
  const cx = W / 2;
  const cy = H / 2 - 10;
  const twitching = sim.alpha() > 0.45;

  nodeData.forEach(node => {
    if (!node || node.fx != null || node.fy != null) return;

    const dx = (node.x ?? cx) - cx;
    const dy = (node.y ?? cy) - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return;

    const rx = dx / dist;
    const ry = dy / dist;
    const tx = -ry;
    const ty = rx;
    const vx = node.vx || 0;
    const vy = node.vy || 0;
    const radialVelocity = vx * rx + vy * ry;
    const tangentialVelocity = vx * tx + vy * ty;
    const tangentialDamping = twitching ? 0.14 : 0.24;

    node.vx = radialVelocity * rx + tangentialVelocity * tangentialDamping * tx;
    node.vy = radialVelocity * ry + tangentialVelocity * tangentialDamping * ty;
  });
}

function naturalTwitch() {
  if (!MEMORY_GRAPH_ENABLED || !sim) return;
  if (nodeData.length < 2) {
    sim.alpha(1).restart();
    return;
  }

  const nodeById = new Map(nodeData.map(node => [String(node._nid), node]));
  const anchorMap = new Map();
  linkData.forEach(link => {
    if (link._kind !== "visual_parent" && link._kind !== "visual_random") return;
    const sourceId = typeof link.source === "object" ? String(link.source._nid) : String(link.source);
    const targetId = typeof link.target === "object" ? String(link.target._nid) : String(link.target);
    if (!anchorMap.has(sourceId) && nodeById.has(targetId)) {
      anchorMap.set(sourceId, nodeById.get(targetId));
    }
  });

  const twitchCount = Math.max(6, Math.floor(nodeData.length * 0.3));
  const candidates = shuffleArray(nodeData.filter(node => !node._core)).slice(0, twitchCount);

  candidates.forEach(node => {
    const anchor = anchorMap.get(String(node._nid)) || nodeData[deterministicIndex(node._nid, nodeData.length)];
    if (!anchor) return;

    const anchorX = anchor.x ?? (W / 2);
    const anchorY = anchor.y ?? (H / 2 - 10);
    const angle = Math.random() * Math.PI * 2;
    const offset = 36 + Math.random() * 52;
    const nextX = anchorX + Math.cos(angle) * offset;
    const nextY = anchorY + Math.sin(angle) * offset;
    const currentX = node.x ?? nextX;
    const currentY = node.y ?? nextY;

    node.x = currentX * 0.7 + nextX * 0.3;
    node.y = currentY * 0.7 + nextY * 0.3;
    node.vx = (node.vx || 0) + (nextX - currentX) * 0.14;
    node.vy = (node.vy || 0) + (nextY - currentY) * 0.14;
  });

  sim.alpha(0.85).restart();
}

function tick() {
  if (!MEMORY_GRAPH_ENABLED) return;
  dampTangentialMotion();

  linkSel
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);

  nodeSel
    .attr("cx", d => d.x)
    .attr("cy", d => d.y);
}

function computeDegrees() {
  const nodeById = new Map(nodeData.map(n => [n._nid, n]));
  nodeData.forEach(n => {
    n._deg = 0;
    n._childCount = 0;
  });
  linkData.forEach(l => {
    const s = typeof l.source === "object" ? l.source : nodeById.get(String(l.source));
    const t = typeof l.target === "object" ? l.target : nodeById.get(String(l.target));
    if (s) s._deg = (s._deg || 0) + 1;
    if (t) t._deg = (t._deg || 0) + 1;
  });

  nodeData.forEach(node => {
    const childTargets = semanticChildTargets(node);
    if (childTargets.size) {
      node._childCount = childTargets.size;
      return;
    }

    const selfId = String(node._nid || "");
    node._childCount = nodeData.reduce((count, candidate) => (
      candidate.parent_id != null && String(candidate.parent_id) === selfId ? count + 1 : count
    ), 0);
  });
}

function showTip(event, d) {
  const label = d.title || (d.content || "").slice(0, 120) || d._nid;
  const type = d._core ? "self" : (d.event_type || "memory");
  tip
    .style("display", "block")
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 12}px`)
    .html(`<span class="tip-type">${type}</span><div>${label}</div>`);
}

function parseEntities(raw) {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw || []);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function parseLinks(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw || []);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function semanticChildTargets(node) {
  const targets = new Set();
  parseLinks(node.links).forEach(link => {
    if (!link || typeof link !== "object") return;
    const relation = String(link.relation || "").toLowerCase();
    const targetId = String(link.target_id || link.targetId || "").trim();
    if (relation === "parent_of" && targetId) targets.add(targetId);
  });
  return targets;
}

function markCore() {
  nodeData.forEach(n => { n._core = false; });
  const core = nodeData.find(n => parseEntities(n.entities).includes("agent:jarvis"))
    || nodeData[0];
  if (core) core._core = true;
}

function renderLegend() {
  const el = document.getElementById("legend");
  if (!el) return;
  const total = nodeData.length;
  const active = nodeData.filter(n => (Date.now() - (n._ts || 0)) < 15000).length;
  const known = Math.max(0, total - active - 1);
  const decayed = nodeData.filter(n => (Date.now() - (n._ts || 0)) > 60000).length;

  const items = [
    { name: "Constraint", count: 1, color: themeColors.warm },
    { name: "Memory", count: total, color: themeColors.nodeHigh },
    { name: "Knowledge", count: known, color: themeColors.cool },
    { name: "Decayed", count: decayed, color: themeColors.dim },
  ];

  el.innerHTML = items.map(i =>
    `<div class="legend-item">
      <span class="legend-dot" style="background:${i.color}"></span>
      <span class="legend-name">${i.name}</span>
      <span class="legend-count">${i.count}</span>
    </div>`
  ).join("");
}

function renderGraph(restartAlpha = 2) {
  if (!MEMORY_GRAPH_ENABLED || !sim) {
    updateStats();
    renderLegend();
    return;
  }
  computeDegrees();
  markCore();
  updateStats();
  renderLegend();

  linkSel = linkSel.data(linkData, d => d._lid);
  linkSel.exit().remove();
  linkSel = linkSel.enter().append("line")
    .attr("stroke", themeColors.linkStroke || "rgba(143,182,216,0.18)")
    .attr("stroke-width", 0.6)
    .merge(linkSel);

  nodeSel = nodeSel.data(nodeData, d => d._nid);
  nodeSel.exit().transition().duration(280).attr("r", 0).remove();

  const enter = nodeSel.enter().append("circle")
    .attr("r", 0)
    .attr("fill", nodeColor)
    .style("cursor", "pointer")
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(2).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null; d.fy = null;
      }))
    .on("mouseover", showTip)
    .on("mousemove", event => {
      tip.style("left", `${event.clientX + 14}px`)
         .style("top", `${event.clientY + 12}px`);
    })
    .on("mouseout", () => tip.style("display", "none"))
    .on("click", (event, d) => {
      d._ts = Date.now();
      d._strength = Math.min(1, (d._strength || 0.5) + 0.25);
      highlightNodes([d._nid], 900);
    });

  enter.transition().duration(360).attr("r", nodeRadius);
  nodeSel = enter.merge(nodeSel);

  sim.nodes(nodeData);
  sim.force("link").links(linkData);
  updateSimulationForces();
  sim.alpha(0.5).restart();
  refreshNodeVisuals();
}

function deterministicIndex(seed, mod) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % mod;
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createVisualOrder(nodes) {
  const coreNode = nodes.find(n => n._core || parseEntities(n.entities).includes("agent:jarvis")) || null;
  const rest = shuffleArray(nodes.filter(n => !coreNode || n._nid !== coreNode._nid));
  return coreNode ? [coreNode, ...rest] : rest;
}

function chooseVisualParent(child, candidates, childCounts) {
  if (!candidates.length) return null;
  const weighted = [];
  candidates.forEach(candidate => {
    const currentChildren = childCounts.get(candidate._nid) || 0;
    const maxChildren = maxVisualChildren(candidate);
    const recencyBias = Math.max(0, 400000 - Math.abs((child._ts || 0) - (candidate._ts || 0))) / 100000;
    const coreBias = candidate._core ? 1.4 : 0;
    const strengthBias = (candidate._strength || 0.4) * 0.8;
    const remainingCapacity = Math.max(0, maxChildren - currentChildren);
    const capacityBias = currentChildren === 0 ? 1.2 : 0.35 + remainingCapacity * 0.25;
    const entryCount = 1 + Math.max(0, Math.round((recencyBias + coreBias + strengthBias + capacityBias) * 2));
    for (let w = 0; w < entryCount; w++) {
      weighted.push(candidate);
    }
  });
  if (!weighted.length) return candidates[Math.floor(Math.random() * candidates.length)] || null;
  return weighted[Math.floor(Math.random() * weighted.length)] || null;
}

function getCurrentVisualChildCounts(nodes) {
  const counts = new Map(nodes.map(n => [n._nid, 0]));
  linkData.forEach(link => {
    if (link._kind !== "visual_parent") return;
    const parentId = typeof link.target === "object" ? String(link.target._nid) : String(link.target);
    counts.set(parentId, (counts.get(parentId) || 0) + 1);
  });
  return counts;
}

function maxVisualChildren(node) {
  if (!node) return 2;
  if (node._core) return 4;
  const degree = node._deg || 0;
  const strength = node._strength || 0;
  return (degree >= 4 || strength >= 0.72) ? 4 : 2;
}

function addSupplementalVisualLinks(linkSet, childCounts) {
  const ordered = createVisualOrder(nodeData);
  const extraLinks = Math.min(18, Math.max(2, Math.floor(nodeData.length / 5)));
  let added = 0;

  for (let i = 1; i < ordered.length && added < extraLinks; i++) {
    const source = ordered[i];
    const candidates = shuffleArray(
      ordered.slice(0, i).filter(node => {
        if (node._nid === source._nid) return false;
        return (childCounts.get(node._nid) || 0) < maxVisualChildren(node);
      })
    );

    const target = candidates[0];
    if (!target) continue;

    const lid = `visual-extra:${source._nid}=>${target._nid}`;
    const rev = `visual-extra:${target._nid}=>${source._nid}`;
    const base = `visual:${source._nid}=>${target._nid}`;
    const baseRev = `visual:${target._nid}=>${source._nid}`;
    if (linkSet.has(lid) || linkSet.has(rev) || linkSet.has(base) || linkSet.has(baseRev)) continue;

    linkSet.add(lid);
    linkData.push({ source: source._nid, target: target._nid, _lid: lid, _kind: "visual_random" });
    childCounts.set(target._nid, (childCounts.get(target._nid) || 0) + 1);
    added += 1;
  }
}

function addRandomVisualLinks(linkSet) {
  if (nodeData.length < 2) return;

  const ordered = createVisualOrder(nodeData);
  const childCounts = new Map(ordered.map(n => [n._nid, 0]));

  for (let i = 1; i < ordered.length; i++) {
    const child = ordered[i];
    const candidates = ordered
      .slice(0, i)
      .filter(node => (childCounts.get(node._nid) || 0) < maxVisualChildren(node));

    const parent = chooseVisualParent(child, candidates, childCounts);
    if (!parent || parent._nid === child._nid) continue;

    const lid = `visual:${child._nid}=>${parent._nid}`;
    const rev = `visual:${parent._nid}=>${child._nid}`;
    if (linkSet.has(lid) || linkSet.has(rev)) continue;

    linkSet.add(lid);
    linkData.push({ source: child._nid, target: parent._nid, _lid: lid, _kind: "visual_parent" });
    childCounts.set(parent._nid, (childCounts.get(parent._nid) || 0) + 1);
  }

  addSupplementalVisualLinks(linkSet, childCounts);
}

function findAnchorNode(memory, nodeMap) {
  const nodes = Array.from(nodeMap.values());
  const childCounts = getCurrentVisualChildCounts(nodes);
  const candidates = createVisualOrder(nodes)
    .filter(node => (childCounts.get(node._nid) || 0) < maxVisualChildren(node));
  return chooseVisualParent(memory, candidates, childCounts)
    || nodeData.find(n => n._core)
    || nodeData[0]
    || null;
}

async function loadMemories() {
  if (!MEMORY_GRAPH_ENABLED) return;
  try {
    const rows = await fetch(`${API}/memories?limit=120`).then(r => r.json());
    if (!Array.isArray(rows)) return;

    const prevPositions = new Map(nodeData.map(n => [n._nid, {
      x: n.x, y: n.y, vx: n.vx, vy: n.vy, fx: n.fx, fy: n.fy,
    }]));

    nodeData = rows.map(row => {
      const nid = row.mem_id || String(row.id);
      const prev = prevPositions.get(nid);
      return {
        ...row,
        _nid: nid,
        _ts: prev ? Date.now() : Date.now() - Math.random() * 8000,
        x: prev ? prev.x : W / 2 + (Math.random() - 0.5) * 180,
        y: prev ? prev.y : H / 2 + (Math.random() - 0.5) * 180,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        fx: prev ? prev.fx : null,
        fy: prev ? prev.fy : null,
      };
    });

    const linkSet = new Set();
    linkData = [];
    addRandomVisualLinks(linkSet);

    renderGraph(1.1);
  } catch (error) {
    console.warn("[graph] load failed:", error.message);
    setConnectionState("未连接", false);
  }
}

function addNewNodes(memories) {
  if (!MEMORY_GRAPH_ENABLED) return;
  const nodeMap = new Map(nodeData.map(n => [n._nid, n]));
  const newNids = [];
  memories.forEach(memory => {
    const nid = memory.mem_id || memory.id;
    if (!nid || nodeMap.has(String(nid))) return;
    const anchor = findAnchorNode(memory, nodeMap);
    const anchorX = anchor?.x ?? W / 2;
    const anchorY = anchor?.y ?? (H / 2 - 10);
    const node = {
      ...memory,
      _nid: String(nid),
      mem_id: String(nid),
      event_type: memory.event_type || memory.type || "fact",
      _ts: Date.now(),
      _strength: 0.85,
      x: anchorX + (Math.random() - 0.5) * 72,
      y: anchorY + (Math.random() - 0.5) * 72,
      vx: 0, vy: 0,
    };
    nodeData.push(node);
    nodeMap.set(node._nid, node);
    newNids.push(node._nid);
  });
  if (!newNids.length) return;

  const linkSet = new Set();
  linkData = [];
  addRandomVisualLinks(linkSet);
  renderGraph(2);
  highlightNodes(newNids, 10000);
}

if (MEMORY_GRAPH_ENABLED) {
  setInterval(() => naturalTwitch(), 6000);
  setInterval(() => { nodeData.forEach(n => { if (n._strength) n._strength *= 0.97; }); }, 2500);
}

function parseUserMessageInput(raw) {
  const text = String(raw || "");
  const match = text.match(/^\[([^\]]+)\]\s+(\S+)\s+\[([^\]]+)\]\s+([\s\S]*)$/);
  if (!match) return { content: text.trim(), time: null };
  return { fromId: match[1], timestamp: match[2], channel: match[3], content: match[4].trim(), time: formatMsgTime(match[2]) };
}

function formatMsgTime(stamp) {
  if (!stamp) return null;
  const m = String(stamp).match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  const m2 = String(stamp).match(/(\d{2}):(\d{2}):(\d{2})/);
  if (m2) return `${m2[1]}:${m2[2]}:${m2[3]}`;
  return null;
}

const L1 = new ThoughtStream("si-l1", "cool", {
  readCSSVar,
  thinkingLabel: "思考中…",
  thinkingDoneLabel: "思考完成",
  toolDetailLength: 140,
});
const L2 = new ThoughtStream("si-l2", "warm", {
  readCSSVar,
  thinkingLabel: "思考中",
  thinkingDoneLabel: "思考完成",
  toolDetailLength: 220,
});

// L1 = processing flow triggered by user messages; L2 = processing flow triggered by TICK.
// stream_*/tool_call events emitted by the backend carry no path tag;
// routing to the correct panel is determined by the most recent message_received / tick event.
let currentPath = "l2";
function currentStream() { return currentPath === "l1" ? L1 : L2; }
function streamForTurnLabel(label = "") {
  const value = String(label || "");
  if (/^L2\b|heartbeat|TICK/i.test(value)) return L2;
  if (/^L1\b|^BG\b|wechat|message/i.test(value)) return L1;
  return currentStream();
}

const THINKING_WATCHDOG_MS = 190000;
const thinkingWatchdogs = { l1: null, l2: null };
function clearThinkingWatchdog(path = currentPath) {
  const key = path === "l1" ? "l1" : "l2";
  if (thinkingWatchdogs[key]) clearTimeout(thinkingWatchdogs[key]);
  thinkingWatchdogs[key] = null;
}
function armThinkingWatchdog(path = currentPath) {
  const key = path === "l1" ? "l1" : "l2";
  clearThinkingWatchdog(key);
  thinkingWatchdogs[key] = setTimeout(() => {
    const stream = key === "l1" ? L1 : L2;
    stream.setStatus("本轮超时，已停止等待", "failed");
    stream.end();
    if (key === "l1") window.bailongmaVoice?.syncTurn?.(null, 'stream_end');
  }, THINKING_WATCHDOG_MS);
}

const INTERNAL_MEMORY_TOOLS = new Set([
  "skip_recognition",
  "skip_consolidation",
  "merge_memories",
  "downgrade_memory",
  "upsert_memory",
]);
function isInternalMemoryToolName(name) {
  return INTERNAL_MEMORY_TOOLS.has(String(name || "").trim());
}

function isBusyErrorMessage(message = "") {
  return /(429|rate limit|too many requests|busy|overload|temporarily unavailable|server busy|resource exhausted)/i.test(String(message || ""));
}

function formatRetryDelay(ms) {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

let tokenAccum = 0;
let tokenWindow = Date.now();
const tokRateEl = document.getElementById("tok-rate");

function bumpTokens(text) {
  tokenAccum += (text || "").length / 3.4;
  const now = Date.now();
  if (now - tokenWindow > 700) {
    const rate = tokenAccum / ((now - tokenWindow) / 1000);
    tokRateEl.textContent = rate.toFixed(1);
    tokenAccum = 0;
    tokenWindow = now;
    setTimeout(() => { if (tokRateEl.textContent !== "—" && tokenAccum === 0) tokRateEl.textContent = "—"; }, 4000);
  }
}

// ── 专注帧观察面板 (focus stack) ────────────────────────────────
// 设计文档 7.5：用户必须看得见 Agent 此刻在专注什么。
// 纯事件驱动：focus_frame → 全量重渲染；focus_compressed → 在栈顶尾部追加 conclusion 并淡入。

function escapeFocusText(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateConclusion(text, max = 60) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim() + "…";
}

function renderFocusFrame(frame, { isTop }) {
  const conclusions = Array.isArray(frame?.conclusions) ? frame.conclusions : [];

  // 主行显示策略（progressive disclosure）：
  //   1. 有 conclusion → 显示最新一条（这是子帧 pop 时压缩出的 1-2 句话结论）
  //   2. 无 conclusion 但有 topic → 显示 topic（v0 是 ngram，几百 ms 后被 LLM refine 成人类可读短语）
  //   3. 都没 → 返回空主行（上层 renderFocusStack 会进一步过滤）
  // 早期 conclusion 作为弱化辅助行（栈顶帧才显示，避免视觉过载）
  const latest = conclusions.length > 0 ? conclusions[conclusions.length - 1] : "";
  const earlier = conclusions.length > 1 ? conclusions.slice(0, -1) : [];
  const topicSummary = Array.isArray(frame?.topic) && frame.topic.length > 0
    ? frame.topic.slice(0, 3).join(" · ")
    : "";

  let mainHTML = "";
  if (latest) {
    mainHTML = `<div class="focus-frame-main">${escapeFocusText(truncateConclusion(latest, isTop ? 120 : 80))}</div>`;
  } else if (topicSummary) {
    mainHTML = `<div class="focus-frame-main focus-frame-main-fallback">${escapeFocusText(truncateConclusion(topicSummary, isTop ? 60 : 40))}</div>`;
  }

  const earlierHTML = earlier.map((c) =>
    `<div class="focus-frame-conclusion focus-frame-conclusion-earlier">${escapeFocusText(truncateConclusion(c, isTop ? 100 : 60))}</div>`
  ).join("");

  // 该帧既无 conclusion 也无 topic（极短暂的"刚 push 还没赋 topic"状态），不渲染外层壳
  if (!mainHTML && !earlierHTML) return "";

  return (
    `<div class="focus-frame${isTop ? " top" : ""}">` +
      mainHTML +
      earlierHTML +
    `</div>`
  );
}

function renderFocusStack(stack) {
  if (!focusStackEl || !focusBlockEl) return;
  const list = Array.isArray(stack) ? stack : [];
  if (focusDepthEl) focusDepthEl.textContent = String(list.length);

  if (list.length === 0) {
    focusBlockEl.dataset.state = "empty";
    focusStackEl.innerHTML = `<div class="focus-empty">无专注</div>`;
    return;
  }

  focusBlockEl.dataset.state = "active";
  // 渲染策略：只渲染"有 conclusion 的帧 + 栈顶帧"。
  // 非栈顶 + 无 conclusion 的帧静默隐藏——这种帧是"已 push 但还没 pop"的活帧，
  // conclusion 永远空着，渲染出来只是占位文字（"…"），堆叠多了视觉很噪。
  // depth 数字仍然显示真实栈深度，让用户知道还有未压缩的帧挂着。
  // 栈底 → 栈顶；视觉上栈顶在最下（最近一次最强），跟终端 / 思考流方向一致。
  const html = list.map((frame, i) => {
    const isTop = i === list.length - 1;
    const hasConclusion = Array.isArray(frame?.conclusions) && frame.conclusions.length > 0;
    if (!isTop && !hasConclusion) return "";
    return renderFocusFrame(frame, { isTop });
  }).filter(Boolean).join("");
  focusStackEl.innerHTML = html;
}

function flashFocusCompressed() {
  if (!focusBlockEl) return;
  // 让栈顶帧的主行（最新 conclusion）走淡入动画；同时整块做一次柔和高光。
  focusBlockEl.classList.remove("focus-compress-pulse");
  // 强制 reflow 让动画重启
  void focusBlockEl.offsetWidth;
  focusBlockEl.classList.add("focus-compress-pulse");

  const topFrame = focusStackEl?.querySelector(".focus-frame.top");
  const mainEl = topFrame?.querySelector(".focus-frame-main");
  if (mainEl) {
    mainEl.classList.remove("just-added");
    void mainEl.offsetWidth;
    mainEl.classList.add("just-added");
  }
}

function connectSSE() {
  setConnectionState("连接中", true);
  const es = new EventSource(`${API}/events`);

  es.onopen = () => setConnectionState("已连接", true);

  es.onmessage = event => {
    try { handle(JSON.parse(event.data)); } catch (_) {}
  };

  es.onerror = () => {
    setConnectionState("重连中", false);
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

function extractNids(memList) {
  return (memList || [])
    .map(m => m.mem_id || (m.id != null ? String(m.id) : null))
    .filter(Boolean);
}

function handle({ type, data = {} }) {
  switch (type) {
    case "message_received": {
      currentPath = "l1";
      window.bailongmaVoice?.syncTurn?.(data.voiceTurnId || null, 'thinking');
      L1.beginRound();
      const parsed = parseUserMessageInput(data.input);
      L1.newLine("user message received", {
        content: parsed.content,
        time: parsed.time || undefined,
      });
      // Immediately show a "thinking" indicator so the gap between message_received
      // and the first stream_start (injector + LLM TTFT, often 3–30s) doesn't look frozen.
      L1.startThinkingSession();
      armThinkingWatchdog("l1");
      break;
    }
    case "tick":
      currentPath = "l2";
      L2.beginRound();
      L2.newLine("heartbeat tick");
      L2.startThinkingSession();
      armThinkingWatchdog("l2");
      break;
    case "stream_start":
      window.bailongmaVoice?.syncTurn?.(data.voiceTurnId || null, data.mode === 'text' ? 'speaking_pending' : 'thinking');
      currentStream().startThinkingSession();
      break;
    case "stream_chunk":
      // No longer rendering thought content — only drives the token-rate indicator
      currentStream().clearStatus();
      bumpTokens(data.text);
      break;
    case "stream_end":
      window.bailongmaVoice?.syncTurn?.(data.voiceTurnId || null, 'stream_end');
      currentStream().stopThinking();
      break;
    case "tool_preparing": {
      if (isInternalMemoryToolName(data.name)) break;
      // 思考动画已停，但工具尚未真正执行 —— 给一个占位状态避免 UI 死寂
      const stream = currentStream();
      const label = data.name ? stream.toolLabel(data.name) : "";
      stream.setStatus(label ? `准备调用 ${label}…` : "准备工具调用…", "busy");
      break;
    }
    case "tool_executing": {
      if (isInternalMemoryToolName(data.name)) break;
      const stream = currentStream();
      const label = data.name ? stream.toolLabel(data.name) : "工具";
      stream.setStatus(`正在执行 ${label}…`, "busy");
      break;
    }
    case "tool_call":
      if (isInternalMemoryToolName(data.name)) break;
      currentStream().tool(data.name, data.args, data.result, data.ok);
      break;
    case "response":
      // Round complete — stop all animations
      streamForTurnLabel(data.label).end();
      clearThinkingWatchdog(streamForTurnLabel(data.label) === L1 ? "l1" : "l2");
      break;
    case "turn_finished": {
      const stream = streamForTurnLabel(data.label);
      stream.end();
      clearThinkingWatchdog(stream === L1 ? "l1" : "l2");
      break;
    }
    case "llm_retry": {
      currentStream().startThinkingSession();
      if (data.type === "llm_failover") {
        const toProfile = data.toProfile || "备用模型";
        currentStream().setStatus("当前模型不可用，正在无缝切换到 " + toProfile, "busy");
        break;
      }
      const nextAttempt = Number(data.nextAttempt || 2);
      const delayText = formatRetryDelay(Number(data.delayMs || 0));
      currentStream().setStatus("LLM 繁忙，第 " + nextAttempt + " 次重试将于 " + delayText + " 后开始", "busy");
      break;
    }
    case "llm_profiles_updated": {
      window.dispatchEvent(new CustomEvent("bailongma:llm-profiles-updated", { detail: data }));
      break;
    }
    case "llm_connectivity_checked": {
      window.dispatchEvent(new CustomEvent("bailongma:llm-connectivity-checked", { detail: data }));
      break;
    }
    case "message_requeued": {
      currentStream().startThinkingSession();
      const retryCount = Number(data.retryCount || 1);
      currentStream().setStatus("LLM 繁忙，已入队重试 " + retryCount + "/3", "busy");
      break;
    }
    case "message_dropped":
      currentStream().startThinkingSession();
      currentStream().setStatus("LLM 繁忙，重试次数已达上限", "failed");
      break;
    case "error":
      if (isBusyErrorMessage(data.error)) {
        currentStream().startThinkingSession();
        currentStream().setStatus("LLM 繁忙，请稍后重试", "busy");
      }
      break;
    case "injector_result": {
      const nids = [...extractNids(data.matchedMemories), ...extractNids(data.recallMemories)];
      if (nids.length) highlightNodes(nids, 10000);
      break;
    }
    case "focus_frame": {
      renderFocusStack(data.focusStack);
      break;
    }
    case "focus_compressed": {
      // 后端 emit 顺序：先 focus_frame（栈已 pop 完）→ 异步压缩完再 focus_compressed。
      // 触发时栈顶帧的 conclusions 数组在后端已被追加，但前端 DOM 里还是旧的。
      // 新布局：把新 conclusion 写入「主行」(.focus-frame-main)；
      // 若主行原本是 fallback（暂无沉淀结论），就把它升级为正常主行。
      // 若主行已有旧 conclusion，把旧值降级追加到「早期 conclusion」列表里，再覆盖主行。
      // 下一次 focus_frame 事件会带最新 conclusions 全量覆盖，所以即使错位也很快收敛。
      const topFrame = focusStackEl?.querySelector(".focus-frame.top");
      if (topFrame && data.conclusion) {
        const mainEl = topFrame.querySelector(".focus-frame-main");
        const newText = truncateConclusion(data.conclusion, 120);
        if (mainEl) {
          const wasFallback = mainEl.classList.contains("focus-frame-main-fallback");
          if (!wasFallback && mainEl.textContent) {
            const earlier = document.createElement("div");
            earlier.className = "focus-frame-conclusion focus-frame-conclusion-earlier";
            earlier.textContent = mainEl.textContent;
            topFrame.appendChild(earlier);
          }
          mainEl.classList.remove("focus-frame-main-fallback");
          mainEl.innerHTML = "";
          mainEl.textContent = newText;
        }
      }
      flashFocusCompressed();
      break;
    }
    case "memories_written":
      if (Array.isArray(data.memories) && data.memories.length) {
        addNewNodes(data.memories);
      }
      break;
    case "message":
      if (data.from === "consciousness") {
        lastJarvisContent = data.content;
        const viaLabel = friendlyChannelLabel(data.channel);
        const content = viaLabel ? `_→ ${viaLabel}_  \n${data.content}` : data.content;
        addMsg("jarvis", content);
        enrichVisiblePersonCardFromText(data.content, { source: 'assistant_message' });
        openChat(true);
      }
      break;
    case "message_in": {
      // 外部渠道判定：channel 非空且非本地，或 from_id 仍带外部前缀（兼容连接器直接 emit 的事件）
      const ch = String(data.channel || "").toUpperCase();
      const isExternal =
        (ch && ch !== "TUI" && ch !== "API" && ch !== "SYSTEM" && ch !== "REMINDER" && ch !== "APP_SIGNAL" && ch !== "VOICE" && ch !== "语音识别")
        || (data.from_id && /^(wechat|discord|feishu|wecom):/i.test(data.from_id));
      if (isExternal) {
        const label = friendlyChannelLabel(data.channel) || data.from_id || "External";
        addMsg("external", data.content, { label, alert: false });
        openChat(true);
      }
      break;
    }
    case "agent_name_updated":
      setAgentName(data.name);
      break;
    case "media_mode":
      window.dispatchEvent(new CustomEvent("bailongma:media", { detail: data }));
      break;
    case "hotspot_mode":
      setHotspotMode(!!data.active || data.action === "show" || data.action === "open", { source: "agent_event" });
      break;
    case "doc_panel_mode":
      setDocPanelMode(!!data.active || data.action === "open", { topicId: data.topic || null, source: "agent_event" });
      break;
    case "person_card_mode":
      setPersonCardMode(!!data.active || data.action === "show" || data.action === "open" || data.action === "update", { source: "agent_event", card: data.card || null });
      break;
    case "social_status":
      window.dispatchEvent(new CustomEvent("bailongma:social_status", { detail: data }));
      break;
    case "show_wechat_popup":
      showWechatPopup();
      break;
    case "audio_created":
      if (data.autoPlay && data.path) {
        const audioUrl = `${API}/${data.path}`;
        const audioEl = new Audio(audioUrl);
        audioEl.play().catch(() => {});
      }
      break;
    case "voice_turn_state":
      window.bailongmaVoice?.syncTurn?.(data.voiceTurnId || null, data.state || 'event');
      break;
    case "tts_reply":
      if (data.text) playTTSReply(data.text, { voiceTurnId: data.voiceTurnId || null });
      break;
    case "key_configured":
      chat.deleteLastUserMsg();
      if (data.service === 'tts' && data.ttsText) playTTSReply(data.ttsText);
      break;
    case "startup_self_check_started":
      playJarvisStartupSound();
      setTimeout(() => playTTSReply("System starting, running self-check"), 1500);
      break;
    default:
      break;
  }
}

// ── Jarvis-style startup self-check sound ────────────────────────────────────
function playJarvisStartupSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;

    // Layer 1: low-frequency mechanical hum (sawtooth, simulates power-on)
    const drone = ctx.createOscillator();
    const droneGain = ctx.createGain();
    const droneFilter = ctx.createBiquadFilter();
    drone.type = "sawtooth";
    drone.frequency.setValueAtTime(50, t);
    drone.frequency.linearRampToValueAtTime(90, t + 0.5);
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 350;
    droneFilter.Q.value = 3;
    droneGain.gain.setValueAtTime(0, t);
    droneGain.gain.linearRampToValueAtTime(0.09, t + 0.06);
    droneGain.gain.linearRampToValueAtTime(0.06, t + 0.4);
    droneGain.gain.linearRampToValueAtTime(0, t + 0.65);
    drone.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(ctx.destination);
    drone.start(t);
    drone.stop(t + 0.7);

    // Layer 2: system-online frequency sweep (sine, low to high)
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = "sine";
    sweep.frequency.setValueAtTime(280, t + 0.12);
    sweep.frequency.exponentialRampToValueAtTime(2800, t + 1.0);
    sweepGain.gain.setValueAtTime(0, t + 0.12);
    sweepGain.gain.linearRampToValueAtTime(0.13, t + 0.22);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    sweep.connect(sweepGain);
    sweepGain.connect(ctx.destination);
    sweep.start(t + 0.12);
    sweep.stop(t + 1.1);

    // Layer 3: three confirmation beeps (square wave, self-check passed)
    [[880, 1.15], [1100, 1.28], [1320, 1.41]].forEach(([freq, bt]) => {
      const beep = ctx.createOscillator();
      const beepGain = ctx.createGain();
      const beepFilter = ctx.createBiquadFilter();
      beep.type = "square";
      beep.frequency.value = freq;
      beepFilter.type = "bandpass";
      beepFilter.frequency.value = freq;
      beepFilter.Q.value = 8;
      beepGain.gain.setValueAtTime(0.14, t + bt);
      beepGain.gain.exponentialRampToValueAtTime(0.001, t + bt + 0.075);
      beep.connect(beepFilter);
      beepFilter.connect(beepGain);
      beepGain.connect(ctx.destination);
      beep.start(t + bt);
      beep.stop(t + bt + 0.09);
    });

    setTimeout(() => ctx.close().catch(() => {}), 2500);
  } catch (_) {
    // silently ignore if browser does not support AudioContext
  }
}

// ── TTS reply playback / fast voice interaction ──────────────────────────────
let ttsAudioEl = null;
let ttsCurrentText = '';
let ttsInterruptedRemaining = '';
let lastJarvisContent = '';
let ttsInterruptedOriginalContent = '';
let ttsInterruptionApplied = false;
let ttsInterruptionDbTimer = null;
let ttsQueue = [];
let ttsPlaying = false;
let ttsQueueGeneration = 0;
let ttsAbortController = null;
let ttsActiveUrl = '';
let ttsPrefetch = null;
let ttsPrefetchAbortController = null;
const VOICE_FAST_MODE_STORAGE_KEY = 'bailongma-voice-fast-mode';
const TTS_SENTENCE_BOUNDARY_RE = /[^。！？!?；;\n]{8,}[。！？!?；;]/g;
const ttsFastState = { state: 'idle', updatedAt: 0 };
let ttsActiveVoiceTurnId = null;
let ttsQueueVoiceTurnId = null;

function isFastVoiceModeEnabled() {
  return localStorage.getItem(VOICE_FAST_MODE_STORAGE_KEY) !== 'false';
}

function setFastVoiceState(state, detail = {}) {
  ttsFastState.state = state;
  ttsFastState.updatedAt = Date.now();
  window.dispatchEvent(new CustomEvent('bailongma:voice-fast-state', { detail: { state, voiceTurnId: ttsActiveVoiceTurnId || ttsQueueVoiceTurnId || null, ...detail } }));
}

function isCurrentTtsVoiceTurn(voiceTurnId) {
  // TTS 不能因为前端 voice session 状态不同步就被丢弃；turnId 只用于清理旧队列/打断，
  // 当前收到的语音回复必须能播出来，否则会出现“文字回复了但没声音”。
  if (!voiceTurnId) return true;
  if (!window.bailongmaVoice?.isCurrentTurn) return true;
  return window.bailongmaVoice.isCurrentTurn(voiceTurnId) || !ttsPlaying;
}

function normalizeTTSPlainText(text) {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongTtsSegment(segment) {
  const text = String(segment || '').trim();
  if (!text || text.length <= 140) return text ? [text] : [];
  const parts = [];
  let rest = text;
  while (rest.length > 140) {
    const windowText = rest.slice(0, 140);
    // 稳定优先：超长句才兜底切分；优先分号，最后才按逗号，避免碎片化请求。
    let cut = Math.max(windowText.lastIndexOf('；'), windowText.lastIndexOf(';'));
    if (cut < 70) cut = Math.max(windowText.lastIndexOf('，'), windowText.lastIndexOf(','));
    if (cut < 70 || rest.length - cut - 1 < 16) cut = 110;
    const part = rest.slice(0, cut + 1).trim();
    if (part) parts.push(part);
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function splitTtsSentences(text) {
  const plain = normalizeTTSPlainText(text);
  if (!plain) return [];
  const rawParts = [];
  let last = 0;
  let match;
  TTS_SENTENCE_BOUNDARY_RE.lastIndex = 0;
  while ((match = TTS_SENTENCE_BOUNDARY_RE.exec(plain)) !== null) {
    const end = match.index + match[0].length;
    const part = plain.slice(last, end).trim();
    if (part) rawParts.push(part);
    last = end;
  }
  const tail = plain.slice(last).trim();
  if (tail) rawParts.push(tail);
  const safeParts = rawParts.flatMap(splitLongTtsSegment);
  return safeParts.length ? safeParts : [plain];
}

function clearTtsQueue() {
  ttsQueue = [];
  ttsQueueGeneration += 1;
  ttsQueueVoiceTurnId = null;
  if (ttsAbortController) {
    try { ttsAbortController.abort(); } catch {}
    ttsAbortController = null;
  }
  if (ttsPrefetchAbortController) {
    try { ttsPrefetchAbortController.abort(); } catch {}
    ttsPrefetchAbortController = null;
  }
  if (ttsPrefetch?.url) { try { URL.revokeObjectURL(ttsPrefetch.url); } catch {} }
  ttsPrefetch = null;
}

// Estimate spoken char count from audio progress, snapping to a sentence boundary
function calcRemainingText(text, currentTime, duration) {
  if (!text || !duration || duration <= 0) return { remaining: '', spokenUpTo: 0 };
  const progress = Math.min(1, currentTime / duration);
  const spokenChars = Math.floor(text.length * progress);
  const BOUNDARIES = /[。！？，.!?,\n]/g;
  let bestPos = spokenChars;
  let match;
  BOUNDARIES.lastIndex = Math.max(0, spokenChars - 10);
  while ((match = BOUNDARIES.exec(text)) !== null) {
    if (match.index >= spokenChars) {
      bestPos = match.index + 1;
      break;
    }
  }
  return { remaining: text.slice(bestPos).trim(), spokenUpTo: bestPos };
}

// Estimate cut position in original markdown based on spoken ratio in TTS plain text
function findMarkdownCutPos(markdown, ttsFullLen, ttsSpokenUpTo) {
  if (!markdown || ttsFullLen <= 0) return 0;
  const ratio = ttsSpokenUpTo / ttsFullLen;
  const approxPos = Math.floor(markdown.length * ratio);
  const BOUNDARIES = /[。！？\n.!?]/g;
  let bestPos = approxPos;
  BOUNDARIES.lastIndex = Math.max(0, approxPos - 15);
  let match;
  while ((match = BOUNDARIES.exec(markdown)) !== null) {
    if (match.index >= approxPos) { bestPos = match.index + 1; break; }
  }
  return bestPos;
}

// Apply interruption marker to chat UI; delay DB write so false triggers can be undone
function applyTTSInterruption(spokenUpTo) {
  const originalContent = lastJarvisContent || ttsCurrentText;
  if (!originalContent) return;
  ttsInterruptedOriginalContent = originalContent;
  ttsInterruptionApplied = true;

  const cutPos = findMarkdownCutPos(originalContent, ttsCurrentText.length, spokenUpTo);
  const spokenMarkdown = originalContent.slice(0, cutPos).trimEnd();
  const displayText = spokenMarkdown ? spokenMarkdown + ' ✋' : '✋';
  const dbContent = spokenMarkdown || '✋';

  updateLastJarvisMsg(displayText);

  if (ttsInterruptionDbTimer) clearTimeout(ttsInterruptionDbTimer);
  ttsInterruptionDbTimer = setTimeout(() => {
    ttsInterruptionDbTimer = null;
    fetch(`${API}/tts/interrupted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spokenContent: dbContent }),
    }).catch(() => {});
  }, 4000);
}

// Called by voice-panel interruption detection: stop current TTS and record cut point
window.stopTTS = (detail = {}) => {
  if (detail.voiceTurnId && ttsActiveVoiceTurnId && detail.voiceTurnId !== ttsActiveVoiceTurnId) return;
  clearTtsQueue();
  if (!ttsAudioEl) {
    ttsPlaying = false;
    setFastVoiceState('interrupted');
    return;
  }
  const { remaining, spokenUpTo } = calcRemainingText(
    ttsCurrentText,
    ttsAudioEl.currentTime,
    ttsAudioEl.duration,
  );
  // When duration is not yet loaded (NaN): spokenUpTo=0, remaining='', falls back to full text
  ttsInterruptedRemaining = remaining || ttsCurrentText;
  applyTTSInterruption(spokenUpTo);
  ttsAudioEl.pause();
  try { URL.revokeObjectURL(ttsActiveUrl || ttsAudioEl.src); } catch {}
  ttsAudioEl = null;
  ttsActiveUrl = '';
  ttsPlaying = false;
  ttsActiveVoiceTurnId = null;
  setFastVoiceState('interrupted', { reason: detail.reason || 'stop' });
};

// Called by voice-panel on impact noise: duck TTS volume without stopping
window.duckTTS = (detail = {}) => {
  if (ttsAudioEl) ttsAudioEl.volume = detail.strong ? 0.03 : 0.15;
  setFastVoiceState('ducking', { strong: !!detail.strong });
};

// Called by voice-panel after confirming noise: restore original volume
window.unduckTTS = () => {
  if (ttsAudioEl) ttsAudioEl.volume = 1.0;
  if (ttsAudioEl) setFastVoiceState('speaking');
};

// Called by voice-panel on false-positive noise: resume TTS from interruption point and restore chat
window.resumeTTSIfNoSpeech = () => {
  const voiceTurnId = ttsActiveVoiceTurnId || ttsQueueVoiceTurnId || null;
  const text = ttsInterruptedRemaining;
  ttsInterruptedRemaining = '';
  if (!text) return;
  // Cancel the pending DB write and restore chat UI
  if (ttsInterruptionDbTimer) { clearTimeout(ttsInterruptionDbTimer); ttsInterruptionDbTimer = null; }
  if (ttsInterruptionApplied && ttsInterruptedOriginalContent) {
    updateLastJarvisMsg(ttsInterruptedOriginalContent);
  }
  ttsInterruptionApplied = false;
  ttsInterruptedOriginalContent = '';
  playTTSReply(text, { voiceTurnId });
};

async function fetchTtsAudioUrl(item, generation) {
  const text = typeof item === 'string' ? item : item.text;
  const voiceTurnId = typeof item === 'string' ? ttsQueueVoiceTurnId : item.voiceTurnId;
  if (!text || generation !== ttsQueueGeneration || !isCurrentTtsVoiceTurn(voiceTurnId)) return null;
  const controller = new AbortController();
  ttsPrefetchAbortController = controller;
  const resp = await fetch(`${API}/tts/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: controller.signal,
  });
  if (generation !== ttsQueueGeneration || !isCurrentTtsVoiceTurn(voiceTurnId)) return null;
  if (!resp.ok) {
    let errMsg = `HTTP ${resp.status}`;
    try { const j = await resp.json(); errMsg = j.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  const blob = await resp.blob();
  if (generation !== ttsQueueGeneration || !isCurrentTtsVoiceTurn(voiceTurnId)) return null;
  const url = URL.createObjectURL(blob);
  return { text, voiceTurnId, url };
}

function prefetchNextTtsSegment(generation) {
  if (ttsPrefetch || ttsPrefetchAbortController || generation !== ttsQueueGeneration) return;
  const next = ttsQueue[0];
  if (!next) return;
  ttsPrefetch = { pending: true, promise: fetchTtsAudioUrl(next, generation)
    .then(result => { ttsPrefetch = result; return result; })
    .catch(err => {
      if (err?.name !== 'AbortError') console.warn('[TTS prefetch]', err?.message || err);
      ttsPrefetch = null;
      return null;
    })
    .finally(() => { ttsPrefetchAbortController = null; }) };
}

async function playNextTtsSegment(generation) {
  if (ttsPlaying || generation !== ttsQueueGeneration) return;
  let item = ttsQueue.shift();
  if (!item) {
    ttsCurrentText = '';
    ttsActiveVoiceTurnId = null;
    ttsQueueVoiceTurnId = null;
    setFastVoiceState('listening');
    window.bailongmaVoice?.resumeAfterMedia?.();
    return;
  }

  const text = typeof item === 'string' ? item : item.text;
  const voiceTurnId = typeof item === 'string' ? ttsQueueVoiceTurnId : item.voiceTurnId;
  if (!isCurrentTtsVoiceTurn(voiceTurnId)) {
    playNextTtsSegment(generation);
    return;
  }

  ttsPlaying = true;
  ttsActiveVoiceTurnId = voiceTurnId || null;
  ttsCurrentText = text;
  setFastVoiceState('tts_fetch', { text });
  try {
    let audio = null;
    if (ttsPrefetch?.pending) audio = await ttsPrefetch.promise;
    else if (ttsPrefetch && ttsPrefetch.text === text && ttsPrefetch.voiceTurnId === voiceTurnId) audio = ttsPrefetch;
    ttsPrefetch = null;

    if (!audio) {
      ttsAbortController = new AbortController();
      const resp = await fetch(`${API}/tts/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ttsAbortController.signal,
      });
      if (generation !== ttsQueueGeneration || !isCurrentTtsVoiceTurn(voiceTurnId)) return;
      if (!resp.ok) {
        let errMsg = `HTTP ${resp.status}`;
        try { const j = await resp.json(); errMsg = j.error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const blob = await resp.blob();
      if (generation !== ttsQueueGeneration || !isCurrentTtsVoiceTurn(voiceTurnId)) return;
      audio = { text, voiceTurnId, url: URL.createObjectURL(blob) };
    }

    if (!audio?.url || generation !== ttsQueueGeneration || !isCurrentTtsVoiceTurn(voiceTurnId)) return;
    const url = audio.url;
    ttsActiveUrl = url;
    if (ttsAudioEl) { ttsAudioEl.pause(); try { URL.revokeObjectURL(ttsAudioEl.src); } catch {} }
    ttsAudioEl = new Audio(url);
    ttsAudioEl.preload = 'auto';
    ttsAudioEl.volume = 1.0;
    window.bailongmaVoice?.suspendForTTS?.(voiceTurnId || null);
    setFastVoiceState('speaking', { text });
    prefetchNextTtsSegment(generation);
    ttsAudioEl.onended = () => {
      try { URL.revokeObjectURL(url); } catch {}
      if (ttsActiveUrl === url) ttsActiveUrl = '';
      ttsAudioEl = null;
      ttsPlaying = false;
      ttsActiveVoiceTurnId = null;
      if (generation === ttsQueueGeneration) playNextTtsSegment(generation);
    };
    ttsAudioEl.onerror = () => {
      try { URL.revokeObjectURL(url); } catch {}
      if (ttsActiveUrl === url) ttsActiveUrl = '';
      ttsAudioEl = null;
      ttsPlaying = false;
      ttsActiveVoiceTurnId = null;
      if (generation === ttsQueueGeneration) playNextTtsSegment(generation);
    };
    await ttsAudioEl.play();
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[TTS stable]', err?.message || err);
    ttsPlaying = false;
    ttsAudioEl = null;
    ttsActiveVoiceTurnId = null;
    ttsActiveUrl = '';
    if (generation === ttsQueueGeneration) playNextTtsSegment(generation);
  } finally {
    ttsAbortController = null;
  }
}

async function playTTSReply(text, options = {}) {
  const voiceTurnId = options.voiceTurnId || null;
  if (voiceTurnId) window.bailongmaVoice?.syncTurn?.(voiceTurnId, 'speaking_pending');
  if (!isCurrentTtsVoiceTurn(voiceTurnId)) {
    console.warn('[TTS stable] dropped stale tts_reply', { voiceTurnId, active: window.bailongmaVoice?.getTurnId?.() });
    return;
  }
  const plain = normalizeTTSPlainText(text);
  if (!plain) return;
  const items = [{ text: plain, voiceTurnId }];

  // 用户要求：语音合成不要分段。每次回复整段一次性合成播放，保持语调连续。
  clearTtsQueue();
  ttsInterruptedRemaining = '';
  ttsInterruptionApplied = false;
  ttsInterruptedOriginalContent = '';
  ttsQueue = items;
  ttsQueueVoiceTurnId = voiceTurnId || null;
  const generation = ttsQueueGeneration;
  setFastVoiceState('queued', { count: 1, voiceTurnId });
  playNextTtsSegment(generation);
}

resetViewBtn.addEventListener("click", resetZoom);

document.querySelectorAll(".panel, .console, .theme-switcher, .reset-view").forEach(el => {
  el.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
});

physicsControl.addEventListener("wheel", event => event.stopPropagation(), { passive: true });

window.addEventListener("resize", () => {
  W = window.innerWidth;
  H = window.innerHeight;
  svg.attr("width", W).attr("height", H);
  if (!MEMORY_GRAPH_ENABLED || !sim) return;
  sim.force("center", d3.forceCenter(W / 2, H / 2 - 10))
     .force("x", d3.forceX(W / 2))
     .force("y", d3.forceY(H / 2 - 10))
     .force("radial", d3.forceRadial(180, W / 2, H / 2 - 10));
  updateSimulationForces();
  sim.alpha(5).restart();
});

let _lastVisualRefresh = 0;
d3.timer(() => {
  if (!MEMORY_GRAPH_ENABLED) return true;
  if (glowSet.size === 0 && usePulseSet.size === 0) return;
  const now = Date.now();
  if (now - _lastVisualRefresh < 48) return;
  _lastVisualRefresh = now;
  refreshNodeVisuals();
});

function extractPersonCardQuery(text = "") {
  const value = String(text || "").trim();
  if (!value || /热点|热搜/.test(value)) return "";

  const patterns = [
    /^谁是\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·.\-\s]{1,40})[？?]?$/,
    /^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·.\-\s]{1,40})\s*(?:是谁|是誰|是什么人|是什麼人|是干嘛的|简介|介绍|资料|履历)[？?]?$/,
    /^(?:介绍一下|介绍下|查一下|了解一下|认识一下)\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·.\-\s]{1,40})[？?]?$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    const name = match?.[1]?.trim();
    if (name) return name.replace(/[，,。.!！：:；;]+$/g, "").trim();
  }
  return "";
}

setAgentName(DEFAULT_AGENT_NAME);
initUiZoom();
readPhysicsSettings();
updatePhysicsReadout();
refreshThemeColors();
chat = initChat({
  apiBase: API,
  maxHistory: MAX_CHAT_HISTORY,
  activationWarmupKey: ACTIVATION_WARMUP_KEY,
  getAgentName: () => agentName,
  defaultInputPlaceholder,
  onUserMessage: (text) => {
    if (document.body.classList.contains('video-mode') && /(?:关闭|退出|关掉|隐藏|停止).{0,6}(?:视频|影片|播放)|(?:视频|影片).{0,6}(?:关闭|退出|关掉|停止)/.test(text)) {
      window.dispatchEvent(new CustomEvent('bailongma:media', { detail: { mode: 'video', action: 'close' } }));
      return false;
    }
    if (document.body.classList.contains('hotspot-mode') && /关闭|退出|关掉|隐藏/.test(text)) {
      toggleHotspot();
      return false;
    }
    if (document.body.classList.contains('person-card-mode') && /关闭|退出|关掉|隐藏/.test(text)) {
      setPersonCardMode(false, { source: 'chat_input' });
      return;
    }
    // 本地直达：实时舆情/热点平台是内置面板，不应该交给大模型联网搜索。
    if (/(?:实时)?舆情(?:监测|平台|界面)?|热点(?:平台|面板|模式)?|热搜/.test(text)) {
      if (!document.body.classList.contains('hotspot-mode')) toggleHotspot('local_command');
      return false;
    }
    const personQuery = extractPersonCardQuery(text);
    if (personQuery) {
      showPersonCardByName(personQuery, { source: 'chat_input' });
    }
  },
});
chat.applyActivationWarmupLock();
if (MEMORY_GRAPH_ENABLED) {
  if (graphEl) graphEl.style.display = "block";
  loadMemories();
  setInterval(() => {
    loadMemories();
  }, 5 * 60 * 1000);
}
connectSSE();
loadAgentProfile();
initPersonCard();
initDocPanel().catch((err) => console.warn('[DocPanel] init failed:', err));
chat.restoreChatHistory();
chat.unlockAudioOnFirstGesture();

bootstrapACUI();
initPanelCollapse();
initWechatPopup();

// ── TTS settings panel init ───────────────────────────────────────────────────
function initTTSSettings() {
  const providerSel = document.getElementById("tts-provider-select");
  const voiceSel    = document.getElementById("tts-voice-select");
  const testBtn     = document.getElementById("tts-test-btn");
  const testStatus  = document.getElementById("tts-test-status");
  if (!providerSel) return;

  let allVoices = {};

  const credSections = {
    doubao:     document.getElementById("tts-creds-doubao"),
    minimax:    document.getElementById("tts-creds-minimax"),
    openai:     document.getElementById("tts-creds-openai"),
    elevenlabs: document.getElementById("tts-creds-elevenlabs"),
    volcano:    document.getElementById("tts-creds-volcano"),
  };

  function showCredSection(provider) {
    Object.entries(credSections).forEach(([k, el]) => {
      if (el) el.style.display = k === provider ? "" : "none";
    });
  }

  function updateVoiceOptions(provider, savedId) {
    if (!voiceSel) return;
    const voices = allVoices[provider] || [];
    voiceSel.innerHTML = voices.map(v =>
      `<option value="${v.id}">${v.label}</option>`
    ).join("");
    if (savedId && voices.some(v => v.id === savedId)) {
      voiceSel.value = savedId;
    }
  }

  providerSel.addEventListener("change", () => {
    showCredSection(providerSel.value);
    updateVoiceOptions(providerSel.value);
  });

  fetch(`${API}/settings/tts`).then(r => r.json()).then(({ tts, voices }) => {
    if (voices) allVoices = voices;
    const provider = tts?.ttsProvider || "doubao";
    if (tts?.ttsProvider) providerSel.value = tts.ttsProvider;
    else providerSel.value = "doubao";
    updateVoiceOptions(provider, tts?.ttsVoiceId);
    const appidEl = document.getElementById("tts-volcano-appid");
    if (appidEl && tts?.volcanoAppId?.value) appidEl.value = tts.volcanoAppId.value;
    const baseurlEl = document.getElementById("tts-openai-baseurl");
    if (baseurlEl && tts?.openaiTtsBaseURL) baseurlEl.value = tts.openaiTtsBaseURL;
    showCredSection(provider);
  }).catch(() => {});

  showCredSection(providerSel.value);

  const origSaveBtn = document.getElementById("settings-save-voice");
  if (origSaveBtn) {
    origSaveBtn.addEventListener("click", () => {
      const ttsBody = { ttsProvider: providerSel.value };
      const voiceId  = voiceSel?.value?.trim();
      if (voiceId) ttsBody.ttsVoiceId = voiceId;
      const minimaxKey = document.getElementById("tts-minimax-key")?.value?.trim();
      if (minimaxKey) ttsBody.minimaxKey = minimaxKey;
      const doubaoKey = document.getElementById("tts-doubao-key")?.value?.trim();
      if (doubaoKey) ttsBody.doubaoKey = doubaoKey;
      const openaiKey = document.getElementById("tts-openai-key")?.value?.trim();
      if (openaiKey) ttsBody.openaiTtsKey = openaiKey;
      const baseURL = document.getElementById("tts-openai-baseurl")?.value?.trim();
      if (baseURL) ttsBody.openaiTtsBaseURL = baseURL;
      const elevenKey = document.getElementById("tts-elevenlabs-key")?.value?.trim();
      if (elevenKey) ttsBody.elevenLabsKey = elevenKey;
      const volcanoAppId = document.getElementById("tts-volcano-appid")?.value?.trim();
      if (volcanoAppId) ttsBody.volcanoAppId = volcanoAppId;
      const volcanoToken = document.getElementById("tts-volcano-token")?.value?.trim();
      if (volcanoToken) ttsBody.volcanoToken = volcanoToken;

      fetch(`${API}/settings/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ttsBody),
      }).then(() => {
        ["tts-minimax-key", "tts-doubao-key", "tts-openai-key", "tts-elevenlabs-key", "tts-volcano-token"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
      }).catch(() => {});
    });
  }

  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      if (testStatus) testStatus.textContent = "保存配置中…";
      try {
        const preBody = { ttsProvider: providerSel.value };
        const currentVoice = voiceSel?.value?.trim();
        if (currentVoice) preBody.ttsVoiceId = currentVoice;
        const minimaxKey2 = document.getElementById("tts-minimax-key")?.value?.trim();
        if (minimaxKey2) preBody.minimaxKey = minimaxKey2;
        const doubaoKey = document.getElementById("tts-doubao-key")?.value?.trim();
        if (doubaoKey) preBody.doubaoKey = doubaoKey;
        const openaiKey = document.getElementById("tts-openai-key")?.value?.trim();
        if (openaiKey) preBody.openaiTtsKey = openaiKey;
        const elevenKey = document.getElementById("tts-elevenlabs-key")?.value?.trim();
        if (elevenKey) preBody.elevenLabsKey = elevenKey;
        const volcanoAppId = document.getElementById("tts-volcano-appid")?.value?.trim();
        if (volcanoAppId) preBody.volcanoAppId = volcanoAppId;
        const volcanoToken = document.getElementById("tts-volcano-token")?.value?.trim();
        if (volcanoToken) preBody.volcanoToken = volcanoToken;
        await fetch(`${API}/settings/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preBody),
        });
        if (testStatus) testStatus.textContent = "合成中…";
        const ttsResp = await fetch(`${API}/tts/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "你好，这是一段语音合成测试，听起来清晰自然吗？" }),
        });
        if (!ttsResp.ok) {
          let errMsg = `合成失败（HTTP ${ttsResp.status}）`;
          try { const j = await ttsResp.json(); errMsg = j.error || errMsg; } catch {}
          if (testStatus) testStatus.textContent = errMsg;
          return;
        }
        const ttsBlob = await ttsResp.blob();
        if (ttsBlob.size === 0) {
          if (testStatus) testStatus.textContent = "合成失败：接口返回空数据，请检查 API Key 和账户配置。";
          return;
        }
        const ttsUrl = URL.createObjectURL(ttsBlob);
        const ttsAudio = new Audio(ttsUrl);
        ttsAudio.onended = () => { URL.revokeObjectURL(ttsUrl); if (testStatus) testStatus.textContent = ""; };
        ttsAudio.onerror = () => { URL.revokeObjectURL(ttsUrl); if (testStatus) testStatus.textContent = "播放失败"; };
        await ttsAudio.play();
        if (testStatus) testStatus.textContent = "播放中";
        setTimeout(() => { if (testStatus && testStatus.textContent === "播放中") testStatus.textContent = ""; }, 8000);
      } catch {
        if (testStatus) testStatus.textContent = "失败 — 请检查配置和 API Key";
      } finally {
        testBtn.disabled = false;
      }
    });
  }
}

// ── Settings modal ──
(function initSettings() {
  const settingsBtn     = document.getElementById("settings-btn");
  const overlay         = document.getElementById("settings-overlay");
  const closeBtn        = document.getElementById("settings-close");
  const providerSelect  = document.getElementById("settings-provider-select");
  const modelSelect     = document.getElementById("settings-model-select");
  const llmKeyInput     = document.getElementById("settings-llm-key");
  const saveLlmBtn      = document.getElementById("settings-save-llm");
  const saveLlmCurrentBtn = document.getElementById("settings-save-llm-current");
  const llmFeedback     = document.getElementById("settings-llm-feedback");
  const llmProfileNameInput = document.getElementById("settings-llm-profile-name");
  const llmEditingIdInput = document.getElementById("settings-llm-editing-id");
  const llmCurrentProfile = document.getElementById("settings-llm-current-profile");
  const llmPoolList = document.getElementById("settings-llm-pool-list");
  const llmSummaryCurrent = document.getElementById("settings-llm-summary-current");
  const llmSummaryTotal = document.getElementById("settings-llm-summary-total");
  const llmSummaryOk = document.getElementById("settings-llm-summary-ok");
  const llmSummaryBad = document.getElementById("settings-llm-summary-bad");
  const llmSummaryLast = document.getElementById("settings-llm-summary-last");
  const llmBatchSelectAllBtn = document.getElementById("settings-llm-batch-all");
  const llmBatchClearBtn = document.getElementById("settings-llm-batch-clear");
  const llmBatchTestSelectedBtn = document.getElementById("settings-llm-test-selected");
  const llmBatchTestAllBtn = document.getElementById("settings-llm-test-all");
  const llmBatchCount = document.getElementById("settings-llm-batch-count");
  const llmBatchResult = document.getElementById("settings-llm-batch-result");
  const llmFailoverEnabled = document.getElementById("settings-llm-failover-enabled");
  const llmFailoverCooldown = document.getElementById("settings-llm-failover-cooldown");
  const llmFailoverAttempts = document.getElementById("settings-llm-failover-attempts");
  const saveLlmFailoverBtn = document.getElementById("settings-save-llm-failover");
  const llmFailoverFeedback = document.getElementById("settings-llm-failover-feedback");
  const llmRoutingGlobal = document.getElementById("settings-llm-routing-global");
  const llmRoutingCount = document.getElementById("settings-llm-routing-count");
  const llmRoutingList = document.getElementById("settings-llm-routing-list");
  const saveLlmRoutingBtn = document.getElementById("settings-save-llm-routing");
  const llmRoutingFeedback = document.getElementById("settings-llm-routing-feedback");
  const llmMonitorEnabled = document.getElementById("settings-llm-monitor-enabled");
  const llmMonitorInterval = document.getElementById("settings-llm-monitor-interval");
  const llmMonitorMode = document.getElementById("settings-llm-monitor-mode");
  const llmMonitorStatus = document.getElementById("settings-llm-monitor-status");
  const llmMonitorProfileList = document.getElementById("settings-llm-monitor-profile-list");
  const llmMonitorProfileCount = document.getElementById("settings-llm-monitor-profile-count");
  const llmMonitorGroupList = document.getElementById("settings-llm-monitor-group-list");
  const llmMonitorGroupCount = document.getElementById("settings-llm-monitor-group-count");
  const llmMonitorResult = document.getElementById("settings-llm-monitor-result");
  const saveLlmMonitorBtn = document.getElementById("settings-save-llm-monitor");
  const testLlmMonitorBtn = document.getElementById("settings-test-llm-monitor");
  const notifyLlmMonitorBtn = document.getElementById("settings-notify-llm-monitor");
  const llmMonitorFeedback = document.getElementById("settings-llm-monitor-feedback");
  const tempSlider      = document.getElementById("settings-temperature");
  const tempVal         = document.getElementById("settings-temperature-val");
  const saveTempBtn     = document.getElementById("settings-save-temperature");
  const tempFeedback    = document.getElementById("settings-temperature-feedback");
  const minimaxKeyInput = document.getElementById("settings-minimax-key");
  const saveMinimaxBtn  = document.getElementById("settings-save-minimax");
  const minimaxFeedback = document.getElementById("settings-minimax-feedback");
  const saveSocialBtn   = document.getElementById("settings-save-social");
  const socialFeedback  = document.getElementById("settings-social-feedback");
  const saveVoiceBtn    = document.getElementById("settings-save-voice");
  const voiceFeedback   = document.getElementById("settings-voice-feedback");
  const voiceThreshSlider = document.getElementById("settings-voice-threshold");
  const voiceThreshVal    = document.getElementById("settings-voice-threshold-val");
  const wechatyDutyStatus = document.getElementById("wechaty-duty-status");
  const wechatyDutyEnabled = document.getElementById("wechaty-duty-enabled");
  const wechatyStartBtn = document.getElementById("wechaty-start-btn");
  const wechatyReloginBtn = document.getElementById("wechaty-relogin-btn");
  const wechatyRefreshRoomsBtn = document.getElementById("wechaty-refresh-rooms-btn");
  const wechatySaveGroupsBtn = document.getElementById("wechaty-save-groups-btn");
  const wechatyRoomList = document.getElementById("wechaty-room-list");
  const wechatyRoomFilter = document.getElementById("wechaty-room-filter");
  const wechatySelectedCount = document.getElementById("wechaty-selected-count");
  const wechatyDutyFeedback = document.getElementById("wechaty-duty-feedback");
  const wechatyLoginSub = document.getElementById("wechaty-login-sub");
  const wechatyConcurrencyLimit = document.getElementById("wechaty-concurrency-limit");
  const wechatySaveConcurrencyBtn = document.getElementById("wechaty-save-concurrency-btn");
  const wechatyConcurrencyStatus = document.getElementById("wechaty-concurrency-status");
  const wechatyAmbientStatus = document.getElementById("wechaty-ambient-status");
  const wechatyAmbientLevels = document.getElementById("wechaty-ambient-levels");
  const wechatyAmbientSummary = document.getElementById("wechaty-ambient-summary");
  const wechatyAmbientTtl = document.getElementById("wechaty-ambient-ttl");
  const wechatyAmbientProfileEditor = document.getElementById("wechaty-ambient-profile-editor");
  const wechatyAmbientRules = document.getElementById("wechaty-ambient-rules");
  const wechatyAmbientLast = document.getElementById("wechaty-ambient-last");
  const wechatyAmbientImageLast = document.getElementById("wechaty-ambient-image-last");
  const wechatySaveAmbientBtn = document.getElementById("wechaty-save-ambient-btn");
  const wechatyResetAmbientBtn = document.getElementById("wechaty-reset-ambient-btn");
  const wechatyPersonaPrompt = document.getElementById("wechaty-persona-prompt");
  const wechatyPersonaPresets = document.getElementById("wechaty-persona-presets");
  const wechatyPersonaActive = document.getElementById("wechaty-persona-active");
  const wechatyPersonaCurrentName = document.getElementById("wechaty-persona-current-name");
  const wechatyPersonaCurrentState = document.getElementById("wechaty-persona-current-state");
  const wechatyPersonaResetBtn = document.getElementById("wechaty-persona-reset-btn");
  const wechatySavePersonaBtn = document.getElementById("wechaty-save-persona-btn");
  const wechatyPersonaFeedback = document.getElementById("wechaty-persona-feedback");
  const wechatyAdminEnabled = document.getElementById("wechaty-admin-enabled");
  const wechatyAdminIds = document.getElementById("wechaty-admin-ids");
  const wechatyAdminSearch = document.getElementById("wechaty-admin-search");
  const wechatySaveAdminsBtn = document.getElementById("wechaty-save-admins-btn");
  const wechatyRefreshAdminMembersBtn = document.getElementById("wechaty-refresh-admin-members-btn");
  const wechatyAdminMembers = document.getElementById("wechaty-admin-members");
  const wechatyAdminFeedback = document.getElementById("wechaty-admin-feedback");
  const wechatyBlockedIds = document.getElementById("wechaty-blocked-ids");
  const wechatyBlockedSearch = document.getElementById("wechaty-blocked-search");
  const wechatySaveBlockedBtn = document.getElementById("wechaty-save-blocked-btn");
  const wechatyBlockedMembers = document.getElementById("wechaty-blocked-members");
  const wechatyBlockedFeedback = document.getElementById("wechaty-blocked-feedback");
  const wechatyRefreshMemoryBtn = document.getElementById("wechaty-refresh-memory-btn");
  const wechatyClearGroupMemoryBtn = document.getElementById("wechaty-clear-group-memory-btn");
  const wechatyMemoryGroups = document.getElementById("wechaty-memory-groups");
  const wechatyMemoryTitle = document.getElementById("wechaty-memory-title");
  const wechatyMemoryStat = document.getElementById("wechaty-memory-stat");
  const wechatyManualMemoryInput = document.getElementById("wechaty-manual-memory-input");
  const wechatyAddMemoryBtn = document.getElementById("wechaty-add-memory-btn");
  const wechatyMemoryPreview = document.getElementById("wechaty-memory-preview");
  const wechatyRefreshMemberMemoryBtn = document.getElementById("wechaty-refresh-member-memory-btn");
  const wechatyOpenMemberMemorySpaceBtn = document.getElementById("wechaty-open-member-memory-space-btn");
  const wechatyMemberMemoryManager = document.getElementById("wechaty-member-memory-manager");
  const wechatyMemberMemorySearch = document.getElementById("wechaty-member-memory-search");
  const wechatyMemberMemoryMembers = document.getElementById("wechaty-member-memory-members");
  const wechatyMemberMemoryTitle = document.getElementById("wechaty-member-memory-title");
  const wechatyMemberMemoryStat = document.getElementById("wechaty-member-memory-stat");
  const wechatyMemberMemoryInput = document.getElementById("wechaty-member-memory-input");
  const wechatyAddMemberMemoryBtn = document.getElementById("wechaty-add-member-memory-btn");
  const wechatyMemberMemoryPreview = document.getElementById("wechaty-member-memory-preview");
  const wechatyDigestEnabled = document.getElementById("wechaty-digest-enabled");
  const wechatyDigestIntervalEnabled = document.getElementById("wechaty-digest-interval-enabled");
  const wechatyDigestInterval = document.getElementById("wechaty-digest-interval");
  const wechatyDigestDailyEnabled = document.getElementById("wechaty-digest-daily-enabled");
  const wechatyDigestDailyTime = document.getElementById("wechaty-digest-daily-time");
  const wechatyDigestGroupList = document.getElementById("wechaty-digest-group-list");
  const wechatyDigestGroupCount = document.getElementById("wechaty-digest-group-count");
  const wechatyHotspotEnabled = document.getElementById("wechaty-hotspot-enabled");
  const wechatyHotspotInterval = document.getElementById("wechaty-hotspot-interval");
  const wechatyHotspotMode = document.getElementById("wechaty-hotspot-mode");
  const wechatyHotspotTopN = document.getElementById("wechaty-hotspot-topn");
  const wechatyHotspotRankRise = document.getElementById("wechaty-hotspot-rank-rise");
  const wechatyHotspotDedupeHours = document.getElementById("wechaty-hotspot-dedupe-hours");
  const wechatyHotspotKeywords = document.getElementById("wechaty-hotspot-keywords");
  const wechatyHotspotGroupList = document.getElementById("wechaty-hotspot-group-list");
  const wechatyHotspotGroupCount = document.getElementById("wechaty-hotspot-group-count");
  const wechatyHotspotStatus = document.getElementById("wechaty-hotspot-status");
  const wechatyHotspotResult = document.getElementById("wechaty-hotspot-result");
  const wechatySaveHotspotBtn = document.getElementById("wechaty-save-hotspot-btn");
  const wechatyHotspotCheckBtn = document.getElementById("wechaty-hotspot-check-btn");
  const wechatyHotspotNotifyBtn = document.getElementById("wechaty-hotspot-notify-btn");
  const wechatyHotspotFeedback = document.getElementById("wechaty-hotspot-feedback");
  const wechatyRankMessage = document.getElementById("wechaty-rank-message");
  const wechatyRankImage = document.getElementById("wechaty-rank-image");
  const wechatyRankEmoji = document.getElementById("wechaty-rank-emoji");
  const wechatyRankLink = document.getElementById("wechaty-rank-link");
  const wechatyRankBrag = document.getElementById("wechaty-rank-brag");
  const wechatyReportTemplate = document.getElementById("wechaty-report-template");
  const wechatyReportPreview = document.getElementById("wechaty-report-preview");
  const wechatySaveDigestBtn = document.getElementById("wechaty-save-digest-btn");
  const wechatyRefreshStatsBtn = document.getElementById("wechaty-refresh-stats-btn");
  const wechatyStatsViewMode = document.getElementById("wechaty-stats-view-mode");
  const wechatyStatsScopeLabel = document.getElementById("wechaty-stats-scope-label");
  const wechatySendDigestBtn = document.getElementById("wechaty-send-digest-btn");
  const wechatyDigestFeedback = document.getElementById("wechaty-digest-feedback");
  const wechatyStatsCards = document.getElementById("wechaty-stats-cards");
  const wechatyLeaderboards = document.getElementById("wechaty-leaderboards");
  const wechatyStatsRecent = document.getElementById("wechaty-stats-recent");
  const wechatyRecordsGroup = document.getElementById("wechaty-records-group");
  const wechatyRecordsFrom = document.getElementById("wechaty-records-from");
  const wechatyRecordsTo = document.getElementById("wechaty-records-to");
  const wechatyRecordsType = document.getElementById("wechaty-records-type");
  const wechatyRecordsQuery = document.getElementById("wechaty-records-query");
  const wechatyRecordsRefreshBtn = document.getElementById("wechaty-records-refresh-btn");
  const wechatyRecordsTodayBtn = document.getElementById("wechaty-records-today-btn");
  const wechatyRecordsRefreshNamesBtn = document.getElementById("wechaty-records-refresh-names-btn");
  const wechatyRecordsExportJsonBtn = document.getElementById("wechaty-records-export-json-btn");
  const wechatyRecordsExportCsvBtn = document.getElementById("wechaty-records-export-csv-btn");
  const wechatyRecordsImportFile = document.getElementById("wechaty-records-import-file");
  const wechatyRecordsSummary = document.getElementById("wechaty-records-summary");
  const wechatyRecordsList = document.getElementById("wechaty-records-list");
  const wechatyRecordsMoreBtn = document.getElementById("wechaty-records-more-btn");
  const wechatyQrArea = document.getElementById("wechaty-qr-area");
  const wechatyQrImg = document.getElementById("wechaty-qr-img");
  const wechatyOfflineQrNotifyEnabled = document.getElementById("wechaty-offline-qr-notify-enabled");
  const wechatyOfflineQrNotifyAutoRelogin = document.getElementById("wechaty-offline-qr-notify-autorelogin");
  const wechatyOfflineQrNotifyCooldown = document.getElementById("wechaty-offline-qr-notify-cooldown");
  const wechatyOfflineQrNotifyStatus = document.getElementById("wechaty-offline-qr-notify-status");
  const wechatyOfflineQrNotifyTestBtn = document.getElementById("wechaty-offline-qr-notify-test-btn");
  const wechatyMemeEnabled = document.getElementById("wechaty-meme-enabled");
  const wechatyMemeProvider = document.getElementById("wechaty-meme-provider");
  const wechatyMemeMax = document.getElementById("wechaty-meme-max");
  const wechatyMemeCooldown = document.getElementById("wechaty-meme-cooldown");
  const wechatyMemeTestQuery = document.getElementById("wechaty-meme-test-query");
  const wechatyTestMemeBtn = document.getElementById("wechaty-test-meme-btn");
  const wechatySaveMemeBtn = document.getElementById("wechaty-save-meme-btn");
  const wechatyMemePreview = document.getElementById("wechaty-meme-preview");
  const wechatyMemeFeedback = document.getElementById("wechaty-meme-feedback");
  const skillImageStatus = document.getElementById("skill-image-status");
  const skillImageEnabled = document.getElementById("skill-image-enabled");
  const skillImageFailover = document.getElementById("skill-image-failover");
  const skillImageBaseUrl = document.getElementById("skill-image-baseurl");
  const skillImageModel = document.getElementById("skill-image-model");
  const skillImageKey = document.getElementById("skill-image-key");
  const skillImageLimit = document.getElementById("skill-image-limit");
  const skillImageTimeout = document.getElementById("skill-image-timeout");
  const skillImageDefaultQuality = document.getElementById("skill-image-default-quality");
  const skillImageHighQuality = document.getElementById("skill-image-high-quality");
  const skillImageSaveBtn = document.getElementById("skill-image-save-btn");
  const skillImageAddChannelBtn = document.getElementById("skill-image-add-channel-btn");
  const skillImageChannelList = document.getElementById("skill-image-channel-list");
  const skillImageFeedback = document.getElementById("skill-image-feedback");
  const skillVisionStatus = document.getElementById("skill-vision-status");
  const skillVisionEnabled = document.getElementById("skill-vision-enabled");
  const skillVisionFailover = document.getElementById("skill-vision-failover");
  const skillVisionPreferCurrent = document.getElementById("skill-vision-prefer-current");
  const skillVisionBaseUrl = document.getElementById("skill-vision-baseurl");
  const skillVisionModel = document.getElementById("skill-vision-model");
  const skillVisionKey = document.getElementById("skill-vision-key");
  const skillVisionTimeout = document.getElementById("skill-vision-timeout");
  const skillVisionSaveBtn = document.getElementById("skill-vision-save-btn");
  const skillVisionAddChannelBtn = document.getElementById("skill-vision-add-channel-btn");
  const skillVisionChannelList = document.getElementById("skill-vision-channel-list");
  const skillVisionRefreshBtn = document.getElementById("skill-vision-refresh-btn");
  const skillVisionFeedback = document.getElementById("skill-vision-feedback");
  const skillVisionCounts = document.getElementById("skill-vision-counts");
  const skillVideoStatus = document.getElementById("skill-video-status");
  const skillVideoEnabled = document.getElementById("skill-video-enabled");
  const skillVideoFailover = document.getElementById("skill-video-failover");
  const skillVideoBaseUrl = document.getElementById("skill-video-baseurl");
  const skillVideoModel = document.getElementById("skill-video-model");
  const skillVideoKey = document.getElementById("skill-video-key");
  const skillVideoTimeout = document.getElementById("skill-video-timeout");
  const skillVideoMaxMb = document.getElementById("skill-video-max-mb");
  const skillVideoSaveBtn = document.getElementById("skill-video-save-btn");
  const skillVideoAddChannelBtn = document.getElementById("skill-video-add-channel-btn");
  const skillVideoChannelList = document.getElementById("skill-video-channel-list");
  const skillVideoRefreshBtn = document.getElementById("skill-video-refresh-btn");
  const skillVideoFeedback = document.getElementById("skill-video-feedback");
  const skillVideoCounts = document.getElementById("skill-video-counts");
  const honchoEnabled = document.getElementById("honcho-enabled");
  const honchoEnvironment = document.getElementById("honcho-environment");
  const honchoBaseUrl = document.getElementById("honcho-baseurl");
  const honchoApiKey = document.getElementById("honcho-apikey");
  const honchoAppId = document.getElementById("honcho-appid");
  const honchoAppName = document.getElementById("honcho-appname");
  const honchoSaveBtn = document.getElementById("honcho-save-btn");
  const honchoFeedback = document.getElementById("honcho-feedback");
  const honchoStatus = document.getElementById("wechaty-honcho-status");
  const guardList = document.getElementById("wechaty-guard-list");
  const dbTotalSize = document.getElementById("db-total-size");
  const dbPathHint = document.getElementById("db-path-hint");
  const dbHealthGrid = document.getElementById("db-health-grid");
  const dbOverviewGrid = document.getElementById("db-overview-grid");
  const dbMemberPanel = document.getElementById("db-member-panel");
  const dbTableList = document.getElementById("db-table-list");
  const dbRefreshBtn = document.getElementById("db-refresh-btn");
  const dbVectorBackfillBtn = document.getElementById("db-vector-backfill-btn");
  const dbMemoryExtractBtn = document.getElementById("db-memory-extract-btn");
  const dbHonchoSyncBtn = document.getElementById("db-honcho-sync-btn");
  const dbExportAllBtn = document.getElementById("db-export-all-btn");
  const dbImportFile = document.getElementById("db-import-file");
  const dbSearchInput = document.getElementById("db-search-input");
  const dbSearchBtn = document.getElementById("db-search-btn");
  const dbSearchResults = document.getElementById("db-search-results");
  const dbArchiveEnabled = document.getElementById("db-archive-enabled");
  const dbArchiveRecordText = document.getElementById("db-archive-record-text");
  const dbArchiveRecordMedia = document.getElementById("db-archive-record-media");
  const dbArchiveParseImages = document.getElementById("db-archive-parse-images");
  const dbArchiveDefaultFree = document.getElementById("db-archive-default-free");
  const dbArchiveSearch = document.getElementById("db-archive-search");
  const dbArchiveChunkSize = document.getElementById("db-archive-chunk-size");
  const dbArchiveChunkOverlap = document.getElementById("db-archive-chunk-overlap");
  const dbArchiveSummary = document.getElementById("db-archive-summary");
  const dbArchiveGroupList = document.getElementById("db-archive-group-list");
  const dbArchiveSyncFreeBtn = document.getElementById("db-archive-sync-free-btn");
  const dbArchiveSaveRecordBtn = document.getElementById("db-archive-save-record-btn");
  const dbArchiveSaveImageBtn = document.getElementById("db-archive-save-image-btn");
  const dbIndexGrid = document.getElementById("db-index-grid");
  const dbIndexRefreshBtn = document.getElementById("db-index-refresh-btn");
  const dbIndexBackfillBtn = document.getElementById("db-index-backfill-btn");
  const dbImageGroup = document.getElementById("db-image-group");
  const dbImageStatus = document.getElementById("db-image-status");
  const dbImageQuery = document.getElementById("db-image-query");
  const dbImageSender = document.getElementById("db-image-sender");
  const dbImageFrom = document.getElementById("db-image-from");
  const dbImageTo = document.getElementById("db-image-to");
  const dbImageRefreshBtn = document.getElementById("db-image-refresh-btn");
  const dbImageProcessBtn = document.getElementById("db-image-process-btn");
  const dbImageSearchBtn = document.getElementById("db-image-search-btn");
  const dbImageResetBtn = document.getElementById("db-image-reset-btn");
  const dbImageProgress = document.getElementById("db-image-progress");
  const dbImageSummary = document.getElementById("db-image-summary");
  const dbImageList = document.getElementById("db-image-list");
  const dbImageMoreBtn = document.getElementById("db-image-more-btn");
  const dbFeedback = document.getElementById("db-feedback");
  const knowledgeImportToggle = document.getElementById("knowledge-import-toggle");
  const knowledgeRefreshBtn = document.getElementById("knowledge-refresh-btn");
  const knowledgeDrawer = document.getElementById("knowledge-drawer");
  const knowledgeDrawerClose = document.getElementById("knowledge-drawer-close");
  const knowledgeFileInput = document.getElementById("knowledge-file-input");
  const knowledgeUrlInput = document.getElementById("knowledge-url-input");
  const knowledgeManualTitle = document.getElementById("knowledge-manual-title");
  const knowledgeManualText = document.getElementById("knowledge-manual-text");
  const knowledgeScope = document.getElementById("knowledge-scope");
  const knowledgeGroupSelect = document.getElementById("knowledge-group-select");
  const knowledgeParseBtn = document.getElementById("knowledge-parse-btn");
  const knowledgeImportFeedback = document.getElementById("knowledge-import-feedback");
  const knowledgePreviewPanel = document.getElementById("knowledge-preview-panel");
  const knowledgePreviewList = document.getElementById("knowledge-preview-list");
  const knowledgeCommitBtn = document.getElementById("knowledge-commit-btn");
  const knowledgeStatusGrid = document.getElementById("knowledge-status-grid");
  const knowledgeSpaceList = document.getElementById("knowledge-space-list");
  const knowledgeFilterPills = document.getElementById("knowledge-filter-pills");
  const knowledgeSearchInput = document.getElementById("knowledge-search-input");
  const knowledgeSourceGrid = document.getElementById("knowledge-source-grid");
  const knowledgeDetail = document.getElementById("knowledge-detail");
  const knowledgeTestGroup = document.getElementById("knowledge-test-group");
  const knowledgeTestQuery = document.getElementById("knowledge-test-query");
  const knowledgeTestBtn = document.getElementById("knowledge-test-btn");
  const knowledgeTestResults = document.getElementById("knowledge-test-results");
  const knowledgeFeedback = document.getElementById("knowledge-feedback");

  if (!settingsBtn || !overlay) return;

  let cachedProviders = null;
  let cachedLLMProfiles = [];
  let cachedActiveLLM = null;
  let cachedLLMFailover = { enabled: true, cooldownSeconds: 180, maxAttempts: 4 };
  let cachedLLMRouting = { globalProfileId: "", globalProfile: null, groupOverrides: [] };
  let cachedLLMRoutingRooms = [];
  let cachedLLMMonitor = { enabled: false, intervalMinutes: 60, notifyMode: "changes", selectedProfileIds: [], selectedGroups: [], notifyMentionsByGroup: {} };
  let cachedLLMMonitorStatus = {};
  let cachedLLMMonitorRooms = [];
  let llmMonitorMentionCache = {};
  let selectedLLMProfileIds = new Set();
  let lastLLMBatchResults = [];
  let llmBatchTesting = false;
  let wechatGroupArchiveConfigCache = {
    enabled: true,
    recordGroupNames: [],
    parseImageGroupNames: [],
    defaultFromFreeReplyGroups: true,
    recordText: true,
    recordMedia: true,
    parseImages: true,
    longMessageChunkSize: 1800,
    longMessageChunkOverlap: 160,
  };
  let dbArchiveRecordNames = new Set();
  let dbArchiveImageNames = new Set();
  let dbArchiveFreeNames = new Set();
  let dbImageOffset = 0;
  let dbImageHasMore = false;
  let dbImageAutoRefreshTimer = null;
  let dbImageLastAutoProcessAt = 0;
  let skillImageChannels = [];
  let skillImageActiveChannelId = "";
  let skillVisionChannels = [];
  let skillVisionActiveChannelId = "";
  let skillVideoChannels = [];
  let skillVideoActiveChannelId = "";
  let memberMemoryExpanded = false;
  let wechatyMemberMemoryLastData = null;
  let wechatyOfflineQrNotifyLastEditAt = 0;
  let wechatyOfflineQrNotifySaveTimer = null;
  let wechatyOfflineQrNotifySaveSeq = 0;

  const BUILTIN_IMAGE_MODELS = [
    { value: "gpt-image-2", label: "gpt-image-2（推荐）" },
    { value: "gpt-image-1", label: "gpt-image-1" },
    { value: "dall-e-3", label: "dall-e-3" },
  ];
  const BUILTIN_VISION_MODELS = [
    { value: "gpt-4o-mini", label: "gpt-4o-mini（快速/推荐）" },
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-5.4", label: "gpt-5.4（当前可用）" },
  ];
  const BUILTIN_VIDEO_MODELS = [
    { value: "gpt-4o-mini", label: "gpt-4o-mini（快速）" },
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro（视频理解）" },
  ];

  function fillSelectOptions(select, options = [], current = "") {
    if (!select) return;
    const seen = new Set();
    const rows = [];
    for (const item of options) {
      const value = String(item?.value || item?.id || item || "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      rows.push({ value, label: String(item?.label || item?.name || value) });
    }
    const cur = String(current || "").trim();
    if (cur && !seen.has(cur)) rows.unshift({ value: cur, label: `${cur}（当前配置）` });
    select.innerHTML = rows.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
    if (cur) select.value = cur;
  }

  function isProbablyVisionModel(model = "") {
    const value = String(model || "").toLowerCase();
    if (!value) return false;
    if (/gpt-image|dall-e|embedding|whisper|tts|deepseek|moonshot-v1|glm-4-flash/.test(value)) return false;
    return /gpt|vision|vl|qwen.*vl|gemini|claude|pixtral|llava/.test(value);
  }

  function buildVisionModelOptions(current = "") {
    return [...BUILTIN_VISION_MODELS, ...(current ? [{ value: current, label: `${current}（当前配置）` }] : [])];
  }

  function buildVideoModelOptions(current = "") {
    return [...BUILTIN_VIDEO_MODELS, ...(current ? [{ value: current, label: `${current}（当前配置）` }] : [])];
  }

  overlay.querySelectorAll(".settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".settings-nav-item").forEach(b => b.classList.remove("active"));
      overlay.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      overlay.querySelector(`.settings-tab[data-tab="${tab}"]`)?.classList.add("active");
      if (tab === "social" || tab === "wechat-groups") loadSocialSettings();
      if (tab === "skills") loadSkillSettings();
      if (tab === "database") { loadDatabaseSettings(); startDatabaseImageAutoRefresh(); }
      else stopDatabaseImageAutoRefresh();
      if (tab === "knowledge") loadKnowledgeConsole();
      if (tab === "wechat-groups") startWechatyStatsAutoRefresh();
      if (tab === "security") loadSecuritySettings();
      if (tab === "web-search") loadWebSearchSettings();
      if (tab === "update") loadUpdateSettings();
    });
  });

  function showFeedback(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.className = "settings-feedback" + (isError ? " error" : "");
    setTimeout(() => { el.textContent = ""; el.className = "settings-feedback"; }, 3000);
  }

  function refreshConfigSummary({ llm, minimax }) {
    const cfgLlm = document.getElementById("settings-cfg-llm");
    const cfgLlmDot = document.getElementById("settings-cfg-llm-dot");
    const cfgMedia = document.getElementById("settings-cfg-media");
    const cfgMediaDot = document.getElementById("settings-cfg-media-dot");
    if (cfgLlm) cfgLlm.textContent = `${llm.provider || "—"} · ${llm.model || "—"}`;
    if (cfgLlmDot) {
      cfgLlmDot.textContent = "●";
      cfgLlmDot.className = `settings-config-dot ${llm.activated ? "active" : "inactive"}`;
      cfgLlmDot.title = llm.activated ? "Running" : "Inactive";
    }
    if (cfgMedia) cfgMedia.textContent = `minimax · ${minimax.configured ? "configured" : "not configured"}`;
    if (cfgMediaDot) {
      cfgMediaDot.textContent = "●";
      cfgMediaDot.className = `settings-config-dot ${minimax.configured ? "active" : "inactive"}`;
    }
  }

  function populateModelSelect(models, current) {
    if (!modelSelect || !models) return;
    modelSelect.innerHTML = models
      .map(m => `<option value="${m.id}"${m.deprecated ? " data-deprecated" : ""}>${m.label}</option>`)
      .join("");
    if (current) modelSelect.value = current;
  }

  function populateProviderSelect(providers, current) {
    if (!providerSelect || !providers) return;
    const selected = current || providerSelect.value || "auto";
    const options = [`<option value="auto">Auto-detect</option>`]
      .concat(Object.entries(providers).map(([id, provider]) => {
        const label = provider.label || id;
        return `<option value="${id}">${label}</option>`;
      }));
    providerSelect.innerHTML = options.join("");
    providerSelect.value = providers[selected] || selected === "auto" ? selected : "auto";
  }

  function applyCustomProviderUI(llm) {
    const customSection = document.getElementById("settings-custom-llm-section");
    const modelRow = document.getElementById("settings-model-row");
    const providerValue = typeof llm === "string" ? llm : llm?.provider;
    if (providerValue === "custom") {
      if (customSection) customSection.style.display = "";
      if (modelRow) modelRow.style.display = "none";
      if (typeof llm === "string") return;
      const baseUrlEl = document.getElementById("settings-custom-baseurl");
      const modelEl = document.getElementById("settings-custom-model");
      if (baseUrlEl && llm.baseURL) baseUrlEl.value = llm.baseURL;
      if (modelEl && llm.model) modelEl.value = llm.model;
    } else {
      if (customSection) customSection.style.display = "none";
      if (modelRow) modelRow.style.display = providerValue === "auto" ? "none" : "";
    }
  }

  function formatLLMTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).replace("T", " ").slice(0, 19);
    return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function getLLMProfileTestState(profile = {}) {
    const lastSuccessMs = profile.lastSuccessAt ? Date.parse(profile.lastSuccessAt) : 0;
    const lastFailedMs = profile.lastFailedAt ? Date.parse(profile.lastFailedAt) : 0;
    if (lastFailedMs && lastFailedMs >= lastSuccessMs) {
      return { state: "down", label: "失败", detail: profile.lastError || "最近检测/调用失败", at: profile.lastFailedAt };
    }
    if (lastSuccessMs) {
      return { state: "up", label: "成功", detail: "最近检测/调用成功", at: profile.lastSuccessAt };
    }
    return { state: "unknown", label: "未知", detail: "尚未检测", at: "" };
  }

  function getLLMProfileCardState(profile = {}) {
    const testState = getLLMProfileTestState(profile);
    if (profile.enabled === false) {
      return {
        state: "off",
        label: "已关闭",
        detail: testState.state === "unknown" ? "不参与自动切换，尚未检测" : `不参与自动切换，最近检测${testState.label}`,
        at: testState.at,
      };
    }
    if (profile.status === "cooldown") {
      return { state: "warn", label: "冷却中", detail: `冷却到 ${formatLLMTime(profile.cooldownUntil)}`, at: testState.at };
    }
    return testState;
  }

  function formatLLMProfileLabel(profile = {}, fallback = "—") {
    if (!profile) return fallback;
    const providerModel = `${profile.providerLabel || profile.provider || "LLM"} · ${profile.model || "—"}`;
    return profile.name && profile.name !== providerModel ? `${profile.name} · ${providerModel}` : providerModel;
  }

  function providerModels(provider) {
    return cachedProviders?.[provider]?.models || [];
  }

  function renderLLMFailover(failover = {}) {
    cachedLLMFailover = { enabled: failover.enabled !== false, cooldownSeconds: failover.cooldownSeconds || 180, maxAttempts: failover.maxAttempts || 4 };
    if (llmFailoverEnabled) llmFailoverEnabled.checked = cachedLLMFailover.enabled;
    if (llmFailoverCooldown) llmFailoverCooldown.value = String(cachedLLMFailover.cooldownSeconds);
    if (llmFailoverAttempts) llmFailoverAttempts.value = String(cachedLLMFailover.maxAttempts);
  }

  function llmMonitorProfileState(profile = {}) {
    const state = getLLMProfileCardState(profile);
    return { state: state.state, label: state.state === "up" ? "连通" : (state.state === "down" ? "不通" : state.label) };
  }

  function formatLLMMonitorStatus(status = {}, cfg = cachedLLMMonitor) {
    const rows = [];
    rows.push(cfg.enabled ? "● 已启用" : "○ 已关闭");
    if (status.running) rows.push("检测中…");
    if (status.last_check_at) rows.push(`上次 ${formatLLMTime(status.last_check_at)}`);
    if (status.last_notify_at) rows.push(`通知 ${formatLLMTime(status.last_notify_at)}`);
    if (cfg.enabled && status.next_check_at) rows.push(`下次约 ${formatLLMTime(status.next_check_at)}`);
    return rows.join(" · ");
  }

  function normalizeLLMMonitorGroupValue(value = "") {
    return String(value || "").trim().replace(/^wechaty:/u, "");
  }

  function llmMonitorGroupKeys(room = {}) {
    const rid = String(room.id || room.groupKey || "").trim();
    const topic = String(room.topic || "").trim();
    return [rid, topic, rid ? `wechaty:${rid}` : "", topic ? `wechaty:${topic}` : "", normalizeLLMMonitorGroupValue(rid), normalizeLLMMonitorGroupValue(topic)].filter(Boolean);
  }

  function llmMonitorGroupSelected(room = {}, selected = []) {
    const rid = String(room.id || "").trim();
    const topic = String(room.topic || "").trim();
    const keys = new Set(llmMonitorGroupKeys({ id: rid, topic }));
    return selected.some(item => keys.has(String(item || "").trim()) || keys.has(normalizeLLMMonitorGroupValue(item)));
  }

  function normalizeLLMRoutingConfig(routing = {}, profiles = cachedLLMProfiles) {
    const globalProfileId = String(routing.globalProfileId || routing.global_profile_id || cachedActiveLLM?.activeProfileId || "").trim();
    const globalProfile = routing.globalProfile
      || profiles.find(profile => String(profile.id || "") === globalProfileId)
      || profiles.find(profile => profile.current)
      || null;
    const groupOverrides = (Array.isArray(routing.groupOverrides) ? routing.groupOverrides : [])
      .map(item => ({
        groupId: String(item?.groupId || item?.group_id || "").trim(),
        groupName: String(item?.groupName || item?.group_name || item?.topic || "").trim(),
        profileId: String(item?.profileId || item?.profile_id || item?.llmProfileId || item?.llm_profile_id || "").trim(),
        profile: item?.profile || null,
        updatedAt: item?.updatedAt || item?.updated_at || "",
      }))
      .filter(item => (item.groupId || item.groupName) && item.profileId);
    return { globalProfileId, globalProfile, groupOverrides };
  }

  function llmRoutingGroupKeys(room = {}) {
    return llmMonitorGroupKeys({
      id: room.id || room.groupId || room.group_id || room.groupKey || "",
      topic: room.topic || room.groupName || room.group_name || room.name || "",
    });
  }

  function llmRoutingOverrideFor(room = {}, routing = cachedLLMRouting) {
    const keys = new Set(llmRoutingGroupKeys(room));
    const normalized = new Set([...keys].map(key => normalizeLLMMonitorGroupValue(key)));
    return (routing.groupOverrides || []).find(item => {
      const rowKeys = llmRoutingGroupKeys({ id: item.groupId, topic: item.groupName });
      return rowKeys.some(key => keys.has(key) || normalized.has(normalizeLLMMonitorGroupValue(key)));
    }) || null;
  }

  function buildLLMRoutingCandidates(routing = cachedLLMRouting, wechatyStatus = {}) {
    const rooms = Array.isArray(wechatyStatus.rooms) ? wechatyStatus.rooms : cachedLLMRoutingRooms;
    const seen = new Set();
    const candidates = [];
    const addCandidate = (room = {}, extra = {}) => {
      const id = String(room.id || room.groupId || room.group_id || "").trim();
      const topic = String(room.topic || room.groupName || room.group_name || room.name || "").trim();
      if (!id && !topic) return;
      const keys = llmRoutingGroupKeys({ id, topic }).map(key => normalizeLLMMonitorGroupValue(key)).filter(Boolean);
      if (keys.some(key => seen.has(key))) return;
      keys.forEach(key => seen.add(key));
      candidates.push({
        id,
        topic,
        stale: room.stale === true || room.selected === false || extra.stale === true,
        savedOnly: extra.savedOnly === true,
      });
    };
    rooms.forEach(room => addCandidate(room));
    (routing.groupOverrides || []).forEach(item => addCandidate({
      id: item.groupId,
      topic: item.groupName,
    }, { stale: true, savedOnly: true }));
    return candidates;
  }

  function llmRoutingProfileById(profileId = "", profiles = cachedLLMProfiles) {
    const id = String(profileId || "").trim();
    return profiles.find(profile => String(profile.id || "") === id) || null;
  }

  function renderLLMRoutingProfileOptions(profiles = cachedLLMProfiles, selectedId = "") {
    const current = String(selectedId || "").trim();
    const options = [`<option value="">继承全局模型</option>`];
    options.push(...profiles.map(profile => {
      const id = String(profile.id || "").trim();
      const suffix = profile.enabled === false ? "（已关闭）" : "";
      const label = `${formatLLMProfileLabel(profile)}${suffix}`;
      return `<option value="${escapeHtml(id)}"${id === current ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }));
    return options.join("");
  }

  function updateLLMGroupRoutingCounts() {
    if (!llmRoutingList) return;
    const rows = [...llmRoutingList.querySelectorAll(".llm-routing-row")];
    let custom = 0;
    rows.forEach(row => {
      const select = row.querySelector(".llm-routing-select");
      const profileId = String(select?.value || "").trim();
      const profile = llmRoutingProfileById(profileId);
      row.classList.toggle("custom", !!profileId);
      row.classList.toggle("inherited", !profileId);
      const state = row.querySelector(".llm-routing-state");
      if (state) {
        state.textContent = profileId
          ? `单独使用：${formatLLMProfileLabel(profile || { id: profileId, provider: "LLM", model: profileId })}`
          : "继承全局模型";
      }
      if (profileId) custom += 1;
    });
    if (llmRoutingCount) llmRoutingCount.textContent = rows.length ? `${custom}/${rows.length} 个群单独配置` : "0 个群";
  }

  function renderLLMGroupRouting(routing = cachedLLMRouting, profiles = cachedLLMProfiles, wechatyStatus = {}) {
    if (!llmRoutingList) return;
    const profileRows = Array.isArray(profiles) ? profiles : [];
    cachedLLMRouting = normalizeLLMRoutingConfig(routing, profileRows);
    if (Array.isArray(wechatyStatus.rooms)) cachedLLMRoutingRooms = wechatyStatus.rooms;
    const globalProfile = cachedLLMRouting.globalProfile
      || llmRoutingProfileById(cachedLLMRouting.globalProfileId, profileRows)
      || profileRows.find(profile => profile.current)
      || null;
    const globalFallback = `${cachedActiveLLM?.provider || "—"} · ${cachedActiveLLM?.model || "—"}`;
    if (llmRoutingGlobal) llmRoutingGlobal.textContent = `全局默认：${globalProfile ? formatLLMProfileLabel(globalProfile) : globalFallback}`;
    if (!profileRows.length) {
      llmRoutingList.innerHTML = `<div class="llm-profile-empty">还没有可用于群路由的已保存模型。</div>`;
      if (llmRoutingCount) llmRoutingCount.textContent = "0 个模型";
      return;
    }
    const candidates = buildLLMRoutingCandidates(cachedLLMRouting, wechatyStatus);
    if (!candidates.length) {
      llmRoutingList.innerHTML = `<div class="llm-profile-empty">当前没有可配置的微信群。登录/恢复微信群助手后会显示群列表；已保存的独立路由也会保留在这里。</div>`;
      if (llmRoutingCount) llmRoutingCount.textContent = "0 个群";
      return;
    }
    llmRoutingList.innerHTML = candidates.map(room => {
      const groupId = String(room.id || "").trim();
      const groupName = String(room.topic || "").trim();
      const override = llmRoutingOverrideFor({ id: groupId, topic: groupName }, cachedLLMRouting);
      const profileId = override?.profileId || "";
      const subtitle = room.savedOnly ? "已保存但当前未在线" : (room.stale ? "缓存/未开启自由回复" : "当前可配置");
      const shortId = groupId ? ` · ${groupId.slice(0, 22)}` : "";
      const label = groupName || groupId || "微信群";
      return `<div class="llm-routing-row${profileId ? " custom" : " inherited"}" data-group-id="${escapeHtml(groupId)}" data-group-name="${escapeHtml(groupName)}">
        <div class="llm-routing-group" title="${escapeHtml(groupId)}">
          <b>${escapeHtml(label)}</b>
          <em>${escapeHtml(`${subtitle}${shortId}`)}</em>
        </div>
        <label class="llm-routing-picker">
          <span>回复模型</span>
          <select class="settings-select llm-routing-select">${renderLLMRoutingProfileOptions(profileRows, profileId)}</select>
        </label>
        <span class="llm-routing-state">${profileId ? "单独使用" : "继承全局模型"}</span>
      </div>`;
    }).join("");
    updateLLMGroupRoutingCounts();
  }

  function collectLLMGroupRoutingPayload() {
    const groupOverrides = [];
    if (!llmRoutingList) return { groupOverrides };
    llmRoutingList.querySelectorAll(".llm-routing-row").forEach(row => {
      const profileId = String(row.querySelector(".llm-routing-select")?.value || "").trim();
      if (!profileId) return;
      const groupId = String(row.dataset.groupId || "").trim();
      const groupName = String(row.dataset.groupName || "").trim();
      if (!groupId && !groupName) return;
      groupOverrides.push({ groupId, groupName, profileId });
    });
    return { groupOverrides };
  }

  async function loadLLMGroupRoutingSettings() {
    try {
      const data = await fetch(`${API}/settings/llm-group-routing`).then(r => r.json());
      if (!data.ok) return;
      if (Array.isArray(data.profiles)) cachedLLMProfiles = data.profiles;
      renderLLMGroupRouting(data.routing || {}, data.profiles || cachedLLMProfiles, data.wechatyDutyGroupStatus || {});
    } catch {}
  }

  function llmMonitorMentionIdsForGroup(cfg = cachedLLMMonitor, room = {}) {
    const map = cfg?.notifyMentionsByGroup && typeof cfg.notifyMentionsByGroup === "object" ? cfg.notifyMentionsByGroup : {};
    const keys = new Set(llmMonitorGroupKeys(room));
    const normalized = new Set([...keys].map(key => normalizeLLMMonitorGroupValue(key)));
    const out = [];
    const seen = new Set();
    const add = (value = "") => {
      const id = String(value || "").trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };
    Object.entries(map).forEach(([rawKey, values]) => {
      const key = String(rawKey || "").trim();
      if (!key) return;
      if (!keys.has(key) && !normalized.has(normalizeLLMMonitorGroupValue(key))) return;
      (Array.isArray(values) ? values : []).forEach(add);
    });
    return out;
  }

  function llmMonitorMemberId(member = {}) {
    return String(member.sender_id || member.wxid || member.wechat_id || member.stable_key || "").trim();
  }

  function llmMonitorMemberName(member = {}) {
    return member.display_name || member.room_alias || member.contact_alias || member.contact_name || member.wechat_id || member.wxid || member.sender_id || "未知成员";
  }

  function findLLMMonitorGroupCard(groupKey = "") {
    const key = String(groupKey || "").trim();
    if (!key || !llmMonitorGroupList) return null;
    return [...llmMonitorGroupList.querySelectorAll(".llm-monitor-group-card")].find(card => card.dataset.groupKey === key) || null;
  }

  function renderLLMMonitorMentionList(groupKey = "") {
    const card = findLLMMonitorGroupCard(groupKey);
    if (!card) return;
    const list = card.querySelector(".llm-monitor-mention-list");
    const count = card.querySelector(".llm-monitor-mention-count");
    if (!list) return;
    const topic = card.dataset.topic || "";
    const savedIds = llmMonitorMentionIdsForGroup(cachedLLMMonitor, { id: groupKey, topic });
    const selectedSet = new Set(savedIds);
    const loaded = card.dataset.membersLoaded === "true";
    const keyword = String(card.querySelector(".llm-monitor-mention-search")?.value || "").trim().toLowerCase();
    let members = Array.isArray(llmMonitorMentionCache[groupKey]) ? llmMonitorMentionCache[groupKey] : [];
    const knownIds = new Set(members.map(llmMonitorMemberId).filter(Boolean));
    for (const id of savedIds) {
      if (!knownIds.has(id)) {
        members.push({ sender_id: id, display_name: "已保存成员", group_name: topic || "当前群", savedOnly: true });
      }
    }
    if (keyword) {
      members = members.filter(member => [
        llmMonitorMemberName(member),
        member.group_name,
        member.room_alias,
        member.contact_alias,
        member.contact_name,
        member.wechat_id,
        member.wxid,
        member.sender_id,
      ].some(value => String(value || "").toLowerCase().includes(keyword)));
    }
    if (count) count.textContent = savedIds.length ? `已选 ${savedIds.length} 人` : "未选择 @ 人员";
    if (!loaded && !members.length) {
      list.innerHTML = `<div class="llm-monitor-mention-empty">点击“加载成员”后按微信昵称勾选；不选则只发群通知，不 @ 人。</div>`;
      return;
    }
    if (!members.length) {
      list.innerHTML = `<div class="llm-monitor-mention-empty">${keyword ? "没有匹配的成员。" : "暂无成员数据。先在微信群助手里刷新昵称，或等群里有人发言后再试。"}</div>`;
      return;
    }
    list.innerHTML = members.slice(0, 240).map(member => {
      const id = llmMonitorMemberId(member);
      const checked = selectedSet.has(id) ? " checked" : "";
      const stale = member.savedOnly ? " stale" : "";
      const sub = member.savedOnly ? `保存的 sender_id：${id}` : (member.group_name || member.last_seen_display || id);
      return `<label class="llm-monitor-mention-member${stale}" title="${escapeHtml(id)}">
        <input class="llm-monitor-mention-checkbox" type="checkbox" value="${escapeHtml(id)}"${checked}>
        <span><b>${escapeHtml(llmMonitorMemberName(member))}</b><em>${escapeHtml(sub)}</em></span>
      </label>`;
    }).join("");
  }

  function updateLLMMonitorGroupCardStates() {
    if (!llmMonitorGroupList) return;
    [...llmMonitorGroupList.querySelectorAll(".llm-monitor-group-card")].forEach(card => {
      const checked = !!card.querySelector(".llm-monitor-group-checkbox")?.checked;
      card.classList.toggle("disabled", !checked);
      const note = card.querySelector(".llm-monitor-mention-note");
      if (note) note.textContent = checked ? "这些人会在渠道异常通知里被 @。" : "未勾选这个群时，@ 人员配置不会生效。";
    });
  }

  async function loadLLMMonitorGroupMembers(groupKey = "", { silent = false } = {}) {
    const card = findLLMMonitorGroupCard(groupKey);
    if (!card) return;
    const btn = card.querySelector(".llm-monitor-mention-load");
    const list = card.querySelector(".llm-monitor-mention-list");
    const topic = card.dataset.topic || "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "加载中…";
    }
    if (list && !silent) list.innerHTML = `<div class="llm-monitor-mention-empty">正在读取群成员昵称…</div>`;
    try {
      const requestGroupId = groupKey.startsWith("wechaty:") ? groupKey : `wechaty:${groupKey}`;
      const params = new URLSearchParams({ group_id: requestGroupId, group_name: topic, limit: "800" });
      const data = await fetch(`${API}/social/wechat-groups/members?${params.toString()}`).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "读取群成员失败");
      llmMonitorMentionCache[groupKey] = Array.isArray(data.members) ? data.members : [];
      card.dataset.membersLoaded = "true";
      renderLLMMonitorMentionList(groupKey);
      if (!silent) showFeedback(llmMonitorFeedback, `已加载 ${llmMonitorMentionCache[groupKey].length} 个群成员`);
    } catch (err) {
      if (list) list.innerHTML = `<div class="llm-monitor-mention-empty error">${escapeHtml(err?.message || "读取群成员失败")}</div>`;
      if (!silent) showFeedback(llmMonitorFeedback, err?.message || "读取群成员失败", true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "加载成员";
      }
    }
  }

  function collectLLMMonitorSelectedMentionCount() {
    if (!llmMonitorGroupList) return 0;
    let total = 0;
    [...llmMonitorGroupList.querySelectorAll(".llm-monitor-group-card")].forEach(card => {
      const groupChecked = !!card.querySelector(".llm-monitor-group-checkbox")?.checked;
      if (!groupChecked) return;
      const groupKey = card.dataset.groupKey || "";
      const topic = card.dataset.topic || "";
      const loaded = card.dataset.membersLoaded === "true";
      if (loaded) total += card.querySelectorAll(".llm-monitor-mention-checkbox:checked").length;
      else total += llmMonitorMentionIdsForGroup(cachedLLMMonitor, { id: groupKey, topic }).length;
    });
    return total;
  }

  function renderLLMMonitorResults(status = {}) {
    if (!llmMonitorResult) return;
    const results = Array.isArray(status.results) ? status.results : [];
    if (!results.length) {
      llmMonitorResult.textContent = status.last_error ? `上次检测失败：${status.last_error}` : "检测结果会显示在这里。";
      return;
    }
    const ok = results.filter(item => item.ok).length;
    const failed = results.filter(item => item.ok === false).length;
    const lines = [`最近检测：${ok} 通 / ${failed} 不通 · ${formatLLMTime(status.last_check_at)}`];
    for (const item of results.slice(0, 8)) {
      const icon = item.ok ? "✅" : "❌";
      const latency = item.latencyMs ? ` ${Math.round(item.latencyMs)}ms` : "";
      const err = item.error ? ` · ${String(item.error).slice(0, 90)}` : "";
      lines.push(`${icon} ${item.name || item.model || item.profileId}${latency}${err}`);
    }
    if (results.length > 8) lines.push(`……还有 ${results.length - 8} 个渠道未展开`);
    llmMonitorResult.textContent = lines.join("\n");
  }

  function renderLLMMonitorProfiles(profiles = cachedLLMProfiles, cfg = cachedLLMMonitor) {
    if (!llmMonitorProfileList) return;
    const selected = Array.isArray(cfg.selectedProfileIds) ? cfg.selectedProfileIds.map(String) : [];
    if (!profiles.length) {
      llmMonitorProfileList.innerHTML = `<div class="llm-profile-empty">还没有模型配置，先到“新增 / 编辑模型”保存渠道。</div>`;
      if (llmMonitorProfileCount) llmMonitorProfileCount.textContent = "0 个";
      return;
    }
    const selectedAllByDefault = !selected.length;
    llmMonitorProfileList.innerHTML = profiles.map(profile => {
      const state = llmMonitorProfileState(profile);
      const checked = selectedAllByDefault || selected.includes(String(profile.id)) ? " checked" : "";
      const label = `${profile.providerLabel || profile.provider || "LLM"} · ${profile.model || "—"}`;
      return `<label class="llm-monitor-item" title="${escapeHtml(profile.id || "")}">
        <input class="llm-monitor-profile-checkbox" type="checkbox" value="${escapeHtml(profile.id || "")}"${checked}>
        <span>
          <b>${escapeHtml(profile.name || "未命名模型")}</b>
          <em><span class="llm-signal llm-signal-${state.state}"><i></i><b>${escapeHtml(state.label)}</b></span> · ${escapeHtml(label)} · ${escapeHtml(profile.apiKeyHint || (profile.configured ? "已配置" : "未配置"))}</em>
        </span>
      </label>`;
    }).join("");
    updateLLMMonitorCounts();
  }

  function renderLLMMonitorGroups(status = {}, cfg = cachedLLMMonitor) {
    if (!llmMonitorGroupList) return;
    const rooms = Array.isArray(status.rooms) ? status.rooms : [];
    cachedLLMMonitorRooms = rooms;
    const selected = Array.isArray(cfg.selectedGroups) ? cfg.selectedGroups.map(String).filter(Boolean) : [];
    const seen = new Set();
    const candidates = [];
    for (const room of rooms) {
      const rid = String(room.id || "").trim();
      const topic = String(room.topic || "").trim();
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);
      candidates.push({ id: rid, topic, stale: room.stale || room.selected === false });
    }
    for (const saved of selected) {
      const normalized = normalizeLLMMonitorGroupValue(saved);
      if (!normalized || candidates.some(room => room.id === saved || room.topic === saved || normalizeLLMMonitorGroupValue(room.id) === normalized)) continue;
      candidates.push({ id: saved, topic: saved, stale: true, savedOnly: true });
    }
    if (!candidates.length) {
      llmMonitorGroupList.innerHTML = `<div class="llm-profile-empty">当前没有可通知的微信群。请先在“微信群助手”登录/恢复微信。</div>`;
      if (llmMonitorGroupCount) llmMonitorGroupCount.textContent = "0 个";
      return;
    }
    llmMonitorGroupList.innerHTML = candidates.map(room => {
      const groupKey = String(room.id || room.topic || "").trim();
      const checked = llmMonitorGroupSelected(room, selected) ? " checked" : "";
      const subtitle = room.savedOnly ? "已保存但当前未在线" : (room.stale ? "缓存/未开启自由回复" : "当前可通知");
      const mentionCount = llmMonitorMentionIdsForGroup(cfg, { id: groupKey, topic: room.topic }).length;
      return `<div class="llm-monitor-group-card${checked ? "" : " disabled"}" data-group-key="${escapeHtml(groupKey)}" data-topic="${escapeHtml(room.topic || "")}" data-members-loaded="false">
        <label class="llm-monitor-item" title="${escapeHtml(room.id || "")}">
          <input class="llm-monitor-group-checkbox" type="checkbox" value="${escapeHtml(groupKey)}" data-topic="${escapeHtml(room.topic || "")}"${checked}>
          <span>
            <b>${escapeHtml(room.topic || room.id || "微信群")}</b>
            <em>${escapeHtml(subtitle)} · ${escapeHtml(String(room.id || "").slice(0, 18))}</em>
          </span>
        </label>
        <div class="llm-monitor-mentions">
          <div class="llm-monitor-mention-head">
            <div>
              <b>通知时 @ 人员</b>
              <em class="llm-monitor-mention-note">${checked ? "这些人会在渠道异常通知里被 @。" : "未勾选这个群时，@ 人员配置不会生效。"}</em>
            </div>
            <span class="llm-monitor-mention-count">${mentionCount ? `已选 ${mentionCount} 人` : "未选择 @ 人员"}</span>
          </div>
          <div class="llm-monitor-mention-tools">
            <input class="settings-input llm-monitor-mention-search" type="search" placeholder="按微信昵称搜索成员…">
            <button class="settings-save-btn llm-monitor-mention-load" type="button">加载成员</button>
          </div>
          <div class="llm-monitor-mention-list">
            <div class="llm-monitor-mention-empty">${mentionCount ? `已保存 ${mentionCount} 个 @ 人员；点击“加载成员”可查看昵称并调整。` : "点击“加载成员”后按微信昵称勾选；不选则只发群通知，不 @ 人。"}</div>
          </div>
        </div>
      </div>`;
    }).join("");
    candidates.forEach(room => renderLLMMonitorMentionList(String(room.id || room.topic || "").trim()));
    updateLLMMonitorCounts();
    updateLLMMonitorGroupCardStates();
  }

  function updateLLMMonitorCounts() {
    const profileChecked = llmMonitorProfileList ? llmMonitorProfileList.querySelectorAll(".llm-monitor-profile-checkbox:checked").length : 0;
    const profileTotal = llmMonitorProfileList ? llmMonitorProfileList.querySelectorAll(".llm-monitor-profile-checkbox").length : 0;
    const groupChecked = llmMonitorGroupList ? llmMonitorGroupList.querySelectorAll(".llm-monitor-group-checkbox:checked").length : 0;
    const groupTotal = llmMonitorGroupList ? llmMonitorGroupList.querySelectorAll(".llm-monitor-group-checkbox").length : 0;
    const mentionChecked = llmMonitorGroupList ? llmMonitorGroupList.querySelectorAll(".llm-monitor-group-checkbox:checked").length && collectLLMMonitorSelectedMentionCount() : 0;
    if (llmMonitorProfileCount) llmMonitorProfileCount.textContent = profileTotal ? `${profileChecked}/${profileTotal} 个` : "0 个";
    if (llmMonitorGroupCount) llmMonitorGroupCount.textContent = groupTotal ? `${groupChecked}/${groupTotal} 个群${mentionChecked ? ` · @${mentionChecked} 人` : ""}` : "0 个";
  }

  function renderLLMMonitor(config = {}, status = {}, profiles = cachedLLMProfiles, wechatyStatus = {}) {
    cachedLLMMonitor = {
      enabled: config.enabled === true,
      intervalMinutes: config.intervalMinutes || 60,
      notifyMode: config.notifyMode || "changes",
      selectedProfileIds: Array.isArray(config.selectedProfileIds) ? config.selectedProfileIds : [],
      selectedGroups: Array.isArray(config.selectedGroups) ? config.selectedGroups : [],
      notifyMentionsByGroup: config.notifyMentionsByGroup && typeof config.notifyMentionsByGroup === "object" ? config.notifyMentionsByGroup : {},
    };
    cachedLLMMonitorStatus = status || {};
    if (llmMonitorEnabled) llmMonitorEnabled.checked = cachedLLMMonitor.enabled;
    if (llmMonitorInterval) llmMonitorInterval.value = String(cachedLLMMonitor.intervalMinutes);
    if (llmMonitorMode) llmMonitorMode.value = cachedLLMMonitor.notifyMode;
    if (llmMonitorStatus) llmMonitorStatus.textContent = formatLLMMonitorStatus(cachedLLMMonitorStatus, cachedLLMMonitor);
    renderLLMMonitorProfiles(profiles, cachedLLMMonitor);
    renderLLMMonitorGroups(wechatyStatus, cachedLLMMonitor);
    renderLLMMonitorResults(cachedLLMMonitorStatus);
  }

  function collectLLMMonitorPayload() {
    const selectedProfileIds = llmMonitorProfileList
      ? [...llmMonitorProfileList.querySelectorAll(".llm-monitor-profile-checkbox:checked")].map(input => input.value).filter(Boolean)
      : [];
    const selectedGroups = llmMonitorGroupList
      ? [...llmMonitorGroupList.querySelectorAll(".llm-monitor-group-checkbox:checked")].map(input => input.value).filter(Boolean)
      : [];
    const notifyMentionsByGroup = {};
    if (llmMonitorGroupList) {
      [...llmMonitorGroupList.querySelectorAll(".llm-monitor-group-card")].forEach(card => {
        const groupInput = card.querySelector(".llm-monitor-group-checkbox");
        if (!groupInput?.checked) return;
        const groupKey = String(groupInput.value || card.dataset.groupKey || "").trim();
        if (!groupKey) return;
        const topic = card.dataset.topic || groupInput.dataset.topic || "";
        const loaded = card.dataset.membersLoaded === "true";
        const checkedIds = [...card.querySelectorAll(".llm-monitor-mention-checkbox:checked")].map(input => input.value).filter(Boolean);
        const ids = checkedIds.length || loaded
          ? checkedIds
          : llmMonitorMentionIdsForGroup(cachedLLMMonitor, { id: groupKey, topic });
        if (ids.length) notifyMentionsByGroup[groupKey] = [...new Set(ids)].slice(0, 20);
      });
    }
    return {
      enabled: !!llmMonitorEnabled?.checked,
      intervalMinutes: Number(llmMonitorInterval?.value || 60),
      notifyMode: llmMonitorMode?.value || "changes",
      selectedProfileIds,
      selectedGroups,
      notifyMentionsByGroup,
    };
  }

  async function loadLLMMonitorSettings() {
    try {
      const data = await fetch(`${API}/settings/llm-connectivity-monitor`).then(r => r.json());
      if (!data.ok) return;
      if (Array.isArray(data.profiles)) cachedLLMProfiles = data.profiles;
      renderLLMMonitor(data.config || {}, data.status || {}, data.profiles || cachedLLMProfiles, data.wechatyDutyGroupStatus || {});
    } catch {}
  }

  function syncLLMBatchSelection(profiles = cachedLLMProfiles) {
    const valid = new Set((Array.isArray(profiles) ? profiles : []).map(profile => String(profile.id || "")).filter(Boolean));
    selectedLLMProfileIds = new Set([...selectedLLMProfileIds].filter(id => valid.has(id)));
  }

  function updateLLMBatchSelectionCount() {
    syncLLMBatchSelection();
    const total = cachedLLMProfiles.length;
    const selected = selectedLLMProfileIds.size;
    if (llmBatchCount) llmBatchCount.textContent = total ? `已选 ${selected}/${total} 个` : "已选 0 个";
    if (llmBatchSelectAllBtn) llmBatchSelectAllBtn.disabled = !total || llmBatchTesting || selected === total;
    if (llmBatchClearBtn) llmBatchClearBtn.disabled = !selected || llmBatchTesting;
    if (llmBatchTestSelectedBtn) llmBatchTestSelectedBtn.disabled = !selected || llmBatchTesting;
    if (llmBatchTestAllBtn) llmBatchTestAllBtn.disabled = !total || llmBatchTesting;
    if (llmPoolList) {
      llmPoolList.querySelectorAll(".llm-profile-checkbox").forEach(input => {
        input.checked = selectedLLMProfileIds.has(input.value);
      });
    }
  }

  function setLLMProfileTestButtons(ids = [], testing = false) {
    if (!llmPoolList) return;
    const idSet = new Set(ids.map(id => String(id || "")).filter(Boolean));
    llmPoolList.querySelectorAll(".llm-profile-card").forEach(card => {
      const btn = card.querySelector('button[data-action="test"]');
      if (!btn || !idSet.has(card.dataset.id || "")) return;
      btn.disabled = testing;
      btn.textContent = testing ? "测试中…" : "测试连通";
    });
  }

  function renderLLMSummary(profiles = cachedLLMProfiles, llm = {}) {
    const active = profiles.find(p => p.current) || profiles.find(p => p.id === llm.activeProfileId);
    const fallback = `${llm.provider || "—"} · ${llm.model || "—"}`;
    const stats = profiles.reduce((acc, profile) => {
      const state = getLLMProfileTestState(profile);
      if (state.state === "up") acc.ok += 1;
      else if (state.state === "down") acc.failed += 1;
      else acc.unknown += 1;
      const lastMs = state.at ? Date.parse(state.at) : 0;
      if (Number.isFinite(lastMs) && lastMs > acc.lastMs) {
        acc.lastMs = lastMs;
        acc.lastAt = state.at;
      }
      return acc;
    }, { ok: 0, failed: 0, unknown: 0, lastMs: 0, lastAt: "" });
    if (llmSummaryCurrent) llmSummaryCurrent.textContent = active ? formatLLMProfileLabel(active) : fallback;
    if (llmSummaryTotal) llmSummaryTotal.textContent = `${profiles.length} 个`;
    if (llmSummaryOk) llmSummaryOk.textContent = `${stats.ok} 个`;
    if (llmSummaryBad) llmSummaryBad.textContent = `${stats.failed} / ${stats.unknown}`;
    if (llmSummaryLast) llmSummaryLast.textContent = formatLLMTime(stats.lastAt);
  }

  function renderLLMBatchResult(results = lastLLMBatchResults, { running = false, error = "", checkedAt = "" } = {}) {
    if (!llmBatchResult) return;
    if (running) {
      llmBatchResult.className = "llm-batch-result running";
      llmBatchResult.innerHTML = `<div class="llm-batch-result-head"><b>正在顺序测试模型连通性…</b><span>已选择的配置会逐个执行，避免并发写入状态。</span></div>`;
      return;
    }
    if (error) {
      llmBatchResult.className = "llm-batch-result error";
      llmBatchResult.innerHTML = `<div class="llm-batch-result-head"><b>批量测试失败</b><span>${escapeHtml(error)}</span></div>`;
      return;
    }
    if (!results.length) {
      llmBatchResult.className = "llm-batch-result";
      llmBatchResult.textContent = "批量测试结果会显示在这里。";
      return;
    }
    const ok = results.filter(item => item.ok).length;
    const failed = results.filter(item => item.ok === false).length;
    const summary = `${ok} 个成功 / ${failed} 个失败 · ${formatLLMTime(checkedAt || new Date().toISOString())}`;
    llmBatchResult.className = `llm-batch-result ${failed ? "warn" : "ok"}`;
    llmBatchResult.innerHTML = `
      <div class="llm-batch-result-head">
        <b>批量测试完成</b>
        <span>${escapeHtml(summary)}</span>
      </div>
      <div class="llm-batch-result-list">
        ${results.map(item => {
          const label = `${item.name || item.model || item.id || "未命名模型"} · ${item.providerLabel || item.provider || "LLM"} · ${item.model || "—"}`;
          const latency = item.latencyMs ? `${Math.round(item.latencyMs)}ms` : "—";
          const err = item.error ? `<p>${escapeHtml(item.error)}</p>` : "";
          return `<div class="llm-batch-result-item ${item.ok ? "ok" : "bad"}">
            <span>${item.ok ? "成功" : "失败"}</span>
            <b>${escapeHtml(label)}</b>
            <em>${escapeHtml(latency)}</em>
            ${err}
          </div>`;
        }).join("")}
      </div>`;
  }

  async function runLLMBatchTest({ all = false } = {}) {
    const ids = [...selectedLLMProfileIds];
    const targetIds = all
      ? cachedLLMProfiles.map(profile => String(profile.id || "")).filter(Boolean)
      : ids;
    if (!all && !ids.length) {
      renderLLMBatchResult([], { error: "请选择要测试的模型配置" });
      return;
    }
    llmBatchTesting = true;
    const selectedText = llmBatchTestSelectedBtn?.textContent || "测试选中";
    const allText = llmBatchTestAllBtn?.textContent || "测试全部";
    if (llmBatchTestSelectedBtn) llmBatchTestSelectedBtn.textContent = "测试中…";
    if (llmBatchTestAllBtn) llmBatchTestAllBtn.textContent = "测试中…";
    updateLLMBatchSelectionCount();
    setLLMProfileTestButtons(targetIds, true);
    renderLLMBatchResult([], { running: true });
    try {
      const res = await fetch(`${API}/settings/llm-profile/test-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? { all: true } : { ids, all: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "批量测试失败");
      lastLLMBatchResults = Array.isArray(data.results) ? data.results : [];
      if (data.llm) {
        renderLLMFailover(data.llm.failover || cachedLLMFailover);
        renderLLMProfiles(data.llm.profiles || cachedLLMProfiles, data.llm);
      }
      renderLLMBatchResult(lastLLMBatchResults, { checkedAt: data.checkedAt });
      showFeedback(llmFeedback, `批量测试完成：${lastLLMBatchResults.filter(item => item.ok).length}/${lastLLMBatchResults.length} 个连通`);
    } catch (err) {
      renderLLMBatchResult([], { error: err?.message || "批量测试请求失败" });
      showFeedback(llmFeedback, err?.message || "批量测试请求失败", true);
    } finally {
      llmBatchTesting = false;
      if (llmBatchTestSelectedBtn) llmBatchTestSelectedBtn.textContent = selectedText;
      if (llmBatchTestAllBtn) llmBatchTestAllBtn.textContent = allText;
      setLLMProfileTestButtons(targetIds, false);
      updateLLMBatchSelectionCount();
    }
  }

  function renderLLMProfiles(profiles = [], llm = {}) {
    cachedLLMProfiles = (Array.isArray(profiles) ? [...profiles] : [])
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
    syncLLMBatchSelection(cachedLLMProfiles);
    const active = cachedLLMProfiles.find(p => p.current) || cachedLLMProfiles.find(p => p.id === llm.activeProfileId);
    if (llmCurrentProfile) {
      const activeProviderModel = active ? `${active.providerLabel || active.provider} · ${active.model}` : "";
      llmCurrentProfile.textContent = active
        ? `当前使用：${active.name && active.name !== activeProviderModel ? active.name + " · " : ""}${activeProviderModel}`
        : `当前使用：${llm.provider || "—"} · ${llm.model || "—"}`;
    }
    renderLLMSummary(cachedLLMProfiles, llm);
    if (!llmPoolList) return;
    if (!cachedLLMProfiles.length) {
      llmPoolList.innerHTML = `<div class="llm-profile-empty">还没有模型配置，先在上方添加一个。保存后会自动加入模型池。</div>`;
      updateLLMBatchSelectionCount();
      return;
    }
    llmPoolList.innerHTML = cachedLLMProfiles
      .map((profile, idx) => {
        const cls = [
          "llm-profile-card",
          profile.current ? "current" : "",
          profile.status === "cooldown" ? "cooldown" : "",
          profile.enabled === false ? "disabled" : "",
        ].filter(Boolean).join(" ");
        const badges = [
          profile.current ? `<span class="llm-profile-badge current">当前</span>` : "",
          profile.enabled === false ? `<span class="llm-profile-badge">已关闭</span>` : "",
          profile.status === "cooldown" ? `<span class="llm-profile-badge cooldown">冷却中</span>` : "",
          `<span class="llm-profile-badge">#${idx + 1}</span>`,
        ].filter(Boolean).join("");
        const last = profile.lastSuccessAt || profile.lastFailedAt;
        const connectivity = getLLMProfileCardState(profile);
        const providerModel = `${profile.providerLabel || profile.provider} · ${profile.model || "—"}`;
        const subtitle = profile.name && profile.name !== providerModel ? providerModel : `模型池优先级 #${idx + 1}`;
        const checked = selectedLLMProfileIds.has(String(profile.id || "")) ? " checked" : "";
        const baseURL = profile.baseURL || "默认端点";
        return `
          <div class="${cls}" data-id="${escapeHtml(profile.id)}">
            <div class="llm-profile-head">
              <div class="llm-profile-title">
                <b>${escapeHtml(profile.name || "未命名模型")}</b>
                <span>${escapeHtml(subtitle)}</span>
              </div>
              <div class="llm-profile-head-tools">
                <label class="llm-profile-select">
                  <input class="llm-profile-checkbox" type="checkbox" value="${escapeHtml(profile.id || "")}"${checked}>
                  <span>批量测试</span>
                </label>
                <div class="llm-profile-badges">${badges}</div>
              </div>
            </div>
            <div class="llm-profile-meta">
              <div><small>KEY</small><span>${escapeHtml(profile.apiKeyHint || (profile.configured ? "已配置" : "未配置"))}</span></div>
              <div><small>连通状态</small><span class="llm-signal llm-signal-${connectivity.state}" title="${escapeHtml(connectivity.detail)}"><i></i><b>${escapeHtml(connectivity.label)}</b></span></div>
              <div><small>最近</small><span>${escapeHtml(formatLLMTime(last))}</span></div>
              <div><small>Base URL</small><span>${escapeHtml(baseURL)}</span></div>
            </div>
            ${profile.lastError ? `<p class="llm-profile-error">上次错误：${escapeHtml(profile.lastError)}</p>` : ""}
            <div class="llm-profile-actions">
              <button class="settings-save-btn" data-action="select" type="button"${profile.current ? " disabled" : ""}>设为当前</button>
              <button class="settings-save-btn" data-action="test" type="button">测试连通</button>
              <button class="settings-save-btn" data-action="edit" type="button">编辑</button>
              <button class="settings-save-btn" data-action="toggle" type="button">${profile.enabled === false ? "开启" : "关闭"}</button>
              <button class="settings-save-btn" data-action="up" type="button"${idx === 0 ? " disabled" : ""}>上移</button>
              <button class="settings-save-btn" data-action="down" type="button"${idx === cachedLLMProfiles.length - 1 ? " disabled" : ""}>下移</button>
              <button class="settings-save-btn danger" data-action="delete" type="button"${cachedLLMProfiles.length <= 1 ? " disabled" : ""}>删除</button>
            </div>
          </div>`;
      })
      .join("");
    updateLLMBatchSelectionCount();
    renderLLMMonitorProfiles(cachedLLMProfiles, cachedLLMMonitor);
    renderLLMGroupRouting(cachedLLMRouting, cachedLLMProfiles, { rooms: cachedLLMRoutingRooms });
  }

  function resetLLMProfileEditor() {
    if (llmEditingIdInput) llmEditingIdInput.value = "";
    if (llmProfileNameInput) llmProfileNameInput.value = "";
    if (llmKeyInput) llmKeyInput.value = "";
    const baseUrlEl = document.getElementById("settings-custom-baseurl");
    const modelEl = document.getElementById("settings-custom-model");
    if (baseUrlEl) baseUrlEl.value = "";
    if (modelEl) modelEl.value = "";
  }

  function loadProfileIntoEditor(profile = {}) {
    if (llmEditingIdInput) llmEditingIdInput.value = profile.id || "";
    if (llmProfileNameInput) llmProfileNameInput.value = profile.name || "";
    if (providerSelect) providerSelect.value = profile.provider || "deepseek";
    applyCustomProviderUI(profile.provider || "deepseek");
    if (profile.provider === "custom") {
      const baseUrlEl = document.getElementById("settings-custom-baseurl");
      const modelEl = document.getElementById("settings-custom-model");
      if (baseUrlEl) baseUrlEl.value = profile.baseURL || "";
      if (modelEl) modelEl.value = profile.model || "";
    } else {
      populateModelSelect(providerModels(profile.provider), profile.model);
    }
    if (llmKeyInput) llmKeyInput.value = "";
    document.getElementById("settings-llm-editor-section")?.scrollIntoView({ block: "start", behavior: "smooth" });
    showFeedback(llmFeedback, "已载入编辑，API Key 留空表示不更换");
  }

  function collectLLMProfilePayload({ setActive = false } = {}) {
    const provider = providerSelect?.value || "auto";
    const apiKey = llmKeyInput?.value?.trim() || "";
    const payload = {
      id: llmEditingIdInput?.value?.trim() || undefined,
      name: llmProfileNameInput?.value?.trim() || undefined,
      provider,
      apiKey: apiKey || undefined,
      setActive,
    };
    if (provider === "custom") {
      payload.baseURL = document.getElementById("settings-custom-baseurl")?.value?.trim() || "";
      payload.model = document.getElementById("settings-custom-model")?.value?.trim() || "";
    } else if (provider !== "auto") {
      payload.model = modelSelect?.value || "";
    }
    return payload;
  }

  async function loadSettings() {
    try {
      const data = await fetch(`${API}/settings`).then(r => r.json());
      const { llm, minimax, providers } = data;
      cachedActiveLLM = llm || cachedActiveLLM;
      if (providers) cachedProviders = providers;
      refreshConfigSummary({ llm, minimax });
      populateProviderSelect(providers, llm.provider || "auto");
      if (providerSelect && llm.provider) providerSelect.value = llm.provider;
      applyCustomProviderUI(llm);
      if (llm.provider !== "custom") populateModelSelect(llm.models, llm.model);
      renderLLMFailover(llm.failover || {});
      renderLLMProfiles(llm.profiles || [], llm);
      renderLLMGroupRouting(llm.routing || cachedLLMRouting, llm.profiles || cachedLLMProfiles, {});
      renderLLMMonitor(llm.connectivityMonitor || cachedLLMMonitor, llm.connectivityMonitorStatus || cachedLLMMonitorStatus, llm.profiles || cachedLLMProfiles, {});
      setTimeout(() => {
        loadLLMGroupRoutingSettings();
        loadLLMMonitorSettings();
      }, 0);
      if (typeof llm.temperature === "number" && tempSlider) {
        tempSlider.value = String(llm.temperature);
        if (tempVal) tempVal.textContent = llm.temperature.toFixed(2);
      }
    } catch {}
  }

  window.addEventListener("bailongma:llm-profiles-updated", (event) => {
    if (overlay?.hidden !== false) return;
    const data = event.detail || {};
    renderLLMFailover(data.failover || cachedLLMFailover);
    renderLLMProfiles(Array.isArray(data.profiles) ? data.profiles : cachedLLMProfiles, { activeProfileId: data.activeProfileId });
    if (data.routing) renderLLMGroupRouting(data.routing, cachedLLMProfiles, { rooms: cachedLLMRoutingRooms });
    else loadLLMGroupRoutingSettings();
  });

  window.addEventListener("bailongma:llm-connectivity-checked", () => {
    if (overlay?.hidden !== false) return;
    loadLLMMonitorSettings();
  });

  const SOCIAL_FIELD_MAP = {
    "social-discord-token":  "DISCORD_BOT_TOKEN",
    "social-feishu-appid":   "FEISHU_APP_ID",
    "social-feishu-secret":  "FEISHU_APP_SECRET",
    "social-feishu-token":   "FEISHU_VERIFICATION_TOKEN",
    "social-wechat-appid":   "WECHAT_OFFICIAL_APP_ID",
    "social-wechat-secret":  "WECHAT_OFFICIAL_APP_SECRET",
    "social-wechat-token":   "WECHAT_OFFICIAL_TOKEN",
    "social-wecom-botkey":   "WECOM_BOT_KEY",
    "social-wecom-token":    "WECOM_INCOMING_TOKEN",
  };

  const SOCIAL_PLATFORM_STATUS = {
    "social-status-discord": ["DISCORD_BOT_TOKEN"],
    "social-status-feishu":  ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_VERIFICATION_TOKEN"],
    "social-status-wechat":  ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_TOKEN"],
    "social-status-wecom":   ["WECOM_BOT_KEY", "WECOM_INCOMING_TOKEN"],
  };

  async function loadSocialSettings() {
    try {
      const { social, wechatyDutyGroup, wechatyDutyGroupStatus, wechatyPersonaPresets: personaPresets, honcho, honchoStatus: honchoRuntime, wechatGroupArchive, wechatGroupDigest, wechatMeme, guardRules } = await fetch(`${API}/settings/social`).then(r => r.json());
      renderWechatyPersonaPresets(personaPresets || [], wechatyDutyGroup?.personaPrompt || "");
      applyWechatyDutyConfig(wechatyDutyGroup, wechatyDutyGroupStatus);
      applyWechatGroupArchiveConfig(wechatGroupArchive || {}, wechatyDutyGroup || {});
      applyHonchoConfig(honcho, honchoRuntime);
      applyWechatyDigestConfig(wechatGroupDigest || {});
      applyWechatyMemeConfig(wechatMeme || {});
      renderGuardRules(guardRules || []);
      if (Array.isArray(wechatyDutyGroupStatus?.rooms) && wechatyDutyGroupStatus.rooms.length) {
        wechatyRoomsCache = wechatyDutyGroupStatus.rooms;
      }
      if (["connected", "logged_in", "starting"].includes(wechatyDutyGroupStatus?.status)) {
        setTimeout(() => refreshWechatyRooms({ autoStart: false, silent: true }), 0);
      }
      setTimeout(() => refreshWechatyMemoryOverview(), 300);
      setTimeout(() => loadWechatyActiveStats({ silent: true }), 500);
      setTimeout(() => loadWechatyAdminMembers({ silent: true }), 700);
      setTimeout(() => loadWechatyKnownGroups({ silent: true }), 900);
      setTimeout(() => loadWechatyHotspotSettings({ silent: true }), 1100);
      for (const [statusId, keys] of Object.entries(SOCIAL_PLATFORM_STATUS)) {
        const el = document.getElementById(statusId);
        if (!el) continue;
        const configuredCount = keys.filter(k => social[k]?.configured).length;
        if (configuredCount === keys.length) {
          el.textContent = "● 已配置";
          el.className = "settings-platform-status ok";
        } else if (configuredCount > 0) {
          el.textContent = `● 部分配置 (${configuredCount}/${keys.length})`;
          el.className = "settings-platform-status miss";
        } else {
          el.textContent = "○ 未配置";
          el.className = "settings-platform-status miss";
        }
      }
    } catch {}
  }

  let wechatyRoomsCache = [];
  let wechatyKnownGroupsCache = [];
  let wechatySelectedGroupNames = new Set();
  let wechatyConfiguredGroupNames = new Set();
  let wechatyGroupSelectionDirty = false;
  let wechatyActiveMemoryGroupId = "";
  let wechatyActiveMemoryGroupName = "";
  let wechatyActiveMemberCanonicalId = "";
  let wechatyMemberMemoryCache = [];
  let wechatyRoomsAreStale = false;
  let wechatyStatusPollTimer = null;
  let wechatyPersonaPresetCache = [];
  let wechatySavedPersonaPrompt = "";
  let wechatySavedPersonaPresetId = "custom";
  let wechatyAdminIdSet = new Set();
  let wechatyBlockedIdSet = new Set();
  let knowledgeSourcesCache = [];
  let knowledgePreviewCache = [];
  let knowledgeActiveSourceId = 0;
  let knowledgeActiveGroupId = "";
  let knowledgeActiveType = "";
  let wechatyAdminMemberCache = [];
  let wechatyDigestConfigCache = {};
  let wechatyDigestSelectedGroups = new Set();
  let wechatyHotspotConfigCache = {};
  let wechatyHotspotStatusCache = {};
  let wechatyHotspotSelectedGroups = new Set();
  let wechatyReportPreviewUrl = '';
  let wechatyRecordsOffset = 0;
  let wechatyRecordsHasMore = false;
  let wechatyRecordsLastQuery = null;
  let wechatyRecordsToAutoNow = true;
  let wechatyStatsAutoRefreshTimer = null;
  const WECHATY_AMBIENT_LEVELS = [
    { id: "quiet", label: "安静" },
    { id: "normal", label: "正常" },
    { id: "active", label: "活跃" },
    { id: "crazy", label: "发疯" },
  ];
  const DEFAULT_WECHATY_AMBIENT_REPLY = {
    activityLevel: "normal",
    ambientQueueTtlSeconds: 120,
    levelProfiles: {
      quiet: { minScore: 65, minIntervalSeconds: 30, hourlyLimit: 0, consecutiveLimit: 0 },
      normal: { minScore: 50, minIntervalSeconds: 10, hourlyLimit: 0, consecutiveLimit: 0 },
      active: { minScore: 35, minIntervalSeconds: 3, hourlyLimit: 0, consecutiveLimit: 0 },
      crazy: { minScore: 20, minIntervalSeconds: 0, hourlyLimit: 0, consecutiveLimit: 0 },
    },
  };
  let wechatyAmbientDraft = JSON.parse(JSON.stringify(DEFAULT_WECHATY_AMBIENT_REPLY));

  function formatWechatyTime(value, full = false) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).replace('T', ' ').slice(0, full ? 19 : 16);
    const pad = n => String(n).padStart(2, '0');
    if (full) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function toDateTimeLocalValue(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function ensureWechatyRecordDefaultRange() {
    if (!wechatyRecordsFrom || !wechatyRecordsTo) return;
    // 默认“结束时间”必须跟随当前时间，否则设置页长开时新消息会被旧 to 时间过滤，
    // 页面看起来就像聊天记录库不更新。用户手动改过结束时间后才停止自动跟随。
    if (wechatyRecordsToAutoNow || !wechatyRecordsTo.value) {
      wechatyRecordsTo.value = toDateTimeLocalValue(new Date());
      wechatyRecordsToAutoNow = true;
    }
    if (!wechatyRecordsFrom.value) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      wechatyRecordsFrom.value = toDateTimeLocalValue(start);
    }
  }

  function setWechatyRecordTodayRange() {
    if (!wechatyRecordsFrom || !wechatyRecordsTo) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 0, 0);
    wechatyRecordsFrom.value = toDateTimeLocalValue(start);
    wechatyRecordsTo.value = toDateTimeLocalValue(end);
    wechatyRecordsToAutoNow = false;
  }

  function describeWechatyCachedSuffix(status = {}) {
    const parts = [];
    if (status.rooms_stale || wechatyRoomsAreStale) parts.push('下方是上次缓存，不代表当前在线，也不能自由回复');
    if (status.last_room_refresh_at) parts.push(`上次真实刷新 ${formatWechatyTime(status.last_room_refresh_at)}`);
    if (status.error) parts.push(`错误：${status.error}`);
    return parts.length ? `（${parts.join('；')}）` : '';
  }
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeWechatyAdminIds(value = "") {
    const raw = Array.isArray(value)
      ? value
      : String(value || "").split(/[，,;；\n\r\t ]+/);
    return [...new Set(raw.map(v => String(v || "").trim()).filter(Boolean))];
  }

  function getWechatyAdminMemberLabelById(id = "") {
    const key = String(id || "").trim();
    if (!key) return "";
    const member = wechatyAdminMemberCache.find(item => String(item.sender_id || "").trim() === key);
    const nickname = String(member?.display_name || member?.room_alias || member?.contact_alias || member?.contact_name || "").trim();
    if (nickname) return nickname;
    return `等待刷新昵称（${key.slice(0, 8)}…）`;
  }

  function syncWechatyAdminNicknameBox() {
    if (!wechatyAdminIds) return;
    const labels = [...wechatyAdminIdSet].map(id => getWechatyAdminMemberLabelById(id)).filter(Boolean);
    wechatyAdminIds.value = labels.join("\n");
    wechatyAdminIds.title = [...wechatyAdminIdSet].join("\n");
  }

  function applyWechatyAdminConfig(config = {}) {
    const hasAdminFields = Object.prototype.hasOwnProperty.call(config, "adminModeEnabled")
      || Object.prototype.hasOwnProperty.call(config, "adminWechatIds")
      || Object.prototype.hasOwnProperty.call(config, "adminIds");
    if (!hasAdminFields) {
      renderWechatyAdminMembers();
      return;
    }
    const ids = normalizeWechatyAdminIds(config.adminWechatIds || config.adminIds || []);
    wechatyAdminIdSet = new Set(ids);
    if (wechatyAdminEnabled) wechatyAdminEnabled.checked = config.adminModeEnabled === true;
    syncWechatyAdminNicknameBox();
    renderWechatyAdminMembers();
  }

  function collectWechatyAdminConfig() {
    const ids = [...wechatyAdminIdSet].map(id => String(id || "").trim()).filter(Boolean);
    syncWechatyAdminNicknameBox();
    return {
      adminModeEnabled: !!wechatyAdminEnabled?.checked,
      adminWechatIds: ids,
    };
  }

  function getWechatyBlockedMemberLabelById(id = "") {
    const key = String(id || "").trim();
    if (!key) return "";
    const member = wechatyAdminMemberCache.find(item => String(item.sender_id || "").trim() === key);
    const nickname = String(member?.display_name || member?.room_alias || member?.contact_alias || member?.contact_name || "").trim();
    if (nickname) return nickname;
    return `等待刷新昵称（${key.slice(0, 8)}…）`;
  }

  function syncWechatyBlockedNicknameBox() {
    if (!wechatyBlockedIds) return;
    const labels = [...wechatyBlockedIdSet].map(id => getWechatyBlockedMemberLabelById(id)).filter(Boolean);
    wechatyBlockedIds.value = labels.join("\n");
    wechatyBlockedIds.title = [...wechatyBlockedIdSet].join("\n");
  }

  function applyWechatyBlockedConfig(config = {}) {
    const hasBlockedFields = Object.prototype.hasOwnProperty.call(config, "blockedWechatIds")
      || Object.prototype.hasOwnProperty.call(config, "blockedIds")
      || Object.prototype.hasOwnProperty.call(config, "blocked_wechat_ids")
      || Object.prototype.hasOwnProperty.call(config, "blocked_ids");
    if (!hasBlockedFields) {
      renderWechatyBlockedMembers();
      return;
    }
    const ids = normalizeWechatyAdminIds(config.blockedWechatIds || config.blockedIds || config.blocked_wechat_ids || config.blocked_ids || []);
    wechatyBlockedIdSet = new Set(ids);
    syncWechatyBlockedNicknameBox();
    renderWechatyBlockedMembers();
  }

  function collectWechatyBlockedConfig() {
    const ids = [...wechatyBlockedIdSet].map(id => String(id || "").trim()).filter(Boolean);
    syncWechatyBlockedNicknameBox();
    return { blockedWechatIds: ids };
  }

  function collectWechatyOfflineQrNotifyConfig() {
    const cooldown = Number(wechatyOfflineQrNotifyCooldown?.value || 15);
    return {
      enabled: wechatyOfflineQrNotifyEnabled?.checked !== false,
      autoRelogin: wechatyOfflineQrNotifyAutoRelogin?.checked !== false,
      cooldownMinutes: [5, 10, 15, 30, 60].includes(cooldown) ? cooldown : 15,
    };
  }

  function normalizeWechatyConcurrencyLimit(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 6;
    return Math.min(20, Math.max(1, Math.floor(raw)));
  }

  function collectWechatyConcurrencyLimit() {
    return normalizeWechatyConcurrencyLimit(wechatyConcurrencyLimit?.value || 6);
  }

  function applyWechatyConcurrencyConfig(config = {}, status = {}) {
    const limit = normalizeWechatyConcurrencyLimit(config.concurrencyLimit ?? config.concurrency_limit ?? status.concurrency_limit ?? 6);
    if (wechatyConcurrencyLimit) wechatyConcurrencyLimit.value = String(limit);
    const worker = status.worker_state || {};
    const active = Number(worker.active || 0);
    const activeMention = Number(worker.active_mention ?? worker.activeMention ?? 0);
    const activeAmbient = Number(worker.active_ambient ?? worker.activeAmbient ?? 0);
    const pendingMention = Number(worker.pending_mention ?? worker.pendingMention ?? 0);
    const pendingAmbient = Number(worker.pending_ambient ?? worker.pendingAmbient ?? 0);
    if (wechatyConcurrencyStatus) {
      wechatyConcurrencyStatus.textContent = `当前已保存：${limit} 个；运行中 ${active} 个（@ ${activeMention} / 自由 ${activeAmbient}），排队 ${pendingMention + pendingAmbient} 个（@ ${pendingMention} / 自由 ${pendingAmbient}）`;
    }
  }

  function clampWechatyNumber(value, fallback, min, max) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(raw)));
  }

  function normalizeWechatyAmbientProfile(profile = {}, fallback = {}) {
    const raw = profile && typeof profile === "object" ? profile : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};
    return {
      minScore: clampWechatyNumber(raw.minScore ?? raw.min_score, base.minScore ?? 50, 0, 100),
      minIntervalSeconds: clampWechatyNumber(raw.minIntervalSeconds ?? raw.min_interval_seconds, base.minIntervalSeconds ?? 10, 0, 3600),
      hourlyLimit: clampWechatyNumber(raw.hourlyLimit ?? raw.hourly_limit, base.hourlyLimit ?? 0, 0, 999),
      consecutiveLimit: clampWechatyNumber(raw.consecutiveLimit ?? raw.consecutive_limit, base.consecutiveLimit ?? 0, 0, 99),
    };
  }

  function normalizeWechatyAmbientConfig(config = {}) {
    const raw = config && typeof config === "object" ? config : {};
    const profiles = raw.levelProfiles || raw.level_profiles || {};
    const levelIds = WECHATY_AMBIENT_LEVELS.map(item => item.id);
    const rawLevel = String((raw.activityLevel ?? raw.activity_level) || "");
    const activityLevel = levelIds.includes(rawLevel) ? rawLevel : DEFAULT_WECHATY_AMBIENT_REPLY.activityLevel;
    const levelProfiles = {};
    for (const item of WECHATY_AMBIENT_LEVELS) {
      levelProfiles[item.id] = normalizeWechatyAmbientProfile(profiles[item.id], DEFAULT_WECHATY_AMBIENT_REPLY.levelProfiles[item.id]);
    }
    return {
      activityLevel,
      ambientQueueTtlSeconds: clampWechatyNumber(raw.ambientQueueTtlSeconds ?? raw.ambient_queue_ttl_seconds, DEFAULT_WECHATY_AMBIENT_REPLY.ambientQueueTtlSeconds, 10, 600),
      levelProfiles,
    };
  }

  function unlimitedLabel(value, unit = "") {
    const n = Number(value || 0);
    return n === 0 ? "无限" : `${n}${unit}`;
  }

  function renderWechatyAmbientSummary() {
    const level = wechatyAmbientDraft.activityLevel || "normal";
    const profile = wechatyAmbientDraft.levelProfiles?.[level] || DEFAULT_WECHATY_AMBIENT_REPLY.levelProfiles.normal;
    const label = WECHATY_AMBIENT_LEVELS.find(item => item.id === level)?.label || "正常";
    if (wechatyAmbientStatus) wechatyAmbientStatus.textContent = label;
    if (wechatyAmbientSummary) {
      wechatyAmbientSummary.textContent = `当前 ${label}：阈值 ${profile.minScore}；最小间隔 ${profile.minIntervalSeconds} 秒；每小时 ${unlimitedLabel(profile.hourlyLimit)}；连续发言 ${unlimitedLabel(profile.consecutiveLimit)}。`;
    }
  }

  function renderWechatyAmbientProfileEditor() {
    if (!wechatyAmbientProfileEditor) return;
    wechatyAmbientProfileEditor.innerHTML = WECHATY_AMBIENT_LEVELS.map(level => {
      const profile = wechatyAmbientDraft.levelProfiles?.[level.id] || DEFAULT_WECHATY_AMBIENT_REPLY.levelProfiles[level.id];
      return `<div class="wechaty-ambient-profile-row" data-level="${level.id}">
        <div class="wechaty-ambient-profile-name">${level.label}</div>
        <label>接话阈值<input class="settings-input wechaty-ambient-input" type="number" min="0" max="100" step="1" data-level="${level.id}" data-field="minScore" value="${profile.minScore}"></label>
        <label>最小间隔<input class="settings-input wechaty-ambient-input" type="number" min="0" max="3600" step="1" data-level="${level.id}" data-field="minIntervalSeconds" value="${profile.minIntervalSeconds}"></label>
        <label>每小时上限<input class="settings-input wechaty-ambient-input" type="number" min="0" max="999" step="1" data-level="${level.id}" data-field="hourlyLimit" value="${profile.hourlyLimit}"></label>
        <label>连续上限<input class="settings-input wechaty-ambient-input" type="number" min="0" max="99" step="1" data-level="${level.id}" data-field="consecutiveLimit" value="${profile.consecutiveLimit}"></label>
      </div>`;
    }).join("");
    wechatyAmbientProfileEditor.querySelectorAll(".wechaty-ambient-input").forEach(input => {
      input.addEventListener("input", () => {
        const level = input.dataset.level;
        const field = input.dataset.field;
        if (!wechatyAmbientDraft.levelProfiles[level]) wechatyAmbientDraft.levelProfiles[level] = { ...DEFAULT_WECHATY_AMBIENT_REPLY.levelProfiles[level] };
        const limits = {
          minScore: [0, 100],
          minIntervalSeconds: [0, 3600],
          hourlyLimit: [0, 999],
          consecutiveLimit: [0, 99],
        }[field] || [0, 999];
        wechatyAmbientDraft.levelProfiles[level][field] = clampWechatyNumber(input.value, wechatyAmbientDraft.levelProfiles[level][field], limits[0], limits[1]);
        renderWechatyAmbientSummary();
      });
    });
  }

  function renderWechatyAmbientRules(rules = {}) {
    if (!wechatyAmbientRules) return;
    const renderRows = rows => (Array.isArray(rows) ? rows : []).map(row => `<tr><td>${escapeHtml(row.label || row.id || "")}</td><td>${escapeHtml(String(row.score ?? ""))}</td></tr>`).join("");
    const positive = rules.positive || [];
    const negative = rules.negative || [];
    wechatyAmbientRules.innerHTML = `
      <div class="wechaty-ambient-rule-table">
        <b>正向评分</b>
        <table><tbody>${renderRows(positive)}</tbody></table>
      </div>
      <div class="wechaty-ambient-rule-table">
        <b>负向 / 抑制</b>
        <table><tbody>${renderRows(negative)}</tbody></table>
      </div>`;
  }

  function renderWechatyAmbientLastDecision(decision = null) {
    if (!wechatyAmbientLast) return;
    if (!decision) {
      wechatyAmbientLast.textContent = "暂无判断记录。";
      return;
    }
    const reasons = (decision.reasons || []).join("、") || "—";
    const suppressions = (decision.suppressions || []).join("、") || "—";
    const time = formatWechatyTime(decision.timestamp || "", true) || "—";
    wechatyAmbientLast.innerHTML = `
      <span><b>群</b>${escapeHtml(decision.group_name || decision.groupName || "—")}</span>
      <span><b>发送人</b>${escapeHtml(decision.sender_name || decision.senderName || "—")}</span>
      <span><b>分数</b>${Number(decision.score || 0)} / ${Number(decision.threshold || 0)}</span>
      <span><b>结果</b>${decision.expired ? "排队过期" : (decision.triggered ? "触发" : "未触发")}</span>
      <span><b>原因</b>${escapeHtml(reasons)}</span>
      <span><b>抑制</b>${escapeHtml(suppressions)}</span>
      <span><b>时间</b>${escapeHtml(time)}</span>`;
  }

  function renderWechatyAmbientLastImageDecision(decision = null) {
    if (!wechatyAmbientImageLast) return;
    if (!decision) {
      wechatyAmbientImageLast.textContent = "暂无图片判断记录。";
      return;
    }
    const reasons = (decision.reasons || []).join("、") || "—";
    const suppressions = (decision.suppressions || []).join("、") || "—";
    const time = formatWechatyTime(decision.timestamp || "", true) || "—";
    wechatyAmbientImageLast.innerHTML = `
      <span><b>群</b>${escapeHtml(decision.group_name || decision.groupName || "—")}</span>
      <span><b>发送人</b>${escapeHtml(decision.sender_name || decision.senderName || "—")}</span>
      <span><b>图片</b>${Number(decision.media_id || decision.mediaId || 0) || "—"}</span>
      <span><b>识图</b>${escapeHtml(decision.vision_status || decision.visionStatus || "—")} / ${Number(decision.retry_count ?? decision.retryCount ?? 0)} 次</span>
      <span><b>结果</b>${decision.triggered ? "触发接话" : "放弃/未触发"}</span>
      <span><b>原因</b>${escapeHtml(reasons)}</span>
      <span><b>抑制</b>${escapeHtml(suppressions)}</span>
      <span><b>时间</b>${escapeHtml(time)}</span>`;
  }

  function applyWechatyAmbientConfig(config = {}, status = {}) {
    const ambientStatus = status.ambient_reply || {};
    const next = normalizeWechatyAmbientConfig(config.ambientReply || config.ambient_reply || ambientStatus.config || ambientStatus);
    const editingAmbient = (wechatyAmbientProfileEditor && wechatyAmbientProfileEditor.contains(document.activeElement))
      || document.activeElement === wechatyAmbientTtl
      || (wechatyAmbientLevels && wechatyAmbientLevels.contains(document.activeElement));
    if (!editingAmbient) {
      wechatyAmbientDraft = JSON.parse(JSON.stringify(next));
      if (wechatyAmbientTtl) wechatyAmbientTtl.value = String(next.ambientQueueTtlSeconds);
      wechatyAmbientLevels?.querySelectorAll('input[name="wechaty-ambient-level"]').forEach(input => {
        input.checked = input.value === next.activityLevel;
      });
      renderWechatyAmbientProfileEditor();
    }
    renderWechatyAmbientSummary();
    renderWechatyAmbientRules(ambientStatus.rules || {});
    renderWechatyAmbientLastDecision(ambientStatus.last_decision || null);
    renderWechatyAmbientLastImageDecision(ambientStatus.last_image_decision || null);
  }

  function collectWechatyAmbientConfig() {
    const selectedLevel = wechatyAmbientLevels?.querySelector('input[name="wechaty-ambient-level"]:checked')?.value || wechatyAmbientDraft.activityLevel || "normal";
    const collected = normalizeWechatyAmbientConfig({
      ...wechatyAmbientDraft,
      activityLevel: selectedLevel,
      ambientQueueTtlSeconds: wechatyAmbientTtl?.value || wechatyAmbientDraft.ambientQueueTtlSeconds,
    });
    if (wechatyAmbientProfileEditor) {
      wechatyAmbientProfileEditor.querySelectorAll(".wechaty-ambient-input").forEach(input => {
        const level = input.dataset.level;
        const field = input.dataset.field;
        if (!collected.levelProfiles[level]) collected.levelProfiles[level] = { ...DEFAULT_WECHATY_AMBIENT_REPLY.levelProfiles[level] };
        const limits = {
          minScore: [0, 100],
          minIntervalSeconds: [0, 3600],
          hourlyLimit: [0, 999],
          consecutiveLimit: [0, 99],
        }[field] || [0, 999];
        collected.levelProfiles[level][field] = clampWechatyNumber(input.value, collected.levelProfiles[level][field], limits[0], limits[1]);
      });
    }
    wechatyAmbientDraft = JSON.parse(JSON.stringify(collected));
    renderWechatyAmbientSummary();
    return collected;
  }

  function markWechatyOfflineQrNotifyEdited() {
    wechatyOfflineQrNotifyLastEditAt = Date.now();
  }

  async function saveWechatyOfflineQrNotifySettings({ silent = false } = {}) {
    markWechatyOfflineQrNotifyEdited();
    const payload = collectWechatyOfflineQrNotifyConfig();
    const seq = ++wechatyOfflineQrNotifySaveSeq;
    if (wechatyOfflineQrNotifyStatus) {
      wechatyOfflineQrNotifyStatus.textContent = "保存中";
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state ok";
    }
    try {
      const res = await fetch(`${API}/settings/social/wechaty-duty-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offline_qr_notify: payload }),
      });
      const data = await res.json();
      if (seq !== wechatyOfflineQrNotifySaveSeq) return;
      if (data.ok) {
        applyWechatyOfflineQrNotifyConfig(data.wechatyDutyGroup || { offlineQrNotify: payload }, data.status || {}, { forceControls: true, controlOverride: payload });
        if (!silent) showFeedback(wechatyDutyFeedback, `掉线二维码通知已保存：重复间隔 ${payload.cooldownMinutes} 分钟`);
      } else if (!silent) {
        showFeedback(wechatyDutyFeedback, data.error || "保存掉线通知失败", true);
      }
    } catch {
      if (!silent) showFeedback(wechatyDutyFeedback, "保存掉线通知请求失败", true);
    }
  }

  function queueWechatyOfflineQrNotifySave() {
    markWechatyOfflineQrNotifyEdited();
    if (wechatyOfflineQrNotifySaveTimer) clearTimeout(wechatyOfflineQrNotifySaveTimer);
    wechatyOfflineQrNotifySaveTimer = setTimeout(() => {
      wechatyOfflineQrNotifySaveTimer = null;
      saveWechatyOfflineQrNotifySettings({ silent: false });
    }, 80);
  }

  async function testWechatyOfflineQrNotifyNow() {
    await saveWechatyOfflineQrNotifySettings({ silent: true });
    if (wechatyOfflineQrNotifyTestBtn) wechatyOfflineQrNotifyTestBtn.disabled = true;
    if (wechatyOfflineQrNotifyStatus) {
      wechatyOfflineQrNotifyStatus.textContent = "发送中";
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state ok";
    }
    try {
      const res = await fetch(`${API}/social/wechaty-duty-group/offline-qr-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual_test", force: true }),
      });
      const data = await res.json();
      applyWechatyOfflineQrNotifyConfig({ offlineQrNotify: collectWechatyOfflineQrNotifyConfig() }, data.status || {}, { forceControls: false });
      const reason = data.result?.reason || data.error || "";
      if (data.ok) {
        showFeedback(wechatyDutyFeedback, "已通过 ClawBot 立即发送登录二维码");
      } else if (reason === "qr_generation_requested") {
        showFeedback(wechatyDutyFeedback, "当前暂无二维码，已触发重新生成；二维码出来后会自动发送");
      } else if (reason === "disabled") {
        showFeedback(wechatyDutyFeedback, "掉线二维码通知已关闭，请先开启", true);
      } else if (reason === "no_qr") {
        showFeedback(wechatyDutyFeedback, "当前没有可发送的登录二维码", true);
      } else {
        showFeedback(wechatyDutyFeedback, data.error || data.result?.error || "发送测试通知失败", true);
      }
    } catch {
      showFeedback(wechatyDutyFeedback, "发送测试通知请求失败", true);
    } finally {
      if (wechatyOfflineQrNotifyTestBtn) wechatyOfflineQrNotifyTestBtn.disabled = false;
    }
  }


  function setWechatyStatus(text, ok = false) {
    if (!wechatyDutyStatus) return;
    wechatyDutyStatus.textContent = `${ok ? "●" : "○"} ${text}`;
    wechatyDutyStatus.className = `settings-platform-status ${ok ? "ok" : "miss"}`;
  }

  function normalizePersonaPrompt(value = "") {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  function getActiveWechatyPersonaPreset(prompt = "") {
    const normalized = normalizePersonaPrompt(prompt);
    return wechatyPersonaPresetCache.find(preset => normalizePersonaPrompt(preset.prompt) === normalized) || null;
  }

  function describeWechatyPersona(prompt = "", presetId = "") {
    const matched = getActiveWechatyPersonaPreset(prompt);
    if (matched) return { id: matched.id, name: matched.name, matched: true };
    const savedPreset = wechatyPersonaPresetCache.find(preset => preset.id === presetId);
    if (savedPreset && normalizePersonaPrompt(prompt) === normalizePersonaPrompt(savedPreset.prompt)) {
      return { id: savedPreset.id, name: savedPreset.name, matched: true };
    }
    return { id: "custom", name: "自定义性格", matched: false };
  }

  function updateWechatyPersonaCurrentStatus() {
    const prompt = wechatyPersonaPrompt?.value || "";
    const current = describeWechatyPersona(wechatySavedPersonaPrompt || prompt, wechatySavedPersonaPresetId);
    const dirty = normalizePersonaPrompt(prompt) !== normalizePersonaPrompt(wechatySavedPersonaPrompt);
    if (wechatyPersonaCurrentName) wechatyPersonaCurrentName.textContent = current.name;
    if (wechatyPersonaCurrentState) {
      wechatyPersonaCurrentState.textContent = dirty ? "有未保存修改" : "已生效";
      wechatyPersonaCurrentState.className = dirty ? "dirty" : "saved";
    }
  }

  function updateWechatyPersonaActiveLabel(prompt = wechatyPersonaPrompt?.value || "") {
    if (!wechatyPersonaActive) return;
    const active = getActiveWechatyPersonaPreset(prompt);
    const dirty = normalizePersonaPrompt(prompt) !== normalizePersonaPrompt(wechatySavedPersonaPrompt);
    wechatyPersonaActive.textContent = active ? `编辑中：${active.name}${dirty ? "（未保存）" : ""}` : `编辑中：自定义性格${dirty ? "（未保存）" : ""}`;
    wechatyPersonaActive.className = active ? "matched" : "custom";
    wechatyPersonaPresets?.querySelectorAll(".wechaty-persona-preset").forEach(btn => {
      const isActive = active?.id === btn.dataset.presetId || (!active && btn.dataset.presetId === "custom");
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      const badge = btn.querySelector?.(".wechaty-persona-live-badge");
      if (badge) badge.textContent = isActive ? (dirty ? "待保存" : "正在使用") : "";
    });
    updateWechatyPersonaCurrentStatus();
  }

  function renderWechatyPersonaPresets(presets = [], currentPrompt = "") {
    wechatyPersonaPresetCache = Array.isArray(presets) ? presets.filter(p => p?.id && p?.prompt) : [];
    if (!wechatyPersonaPresets) return;
    if (!wechatyPersonaPresetCache.length) {
      wechatyPersonaPresets.innerHTML = '<div class="wechaty-empty">暂无可用性格预设，可直接手动编辑提示词。</div>';
      updateWechatyPersonaActiveLabel(currentPrompt);
      return;
    }
    const presetCards = wechatyPersonaPresetCache.map(preset => `
      <button class="wechaty-persona-preset" type="button" data-preset-id="${escapeHtml(preset.id)}" aria-pressed="false">
        <span class="wechaty-persona-preset-top"><b>${escapeHtml(preset.name)}</b><em>${escapeHtml(preset.badge || "预设")}</em></span>
        <span class="wechaty-persona-preset-summary">${escapeHtml(preset.summary || "点击套用这个微信群助手性格。")}</span>
        <span class="wechaty-persona-live-badge"></span>
      </button>
    `);
    presetCards.push(`
      <button class="wechaty-persona-preset custom" type="button" data-preset-id="custom" aria-pressed="false">
        <span class="wechaty-persona-preset-top"><b>自定义性格</b><em>自定义</em></span>
        <span class="wechaty-persona-preset-summary">保留下方手写提示词，可自由设定说话风格、边界和群聊人设。</span>
        <span class="wechaty-persona-live-badge"></span>
      </button>
    `);
    wechatyPersonaPresets.innerHTML = presetCards.join("");
    updateWechatyPersonaActiveLabel(currentPrompt);
  }

  function applyWechatyPersonaPreset(presetId = "") {
    if (presetId === "custom") {
      wechatyPersonaPrompt?.focus?.();
      updateWechatyPersonaActiveLabel(wechatyPersonaPrompt?.value || "");
      showFeedback(wechatyDutyFeedback, "已切到自定义性格，编辑后点击保存并生效");
      return;
    }
    const preset = wechatyPersonaPresetCache.find(item => item.id === presetId);
    if (!preset || !wechatyPersonaPrompt) return;
    wechatyPersonaPrompt.value = preset.prompt || "";
    updateWechatyPersonaActiveLabel(wechatyPersonaPrompt.value);
    showFeedback(wechatyDutyFeedback, `已套用「${preset.name}」，点击保存并生效`);
  }

  function applyHonchoConfig(config = {}, runtime = {}) {
    const next = {
      enabled: config.enabled === true,
      environment: config.environment || 'local',
      baseURL: config.baseURL || 'http://127.0.0.1:8018',
      appId: config.appId || runtime.workspaceId || 'bailongma-wechat-memory',
      appName: config.appName || 'BaiLongma WeChat Memory',
    };
    if (honchoEnabled) honchoEnabled.checked = next.enabled;
    if (honchoEnvironment) honchoEnvironment.value = next.environment;
    if (honchoBaseUrl) honchoBaseUrl.value = next.baseURL;
    if (honchoAppId) honchoAppId.value = next.appId;
    if (honchoAppName) honchoAppName.value = next.appName;
    if (honchoStatus) {
      const local = runtime?.provider === 'local' || runtime?.environment === 'embedded';
      const ok = local || (!!runtime?.enabled && !!runtime?.configured);
      honchoStatus.textContent = local
        ? `● 内置本地记忆已启用 · ${runtime.workspaceId || 'bailongma-local-memory'}`
        : (ok ? `● 已接通 · ${runtime.baseURL || next.baseURL} · ${runtime.workspaceId || next.appId}` : '○ 外部 Honcho 未启用；本地记忆仍可正常工作');
      honchoStatus.className = `settings-platform-status ${ok ? 'ok' : 'miss'}`;
    }
  }

  function applyWechatyDigestConfig(config = {}) {
    wechatyDigestConfigCache = { ...config };
    wechatyDigestSelectedGroups = new Set((config.selectedGroups || config.selected_groups || []).map(v => String(v || "").trim()).filter(Boolean));
    if (wechatyDigestEnabled) wechatyDigestEnabled.checked = config.enabled !== false;
    if (wechatyDigestIntervalEnabled) wechatyDigestIntervalEnabled.checked = config.intervalEnabled === true;
    if (wechatyDigestInterval) wechatyDigestInterval.value = String(config.intervalMinutes || 180);
    if (wechatyDigestDailyEnabled) wechatyDigestDailyEnabled.checked = config.dailyStatsEnabled !== false;
    if (wechatyDigestDailyTime) wechatyDigestDailyTime.value = config.dailyStatsTime || "00:00";
    if (wechatyRankMessage) wechatyRankMessage.checked = config.messageLeaderboard !== false;
    if (wechatyRankImage) wechatyRankImage.checked = config.imageLeaderboard !== false;
    if (wechatyRankEmoji) wechatyRankEmoji.checked = config.emojiLeaderboard !== false;
    if (wechatyRankLink) wechatyRankLink.checked = config.linkLeaderboard !== false;
    if (wechatyRankBrag) wechatyRankBrag.checked = config.bragLeaderboard !== false;
    if (wechatyReportTemplate) wechatyReportTemplate.value = config.reportTemplate || config.report_template || 'guochao-red-gold';
    renderWechatyDigestGroups();
    refreshWechatyReportPreview();
  }

  function collectWechatyDigestConfig() {
    syncWechatyDigestSelectedGroupsFromDom();
    return {
      enabled: !!wechatyDigestEnabled?.checked,
      selectedGroups: [...wechatyDigestSelectedGroups],
      intervalEnabled: !!wechatyDigestIntervalEnabled?.checked,
      intervalMinutes: Number(wechatyDigestInterval?.value || 180),
      dailyStatsEnabled: !!wechatyDigestDailyEnabled?.checked,
      dailyStatsTime: wechatyDigestDailyTime?.value || "00:00",
      messageLeaderboard: !!wechatyRankMessage?.checked,
      imageLeaderboard: !!wechatyRankImage?.checked,
      emojiLeaderboard: !!wechatyRankEmoji?.checked,
      linkLeaderboard: !!wechatyRankLink?.checked,
      bragLeaderboard: !!wechatyRankBrag?.checked,
      reportTemplate: wechatyReportTemplate?.value || 'guochao-red-gold',
    };
  }

  function groupDigestId(group = {}) {
    return String(group.topic || "").trim() || memoryGroupRequestId(group);
  }

  function isWechatyDigestGroupSelected(group = {}) {
    const topic = String(group.topic || "").trim();
    const stable = groupDigestId(group);
    const requestId = memoryGroupRequestId(group);
    return wechatyDigestSelectedGroups.has(stable)
      || wechatyDigestSelectedGroups.has(requestId)
      || (!!topic && wechatyDigestSelectedGroups.has(`wechaty:${topic}`));
  }

  function updateWechatyDigestGroupCount() {
    syncWechatyDigestSelectedGroupsFromDom();
    if (!wechatyDigestGroupCount) return;
    const selected = getWechatyDigestCandidateGroups().filter(group => isWechatyDigestGroupSelected(group));
    wechatyDigestGroupCount.textContent = selected.length
      ? `已选择 ${selected.length} 个群`
      : "未选择，不会统计/不会定时发送";
  }

  function renderWechatyDigestGroups() {
    if (!wechatyDigestGroupList) return;
    const groups = getWechatyDigestCandidateGroups();
    if (!groups.length) {
      wechatyDigestGroupList.innerHTML = '<div class="wechaty-empty">还没有识别到微信群。登录微信或收到群消息后会自动出现。</div>';
      updateWechatyDigestGroupCount();
      return;
    }
    wechatyDigestGroupList.innerHTML = groups.map(group => {
      const gid = groupDigestId(group);
      const checked = isWechatyDigestGroupSelected(group) ? " checked" : "";
      const stale = group.stale ? " stale" : "";
      const stat = group.selected ? "已开启自由回复，可参与统计" : (group.knownOnly ? "已识别/有记录，未开启自由回复" : "未开启自由回复");
      const requestId = memoryGroupRequestId(group);
      return `<label class="wechaty-digest-group-item${stale}" title="${escapeHtml(gid)}">
        <input class="wechaty-digest-group-checkbox" type="checkbox" value="${escapeHtml(gid)}" data-group-id="${escapeHtml(gid)}" data-request-id="${escapeHtml(requestId)}" data-group-name="${escapeHtml(group.topic || "")}"${checked}>
        <span><b>${escapeHtml(group.topic || "未命名群")}</b><em>${escapeHtml(stat)}</em></span>
      </label>`;
    }).join("");
    updateWechatyDigestGroupCount();
  }

  function syncWechatyDigestSelectedGroupsFromDom() {
    if (!wechatyDigestGroupList) return;
    const checkboxes = [...wechatyDigestGroupList.querySelectorAll(".wechaty-digest-group-checkbox")];
    if (!checkboxes.length) return;
    wechatyDigestSelectedGroups = new Set(checkboxes
      .filter(cb => cb.checked)
      .map(cb => String(cb.dataset.groupId || cb.value || "").trim())
      .filter(Boolean));
  }

  function getWechatyHotspotCandidateGroups() {
    return getWechatyDigestCandidateGroups();
  }

  function isWechatyHotspotGroupSelected(group = {}) {
    const topic = String(group.topic || "").trim();
    const stable = groupDigestId(group);
    const requestId = memoryGroupRequestId(group);
    return wechatyHotspotSelectedGroups.has(stable)
      || wechatyHotspotSelectedGroups.has(requestId)
      || (!!topic && wechatyHotspotSelectedGroups.has(`wechaty:${topic}`));
  }

  function syncWechatyHotspotSelectedGroupsFromDom() {
    if (!wechatyHotspotGroupList) return;
    const checkboxes = [...wechatyHotspotGroupList.querySelectorAll(".wechaty-hotspot-group-checkbox")];
    if (!checkboxes.length) return;
    wechatyHotspotSelectedGroups = new Set(checkboxes
      .filter(cb => cb.checked)
      .map(cb => String(cb.dataset.groupId || cb.value || "").trim())
      .filter(Boolean));
  }

  function updateWechatyHotspotGroupCount() {
    syncWechatyHotspotSelectedGroupsFromDom();
    if (!wechatyHotspotGroupCount) return;
    const selected = getWechatyHotspotCandidateGroups().filter(group => isWechatyHotspotGroupSelected(group));
    wechatyHotspotGroupCount.textContent = selected.length
      ? `已选择 ${selected.length} 个群`
      : "未选择，不会推送";
  }

  function formatWechatyHotspotStatus(status = {}, config = wechatyHotspotConfigCache) {
    const enabled = config.enabled === true;
    const scheduler = status.scheduler_running ? "调度器已启动" : "调度器未启动";
    const last = status.last_check_at ? `上次检查 ${formatWechatyTime(status.last_check_at)}` : "尚未检查";
    const next = status.next_check_at ? `下次 ${formatWechatyTime(status.next_check_at)}` : "未安排下次检查";
    const error = status.last_error ? `；错误：${status.last_error}` : "";
    return `${enabled ? "已启用" : "已关闭"} · ${scheduler} · ${last} · ${next}${error}`;
  }

  function renderWechatyHotspotGroups() {
    if (!wechatyHotspotGroupList) return;
    const groups = getWechatyHotspotCandidateGroups();
    if (!groups.length) {
      wechatyHotspotGroupList.innerHTML = '<div class="wechaty-empty">还没有识别到微信群。登录微信或收到群消息后会自动出现。</div>';
      updateWechatyHotspotGroupCount();
      return;
    }
    wechatyHotspotGroupList.innerHTML = groups.map(group => {
      const gid = groupDigestId(group);
      const checked = isWechatyHotspotGroupSelected(group) ? " checked" : "";
      const stale = group.stale ? " stale" : "";
      const stat = group.selected ? "已开启自由回复，可接收舆情" : (group.knownOnly ? "已识别/有记录，未开启自由回复" : "未开启自由回复");
      const requestId = memoryGroupRequestId(group);
      return `<label class="wechaty-digest-group-item${stale}" title="${escapeHtml(gid)}">
        <input class="wechaty-hotspot-group-checkbox" type="checkbox" value="${escapeHtml(gid)}" data-group-id="${escapeHtml(gid)}" data-request-id="${escapeHtml(requestId)}" data-group-name="${escapeHtml(group.topic || "")}"${checked}>
        <span><b>${escapeHtml(group.topic || "未命名群")}</b><em>${escapeHtml(stat)}</em></span>
      </label>`;
    }).join("");
    updateWechatyHotspotGroupCount();
  }

  function applyWechatyHotspotConfig(config = {}, status = {}) {
    wechatyHotspotConfigCache = { ...config };
    wechatyHotspotStatusCache = { ...status };
    wechatyHotspotSelectedGroups = new Set((config.selectedGroups || config.selected_groups || []).map(v => String(v || "").trim()).filter(Boolean));
    if (wechatyHotspotEnabled) wechatyHotspotEnabled.checked = config.enabled === true;
    if (wechatyHotspotInterval) wechatyHotspotInterval.value = String(config.intervalMinutes || 10);
    if (wechatyHotspotMode) wechatyHotspotMode.value = config.notifyMode || "changes";
    if (wechatyHotspotTopN) wechatyHotspotTopN.value = String(config.topN || 10);
    if (wechatyHotspotRankRise) wechatyHotspotRankRise.value = String(config.rankRiseThreshold || 5);
    if (wechatyHotspotDedupeHours) wechatyHotspotDedupeHours.value = String(config.dedupeHours || 6);
    if (wechatyHotspotKeywords) wechatyHotspotKeywords.value = (config.keywords || []).join("\n");
    const platforms = new Set(config.platforms || ["douyin", "xiaohongshu", "wechat", "weibo"]);
    document.querySelectorAll(".wechaty-hotspot-platform").forEach(input => {
      input.checked = platforms.has(input.value);
    });
    if (wechatyHotspotStatus) wechatyHotspotStatus.textContent = formatWechatyHotspotStatus(status, config);
    renderWechatyHotspotGroups();
  }

  function collectWechatyHotspotConfig() {
    syncWechatyHotspotSelectedGroupsFromDom();
    const platforms = [...document.querySelectorAll(".wechaty-hotspot-platform")]
      .filter(input => input.checked)
      .map(input => input.value)
      .filter(Boolean);
    const keywords = String(wechatyHotspotKeywords?.value || "")
      .split(/[\n,，;；]+/u)
      .map(item => item.trim())
      .filter(Boolean);
    return {
      enabled: !!wechatyHotspotEnabled?.checked,
      intervalMinutes: Number(wechatyHotspotInterval?.value || 10),
      notifyMode: wechatyHotspotMode?.value || "changes",
      selectedGroups: [...wechatyHotspotSelectedGroups],
      platforms,
      keywords,
      topN: Number(wechatyHotspotTopN?.value || 10),
      rankRiseThreshold: Number(wechatyHotspotRankRise?.value || 5),
      dedupeHours: Number(wechatyHotspotDedupeHours?.value || 6),
    };
  }

  function renderWechatyHotspotResult(data = {}) {
    if (!wechatyHotspotResult) return;
    if (!data || !Object.keys(data).length) {
      wechatyHotspotResult.textContent = "手动检查结果会显示在这里。";
      return;
    }
    const events = Array.isArray(data.events) ? data.events : [];
    const notify = data.notify || {};
    const lines = [
      data.ok ? `检查完成：发现 ${events.length} 条舆情事件` : `检查失败：${data.error || "未知错误"}`,
      data.checked_at ? `时间：${formatWechatyTime(data.checked_at, true)}` : "",
      data.baseline_only ? "首次检查只建立基线，不自动推送。" : "",
      notify.skipped ? `通知：跳过（${notify.reason || "无通知"}）` : "",
      notify.groups?.length ? `通知群：${notify.groups.map(group => `${group.groupName || group.roomId}${group.ok ? "" : "（失败）"}`).join("、")}` : "",
      ...events.slice(0, 8).map(event => `${event.platformLabel || event.platform} #${event.rank} ${event.title}`),
    ].filter(Boolean);
    wechatyHotspotResult.textContent = lines.join("\n") || "没有检测到变化。";
  }

  async function loadWechatyHotspotSettings({ silent = true } = {}) {
    if (!wechatyHotspotStatus && !wechatyHotspotGroupList) return;
    try {
      const data = await fetch(`${API}/settings/hotspot-alerts`).then(r => r.json());
      if (data.ok) {
        applyWechatyHotspotConfig(data.config || {}, data.status || {});
      } else if (!silent) {
        showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, data.error || "读取舆情推送设置失败", true);
      }
    } catch {
      if (!silent) showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, "读取舆情推送设置请求失败", true);
    }
  }

  async function saveWechatyHotspotSettings({ silent = false } = {}) {
    if (!wechatySaveHotspotBtn) return;
    wechatySaveHotspotBtn.disabled = true;
    try {
      const payload = collectWechatyHotspotConfig();
      const res = await fetch(`${API}/settings/hotspot-alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        applyWechatyHotspotConfig(data.config || payload, data.status || {});
        const count = (data.config?.selectedGroups || payload.selectedGroups || []).length;
        if (!silent) showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, count ? `舆情推送设置已保存，已选择 ${count} 个群` : "已保存：未选择群组，所以不会推送");
      } else if (!silent) {
        showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, data.error || "保存失败", true);
      }
    } catch {
      if (!silent) showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, "保存舆情推送设置失败", true);
    } finally {
      wechatySaveHotspotBtn.disabled = false;
    }
  }

  async function runWechatyHotspotCheck({ notify = false } = {}) {
    await saveWechatyHotspotSettings({ silent: true });
    const btn = notify ? wechatyHotspotNotifyBtn : wechatyHotspotCheckBtn;
    if (btn) btn.disabled = true;
    if (wechatyHotspotResult) wechatyHotspotResult.textContent = notify ? "正在检查舆情并推送微信群…" : "正在检查舆情变化…";
    try {
      const res = await fetch(`${API}/settings/hotspot-alerts/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify, forceNotify: notify }),
      });
      const data = await res.json();
      if (data.config || data.status) applyWechatyHotspotConfig(data.config || wechatyHotspotConfigCache, data.status || {});
      renderWechatyHotspotResult(data);
      if (data.ok) {
        const failedNotify = notify && data.notify && data.notify.ok === false && !data.notify.skipped;
        const skippedNotify = notify && data.notify?.skipped;
        const message = failedNotify
          ? `检查完成，但通知未发送：${data.notify.reason || "没有可通知群"}`
          : skippedNotify
            ? `检查完成，通知跳过：${data.notify.reason || "无变化"}`
            : notify ? "检查完成，已按配置推送微信群" : "检查完成";
        showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, message, failedNotify);
      } else {
        showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, data.error || "检测失败", true);
      }
    } catch {
      if (wechatyHotspotResult) wechatyHotspotResult.textContent = "舆情检查请求失败";
      showFeedback(wechatyHotspotFeedback || wechatyDutyFeedback, "舆情检查请求失败", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function fitWechatyReportPreviewFrames() {
    const stages = document.querySelectorAll(".wechaty-report-preview-stage");
    stages.forEach(stage => {
      const width = stage.clientWidth || stage.getBoundingClientRect().width || 0;
      if (!width) return;
      stage.style.setProperty("--report-preview-scale", String(width / 1080));
    });
  }

  let wechatyReportPreviewFitObserver = null;
  function observeWechatyReportPreviewFrames() {
    fitWechatyReportPreviewFrames();
    if (wechatyReportPreviewFitObserver) wechatyReportPreviewFitObserver.disconnect();
    if (typeof ResizeObserver !== "function") return;
    wechatyReportPreviewFitObserver = new ResizeObserver(fitWechatyReportPreviewFrames);
    document.querySelectorAll(".wechaty-report-preview-stage").forEach(stage => wechatyReportPreviewFitObserver.observe(stage));
  }

  function refreshWechatyReportPreview() {
    if (!wechatyReportPreview) return;
    syncWechatyDigestSelectedGroupsFromDom();
    const selectedGroups = getWechatySelectedDigestGroups();
    const fallbackGroup = getWechatyMemoryCandidateGroups().find(group => memoryGroupRequestId(group) === wechatyActiveMemoryGroupId || group.topic === wechatyActiveMemoryGroupName);
    const groups = selectedGroups.length ? selectedGroups : (fallbackGroup ? [fallbackGroup] : []);
    if (!groups.length) {
      wechatyReportPreview.innerHTML = '<div class="wechaty-empty">请在“选择参与统计/定时总结的群组”里勾选群，或手动选择一个群后刷新统计。</div>';
      return;
    }
    const template = wechatyReportTemplate?.value || wechatyDigestConfigCache.reportTemplate || 'guochao-red-gold';
    const next = groups.map(group => `${memoryGroupRequestId(group)}|${group.topic || ''}|${template}`).join('||');
    if (wechatyReportPreviewUrl === next && wechatyReportPreview.dataset.renderKey === next) return;
    wechatyReportPreviewUrl = next;
    wechatyReportPreview.dataset.renderKey = next;
    wechatyReportPreview.innerHTML = groups.map(group => {
      const groupId = memoryGroupRequestId(group);
      const groupName = group.topic || '';
      const params = new URLSearchParams({
        group_id: groupId,
        group_name: groupName,
        range: 'today',
        limit: '10',
        template,
      });
      return `<article class="wechaty-report-preview-card" data-group-id="${escapeHtml(groupId)}" data-group-name="${escapeHtml(groupName)}" title="点击切换到该群记录库">
        <div class="wechaty-report-preview-card-head">
          <b>${escapeHtml(groupName || groupId)}</b>
          <span>独立战报 · ${escapeHtml(template)}</span>
        </div>
        <div class="wechaty-report-preview-stage">
          <iframe class="wechaty-report-preview-frame" title="${escapeHtml(groupName || groupId)} 战报预览" loading="lazy" src="${API}/social/wechat-groups/report/html?${params}"></iframe>
        </div>
      </article>`;
    }).join('');
    requestAnimationFrame(observeWechatyReportPreviewFrames);
  }

  function renderRank(title, rows = [], unit = "次", { showGroup = false } = {}) {
    const body = rows?.length
      ? rows.slice(0, 8).map((row, index) => `<li><b>${index + 1}</b><span>${escapeHtml(row.name || "未知成员")}${showGroup && row.group_name ? `<small>${escapeHtml(row.group_name)}</small>` : ""}</span><em>${escapeHtml(String(row.value || 0))}${unit}</em></li>`).join("")
      : `<li class="empty"><span>暂无数据</span></li>`;
    return `<section class="wechaty-rank-card"><h5>${escapeHtml(title)}</h5><ol>${body}</ol></section>`;
  }

  function renderWechatyStats(data = null) {
    if (!wechatyStatsCards || !wechatyLeaderboards) return;
    if (!data || data.ok === false) {
      wechatyStatsCards.innerHTML = `<div class="wechaty-empty">${escapeHtml(data?.error || "选择一个群后点击“刷新统计”。")}</div>`;
      wechatyLeaderboards.innerHTML = "";
      if (wechatyStatsRecent) wechatyStatsRecent.innerHTML = "";
      if (wechatyStatsScopeLabel) wechatyStatsScopeLabel.textContent = "当前查看：未选择群";
      return;
    }
    const totals = data.totals || {};
    const multi = data.mode === "multi";
    if (wechatyStatsScopeLabel) {
      const groupTitle = multi
        ? `已选统计群总览：${data.group_count || 0} 个群；排行榜每行都显示来源群`
        : `当前查看：${data.group_name || wechatyActiveMemoryGroupName || data.group_id || "未命名群"}`;
      wechatyStatsScopeLabel.textContent = groupTitle;
    }
    const cards = [
      ["消息", totals.message_count || 0, "全量群消息"],
      ["参与", totals.participant_count || 0, "发言人数"],
      ["图片", totals.image_count || 0, "发图/媒体"],
      ["表情", totals.emoji_count || 0, "表情包/emoji"],
      ["链接", totals.link_count || 0, "URL/小程序"],
      ["装逼", totals.brag_count || 0, "启发式次数"],
    ];
    wechatyStatsCards.innerHTML = cards.map(([label, value, sub]) => `<div class="wechaty-stat-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b><em>${escapeHtml(sub)}</em></div>`).join("");
    const boards = data.leaderboards || {};
    wechatyLeaderboards.innerHTML = [
      renderRank("💬 发言排行榜", boards.messages, "条", { showGroup: multi }),
      renderRank("🖼 发图排行榜", boards.images, "张", { showGroup: multi }),
      renderRank("😄 表情排行榜", boards.emojis, "个", { showGroup: multi }),
      renderRank("🔗 链接排行榜", boards.links, "条", { showGroup: multi }),
      renderRank("😎 装逼排行榜", boards.brag, "次", { showGroup: multi }),
    ].join("") + (multi && Array.isArray(data.groups)
      ? `<section class="wechaty-stats-groups-overview">
          <h5>按群拆分</h5>
          ${data.groups.map(group => `<div class="wechaty-stats-group-row">
            <b>${escapeHtml(group.group_name || group.group_id || "未命名群")}</b>
            <span>${escapeHtml(String(group.totals?.message_count || 0))} 条 · ${escapeHtml(String(group.totals?.participant_count || 0))} 人 · 图 ${escapeHtml(String(group.totals?.image_count || 0))} · 表 ${escapeHtml(String(group.totals?.emoji_count || 0))} · 链 ${escapeHtml(String(group.totals?.link_count || 0))}</span>
          </div>`).join("")}
        </section>`
      : "");
    if (wechatyStatsRecent) {
      const recent = Array.isArray(data.recent) ? data.recent.slice(-40).reverse() : [];
      const selected = multi || wechatyDigestSelectedGroups.has(wechatyActiveMemoryGroupName) || wechatyDigestSelectedGroups.has(wechatyActiveMemoryGroupId);
      const rows = recent.length
        ? recent.map(row => `<article class="wechaty-stats-row">
            <b>${escapeHtml(row.sender_name || row.sender_id || "群成员")}${multi && row.group_name ? ` · ${escapeHtml(row.group_name)}` : ""}</b>
            <p>${escapeHtml(row.display_text || "")}</p>
            <span>${escapeHtml(row.timestamp_display || formatWechatyTime(row.timestamp, true))} · ${escapeHtml(row.message_type || "message")} · 图${row.image_count || 0}/表${row.emoji_count || 0}/链${row.link_count || 0}/装${row.brag_score || 0}</span>
          </article>`).join("")
        : `<div class="wechaty-empty">${selected ? "今天还没有写入本地统计库的新消息。统计只记录你在这里勾选并保存之后收到的新消息。" : "本群未勾选参与统计/定时总结，所以不会写入本地统计库。"}</div>`;
      wechatyStatsRecent.innerHTML = `<section class="wechaty-stats-storage-note">
        <b>统计数据位置</b>
        <span>这里的数据存放在本机 SQLite：${escapeHtml(data.db_path || 'userData/data/jarvis.db')} 的 wechat_group_activity 表；${multi ? '当前为多群总览，排行榜行内会标出群名。' : '当前为单群视图。'}群记忆管理展示的是长期结论和原始消息记录，二者不是同一个列表。</span>
      </section>
      <section class="wechaty-stats-recent-list">
        <h5>${multi ? '多群最近记录' : '本地统计库最近记录'}</h5>
        ${rows}
      </section>`;
    }
    refreshWechatyReportPreview();
  }


  function recordTypeLabel(type = '') {
    return ({ text: '文字', image: '图片', emoji: '表情', link: '链接', mixed: '混合', unknown: '未知' })[type] || type || '消息';
  }

  function mediaBadges(row = {}) {
    const badges = [];
    if (row.image_count) badges.push(`图片×${row.image_count}`);
    if (row.emoji_count) badges.push(`表情×${row.emoji_count}`);
    if (row.link_count) badges.push(`链接×${row.link_count}`);
    if (row.brag_score) badges.push(`装逼分×${row.brag_score}`);
    if (String(row.raw_text || '').includes('[媒体文件]')) badges.push('本地媒体已保存');
    return badges.length ? `<div class="wechaty-record-badges">${badges.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : '';
  }

  function mediaPreview(row = {}) {
    const files = Array.isArray(row.media_files) ? row.media_files : [];
    if (!files.length) return '';
    return `<div class="wechaty-record-media">${files.map(file => {
      const rel = file.relative_path || file.relativePath || '';
      const src = `${API}/social/wechat-groups/records/media?path=${encodeURIComponent(rel)}`;
      const name = escapeHtml(file.file_name || rel.split('/').pop() || '媒体文件');
      if (file.kind === 'image') return `<a href="${src}" target="_blank" rel="noreferrer"><img src="${src}" alt="${name}" loading="lazy"><span>${name}</span></a>`;
      if (file.kind === 'video') return `<div class="wechaty-record-media-card"><video src="${src}" controls preload="metadata"></video><span>${name}</span></div>`;
      if (file.kind === 'audio') return `<div class="wechaty-record-media-card"><audio src="${src}" controls preload="metadata"></audio><span>${name}</span></div>`;
      return `<a class="wechaty-record-file" href="${src}" target="_blank" rel="noreferrer">打开媒体：${name}</a>`;
    }).join('')}</div>`;
  }

  function renderWechatyRecords(data = {}, { append = false } = {}) {
    if (!wechatyRecordsList || !wechatyRecordsSummary) return;
    if (!data || data.ok === false) {
      if (!append) wechatyRecordsList.innerHTML = `<div class="wechaty-empty">${escapeHtml(data?.error || '聊天记录查询失败')}</div>`;
      wechatyRecordsSummary.textContent = data?.error || '聊天记录查询失败';
      if (wechatyRecordsMoreBtn) wechatyRecordsMoreBtn.style.display = 'none';
      return;
    }
    const records = Array.isArray(data.records) ? data.records : [];
    const latest = data.latest_record?.timestamp_display || formatWechatyTime(data.latest_record?.timestamp, true) || '暂无';
    const summary = `当前查看：${data.group_name || wechatyActiveMemoryGroupName || '未选择群'} · 当前筛选已入库 ${data.total || 0} 条 · 当前显示 ${Math.min((data.offset || 0) + records.length, data.total || 0)} 条 · DB 最新入库 ${latest} · 参与 ${data.totals?.participant_count || 0} 人 · 图片 ${data.totals?.image_count || 0} / 表情 ${data.totals?.emoji_count || 0} / 链接 ${data.totals?.link_count || 0} · ${data.from_display || ''} 至 ${data.to_display || ''}`;
    wechatyRecordsSummary.textContent = summary;
    const html = records.length
      ? records.map(row => `<article class="wechaty-record-row">
          <div class="wechaty-record-meta">
            <time>${escapeHtml(row.timestamp_display || formatWechatyTime(row.timestamp, true))}</time>
            <b>${escapeHtml(row.sender_display_name || row.sender_name || '未知成员')}</b>
            <em>${escapeHtml(recordTypeLabel(row.message_type))}</em>
          </div>
          <p>${escapeHtml(row.display_text || row.raw_text || '')}</p>
          ${mediaPreview(row)}
          ${mediaBadges(row)}
          <small>ID: ${escapeHtml(row.sender_id || '')} · source=${escapeHtml(row.source || '')}</small>
        </article>`).join('')
      : `<div class="wechaty-empty">当前筛选条件下没有聊天记录。</div>`;
    if (append && wechatyRecordsList.innerHTML && records.length) wechatyRecordsList.insertAdjacentHTML('beforeend', html);
    else wechatyRecordsList.innerHTML = html;
    wechatyRecordsHasMore = !!data.has_more;
    wechatyRecordsOffset = (data.offset || 0) + records.length;
    if (wechatyRecordsMoreBtn) wechatyRecordsMoreBtn.style.display = wechatyRecordsHasMore ? '' : 'none';
  }

  function collectWechatyRecordQuery({ offset = 0 } = {}) {
    ensureWechatyRecordDefaultRange();
    return {
      groupId: wechatyActiveMemoryGroupId,
      groupName: wechatyActiveMemoryGroupName,
      from: wechatyRecordsFrom?.value || '',
      to: wechatyRecordsTo?.value || '',
      type: wechatyRecordsType?.value || '',
      q: wechatyRecordsQuery?.value?.trim() || '',
      limit: 80,
      offset,
    };
  }

  async function loadWechatyRecords({ append = false } = {}) {
    if (!wechatyActiveMemoryGroupId) {
      renderWechatyRecords({ ok: false, error: '请先选择一个群' });
      return;
    }
    const query = collectWechatyRecordQuery({ offset: append ? wechatyRecordsOffset : 0 });
    wechatyRecordsLastQuery = query;
    if (wechatyRecordsRefreshBtn) wechatyRecordsRefreshBtn.disabled = true;
    if (wechatyRecordsMoreBtn) wechatyRecordsMoreBtn.disabled = true;
    try {
      const params = new URLSearchParams({
        group_id: query.groupId,
        group_name: query.groupName || '',
        from: query.from,
        to: query.to,
        type: query.type,
        q: query.q,
        limit: String(query.limit),
        offset: String(query.offset),
      });
      const data = await fetch(`${API}/social/wechat-groups/records?${params}`).then(r => r.json());
      renderWechatyRecords(data, { append });
    } catch {
      renderWechatyRecords({ ok: false, error: '聊天记录查询请求失败' }, { append });
    } finally {
      if (wechatyRecordsRefreshBtn) wechatyRecordsRefreshBtn.disabled = false;
      if (wechatyRecordsMoreBtn) wechatyRecordsMoreBtn.disabled = false;
    }
  }

  function exportWechatyRecords(format = 'json') {
    if (!wechatyActiveMemoryGroupId) {
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, '请先选择一个群', true);
      return;
    }
    const query = collectWechatyRecordQuery({ offset: 0 });
    const params = new URLSearchParams({
      group_id: query.groupId,
      group_name: query.groupName || '',
      from: query.from,
      to: query.to,
      type: query.type,
      q: query.q,
      format,
    });
    window.open(`${API}/social/wechat-groups/records/export?${params}`, '_blank');
  }

  async function importWechatyRecords(file) {
    if (!file || !wechatyActiveMemoryGroupId) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const records = Array.isArray(payload) ? payload : (payload.records || []);
      const mediaFiles = Array.isArray(payload?.media_files) ? payload.media_files : (Array.isArray(payload?.mediaFiles) ? payload.mediaFiles : []);
      const res = await fetch(`${API}/social/wechat-groups/records/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: wechatyActiveMemoryGroupId, group_name: wechatyActiveMemoryGroupName, records, media_files: mediaFiles }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, `导入完成：新增 ${data.inserted || 0} 条，跳过 ${data.skipped || 0} 条，媒体 ${data.media_imported || 0} 个`);
        await loadWechatyRecords();
        await loadWechatyActiveStats({ silent: true });
      } else showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, data.error || '导入失败', true);
    } catch {
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, '导入 JSON 解析失败', true);
    } finally {
      if (wechatyRecordsImportFile) wechatyRecordsImportFile.value = '';
    }
  }

  async function refreshWechatyMemberNames() {
    if (wechatyRecordsRefreshNamesBtn) wechatyRecordsRefreshNamesBtn.disabled = true;
    try {
      const res = await fetch(`${API}/social/wechaty-duty-group/refresh-members`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, `昵称刷新完成：${data.named || 0}/${data.members || 0} 个成员可识别，回填 ${data.updated || 0} 条旧记录`);
        await loadWechatyActiveStats({ silent: true });
        await loadWechatyRecords({ append: false });
        await loadWechatyAdminMembers({ silent: true });
      } else {
        showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, data.error || '刷新昵称失败，请确认微信助手在线', true);
      }
    } catch {
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, '刷新昵称请求失败，请确认程序和微信助手在线', true);
    } finally {
      if (wechatyRecordsRefreshNamesBtn) wechatyRecordsRefreshNamesBtn.disabled = false;
    }
  }

  function renderWechatyAdminMembers(data = null) {
    if (!wechatyAdminMembers) return;
    if (Array.isArray(data?.members)) {
      wechatyAdminMemberCache = data.members;
      syncWechatyAdminNicknameBox();
      syncWechatyBlockedNicknameBox();
    }
    const keyword = String(wechatyAdminSearch?.value || "").trim().toLowerCase();
    const members = wechatyAdminMemberCache.filter(member => {
      if (!keyword) return true;
      return [
        member.display_name,
        member.room_alias,
        member.contact_alias,
        member.contact_name,
      ].some(value => String(value || "").toLowerCase().includes(keyword));
    });
    if (!members.length) {
      wechatyAdminMembers.innerHTML = `<div class="wechaty-empty">${wechatyAdminMemberCache.length ? "没有匹配的成员，请换微信昵称搜索。" : "暂无已识别群成员。请先登录微信、勾选群组并点击“刷新昵称”。"}</div>`;
      renderWechatyBlockedMembers();
      return;
    }
    wechatyAdminMembers.innerHTML = members.slice(0, 160).map(member => {
      const id = String(member.sender_id || '').trim();
      const selected = wechatyAdminIdSet.has(id);
      const nickname = member.display_name || member.room_alias || member.contact_alias || member.contact_name || '未知成员';
      return `<button class="wechaty-admin-member${selected ? ' active' : ''}" type="button" data-sender-id="${escapeHtml(id)}" title="底层精确 sender_id：${escapeHtml(id)}">
        <span><b>${escapeHtml(nickname)}</b><em>${escapeHtml(member.group_name || '未知群')}</em></span>
        <small>${selected ? '已是管理员' : '点击加入管理员'}</small>
      </button>`;
    }).join('');
    renderWechatyBlockedMembers();
  }

  function renderWechatyBlockedMembers() {
    if (!wechatyBlockedMembers) return;
    const keyword = String(wechatyBlockedSearch?.value || "").trim().toLowerCase();
    const members = wechatyAdminMemberCache.filter(member => {
      if (!keyword) return true;
      return [
        member.display_name,
        member.room_alias,
        member.contact_alias,
        member.contact_name,
      ].some(value => String(value || "").toLowerCase().includes(keyword));
    });
    if (!members.length) {
      wechatyBlockedMembers.innerHTML = `<div class="wechaty-empty">${wechatyAdminMemberCache.length ? "没有匹配的成员，请换微信昵称搜索。" : "暂无已识别群成员。请先登录微信、勾选群组并点击“刷新昵称”。"}</div>`;
      return;
    }
    wechatyBlockedMembers.innerHTML = members.slice(0, 160).map(member => {
      const id = String(member.sender_id || '').trim();
      const selected = wechatyBlockedIdSet.has(id);
      const nickname = member.display_name || member.room_alias || member.contact_alias || member.contact_name || '未知成员';
      return `<button class="wechaty-admin-member${selected ? ' active' : ''}" type="button" data-sender-id="${escapeHtml(id)}" title="底层精确 sender_id：${escapeHtml(id)}">
        <span><b>${escapeHtml(nickname)}</b><em>${escapeHtml(member.group_name || '未知群')}</em></span>
        <small>${selected ? '已屏蔽' : '点击屏蔽'}</small>
      </button>`;
    }).join('');
  }

  async function loadWechatyAdminMembers({ silent = false } = {}) {
    if (!wechatyAdminMembers) return;
    if (wechatyRefreshAdminMembersBtn) wechatyRefreshAdminMembersBtn.disabled = true;
    try {
      const data = await fetch(`${API}/social/wechat-groups/members?limit=500`).then(r => r.json());
      if (data.ok) renderWechatyAdminMembers(data);
      else if (!silent) showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, data.error || "读取成员 ID 失败", true);
    } catch {
      if (!silent) showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, "读取成员 ID 请求失败", true);
    } finally {
      if (wechatyRefreshAdminMembersBtn) wechatyRefreshAdminMembersBtn.disabled = false;
    }
  }

  async function refreshWechatyAdminMembers() {
    if (wechatyRefreshAdminMembersBtn) wechatyRefreshAdminMembersBtn.disabled = true;
    try {
      const res = await fetch(`${API}/social/wechaty-duty-group/refresh-members`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, `已刷新成员 ID：${data.named || 0}/${data.members || 0} 个成员`);
      else showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, data.error || "刷新成员 ID 失败", true);
    } catch {
      showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, "刷新成员 ID 请求失败", true);
    } finally {
      await loadWechatyAdminMembers({ silent: true });
      if (wechatyRefreshAdminMembersBtn) wechatyRefreshAdminMembersBtn.disabled = false;
    }
  }

  async function saveWechatyAdminSettings() {
    const adminConfig = collectWechatyAdminConfig();
    const blockedConfig = collectWechatyBlockedConfig();
    if (wechatySaveAdminsBtn) wechatySaveAdminsBtn.disabled = true;
    try {
      const groupNames = collectWechatySelectedRooms();
      const res = await fetch(`${API}/settings/social/wechaty-duty-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!wechatyDutyEnabled?.checked,
          group_names: groupNames.length ? groupNames : [...wechatyConfiguredGroupNames],
          persona_prompt: wechatyPersonaPrompt?.value || "",
          persona_preset_id: describeWechatyPersona(wechatyPersonaPrompt?.value || "").id,
          admin_mode_enabled: adminConfig.adminModeEnabled,
          admin_wechat_ids: adminConfig.adminWechatIds,
          blocked_wechat_ids: blockedConfig.blockedWechatIds,
          concurrency_limit: collectWechatyConcurrencyLimit(),
          ambient_reply: collectWechatyAmbientConfig(),
          offline_qr_notify: collectWechatyOfflineQrNotifyConfig(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        applyWechatyDutyConfig(data.wechatyDutyGroup, data.status);
        showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, adminConfig.adminModeEnabled
          ? `管理员模式已启用并立即生效：${adminConfig.adminWechatIds.length} 人`
          : (adminConfig.adminWechatIds.length ? `管理员已保存但模式未启用：${adminConfig.adminWechatIds.length} 人` : "管理员已清空"));
      } else showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, data.error || "保存管理员失败", true);
    } catch {
      showFeedback(wechatyAdminFeedback || wechatyDutyFeedback, "保存管理员请求失败", true);
    } finally {
      if (wechatySaveAdminsBtn) wechatySaveAdminsBtn.disabled = false;
    }
  }

  async function saveWechatyBlockedSettings() {
    const adminConfig = collectWechatyAdminConfig();
    const blockedConfig = collectWechatyBlockedConfig();
    if (wechatySaveBlockedBtn) wechatySaveBlockedBtn.disabled = true;
    try {
      const groupNames = collectWechatySelectedRooms();
      const res = await fetch(`${API}/settings/social/wechaty-duty-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!wechatyDutyEnabled?.checked,
          group_names: groupNames.length ? groupNames : [...wechatyConfiguredGroupNames],
          persona_prompt: wechatyPersonaPrompt?.value || "",
          persona_preset_id: describeWechatyPersona(wechatyPersonaPrompt?.value || "").id,
          admin_mode_enabled: adminConfig.adminModeEnabled,
          admin_wechat_ids: adminConfig.adminWechatIds,
          blocked_wechat_ids: blockedConfig.blockedWechatIds,
          concurrency_limit: collectWechatyConcurrencyLimit(),
          ambient_reply: collectWechatyAmbientConfig(),
          offline_qr_notify: collectWechatyOfflineQrNotifyConfig(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        applyWechatyDutyConfig(data.wechatyDutyGroup, data.status);
        showFeedback(wechatyBlockedFeedback || wechatyDutyFeedback, blockedConfig.blockedWechatIds.length
          ? `屏蔽成员已保存并立即生效：${blockedConfig.blockedWechatIds.length} 人`
          : "屏蔽成员已清空");
      } else showFeedback(wechatyBlockedFeedback || wechatyDutyFeedback, data.error || "保存屏蔽成员失败", true);
    } catch {
      showFeedback(wechatyBlockedFeedback || wechatyDutyFeedback, "保存屏蔽成员请求失败", true);
    } finally {
      if (wechatySaveBlockedBtn) wechatySaveBlockedBtn.disabled = false;
    }
  }

  function getWechatySelectedDigestGroups() {
    return getWechatyDigestCandidateGroups().filter(group => isWechatyDigestGroupSelected(group));
  }

  function withGroupNameOnRows(rows = [], groupName = "") {
    return (Array.isArray(rows) ? rows : []).map(row => ({ ...row, group_name: row.group_name || groupName }));
  }

  function buildWechatyMultiStats(groups = [], results = []) {
    const okResults = results.filter(item => item?.ok);
    const totals = okResults.reduce((acc, row) => {
      const t = row.totals || {};
      acc.message_count += Number(t.message_count || 0);
      acc.text_length += Number(t.text_length || 0);
      acc.image_count += Number(t.image_count || 0);
      acc.emoji_count += Number(t.emoji_count || 0);
      acc.link_count += Number(t.link_count || 0);
      acc.brag_score += Number(t.brag_score || 0);
      acc.brag_count += Number(t.brag_count || 0);
      acc.participant_count += Number(t.participant_count || 0);
      return acc;
    }, { message_count: 0, text_length: 0, image_count: 0, emoji_count: 0, link_count: 0, brag_score: 0, brag_count: 0, participant_count: 0 });
    const mergeBoard = key => okResults
      .flatMap(row => withGroupNameOnRows(row.leaderboards?.[key] || [], row.group_name || row.group_id))
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || Number(b.message_count || 0) - Number(a.message_count || 0))
      .slice(0, 20);
    const recent = okResults
      .flatMap(row => withGroupNameOnRows(row.recent || [], row.group_name || row.group_id))
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
      .slice(-80);
    return {
      ok: true,
      mode: "multi",
      group_count: groups.length,
      group_name: `已选 ${groups.length} 个统计群`,
      db_path: okResults[0]?.db_path || "",
      totals,
      leaderboards: {
        messages: mergeBoard("messages"),
        images: mergeBoard("images"),
        emojis: mergeBoard("emojis"),
        links: mergeBoard("links"),
        brag: mergeBoard("brag"),
      },
      recent,
      groups: okResults,
      errors: results.filter(item => !item?.ok).map(item => item?.error || "读取失败"),
    };
  }

  async function loadWechatyActiveStats({ silent = false, refreshRecords = true } = {}) {
    if (!wechatyActiveMemoryGroupId) {
      const candidates = getWechatyMemoryCandidateGroups();
      if (candidates.length) {
        wechatyActiveMemoryGroupId = memoryGroupRequestId(candidates[0]);
        wechatyActiveMemoryGroupName = candidates[0].topic;
      }
    }
    const viewMode = wechatyStatsViewMode?.value || "single";
    if (viewMode === "all") {
      const groups = getWechatySelectedDigestGroups();
      if (!groups.length) {
        renderWechatyStats({ ok: false, error: "请先在“选择参与统计/定时总结的群组”里勾选并保存至少一个群" });
        return;
      }
      if (wechatyRefreshStatsBtn) wechatyRefreshStatsBtn.disabled = true;
      try {
        const results = await Promise.all(groups.map(async group => {
          const gid = memoryGroupRequestId(group);
          const url = `${API}/social/wechat-groups/stats?group_id=${encodeURIComponent(gid)}&group_name=${encodeURIComponent(group.topic || '')}&range=today&limit=10`;
          const data = await fetch(url).then(r => r.json());
          return { ...data, group_name: data.group_name || group.topic || gid, group_id: gid };
        }));
        renderWechatyStats(buildWechatyMultiStats(groups, results));
      } catch {
        if (!silent) showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, "读取多群统计失败", true);
      } finally {
        if (wechatyRefreshStatsBtn) wechatyRefreshStatsBtn.disabled = false;
      }
      return;
    }
    if (!wechatyActiveMemoryGroupId) {
      renderWechatyStats(null);
      if (!silent) showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, "请先选择一个群", true);
      return;
    }
    if (wechatyRefreshStatsBtn) wechatyRefreshStatsBtn.disabled = true;
    try {
      const url = `${API}/social/wechat-groups/stats?group_id=${encodeURIComponent(wechatyActiveMemoryGroupId)}&group_name=${encodeURIComponent(wechatyActiveMemoryGroupName || '')}&range=today&limit=10`;
      const data = await fetch(url).then(r => r.json());
      renderWechatyStats(data);
      if (refreshRecords) await loadWechatyRecords({ append: false });
    } catch {
      if (!silent) showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, "读取群统计失败", true);
    } finally {
      if (wechatyRefreshStatsBtn) wechatyRefreshStatsBtn.disabled = false;
    }
  }

  function renderGuardRules(rules = []) {
    if (!guardList) return;
    guardList.innerHTML = rules.length
      ? rules.map(rule => {
        const severity = escapeHtml(rule.severity || "medium");
        const examples = Array.isArray(rule.examples) && rule.examples.length
          ? `<div class="wechaty-guard-examples">${rule.examples.slice(0, 3).map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
          : "";
        return `<div class="wechaty-guard-item severity-${severity}">
          <div class="wechaty-guard-head"><span>${escapeHtml(rule.label)}</span><code>${escapeHtml(rule.id)}</code></div>
          <p>${escapeHtml(rule.description || "")}</p>
          ${examples}
          <small>${escapeHtml(rule.safeAlternative || "命中后只允许解释风险，不执行。")}</small>
        </div>`;
      }).join('')
      : '<div class="wechaty-empty">暂无黑名单规则</div>';
  }


  function formatBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let n = value;
    let idx = 0;
    while (n >= 1024 && idx < units.length - 1) { n /= 1024; idx += 1; }
    return `${n >= 10 || idx === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[idx]}`;
  }

  function normalizeUiStringArray(input) {
    if (input instanceof Set) return [...input].map(v => String(v || "").trim()).filter(Boolean);
    const raw = Array.isArray(input)
      ? input
      : String(input || "").split(/[，,;；\n\r]+/u);
    return [...new Set(raw.map(v => String(v || "").trim()).filter(Boolean))];
  }

  function applyWechatGroupArchiveConfig(config = {}, dutyConfig = {}) {
    wechatGroupArchiveConfigCache = {
      ...wechatGroupArchiveConfigCache,
      ...(config && typeof config === "object" ? config : {}),
    };
    dbArchiveRecordNames = new Set(normalizeUiStringArray(wechatGroupArchiveConfigCache.recordGroupNames || wechatGroupArchiveConfigCache.record_group_names));
    dbArchiveImageNames = new Set(normalizeUiStringArray(wechatGroupArchiveConfigCache.parseImageGroupNames || wechatGroupArchiveConfigCache.parse_image_group_names));
    dbArchiveFreeNames = new Set(normalizeUiStringArray(dutyConfig?.groupNames || dutyConfig?.group_names || wechatyConfiguredGroupNames));
    if (dbArchiveEnabled) dbArchiveEnabled.checked = wechatGroupArchiveConfigCache.enabled !== false;
    if (dbArchiveRecordText) dbArchiveRecordText.checked = wechatGroupArchiveConfigCache.recordText !== false && wechatGroupArchiveConfigCache.record_text !== false;
    if (dbArchiveRecordMedia) dbArchiveRecordMedia.checked = wechatGroupArchiveConfigCache.recordMedia !== false && wechatGroupArchiveConfigCache.record_media !== false;
    if (dbArchiveParseImages) dbArchiveParseImages.checked = wechatGroupArchiveConfigCache.parseImages !== false && wechatGroupArchiveConfigCache.parse_images !== false;
    if (dbArchiveDefaultFree) dbArchiveDefaultFree.checked = wechatGroupArchiveConfigCache.defaultFromFreeReplyGroups !== false && wechatGroupArchiveConfigCache.default_from_free_reply_groups !== false;
    if (dbArchiveChunkSize) dbArchiveChunkSize.value = String(wechatGroupArchiveConfigCache.longMessageChunkSize || wechatGroupArchiveConfigCache.long_message_chunk_size || 1800);
    if (dbArchiveChunkOverlap) dbArchiveChunkOverlap.value = String(wechatGroupArchiveConfigCache.longMessageChunkOverlap || wechatGroupArchiveConfigCache.long_message_chunk_overlap || 160);
    renderDbArchiveGroups();
  }

  function getDbArchiveCandidateGroups() {
    const map = new Map();
    const add = (name = "", meta = {}) => {
      const topic = String(name || "").trim();
      if (!topic) return;
      const key = topic.replace(/\s+/gu, " ").toLowerCase();
      const prev = map.get(key) || {};
      map.set(key, {
        name: topic,
        id: meta.id || prev.id || "",
        message_count: Math.max(Number(prev.message_count || 0), Number(meta.message_count || 0)),
        member_count: Math.max(Number(prev.member_count || 0), Number(meta.member_count || 0)),
        last_seen_display: meta.last_seen_display || prev.last_seen_display || "",
        selected_reply: prev.selected_reply || meta.selected_reply === true,
        configured_record: prev.configured_record || meta.configured_record === true,
        configured_image: prev.configured_image || meta.configured_image === true,
      });
    };
    for (const group of mergeWechatyKnownGroups()) {
      add(group.topic || group.group_name || group.id, {
        id: group.id || group.group_id || "",
        message_count: group.message_count,
        member_count: group.member_count,
        last_seen_display: group.last_seen_display,
        selected_reply: wechatyConfiguredGroupNames.has(group.topic),
      });
    }
    for (const name of dbArchiveRecordNames) add(name, { configured_record: true });
    for (const name of dbArchiveImageNames) add(name, { configured_image: true });
    for (const name of dbArchiveFreeNames) add(name, { selected_reply: true });
    return [...map.values()].sort((a, b) =>
      Number(dbArchiveRecordNames.has(b.name) || dbArchiveImageNames.has(b.name) || dbArchiveFreeNames.has(b.name))
      - Number(dbArchiveRecordNames.has(a.name) || dbArchiveImageNames.has(a.name) || dbArchiveFreeNames.has(a.name))
      || String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
  }

  function renderDbArchiveGroups() {
    if (!dbArchiveGroupList) return;
    const keyword = String(dbArchiveSearch?.value || "").trim().toLowerCase();
    const includeFree = dbArchiveDefaultFree?.checked !== false;
    const groups = getDbArchiveCandidateGroups().filter(group => !keyword || group.name.toLowerCase().includes(keyword));
    if (!groups.length) {
      dbArchiveGroupList.innerHTML = '<div class="wechaty-empty">暂无可选群。微信助手登录后会自动刷新真实群列表。</div>';
      updateDbArchiveSummary();
      return;
    }
    dbArchiveGroupList.innerHTML = groups.map(group => {
      const name = String(group.name || "");
      const isFree = dbArchiveFreeNames.has(name);
      const recordChecked = dbArchiveRecordNames.has(name) || (includeFree && isFree);
      const imageChecked = dbArchiveImageNames.has(name) || (includeFree && isFree);
      const badges = [
        isFree ? "自由回复" : "",
        group.configured_record ? "记录配置" : "",
        group.configured_image ? "图片配置" : "",
        group.message_count ? `${group.message_count} 条` : "",
      ].filter(Boolean);
      return `<div class="db-archive-group-row${isFree ? " free" : ""}">
        <div class="db-archive-group-main">
          <b>${escapeHtml(name)}</b>
          <span>${escapeHtml(group.id || group.last_seen_display || "已识别群组")}</span>
        </div>
        <div class="db-archive-group-badges">${badges.map(label => `<em>${escapeHtml(label)}</em>`).join("")}</div>
        <label><input type="checkbox" data-archive-kind="record" value="${escapeHtml(name)}"${recordChecked ? " checked" : ""}${includeFree && isFree ? " disabled" : ""}>记录</label>
        <label><input type="checkbox" data-archive-kind="image" value="${escapeHtml(name)}"${imageChecked ? " checked" : ""}${includeFree && isFree ? " disabled" : ""}>图片解析</label>
      </div>`;
    }).join("");
    updateDbArchiveSummary();
  }

  function updateDbArchiveSummary() {
    if (!dbArchiveSummary) return;
    const includeFree = dbArchiveDefaultFree?.checked !== false;
    const effectiveRecord = new Set([...dbArchiveRecordNames, ...(includeFree ? dbArchiveFreeNames : [])]);
    const effectiveImage = new Set([...dbArchiveImageNames, ...(includeFree ? dbArchiveFreeNames : [])]);
    const enabled = dbArchiveEnabled?.checked !== false;
    dbArchiveSummary.textContent = `${enabled ? "已启用" : "已关闭"} · 显式记录 ${dbArchiveRecordNames.size} 个 / 有效记录 ${effectiveRecord.size} 个 · 显式图片解析 ${dbArchiveImageNames.size} 个 / 有效图片解析 ${effectiveImage.size} 个 · 自由回复群 ${includeFree ? "自动纳入" : "不自动纳入"} · 未选群不会继续写聊天内容、保存图片或解析图片`;
  }

  function buildDbArchivePayload({ recordNames = null, imageNames = null } = {}) {
    return {
      enabled: dbArchiveEnabled?.checked !== false,
      record_text: dbArchiveRecordText?.checked !== false,
      record_media: dbArchiveRecordMedia?.checked !== false,
      parse_images: dbArchiveParseImages?.checked !== false,
      default_from_free_reply_groups: dbArchiveDefaultFree?.checked !== false,
      record_group_names: normalizeUiStringArray(recordNames || [...dbArchiveRecordNames]),
      parse_image_group_names: normalizeUiStringArray(imageNames || [...dbArchiveImageNames]),
      long_message_chunk_size: Number(dbArchiveChunkSize?.value || 1800),
      long_message_chunk_overlap: Number(dbArchiveChunkOverlap?.value || 160),
    };
  }

  async function saveDbArchiveConfig({ syncFree = false } = {}) {
    const nextRecordNames = syncFree ? [...new Set([...dbArchiveRecordNames, ...dbArchiveFreeNames])] : [...dbArchiveRecordNames];
    const nextImageNames = syncFree ? [...new Set([...dbArchiveImageNames, ...dbArchiveFreeNames])] : [...dbArchiveImageNames];
    const payload = buildDbArchivePayload({ recordNames: nextRecordNames, imageNames: nextImageNames });
    try {
      [dbArchiveSaveRecordBtn, dbArchiveSaveImageBtn, dbArchiveSyncFreeBtn].forEach(btn => { if (btn) btn.disabled = true; });
      const data = await fetch(`${API}/settings/social/wechat-group-archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "保存失败");
      applyWechatGroupArchiveConfig(data.wechatGroupArchive || payload, data.wechatyDutyGroup || {});
      showFeedback(dbFeedback, syncFree ? "已同步自由回复群到记录与图片解析范围" : "微信群记录范围已保存");
      loadDbImageLibrary({ append: false, silent: true, autoProcess: true });
    } catch (err) {
      showFeedback(dbFeedback, err?.message || "保存失败", true);
    } finally {
      [dbArchiveSaveRecordBtn, dbArchiveSaveImageBtn, dbArchiveSyncFreeBtn].forEach(btn => { if (btn) btn.disabled = false; });
    }
  }

  function renderDbIndexStatus(data = {}) {
    if (!dbIndexGrid) return;
    if (!data || data.ok === false) {
      dbIndexGrid.innerHTML = `<div class="wechaty-empty">${escapeHtml(data?.error || "长期记忆索引状态读取失败")}</div>`;
      return;
    }
    const cards = [
      ["聊天记录 FTS", `${data.activity_fts_count || 0}/${data.activity_count || 0}`, `待补 ${data.pending_activity_fts || 0}`],
      ["长消息 chunk", String(data.chunk_count || 0), `待切块 ${data.pending_long_message_chunks || 0} · 待 FTS ${data.pending_chunk_fts || 0}`],
      ["本地消息 FTS", `${data.local_message_fts_count || 0}/${data.local_message_count || 0}`, `待补 ${data.pending_local_message_fts || 0}`],
      ["本地记忆 FTS", `${data.local_memory_fts_count || 0}/${data.local_memory_count || 0}`, `待补 ${data.pending_local_memory_fts || 0}`],
      ["Embedding", String((data.pending_message_embeddings || 0) + (data.pending_memory_embeddings || 0)), `消息 ${data.pending_message_embeddings || 0} · 记忆 ${data.pending_memory_embeddings || 0}`],
      ["最近检索耗时", `${data.last_retrieval_ms || 0} ms`, `chunk ${data.chunk_size || 0}/${data.chunk_overlap || 0}`],
    ];
    dbIndexGrid.innerHTML = cards.map(([title, value, sub]) => `
      <div class="db-index-card">
        <small>${escapeHtml(title)}</small>
        <b>${escapeHtml(value)}</b>
        <span>${escapeHtml(sub)}</span>
      </div>`).join("");
  }

  async function loadDbMemoryIndexStatus({ silent = false } = {}) {
    try {
      const data = await fetch(`${API}/social/wechat-groups/memory-index/status`).then(r => r.json());
      renderDbIndexStatus(data);
      return data;
    } catch (err) {
      if (!silent) showFeedback(dbFeedback, err?.message || "索引状态读取失败", true);
      renderDbIndexStatus({ ok: false, error: "索引状态读取失败" });
      return null;
    }
  }

  async function backfillDbMemoryIndex() {
    if (dbIndexBackfillBtn) dbIndexBackfillBtn.disabled = true;
    try {
      showFeedback(dbFeedback, "正在补齐长期记忆索引，请稍等…");
      const data = await fetch(`${API}/social/wechat-groups/memory-index/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5000 }),
      }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || (data.errors && data.errors[0]) || "补齐失败");
      renderDbIndexStatus({ ...(data.status?.archive || {}), ...(data.status?.local || {}), ...data.status, ok: true });
      showFeedback(dbFeedback, `索引补齐完成：聊天记录 ${data.activity_fts || 0} 条，chunk ${data.chunks || 0} 条，本地消息 ${data.local_messages || 0} 条，本地记忆 ${data.local_memories || 0} 条`);
      await loadDbMemoryIndexStatus({ silent: true });
    } catch (err) {
      showFeedback(dbFeedback, err?.message || "补齐失败", true);
    } finally {
      if (dbIndexBackfillBtn) dbIndexBackfillBtn.disabled = false;
    }
  }

  function renderDatabaseOverview(data = {}) {
    if (dbTotalSize) dbTotalSize.textContent = formatBytes(data.totals?.totalBytes || 0);
    if (dbPathHint) dbPathHint.textContent = data.paths?.userDir ? `本机目录：${data.paths.userDir}` : "本机数据库目录";
    if (dbHealthGrid) {
      const vector = data.vectorStats || {};
      const honcho = data.honcho || {};
      const honchoHealth = honcho.health || {};
      dbHealthGrid.innerHTML = `
        <div class="db-health-card ${honchoHealth.ok ? 'ok' : 'warn'}"><b>Honcho</b><span>${honcho.enabled ? (honchoHealth.ok ? `已连接 · 已同步 ${honcho.syncedMessages || 0}/${honcho.localMessages || 0}` : `未连通：${escapeHtml(honchoHealth.error || '等待检测')}`) : '未启用，使用本地兜底'}</span></div>
        <div class="db-health-card ok"><b>向量搜索</b><span>${vector.configured ? `${escapeHtml(vector.provider || '')} · ${escapeHtml(vector.model || '')}` : '本地轻量向量兜底已启用'}</span></div>
        <div class="db-health-card"><b>已向量化</b><span>核心 ${vector.coreMemoryEmbedded || 0}/${vector.coreMemoryTotal || 0} · 群聊 ${vector.groupMessagesEmbedded || 0}/${vector.groupMessagesTotal || 0} · 群记忆 ${vector.groupMemoryEmbedded || 0}/${vector.groupMemoryTotal || 0}</span></div>`;
    }
    const categories = Array.isArray(data.categories) ? data.categories : [];
    if (dbOverviewGrid) {
      dbOverviewGrid.innerHTML = categories.length ? categories.map(item => `
        <div class="db-stat-card">
          <small>${escapeHtml(item.name || item.key || "数据")}</small>
          <strong>${escapeHtml(String(item.rows || 0))}</strong>
          <span>${escapeHtml(item.subtitle || `${formatBytes(item.bytes || 0)} · ${(item.tables || []).join(" / ") || "文件"}`)}</span>
        </div>`).join("") : '<div class="wechaty-empty">暂无数据库统计。</div>';
    }
    const memberStats = data.memberIdentityStats || {};
    if (dbMemberPanel) {
      const groups = Array.isArray(memberStats.groups) ? memberStats.groups : [];
      const examples = Array.isArray(memberStats.duplicateExamples) ? memberStats.duplicateExamples : [];
      dbMemberPanel.innerHTML = `
        <div class="wechaty-subsection-head">
          <div>
            <div class="wechaty-subsection-title">成员有效视图</div>
            <p class="settings-hint compact">这里不删除原始记录，只按“群名 + 昵称”聚合展示，避免 Wechaty 重登后 sender_id 变化导致人数虚高。</p>
          </div>
        </div>
        <div class="db-member-summary">
          <div><b>${escapeHtml(String(memberStats.effectiveNicknames || 0))}</b><span>有效昵称</span></div>
          <div><b>${escapeHtml(String(memberStats.rawRows || 0))}</b><span>历史身份记录</span></div>
          <div><b>${escapeHtml(String(memberStats.duplicatedNicknameRows || 0))}</b><span>可合并历史记录</span></div>
          <div><b>${escapeHtml(String(memberStats.uniqueWxids || 0))}</b><span>可用 wxid</span></div>
        </div>
        <div class="db-member-groups">
          ${groups.length ? groups.map(row => `
            <div class="db-member-row">
              <b>${escapeHtml(row.group_name || "未知群")}</b>
              <span>${escapeHtml(String(row.effective_nicknames || 0))} 个昵称</span>
              <em>${escapeHtml(String(row.raw_rows || 0))} 条历史身份</em>
            </div>`).join("") : '<div class="wechaty-empty">暂无成员昵称记录。</div>'}
        </div>
        ${examples.length ? `<div class="db-member-duplicates"><small>重复示例：</small>${examples.slice(0, 6).map(row => `<span>${escapeHtml(row.group_name || '')} / ${escapeHtml(row.display_name || '')} × ${escapeHtml(String(row.raw_rows || 0))}</span>`).join("")}</div>` : ''}`;
    }
    const tables = Array.isArray(data.tables) ? data.tables : [];
    if (dbTableList) {
      dbTableList.innerHTML = tables.length ? tables.slice(0, 40).map(row => `
        <div class="db-table-row">
          <b>${escapeHtml(row.name || "table")}</b>
          <span>${escapeHtml(String(row.rows || 0))} 行</span>
          <em>${formatBytes(row.bytes || 0)}</em>
        </div>`).join("") : '<div class="wechaty-empty">暂无表明细。</div>';
    }
  }

  async function exportDatabaseBackup() {
    try {
      const data = await fetch(`${API}/settings/database/export`).then(r => r.json());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bailongma-database-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showFeedback(dbFeedback, '数据库备份已导出');
    } catch { showFeedback(dbFeedback, '导出失败', true); }
  }

  async function importDatabaseBackup(file) {
    if (!file) return;
    if (!confirm('确定导入这个数据库 JSON？会跳过重复记录，但建议先导出现有备份。')) return;
    try {
      const payload = JSON.parse(await file.text());
      const data = await fetch(`${API}/settings/database/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (data.ok) { showFeedback(dbFeedback, '导入完成'); loadDatabaseSettings(); }
      else showFeedback(dbFeedback, data.error || '导入失败', true);
    } catch { showFeedback(dbFeedback, '导入文件解析失败', true); }
  }

  async function loadDatabaseSettings() {
    if (dbOverviewGrid) dbOverviewGrid.innerHTML = '<div class="wechaty-empty">正在加载数据库统计…</div>';
    if (dbImageList) dbImageList.innerHTML = '<div class="wechaty-empty">正在加载图片解析库…</div>';
    try {
      await loadWechatyKnownGroups({ silent: true });
      const [data] = await Promise.all([
        fetch(`${API}/settings/database`).then(r => r.json()),
        loadDbArchiveSettings({ silent: true }),
        loadDbMemoryIndexStatus({ silent: true }),
        loadDbImageLibrary({ silent: true, autoProcess: true }),
      ]);
      if (data.ok) renderDatabaseOverview(data);
      else showFeedback(dbFeedback, data.error || "数据库统计加载失败", true);
    } catch {
      showFeedback(dbFeedback, "数据库统计请求失败", true);
    }
  }

  async function loadDbArchiveSettings({ silent = false } = {}) {
    try {
      const data = await fetch(`${API}/settings/social/wechat-group-archive`).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "记录范围读取失败");
      applyWechatGroupArchiveConfig(data.wechatGroupArchive || {}, data.wechatyDutyGroup || {});
      return data;
    } catch (err) {
      if (!silent) showFeedback(dbFeedback, err?.message || "记录范围读取失败", true);
      if (dbArchiveGroupList) dbArchiveGroupList.innerHTML = '<div class="wechaty-empty">记录范围读取失败。</div>';
      return null;
    }
  }

  async function runDatabaseAction(btn, url, successText) {
    try {
      if (btn) btn.disabled = true;
      showFeedback(dbFeedback, "正在处理，请稍等…");
      const data = await fetch(`${API}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5000 }) }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || (data.errors && data.errors[0]) || '执行失败');
      const summary = url.includes("extract-wechat-memories")
        ? `${successText}：扫描 ${data.scanned || 0} 条，显式提取 ${data.extracted || 0} 条，稳定事实 ${data.archived || 0} 条，发言素材 ${data.utterance_archived || 0} 条，人设总结新增 ${data.persona_summaries || 0} 条/更新 ${data.persona_updated || 0} 条，去重 ${data.deduped || 0} 条，跳过 ${data.skipped || 0} 条`
        : `${successText}：${JSON.stringify(data)}`.slice(0, 240);
      showFeedback(dbFeedback, summary);
      if (url.includes("extract-wechat-memories")) {
        alert(`${summary}\n\n稳定事实、发言素材和人设总结已写入对应群友的个人永久记忆。跳过只代表纯媒体占位、空白、过短无信息或不可用内部文本；重复内容会自动去重。`);
        try { await loadWechatyMemberMemory({ keepMember: true }); } catch {}
      }
      loadDatabaseSettings();
    } catch (err) {
      showFeedback(dbFeedback, err?.message || "执行失败", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function searchDatabaseMemory() {
    const q = dbSearchInput?.value?.trim() || "";
    if (!q) { showFeedback(dbFeedback, "请输入要查询的内容", true); return; }
    if (dbSearchResults) dbSearchResults.innerHTML = '<div class="wechaty-empty">正在搜索…</div>';
    try {
      const data = await fetch(`${API}/settings/database/search?q=${encodeURIComponent(q)}&limit=40`).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "搜索失败");
      const rows = Array.isArray(data.items) ? data.items : [];
      if (dbSearchResults) {
        dbSearchResults.innerHTML = rows.length ? rows.map(row => `
          <div class="db-search-item">
            <div><b>${escapeHtml(row.group_name || "未知群")}</b><span>${escapeHtml(row.member_name || row.member_id || "群记忆")}</span><em>${escapeHtml((row.created_at || "").slice(0, 19))}</em></div>
            <p>${escapeHtml(row.content || "")}</p>
            <small>${escapeHtml(row.source_type || "record")} · 相关度 ${Number(row.score || 0).toFixed(2)}</small>
          </div>`).join("") : '<div class="wechaty-empty">没有查到匹配内容。</div>';
      }
    } catch (err) {
      if (dbSearchResults) dbSearchResults.innerHTML = '<div class="wechaty-empty">搜索失败</div>';
      showFeedback(dbFeedback, err?.message || "搜索失败", true);
    }
  }

  function knowledgeTypeIcon(type = "") {
    return ({ image: "🖼️", url: "🌐", pdf: "📕", sheet: "📊", word: "📄", markdown: "📝", manual: "✍️", text: "📜" })[type] || "🗂️";
  }

  function knowledgeStatusLabel(status = "", enabled = true) {
    if (!enabled) return "已停用";
    return ({ active: "已入库", draft: "草稿", parsed: "待确认", error: "解析失败" })[status] || status || "未知";
  }

  function selectedKnowledgeGroups() {
    return [...(knowledgeGroupSelect?.selectedOptions || [])].map(opt => ({ id: opt.value, name: opt.textContent.replace(/\s+·.+$/u, "") })).filter(g => g.id);
  }

  function renderKnowledgeGroupOptions() {
    const groups = getWechatyMemoryCandidateGroups();
    const options = groups.map(g => {
      const id = g.id || g.group_id || g.topic || g.name || "";
      const name = g.topic || g.group_name || g.name || id;
      return `<option value="${escapeHtml(id)}">${escapeHtml(name)} · ${escapeHtml(id)}</option>`;
    }).join("");
    if (knowledgeGroupSelect) knowledgeGroupSelect.innerHTML = options || '<option value="">暂无群组</option>';
    if (knowledgeTestGroup) knowledgeTestGroup.innerHTML = `<option value="">全局 + 不指定群</option>${options}`;
  }

  function renderKnowledgeStatus(status = {}) {
    const counts = status.counts || {};
    const honcho = status.honcho || {};
    const docker = status.docker || {};
    if (knowledgeStatusGrid) {
      knowledgeStatusGrid.innerHTML = `
        <div class="knowledge-metric primary"><small>可用知识</small><b>${counts.active || 0}</b><span>${counts.chunks || 0} 个分块</span></div>
        <div class="knowledge-metric"><small>全局</small><b>${counts.global || 0}</b><span>所有群可调用</span></div>
        <div class="knowledge-metric"><small>图片</small><b>${counts.image || 0}</b><span>视觉/OCR 知识</span></div>
        <div class="knowledge-metric ${honcho.ok ? 'ok' : 'warn'}"><small>外部记忆后端</small><b>${honcho.ok ? '已接通' : '未接通'}</b><span>${escapeHtml(honcho.ok ? (honcho.message || '运行正常') : '内置本地知识库仍可工作')}</span></div>`;
    }
    const groups = Array.isArray(status.groups) ? status.groups : [];
    if (knowledgeSpaceList) {
      knowledgeSpaceList.innerHTML = `
        <button class="knowledge-space-item ${knowledgeActiveGroupId === '' ? 'active' : ''}" data-group=""><b>全部知识</b><span>${counts.sources || 0} 个来源</span></button>
        <button class="knowledge-space-item ${knowledgeActiveGroupId === '__global__' ? 'active' : ''}" data-group="__global__"><b>全局知识</b><span>${counts.global || 0} 个来源</span></button>
        ${groups.map(g => `<button class="knowledge-space-item ${knowledgeActiveGroupId === g.group_id ? 'active' : ''}" data-group="${escapeHtml(g.group_id)}"><b>${escapeHtml(g.group_name || g.group_id || '未知群')}</b><span>${escapeHtml(String(g.n || 0))} 个来源 · ${escapeHtml((g.updated_at || '').slice(5, 16))}</span></button>`).join("")}`;
      knowledgeSpaceList.querySelectorAll("[data-group]").forEach(btn => btn.addEventListener("click", () => {
        knowledgeActiveGroupId = btn.dataset.group || "";
        loadKnowledgeSources();
      }));
    }
  }

  function renderKnowledgeSources(items = []) {
    knowledgeSourcesCache = items;
    if (!knowledgeSourceGrid) return;
    knowledgeSourceGrid.innerHTML = items.length ? items.map(item => {
      const groups = Array.isArray(item.groups) ? item.groups : [];
      const active = Number(item.id) === Number(knowledgeActiveSourceId);
      return `<button class="knowledge-source-card ${active ? 'active' : ''} type-${escapeHtml(item.source_type || 'text')}" data-id="${escapeHtml(String(item.id))}">
        <div class="knowledge-card-top"><em>${knowledgeTypeIcon(item.source_type)}</em><span>${escapeHtml(knowledgeStatusLabel(item.status, !!item.enabled))}</span></div>
        <b>${escapeHtml(item.title || '未命名知识')}</b>
        <p>${escapeHtml(item.summary || item.source_url || item.file_name || '暂无摘要')}</p>
        <div class="knowledge-card-meta"><span>${escapeHtml(item.scope === 'global' ? '全局' : (groups.map(g => g.name || g.id).join('、') || '群组'))}</span><span>${escapeHtml(String(item.chunk_count || 0))} 块</span><span>命中 ${escapeHtml(String(item.hit_count || 0))}</span></div>
      </button>`;
    }).join("") : '<div class="knowledge-empty">还没有知识档案。拖入文件、粘贴链接，或给某个群建立第一份知识。</div>';
    knowledgeSourceGrid.querySelectorAll("[data-id]").forEach(btn => btn.addEventListener("click", () => {
      knowledgeActiveSourceId = Number(btn.dataset.id || 0);
      renderKnowledgeDetail(knowledgeSourcesCache.find(item => Number(item.id) === knowledgeActiveSourceId));
      renderKnowledgeSources(knowledgeSourcesCache);
    }));
    if (!knowledgeActiveSourceId && items[0]) {
      knowledgeActiveSourceId = Number(items[0].id);
      renderKnowledgeDetail(items[0]);
    }
  }

  function renderKnowledgeDetail(item) {
    if (!knowledgeDetail) return;
    if (!item) {
      knowledgeDetail.innerHTML = '<div class="knowledge-detail-empty">选择一张知识卡查看详情、分块、来源和操作。</div>';
      return;
    }
    const groups = Array.isArray(item.groups) ? item.groups : [];
    knowledgeDetail.innerHTML = `
      <div class="knowledge-detail-head"><em>${knowledgeTypeIcon(item.source_type)}</em><div><b>${escapeHtml(item.title || '未命名知识')}</b><span>${escapeHtml(item.source_url || item.file_name || item.source_type || '')}</span></div></div>
      <label class="knowledge-field"><span>标题</span><input class="settings-input" id="knowledge-detail-title" value="${escapeHtml(item.title || '')}"></label>
      <label class="knowledge-field"><span>摘要</span><textarea class="settings-input" id="knowledge-detail-summary" rows="5">${escapeHtml(item.summary || '')}</textarea></label>
      <div class="knowledge-detail-badges"><span>${escapeHtml(item.scope === 'global' ? '全局知识' : '群组知识')}</span><span>${escapeHtml(knowledgeStatusLabel(item.status, !!item.enabled))}</span><span>${escapeHtml(String(item.chunk_count || 0))} 个分块</span></div>
      <div class="knowledge-detail-groups">${groups.length ? groups.map(g => `<span>${escapeHtml(g.name || g.id)}</span>`).join("") : '<span>所有群可用</span>'}</div>
      <div class="knowledge-detail-actions">
        <button class="settings-save-btn primary" id="knowledge-detail-save" type="button">保存</button>
        <button class="settings-save-btn" id="knowledge-detail-toggle" type="button">${item.enabled ? '停用' : '启用'}</button>
        <button class="settings-save-btn" id="knowledge-detail-reparse" type="button">重新解析</button>
        <button class="settings-save-btn ghost danger" id="knowledge-detail-delete" type="button">删除</button>
      </div>
      <small class="knowledge-detail-foot">创建 ${escapeHtml((item.created_at || '').slice(0, 19))} · 最后命中 ${escapeHtml((item.last_hit_at || '暂无').slice(0, 19))}</small>`;
    document.getElementById("knowledge-detail-save")?.addEventListener("click", () => saveKnowledgeDetail(item));
    document.getElementById("knowledge-detail-toggle")?.addEventListener("click", () => patchKnowledgeSource(item.id, { enabled: !item.enabled }));
    document.getElementById("knowledge-detail-reparse")?.addEventListener("click", () => reparseKnowledgeSourceUI(item.id));
    document.getElementById("knowledge-detail-delete")?.addEventListener("click", () => deleteKnowledgeSourceUI(item.id));
  }

  async function loadKnowledgeConsole() {
    await loadWechatyKnownGroups({ silent: true });
    renderKnowledgeGroupOptions();
    try {
      const status = await fetch(`${API}/knowledge/status`).then(r => r.json());
      if (status.ok) renderKnowledgeStatus(status);
      await loadKnowledgeSources();
    } catch (err) {
      showFeedback(knowledgeFeedback, err?.message || "知识库加载失败", true);
    }
  }

  async function loadKnowledgeSources() {
    const q = knowledgeSearchInput?.value?.trim() || "";
    const params = new URLSearchParams({ limit: "160" });
    if (knowledgeActiveType) params.set("type", knowledgeActiveType);
    if (knowledgeActiveGroupId) params.set("group_id", knowledgeActiveGroupId);
    if (q) params.set("q", q);
    if (knowledgeSourceGrid) knowledgeSourceGrid.innerHTML = '<div class="wechaty-empty">正在读取知识档案…</div>';
    const data = await fetch(`${API}/knowledge/sources?${params}`).then(r => r.json());
    if (!data.ok) throw new Error(data.error || "读取知识库失败");
    renderKnowledgeSources(data.items || []);
    const status = await fetch(`${API}/knowledge/status`).then(r => r.json()).catch(() => null);
    if (status?.ok) renderKnowledgeStatus(status);
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function parseKnowledgeImportUI() {
    try {
      if (knowledgeParseBtn) knowledgeParseBtn.disabled = true;
      showFeedback(knowledgeImportFeedback, "正在解析知识，请稍等…");
      const groups = knowledgeScope?.value === "groups" ? selectedKnowledgeGroups() : [];
      const urls = (knowledgeUrlInput?.value || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
      const texts = (knowledgeManualText?.value || "").trim() ? [{ title: knowledgeManualTitle?.value?.trim() || "手动知识", content: knowledgeManualText.value.trim() }] : [];
      const files = [];
      for (const file of knowledgeFileInput?.files || []) {
        files.push({ name: file.name, mimeType: file.type, base64: await readFileAsBase64(file) });
      }
      if (!urls.length && !texts.length && !files.length) throw new Error("请上传文件、粘贴链接或输入文本");
      const data = await fetch(`${API}/knowledge/import/parse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: knowledgeScope?.value || "global", groups, urls, texts, files }) }).then(r => r.json());
      if (!data.ok && !(data.previews || []).length) throw new Error(data.error || (data.errors || [])[0]?.error || "解析失败");
      knowledgePreviewCache = data.previews || [];
      renderKnowledgePreview(data.errors || []);
      showFeedback(knowledgeImportFeedback, `解析完成：${knowledgePreviewCache.length} 个成功，${(data.errors || []).length} 个需要处理`);
    } catch (err) {
      showFeedback(knowledgeImportFeedback, err?.message || "解析失败", true);
    } finally {
      if (knowledgeParseBtn) knowledgeParseBtn.disabled = false;
    }
  }

  function renderKnowledgePreview(errors = []) {
    if (knowledgePreviewPanel) knowledgePreviewPanel.hidden = !knowledgePreviewCache.length && !errors.length;
    if (!knowledgePreviewList) return;
    knowledgePreviewList.innerHTML = `
      ${knowledgePreviewCache.map((src, idx) => `<div class="knowledge-preview-card" data-idx="${idx}">
        <div class="knowledge-pipeline"><span class="done">读取</span><span class="done">提取</span><span class="done">分块</span><span class="done">待确认</span></div>
        <input class="settings-input knowledge-preview-title" value="${escapeHtml(src.title || '')}" placeholder="标题">
        <textarea class="settings-input knowledge-preview-summary" rows="3">${escapeHtml(src.summary || '')}</textarea>
        <div class="knowledge-preview-chunks">${(src.chunks || []).slice(0, 8).map((c, cidx) => `<textarea class="settings-input knowledge-preview-chunk" data-cidx="${cidx}" rows="3">${escapeHtml(c.content || '')}</textarea>`).join("")}</div>
        <small>${escapeHtml(src.source_url || src.file_name || src.source_type)} · ${(src.chunks || []).length} 个分块</small>
      </div>`).join("")}
      ${errors.length ? `<div class="knowledge-error-stack"><b>需要处理</b>${errors.map(e => `<p>${escapeHtml(e.title || e.file_name || e.source_url || '项目')}：${escapeHtml(e.error || '解析失败')}</p>`).join("")}</div>` : ''}`;
  }

  function collectKnowledgePreviewEdits() {
    knowledgePreviewList?.querySelectorAll(".knowledge-preview-card").forEach(card => {
      const idx = Number(card.dataset.idx || 0);
      const src = knowledgePreviewCache[idx];
      if (!src) return;
      src.title = card.querySelector(".knowledge-preview-title")?.value?.trim() || src.title;
      src.summary = card.querySelector(".knowledge-preview-summary")?.value?.trim() || src.summary;
      card.querySelectorAll(".knowledge-preview-chunk").forEach(area => {
        const cidx = Number(area.dataset.cidx || 0);
        if (src.chunks?.[cidx]) src.chunks[cidx].content = area.value.trim();
      });
    });
    return knowledgePreviewCache;
  }

  async function commitKnowledgeImportUI() {
    if (!knowledgePreviewCache.length) return;
    try {
      if (knowledgeCommitBtn) knowledgeCommitBtn.disabled = true;
      const sources = collectKnowledgePreviewEdits();
      const data = await fetch(`${API}/knowledge/import/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources }) }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "入库失败");
      knowledgePreviewCache = [];
      renderKnowledgePreview([]);
      if (knowledgePreviewPanel) knowledgePreviewPanel.hidden = true;
      showFeedback(knowledgeFeedback, `已入库 ${data.committed?.length || 0} 条知识`);
      await loadKnowledgeConsole();
    } catch (err) {
      showFeedback(knowledgeFeedback, err?.message || "入库失败", true);
    } finally {
      if (knowledgeCommitBtn) knowledgeCommitBtn.disabled = false;
    }
  }

  async function saveKnowledgeDetail(item) {
    const title = document.getElementById("knowledge-detail-title")?.value?.trim();
    const summary = document.getElementById("knowledge-detail-summary")?.value?.trim();
    await patchKnowledgeSource(item.id, { title, summary });
  }

  async function patchKnowledgeSource(id, patch) {
    const data = await fetch(`${API}/knowledge/sources/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(r => r.json());
    if (!data.ok) { showFeedback(knowledgeFeedback, data.error || "保存失败", true); return; }
    showFeedback(knowledgeFeedback, "已保存");
    await loadKnowledgeSources();
  }

  async function reparseKnowledgeSourceUI(id) {
    const data = await fetch(`${API}/knowledge/sources/${id}/reparse`, { method: "POST" }).then(r => r.json());
    if (!data.ok) { showFeedback(knowledgeFeedback, data.error || "重新解析失败", true); return; }
    knowledgePreviewCache = [data.preview];
    renderKnowledgePreview([]);
    showFeedback(knowledgeFeedback, "已生成重新解析预览，请确认入库");
  }

  async function deleteKnowledgeSourceUI(id) {
    if (!confirm("确定删除这条知识及其所有分块吗？")) return;
    const data = await fetch(`${API}/knowledge/sources/${id}`, { method: "DELETE" }).then(r => r.json());
    if (!data.ok) { showFeedback(knowledgeFeedback, data.error || "删除失败", true); return; }
    knowledgeActiveSourceId = 0;
    showFeedback(knowledgeFeedback, "已删除");
    await loadKnowledgeSources();
  }

  async function testKnowledgeSearch() {
    const q = knowledgeTestQuery?.value?.trim() || "";
    if (!q) { showFeedback(knowledgeFeedback, "请输入测试问题", true); return; }
    const groupId = knowledgeTestGroup?.value || "";
    if (knowledgeTestResults) knowledgeTestResults.innerHTML = '<div class="wechaty-empty">正在模拟召回…</div>';
    const data = await fetch(`${API}/knowledge/search?q=${encodeURIComponent(q)}&group_id=${encodeURIComponent(groupId)}&limit=10`).then(r => r.json());
    const rows = data.items || [];
    if (knowledgeTestResults) knowledgeTestResults.innerHTML = rows.length ? rows.map(row => `
      <div class="knowledge-test-hit"><b>${escapeHtml(row.title || '未命名')}</b><span>${escapeHtml(row.scope === 'global' ? '全局命中' : '本群命中')} · ${Number(row.score || 0).toFixed(2)}</span><p>${escapeHtml(row.content || '')}</p><small>${escapeHtml(row.source_url || row.file_name || '')}</small></div>`).join("") : '<div class="wechaty-empty">没有命中知识库内容。</div>';
  }

  function dbImageStatusLabel(row = {}) {
    const status = row.vision_status || (row.description ? "done" : "pending");
    return ({
      done: "已解析",
      pending: "待解析",
      running: "解析中",
      error: "解析失败",
      no_model: "无模型",
      disabled: "已停用",
    })[status] || status || "待解析";
  }

  function dbImageStatusClass(row = {}) {
    const status = row.vision_status || (row.description ? "done" : "pending");
    if (row.description) return "done";
    if (status === "running") return "running";
    if (status === "error" || status === "no_model") return status;
    return "pending";
  }

  function renderDbImageGroups(groups = []) {
    if (!dbImageGroup) return;
    const current = dbImageGroup.value || "all";
    const rows = Array.isArray(groups) ? groups : [];
    dbImageGroup.innerHTML = [
      `<option value="all">全部群组</option>`,
      ...rows.map(group => {
        const gid = group.group_id || group.id || "";
        const name = group.group_name || group.topic || gid || "未知群";
        const label = `${name} · ${group.described || 0}/${group.total || 0} 已解析`;
        return `<option value="${escapeHtml(gid || name)}" data-group-name="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
      }),
    ].join("");
    dbImageGroup.value = [...dbImageGroup.options].some(opt => opt.value === current) ? current : "all";
  }

  function renderDbImageProgress(counts = {}) {
    if (!dbImageProgress) return;
    const total = Number(counts.total || 0);
    const described = Number(counts.described || 0);
    const pending = Number(counts.pending || 0);
    const running = Number(counts.running || 0);
    const error = Number(counts.error || 0) + Number(counts.no_model || 0);
    const percent = total ? Math.round((described / total) * 100) : 0;
    dbImageProgress.innerHTML = [
      ["done", described, `已解析 · ${percent}%`],
      ["pending", pending, "待解析"],
      ["", running, counts.worker_running ? "后台解析中" : "解析中"],
      ["error", error, "失败/无模型"],
      ["", Number(counts.base64 || 0), "base64 备份"],
    ].map(([cls, value, label]) => `<div class="db-image-progress-card ${cls}"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`).join("");
  }

  function collectDbImageQuery({ offset = 0 } = {}) {
    const selected = dbImageGroup?.selectedOptions?.[0];
    const groupId = dbImageGroup?.value || "all";
    return {
      groupId,
      groupName: groupId === "all" ? "" : (selected?.dataset?.groupName || selected?.textContent?.replace(/ · .+$/u, "") || ""),
      status: dbImageStatus?.value || "",
      q: dbImageQuery?.value?.trim() || "",
      sender: dbImageSender?.value?.trim() || "",
      from: dbImageFrom?.value || "",
      to: dbImageTo?.value || "",
      limit: 60,
      offset,
    };
  }

  function renderDbImageLibrary(data = {}, { append = false } = {}) {
    if (!dbImageList || !dbImageSummary) return;
    if (!data || data.ok === false) {
      if (!append) dbImageList.innerHTML = `<div class="wechaty-empty">${escapeHtml(data?.error || "图片库读取失败")}</div>`;
      dbImageSummary.textContent = data?.error || "图片库读取失败";
      if (dbImageMoreBtn) dbImageMoreBtn.style.display = "none";
      return;
    }
    renderDbImageGroups(data.groups || []);
    renderDbImageProgress(data.counts || {});
    const rows = Array.isArray(data.items) ? data.items : [];
    const counts = data.counts || {};
    dbImageSummary.textContent = `当前筛选 ${data.total || 0} 张 · 已显示 ${Math.min((data.offset || 0) + rows.length, data.total || 0)} 张 · 已解析 ${counts.described || 0} · 待解析 ${counts.pending || 0} · 失败/无模型 ${(counts.error || 0) + (counts.no_model || 0)} · ${counts.worker_running ? "后台解析中" : "后台空闲"} · 每 10 秒自动刷新`;
    const html = rows.length ? rows.map(row => {
      const src = `${API}/social/wechat-groups/records/media?path=${encodeURIComponent(row.relative_path || "")}`;
      const statusClass = dbImageStatusClass(row);
      const statusLabel = dbImageStatusLabel(row);
      const tags = Array.isArray(row.labels) ? row.labels.slice(0, 6) : [];
      const desc = row.description || row.vision_error || "待后台解析：图片文件已保存，稍后会自动生成描述。";
      return `<article class="db-image-card">
        <a class="db-image-thumb" href="${src}" target="_blank" rel="noreferrer">
          <img src="${src}" alt="${escapeHtml(row.file_name || "微信群图片")}" loading="lazy">
          <span class="db-image-status-badge ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
        </a>
        <div class="db-image-card-body">
          <div class="db-image-card-meta">
            <b title="${escapeHtml(row.sender_id || "")}">${escapeHtml(row.sender_name || "未知成员")}</b>
            <span>${escapeHtml(row.group_name || "未知群")}</span>
            <span>${escapeHtml(formatWechatyTime(row.created_at, true) || String(row.created_at || "").slice(0, 19))}</span>
          </div>
          <div class="db-image-card-desc">${escapeHtml(desc)}</div>
          ${tags.length ? `<div class="db-image-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          <small>${escapeHtml(row.file_name || "")} · ${formatBytes(row.bytes || 0)} · ${escapeHtml(row.vision_model || "未解析")}</small>
          <div class="db-image-card-actions">
            <button class="settings-save-btn ghost" type="button" data-action="edit-image" data-id="${escapeHtml(String(row.id || ""))}">编辑解析</button>
            <button class="settings-save-btn danger" type="button" data-action="delete-image" data-id="${escapeHtml(String(row.id || ""))}">删除图片</button>
          </div>
          <div class="db-image-editor" data-editor-id="${escapeHtml(String(row.id || ""))}" hidden>
            <label>识图描述
              <textarea class="settings-input" data-field="description" rows="5">${escapeHtml(row.description || "")}</textarea>
            </label>
            <label>标签（逗号分隔）
              <input class="settings-input" data-field="labels" value="${escapeHtml(tags.join("，"))}">
            </label>
            <div class="db-image-card-actions">
              <button class="settings-save-btn primary" type="button" data-action="save-image" data-id="${escapeHtml(String(row.id || ""))}">保存修改</button>
              <button class="settings-save-btn ghost" type="button" data-action="cancel-edit-image" data-id="${escapeHtml(String(row.id || ""))}">取消</button>
            </div>
          </div>
        </div>
      </article>`;
    }).join("") : `<div class="wechaty-empty">当前筛选下没有图片。只要微信助手在线并收到群图片，就会自动出现在这里。</div>`;
    if (append && rows.length) dbImageList.insertAdjacentHTML("beforeend", html);
    else dbImageList.innerHTML = html;
    dbImageHasMore = !!data.has_more;
    dbImageOffset = (data.offset || 0) + rows.length;
    if (dbImageMoreBtn) dbImageMoreBtn.style.display = dbImageHasMore ? "" : "none";
  }

  async function loadDbImageLibrary({ append = false, silent = false, autoProcess = false } = {}) {
    const query = collectDbImageQuery({ offset: append ? dbImageOffset : 0 });
    if (dbImageRefreshBtn) dbImageRefreshBtn.disabled = true;
    if (dbImageMoreBtn) dbImageMoreBtn.disabled = true;
    try {
      const params = new URLSearchParams({
        group_id: query.groupId,
        group_name: query.groupName,
        status: query.status,
        q: query.q,
        sender: query.sender,
        from: query.from,
        to: query.to,
        limit: String(query.limit),
        offset: String(query.offset),
      });
      const data = await fetch(`${API}/social/wechat-groups/images?${params}`).then(r => r.json());
      renderDbImageLibrary(data, { append });
      if (autoProcess && data?.counts?.pending > 0 && Date.now() - dbImageLastAutoProcessAt > 30000) {
        dbImageLastAutoProcessAt = Date.now();
        triggerDbImageBackgroundParse({ silent: true }).catch?.(() => {});
      }
      return data;
    } catch (err) {
      if (!silent) showFeedback(dbFeedback, err?.message || "图片库读取失败", true);
      renderDbImageLibrary({ ok: false, error: "图片库读取失败" }, { append });
      return null;
    } finally {
      if (dbImageRefreshBtn) dbImageRefreshBtn.disabled = false;
      if (dbImageMoreBtn) dbImageMoreBtn.disabled = false;
    }
  }

  async function triggerDbImageBackgroundParse({ silent = false } = {}) {
    const query = collectDbImageQuery({ offset: 0 });
    if (dbImageProcessBtn) dbImageProcessBtn.disabled = true;
    try {
      const data = await fetch(`${API}/social/wechat-groups/images/describe-pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: query.groupId, group_name: query.groupName, limit: 5, retryErrors: true }),
      }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "启动解析失败");
      if (!silent) showFeedback(dbFeedback, data.started ? "已启动后台解析，列表会自动刷新" : "后台解析已在运行，稍等刷新");
      setTimeout(() => loadDbImageLibrary({ silent: true }), 1200);
    } catch (err) {
      if (!silent) showFeedback(dbFeedback, err?.message || "启动解析失败", true);
    } finally {
      if (dbImageProcessBtn) dbImageProcessBtn.disabled = false;
    }
  }

  function toggleDbImageEditor(id = "", open = true) {
    const editor = dbImageList?.querySelector?.(`.db-image-editor[data-editor-id="${CSS.escape(String(id || ""))}"]`);
    if (!editor) return;
    editor.hidden = !open;
    if (open) editor.querySelector('[data-field="description"]')?.focus?.();
  }

  async function saveDbImageEdit(id = "") {
    const editor = dbImageList?.querySelector?.(`.db-image-editor[data-editor-id="${CSS.escape(String(id || ""))}"]`);
    if (!editor) return;
    const description = editor.querySelector('[data-field="description"]')?.value || "";
    const labels = String(editor.querySelector('[data-field="labels"]')?.value || "")
      .split(/[，,、\n\r]+/u)
      .map(v => v.trim())
      .filter(Boolean);
    try {
      const data = await fetch(`${API}/social/wechat-groups/images/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, description, labels, vision_status: description.trim() ? "done" : "pending" }),
      }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "保存失败");
      showFeedback(dbFeedback, "图片解析内容已保存");
      await loadDbImageLibrary({ append: false, silent: true });
    } catch (err) {
      showFeedback(dbFeedback, err?.message || "保存失败", true);
    }
  }

  async function deleteDbImage(id = "") {
    if (!id) return;
    if (!confirm("确定删除这张图片吗？会删除图片库记录，并尝试删除本机已入库的微信图片文件。此操作不可恢复。")) return;
    try {
      const data = await fetch(`${API}/social/wechat-groups/images/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, deleteFile: true }),
      }).then(r => r.json());
      if (!data.ok) throw new Error(data.error || "删除失败");
      const suffix = data.file_deleted ? "，本地文件已删除" : (data.file_delete_error ? `，文件删除失败：${data.file_delete_error}` : "");
      showFeedback(dbFeedback, `图片已删除${suffix}`);
      await loadDbImageLibrary({ append: false, silent: true });
      await loadDatabaseSettings();
    } catch (err) {
      showFeedback(dbFeedback, err?.message || "删除失败", true);
    }
  }

  function makeSkillChannelId(prefix = "skill") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizeSkillChannelsForUi(config = {}, kind = "image") {
    const defaults = kind === "video"
      ? { name: "默认视频解析渠道", baseUrl: "", model: "gpt-4o-mini" }
      : kind === "vision"
      ? { name: "默认识图渠道", baseUrl: "", model: "gpt-4o-mini" }
      : { name: "默认生图渠道", baseUrl: "", model: "gpt-image-2" };
    const rows = Array.isArray(config.channels) && config.channels.length ? config.channels : [{
      id: config.activeChannelId || `${kind}_default`,
      name: defaults.name,
      enabled: true,
      baseUrl: config.baseUrl || defaults.baseUrl,
      model: config.model || defaults.model,
      configured: !!config.configured,
    }];
    return rows.map((row, index) => ({
      id: String(row.id || makeSkillChannelId(kind)).trim(),
      name: String(row.name || row.label || `${defaults.name} ${index + 1}`).trim(),
      enabled: row.enabled !== false,
      provider: String(row.provider || "custom").trim(),
      baseUrl: String(row.baseUrl || row.base_url || defaults.baseUrl).trim(),
      model: String(row.model || defaults.model).trim(),
      configured: !!row.configured,
      apiKeyHint: String(row.apiKeyHint || row.api_key_hint || "").trim(),
      modelOptions: Array.isArray(row.modelOptions) ? row.modelOptions : [],
      requestParams: row.requestParams && typeof row.requestParams === "object" && !Array.isArray(row.requestParams) ? row.requestParams : {},
      apiKey: "",
    })).sort((a, b) => {
      const activeId = String(config.activeChannelId || "").trim();
      if (activeId && a.id === activeId) return -1;
      if (activeId && b.id === activeId) return 1;
      return 0;
    });
  }

  function getSkillChannelState(kind = "image") {
    return kind === "video"
      ? { channels: skillVideoChannels, activeId: skillVideoActiveChannelId, list: skillVideoChannelList, feedback: skillVideoFeedback, models: BUILTIN_VIDEO_MODELS }
      : kind === "vision"
      ? { channels: skillVisionChannels, activeId: skillVisionActiveChannelId, list: skillVisionChannelList, feedback: skillVisionFeedback, models: BUILTIN_VISION_MODELS }
      : { channels: skillImageChannels, activeId: skillImageActiveChannelId, list: skillImageChannelList, feedback: skillImageFeedback, models: BUILTIN_IMAGE_MODELS };
  }

  function setSkillChannelState(kind = "image", channels = [], activeId = "") {
    if (kind === "video") {
      skillVideoChannels = channels;
      skillVideoActiveChannelId = activeId || channels.find(ch => ch.enabled !== false)?.id || channels[0]?.id || "";
    } else if (kind === "vision") {
      skillVisionChannels = channels;
      skillVisionActiveChannelId = activeId || channels.find(ch => ch.enabled !== false)?.id || channels[0]?.id || "";
    } else {
      skillImageChannels = channels;
      skillImageActiveChannelId = activeId || channels.find(ch => ch.enabled !== false)?.id || channels[0]?.id || "";
    }
  }

  function renderSkillChannels(kind = "image") {
    const state = getSkillChannelState(kind);
    const list = state.list;
    if (!list) return;
    const channels = state.channels;
    if (!channels.length) {
      const label = kind === "video" ? "视频" : kind === "vision" ? "识图" : "生图";
      list.innerHTML = `<div class="wechaty-empty">还没有渠道，点击“新增${label}渠道”。</div>`;
      return;
    }
    const baseModelOptions = (kind === "video" ? buildVideoModelOptions("") : kind === "vision" ? buildVisionModelOptions("") : BUILTIN_IMAGE_MODELS)
      .map(item => ({ value: item.value || item.id || item, label: item.label || item.name || item.value || item }));
    list.innerHTML = channels.map((ch, index) => {
      const isActive = ch.id === state.activeId || (!state.activeId && index === 0);
      const keyText = ch.apiKeyHint || (ch.configured ? "已保存" : "未填写");
      const requestParamsText = Object.keys(ch.requestParams || {}).length ? JSON.stringify(ch.requestParams, null, 2) : "";
      const channelModels = (Array.isArray(ch.modelOptions) ? ch.modelOptions : [])
        .map(item => typeof item === "string" ? { value: item, label: item } : { value: item.value || item.id || item.model || "", label: item.label || item.name || item.value || item.id || item.model || "" })
        .filter(item => item.value);
      const options = (() => {
        const seen = new Set();
        const rows = [];
        if (ch.model) {
          rows.push({ value: ch.model, label: `${ch.model}（当前）` });
          seen.add(ch.model);
        }
        for (const item of [...channelModels, ...baseModelOptions]) {
          if (!item.value || seen.has(item.value)) continue;
          seen.add(item.value);
          rows.push(item);
        }
        return rows.map(item => `<option value="${escapeHtml(item.value)}" ${item.value === ch.model ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
      })();
      return `
        <div class="wechaty-member-card skill-channel-card" data-kind="${escapeHtml(kind)}" data-index="${index}" style="display:block;padding:12px;">
          <div class="wechaty-member-row" style="align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
            <span class="settings-platform-status ${isActive ? "ok" : "miss"}">${isActive ? "● 当前使用" : "○ 备用渠道"}</span>
            <div style="display:grid;gap:4px;min-width:220px;flex:1;">
              <strong>${escapeHtml(ch.name || "未命名渠道")}</strong>
              <small>${escapeHtml(ch.baseUrl || "未填写 Base URL")} · ${escapeHtml(ch.model || "未选择模型")} · Key: ${escapeHtml(keyText)}</small>
            </div>
          </div>
          <div class="wechaty-member-row" style="align-items:center;gap:10px;flex-wrap:wrap;">
            <label class="wechaty-master-toggle" style="margin:0;"><input type="checkbox" data-field="enabled" ${ch.enabled !== false ? "checked" : ""}><span>启用</span></label>
            <label class="wechaty-master-toggle" style="margin:0;"><input type="radio" name="skill-${escapeHtml(kind)}-active-channel" data-action="active" ${isActive ? "checked" : ""}><span>设为当前</span></label>
            <span class="settings-platform-status ${ch.configured ? "ok" : ""}">${ch.configured ? `● Key ${escapeHtml(keyText)}` : "○ 未保存密钥"}</span>
            <button class="settings-save-btn" type="button" data-action="up" style="width:auto;padding:0 10px;">上移</button>
            <button class="settings-save-btn" type="button" data-action="down" style="width:auto;padding:0 10px;">下移</button>
            <button class="settings-save-btn" type="button" data-action="test" style="width:auto;padding:0 10px;">测试连通</button>
            <button class="settings-save-btn" type="button" data-action="models" style="width:auto;padding:0 10px;">获取模型</button>
            <button class="settings-save-btn danger" type="button" data-action="remove" style="width:auto;padding:0 10px;">删除</button>
          </div>
          <div class="wechaty-meme-grid" style="margin-top:10px;">
            <label>渠道名称<input class="settings-input" data-field="name" type="text" value="${escapeHtml(ch.name || "")}" placeholder="例如：嘟嘟GPT / 官方 / 备用1"></label>
            <label>Base URL<input class="settings-input" data-field="baseUrl" type="text" value="${escapeHtml(ch.baseUrl || "")}" placeholder="https://.../v1"></label>
            <label>模型<select class="settings-select" data-field="model">${options}</select></label>
            <label>API Key<input class="settings-input" data-field="apiKey" type="password" value="" placeholder="${escapeHtml(ch.configured ? `已保存 ${keyText}，留空保留；输入新 Key 则替换` : "未保存，填写后本机保存") }"></label>
            <label style="grid-column:1/-1;">自定义请求参数 JSON<textarea class="settings-input" data-field="requestParamsText" rows="3" placeholder='例如：{"req_key":"high_aes_general_v30l_zt2i"}'>${escapeHtml(requestParamsText)}</textarea></label>
          </div>
        </div>
      `;
    }).join("");
  }

  function addSkillChannel(kind = "image") {
    const defaults = kind === "video"
      ? { name: "新视频解析渠道", baseUrl: skillVideoBaseUrl?.value || "", model: skillVideoModel?.value || "gpt-4o-mini" }
      : kind === "vision"
      ? { name: "新识图渠道", baseUrl: skillVisionBaseUrl?.value || "", model: skillVisionModel?.value || "gpt-4o-mini" }
      : { name: "新生图渠道", baseUrl: skillImageBaseUrl?.value || "", model: skillImageModel?.value || "gpt-image-2" };
    const state = getSkillChannelState(kind);
    const channels = [...state.channels, { id: makeSkillChannelId(kind), enabled: true, provider: "custom", configured: false, apiKey: "", ...defaults }];
    setSkillChannelState(kind, channels, state.activeId || channels[0]?.id || "");
    renderSkillChannels(kind);
  }

  function syncSkillChannelInputs(kind = "image") {
    const state = getSkillChannelState(kind);
    state.list?.querySelectorAll(".skill-channel-card").forEach(card => {
      const index = Number(card.dataset.index || -1);
      const ch = state.channels[index];
      if (!ch) return;
      card.querySelectorAll("[data-field]").forEach(input => {
        const field = input.dataset.field;
        if (field === "enabled") ch.enabled = input.checked;
        else if (field === "requestParamsText") ch.requestParamsText = input.value;
        else ch[field] = input.value;
      });
      if (card.querySelector("[data-action='active']")?.checked) {
        if (kind === "video") skillVideoActiveChannelId = ch.id;
        else if (kind === "vision") skillVisionActiveChannelId = ch.id;
        else skillImageActiveChannelId = ch.id;
      }
    });
  }

  async function testSkillChannel(kind = "image", index = 0) {
    syncSkillChannelInputs(kind);
    const state = getSkillChannelState(kind);
    const channel = state.channels[index];
    if (!channel) return;
    try {
      showFeedback(state.feedback, "正在测试渠道连通...");
      const data = await fetch(`${API}/settings/skills/test-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: kind === "video" ? "videoAnalysis" : kind === "vision" ? "imageVision" : "imageGeneration", channel }),
      }).then(r => r.json());
      if (data.ok) showFeedback(state.feedback, `${channel.name || channel.model} 连通正常，${data.latencyMs || 0}ms`);
      else showFeedback(state.feedback, `${channel.name || channel.model} 不通：${data.error || "未知错误"}`, true);
    } catch (err) {
      showFeedback(state.feedback, err?.message || "测试失败", true);
    }
  }

  async function loadSkillChannelModels(kind = "image", index = 0) {
    syncSkillChannelInputs(kind);
    const state = getSkillChannelState(kind);
    const channel = state.channels[index];
    if (!channel) return;
    try {
      showFeedback(state.feedback, "正在从当前渠道获取模型列表...");
      const data = await fetch(`${API}/settings/skills/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: kind === "video" ? "videoAnalysis" : kind === "vision" ? "imageVision" : "imageGeneration", channel }),
      }).then(r => r.json());
      if (!data.ok) {
        showFeedback(state.feedback, `${channel.name || channel.baseUrl || "渠道"} 获取模型失败：${data.error || "未知错误"}`, true);
        return;
      }
      const models = Array.isArray(data.models) ? data.models.filter(Boolean) : [];
      channel.modelOptions = models;
      if (!channel.model && models[0]) channel.model = models[0];
      showFeedback(state.feedback, `已获取 ${models.length} 个模型，${data.latencyMs || 0}ms`);
      renderSkillChannels(kind);
    } catch (err) {
      showFeedback(state.feedback, err?.message || "获取模型列表失败", true);
    }
  }

  function handleSkillChannelListClick(kind = "image", event) {
    const card = event.target?.closest?.(".skill-channel-card");
    const action = event.target?.dataset?.action;
    if (!card || !action) return;
    syncSkillChannelInputs(kind);
    const state = getSkillChannelState(kind);
    const index = Number(card.dataset.index || -1);
    const channels = [...state.channels];
    if (action === "active" && channels[index]) {
      setSkillChannelState(kind, channels, channels[index].id);
    } else if (action === "remove") {
      channels.splice(index, 1);
      setSkillChannelState(kind, channels, state.activeId === state.channels[index]?.id ? "" : state.activeId);
    } else if (action === "up" && index > 0) {
      [channels[index - 1], channels[index]] = [channels[index], channels[index - 1]];
      setSkillChannelState(kind, channels, state.activeId);
    } else if (action === "down" && index >= 0 && index < channels.length - 1) {
      [channels[index + 1], channels[index]] = [channels[index], channels[index + 1]];
      setSkillChannelState(kind, channels, state.activeId);
    } else if (action === "test") {
      testSkillChannel(kind, index);
      return;
    } else if (action === "models") {
      loadSkillChannelModels(kind, index);
      return;
    }
    renderSkillChannels(kind);
  }

  function buildSkillChannelsPayload(kind = "image") {
    syncSkillChannelInputs(kind);
    const state = getSkillChannelState(kind);
    const parseParams = (text = "") => {
      const raw = String(text || "").trim();
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("必须是 JSON 对象");
        return parsed;
      } catch (err) {
        throw new Error(`自定义请求参数 JSON 格式错误：${err?.message || err}`);
      }
    };
    return {
      activeChannelId: state.activeId,
      channels: state.channels.map(ch => ({
        id: ch.id,
        name: ch.name,
        enabled: ch.enabled !== false,
        provider: ch.provider || "custom",
        baseUrl: ch.baseUrl,
        model: ch.model,
        requestParams: parseParams(ch.requestParamsText || (ch.requestParams ? JSON.stringify(ch.requestParams) : "")),
        ...(String(ch.apiKey || "").trim() ? { apiKey: String(ch.apiKey || "").trim() } : {}),
      })),
    };
  }

  function applySkillImageConfig(config = {}) {
    if (skillImageEnabled) skillImageEnabled.checked = config.enabled !== false;
    if (skillImageFailover) skillImageFailover.checked = config.failoverEnabled !== false;
    if (skillImageBaseUrl) skillImageBaseUrl.value = config.baseUrl || '';
    fillSelectOptions(skillImageModel, BUILTIN_IMAGE_MODELS, config.model || 'gpt-image-2');
    if (skillImageLimit) skillImageLimit.value = String(config.maxPerUserPerHour || 10);
    if (skillImageTimeout) skillImageTimeout.value = String(config.apiTimeoutSeconds || 180);
    if (skillImageDefaultQuality) skillImageDefaultQuality.value = config.defaultQuality || 'low';
    if (skillImageHighQuality) skillImageHighQuality.value = config.highQuality || 'high';
    if (skillImageKey) skillImageKey.value = '';
    if (skillImageStatus) {
    const channelCount = (config.channels || []).filter(ch => ch.enabled !== false && ch.configured).length;
      const mode = config.failoverEnabled === false ? '单渠道' : '自动切换';
      skillImageStatus.textContent = config.configured ? `● 已配置 ${channelCount || 1} 个渠道 / ${mode}` : '○ 未配置密钥';
      skillImageStatus.classList.toggle('ok', !!config.configured);
    }
    setSkillChannelState("image", normalizeSkillChannelsForUi(config, "image"), config.activeChannelId || "");
    renderSkillChannels("image");
  }

  function applySkillVisionConfig(config = {}, status = null) {
    const hasConfig = Object.keys(config || {}).length > 0;
    if (hasConfig && skillVisionEnabled) skillVisionEnabled.checked = config.enabled !== false;
    if (hasConfig && skillVisionFailover) skillVisionFailover.checked = config.failoverEnabled !== false;
    if (hasConfig && skillVisionPreferCurrent) skillVisionPreferCurrent.checked = config.preferCurrentMultimodal !== false;
    if (hasConfig && skillVisionBaseUrl) skillVisionBaseUrl.value = config.baseUrl || '';
    if (hasConfig) fillSelectOptions(skillVisionModel, buildVisionModelOptions(config.model || 'gpt-4o-mini'), config.model || 'gpt-4o-mini');
    if (hasConfig && skillVisionTimeout) skillVisionTimeout.value = String(config.apiTimeoutSeconds || 45);
    if (hasConfig && skillVisionKey) skillVisionKey.value = '';
    const runtime = status?.runtime || null;
    const configured = !!runtime || !!config.configured;
    if (skillVisionStatus) {
      const channelCount = (config.channels || []).filter(ch => ch.enabled !== false && ch.configured).length;
      const health = status?.health || "";
      const modelText = runtime?.model || config.model || "";
      const mode = config.failoverEnabled === false ? '单渠道' : '自动切换';
      if (!configured) {
        skillVisionStatus.textContent = '○ 未配置识图模型';
        skillVisionStatus.classList.remove('ok');
      } else if (health === "error") {
        skillVisionStatus.textContent = `⚠ 已配置但最近失败 ${modelText}${channelCount ? ` / ${channelCount} 渠道` : ''} / ${mode}`;
        skillVisionStatus.classList.remove('ok');
      } else if (health === "ok") {
        skillVisionStatus.textContent = `● 最近识图成功 ${modelText}${channelCount ? ` / ${channelCount} 渠道` : ''} / ${mode}`;
        skillVisionStatus.classList.add('ok');
      } else {
        skillVisionStatus.textContent = `● 已配置待真实识图 ${modelText}${channelCount ? ` / ${channelCount} 渠道` : ''} / ${mode}`;
        skillVisionStatus.classList.toggle('ok', configured);
      }
    }
    if (skillVisionCounts) {
      const counts = status?.counts || {};
      const latestError = status?.latest_error?.vision_error ? `；最近失败：${String(status.latest_error.vision_error).slice(0, 120)}` : "";
      skillVisionCounts.textContent = `图片入库：${counts.total || 0}，已描述：${counts.described || 0}，待处理：${counts.pending || 0}，解析中：${counts.running || 0}，失败：${counts.error || 0}，base64：${counts.base64 || 0}${latestError}`;
    }
    if (hasConfig) {
      setSkillChannelState("vision", normalizeSkillChannelsForUi(config, "vision"), config.activeChannelId || "");
      renderSkillChannels("vision");
    }
  }

  function applySkillVideoConfig(config = {}, status = null) {
    const hasConfig = Object.keys(config || {}).length > 0;
    if (hasConfig && skillVideoEnabled) skillVideoEnabled.checked = config.enabled !== false;
    if (hasConfig && skillVideoFailover) skillVideoFailover.checked = config.failoverEnabled !== false;
    if (hasConfig && skillVideoBaseUrl) skillVideoBaseUrl.value = config.baseUrl || '';
    if (hasConfig) fillSelectOptions(skillVideoModel, buildVideoModelOptions(config.model || 'gpt-4o-mini'), config.model || 'gpt-4o-mini');
    if (hasConfig && skillVideoTimeout) skillVideoTimeout.value = String(config.apiTimeoutSeconds || 90);
    if (hasConfig && skillVideoMaxMb) skillVideoMaxMb.value = String(config.maxVideoBytesMB || 25);
    if (hasConfig && skillVideoKey) skillVideoKey.value = '';
    const runtime = status?.runtime || null;
    const configured = !!runtime || !!config.configured;
    if (skillVideoStatus) {
      const channelCount = (config.channels || []).filter(ch => ch.enabled !== false && ch.configured).length;
      const modelText = runtime?.model || config.model || "";
      const mode = config.failoverEnabled === false ? '单渠道' : '自动切换';
      if (!configured) {
        skillVideoStatus.textContent = '○ 未配置视频模型';
        skillVideoStatus.classList.remove('ok');
      } else {
        skillVideoStatus.textContent = `● 已配置 ${modelText}${channelCount ? ` / ${channelCount} 渠道` : ''} / ${mode}`;
        skillVideoStatus.classList.add('ok');
      }
    }
    if (skillVideoCounts) {
      const last = status?.lastRun || null;
      const tail = last?.at ? `；最近：${last.ok ? '成功' : '失败'} ${last.runtime?.model || ''} ${last.latencyMs ? `${last.latencyMs}ms` : ''}${last.tempDeleted ? '；临时文件已删' : ''}` : '';
      skillVideoCounts.textContent = `临时视频：解析完成即删除，不写入图片库/媒体库${tail}`;
    }
    if (hasConfig) {
      setSkillChannelState("video", normalizeSkillChannelsForUi(config, "video"), config.activeChannelId || "");
      renderSkillChannels("video");
    }
  }

  async function loadSkillSettings() {
    try {
      const [data, settings] = await Promise.all([
        fetch(`${API}/settings/skills`).then(r => r.json()),
        fetch(`${API}/settings`).then(r => r.json()).catch(() => null),
      ]);
      if (settings?.llm) {
        cachedActiveLLM = settings.llm;
        cachedLLMProfiles = Array.isArray(settings.llm.profiles) ? settings.llm.profiles : cachedLLMProfiles;
      }
      applySkillImageConfig(data.skills?.imageGeneration || {});
      applySkillVisionConfig(data.skills?.imageVision || {}, null);
      applySkillVideoConfig(data.skills?.videoAnalysis || {}, null);
      refreshSkillVisionStatus();
      refreshSkillVideoStatus();
    } catch {
      showFeedback(skillImageFeedback, 'Skill 设置加载失败', true);
    }
  }

  async function refreshSkillVisionStatus() {
    try {
      const data = await fetch(`${API}/settings/skills/image-vision/status`).then(r => r.json());
      if (data.ok) applySkillVisionConfig({}, data.status || {});
    } catch {
      showFeedback(skillVisionFeedback, '识图状态刷新失败', true);
    }
  }

  async function refreshSkillVideoStatus() {
    try {
      const data = await fetch(`${API}/settings/skills/video-analysis/status`).then(r => r.json());
      if (data.ok) applySkillVideoConfig({}, data.status || {});
    } catch {
      showFeedback(skillVideoFeedback, '视频解析状态刷新失败', true);
    }
  }

  async function saveSkillImageConfig() {
    let channelPayload;
    try {
      channelPayload = buildSkillChannelsPayload("image");
    } catch (err) {
      showFeedback(skillImageFeedback, err?.message || "渠道配置格式错误", true);
      return;
    }
    const payload = {
      enabled: skillImageEnabled?.checked !== false,
      failoverEnabled: skillImageFailover?.checked !== false,
      baseUrl: skillImageBaseUrl?.value?.trim() || '',
      model: skillImageModel?.value?.trim() || 'gpt-image-2',
      activeChannelId: channelPayload.activeChannelId,
      channels: channelPayload.channels,
      maxPerUserPerHour: Number(skillImageLimit?.value || 10),
      apiTimeoutSeconds: Number(skillImageTimeout?.value || 180),
      defaultQuality: skillImageDefaultQuality?.value || 'low',
      highQuality: skillImageHighQuality?.value || 'high',
    };
    const key = skillImageKey?.value?.trim();
    if (key) payload.apiKey = key;
    try {
      const data = await fetch(`${API}/settings/skills/image-generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (data.ok) {
        applySkillImageConfig(data.imageGeneration || payload);
        showFeedback(skillImageFeedback, '生图 Skill 已保存，立即生效');
      } else showFeedback(skillImageFeedback, data.error || '保存失败', true);
    } catch {
      showFeedback(skillImageFeedback, '保存请求失败', true);
    }
  }

  async function saveSkillVisionConfig() {
    let channelPayload;
    try {
      channelPayload = buildSkillChannelsPayload("vision");
    } catch (err) {
      showFeedback(skillVisionFeedback, err?.message || "渠道配置格式错误", true);
      return;
    }
    const payload = {
      enabled: skillVisionEnabled?.checked !== false,
      autoDescribe: true,
      preferCurrentMultimodal: skillVisionPreferCurrent?.checked !== false,
      failoverEnabled: skillVisionFailover?.checked !== false,
      baseUrl: skillVisionBaseUrl?.value?.trim() || '',
      model: skillVisionModel?.value?.trim() || 'gpt-4o-mini',
      activeChannelId: channelPayload.activeChannelId,
      channels: channelPayload.channels,
      apiTimeoutSeconds: Number(skillVisionTimeout?.value || 45),
    };
    const key = skillVisionKey?.value?.trim();
    if (key) payload.apiKey = key;
    try {
      const data = await fetch(`${API}/settings/skills/image-vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (data.ok) {
        applySkillVisionConfig(data.imageVision || payload, data.status || null);
        showFeedback(skillVisionFeedback, '识图 Skill 已保存，立即生效');
      } else showFeedback(skillVisionFeedback, data.error || '保存失败', true);
    } catch {
      showFeedback(skillVisionFeedback, '保存请求失败', true);
    }
  }

  async function saveSkillVideoConfig() {
    let channelPayload;
    try {
      channelPayload = buildSkillChannelsPayload("video");
    } catch (err) {
      showFeedback(skillVideoFeedback, err?.message || "渠道配置格式错误", true);
      return;
    }
    const payload = {
      enabled: skillVideoEnabled?.checked !== false,
      failoverEnabled: skillVideoFailover?.checked !== false,
      baseUrl: skillVideoBaseUrl?.value?.trim() || '',
      model: skillVideoModel?.value?.trim() || 'gpt-4o-mini',
      activeChannelId: channelPayload.activeChannelId,
      channels: channelPayload.channels,
      apiTimeoutSeconds: Number(skillVideoTimeout?.value || 90),
      maxVideoBytesMB: Number(skillVideoMaxMb?.value || 25),
    };
    const key = skillVideoKey?.value?.trim();
    if (key) payload.apiKey = key;
    try {
      const data = await fetch(`${API}/settings/skills/video-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (data.ok) {
        applySkillVideoConfig(data.videoAnalysis || payload, data.status || null);
        showFeedback(skillVideoFeedback, '视频解析 Skill 已保存，立即生效');
      } else showFeedback(skillVideoFeedback, data.error || '保存失败', true);
    } catch {
      showFeedback(skillVideoFeedback, '保存请求失败', true);
    }
  }

  function applyWechatyMemeConfig(config = {}) {
    if (wechatyMemeEnabled) wechatyMemeEnabled.checked = config.enabled !== false;
    if (wechatyMemeProvider) wechatyMemeProvider.value = config.provider || 'xiaoapi';
    if (wechatyMemeMax) wechatyMemeMax.value = String(config.maxPerMessage || 1);
    if (wechatyMemeCooldown) wechatyMemeCooldown.value = String(config.cooldownSeconds || 30);
  }

  function renderWechatyMemePreview(items = [], error = '') {
    if (!wechatyMemePreview) return;
    if (error) {
      wechatyMemePreview.innerHTML = `<div class="wechaty-empty">${escapeHtml(error)}</div>`;
      return;
    }
    if (!items.length) {
      wechatyMemePreview.innerHTML = '<div class="wechaty-empty">没有搜索到可发送的网络表情包。</div>';
      return;
    }
    wechatyMemePreview.innerHTML = items.slice(0, 8).map(item => {
      const url = escapeHtml(item.url || '');
      const meta = `${item.type || 'image'} · ${item.width || 0}×${item.height || 0}`;
      return `<div class="wechaty-meme-preview-card" title="${url}"><img src="${url}" alt="表情包预览" loading="lazy"><small>${escapeHtml(meta)}</small></div>`;
    }).join('');
  }

  async function testWechatyMemeSearch() {
    const query = wechatyMemeTestQuery?.value?.trim() || '鄙视';
    if (wechatyMemePreview) wechatyMemePreview.innerHTML = '<div class="wechaty-empty">正在搜索表情包…</div>';
    try {
      const data = await fetch(`${API}/social/meme/search?query=${encodeURIComponent(query)}&count=8`).then(r => r.json());
      if (data.ok) {
        renderWechatyMemePreview(data.items || []);
        showFeedback(wechatyMemeFeedback || wechatyDutyFeedback, `搜索完成：${data.count || 0} 张`);
      } else {
        renderWechatyMemePreview([], data.error || '搜索失败');
        showFeedback(wechatyMemeFeedback || wechatyDutyFeedback, data.error || '搜索失败', true);
      }
    } catch {
      renderWechatyMemePreview([], '搜索请求失败');
      showFeedback(wechatyMemeFeedback || wechatyDutyFeedback, '搜索请求失败', true);
    }
  }

  async function saveWechatyMemeConfig() {
    const payload = {
      enabled: wechatyMemeEnabled?.checked !== false,
      provider: wechatyMemeProvider?.value || 'xiaoapi',
      maxPerMessage: Number(wechatyMemeMax?.value || 1),
      cooldownSeconds: Number(wechatyMemeCooldown?.value || 30),
    };
    try {
      const data = await fetch(`${API}/settings/wechat-meme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (data.ok) {
        applyWechatyMemeConfig(data.wechatMeme || payload);
        showFeedback(wechatyMemeFeedback || wechatyDutyFeedback, '斗图设置已保存，立即生效');
      } else showFeedback(wechatyMemeFeedback || wechatyDutyFeedback, data.error || '保存失败', true);
    } catch {
      showFeedback(wechatyMemeFeedback || wechatyDutyFeedback, '保存请求失败', true);
    }
  }

  function applyWechatyOfflineQrNotifyConfig(config = {}, status = {}, options = {}) {
    const notify = options.controlOverride || config.offlineQrNotify || {};
    const runtime = status.offline_qr_notify || {};
    const enabled = notify.enabled !== false;
    const autoRelogin = notify.autoRelogin !== false;
    const cooldown = Number(notify.cooldownMinutes || runtime.cooldown_minutes || 15);
    const keepLocalControls = !options.forceControls && Date.now() - wechatyOfflineQrNotifyLastEditAt < 3000;
    if (!keepLocalControls) {
      if (wechatyOfflineQrNotifyEnabled) wechatyOfflineQrNotifyEnabled.checked = enabled;
      if (wechatyOfflineQrNotifyAutoRelogin) wechatyOfflineQrNotifyAutoRelogin.checked = autoRelogin;
      if (wechatyOfflineQrNotifyCooldown) wechatyOfflineQrNotifyCooldown.value = String([5, 10, 15, 30, 60].includes(cooldown) ? cooldown : 15);
    }
    if (!wechatyOfflineQrNotifyStatus) return;
    const clawbotConnected = runtime.clawbot_connected === true;
    const lastSent = runtime.last_sent_at ? new Date(runtime.last_sent_at).toLocaleString('zh-CN', { hour12: false }) : '';
    const lastError = runtime.last_error || '';
    if (!enabled) {
      wechatyOfflineQrNotifyStatus.textContent = "已关闭";
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state miss";
    } else if (!clawbotConnected) {
      wechatyOfflineQrNotifyStatus.textContent = "等待 ClawBot";
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state miss";
    } else if (lastError) {
      wechatyOfflineQrNotifyStatus.textContent = `通知失败：${lastError.slice(0, 24)}`;
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state miss";
    } else if (lastSent) {
      wechatyOfflineQrNotifyStatus.textContent = `已启用 · 最近发送 ${lastSent}`;
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state ok";
    } else {
      wechatyOfflineQrNotifyStatus.textContent = "已启用";
      wechatyOfflineQrNotifyStatus.className = "wechaty-offline-notify-state ok";
    }
  }

  function renderWechatyQr(qr = "") {
    const value = String(qr || "").trim();
    if (wechatyQrArea) wechatyQrArea.style.display = value ? "flex" : "none";
    if (!wechatyQrImg) return;
    if (value) {
      wechatyQrImg.src = `${API}/qr.png?data=${encodeURIComponent(value)}&t=${Date.now()}`;
      wechatyQrImg.alt = "Wechaty 微信登录二维码";
    } else {
      wechatyQrImg.removeAttribute("src");
    }
  }

  function applyWechatyDutyConfig(config = {}, status = {}) {
    if (wechatyDutyEnabled) wechatyDutyEnabled.checked = config.enabled !== false;
    applyWechatyConcurrencyConfig(config || {}, status || {});
    applyWechatyAmbientConfig(config || {}, status || {});
    applyWechatyAdminConfig(config || {});
    applyWechatyBlockedConfig(config || {});
    applyWechatyOfflineQrNotifyConfig(config || {}, status || {});
    const hasPersonaPrompt = Object.prototype.hasOwnProperty.call(config, "personaPrompt");
    if (hasPersonaPrompt) {
      wechatySavedPersonaPrompt = config.personaPrompt || "";
      wechatySavedPersonaPresetId = config.personaPresetId || describeWechatyPersona(wechatySavedPersonaPrompt).id;
    }
    if (hasPersonaPrompt && wechatyPersonaPrompt && document.activeElement !== wechatyPersonaPrompt) {
      wechatyPersonaPrompt.value = config.personaPrompt || "";
      updateWechatyPersonaActiveLabel(wechatyPersonaPrompt.value);
    } else {
      updateWechatyPersonaCurrentStatus();
    }
    const configuredNames = (Array.isArray(config.groupNames) ? config.groupNames : (status.group_names || []))
      .map(v => String(v || '').trim())
      .filter(Boolean);
    wechatyConfiguredGroupNames = new Set(configuredNames);
    wechatyRoomsAreStale = !!status.rooms_stale || (!!status.rooms?.length && status.online === false);
    if (Array.isArray(status.rooms) && status.rooms.length) {
      wechatyRoomsCache = status.rooms;
      if (!wechatyGroupSelectionDirty) {
        wechatySelectedGroupNames = new Set([
          ...configuredNames,
          ...status.rooms.filter(r => r.selected || wechatyConfiguredGroupNames.has(r.topic)).map(r => r.topic),
        ].map(v => String(v || '').trim()).filter(Boolean));
      }
    } else if (wechatyRoomsCache.length) {
      wechatyRoomsAreStale = true;
      if (!wechatyGroupSelectionDirty) {
        wechatySelectedGroupNames = new Set([
          ...configuredNames,
          ...wechatyRoomsCache.filter(r => wechatyConfiguredGroupNames.has(r.topic) || r.selected).map(r => r.topic),
        ].map(v => String(v || '').trim()).filter(Boolean));
      }
    } else if (!wechatyGroupSelectionDirty) {
      wechatySelectedGroupNames = new Set(wechatyConfiguredGroupNames);
    }
    const connected = status.online === true && status.status === "connected";
    const offline = status.connection_state === "offline" || status.needs_relogin === true || (["disconnected", "error", "relogin_required", "group_lookup_error", "rooms_stale", "group_not_found"].includes(status.status) && !connected);
    const matchedCount = Object.keys(status.room_ids || {}).filter(k => status.room_ids[k]).length;
    renderWechatyQr(status.qr || "");
    if (wechatyLoginSub) {
      const user = status.login_user || status.last_login_user || '';
      const suffix = describeWechatyCachedSuffix(status);
      if (connected) wechatyLoginSub.textContent = `${user ? `已真实在线：${user}。` : '已真实在线。'}已接入 ${matchedCount} 个群，可自由回复。`;
      else if (status.status === "qr_ready") wechatyLoginSub.textContent = "等待扫码登录。请用要接入群聊的微信扫描下方二维码；扫码前缓存群不能自由回复。";
      else if (offline) wechatyLoginSub.textContent = `${user ? `上次登录：${user}。` : ''}微信助手已离线，缓存群不能自由回复。请点“强制重新扫码”。${suffix}`;
      else if (status.status === "starting") wechatyLoginSub.textContent = "正在恢复微信登录态；超过 90 秒仍未真实在线会自动标记离线并提醒重新扫码。";
      else if (status.rooms_stale || ["logged_in", "connected", "rooms_pending"].includes(status.status)) wechatyLoginSub.textContent = `${user ? `检测到历史登录：${user}。` : ''}当前不能确认微信群消息通道可用，请点“强制重新扫码”。${suffix}`;
      else wechatyLoginSub.textContent = "未登录。点击“登录/恢复微信”；如果没有出现二维码，请点“强制重新扫码”。";
    }
    if (connected) setWechatyStatus(`已真实连接 · 接入 ${matchedCount} 个群`, true);
    else if (status.status === "qr_ready") setWechatyStatus(wechatyRoomsCache.length ? `等待扫码 · 缓存 ${wechatyRoomsCache.length} 个群不可接收消息` : "等待扫码登录", false);
    else if (offline) setWechatyStatus(`已离线 · 缓存群不可用，请重新扫码`, false);
    else if (status.status === "starting") setWechatyStatus("正在登录/恢复微信", false);
    else if (status.rooms_stale || status.status === "rooms_stale") setWechatyStatus(`未确认在线 · 仅显示上次缓存 ${wechatyRoomsCache.length} 个群`, false);
    else if (status.status === "logged_in" || status.status === "connected") setWechatyStatus("登录态存在但群消息通道不可确认", false);
    else setWechatyStatus(config.enabled === false ? "已关闭" : "未登录", false);
    renderWechatyRooms();
    renderWechatyMemoryGroups();
    renderWechatyDigestGroups();
    renderWechatyHotspotGroups();
    loadWechatyKnownGroups({ silent: true });
  }

  function renderWechatyRooms() {
    if (!wechatyRoomList) return;
    const keyword = String(wechatyRoomFilter?.value || "").trim().toLowerCase();
    const selected = wechatySelectedGroupNames;
    const rooms = mergeWechatyKnownGroups()
      .filter(room => !keyword || String(room.topic || "").toLowerCase().includes(keyword))
      .sort((a, b) => Number(selected.has(b.topic)) - Number(selected.has(a.topic)) || String(a.topic).localeCompare(String(b.topic), 'zh-Hans-CN'));
    if (!rooms.length) {
      wechatyRoomList.innerHTML = `<div class="wechaty-empty">${wechatyRoomsCache.length ? "没有匹配的群" : "暂无真实群列表。请先点击“登录/恢复微信”，扫码或恢复成功后会自动获取。"}</div>`;
    } else {
      wechatyRoomList.innerHTML = rooms.map(room => {
        const topic = escapeHtml(String(room.topic || "未命名群"));
        const id = escapeHtml(String(room.id || ""));
        const checked = selected.has(room.topic) ? " checked" : "";
        const badge = selected.has(room.topic) ? "自由回复" : (room.knownOnly ? "已识别" : (wechatyRoomsAreStale ? "缓存" : "未开启"));
        return `<label class="wechaty-room-item${(wechatyRoomsAreStale || room.knownOnly) ? ' stale' : ''}" title="${id}">
          <input class="wechaty-room-checkbox" type="checkbox" value="${topic}" data-topic="${topic}"${checked}>
          <span class="wechaty-room-main"><span class="wechaty-room-name">${topic}</span><span class="wechaty-room-id">${id}</span></span>
          <span class="wechaty-room-badge">${badge}</span>
        </label>`;
      }).join("");
    }
    updateWechatySelectedCount();
    renderWechatyMemoryGroups();
    renderWechatyDigestGroups();
    renderWechatyHotspotGroups();
  }

  function updateWechatySelectedCount() {
    if (!wechatySelectedCount) return;
    if (!wechatyRoomsCache.length) {
      const configured = wechatyConfiguredGroupNames.size;
      wechatySelectedCount.textContent = configured ? `已配置 ${configured} 个群名，等待真实群列表匹配` : '未获取群列表';
      return;
    }
    const allGroups = mergeWechatyKnownGroups();
    const realSelected = allGroups.filter(room => wechatySelectedGroupNames.has(room.topic)).length;
    wechatySelectedCount.textContent = `${wechatyRoomsAreStale ? '缓存已选' : '已选'} ${realSelected} / ${allGroups.length || wechatyRoomsCache.length} 个群`;
  }


  function mergeWechatyKnownGroups() {
    const map = new Map();
    const canonicalTopic = value => String(value || '').trim().replace(/\s+/gu, ' ').toLowerCase();
    const normalizeId = value => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      if (raw.startsWith('wechaty:')) return raw;
      if (raw.startsWith('@@')) return `wechaty:${raw}`;
      return raw;
    };
    const sourceRank = { room: 3, known: 2, configured: 1 };
    const add = (raw = {}, source = '') => {
      const topic = String(raw.topic || raw.group_name || raw.groupName || raw.name || '').trim();
      const id = normalizeId(raw.id || raw.group_id || raw.groupId || '');
      const displayTopic = topic || id;
      if (!displayTopic) return;
      // 用户看到的是微信群名，不应该因为 Wechaty 历史 room_id 变化重复显示同一个群。
      const key = topic ? `name:${canonicalTopic(topic)}` : `id:${id}`;
      const selected = wechatySelectedGroupNames.has(topic) || raw.selected === true;
      const knownOnly = source === 'known';
      const prev = map.get(key);
      const historicalIds = new Set([...(prev?.historical_ids || []), ...(Array.isArray(raw.historical_ids) ? raw.historical_ids.map(normalizeId) : []), id].filter(Boolean));
      if (!prev) {
        map.set(key, {
          id: id || displayTopic,
          topic: displayTopic,
          selected,
          stale: knownOnly ? true : wechatyRoomsAreStale,
          real: !!id,
          knownOnly,
          sourceRank: sourceRank[source] || 0,
          message_count: Number(raw.message_count || 0),
          member_count: Number(raw.member_count || 0),
          last_seen_display: raw.last_seen_display || '',
          historical_ids: [...historicalIds],
          duplicate_count: Number(raw.duplicate_count || Math.max(0, historicalIds.size - 1)),
        });
        return;
      }
      const incomingRank = sourceRank[source] || 0;
      const preferIncoming = incomingRank > Number(prev.sourceRank || 0)
        || (!!raw.last_seen_display && !prev.last_seen_display);
      map.set(key, {
        ...prev,
        id: preferIncoming && id ? id : prev.id,
        topic: preferIncoming && displayTopic ? displayTopic : prev.topic,
        selected: prev.selected || selected,
        stale: prev.stale && (knownOnly ? true : wechatyRoomsAreStale),
        real: prev.real || !!id,
        knownOnly: prev.knownOnly && knownOnly,
        sourceRank: Math.max(Number(prev.sourceRank || 0), incomingRank),
        message_count: Number(prev.message_count || 0) + Number(raw.message_count || 0),
        member_count: Math.max(Number(prev.member_count || 0), Number(raw.member_count || 0)),
        last_seen_display: raw.last_seen_display || prev.last_seen_display || '',
        historical_ids: [...historicalIds],
        duplicate_count: Math.max(Number(prev.duplicate_count || 0), Number(raw.duplicate_count || 0), Math.max(0, historicalIds.size - 1)),
      });
    };
    for (const room of wechatyRoomsCache || []) add(room, 'room');
    for (const group of wechatyKnownGroupsCache || []) add(group, 'known');
    for (const name of wechatyConfiguredGroupNames) add({ id: name, topic: name, selected: true }, 'configured');
    return [...map.values()].map(({ sourceRank: _sourceRank, ...row }) => row);
  }

  async function loadWechatyKnownGroups({ silent = true } = {}) {
    try {
      const data = await fetch(`${API}/social/wechat-groups/known?limit=500`).then(r => r.json());
      if (data.ok && Array.isArray(data.groups)) {
        wechatyKnownGroupsCache = data.groups;
        renderWechatyMemoryGroups();
        renderWechatyDigestGroups();
        renderWechatyHotspotGroups();
      }
    } catch {
      if (!silent) showFeedback(wechatyDutyFeedback, '读取已识别群失败', true);
    }
  }

  function getWechatyMemoryCandidateGroups() {
    return mergeWechatyKnownGroups();
  }

  function getWechatyDigestCandidateGroups() {
    // 统计/总结只能覆盖程序真实接入的群；沿用上方已勾选的 Wechaty 群作为候选，
    // 但是否参与统计/定时发送由这里的独立勾选决定。
    return getWechatyMemoryCandidateGroups();
  }

  function memoryGroupRequestId(group = {}) {
    const raw = String(group.id || group.topic || "").trim();
    return raw.startsWith("wechaty:") ? raw : `wechaty:${raw}`;
  }

  function renderWechatyRecordsGroupSelect() {
    if (!wechatyRecordsGroup) return;
    const candidates = getWechatyMemoryCandidateGroups();
    const currentId = wechatyActiveMemoryGroupId || (candidates[0] ? memoryGroupRequestId(candidates[0]) : "");
    const options = candidates.map(group => {
      const reqId = memoryGroupRequestId(group);
      const selected = reqId === currentId ? " selected" : "";
      const label = `${group.topic || reqId}${group.knownOnly ? "（已识别）" : (group.stale ? "（缓存）" : "")}`;
      return `<option value="${escapeHtml(reqId)}" data-group-name="${escapeHtml(group.topic || "")}"${selected}>${escapeHtml(label)}</option>`;
    }).join("");
    wechatyRecordsGroup.innerHTML = options || '<option value="">没有可查看的接入群</option>';
    if (currentId) wechatyRecordsGroup.value = currentId;
  }

  function renderWechatyMemoryGroups(overview = null) {
    if (!wechatyMemoryGroups) return;
    const candidates = getWechatyMemoryCandidateGroups();
    if (!wechatyActiveMemoryGroupId && candidates.length) {
      wechatyActiveMemoryGroupId = memoryGroupRequestId(candidates[0]);
      wechatyActiveMemoryGroupName = candidates[0].topic;
    }
    renderWechatyRecordsGroupSelect();
    const overviewMap = new Map((overview?.groups || []).map(row => [String(row.group_id || row.id || ""), row]));
    if (!candidates.length) {
      wechatyMemoryGroups.innerHTML = '<div class="wechaty-empty">还没有识别到微信群。请先登录/恢复微信，或等待程序收到群消息后自动出现。</div>';
      if (wechatyMemoryTitle) wechatyMemoryTitle.textContent = "未选择群";
      if (wechatyMemoryStat) wechatyMemoryStat.textContent = "—";
      renderWechatyMemberMemory(null);
      return;
    }
    wechatyMemoryGroups.innerHTML = candidates.map(group => {
      const reqId = memoryGroupRequestId(group);
      const rawKey = reqId.replace(/^wechaty:/, "");
      const info = overviewMap.get(rawKey) || overviewMap.get(reqId) || null;
      const counts = info?.counts || {};
      const active = reqId === wechatyActiveMemoryGroupId;
      const stat = info ? `${counts.messages || 0} 消息 · ${counts.conclusions || 0} 结论 · ${counts.summaries || 0} 摘要` : (group.selected ? "已开启自由回复" : (group.knownOnly ? "已识别/有记录，未开启自由回复" : "可查看记录"));
      return `<button class="wechaty-memory-group${active ? " active" : ""}${group.stale ? " stale" : ""}" type="button" data-group-id="${escapeHtml(reqId)}" data-group-name="${escapeHtml(group.topic)}">
        <span class="wechaty-memory-group-name">${escapeHtml(group.topic)}</span>
        <span class="wechaty-memory-group-stat">${escapeHtml(stat)}</span>
      </button>`;
    }).join("");
  }

  function renderWechatyMemoryDetail(data = null, groupName = "") {
    if (!wechatyMemoryPreview) return;
    const title = groupName || wechatyActiveMemoryGroupName || data?.group_name || data?.group_id || "未选择群";
    if (wechatyMemoryTitle) wechatyMemoryTitle.textContent = title;
    if (!data) {
      if (wechatyMemoryStat) wechatyMemoryStat.textContent = "点击“刷新记忆”查看本群长期记忆";
      wechatyMemoryPreview.innerHTML = '<div class="wechaty-empty">左侧选择一个群，然后点击“刷新记忆”。</div>';
      return;
    }
    const messages = data.messages || data.items || [];
    const conclusions = data.conclusions || [];
    const summaries = data.summaries || [];
    const counts = data.counts || {};
    if (wechatyMemoryStat) {
      const parts = [
        `${counts.totalMessages ?? counts.messages ?? messages.length} 条原始消息`,
        `${counts.conclusions ?? conclusions.length} 条长期结论`,
        `${counts.summaries ?? summaries.length} 条摘要`,
      ];
      if (Array.isArray(data.errors) && data.errors.length) parts.push(`有 ${data.errors.length} 个读取提示`);
      wechatyMemoryStat.textContent = parts.join(" · ");
    }
    const groupConclusions = conclusions.filter(item => item.scope !== "member");
    const memberConclusions = conclusions.filter(item => item.scope === "member");
    const renderConclusionItem = (item) => `<article class="wechaty-memory-item conclusion ${escapeHtml(item.scope || "group")}">
        <b>${escapeHtml(item.scope === "member" ? "成员记忆" : "群组记忆")}</b>
        <p>${escapeHtml(item.content || "")}</p>
        <span>${escapeHtml(String(item.createdAt || "").slice(0, 16))}</span>
        <button class="wechaty-memory-delete" type="button" data-kind="conclusion" data-item-id="${escapeHtml(item.id)}" data-observer-id="${escapeHtml(item.observerId || "bailongma_assistant")}" data-observed-id="${escapeHtml(item.observedId || "")}">删除这条结论</button>
      </article>`;
    const summaryHtml = summaries.length ? `<section class="wechaty-memory-section">
      <div class="wechaty-memory-section-title">自动摘要</div>
      ${summaries.map(item => `<article class="wechaty-memory-item summary"><b>${escapeHtml(item.type || "summary")}</b><p>${escapeHtml(item.content || "")}</p><span>${escapeHtml(String(item.createdAt || "").slice(0, 16))}</span></article>`).join("")}
    </section>` : "";
    const groupConclusionHtml = `<section class="wechaty-memory-section">
      <div class="wechaty-memory-section-title">群组长期记忆（${groupConclusions.length}）</div>
      <div class="wechaty-memory-section-sub">当前微信群通用的规则、背景、群设定和公共结论，只在这个群内使用。</div>
      ${groupConclusions.length ? groupConclusions.map(renderConclusionItem).join("") : '<div class="wechaty-empty small">暂无群组长期结论。你可以在上方手动添加，或等待后台从群聊中提取。</div>'}
    </section>`;
    const memberConclusionHtml = `<section class="wechaty-memory-section">
      <div class="wechaty-memory-section-title">成员长期记忆（${memberConclusions.length}）</div>
      <div class="wechaty-memory-section-sub">按当前微信群里的成员单独隔离；和群组记忆一起参与匹配，但不会串到其他群。</div>
      ${memberConclusions.length ? memberConclusions.map(renderConclusionItem).join("") : '<div class="wechaty-empty small">暂无成员长期记忆。只有群成员明确说“以后叫我…”“我叫…”这类身份/称呼偏好，或后台形成结论后才会出现在这里。</div>'}
    </section>`;
    const messageHtml = messages.length ? `<section class="wechaty-memory-section">
      <div class="wechaty-memory-section-title">原始消息记录</div>
      ${messages.slice(0, 80).map(item => `<article class="wechaty-memory-item message"><b>[${escapeHtml(item.type || "message")}] ${escapeHtml(item.speaker || "群成员")}</b><p>${escapeHtml(item.content || "")}</p><span>${escapeHtml(String(item.createdAt || "").slice(0, 16))}</span></article>`).join("")}
    </section>` : "";
    const errorHtml = Array.isArray(data.errors) && data.errors.length
      ? `<div class="wechaty-memory-warning">${data.errors.map(err => `<div>${escapeHtml(err)}</div>`).join("")}</div>`
      : "";
    wechatyMemoryPreview.innerHTML = errorHtml + (summaryHtml || groupConclusionHtml || memberConclusionHtml || messageHtml
      ? [summaryHtml, groupConclusionHtml, memberConclusionHtml, messageHtml].filter(Boolean).join("")
      : '<div class="wechaty-empty">当前没有这个群的可展示记忆。只有程序真实收到群消息、@ 回复或你手动添加记忆后才会出现。</div>');
  }

  async function refreshWechatyMemoryOverview() {
    try {
      const data = await fetch(`${API}/social/wechat-groups/memory-overview?limit=20`).then(r => r.json());
      if (data.ok) renderWechatyMemoryGroups(data);
    } catch {}
  }

  async function loadWechatyActiveMemory() {
    const candidates = getWechatyMemoryCandidateGroups();
    if (!wechatyActiveMemoryGroupId && candidates.length) {
      wechatyActiveMemoryGroupId = memoryGroupRequestId(candidates[0]);
      wechatyActiveMemoryGroupName = candidates[0].topic;
    }
    if (!wechatyActiveMemoryGroupId) {
      renderWechatyMemoryDetail(null);
      showFeedback(wechatyDutyFeedback, "请先选择一个群", true);
      return;
    }
    if (wechatyRefreshMemoryBtn) wechatyRefreshMemoryBtn.disabled = true;
    try {
      const url = `${API}/social/wechat-groups/memory?group_id=${encodeURIComponent(wechatyActiveMemoryGroupId)}&group_name=${encodeURIComponent(wechatyActiveMemoryGroupName)}&limit=100&include_all_peers=true`;
      const data = await fetch(url).then(r => r.json());
      renderWechatyMemoryDetail(data, wechatyActiveMemoryGroupName);
      await refreshWechatyMemoryOverview();
      await loadWechatyMemberMemory({ keepMember: true });
      await loadWechatyActiveStats({ silent: true });
    } catch {
      showFeedback(wechatyDutyFeedback, "读取群记忆失败", true);
    } finally {
      if (wechatyRefreshMemoryBtn) wechatyRefreshMemoryBtn.disabled = false;
    }
  }

  function renderWechatyMemberMemory(data = null) {
    if (!wechatyMemberMemoryMembers || !wechatyMemberMemoryPreview) return;
    if (data) wechatyMemberMemoryLastData = data;
    const members = data?.members || wechatyMemberMemoryCache || [];
    wechatyMemberMemoryCache = members;
    const keyword = String(wechatyMemberMemorySearch?.value || "").trim().toLowerCase();
    const visibleMembers = keyword
      ? members.filter(member => [
          member.display_name,
          ...(Array.isArray(member.aliases) ? member.aliases : []),
          ...(Array.isArray(member.sender_ids) ? member.sender_ids : []),
          member.canonical_member_id,
          member.stable_key,
          member.wxid,
          member.wechat_id,
        ].some(value => String(value || "").toLowerCase().includes(keyword)))
      : members;
    const selected = data?.selected || members.find(member => member.canonical_member_id === wechatyActiveMemberCanonicalId) || null;
    if (selected?.canonical_member_id) wechatyActiveMemberCanonicalId = selected.canonical_member_id;
    if (!wechatyActiveMemoryGroupId) {
      wechatyMemberMemoryMembers.innerHTML = '<div class="wechaty-empty">先选择一个微信群。</div>';
      wechatyMemberMemoryPreview.innerHTML = '<div class="wechaty-empty">左侧选择群后，这里会显示群友永久记忆。</div>';
      if (wechatyMemberMemoryTitle) wechatyMemberMemoryTitle.textContent = "未选择群友";
      if (wechatyMemberMemoryStat) wechatyMemberMemoryStat.textContent = "—";
      return;
    }
    if (!members.length) {
      wechatyMemberMemoryMembers.innerHTML = '<div class="wechaty-empty">暂无可识别群友。请先刷新昵称，或等待群内出现新消息。</div>';
      wechatyMemberMemoryPreview.innerHTML = '<div class="wechaty-empty">没有群友身份记录时，暂时无法建立按人的永久记忆。</div>';
      if (wechatyMemberMemoryTitle) wechatyMemberMemoryTitle.textContent = "未选择群友";
      if (wechatyMemberMemoryStat) wechatyMemberMemoryStat.textContent = "0 位群友";
      return;
    }
    wechatyMemberMemoryMembers.innerHTML = visibleMembers.length ? visibleMembers.map(member => {
      const cid = member.canonical_member_id || "";
      const active = cid === wechatyActiveMemberCanonicalId;
      const stat = `${member.memory_count || 0} 记忆 · ${member.message_count || 0} 消息`;
      const alias = (member.aliases || []).filter(name => name && name !== member.display_name).slice(0, 2).join(" / ");
      return `<button class="wechaty-memory-group member-memory-member${active ? " active" : ""}" type="button" data-canonical-member-id="${escapeHtml(cid)}" data-sender-id="${escapeHtml((member.sender_ids || [])[0] || "")}" data-sender-name="${escapeHtml(member.display_name || "")}">
        <span class="wechaty-memory-group-name">${escapeHtml(member.display_name || cid || "未知群友")}</span>
        <span class="wechaty-memory-group-stat">${escapeHtml(stat)}${alias ? ` · ${escapeHtml(alias)}` : ""}</span>
      </button>`;
    }).join("") : `<div class="wechaty-empty">没有匹配“${escapeHtml(keyword)}”的群友。当前群已加载 ${members.length} 位。</div>`;
    const memories = data?.memories || [];
    const selectedName = selected?.display_name || "未选择群友";
    if (wechatyMemberMemoryTitle) wechatyMemberMemoryTitle.textContent = selectedName;
    if (wechatyMemberMemoryStat) {
      const senderIds = selected?.sender_ids?.length ? ` · ${selected.sender_ids.length} 个历史 ID` : "";
      wechatyMemberMemoryStat.textContent = `${memories.length} 条永久记忆 · 已加载 ${members.length} 位群友${senderIds}`;
    }
    if (!selected) {
      wechatyMemberMemoryPreview.innerHTML = '<div class="wechaty-empty">请选择左侧群友。</div>';
      return;
    }
    wechatyMemberMemoryPreview.innerHTML = memories.length ? memories.map(item => `
      <article class="wechaty-memory-item conclusion member-permanent-memory" data-item-id="${escapeHtml(item.id)}">
        <div class="member-memory-card-head">
          <input class="settings-input member-memory-category" value="${escapeHtml(item.category || "manual_member")}">
          <span>${escapeHtml(String(item.updated_at || item.created_at || "").slice(0, 16))}</span>
        </div>
        <textarea class="settings-input member-memory-content" rows="2">${escapeHtml(item.content || "")}</textarea>
        <div class="wechaty-memory-actions member-memory-card-actions">
          <button class="settings-save-btn member-memory-save" type="button" data-item-id="${escapeHtml(item.id)}">保存</button>
          <button class="settings-save-btn danger member-memory-delete" type="button" data-item-id="${escapeHtml(item.id)}">删除</button>
        </div>
      </article>
    `).join("") : '<div class="wechaty-empty small">这个群友还没有永久记忆。可以在上方手动添加。</div>';
  }

  async function loadWechatyMemberMemory({ keepMember = true } = {}) {
    if (!wechatyMemberMemoryMembers || !wechatyMemberMemoryPreview) return;
    if (!wechatyActiveMemoryGroupId) {
      renderWechatyMemberMemory(null);
      return;
    }
    if (!keepMember) wechatyActiveMemberCanonicalId = "";
    if (wechatyRefreshMemberMemoryBtn) wechatyRefreshMemberMemoryBtn.disabled = true;
    try {
      const params = new URLSearchParams({
        group_id: wechatyActiveMemoryGroupId,
        group_name: wechatyActiveMemoryGroupName || "",
        limit: "20000",
      });
      if (!wechatyActiveMemberCanonicalId || keepMember === false) params.set("refresh_members", "1");
      if (wechatyActiveMemberCanonicalId) params.set("canonical_member_id", wechatyActiveMemberCanonicalId);
      const data = await fetch(`${API}/social/wechat-groups/member-memory?${params.toString()}`).then(r => r.json());
      if (data.ok) renderWechatyMemberMemory(data);
      else showFeedback(wechatyDutyFeedback, data.error || "读取群友记忆失败", true);
    } catch {
      showFeedback(wechatyDutyFeedback, "读取群友记忆请求失败", true);
    } finally {
      if (wechatyRefreshMemberMemoryBtn) wechatyRefreshMemberMemoryBtn.disabled = false;
    }
  }

  function setMemberMemoryExpanded(expanded) {
    memberMemoryExpanded = !!expanded;
    wechatyMemberMemoryManager?.classList.toggle("expanded", memberMemoryExpanded);
    document.body.classList.toggle("member-memory-space-open", memberMemoryExpanded);
    if (wechatyOpenMemberMemorySpaceBtn) {
      wechatyOpenMemberMemorySpaceBtn.textContent = memberMemoryExpanded ? "退出独立空间" : "打开独立空间";
    }
  }

  function collectWechatySelectedRooms() {
    // 不能只收集当前 DOM 里 checked 的项：用户搜索过滤群列表时，未显示但已勾选的群也必须保留。
    document.querySelectorAll(".wechaty-room-checkbox").forEach(cb => {
      const topic = cb.dataset.topic || cb.value;
      if (!topic) return;
      if (cb.checked) wechatySelectedGroupNames.add(topic);
      else wechatySelectedGroupNames.delete(topic);
    });
    return [...wechatySelectedGroupNames];
  }

  async function refreshWechatyRooms({ autoStart = false, silent = false } = {}) {
    if (wechatyRefreshRoomsBtn) wechatyRefreshRoomsBtn.disabled = true;
    try {
      let res = await fetch(`${API}/social/wechaty-duty-group/rooms`);
      if (!res.ok && autoStart) {
        await fetch(`${API}/social/wechaty-duty-group/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        await new Promise(resolve => setTimeout(resolve, 1500));
        res = await fetch(`${API}/social/wechaty-duty-group/rooms`);
      }
      const data = await res.json();
      if (data.ok && data.fresh !== false && !data.rooms_stale) {
        wechatyRoomsCache = data.rooms || [];
        wechatyRoomsAreStale = false;
        wechatyConfiguredGroupNames = new Set((data.group_names || []).map(v => String(v || '').trim()).filter(Boolean));
        if (!wechatyGroupSelectionDirty) {
          wechatySelectedGroupNames = new Set([
            ...wechatyConfiguredGroupNames,
            ...wechatyRoomsCache.filter(r => r.selected || wechatyConfiguredGroupNames.has(r.topic)).map(r => r.topic),
          ].map(v => String(v || '').trim()).filter(Boolean));
        }
        if (wechatyDutyEnabled) wechatyDutyEnabled.checked = data.enabled !== false;
        renderWechatyQr("");
        if (wechatyLoginSub) wechatyLoginSub.textContent = data.online ? `已真实在线：${data.login_user || data.last_login_user || "微信"}。群列表已真实刷新。` : (data.hint || '群列表已刷新，但连接仍在确认中。');
        setWechatyStatus(`${data.online ? "已真实连接" : "正在连接"} · 真实群列表 ${wechatyRoomsCache.length} 个，已接入 ${wechatySelectedGroupNames.size} 个`, data.online === true);
        renderWechatyRooms();
        loadWechatyKnownGroups({ silent: true });
        refreshWechatyMemoryOverview();
      } else {
        if (Array.isArray(data.rooms) && data.rooms.length) {
          wechatyRoomsCache = data.rooms;
          wechatyRoomsAreStale = true;
          if (!wechatyGroupSelectionDirty) {
            wechatySelectedGroupNames = new Set([
              ...wechatyConfiguredGroupNames,
              ...wechatyRoomsCache.filter(r => r.selected || wechatyConfiguredGroupNames.has(r.topic)).map(r => r.topic),
            ].map(v => String(v || '').trim()).filter(Boolean));
          }
        }
        if (wechatyLoginSub) wechatyLoginSub.textContent = data.hint || data.error || '没有获取到真实群列表；下方如有群只是上次缓存。';
        if (data.status === "qr_ready") setWechatyStatus("等待扫码登录", false);
        else setWechatyStatus(wechatyRoomsCache.length ? `未确认在线 · 仅显示上次缓存 ${wechatyRoomsCache.length} 个群` : "未登录/未获取真实群列表", false);
        if (!silent) showFeedback(wechatyDutyFeedback, data.error || data.hint || "群列表未真实刷新，请强制重新扫码", true);
        renderWechatyRooms();
        loadWechatyKnownGroups({ silent: true });
        refreshWechatyMemoryOverview();
      }
    } catch {
      if (!silent) showFeedback(wechatyDutyFeedback, "群列表获取失败", true);
    } finally {
      if (wechatyRefreshRoomsBtn) wechatyRefreshRoomsBtn.disabled = false;
    }
  }

  wechatyPersonaPresets?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".wechaty-persona-preset");
    if (!btn) return;
    applyWechatyPersonaPreset(btn.dataset.presetId || "");
  });

  wechatyPersonaResetBtn?.addEventListener("click", () => {
    const first = wechatyPersonaPresetCache[0];
    if (first) applyWechatyPersonaPreset(first.id);
    else if (wechatyPersonaPrompt) {
      wechatyPersonaPrompt.value = "";
      updateWechatyPersonaActiveLabel("");
      showFeedback(wechatyDutyFeedback, "已清空，将在保存时恢复后端默认性格");
    }
  });

  wechatyPersonaPrompt?.addEventListener("input", () => updateWechatyPersonaActiveLabel(wechatyPersonaPrompt.value));

  wechatyRoomList?.addEventListener("change", (event) => {
    const cb = event.target?.closest?.(".wechaty-room-checkbox");
    if (!cb) return;
    const topic = cb.dataset.topic || cb.value;
    if (cb.checked) wechatySelectedGroupNames.add(topic);
    else wechatySelectedGroupNames.delete(topic);
    wechatyGroupSelectionDirty = true;
    updateWechatySelectedCount();
    renderWechatyMemoryGroups();
    renderWechatyDigestGroups();
    renderWechatyHotspotGroups();
  });
  wechatyAdminIds?.addEventListener("input", () => {
    // 这个框只展示昵称，权限仍由点击成员卡片得到的 sender_id 集合决定。
    syncWechatyAdminNicknameBox();
    renderWechatyAdminMembers();
  });
  wechatyAdminSearch?.addEventListener("input", () => renderWechatyAdminMembers());
  wechatyAdminMembers?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".wechaty-admin-member");
    if (!btn) return;
    const id = btn.dataset.senderId || "";
    if (!id) return;
    if (wechatyAdminIdSet.has(id)) wechatyAdminIdSet.delete(id);
    else wechatyAdminIdSet.add(id);
    syncWechatyAdminNicknameBox();
    renderWechatyAdminMembers();
  });

  wechatySaveAdminsBtn?.addEventListener("click", saveWechatyAdminSettings);
  wechatyRefreshAdminMembersBtn?.addEventListener("click", refreshWechatyAdminMembers);
  wechatyBlockedIds?.addEventListener("input", () => {
    // 这个框只展示昵称，屏蔽仍由点击成员卡片得到的 sender_id 集合决定。
    syncWechatyBlockedNicknameBox();
    renderWechatyBlockedMembers();
  });
  wechatyBlockedSearch?.addEventListener("input", () => renderWechatyBlockedMembers());
  wechatyBlockedMembers?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".wechaty-admin-member");
    if (!btn) return;
    const id = btn.dataset.senderId || "";
    if (!id) return;
    if (wechatyBlockedIdSet.has(id)) wechatyBlockedIdSet.delete(id);
    else wechatyBlockedIdSet.add(id);
    syncWechatyBlockedNicknameBox();
    renderWechatyBlockedMembers();
  });
  wechatySaveBlockedBtn?.addEventListener("click", saveWechatyBlockedSettings);
  wechatyDigestGroupList?.addEventListener("change", (event) => {
    const cb = event.target?.closest?.(".wechaty-digest-group-checkbox");
    if (!cb) return;
    const gid = cb.dataset.groupId || cb.value;
    const groupName = cb.dataset.groupName || "";
    const requestId = cb.dataset.requestId || (cb.value?.startsWith?.("wechaty:") ? cb.value : `wechaty:${cb.value || groupName}`);
    if (!gid) return;
    if (cb.checked) wechatyDigestSelectedGroups.add(gid);
    else {
      wechatyDigestSelectedGroups.delete(gid);
      if (groupName) {
        wechatyDigestSelectedGroups.delete(groupName);
        wechatyDigestSelectedGroups.delete(`wechaty:${groupName}`);
      }
      wechatyDigestSelectedGroups.delete(requestId);
    }
    updateWechatyDigestGroupCount();
    refreshWechatyReportPreview();
  });
  wechatyHotspotGroupList?.addEventListener("change", (event) => {
    const cb = event.target?.closest?.(".wechaty-hotspot-group-checkbox");
    if (!cb) return;
    const gid = cb.dataset.groupId || cb.value;
    const groupName = cb.dataset.groupName || "";
    const requestId = cb.dataset.requestId || (cb.value?.startsWith?.("wechaty:") ? cb.value : `wechaty:${cb.value || groupName}`);
    if (!gid) return;
    if (cb.checked) wechatyHotspotSelectedGroups.add(gid);
    else {
      wechatyHotspotSelectedGroups.delete(gid);
      if (groupName) {
        wechatyHotspotSelectedGroups.delete(groupName);
        wechatyHotspotSelectedGroups.delete(`wechaty:${groupName}`);
      }
      wechatyHotspotSelectedGroups.delete(requestId);
    }
    updateWechatyHotspotGroupCount();
  });
  wechatySaveHotspotBtn?.addEventListener("click", () => saveWechatyHotspotSettings({ silent: false }));
  wechatyHotspotCheckBtn?.addEventListener("click", () => runWechatyHotspotCheck({ notify: false }));
  wechatyHotspotNotifyBtn?.addEventListener("click", () => runWechatyHotspotCheck({ notify: true }));
  wechatyReportPreview?.addEventListener("click", (event) => {
    const card = event.target?.closest?.(".wechaty-report-preview-card");
    if (!card) return;
    const groupId = card.dataset.groupId || "";
    const groupName = card.dataset.groupName || "";
    if (!groupId) return;
    wechatyActiveMemoryGroupId = groupId;
    wechatyActiveMemoryGroupName = groupName;
    if (wechatyRecordsGroup) {
      wechatyRecordsGroup.value = groupId;
    }
    renderWechatyMemoryGroups();
    loadWechatyActiveStats({ silent: true });
    loadWechatyRecords({ append: false });
  });
  wechatyStatsViewMode?.addEventListener("change", () => loadWechatyActiveStats({ silent: true, refreshRecords: false }));
  wechatyReportTemplate?.addEventListener("change", refreshWechatyReportPreview);
  window.addEventListener("resize", fitWechatyReportPreviewFrames);
  wechatyRoomFilter?.addEventListener("input", renderWechatyRooms);
  wechatyTestMemeBtn?.addEventListener("click", testWechatyMemeSearch);
  wechatySaveMemeBtn?.addEventListener("click", saveWechatyMemeConfig);
  skillImageSaveBtn?.addEventListener("click", saveSkillImageConfig);
  skillImageAddChannelBtn?.addEventListener("click", () => addSkillChannel("image"));
  skillImageChannelList?.addEventListener("input", () => syncSkillChannelInputs("image"));
  skillImageChannelList?.addEventListener("change", event => {
    syncSkillChannelInputs("image");
    if (event.target?.dataset?.action === "active") renderSkillChannels("image");
  });
  skillImageChannelList?.addEventListener("click", event => handleSkillChannelListClick("image", event));
  skillVisionSaveBtn?.addEventListener("click", saveSkillVisionConfig);
  skillVisionAddChannelBtn?.addEventListener("click", () => addSkillChannel("vision"));
  skillVisionChannelList?.addEventListener("input", () => syncSkillChannelInputs("vision"));
  skillVisionChannelList?.addEventListener("change", event => {
    syncSkillChannelInputs("vision");
    if (event.target?.dataset?.action === "active") renderSkillChannels("vision");
  });
  skillVisionChannelList?.addEventListener("click", event => handleSkillChannelListClick("vision", event));
  skillVisionRefreshBtn?.addEventListener("click", refreshSkillVisionStatus);
  skillVideoSaveBtn?.addEventListener("click", saveSkillVideoConfig);
  skillVideoAddChannelBtn?.addEventListener("click", () => addSkillChannel("video"));
  skillVideoChannelList?.addEventListener("input", () => syncSkillChannelInputs("video"));
  skillVideoChannelList?.addEventListener("change", event => {
    syncSkillChannelInputs("video");
    if (event.target?.dataset?.action === "active") renderSkillChannels("video");
  });
  skillVideoChannelList?.addEventListener("click", event => handleSkillChannelListClick("video", event));
  skillVideoRefreshBtn?.addEventListener("click", refreshSkillVideoStatus);
  dbRefreshBtn?.addEventListener("click", loadDatabaseSettings);
  dbVectorBackfillBtn?.addEventListener("click", () => runDatabaseAction(dbVectorBackfillBtn, "/settings/database/backfill-vectors", "向量补齐完成"));
  dbMemoryExtractBtn?.addEventListener("click", () => runDatabaseAction(dbMemoryExtractBtn, "/settings/database/extract-wechat-memories", "成员记忆提取完成"));
  dbHonchoSyncBtn?.addEventListener("click", () => runDatabaseAction(dbHonchoSyncBtn, "/settings/database/sync-honcho", "Honcho 同步完成"));
  dbExportAllBtn?.addEventListener("click", exportDatabaseBackup);
  dbImportFile?.addEventListener("change", () => { importDatabaseBackup(dbImportFile.files?.[0]); dbImportFile.value = ""; });
  dbSearchBtn?.addEventListener("click", searchDatabaseMemory);
  dbSearchInput?.addEventListener("keydown", e => { if (e.key === "Enter") searchDatabaseMemory(); });
  dbArchiveSearch?.addEventListener("input", renderDbArchiveGroups);
  [dbArchiveEnabled, dbArchiveRecordText, dbArchiveRecordMedia, dbArchiveParseImages, dbArchiveDefaultFree, dbArchiveChunkSize, dbArchiveChunkOverlap].forEach(el => {
    el?.addEventListener("change", () => {
      updateDbArchiveSummary();
      if (el === dbArchiveDefaultFree) renderDbArchiveGroups();
    });
  });
  dbArchiveGroupList?.addEventListener("change", event => {
    const input = event.target?.closest?.('input[data-archive-kind]');
    if (!input) return;
    const name = String(input.value || "").trim();
    if (!name) return;
    const targetSet = input.dataset.archiveKind === "image" ? dbArchiveImageNames : dbArchiveRecordNames;
    if (input.checked) targetSet.add(name);
    else targetSet.delete(name);
    renderDbArchiveGroups();
  });
  dbArchiveSyncFreeBtn?.addEventListener("click", () => saveDbArchiveConfig({ syncFree: true }));
  dbArchiveSaveRecordBtn?.addEventListener("click", () => saveDbArchiveConfig());
  dbArchiveSaveImageBtn?.addEventListener("click", () => saveDbArchiveConfig());
  dbIndexRefreshBtn?.addEventListener("click", () => loadDbMemoryIndexStatus());
  dbIndexBackfillBtn?.addEventListener("click", backfillDbMemoryIndex);
  knowledgeImportToggle?.addEventListener("click", () => { if (knowledgeDrawer) knowledgeDrawer.hidden = !knowledgeDrawer.hidden; });
  knowledgeDrawerClose?.addEventListener("click", () => { if (knowledgeDrawer) knowledgeDrawer.hidden = true; });
  knowledgeRefreshBtn?.addEventListener("click", loadKnowledgeConsole);
  knowledgeParseBtn?.addEventListener("click", parseKnowledgeImportUI);
  knowledgeCommitBtn?.addEventListener("click", commitKnowledgeImportUI);
  knowledgeSearchInput?.addEventListener("keydown", e => { if (e.key === "Enter") loadKnowledgeSources(); });
  knowledgeScope?.addEventListener("change", () => {
    if (knowledgeGroupSelect) knowledgeGroupSelect.disabled = knowledgeScope.value !== "groups";
  });
  knowledgeFilterPills?.addEventListener("click", event => {
    const btn = event.target?.closest?.("button[data-type]");
    if (!btn) return;
    knowledgeFilterPills.querySelectorAll("button").forEach(item => item.classList.remove("active"));
    btn.classList.add("active");
    knowledgeActiveType = btn.dataset.type || "";
    loadKnowledgeSources();
  });
  knowledgeTestBtn?.addEventListener("click", testKnowledgeSearch);
  knowledgeTestQuery?.addEventListener("keydown", e => { if (e.key === "Enter") testKnowledgeSearch(); });
  dbImageRefreshBtn?.addEventListener("click", () => loadDbImageLibrary({ append: false, autoProcess: true }));
  dbImageProcessBtn?.addEventListener("click", () => triggerDbImageBackgroundParse({ silent: false }));
  dbImageSearchBtn?.addEventListener("click", () => loadDbImageLibrary({ append: false, autoProcess: true }));
  dbImageResetBtn?.addEventListener("click", () => {
    if (dbImageGroup) dbImageGroup.value = "all";
    if (dbImageStatus) dbImageStatus.value = "";
    if (dbImageQuery) dbImageQuery.value = "";
    if (dbImageSender) dbImageSender.value = "";
    if (dbImageFrom) dbImageFrom.value = "";
    if (dbImageTo) dbImageTo.value = "";
    loadDbImageLibrary({ append: false, autoProcess: true });
  });
  dbImageMoreBtn?.addEventListener("click", () => loadDbImageLibrary({ append: true }));
  dbImageList?.addEventListener("click", event => {
    const btn = event.target?.closest?.("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id || "";
    const action = btn.dataset.action || "";
    if (action === "edit-image") toggleDbImageEditor(id, true);
    if (action === "cancel-edit-image") toggleDbImageEditor(id, false);
    if (action === "save-image") saveDbImageEdit(id);
    if (action === "delete-image") deleteDbImage(id);
  });
  [dbImageGroup, dbImageStatus].forEach(el => el?.addEventListener("change", () => loadDbImageLibrary({ append: false, autoProcess: true })));
  [dbImageQuery, dbImageSender, dbImageFrom, dbImageTo].forEach(el => {
    el?.addEventListener("keydown", e => { if (e.key === "Enter") loadDbImageLibrary({ append: false, autoProcess: true }); });
    el?.addEventListener("change", () => loadDbImageLibrary({ append: false, autoProcess: true }));
  });
  wechatyStartBtn?.addEventListener("click", async () => {
    wechatyStartBtn.disabled = true;
    setWechatyStatus("正在连接/恢复微信…", false);
    try {
      await fetch(`${API}/social/wechaty-duty-group/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      showFeedback(wechatyDutyFeedback, "已发起登录/恢复；如果仍显示缓存状态，请点强制重新扫码");
      setTimeout(() => pollWechatyStatus({ refreshRooms: true }), 1200);
    } catch {
      showFeedback(wechatyDutyFeedback, "连接失败", true);
    } finally {
      wechatyStartBtn.disabled = false;
    }
  });
  wechatyReloginBtn?.addEventListener("click", async () => {
    if (!confirm("确定要清空当前微信登录态并重新生成二维码吗？这会让微信群助手重新扫码登录。")) return;
    wechatyReloginBtn.disabled = true;
    if (wechatyStartBtn) wechatyStartBtn.disabled = true;
    renderWechatyQr("");
    setWechatyStatus("正在清空登录态并生成二维码…", false);
    if (wechatyLoginSub) wechatyLoginSub.textContent = "正在清空登录态并生成新的登录二维码，请稍候…";
    try {
      const groupNames = collectWechatySelectedRooms();
      const res = await fetch(`${API}/social/wechaty-duty-group/relogin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !!wechatyDutyEnabled?.checked, group_names: groupNames.length ? groupNames : [...wechatyConfiguredGroupNames] }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(wechatyDutyFeedback, "已清空登录态，请扫描新二维码");
        applyWechatyDutyConfig({ enabled: data.enabled, groupNames: data.group_names }, data);
        [700, 1500, 2800, 4500].forEach(delay => {
          setTimeout(() => pollWechatyStatus({ refreshRooms: false }), delay);
        });
      } else showFeedback(wechatyDutyFeedback, data.error || "重新扫码失败", true);
    } catch {
      showFeedback(wechatyDutyFeedback, "重新扫码请求失败", true);
    } finally {
      wechatyReloginBtn.disabled = false;
      if (wechatyStartBtn) wechatyStartBtn.disabled = false;
    }
  });
  wechatyRefreshRoomsBtn?.addEventListener("click", () => refreshWechatyRooms({ autoStart: true }));

  async function pollWechatyStatus({ refreshRooms = false } = {}) {
    try {
      const data = await fetch(`${API}/social/wechaty-duty-group/status`).then(r => r.json());
      if (data.ok) applyWechatyDutyConfig({ enabled: data.enabled, groupNames: data.group_names }, data);
      if (refreshRooms && data.online === true && data.status === "connected") {
        await refreshWechatyRooms({ autoStart: false, silent: true });
      }
    } catch {}
  }

  function startWechatyStatusPolling() {
    if (wechatyStatusPollTimer) return;
    wechatyStatusPollTimer = setInterval(() => pollWechatyStatus({ refreshRooms: true }), 5000);
  }

  startWechatyStatusPolling();

  function isWechatGroupsTabVisible() {
    if (!overlay || overlay.hidden) return false;
    return !!overlay.querySelector('.settings-tab[data-tab="wechat-groups"].active');
  }

  function isDatabaseTabVisible() {
    if (!overlay || overlay.hidden) return false;
    return !!overlay.querySelector('.settings-tab[data-tab="database"].active');
  }

  function startWechatyStatsAutoRefresh() {
    if (wechatyStatsAutoRefreshTimer) return;
    wechatyStatsAutoRefreshTimer = setInterval(() => {
      if (!isWechatGroupsTabVisible()) return;
      loadWechatyActiveStats({ silent: true, refreshRecords: false }).catch?.(() => {});
      if (wechatyActiveMemoryGroupId && !wechatyRecordsRefreshBtn?.disabled) {
        loadWechatyRecords({ append: false }).catch?.(() => {});
      }
    }, 12000);
  }

  function stopWechatyStatsAutoRefresh() {
    if (wechatyStatsAutoRefreshTimer) clearInterval(wechatyStatsAutoRefreshTimer);
    wechatyStatsAutoRefreshTimer = null;
  }

  function startDatabaseImageAutoRefresh() {
    if (dbImageAutoRefreshTimer) return;
    dbImageAutoRefreshTimer = setInterval(() => {
      if (!isDatabaseTabVisible()) return;
      loadDbImageLibrary({ silent: true, autoProcess: true }).catch?.(() => {});
    }, 10000);
  }

  function stopDatabaseImageAutoRefresh() {
    if (dbImageAutoRefreshTimer) clearInterval(dbImageAutoRefreshTimer);
    dbImageAutoRefreshTimer = null;
  }

  honchoSaveBtn?.addEventListener("click", async () => {
    honchoSaveBtn.disabled = true;
    try {
      const body = {
        enabled: true,
        environment: honchoEnvironment?.value || 'local',
        baseURL: honchoBaseUrl?.value?.trim() || 'http://127.0.0.1:8018',
        apiKey: honchoApiKey?.value?.trim() || '',
        appId: honchoAppId?.value?.trim() || 'bailongma-wechat-memory',
        appName: honchoAppName?.value?.trim() || 'BaiLongma WeChat Memory',
      };
      const res = await fetch(`${API}/settings/wechat-groups/honcho`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        if (honchoApiKey) honchoApiKey.value = '';
        applyHonchoConfig(data.honcho, data.honchoStatus);
        showFeedback(honchoFeedback, '群知识库已启用并保存');
        await refreshWechatyMemoryOverview();
      } else showFeedback(honchoFeedback, data.error || '保存失败', true);
    } catch {
      showFeedback(honchoFeedback, '请求失败', true);
    } finally {
      honchoSaveBtn.disabled = false;
    }
  });

  wechatyMemoryGroups?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".wechaty-memory-group");
    if (!btn) return;
    wechatyActiveMemoryGroupId = btn.dataset.groupId || "";
    wechatyActiveMemoryGroupName = btn.dataset.groupName || "";
    wechatyActiveMemberCanonicalId = "";
    renderWechatyMemoryGroups();
    loadWechatyActiveMemory();
    loadWechatyActiveStats({ silent: true });
    loadWechatyRecords({ append: false });
  });

  wechatyRefreshMemoryBtn?.addEventListener("click", loadWechatyActiveMemory);
  wechatyRefreshMemberMemoryBtn?.addEventListener("click", () => loadWechatyMemberMemory({ keepMember: false }));
  wechatyRefreshStatsBtn?.addEventListener("click", () => loadWechatyActiveStats({ silent: false }));
  wechatyRecordsGroup?.addEventListener("change", () => {
    const opt = wechatyRecordsGroup.selectedOptions?.[0];
    wechatyActiveMemoryGroupId = wechatyRecordsGroup.value || "";
    wechatyActiveMemoryGroupName = opt?.dataset?.groupName || opt?.textContent?.replace(/（缓存）$/u, '') || "";
    wechatyActiveMemberCanonicalId = "";
    renderWechatyMemoryGroups();
    loadWechatyActiveMemory();
    loadWechatyActiveStats({ silent: true });
    loadWechatyRecords({ append: false });
  });
  wechatyRecordsFrom?.addEventListener("input", () => {
    if (!wechatyRecordsTo?.value) wechatyRecordsToAutoNow = true;
  });
  wechatyRecordsTo?.addEventListener("input", () => {
    wechatyRecordsToAutoNow = !wechatyRecordsTo.value;
  });
  wechatyRecordsRefreshBtn?.addEventListener("click", () => loadWechatyRecords({ append: false }));
  wechatyRecordsTodayBtn?.addEventListener("click", () => { setWechatyRecordTodayRange(); loadWechatyRecords({ append: false }); });
  wechatyRecordsRefreshNamesBtn?.addEventListener("click", refreshWechatyMemberNames);
  wechatyRecordsMoreBtn?.addEventListener("click", () => loadWechatyRecords({ append: true }));
  wechatyRecordsExportJsonBtn?.addEventListener("click", () => exportWechatyRecords('json'));
  wechatyRecordsExportCsvBtn?.addEventListener("click", () => exportWechatyRecords('csv'));
  wechatyRecordsImportFile?.addEventListener("change", () => importWechatyRecords(wechatyRecordsImportFile.files?.[0]));

  wechatySaveDigestBtn?.addEventListener("click", async () => {
    wechatySaveDigestBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/wechat-groups/digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectWechatyDigestConfig()),
      });
      const data = await res.json();
      if (data.ok) {
        applyWechatyDigestConfig(data.digest);
        const selectedCount = (data.digest?.selectedGroups || []).length;
        showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, selectedCount ? `群统计/定时总结设置已保存，已选择 ${selectedCount} 个群` : "已保存：未选择群组，所以不会统计/不会定时发送");
        await loadWechatyActiveStats({ silent: true, refreshRecords: false });
      } else showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, data.error || "保存失败", true);
    } catch {
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, "保存总结设置失败", true);
    } finally {
      wechatySaveDigestBtn.disabled = false;
    }
  });

  wechatySendDigestBtn?.addEventListener("click", async () => {
    syncWechatyDigestSelectedGroupsFromDom();
    const selectedDigestGroups = getWechatySelectedDigestGroups();
    const activeGroup = getWechatyMemoryCandidateGroups().find(group => memoryGroupRequestId(group) === wechatyActiveMemoryGroupId || group.topic === wechatyActiveMemoryGroupName);
    const targetGroups = selectedDigestGroups.length ? selectedDigestGroups : (activeGroup ? [activeGroup] : []);
    if (!targetGroups.length) {
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, "请先在统计/定时总结里勾选群，或手动选择一个群", true);
      return;
    }
    const names = targetGroups.map(group => group.topic || memoryGroupRequestId(group));
    if (!confirm(`确定现在分别向 ${targetGroups.length} 个群发送各自的 HTML/CSS 群聊战报图片吗？\n${names.join("、")}`)) return;
    wechatySendDigestBtn.disabled = true;
    try {
      const results = [];
      for (const group of targetGroups) {
        const targetGroupId = memoryGroupRequestId(group);
        const targetGroupName = group.topic || "";
        const room = (wechatyRoomsCache || []).find(item => item.topic === targetGroupName);
        const res = await fetch(`${API}/social/wechat-groups/digest/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group_id: targetGroupId,
            group_name: targetGroupName,
            room_id: room?.id || "",
            mode: "interval",
          }),
        });
        const data = await res.json();
        results.push({ groupName: targetGroupName || targetGroupId, data });
      }
      const ok = results.filter(item => item.data?.ok);
      const imageOk = ok.filter(item => item.data?.sent_as === "image");
      const failed = results.filter(item => !item.data?.ok);
      const fallback = ok.filter(item => item.data?.sent_as !== "image");
      const details = [
        imageOk.length ? `图片战报 ${imageOk.length} 个` : '',
        fallback.length ? `文字回退 ${fallback.length} 个` : '',
        failed.length ? `失败 ${failed.length} 个：${failed.map(item => item.groupName).join('、')}` : '',
      ].filter(Boolean).join('；');
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, details || "发送完成", failed.length > 0 || fallback.length > 0);
    } catch {
      showFeedback(wechatyDigestFeedback || wechatyDutyFeedback, "发送总结请求失败", true);
    } finally {
      wechatySendDigestBtn.disabled = false;
    }
  });

  wechatyAddMemoryBtn?.addEventListener("click", async () => {
    const content = String(wechatyManualMemoryInput?.value || "").trim();
    if (!wechatyActiveMemoryGroupId) {
      showFeedback(wechatyDutyFeedback, "请先选择一个群", true);
      return;
    }
    if (!content) {
      showFeedback(wechatyDutyFeedback, "请输入要添加的群记忆", true);
      return;
    }
    wechatyAddMemoryBtn.disabled = true;
    try {
      const res = await fetch(`${API}/social/wechat-groups/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: wechatyActiveMemoryGroupId, group_name: wechatyActiveMemoryGroupName, content, category: "manual" }),
      });
      const data = await res.json();
      if (data.ok) {
        if (wechatyManualMemoryInput) wechatyManualMemoryInput.value = "";
        showFeedback(wechatyDutyFeedback, "已写入本群长期记忆");
        await loadWechatyActiveMemory();
      } else showFeedback(wechatyDutyFeedback, data.error || "添加记忆失败", true);
    } catch {
      showFeedback(wechatyDutyFeedback, "添加记忆请求失败", true);
    } finally {
      wechatyAddMemoryBtn.disabled = false;
    }
  });

  wechatyMemoryPreview?.addEventListener("click", async (event) => {
    const btn = event.target?.closest?.(".wechaty-memory-delete");
    if (!btn || !wechatyActiveMemoryGroupId) return;
    if (!confirm("确定删除这条长期结论吗？原始消息记录不会被删除。")) return;
    btn.disabled = true;
    try {
      const res = await fetch(`${API}/social/wechat-groups/memory`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: wechatyActiveMemoryGroupId,
          kind: btn.dataset.kind || "conclusion",
          item_id: btn.dataset.itemId || "",
          observer_id: btn.dataset.observerId || "bailongma_assistant",
          observed_id: btn.dataset.observedId || "",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(wechatyDutyFeedback, "已删除结论记忆");
        await loadWechatyActiveMemory();
      } else showFeedback(wechatyDutyFeedback, data.error || "删除失败", true);
    } catch {
      showFeedback(wechatyDutyFeedback, "删除请求失败", true);
    } finally {
      btn.disabled = false;
    }
  });

  wechatyOpenMemberMemorySpaceBtn?.addEventListener("click", () => setMemberMemoryExpanded(!memberMemoryExpanded));
  wechatyMemberMemorySearch?.addEventListener("input", () => renderWechatyMemberMemory({
    ...(wechatyMemberMemoryLastData || {}),
    members: wechatyMemberMemoryCache,
    selected: wechatyMemberMemoryCache.find(member => member.canonical_member_id === wechatyActiveMemberCanonicalId) || null,
  }));

  wechatyMemberMemoryMembers?.addEventListener("click", event => {
    const btn = event.target?.closest?.(".member-memory-member");
    if (!btn) return;
    wechatyActiveMemberCanonicalId = btn.dataset.canonicalMemberId || "";
    loadWechatyMemberMemory({ keepMember: true });
  });

  wechatyAddMemberMemoryBtn?.addEventListener("click", async () => {
    const content = String(wechatyMemberMemoryInput?.value || "").trim();
    const member = wechatyMemberMemoryCache.find(item => item.canonical_member_id === wechatyActiveMemberCanonicalId);
    if (!wechatyActiveMemoryGroupId) return showFeedback(wechatyDutyFeedback, "请先选择一个群", true);
    if (!member) return showFeedback(wechatyDutyFeedback, "请先选择一个群友", true);
    if (!content) return showFeedback(wechatyDutyFeedback, "请输入要添加的群友记忆", true);
    wechatyAddMemberMemoryBtn.disabled = true;
    try {
      const res = await fetch(`${API}/social/wechat-groups/member-memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: wechatyActiveMemoryGroupId,
          group_name: wechatyActiveMemoryGroupName,
          canonical_member_id: member.canonical_member_id,
          sender_id: (member.sender_ids || [])[0] || "",
          sender_name: member.display_name || "",
          content,
          category: "manual_member",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (wechatyMemberMemoryInput) wechatyMemberMemoryInput.value = "";
        showFeedback(wechatyDutyFeedback, "已添加群友永久记忆");
        await loadWechatyMemberMemory({ keepMember: true });
        await loadWechatyActiveMemory();
      } else showFeedback(wechatyDutyFeedback, data.error || "添加群友记忆失败", true);
    } catch {
      showFeedback(wechatyDutyFeedback, "添加群友记忆请求失败", true);
    } finally {
      wechatyAddMemberMemoryBtn.disabled = false;
    }
  });

  wechatyMemberMemoryPreview?.addEventListener("click", async event => {
    const saveBtn = event.target?.closest?.(".member-memory-save");
    const deleteBtn = event.target?.closest?.(".member-memory-delete");
    const btn = saveBtn || deleteBtn;
    if (!btn || !wechatyActiveMemoryGroupId) return;
    const card = btn.closest(".member-permanent-memory");
    const itemId = btn.dataset.itemId || card?.dataset.itemId || "";
    if (!itemId) return;
    btn.disabled = true;
    try {
      if (saveBtn) {
        const content = String(card?.querySelector(".member-memory-content")?.value || "").trim();
        const category = String(card?.querySelector(".member-memory-category")?.value || "manual_member").trim();
        if (!content) return showFeedback(wechatyDutyFeedback, "记忆内容不能为空", true);
        const res = await fetch(`${API}/social/wechat-groups/member-memory`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: wechatyActiveMemoryGroupId, item_id: itemId, content, category }),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(wechatyDutyFeedback, "已保存群友记忆");
          await loadWechatyMemberMemory({ keepMember: true });
          await loadWechatyActiveMemory();
        } else showFeedback(wechatyDutyFeedback, data.error || "保存失败", true);
      } else if (deleteBtn) {
        if (!confirm("确定删除这条群友永久记忆吗？")) return;
        const res = await fetch(`${API}/social/wechat-groups/member-memory`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: wechatyActiveMemoryGroupId, item_id: itemId }),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(wechatyDutyFeedback, "已删除群友记忆");
          await loadWechatyMemberMemory({ keepMember: true });
          await loadWechatyActiveMemory();
        } else showFeedback(wechatyDutyFeedback, data.error || "删除失败", true);
      }
    } catch {
      showFeedback(wechatyDutyFeedback, "群友记忆操作请求失败", true);
    } finally {
      btn.disabled = false;
    }
  });

  wechatyClearGroupMemoryBtn?.addEventListener("click", async () => {
    if (!wechatyActiveMemoryGroupId) {
      showFeedback(wechatyDutyFeedback, "请先选择一个群", true);
      return;
    }
    if (!confirm(`确定清空「${wechatyActiveMemoryGroupName || wechatyActiveMemoryGroupId}」的群记忆吗？这会删除本群消息记忆与自动结论，不能撤销。`)) return;
    wechatyClearGroupMemoryBtn.disabled = true;
    try {
      const res = await fetch(`${API}/social/wechat-groups/memory`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: wechatyActiveMemoryGroupId, kind: "session" }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(wechatyDutyFeedback, "已清空本群记忆");
        renderWechatyMemoryDetail({ ok: true, messages: [], conclusions: [], summaries: [], counts: { messages: 0, conclusions: 0, summaries: 0 } }, wechatyActiveMemoryGroupName);
        await refreshWechatyMemoryOverview();
      } else showFeedback(wechatyDutyFeedback, data.error || "清空失败", true);
    } catch {
      showFeedback(wechatyDutyFeedback, "清空请求失败", true);
    } finally {
      wechatyClearGroupMemoryBtn.disabled = false;
    }
  });

  async function saveWechatyDutySettings({ requireGroups = true, feedbackEl = wechatyDutyFeedback } = {}) {
    let groupNames = collectWechatySelectedRooms();
    if (!groupNames.length && !requireGroups) groupNames = [...wechatyConfiguredGroupNames];
    if (wechatyDutyEnabled?.checked && requireGroups && groupNames.length === 0) {
      showFeedback(feedbackEl, "请至少选择一个群", true);
      return;
    }
    if (wechatySaveGroupsBtn) wechatySaveGroupsBtn.disabled = true;
    if (wechatySavePersonaBtn) wechatySavePersonaBtn.disabled = true;
    if (wechatySaveConcurrencyBtn) wechatySaveConcurrencyBtn.disabled = true;
    if (wechatySaveAmbientBtn) wechatySaveAmbientBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/social/wechaty-duty-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!wechatyDutyEnabled?.checked,
          group_names: groupNames,
          persona_prompt: wechatyPersonaPrompt?.value || "",
          persona_preset_id: describeWechatyPersona(wechatyPersonaPrompt?.value || "").id,
          admin_mode_enabled: !!wechatyAdminEnabled?.checked,
          admin_wechat_ids: [...wechatyAdminIdSet],
          blocked_wechat_ids: collectWechatyBlockedConfig().blockedWechatIds,
          concurrency_limit: collectWechatyConcurrencyLimit(),
          ambient_reply: collectWechatyAmbientConfig(),
          offline_qr_notify: collectWechatyOfflineQrNotifyConfig(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        wechatyGroupSelectionDirty = false;
        applyWechatyDutyConfig(data.wechatyDutyGroup, data.status);
        showFeedback(feedbackEl, data.wechatyDutyGroup?.enabled === false ? "已关闭" : "已保存并生效");
        setTimeout(() => refreshWechatyRooms({ autoStart: false }), 1200);
        setTimeout(() => refreshWechatyMemoryOverview(), 1400);
      } else {
        showFeedback(feedbackEl, data.error || "保存失败", true);
      }
    } catch {
      showFeedback(feedbackEl, "请求失败", true);
    } finally {
      if (wechatySaveGroupsBtn) wechatySaveGroupsBtn.disabled = false;
      if (wechatySavePersonaBtn) wechatySavePersonaBtn.disabled = false;
      if (wechatySaveConcurrencyBtn) wechatySaveConcurrencyBtn.disabled = false;
      if (wechatySaveAmbientBtn) wechatySaveAmbientBtn.disabled = false;
    }
  }

  wechatySaveGroupsBtn?.addEventListener("click", () => saveWechatyDutySettings({ requireGroups: true, feedbackEl: wechatyDutyFeedback }));
  wechatySavePersonaBtn?.addEventListener("click", () => saveWechatyDutySettings({ requireGroups: false, feedbackEl: wechatyPersonaFeedback || wechatyDutyFeedback }));
  wechatySaveConcurrencyBtn?.addEventListener("click", () => saveWechatyDutySettings({ requireGroups: false, feedbackEl: wechatyDutyFeedback }));
  wechatySaveAmbientBtn?.addEventListener("click", () => saveWechatyDutySettings({ requireGroups: false, feedbackEl: wechatyDutyFeedback }));
  wechatyResetAmbientBtn?.addEventListener("click", () => {
    wechatyAmbientDraft = JSON.parse(JSON.stringify(DEFAULT_WECHATY_AMBIENT_REPLY));
    if (wechatyAmbientTtl) wechatyAmbientTtl.value = String(wechatyAmbientDraft.ambientQueueTtlSeconds);
    wechatyAmbientLevels?.querySelectorAll('input[name="wechaty-ambient-level"]').forEach(input => {
      input.checked = input.value === wechatyAmbientDraft.activityLevel;
    });
    renderWechatyAmbientProfileEditor();
    renderWechatyAmbientSummary();
  });
  wechatyAmbientLevels?.addEventListener("change", () => {
    const level = wechatyAmbientLevels.querySelector('input[name="wechaty-ambient-level"]:checked')?.value;
    if (level) wechatyAmbientDraft.activityLevel = level;
    renderWechatyAmbientSummary();
  });
  wechatyAmbientTtl?.addEventListener("input", () => {
    wechatyAmbientDraft.ambientQueueTtlSeconds = clampWechatyNumber(wechatyAmbientTtl.value, wechatyAmbientDraft.ambientQueueTtlSeconds, 10, 600);
  });
  applyWechatyConcurrencyConfig({ concurrencyLimit: 6 }, {});
  applyWechatyAmbientConfig({ ambientReply: DEFAULT_WECHATY_AMBIENT_REPLY }, {});
  wechatyOfflineQrNotifyEnabled?.addEventListener("change", queueWechatyOfflineQrNotifySave);
  wechatyOfflineQrNotifyAutoRelogin?.addEventListener("change", queueWechatyOfflineQrNotifySave);
  wechatyOfflineQrNotifyCooldown?.addEventListener("change", queueWechatyOfflineQrNotifySave);
  wechatyOfflineQrNotifyTestBtn?.addEventListener("click", testWechatyOfflineQrNotifyNow);

  const fileSandboxToggle = document.getElementById("security-file-sandbox");
  const execSandboxToggle = document.getElementById("security-exec-sandbox");
  const saveSecurityBtn   = document.getElementById("settings-save-security");
  const securityFeedback  = document.getElementById("settings-security-feedback");

  async function loadWebSearchSettings() {
    try {
      const { webSearch } = await fetch(`${API}/settings/web-search`).then(r => r.json());
      const urlEl = document.getElementById("websearch-searxng-url");
      if (urlEl) urlEl.value = webSearch?.searxngUrl || "";
      const setStatus = (id, configured, fromEnv, extra) => {
        const el = document.getElementById(id);
        if (!el) return;
        const truncated = extra && extra.length > 60 ? extra.slice(0, 60) + "…" : extra;
        const state = configured ? (fromEnv ? "is-env" : "is-ok") : "is-empty";
        el.className = `network-status-pill ${state}`;
        if (configured) {
          el.textContent = `${fromEnv ? "环境变量" : "已配置"}${truncated ? ` · ${truncated}` : ""}`;
          el.title = truncated ? String(extra || "") : "";
        } else {
          el.textContent = "未配置";
          el.title = "兜底链中跳过";
        }
      };
      setStatus("websearch-status-serper",  !!webSearch?.serperConfigured, !!webSearch?.serperFromEnv);
      setStatus("websearch-status-jina",    !!webSearch?.jinaConfigured,   !!webSearch?.jinaFromEnv);
      const searxngConfigured = !!webSearch?.searxngUrl || !!webSearch?.searxngFromEnv;
      setStatus("websearch-status-searxng", searxngConfigured, !!webSearch?.searxngFromEnv, webSearch?.effectiveSearxngUrl || "");
      const bravePool = document.getElementById("websearch-status-brave-pool");
      if (bravePool) {
        const count = Number(webSearch?.braveConfiguredCount || 0);
        bravePool.className = `network-status-pill ${count ? "is-ok" : "is-empty"}`;
        bravePool.textContent = count
          ? `${count}/${webSearch?.bravePoolSize || 10} 可用 · 本地 ${webSearch?.braveStoredCount || 0} · ENV ${webSearch?.braveEnvCount || 0}`
          : "未配置";
        bravePool.title = count ? "Brave 网页搜索和图片搜索会优先使用该 Key 池" : "未配置 Brave，搜索会直接走兜底链";
      }
      (webSearch?.braveSlots || []).forEach(slot => {
        const el = document.getElementById(`websearch-status-brave-${slot.index}`);
        if (!el) return;
        const state = slot.configured ? "is-ok" : slot.fromEnv ? "is-env" : "is-empty";
        el.className = `network-key-status ${state}`;
        el.textContent = slot.configured ? "本地" : slot.fromEnv ? "ENV" : "空";
        el.title = slot.configured ? "本地已保存 Key" : slot.fromEnv ? "由环境变量提供" : "此槽位未配置";
      });
    } catch {}
  }

  const saveWebSearchBtn = document.getElementById("settings-save-web-search");
  const webSearchFeedback = document.getElementById("settings-web-search-feedback");
  if (saveWebSearchBtn) {
    saveWebSearchBtn.addEventListener("click", async () => {
      const updates = {};
      const serperEl  = document.getElementById("websearch-serper-key");
      const jinaEl    = document.getElementById("websearch-jina-key");
      const searxngEl = document.getElementById("websearch-searxng-url");
      const braveInputs = Array.from(document.querySelectorAll(".websearch-brave-key"));
      const braveClears = Array.from(document.querySelectorAll(".websearch-brave-clear"));
      const serperVal  = serperEl?.value?.trim();
      const jinaVal    = jinaEl?.value?.trim();
      const searxngVal = searxngEl?.value?.trim();
      if (serperVal)  updates.serperKey  = serperVal;
      if (jinaVal)    updates.jinaKey    = jinaVal;
      updates.braveKeys = Array.from({ length: 10 }, (_, i) => {
        const input = braveInputs.find(el => Number(el.dataset.index) === i);
        return input?.value?.trim() || "";
      });
      updates.clearBraveKeyIndexes = braveClears
        .filter(el => el.checked)
        .map(el => Number(el.dataset.index))
        .filter(n => Number.isInteger(n));
      // SearXNG URL：空字符串也要传，让用户能清掉
      if (searxngEl)  updates.searxngUrl = searxngVal || "";
      saveWebSearchBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/web-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(webSearchFeedback, "已保存");
          if (serperEl) serperEl.value = "";
          if (jinaEl)   jinaEl.value = "";
          braveInputs.forEach(el => { el.value = ""; });
          braveClears.forEach(el => { el.checked = false; });
          loadWebSearchSettings();
        } else {
          showFeedback(webSearchFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(webSearchFeedback, "请求失败", true);
      } finally {
        saveWebSearchBtn.disabled = false;
      }
    });
  }

  async function loadSecuritySettings() {
    try {
      const { security } = await fetch(`${API}/settings/security`).then(r => r.json());
      if (fileSandboxToggle) fileSandboxToggle.checked = security.fileSandbox !== false;
      if (execSandboxToggle) execSandboxToggle.checked = security.execSandbox !== false;
      document.querySelectorAll(".security-blocked-tool").forEach(cb => {
        cb.checked = (security.blockedTools || []).includes(cb.value);
      });
    } catch {}
  }

  if (saveSecurityBtn) {
    saveSecurityBtn.addEventListener("click", async () => {
      const blockedTools = [...document.querySelectorAll(".security-blocked-tool")]
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      const body = {
        fileSandbox: fileSandboxToggle ? fileSandboxToggle.checked : true,
        execSandbox: execSandboxToggle ? execSandboxToggle.checked : true,
        blockedTools,
      };
      saveSecurityBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/security`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(securityFeedback, "已保存 — 立即生效");
        } else {
          showFeedback(securityFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(securityFeedback, "请求失败", true);
      } finally {
        saveSecurityBtn.disabled = false;
      }
    });
  }

  if (saveSocialBtn) {
    saveSocialBtn.addEventListener("click", async () => {
      const updates = {};
      for (const [fieldId, envKey] of Object.entries(SOCIAL_FIELD_MAP)) {
        const val = document.getElementById(fieldId)?.value?.trim() || "";
        if (val) updates[envKey] = val;
      }
      saveSocialBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(socialFeedback, "已保存");
          Object.keys(SOCIAL_FIELD_MAP).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
          });
          loadSocialSettings();
        } else {
          showFeedback(socialFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(socialFeedback, "请求失败", true);
      } finally {
        saveSocialBtn.disabled = false;
      }
    });
  }

  if (tempSlider && tempVal) {
    tempSlider.addEventListener("input", () => {
      tempVal.textContent = parseFloat(tempSlider.value).toFixed(2);
    });
  }
  if (saveTempBtn) {
    saveTempBtn.addEventListener("click", async () => {
      const temperature = parseFloat(tempSlider?.value ?? "0.5");
      saveTempBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/temperature`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ temperature }),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(tempFeedback, `已设为 ${data.temperature.toFixed(2)}`);
        } else {
          showFeedback(tempFeedback, data.error || "保存失败", true);
        }
      } catch { showFeedback(tempFeedback, "请求失败", true); }
      finally { saveTempBtn.disabled = false; }
    });
  }

  const VOICE_LANG_KEY       = "bailongma-voice-lang";
  const VOICE_AUTO_SEND_KEY  = "bailongma-voice-auto-send";
  const VOICE_AUTO_MIC_KEY   = "bailongma-voice-auto-mic";
  const VOICE_FAST_MODE_KEY  = "bailongma-voice-fast-mode";
  const VOICE_THRESHOLD_KEY  = "bailongma-voice-threshold";
  const VOICE_PROVIDER_KEY   = "bailongma-voice-provider";
  const VOICE_WHISPER_MODEL_KEY = "bailongma-voice-whisper-model"; // 兼容旧版本
  const VOICE_LOCAL_ASR_MODEL_KEY = "bailongma-voice-local-asr-model";
  const VOICE_WAKE_ENABLED_KEY = "bailongma-voice-wake-enabled";
  const VOICE_WAKE_WORDS_KEY = "bailongma-voice-wake-words";
  const VOICE_VIDEO_DUCK_KEY = "bailongma-voice-video-duck";
  const VOICE_VIDEO_PTT_KEY = "bailongma-voice-video-ptt";
  const VOICE_VIDEO_AEC_KEY = "bailongma-voice-video-aec";
  const VOICE_LOCAL_DEFAULT_MIGRATION_KEY = "bailongma-voice-local-default-v1";

  function applyVoiceProviderUI(provider) {
    const panels = { local: "voice-cred-local", aliyun: "voice-cred-aliyun", tencent: "voice-cred-tencent", xunfei: "voice-cred-xunfei", volcengine: "voice-cred-volcengine" };
    for (const [key, id] of Object.entries(panels)) {
      const el = document.getElementById(id);
      if (el) el.style.display = key === provider ? "" : "none";
    }
  }

  const voiceProviderSelect = document.getElementById("voice-provider-select");
  if (voiceProviderSelect) {
    voiceProviderSelect.addEventListener("change", () => applyVoiceProviderUI(voiceProviderSelect.value));
  }

  async function loadVoiceSettings() {
    let serverVoice = null;
    try {
      const resp = await fetch(`${API}/settings/voice`);
      const data = await resp.json();
      if (data?.ok && data.voice) serverVoice = data.voice;
    } catch {}

    const langSelect = document.getElementById("voice-lang-select");
    const autoSend   = document.getElementById("voice-auto-send");
    if (langSelect) langSelect.value = localStorage.getItem(VOICE_LANG_KEY) || "zh-CN";
    if (autoSend) autoSend.checked = localStorage.getItem(VOICE_AUTO_SEND_KEY) !== "false";
    const autoMic = document.getElementById("voice-auto-mic");
    if (autoMic) autoMic.checked = localStorage.getItem(VOICE_AUTO_MIC_KEY) === "true";
    const fastMode = document.getElementById("voice-fast-mode");
    if (fastMode) fastMode.checked = localStorage.getItem(VOICE_FAST_MODE_KEY) !== "false";
    const savedThresh = parseFloat(localStorage.getItem(VOICE_THRESHOLD_KEY) || "0.008");
    if (voiceThreshSlider) voiceThreshSlider.value = String(savedThresh);
    if (voiceThreshVal)    voiceThreshVal.textContent = savedThresh.toFixed(3);

    // 以后端保存的语音服务商为准，避免前端旧 localStorage 继续连错误的云端 ASR。
    if (!localStorage.getItem(VOICE_LOCAL_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(VOICE_PROVIDER_KEY, "local");
      localStorage.setItem(VOICE_LOCAL_DEFAULT_MIGRATION_KEY, "1");
    }
    let savedProvider = serverVoice?.asrProvider || "local";
    if (!["local", "aliyun", "tencent", "xunfei", "volcengine"].includes(savedProvider)) savedProvider = "local";
    if (voiceProviderSelect) voiceProviderSelect.value = savedProvider;
    const localAsrModelSelect = document.getElementById("voice-local-asr-model");
    const savedLocalModel = serverVoice?.localAsrModel || localStorage.getItem(VOICE_LOCAL_ASR_MODEL_KEY) || "sensevoice-small";
    if (localAsrModelSelect) localAsrModelSelect.value = savedLocalModel;
    localStorage.setItem(VOICE_PROVIDER_KEY, savedProvider);
    localStorage.setItem(VOICE_LOCAL_ASR_MODEL_KEY, savedLocalModel);
    const wakeEnabled = document.getElementById("voice-wake-enabled");
    const wakeWords = document.getElementById("voice-wake-words");
    const videoDuck = document.getElementById("voice-video-duck");
    const videoPtt = document.getElementById("voice-video-ptt");
    const videoAec = document.getElementById("voice-video-aec");
    const savedWakeEnabled = typeof serverVoice?.wakeWordEnabled === "boolean" ? serverVoice.wakeWordEnabled : localStorage.getItem(VOICE_WAKE_ENABLED_KEY) !== "false";
    const savedWakeWords = Array.isArray(serverVoice?.wakeWords) ? serverVoice.wakeWords.join("，") : (localStorage.getItem(VOICE_WAKE_WORDS_KEY) || "小龙马，龙马，白龙马");
    if (wakeEnabled) wakeEnabled.checked = savedWakeEnabled;
    if (wakeWords) wakeWords.value = savedWakeWords;
    localStorage.setItem(VOICE_WAKE_ENABLED_KEY, String(savedWakeEnabled));
    localStorage.setItem(VOICE_WAKE_WORDS_KEY, savedWakeWords);
    if (videoDuck) videoDuck.checked = localStorage.getItem(VOICE_VIDEO_DUCK_KEY) !== "false";
    if (videoPtt) videoPtt.checked = localStorage.getItem(VOICE_VIDEO_PTT_KEY) !== "false";
    if (videoAec) videoAec.checked = localStorage.getItem(VOICE_VIDEO_AEC_KEY) !== "false";
    applyVoiceProviderUI(savedProvider);
  }

  if (voiceThreshSlider && voiceThreshVal) {
    voiceThreshSlider.addEventListener("input", () => {
      voiceThreshVal.textContent = parseFloat(voiceThreshSlider.value).toFixed(3);
    });
  }



  if (saveVoiceBtn) {
    saveVoiceBtn.addEventListener("click", async () => {
      const lang      = document.getElementById("voice-lang-select")?.value || "zh-CN";
      const autoSend  = document.getElementById("voice-auto-send")?.checked ?? true;
      const autoMic   = document.getElementById("voice-auto-mic")?.checked ?? false;
      const fastMode  = document.getElementById("voice-fast-mode")?.checked ?? true;
      const threshold = parseFloat(voiceThreshSlider?.value ?? "0.008");
      const provider  = voiceProviderSelect?.value || "local";
      const localAsrModel = document.getElementById("voice-local-asr-model")?.value || "sensevoice-small";
      const whisperModel = localAsrModel === "sensevoice-small" ? (localStorage.getItem(VOICE_WHISPER_MODEL_KEY) || "small") : localAsrModel;
      const wakeEnabled = document.getElementById("voice-wake-enabled")?.checked ?? true;
      const wakeWords = document.getElementById("voice-wake-words")?.value?.trim() || "小龙马，龙马，白龙马";
      const videoDuck = document.getElementById("voice-video-duck")?.checked ?? true;
      const videoPtt = document.getElementById("voice-video-ptt")?.checked ?? true;
      const videoAec = document.getElementById("voice-video-aec")?.checked ?? true;

      localStorage.setItem(VOICE_LANG_KEY,      lang);
      localStorage.setItem(VOICE_AUTO_SEND_KEY,  String(autoSend));
      localStorage.setItem(VOICE_AUTO_MIC_KEY,   String(autoMic));
      localStorage.setItem(VOICE_FAST_MODE_KEY,  String(fastMode));
      localStorage.setItem(VOICE_THRESHOLD_KEY,  String(threshold));
      localStorage.setItem(VOICE_PROVIDER_KEY,   provider);
      localStorage.setItem(VOICE_LOCAL_ASR_MODEL_KEY, localAsrModel);
      localStorage.setItem(VOICE_WHISPER_MODEL_KEY, whisperModel);
      localStorage.setItem(VOICE_WAKE_ENABLED_KEY, String(wakeEnabled));
      localStorage.setItem(VOICE_WAKE_WORDS_KEY, wakeWords);
      localStorage.setItem(VOICE_VIDEO_DUCK_KEY, String(videoDuck));
      localStorage.setItem(VOICE_VIDEO_PTT_KEY, String(videoPtt));
      localStorage.setItem(VOICE_VIDEO_AEC_KEY, String(videoAec));
      localStorage.setItem(VOICE_LOCAL_DEFAULT_MIGRATION_KEY, "1");

      window.dispatchEvent(new CustomEvent("bailongma:voice-threshold", { detail: { threshold } }));

      const body = {
        asrProvider: provider,
        localAsrModel,
        whisperModel,
        wakeWordEnabled: wakeEnabled,
        wakeWords: wakeWords.split(/[,，、\s]+/).map(w => w.trim()).filter(Boolean),
        speakerVerificationEnabled: false,
      };
      const aliyunKey = document.getElementById("voice-aliyun-key")?.value?.trim();
      if (aliyunKey) body.aliyunApiKey = aliyunKey;
      const tencentSid = document.getElementById("voice-tencent-sid")?.value?.trim();
      if (tencentSid) body.tencentSecretId = tencentSid;
      const tencentSkey = document.getElementById("voice-tencent-skey")?.value?.trim();
      if (tencentSkey) body.tencentSecretKey = tencentSkey;
      const tencentAppid = document.getElementById("voice-tencent-appid")?.value?.trim();
      if (tencentAppid) body.tencentAppId = tencentAppid;
      const xunfeiAppid = document.getElementById("voice-xunfei-appid")?.value?.trim();
      if (xunfeiAppid) body.xunfeiAppId = xunfeiAppid;
      const xunfeiApikey = document.getElementById("voice-xunfei-apikey")?.value?.trim();
      if (xunfeiApikey) body.xunfeiApiKey = xunfeiApikey;
      const volcengineAppKey = document.getElementById("voice-volcengine-appkey")?.value?.trim();
      if (volcengineAppKey) body.volcengineAppKey = volcengineAppKey;
      const volcengineAccessKey = document.getElementById("voice-volcengine-accesskey")?.value?.trim();
      if (volcengineAccessKey) body.volcengineAccessKey = volcengineAccessKey;
      const volcengineResourceId = document.getElementById("voice-volcengine-resourceid")?.value?.trim();
      if (volcengineResourceId) body.volcengineResourceId = volcengineResourceId;

      if (Object.keys(body).length > 0) {
        try {
          saveVoiceBtn.disabled = true;
          const resp = await fetch("http://127.0.0.1:3721/settings/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!resp.ok) throw new Error("保存失败");
          ["voice-aliyun-key","voice-tencent-sid","voice-tencent-skey","voice-xunfei-apikey","voice-volcengine-appkey","voice-volcengine-accesskey"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
          });
          showFeedback(voiceFeedback, "已保存");
        } catch { showFeedback(voiceFeedback, "保存失败", true); }
        finally { saveVoiceBtn.disabled = false; }
      } else {
        showFeedback(voiceFeedback, "已保存");
      }
    });
  }

  initTTSSettings();

  const memoryGraphToggle = document.getElementById("settings-memory-graph-toggle");
  const memoryGraphFeedback = document.getElementById("settings-memory-graph-feedback");
  if (memoryGraphToggle) {
    memoryGraphToggle.checked = localStorage.getItem(MEMORY_GRAPH_STORAGE_KEY) !== "false";
    memoryGraphToggle.addEventListener("change", () => {
      localStorage.setItem(MEMORY_GRAPH_STORAGE_KEY, String(memoryGraphToggle.checked));
      if (memoryGraphFeedback) {
        memoryGraphFeedback.textContent = "下次刷新页面后生效";
        memoryGraphFeedback.className = "settings-feedback";
        setTimeout(() => { memoryGraphFeedback.textContent = ""; }, 3000);
      }
    });
  }

  function openSettings(tab = null) {
    overlay.hidden = false;
    loadSettings();
    loadVoiceSettings();
    startWechatyStatsAutoRefresh();
    if (tab) {
      overlay.querySelectorAll(".settings-nav-item").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });
      overlay.querySelectorAll(".settings-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tab);
      });
      if (tab === "social") loadSocialSettings();
      if (tab === "skills") loadSkillSettings();
      if (tab === "database") { loadDatabaseSettings(); startDatabaseImageAutoRefresh(); }
      if (tab === "web-search") loadWebSearchSettings();
      if (tab === "update") loadUpdateSettings();
    }
  }

  function closeSettings() {
    overlay.hidden = true;
    stopWechatyStatsAutoRefresh();
    stopDatabaseImageAutoRefresh();
    if (llmKeyInput) llmKeyInput.value = "";
    if (minimaxKeyInput) minimaxKeyInput.value = "";
  }

  settingsBtn.addEventListener("click", () => openSettings());
  closeBtn.addEventListener("click", closeSettings);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || overlay.hidden) return;
    if (memberMemoryExpanded) {
      setMemberMemoryExpanded(false);
      return;
    }
    closeSettings();
  });

  if (providerSelect) {
    providerSelect.addEventListener("change", () => {
      const provider = providerSelect.value;
      applyCustomProviderUI(provider);
      if (provider !== "custom" && cachedProviders?.[provider]) populateModelSelect(cachedProviders[provider].models, null);
    });
  }

  async function saveLLMProfileFromEditor({ setActive = false } = {}) {
    const provider = providerSelect?.value || "auto";
    const editing = llmEditingIdInput?.value?.trim();
    const apiKey = llmKeyInput?.value?.trim() || "";
    if (!editing && provider !== "custom" && !apiKey) {
      showFeedback(llmFeedback, "新增模型需要填 API Key", true);
      return;
    }
    if (provider === "custom") {
      const baseURL = document.getElementById("settings-custom-baseurl")?.value?.trim();
      const model = document.getElementById("settings-custom-model")?.value?.trim();
      if (!baseURL || !model) {
        showFeedback(llmFeedback, "请填入 Base URL 和模型名称", true);
        return;
      }
    }
    const buttons = [saveLlmBtn, saveLlmCurrentBtn].filter(Boolean);
    buttons.forEach(btn => { btn.disabled = true; });
    try {
      const res = await fetch(`${API}/settings/llm-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectLLMProfilePayload({ setActive })),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmFeedback, data.warning || (setActive ? "已保存并设为当前" : "已保存到模型池"), !!data.warning);
        resetLLMProfileEditor();
        loadSettings();
      } else {
        showFeedback(llmFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(llmFeedback, "请求失败", true); }
    finally { buttons.forEach(btn => { btn.disabled = false; }); }
  }

  saveLlmBtn?.addEventListener("click", () => saveLLMProfileFromEditor({ setActive: false }));
  saveLlmCurrentBtn?.addEventListener("click", () => saveLLMProfileFromEditor({ setActive: true }));

  saveLlmFailoverBtn?.addEventListener("click", async () => {
    saveLlmFailoverBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/llm-failover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!llmFailoverEnabled?.checked,
          cooldownSeconds: Number(llmFailoverCooldown?.value || 180),
          maxAttempts: Number(llmFailoverAttempts?.value || 4),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmFailoverFeedback, "策略已保存");
        loadSettings();
      } else {
        showFeedback(llmFailoverFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(llmFailoverFeedback, "请求失败", true); }
    finally { saveLlmFailoverBtn.disabled = false; }
  });

  llmRoutingList?.addEventListener("change", (event) => {
    if (event.target?.closest?.(".llm-routing-select")) updateLLMGroupRoutingCounts();
  });

  saveLlmRoutingBtn?.addEventListener("click", async () => {
    saveLlmRoutingBtn.disabled = true;
    try {
      const payload = collectLLMGroupRoutingPayload();
      const res = await fetch(`${API}/settings/llm-group-routing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmRoutingFeedback, "群模型路由已保存");
        if (data.llm) cachedActiveLLM = data.llm;
        if (Array.isArray(data.llm?.profiles)) cachedLLMProfiles = data.llm.profiles;
        renderLLMGroupRouting(data.routing || payload, data.llm?.profiles || cachedLLMProfiles, data.wechatyDutyGroupStatus || { rooms: cachedLLMRoutingRooms });
      } else {
        showFeedback(llmRoutingFeedback, data.error || "保存失败", true);
      }
    } catch {
      showFeedback(llmRoutingFeedback, "请求失败", true);
    } finally {
      saveLlmRoutingBtn.disabled = false;
    }
  });

  llmMonitorProfileList?.addEventListener("change", updateLLMMonitorCounts);
  llmMonitorGroupList?.addEventListener("change", (event) => {
    const mentionCb = event.target?.closest?.(".llm-monitor-mention-checkbox");
    if (mentionCb) {
      const card = mentionCb.closest(".llm-monitor-group-card");
      if (card) {
        const groupKey = card.dataset.groupKey || "";
        const ids = [...card.querySelectorAll(".llm-monitor-mention-checkbox:checked")].map(input => input.value).filter(Boolean);
        cachedLLMMonitor.notifyMentionsByGroup = { ...(cachedLLMMonitor.notifyMentionsByGroup || {}), [groupKey]: ids };
        renderLLMMonitorMentionList(groupKey);
      }
      updateLLMMonitorCounts();
      return;
    }
    if (event.target?.closest?.(".llm-monitor-group-checkbox")) updateLLMMonitorGroupCardStates();
    updateLLMMonitorCounts();
  });
  llmMonitorGroupList?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".llm-monitor-mention-load");
    if (!btn) return;
    const card = btn.closest(".llm-monitor-group-card");
    const groupKey = card?.dataset.groupKey || "";
    if (groupKey) loadLLMMonitorGroupMembers(groupKey);
  });
  llmMonitorGroupList?.addEventListener("input", (event) => {
    const input = event.target?.closest?.(".llm-monitor-mention-search");
    if (!input) return;
    const card = input.closest(".llm-monitor-group-card");
    const groupKey = card?.dataset.groupKey || "";
    if (groupKey) renderLLMMonitorMentionList(groupKey);
  });

  saveLlmMonitorBtn?.addEventListener("click", async () => {
    saveLlmMonitorBtn.disabled = true;
    try {
      const payload = collectLLMMonitorPayload();
      const res = await fetch(`${API}/settings/llm-connectivity-monitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmMonitorFeedback, "连通通知设置已保存");
        renderLLMMonitor(data.config || payload, data.status || cachedLLMMonitorStatus, cachedLLMProfiles, { rooms: cachedLLMMonitorRooms });
        loadLLMMonitorSettings();
      } else {
        showFeedback(llmMonitorFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(llmMonitorFeedback, "请求失败", true); }
    finally { saveLlmMonitorBtn.disabled = false; }
  });

  async function runLLMMonitorNow({ notify = false } = {}) {
    const btn = notify ? notifyLlmMonitorBtn : testLlmMonitorBtn;
    if (btn) {
      btn.disabled = true;
      btn.textContent = notify ? "检测并通知中…" : "检测中…";
    }
    if (llmMonitorResult) llmMonitorResult.textContent = notify ? "正在检测渠道并发送微信群通知…" : "正在检测渠道连通性…";
    try {
      // 先保存当前勾选，避免用户改了群/渠道但忘记保存后手动通知发错地方。
      const payload = collectLLMMonitorPayload();
      cachedLLMMonitor = { ...cachedLLMMonitor, ...payload };
      await fetch(`${API}/settings/llm-connectivity-monitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
      const res = await fetch(`${API}/settings/llm-connectivity-monitor/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify, forceNotify: notify }),
      });
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.profiles)) {
          renderLLMProfiles(data.profiles, { activeProfileId: cachedActiveLLM?.activeProfileId });
        }
        renderLLMMonitor(cachedLLMMonitor, data.status || {}, data.profiles || cachedLLMProfiles, { rooms: cachedLLMMonitorRooms });
        const notifyFailed = notify && data.notify && data.notify.ok === false;
        showFeedback(llmMonitorFeedback, notifyFailed ? `检测完成，但通知未发送：${data.notify.reason || "没有可通知群"}` : (notify ? "检测完成，已按配置通知微信群" : "检测完成"), notifyFailed);
        loadLLMMonitorSettings();
      } else {
        showFeedback(llmMonitorFeedback, data.error || "检测失败", true);
        if (llmMonitorResult) llmMonitorResult.textContent = data.error || "检测失败";
      }
    } catch {
      showFeedback(llmMonitorFeedback, "请求失败", true);
      if (llmMonitorResult) llmMonitorResult.textContent = "检测请求失败";
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = notify ? "立即检测并通知" : "立即检测";
      }
    }
  }

  testLlmMonitorBtn?.addEventListener("click", () => runLLMMonitorNow({ notify: false }));
  notifyLlmMonitorBtn?.addEventListener("click", () => runLLMMonitorNow({ notify: true }));

  llmBatchSelectAllBtn?.addEventListener("click", () => {
    selectedLLMProfileIds = new Set(cachedLLMProfiles.map(profile => String(profile.id || "")).filter(Boolean));
    updateLLMBatchSelectionCount();
  });

  llmBatchClearBtn?.addEventListener("click", () => {
    selectedLLMProfileIds = new Set();
    updateLLMBatchSelectionCount();
  });

  llmBatchTestSelectedBtn?.addEventListener("click", () => runLLMBatchTest({ all: false }));
  llmBatchTestAllBtn?.addEventListener("click", () => runLLMBatchTest({ all: true }));

  llmPoolList?.addEventListener("change", (event) => {
    const input = event.target?.closest?.(".llm-profile-checkbox");
    if (!input) return;
    const id = String(input.value || "").trim();
    if (!id) return;
    if (input.checked) selectedLLMProfileIds.add(id);
    else selectedLLMProfileIds.delete(id);
    updateLLMBatchSelectionCount();
  });

  llmPoolList?.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    const card = event.target.closest(".llm-profile-card");
    if (!btn || !card) return;
    const id = card.dataset.id;
    const action = btn.dataset.action;
    const profile = cachedLLMProfiles.find(p => p.id === id);
    if (!profile) return;
    if (action === "edit") {
      loadProfileIntoEditor(profile);
      return;
    }
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      let endpoint = `${API}/settings/llm-profile`;
      let body = {};
      if (action === "select") {
        endpoint = `${API}/settings/llm-profile/select`;
        body = { id };
      } else if (action === "test") {
        endpoint = `${API}/settings/llm-profile/test`;
        body = { id };
        btn.textContent = "测试中…";
      } else if (action === "delete") {
        if (!confirm(`删除模型配置“${profile.name}”？`)) return;
        endpoint = `${API}/settings/llm-profile/delete`;
        body = { id };
      } else if (action === "toggle") {
        body = { id, provider: profile.provider, model: profile.model, baseURL: profile.baseURL, enabled: profile.enabled === false, validate: false };
      } else if (action === "up" || action === "down") {
        const sorted = [...cachedLLMProfiles].sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
        const idx = sorted.findIndex(p => p.id === id);
        const swapIdx = action === "up" ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
        const other = sorted[swapIdx];
        await fetch(`${API}/settings/llm-profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: other.id, provider: other.provider, model: other.model, baseURL: other.baseURL, priority: profile.priority, validate: false }),
        });
        body = { id, provider: profile.provider, model: profile.model, baseURL: profile.baseURL, priority: other.priority, validate: false };
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmFeedback, action === "test" ? `连通成功（${Math.round((data.latencyMs || 0) / 1000)} 秒）` : (action === "select" ? "已切换当前模型" : "模型池已更新"));
        loadSettings();
      } else {
        showFeedback(llmFeedback, action === "test" ? `连通失败：${data.error || "未知错误"}` : (data.error || "操作失败"), true);
        if (data.llm) {
          renderLLMFailover(data.llm.failover || cachedLLMFailover);
          renderLLMProfiles(data.llm.profiles || cachedLLMProfiles, data.llm);
        } else loadSettings();
      }
    } catch {
      showFeedback(llmFeedback, "请求失败", true);
    } finally {
      btn.disabled = false;
      if (action === "test") btn.textContent = originalText || "测试连通";
    }
  });

  saveMinimaxBtn?.addEventListener("click", async () => {
    const apiKey = minimaxKeyInput.value.trim();
    if (!apiKey) { showFeedback(minimaxFeedback, "API Key 不能为空", true); return; }
    saveMinimaxBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/minimax`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(minimaxFeedback, "已保存");
        minimaxKeyInput.value = "";
        loadSettings();
      } else {
        showFeedback(minimaxFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(minimaxFeedback, "请求失败", true); }
    finally { saveMinimaxBtn.disabled = false; }
  });

  const clawbotConnectBtn = document.getElementById("clawbot-connect-btn");
  const clawbotLogoutBtn  = document.getElementById("clawbot-logout-btn");
  const clawbotQrArea     = document.getElementById("clawbot-qr-area");
  const clawbotQrImg      = document.getElementById("clawbot-qr-img");
  const clawbotQrHint     = document.getElementById("clawbot-qr-hint");
  const clawbotFeedback   = document.getElementById("clawbot-feedback");
  const clawbotStatus     = document.getElementById("social-status-clawbot");
  let clawbotPollTimer    = null;

  function setClawbotStatus(text, ok) {
    if (!clawbotStatus) return;
    clawbotStatus.textContent = ok ? `● ${text}` : `○ ${text}`;
    clawbotStatus.className = `settings-platform-status ${ok ? "ok" : "miss"}`;
  }

  function stopClawbotPoll() {
    if (clawbotPollTimer) { clearInterval(clawbotPollTimer); clawbotPollTimer = null; }
  }

  async function pollClawbotQR() {
    try {
      const data = await fetch(`${API}/social/wechat-clawbot/qr`).then(r => r.json());
      if (data.status === "connected") {
        stopClawbotPoll();
        if (clawbotQrArea) clawbotQrArea.style.display = "none";
        setClawbotStatus("已连接", true);
        if (clawbotFeedback) showFeedback(clawbotFeedback, "微信绑定成功！");
        loadSocialSettings();
      } else if (data.status === "qr_ready" && data.qr_url) {
        if (clawbotQrImg) clawbotQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qr_url)}`;
        if (clawbotQrArea) clawbotQrArea.style.display = "block";
        if (clawbotQrHint) clawbotQrHint.textContent = "等待扫码…";
        setClawbotStatus("等待扫码", false);
      } else if (data.status === "qr_pending") {
        if (clawbotQrHint) clawbotQrHint.textContent = "正在生成二维码…";
      } else if (data.status === "error") {
        stopClawbotPoll();
        if (clawbotQrArea) clawbotQrArea.style.display = "none";
        setClawbotStatus("连接失败", false);
        if (clawbotFeedback) showFeedback(clawbotFeedback, data.error || "连接失败", true);
      }
    } catch {}
  }

  if (clawbotConnectBtn) {
    pollClawbotQR();
  }

  clawbotConnectBtn?.addEventListener("click", async () => {
    if (clawbotQrArea) clawbotQrArea.style.display = "none";
    setClawbotStatus("启动中…", false);
    stopClawbotPoll();
    try {
      await fetch(`${API}/settings/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _clawbot_connect: "1" }),
      });
    } catch {}
    await pollClawbotQR();
    clawbotPollTimer = setInterval(pollClawbotQR, 2000);
  });

  clawbotLogoutBtn?.addEventListener("click", async () => {
    stopClawbotPoll();
    if (clawbotQrArea) clawbotQrArea.style.display = "none";
    try {
      await fetch(`${API}/social/wechat-clawbot/logout`, { method: "POST" });
      setClawbotStatus("已断开", false);
      showFeedback(clawbotFeedback, "微信已断开");
    } catch {
      showFeedback(clawbotFeedback, "请求失败", true);
    }
  });

  window.addEventListener("bailongma:social_status", (e) => {
    const d = e.detail;
    if (d?.platform === "wechaty-duty-group") {
      if (d.offline_qr_notify) {
        applyWechatyOfflineQrNotifyConfig({ offlineQrNotify: collectWechatyOfflineQrNotifyConfig() }, { offline_qr_notify: d.offline_qr_notify });
      }
      if (d.alert === "offline" || d.needs_relogin || d.connection_state === "offline") {
        setWechatyStatus("已离线 · 缓存群不可用，请重新扫码", false);
        renderWechatyQr(d.qr || "");
        if (wechatyLoginSub) wechatyLoginSub.textContent = d.hint || "微信助手已离线，缓存群不能自由回复，请强制重新扫码。";
        showFeedback(wechatyDutyFeedback, d.hint || "微信助手已离线，请强制重新扫码", true);
      } else if (d.status === "qr_ready" && d.qr) {
        renderWechatyQr(d.qr);
        setWechatyStatus("等待扫码登录", false);
        if (wechatyLoginSub) wechatyLoginSub.textContent = "新的登录二维码已生成，请扫码登录；扫码前缓存群不能自由回复。";
        showFeedback(wechatyDutyFeedback, "新的登录二维码已生成，请扫码登录");
      } else if (d.status === "connected" && d.online) {
        renderWechatyQr("");
        setWechatyStatus("已真实连接", true);
      }
      return;
    }
    if (d?.platform !== "wechat-clawbot") return;
    if (d.status === "connected") {
      stopClawbotPoll();
      if (clawbotQrArea) clawbotQrArea.style.display = "none";
      setClawbotStatus("已连接", true);
    } else if (d.status === "qr_ready") {
      if (!clawbotPollTimer) clawbotPollTimer = setInterval(pollClawbotQR, 2000);
      pollClawbotQR();
    } else if (d.status === "session_expired") {
      stopClawbotPoll();
      setClawbotStatus("会话已过期 — 请重新扫码", false);
    } else if (d.status === "idle") {
      setClawbotStatus("未连接", false);
    }
  });

  const settingsCheckUpdateBtn     = document.getElementById("settings-check-update-btn");
  const settingsDownloadUpdateBtn  = document.getElementById("settings-download-update-btn");
  const settingsInstallUpdateBtn   = document.getElementById("settings-install-update-btn");
  const settingsIgnoreUpdateBtn    = document.getElementById("settings-ignore-update-btn");
  const settingsUpdateStatusEl     = document.getElementById("settings-update-status");
  const settingsUpdateFeedback     = document.getElementById("settings-update-feedback");
  const settingsCurrentVersion     = document.getElementById("settings-current-version");
  const settingsSuppressToggle     = document.getElementById("settings-suppress-updates");
  const settingsIgnoredSection     = document.getElementById("settings-ignored-section");
  const settingsIgnoredVersionEl   = document.getElementById("settings-ignored-version-val");
  const settingsClearIgnoredBtn    = document.getElementById("settings-clear-ignored-btn");

  let pendingUpdateVersion = null;
  let removeUpdaterListener = null;

  function setUpdateStatusText(text, state = "idle") {
    if (!settingsUpdateStatusEl) return;
    settingsUpdateStatusEl.textContent = text;
    settingsUpdateStatusEl.dataset.state = state;
  }

  function setUpdateFeedback(text, isError = false) {
    if (!settingsUpdateFeedback) return;
    settingsUpdateFeedback.textContent = text || "";
    settingsUpdateFeedback.className = isError ? "settings-feedback error" : "settings-feedback";
  }

  function showUpdateButtons({ check = true, checkDisabled = false, checkLabel = "检查更新", download = false, install = false, ignore = false } = {}) {
    if (settingsCheckUpdateBtn) {
      settingsCheckUpdateBtn.classList.toggle("hidden", !check);
      settingsCheckUpdateBtn.disabled = checkDisabled;
      settingsCheckUpdateBtn.textContent = checkLabel;
    }
    settingsDownloadUpdateBtn?.classList.toggle("hidden", !download);
    settingsInstallUpdateBtn?.classList.toggle("hidden", !install);
    settingsIgnoreUpdateBtn?.classList.toggle("hidden", !ignore);
  }

  function syncUpdateSettings() {
    const ignored = localStorage.getItem(IGNORED_VERSION_KEY) || null;
    const suppressed = localStorage.getItem(SUPPRESS_UPDATES_KEY) === "true";
    if (settingsSuppressToggle) settingsSuppressToggle.checked = suppressed;
    if (settingsIgnoredSection) settingsIgnoredSection.style.display = ignored ? "" : "none";
    if (settingsIgnoredVersionEl && ignored) settingsIgnoredVersionEl.textContent = ignored;
  }

  async function loadUpdateSettings() {
    syncUpdateSettings();
    const bridge = window.bailongma;
    if (!bridge?.isElectron) {
      if (settingsCurrentVersion) settingsCurrentVersion.textContent = "仅桌面端可用";
      if (settingsCheckUpdateBtn) settingsCheckUpdateBtn.disabled = true;
      setUpdateStatusText("仅桌面端可用", "muted");
      return;
    }
    try {
      const ver = await bridge.getVersion?.();
      if (settingsCurrentVersion && ver) settingsCurrentVersion.textContent = ver;
    } catch {}

    removeUpdaterListener = bridge.onUpdaterStatus?.((payload = {}) => {
      const stage = payload.stage || "idle";
      const ver = payload.version || "";
      const percent = typeof payload.percent === "number" ? Math.round(payload.percent) : null;

      switch (stage) {
        case "checking":
          setUpdateStatusText("正在检查更新…", "checking");
          showUpdateButtons({ checkDisabled: true, checkLabel: "检查中…" });
          break;
        case "available":
          pendingUpdateVersion = ver;
          setUpdateStatusText(payload.mode === "dev" ? `开发模式发现新版本 ${ver}` : `发现新版本 ${ver}`, "available");
          showUpdateButtons({ check: false, download: true, ignore: true });
          break;
        case "downloading":
          setUpdateStatusText(payload.mode === "dev" ? "开发模式正在拉取最新代码并安装依赖…" : `下载中${percent !== null ? ` ${percent}%` : "…"}`, "downloading");
          showUpdateButtons({ check: false });
          break;
        case "downloaded":
          setUpdateStatusText(payload.mode === "dev" ? `版本 ${ver} 已拉取 — 正在重启` : `版本 ${ver} 已就绪 — 正在重启安装`, "ready");
          showUpdateButtons({ check: false, install: payload.mode !== "dev" });
          break;
        case "up-to-date":
          setUpdateStatusText(`已是最新版本 ${ver}`, "idle");
          showUpdateButtons({ checkLabel: "检查更新" });
          break;
        case "error":
          setUpdateStatusText(`更新失败：${payload.message || "请稍后再试"}`, "error");
          showUpdateButtons({ checkLabel: "重试" });
          break;
        default:
          showUpdateButtons({});
          break;
      }
    }) || null;
  }

  window.addEventListener("beforeunload", () => {
    if (typeof removeUpdaterListener === "function") {
      removeUpdaterListener();
      removeUpdaterListener = null;
    }
  });

  settingsSuppressToggle?.addEventListener("change", () => {
    localStorage.setItem(SUPPRESS_UPDATES_KEY, settingsSuppressToggle.checked ? "true" : "false");
    syncUpdateSettings();
  });

  settingsClearIgnoredBtn?.addEventListener("click", () => {
    localStorage.removeItem(IGNORED_VERSION_KEY);
    syncUpdateSettings();
  });

  settingsCheckUpdateBtn?.addEventListener("click", async () => {
    const bridge = window.bailongma;
    if (!bridge?.isElectron) return;
    setUpdateStatusText("正在检查更新…", "checking");
    setUpdateFeedback("");
    showUpdateButtons({ checkDisabled: true, checkLabel: "检查中…" });
    try {
      const result = await bridge.checkForUpdates?.();
      if (result?.ok === false && result?.message) {
        setUpdateStatusText(`更新失败：${result.message}`, "error");
        showUpdateButtons({ checkLabel: "重试" });
      }
    } catch (err) {
      setUpdateStatusText(`更新失败：${err?.message || "请稍后再试"}`, "error");
      showUpdateButtons({ checkLabel: "重试" });
    }
  });

  settingsDownloadUpdateBtn?.addEventListener("click", async () => {
    const bridge = window.bailongma;
    if (!bridge?.isElectron) return;
    setUpdateStatusText("开始下载…", "downloading");
    showUpdateButtons({ check: false });
    try {
      await bridge.startDownload?.();
    } catch (err) {
      setUpdateStatusText(`下载失败：${err?.message || "请稍后再试"}`, "error");
      showUpdateButtons({ checkLabel: "重试" });
    }
  });

  settingsInstallUpdateBtn?.addEventListener("click", () => {
    window.bailongma?.quitAndInstall?.();
  });

  settingsIgnoreUpdateBtn?.addEventListener("click", () => {
    if (pendingUpdateVersion) {
      localStorage.setItem(IGNORED_VERSION_KEY, pendingUpdateVersion);
      syncUpdateSettings();
    }
    setUpdateStatusText("已忽略此版本", "muted");
    showUpdateButtons({ checkLabel: "检查更新" });
  });
})();

// ── Voice panel ──
initVoicePanel({
  btnId:      "voice-btn",
  panelId:    "voice-panel",
  canvasId:   "voice-canvas",
  statusId:   "voice-status",
  transcriptId: "voice-transcript",
  getChatInput:  () => document.getElementById("msg-input"),
  getSendBtn:    () => document.getElementById("send-btn"),
  getSendMessage: (options) => chat?.send?.(options),
  getLang:       () => localStorage.getItem("bailongma-voice-lang") || "zh-CN",
  getAutoSend:   () => localStorage.getItem("bailongma-voice-auto-send") !== "false",
  getAutoMic:    () => localStorage.getItem("bailongma-voice-auto-mic") === "true",
});

// ── Hotspot mode ──
initHotspot().catch((err) => console.warn('[Hotspot] init failed:', err));

// ── Media modes (video / image) ──
(function initMediaModes() {
  const hotspotBtn    = document.getElementById("hotspot-btn");
  const videoBtn      = document.getElementById("video-btn");
  const videoExitBtn  = document.getElementById("video-exit-btn");
  const videoFeed     = document.getElementById("video-feed");
  const videoFrame    = document.getElementById("video-frame");
  const videoSurface  = document.getElementById("video-surface");
  const videoBackdrop = document.getElementById("video-backdrop");
  const videoTitle    = document.getElementById("video-title");
  const videoUrlInput = document.getElementById("video-url-input");
  const videoOpenBtn  = document.getElementById("video-open-btn");
  const imageExitBtn  = document.getElementById("image-exit-btn");
  const imageDisplay  = document.getElementById("image-display");
  const imageSurface  = document.getElementById("image-surface");
  const imageTitle    = document.getElementById("image-title");

  let videoStream = null;
  let videoActive = false;
  let imageActive = false;
  let videoKind   = "empty";
  let mediaVoiceDuck = null;
  const VOICE_VIDEO_DUCK_KEY = "bailongma-voice-video-duck";
  const VOICE_VIDEO_PTT_KEY = "bailongma-voice-video-ptt";
  let currentVideoSource = "";
  let currentVideoStart = null;
  // wall-clock ms when current play started/resumed; used to estimate elapsed
  // for cross-origin iframes (bilibili) where we can't read currentTime.
  let playResumeAt = null;

  function normalizeUrl(url = "") {
    return String(url || "").trim();
  }

  function localPathToUrl(src) {
    const s = String(src || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(blob:|data:)/i.test(s)) return s;
    // Local path (file:// or absolute) → backend HTTP media endpoint to avoid file:// CORS restriction.
    let resolved = s;
    if (/^file:\/\//i.test(s)) {
      try { resolved = decodeURIComponent(new URL(s).pathname); }
      catch { resolved = decodeURIComponent(s.replace(/^file:\/\/\//i, "/").replace(/^file:\/\//i, "")); }
    }
    if (!/^\/|^[A-Za-z]:[\\/]/.test(resolved)) return s;
    return "/media/video?path=" + encodeURIComponent(resolved);
  }

  function extractYoutubeId(url) {
    return normalizeUrl(url).match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/
    )?.[1] || null;
  }

  function youtubeEmbedUrl(url, { autoplay = false, start = null } = {}) {
    const id = extractYoutubeId(url);
    if (!id) return null;
    const params = new URLSearchParams({
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      autoplay: autoplay ? "1" : "0",
    });
    if (Number.isFinite(Number(start))) params.set("start", String(Math.max(0, Math.round(Number(start)))));
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }

  function extractBilibiliId(url) {
    const raw = normalizeUrl(url);
    return raw.match(/\/video\/(BV[A-Za-z0-9]+)/i)?.[1]
        || raw.match(/\b(BV[A-Za-z0-9]+)\b/i)?.[1]
        || null;
  }

  function bilibiliEmbedUrl(url, { autoplay = false, start = null } = {}) {
    const bvid = extractBilibiliId(url);
    if (!bvid) return null;
    const params = new URLSearchParams({
      bvid,
      autoplay: autoplay ? "1" : "0",
      high_quality: "1",
    });
    if (Number.isFinite(Number(start))) params.set("t", String(Math.max(0, Math.round(Number(start)))));
    return `https://player.bilibili.com/player.html?${params.toString()}`;
  }

  function iframeUrlFor(url, options) {
    return youtubeEmbedUrl(url, options) || bilibiliEmbedUrl(url, options);
  }

  function saveMediaHistory({ url, title, kind, videoId = null, platform = null }) {
    fetch(`${API}/media/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title: title || "", kind, videoId, platform }),
    }).catch(() => {});
  }

  async function validateYoutubeUrl(url) {
    try {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return null; // network failure — don't block, allow playback to proceed
    }
  }

  function stopCamera() {
    videoStream?.getTracks().forEach(t => t.stop());
    videoStream = null;
  }

  function setPanelVisible(visible) {
    videoActive = Boolean(visible);
    document.body.classList.toggle("video-mode", videoActive);
    videoBtn?.classList.toggle("active", videoActive);
    hotspotBtn?.classList.toggle("active", document.body.classList.contains("hotspot-mode"));
    if (videoActive) moveVoicePanelToBody();
    else restoreVoicePanel();
    window.dispatchEvent(new CustomEvent("bailongma:video-mode", {
      detail: { active: videoActive, kind: videoKind },
    }));
  }

  function pauseCurrentVideo() {
    if (videoKind === "youtube") {
      postFrameCommand("pauseVideo");
      playResumeAt = null;
    } else if (videoKind === "bilibili") {
      // bilibili iframe 跨域读不到 currentTime，用 wall-clock 估算累计进度
      if (playResumeAt) {
        const elapsed = (Date.now() - playResumeAt) / 1000;
        currentVideoStart = (Number(currentVideoStart) || 0) + elapsed;
      }
      playResumeAt = null;
      reloadFrameAutoplay(false);
    } else if (videoKind === "file") {
      try { videoFeed?.pause?.(); } catch {}
      playResumeAt = null;
    }
  }

  function resumeCurrentVideo() {
    if (videoKind === "youtube") {
      postFrameCommand("playVideo");
      playResumeAt = Date.now();
    } else if (videoKind === "bilibili") {
      reloadFrameAutoplay(true);
      playResumeAt = Date.now();
    } else if (videoKind === "file") {
      videoFeed?.play?.().catch(() => {});
      playResumeAt = Date.now();
    }
  }

  function isVideoPlayableActive() {
    return videoActive && videoKind && videoKind !== "empty" && videoKind !== "camera";
  }

  function startMediaVoiceDuck({ holdMs = 1800, pause = false } = {}) {
    if (!isVideoPlayableActive()) return;
    if (localStorage.getItem(VOICE_VIDEO_DUCK_KEY) === "false" && !pause) return;
    const now = Date.now();
    const existing = mediaVoiceDuck;
    if (!existing) {
      mediaVoiceDuck = {
        startedAt: now,
        kind: videoKind,
        fileVolume: videoFeed ? videoFeed.volume : null,
        fileMuted: videoFeed ? videoFeed.muted : null,
        paused: false,
        timer: null,
      };
      if (videoKind === "file" && videoFeed) {
        videoFeed.dataset.voiceDuck = "1";
        videoFeed.volume = Math.min(videoFeed.volume || 1, 0.10);
        videoFeed.muted = false;
      } else if (videoKind === "youtube") {
        postFrameCommand("setVolume", [10]);
      } else if (videoKind === "bilibili") {
        pauseCurrentVideo();
        mediaVoiceDuck.paused = true;
      }
    }
    if (pause && mediaVoiceDuck && !mediaVoiceDuck.paused) {
      pauseCurrentVideo();
      mediaVoiceDuck.paused = true;
    }
    clearTimeout(mediaVoiceDuck.timer);
    mediaVoiceDuck.timer = setTimeout(() => restoreMediaVoiceDuck(), holdMs);
  }

  function restoreMediaVoiceDuck() {
    const duck = mediaVoiceDuck;
    if (!duck) return;
    clearTimeout(duck.timer);
    mediaVoiceDuck = null;
    if (!videoActive) return;
    if (duck.kind === "file" && videoFeed) {
      if (Number.isFinite(Number(duck.fileVolume))) videoFeed.volume = duck.fileVolume;
      videoFeed.muted = Boolean(duck.fileMuted);
      delete videoFeed.dataset.voiceDuck;
      if (duck.paused) videoFeed.play?.().catch(() => {});
    } else if (duck.kind === "youtube") {
      postFrameCommand("setVolume", [100]);
      if (duck.paused) resumeCurrentVideo();
    } else if (duck.kind === "bilibili") {
      if (duck.paused) resumeCurrentVideo();
    }
  }

  function pauseForAssistantVoice() {
    if (!isVideoPlayableActive()) return;
    startMediaVoiceDuck({ holdMs: 12000, pause: true });
  }

  function resetVideoSurface() {
    restoreMediaVoiceDuck();
    stopCamera();
    if (videoFeed) {
      try { videoFeed.pause(); } catch {}
      videoFeed.removeAttribute("src");
      videoFeed.srcObject = null;
      videoFeed.hidden = true;
      videoFeed.load?.();
    }
    if (videoFrame) {
      videoFrame.src = "about:blank";
      videoFrame.hidden = true;
    }
    if (videoBackdrop) videoBackdrop.style.backgroundImage = "";
    videoSurface?.classList.remove("has-media");
    videoKind = "empty";
    currentVideoSource = "";
    currentVideoStart = null;
    playResumeAt = null;
  }

  function toggleVideoPanelVisibility() {
    if (videoActive) {
      pauseCurrentVideo();
      setPanelVisible(false);
    } else {
      if (musicActive) closeMusicPanel();
      setPanelVisible(true);
      if (videoKind !== "empty") resumeCurrentVideo();
    }
  }

  function closeAndDestroyVideo() {
    setPanelVisible(false);
    resetVideoSurface();
  }

  function setVideoModeActive(active) {
    if (!active) {
      closeAndDestroyVideo();
    } else {
      setPanelVisible(true);
    }
  }

  function setBackdrop(kind, url) {
    if (!videoBackdrop) return;
    if (kind === "youtube") {
      const id = extractYoutubeId(url);
      if (id) {
        videoBackdrop.style.backgroundImage =
          `url(https://img.youtube.com/vi/${id}/maxresdefault.jpg)`;
        return;
      }
    }
    // Bilibili / file / camera: solid color fallback (CSS already sets #000 background)
    videoBackdrop.style.backgroundImage = "";
  }

  async function showCamera({ title = "Camera", autoplay = true } = {}) {
    setPanelVisible(true);
    resetVideoSurface();
    if (videoTitle) videoTitle.textContent = title;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoFeed) {
        videoFeed.hidden = false;
        videoFeed.muted = true;
        videoFeed.srcObject = videoStream;
        if (autoplay) videoFeed.play?.().catch(() => {});
      }
      videoSurface?.classList.add("has-media");
      videoKind = "camera";
    } catch (e) {
      console.warn("Camera access failed:", e);
    }
  }

  async function showVideo({
    url = "", title = "Video", autoplay = true,
    muted = false, volume = null, currentTime = null, camera = false,
  } = {}) {
    if (camera) { showCamera({ title, autoplay }); return; }

    const rawSource = normalizeUrl(url);
    const source = localPathToUrl(rawSource);
    if (musicActive) closeMusicPanel();
    setPanelVisible(true);
    resetVideoSurface();
    currentVideoSource = rawSource || source;
    currentVideoStart = Number.isFinite(Number(currentTime)) ? Math.max(0, Number(currentTime)) : null;
    if (videoTitle) videoTitle.textContent = title || "Video";

    const embedUrl = iframeUrlFor(source, { autoplay, start: currentTime });
    if (embedUrl && videoFrame) {
      videoFrame.hidden = false;
      videoFrame.src = embedUrl;
      videoSurface?.classList.add("has-media");
      videoKind = embedUrl.includes("youtube.com") ? "youtube" : "bilibili";
      if (autoplay) playResumeAt = Date.now();

      setBackdrop(videoKind, source);
      saveMediaHistory({
        url: source,
        title,
        kind: videoKind,
        videoId: videoKind === "youtube" ? extractYoutubeId(source) : extractBilibiliId(source),
        platform: videoKind,
      });

      if (videoKind === "youtube") {
        validateYoutubeUrl(source).then(ok => {
          if (ok === false) console.warn("[Media] YouTube video may not play (region block / private / deleted):", source);
        });
      }
      return;
    }

    if (videoFeed && source) {
      videoFeed.hidden = false;
      videoFeed.src = source;
      videoFeed.muted = Boolean(muted);
      if (Number.isFinite(Number(volume))) videoFeed.volume = Math.max(0, Math.min(1, Number(volume)));
      if (Number.isFinite(Number(currentTime))) videoFeed.currentTime = Math.max(0, Number(currentTime));
      videoSurface?.classList.add("has-media");
      videoKind = "file";
      saveMediaHistory({ url: rawSource || source, title, kind: "file" });
      if (autoplay) {
        videoFeed.play?.().catch(() => {});
        playResumeAt = Date.now();
      }
    }
  }

  function postFrameCommand(command, args = []) {
    if (!videoFrame?.contentWindow || videoFrame.hidden) return;
    if (videoKind === "youtube") {
      videoFrame.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func: command,
        args,
      }), "*");
    }
  }

  function reloadFrameAutoplay(autoplay) {
    if (!videoFrame || videoFrame.hidden || !currentVideoSource) return;
    const nextUrl = iframeUrlFor(currentVideoSource, {
      autoplay,
      start: currentVideoStart,
    });
    if (nextUrl) videoFrame.src = nextUrl;
  }

  function controlVideo({ action, volume, currentTime, autoplay } = {}) {
    const op = action || (autoplay ? "play" : null);
    if (op === "hide" || op === "close") { closeAndDestroyVideo(); return; }
    if (op === "play") resumeCurrentVideo();
    if (op === "pause") pauseCurrentVideo();
    if (Number.isFinite(Number(volume))) {
      const v = Math.max(0, Math.min(1, Number(volume)));
      if (videoFeed) { videoFeed.volume = v; videoFeed.muted = v === 0; }
      postFrameCommand("setVolume", [Math.round(v * 100)]);
    }
    if (Number.isFinite(Number(currentTime))) {
      const t = Math.max(0, Number(currentTime));
      currentVideoStart = t;
      if (videoFeed) videoFeed.currentTime = t;
      postFrameCommand("seekTo", [t, true]);
      // seek 后重置 elapsed 基线，下次 pause 时累计才正确
      if (playResumeAt) playResumeAt = Date.now();
    }
  }

  function setImageModeActive(active) {
    imageActive = Boolean(active);
    document.body.classList.toggle("image-mode", imageActive);
    if (!imageActive && imageDisplay) {
      imageDisplay.removeAttribute("src");
      imageDisplay.alt = "";
      imageSurface?.classList.remove("has-media");
    }
  }

  function showImage({ url = "", title = "Image", alt = "" } = {}) {
    const source = normalizeUrl(url);
    setImageModeActive(true);
    if (imageTitle) imageTitle.textContent = title || "Image";
    if (imageDisplay && source) {
      imageDisplay.src = source;
      imageDisplay.alt = alt || title || "";
      imageSurface?.classList.add("has-media");
    }
  }

  function handleMediaCommand(payload = {}) {
    const mode   = payload.mode || payload.kind;
    const action = payload.action || "show";
    if (mode === "image") {
      if (action === "hide" || action === "close") setImageModeActive(false);
      else showImage(payload);
      return { ok: true, mode: "image", action };
    }
    if (mode === "camera") {
      if (action === "hide" || action === "close") closeAndDestroyVideo();
      else showCamera(payload);
      return { ok: true, mode: "camera", action };
    }
    if (mode === "video") {
      if (action === "show" || payload.url || payload.camera) showVideo(payload);
      else controlVideo(payload);
      return { ok: true, mode: "video", action };
    }
    if (mode === "music") {
      if (action === "show" || payload.src || payload.playlist) showMusic(payload);
      else controlMusic(payload);
      return { ok: true, mode: "music", action };
    }
    return { ok: false, error: "unknown media mode" };
  }

  // ── Music mode ────────────────────────────────────────────────────────────
  const musicBtn       = document.getElementById("music-btn");
  const musicExitBtn   = document.getElementById("music-exit-btn");
  const musicAudio     = document.getElementById("music-audio");
  const musicPlayBtn   = document.getElementById("music-play");
  const musicPrevBtn   = document.getElementById("music-prev");
  const musicNextBtn   = document.getElementById("music-next");
  const musicSeek      = document.getElementById("music-seek");
  const musicVolInput  = document.getElementById("music-vol");
  const musicTimeCur   = document.getElementById("music-time-cur");
  const musicTimeTotal = document.getElementById("music-time-total");
  const musicMetaTitle  = document.getElementById("music-meta-title");
  const musicMetaArtist = document.getElementById("music-meta-artist");
  const musicCoverEl    = document.getElementById("music-cover");
  const musicCoverTitle = document.getElementById("music-cover-title");
  const musicCoverArtist = document.getElementById("music-cover-artist");
  const musicLyricsScroll = document.getElementById("music-lyrics-scroll");
  const musicNoLyrics     = document.getElementById("music-no-lyrics");

  let musicActive  = false;
  let musicPlaying = false;
  let musicWasPlayingBeforeHide = false;
  let lrcLines     = [];
  let playlist     = [];
  let playlistIdx  = 0;
  let isSeeking    = false;

  function parseLrc(text) {
    const lines = [];
    const re = /\[(\d+):(\d{1,2}(?:\.\d+)?)\](.*)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
      const txt = m[3].trim();
      if (txt) lines.push({ time: t, text: txt });
    }
    return lines.sort((a, b) => a.time - b.time);
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  function setMusicPanelVisible(visible) {
    musicActive = Boolean(visible);
    document.body.classList.toggle("music-mode", musicActive);
    musicBtn?.classList.toggle("active", musicActive);
    window.dispatchEvent(new CustomEvent("bailongma:music-mode", {
      detail: { active: musicActive },
    }));
  }

  function setMusicPlaying(playing) {
    musicPlaying = Boolean(playing);
    document.body.classList.toggle("music-playing", musicPlaying);
    if (musicPlayBtn) musicPlayBtn.textContent = musicPlaying ? "⏸" : "▶";
    if (musicPlaying) {
      musicAudio?.play?.().catch(() => {});
    } else {
      musicAudio?.pause?.();
    }
  }

  function loadLrc(lrcText) {
    lrcLines = lrcText ? parseLrc(lrcText) : [];
    if (musicLyricsScroll) {
      musicLyricsScroll.innerHTML = lrcLines
        .map((l, i) => `<div class="lrc-line" data-idx="${i}">${l.text}</div>`)
        .join("");
    }
    if (musicNoLyrics) musicNoLyrics.hidden = lrcLines.length > 0;
  }

  function syncLyrics(currentTime) {
    if (!lrcLines.length || !musicLyricsScroll) return;
    let active = -1;
    for (let i = 0; i < lrcLines.length; i++) {
      if (lrcLines[i].time <= currentTime + 0.3) active = i;
      else break;
    }
    if (active < 0) return;
    const lines = musicLyricsScroll.querySelectorAll(".lrc-line");
    lines.forEach((el, i) => el.classList.toggle("active", i === active));
    const activeLine = lines[active];
    if (activeLine) {
      const pane = document.getElementById("music-lyrics-pane");
      if (pane) pane.scrollTo({ top: activeLine.offsetTop - pane.clientHeight / 2 + activeLine.clientHeight / 2, behavior: "smooth" });
    }
  }

  function loadTrack(index, autoplay = true) {
    const track = playlist[index];
    if (!track || !musicAudio) return;

    musicAudio.src = localPathToUrl(track.src || "");
    musicAudio.volume = parseFloat(musicVolInput?.value ?? "0.8");

    const title  = track.title  || "未知曲目";
    const artist = track.artist || "";
    if (musicMetaTitle)  musicMetaTitle.textContent  = title;
    if (musicMetaArtist) musicMetaArtist.textContent = artist;
    if (musicCoverTitle)  musicCoverTitle.textContent  = title.slice(0, 14);
    if (musicCoverArtist) musicCoverArtist.textContent = artist;
    if (musicTimeCur)   musicTimeCur.textContent   = "0:00";
    if (musicTimeTotal) musicTimeTotal.textContent = "0:00";
    if (musicSeek)      { musicSeek.value = "0"; musicSeek.max = "100"; }

    if (track.cover && musicCoverEl) {
      musicCoverEl.style.backgroundImage = `url(${track.cover})`;
      musicCoverEl.style.background = "";
    } else if (musicCoverEl) {
      musicCoverEl.style.backgroundImage = "";
      let hash = 0;
      for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
      const hue = Math.abs(hash) % 360;
      musicCoverEl.style.background = `hsl(${hue}, 45%, 32%)`;
    }

    loadLrc(track.lrc || "");
    if (autoplay) setMusicPlaying(true);
  }

  function showMusic({
    src = "", title = "", artist = "", lrc = "", cover = "",
    autoplay = true, playlist: pl = null,
  } = {}) {
    if (videoActive) closeAndDestroyVideo();
    setMusicPanelVisible(true);
    if (pl && pl.length) {
      playlist = pl;
    } else {
      playlist = [{ src, title, artist, lrc, cover }];
    }
    playlistIdx = 0;
    loadTrack(0, autoplay);
  }

  function closeMusicPanel() {
    setMusicPlaying(false);
    setMusicPanelVisible(false);
    if (musicAudio) musicAudio.src = "";
    lrcLines = [];
    if (musicLyricsScroll) musicLyricsScroll.innerHTML = "";
    if (musicNoLyrics) musicNoLyrics.hidden = false;
  }

  function controlMusic({ action, volume, currentTime } = {}) {
    if (action === "hide" || action === "close") { closeMusicPanel(); return; }
    if (action === "play")  setMusicPlaying(true);
    if (action === "pause") setMusicPlaying(false);
    if (Number.isFinite(Number(volume))) {
      const v = Math.max(0, Math.min(1, Number(volume)));
      if (musicAudio) musicAudio.volume = v;
      if (musicVolInput) musicVolInput.value = String(v);
    }
    if (Number.isFinite(Number(currentTime)) && musicAudio) {
      musicAudio.currentTime = Math.max(0, Number(currentTime));
    }
  }

  function toggleMusicPanelVisibility() {
    if (musicActive) {
      musicWasPlayingBeforeHide = musicPlaying;
      setMusicPlaying(false);
      setMusicPanelVisible(false);
    } else if (musicAudio?.src) {
      if (videoActive) closeAndDestroyVideo();
      setMusicPanelVisible(true);
      if (musicWasPlayingBeforeHide) setMusicPlaying(true);
    }
  }

  if (musicAudio) {
    musicAudio.addEventListener("loadedmetadata", () => {
      if (musicTimeTotal) musicTimeTotal.textContent = fmtTime(musicAudio.duration);
      if (musicSeek) musicSeek.max = String(musicAudio.duration || 100);
    });
    musicAudio.addEventListener("timeupdate", () => {
      if (isSeeking) return;
      const t = musicAudio.currentTime;
      if (musicTimeCur) musicTimeCur.textContent = fmtTime(t);
      if (musicSeek && musicAudio.duration) musicSeek.value = String(t);
      syncLyrics(t);
    });
    musicAudio.addEventListener("ended", () => {
      setMusicPlaying(false);
      if (playlistIdx < playlist.length - 1) {
        playlistIdx++;
        loadTrack(playlistIdx, true);
      }
    });
  }

  musicPlayBtn?.addEventListener("click", () => setMusicPlaying(!musicPlaying));
  musicPrevBtn?.addEventListener("click", () => {
    if (playlistIdx > 0) { playlistIdx--; loadTrack(playlistIdx, musicPlaying); }
    else if (musicAudio) musicAudio.currentTime = 0;
  });
  musicNextBtn?.addEventListener("click", () => {
    if (playlistIdx < playlist.length - 1) { playlistIdx++; loadTrack(playlistIdx, musicPlaying); }
  });
  musicVolInput?.addEventListener("input", () => {
    if (musicAudio) musicAudio.volume = parseFloat(musicVolInput.value);
  });
  musicSeek?.addEventListener("mousedown", () => { isSeeking = true; });
  musicSeek?.addEventListener("input", () => {
    if (musicTimeCur) musicTimeCur.textContent = fmtTime(parseFloat(musicSeek.value));
  });
  musicSeek?.addEventListener("change", () => {
    if (musicAudio) musicAudio.currentTime = parseFloat(musicSeek.value);
    isSeeking = false;
  });
  musicExitBtn?.addEventListener("click", closeMusicPanel);
  musicBtn?.addEventListener("click", toggleMusicPanelVisibility);

  window.addEventListener("keydown", (e) => {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA" || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      toggleMusicPanelVisibility();
    }
  });

  window.bailongmaMedia = { handle: handleMediaCommand, showVideo, controlVideo, showImage, showCamera, showMusic, controlMusic, startMediaVoiceDuck, restoreMediaVoiceDuck, pauseForAssistantVoice };
  window.addEventListener("bailongma:media", (event) => handleMediaCommand(event.detail || {}));
  window.addEventListener("bailongma:voice-activity", () => startMediaVoiceDuck({ holdMs: 1800, pause: false }));
  window.addEventListener("bailongma:assistant-wake", () => pauseForAssistantVoice());

  // Push-to-talk：按住空格说话；Agent 正在说话时按下空格直接打断
  (() => {
    let pttHeld = false;
    const isSpace = (e) => e.code === "Space" || e.key === " " || e.key === "Spacebar";
    const isTypingTarget = (t) =>
      !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    window.addEventListener("keydown", (e) => {
      if (!isSpace(e)) return;
      if (videoActive && localStorage.getItem(VOICE_VIDEO_PTT_KEY) === "false") return;
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (e.repeat) return;
      if (pttHeld) return;
      pttHeld = true;
      // 不论是否在播，stopTTS 内部已做 no-op 守卫；视频中 PTT 先暂停/压低视频，避免盖住人声。
      try { window.stopTTS?.(); } catch {}
      if (videoActive) startMediaVoiceDuck({ holdMs: 30000, pause: true });
      window.bailongmaVoice?.pttStart?.();
    }, { capture: true });

    window.addEventListener("keyup", (e) => {
      if (!isSpace(e)) return;
      if (!pttHeld) return;
      pttHeld = false;
      e.preventDefault();
      window.bailongmaVoice?.pttEnd?.();
      if (videoActive) setTimeout(() => restoreMediaVoiceDuck(), 500);
    }, { capture: true });

    // 切到后台时如果还按着，强制释放，避免 mic 永远不关
    window.addEventListener("blur", () => {
      if (!pttHeld) return;
      pttHeld = false;
      window.bailongmaVoice?.pttEnd?.();
      if (videoActive) restoreMediaVoiceDuck();
    });
  })();

  hotspotBtn?.addEventListener("click", () => {
    toggleHotspot('manual_button');
    hotspotBtn.classList.toggle("active", document.body.classList.contains("hotspot-mode"));
  });
  videoBtn?.addEventListener("click", toggleVideoPanelVisibility);
  videoExitBtn?.addEventListener("click", closeAndDestroyVideo);
  imageExitBtn?.addEventListener("click", () => setImageModeActive(false));
  videoOpenBtn?.addEventListener("click", () => {
    const url = videoUrlInput?.value?.trim();
    if (!url) return;
    showVideo({ url, title: "视频", autoplay: true });
  });
  videoUrlInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const url = videoUrlInput.value.trim();
    if (!url) return;
    showVideo({ url, title: "视频", autoplay: true });
  });

  window.addEventListener("keydown", (e) => {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA" || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      toggleVideoPanelVisibility();
    }
    // H key: toggle hotspot mode
    if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      toggleHotspot();
    }
  });
})();
