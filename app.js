function safeParseJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function sanitizeChannelItem(item, fallbackIdx) {
  if (!item || typeof item !== 'object') return null;
  const defMatch = defaultChannels.find(d => d.id === item.id);
  const name = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : (defMatch ? defMatch.name : `電台 ${fallbackIdx + 1}`);
  const sub = (typeof item.sub === 'string' && item.sub.trim()) ? item.sub.trim() : (defMatch ? defMatch.sub : '網路電台');
  let url = (typeof item.url === 'string' && item.url.trim()) ? item.url.trim() : (defMatch ? defMatch.url : '');
  if (!url) return null;
  if (item.id === 'ch11' && url.includes('78898857a0uv')) {
    url = IC_VOICE_REVMA_URL;
  }
  const fav = typeof item.fav === 'boolean' ? item.fav : (defMatch ? !!defMatch.fav : false);
  const id = (typeof item.id === 'string' && item.id) ? item.id : `ch_fix_${fallbackIdx}_${Date.now()}`;
  return { id, name, sub, url, fav };
}

function loadChannelsData() {
  const savedCustomList = safeParseJSON('waltonCustomChannelsList', null);
  if (Array.isArray(savedCustomList) && savedCustomList.length > 0) {
    const cleaned = savedCustomList.map((item, idx) => sanitizeChannelItem(item, idx)).filter(Boolean);
    if (cleaned.length > 0) {
      localStorage.setItem('waltonCustomChannelsList', JSON.stringify(cleaned));
      return cleaned;
    }
  }
  const savedOrder = safeParseJSON('customChannelOrderIds', null);
  if (!Array.isArray(savedOrder)) return JSON.parse(JSON.stringify(defaultChannels));
  const ordered = [];
  savedOrder.forEach(id => {
    const found = defaultChannels.find(c => c.id === id);
    if (found) ordered.push({ ...found });
  });
  defaultChannels.forEach(c => {
    if (!ordered.some(o => o.id === c.id)) ordered.push({ ...c });
  });
  return ordered;
}

let channels = loadChannelsData();
let trashChannels = (safeParseJSON('waltonTrashChannelsList', []) || [])
  .map((item, idx) => sanitizeChannelItem(item, idx))
  .filter(Boolean);

let draftChannels = [];
let draftTrashChannels = [];
let draftPreampMap = {};
let initialSnapshotStr = '';
let editingChannelId = null;

function saveChannelsData() {
  localStorage.setItem('waltonCustomChannelsList', JSON.stringify(channels));
  localStorage.setItem('customChannelOrderIds', JSON.stringify(channels.map(c => c.id)));
  localStorage.setItem('waltonTrashChannelsList', JSON.stringify(trashChannels));
}

function forceReloadPage() {
  stopAllPlayersImmediately();
  const baseUrl = window.location.href.split('?')[0].split('#')[0];
  window.location.replace(`${baseUrl}?v=${Date.now()}`);
}

function openFactoryResetConfirm() {
  document.getElementById('factoryResetConfirmModal').classList.add('show');
}

function closeFactoryResetConfirm() {
  document.getElementById('factoryResetConfirmModal').classList.remove('show');
}

function executeFactoryReset() {
  stopAllPlayersImmediately();
  const keysToRemove = [
    'waltonCustomChannelsList', 'customChannelOrderIds', 'waltonTrashChannelsList',
    'customRadioEQ10Presets_v2', 'perChannelPreampMap', 'lastRadioChannelId',
    'lastRadioEQ', 'waltonSilentConfig', 'waltonThemeMode', 'waltonReconnectSec',
    'waltonGridCols', 'waltonDriveMode', 'waltonFavOnlyScan', 'waltonEqHeightMode'
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));
  forceReloadPage();
}

const eqBands = [
  { label: '31.25', freq: 31.25, type: 'lowshelf' },
  { label: '62.5',  freq: 62.5,  type: 'peaking' },
  { label: '125',   freq: 125,   type: 'peaking' },
  { label: '250',   freq: 250,   type: 'peaking' },
  { label: '500',   freq: 500,   type: 'peaking' },
  { label: '1K',    freq: 1000,  type: 'peaking' },
  { label: '2K',    freq: 2000,  type: 'peaking' },
  { label: '4K',    freq: 4000,  type: 'peaking' },
  { label: '8K',    freq: 8000,  type: 'peaking' },
  { label: '16K',   freq: 16000, type: 'highshelf' }
];

const defaultPresets = {
  flat:      { label: '原音',   gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  voice:     { label: '人聲',   gains: [-5, -4, -4, -3, 2, 5, 5, 4, 1, -2] },
  bass:      { label: '重低音', gains: [0, 4, 9, 8, 0, 0, 4, 7, 4, 0] },
  classical: { label: '古典',   gains: [4, 3, 2, 0, -1, 0, 2, 4, 5, 4] },
  custom:    { label: '自訂',   gains: [0, 2, 4, 2, 0, 2, 4, 3, 2, 0] }
};

let eqPresets = safeParseJSON('customRadioEQ10Presets_v2', null) || JSON.parse(JSON.stringify(defaultPresets));
if (!eqPresets || typeof eqPresets !== 'object') eqPresets = JSON.parse(JSON.stringify(defaultPresets));
if (!eqPresets.custom) eqPresets.custom = JSON.parse(JSON.stringify(defaultPresets.custom));
let perChannelPreamp = safeParseJSON('perChannelPreampMap', {}) || {};

const validSilentDelays = [0, 10, 20, 30, 60, 120];
const defaultSilentConfig = {
  delaySec: 20,
  ratio: 'third',
  layout: 'center',
  showStation: true,
  showClock: true,
  showMeta: true,
  showViz: true,
  showSleep: true,
  showBtns: false
};
let silentConfig = Object.assign({}, defaultSilentConfig, safeParseJSON('waltonSilentConfig', {}));
if (!validSilentDelays.includes(silentConfig.delaySec)) {
  silentConfig.delaySec = 20;
  localStorage.setItem('waltonSilentConfig', JSON.stringify(silentConfig));
}

let silentIdleTimer = null;
let silentClockTimer = null;
let silentDriftTimer = null;
let isSilentModeActive = false;

let themeMode = localStorage.getItem('waltonThemeMode') || 'night';
const reconnectOptions = [4.5, 8, 16, 25];
let reconnectDelaySec = parseFloat(localStorage.getItem('waltonReconnectSec')) || 16;
if (!reconnectOptions.includes(reconnectDelaySec)) {
  reconnectDelaySec = 16;
  localStorage.setItem('waltonReconnectSec', reconnectDelaySec);
}

const eqHeightModes = ['normal', 'tall', 'compact'];
let eqHeightMode = localStorage.getItem('waltonEqHeightMode') || 'normal';
if (!eqHeightModes.includes(eqHeightMode)) eqHeightMode = 'normal';

// 預設開啟螢幕常亮（首次點擊螢幕手勢後自動申請系統 Wake Lock）
let wakeLockEnabled = true;
let wakeLockSentinel = null;
let gridCols = parseInt(localStorage.getItem('waltonGridCols'), 10) === 3 ? 3 : 2;
let isAttMuted = false;
let isDriveMode = false;
let favOnlyScan = localStorage.getItem('waltonFavOnlyScan') === 'true';

const sleepTimerOptions = [0, 10, 15, 30, 45, 60, 90];
let sleepTimerMinutes = 0;
let sleepEndTimestamp = 0;
let sleepCheckInterval = null;
let isSleepFadingOut = false;

const playerEQ = document.getElementById('playerEQ');
const playerDirect = document.getElementById('playerDirect');
let activePlayer = playerDirect;
let isDirectMode = true;
let isAwaitingFirstTap = true;
let isStreamConfirmedPlaying = false;
let hlsInstance = null;
let switchToken = 0;

let stallWatchdogTimer = null;
let reconnectRetryCount = 0;

const statusMain = document.getElementById('statusMain');
const statusSub = document.getElementById('statusSub');
const masterStopBtn = document.getElementById('masterStopBtn');
const container = document.getElementById('btnContainer');
const eqContainer = document.getElementById('graphicEqContainer');

let currentChannelId = localStorage.getItem('lastRadioChannelId') || channels[0].id;
let currentIndex = Math.max(0, channels.findIndex(c => c.id === currentChannelId));
let currentEQ = localStorage.getItem('lastRadioEQ') || 'flat';
let currentPlayState = 'idle';

let audioCtx = null;
let preampNode = null;
let fadeGainNode = null;
let filterNodes = [];
let limiterNode = null;
let analyserNode = null;
let analyserData = null;
let vizAnimFrame = null;
let directFadeTimer = null;

const FADE_DURATION = 0.3;
const SLEEP_FADE_DURATION = 5.0;

let longPressTimer = null;
let isDraggingMode = false;
let draggedChannelId = null;
let dropTargetChannelId = null;
let startX = 0;
let startY = 0;

// ==================== EQ 推桿三段高度動態調整 ====================
function applyEqHeightMode() {
  document.body.classList.remove('eq-h-compact', 'eq-h-normal', 'eq-h-tall');
  document.body.classList.add(`eq-h-${eqHeightMode}`);
  const btn = document.getElementById('eqHeightBtn');
  if (!btn) return;
  if (eqHeightMode === 'tall') {
    btn.innerText = '↕️ 推桿:加高';
    btn.classList.add('on');
  } else if (eqHeightMode === 'compact') {
    btn.innerText = '↕️ 推桿:矮版';
    btn.classList.add('on');
  } else {
    btn.innerText = '↕️ 推桿:標準';
    btn.classList.remove('on');
  }
}

function cycleEqHeight() {
  eqHeightMode = eqHeightModes[(eqHeightModes.indexOf(eqHeightMode) + 1) % eqHeightModes.length];
  localStorage.setItem('waltonEqHeightMode', eqHeightMode);
  applyEqHeightMode();
}

// ==================== 串流成功驗證與靜默模式核心控制 ====================
function isAudioActuallyStreaming() {
  if (currentPlayState !== 'playing' || !isStreamConfirmedPlaying) return false;
  if (!activePlayer || activePlayer.paused || activePlayer.ended) return false;
  if (activePlayer.readyState < 2 || activePlayer.currentTime <= 0) return false;
  return true;
}

function resetSilentIdleTimer() {
  clearTimeout(silentIdleTimer);
  if (isSilentModeActive) return;
  if (!silentConfig.delaySec || silentConfig.delaySec <= 0) return;
  if (!isAudioActuallyStreaming()) return;
  if (document.getElementById('channelModal').classList.contains('show') ||
      document.getElementById('silentModal').classList.contains('show')) {
    return;
  }

  silentIdleTimer = setTimeout(() => {
    if (isAudioActuallyStreaming()) {
      enterSilentMode();
    }
  }, silentConfig.delaySec * 1000);
}

function enterSilentMode(forcePreview = false) {
  if (isSilentModeActive) return;
  if (!forcePreview && !isAudioActuallyStreaming()) return;

  isSilentModeActive = true;
  clearTimeout(silentIdleTimer);

  const overlay = document.getElementById('silentOverlay');
  overlay.classList.remove('ratio-half', 'ratio-full');
  if (silentConfig.ratio === 'half') overlay.classList.add('ratio-half');
  if (silentConfig.ratio === 'full') overlay.classList.add('ratio-full');

  const infoZone = document.getElementById('silentInfoZone');
  if (infoZone) infoZone.style.transform = 'translateY(0px)';

  renderSilentContent();
  overlay.classList.add('visible');
  requestAnimationFrame(() => overlay.classList.add('fade-in'));

  clearInterval(silentClockTimer);
  silentClockTimer = setInterval(renderSilentContent, 15000);

  clearInterval(silentDriftTimer);
  silentDriftTimer = setInterval(() => {
    if (silentConfig.layout === 'drift') {
      const inner = document.getElementById('silentInnerContent');
      if (inner) {
        const rx = Math.round((Math.random() - 0.5) * 10);
        const ry = Math.round((Math.random() - 0.5) * 8);
        inner.style.transform = `translate(${rx}px, ${ry}px)`;
      }
    }
  }, 45000);
}

function exitSilentMode() {
  if (!isSilentModeActive) return;
  isSilentModeActive = false;
  clearInterval(silentClockTimer);
  clearInterval(silentDriftTimer);

  const overlay = document.getElementById('silentOverlay');
  overlay.classList.remove('fade-in');
  setTimeout(() => {
    if (!isSilentModeActive) {
      overlay.classList.remove('visible');
      const inner = document.getElementById('silentInnerContent');
      const infoZone = document.getElementById('silentInfoZone');
      if (inner) inner.style.transform = 'translate(0, 0)';
      if (infoZone) infoZone.style.transform = 'translateY(0px)';
    }
  }, 300);

  resetSilentIdleTimer();
}

function renderSilentContent() {
  const inner = document.getElementById('silentInnerContent');
  if (!inner) return;

  const ch = channels[currentIndex] || { name: 'walton電台', sub: '' };
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const eqLabel = isDirectMode ? '直通原音' : `EQ:${eqPresets[currentEQ]?.label || '原音'}`;
  const metaStr = `${ch.sub} • ${eqLabel}${isAttMuted ? ' • 降音中' : ''}`;
  const sleepMins = getRemainingSleepMinutes();
  const sleepHtml = (silentConfig.showSleep && sleepTimerMinutes > 0)
    ? `<div class="silent-sleep-tag">⏰ 睡眠定時剩餘 ${sleepMins} 分鐘</div>`
    : '';

  const vizHtml = silentConfig.showViz
    ? `<div class="silent-viz-bars">
         <div class="silent-viz-bar" id="svbar0"></div>
         <div class="silent-viz-bar" id="svbar1"></div>
         <div class="silent-viz-bar" id="svbar2"></div>
         <div class="silent-viz-bar" id="svbar3"></div>
         <div class="silent-viz-bar" id="svbar4"></div>
       </div>`
    : '';

  const btnsHtml = silentConfig.showBtns
    ? `<div class="silent-quick-btns">
         <button class="silent-dim-btn" onclick="event.stopPropagation(); toggleAttMute(); renderSilentContent();">${isAttMuted ? '🔇 恢復音量' : '🔉 降音'}</button>
         <button class="silent-dim-btn" onclick="event.stopPropagation(); exitSilentMode(); toggleMasterPlay();">⏸ 暫停</button>
       </div>`
    : '';

  inner.className = 'silent-inner-content ' + (silentConfig.layout === 'hud' ? 'layout-hud' : 'layout-center');

  if (silentConfig.layout === 'hud') {
    inner.innerHTML = `
      <div class="silent-hud-left">
        ${silentConfig.showClock ? `<div class="silent-clock">${timeStr}</div>` : ''}
        ${sleepHtml}
      </div>
      <div class="silent-hud-right">
        ${silentConfig.showStation ? `<div class="silent-station-row">${vizHtml}<div class="silent-station">${escapeHtml(ch.name)}</div></div>` : vizHtml}
        ${silentConfig.showMeta ? `<div class="silent-meta">${escapeHtml(metaStr)}</div>` : ''}
        ${btnsHtml}
      </div>
    `;
  } else {
    inner.innerHTML = `
      ${silentConfig.showClock ? `<div class="silent-clock">${timeStr}</div>` : ''}
      ${silentConfig.showStation ? `<div class="silent-station-row"><div class="silent-station">${escapeHtml(ch.name)}</div>${vizHtml}</div>` : vizHtml}
      ${silentConfig.showMeta ? `<div class="silent-meta">${escapeHtml(metaStr)}</div>` : ''}
      ${sleepHtml}
      ${btnsHtml}
    `;
  }
}

// 靜默模式防誤觸手勢：單點觸屏忽略、上滑（Swipe Up）解鎖、左右滑切台
const silentOverlayEl = document.getElementById('silentOverlay');
let silentTouchStartX = 0;
let silentTouchStartY = 0;
let silentTracking = false;

silentOverlayEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  silentTouchStartX = e.clientX;
  silentTouchStartY = e.clientY;
  silentTracking = true;
}, { passive: true });

silentOverlayEl.addEventListener('pointermove', (e) => {
  if (!isSilentModeActive || !silentTracking) return;
  const dy = e.clientY - silentTouchStartY;
  const infoZone = document.getElementById('silentInfoZone');
  const wakeHint = document.getElementById('silentWakeHint');
  // 手指往上拖曳時給予即時微幅跟手回饋
  if (dy < 0) {
    const lift = Math.max(-42, dy * 0.45);
    if (infoZone) infoZone.style.transform = `translateY(${lift}px)`;
    if (wakeHint) {
      wakeHint.style.color = dy < -60 ? '#8FA8B8' : '#4A545C';
      wakeHint.innerText = dy < -60 ? '⌃ 放開立即解鎖' : '⌃ 上滑解鎖 • 左右滑動切台';
    }
  }
}, { passive: true });

const handleSilentPointerEnd = (e) => {
  if (!isSilentModeActive || !silentTracking) return;
  silentTracking = false;

  const infoZone = document.getElementById('silentInfoZone');
  const wakeHint = document.getElementById('silentWakeHint');
  if (infoZone) infoZone.style.transform = 'translateY(0px)';
  if (wakeHint) {
    wakeHint.style.color = '#2B3136';
    wakeHint.innerText = '⌃ 上滑解鎖 • 左右滑動切台';
  }

  if (e.target.closest('button')) return;

  const dx = e.clientX - silentTouchStartX;
  const dy = e.clientY - silentTouchStartY;

  // 1. 往上滑動超過 60px 且垂直位移大於水平位移 1.4 倍 -> 解鎖喚醒
  if (dy < -60 && Math.abs(dy) > Math.abs(dx) * 1.4) {
    if (navigator.vibrate) navigator.vibrate(25);
    e.preventDefault();
    e.stopPropagation();
    exitSilentMode();
    return;
  }

  // 2. 左右滑動超過 65px -> 靜默盲操切上一台 / 下一台
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (navigator.vibrate) navigator.vibrate(25);
    if (dx < 0) stepChannelByScanRule(1);
    else stepChannelByScanRule(-1);
    setTimeout(renderSilentContent, 100);
    return;
  }

  // 3. 單點觸屏或小幅度誤碰 -> 完全忽略不做反應（並阻斷穿透誤觸背後按鈕）
  e.preventDefault();
  e.stopPropagation();
};

silentOverlayEl.addEventListener('pointerup', handleSilentPointerEnd);
silentOverlayEl.addEventListener('pointercancel', () => {
  silentTracking = false;
  const infoZone = document.getElementById('silentInfoZone');
  if (infoZone) infoZone.style.transform = 'translateY(0px)';
});

function openSilentSettings() {
  clearTimeout(silentIdleTimer);
  renderSilentSettingsModal();
  document.getElementById('silentModal').classList.add('show');
}

function renderSilentSettingsModal() {
  const delayOpts = [
    { val: 0, label: '關閉' },
    { val: 10, label: '10秒' },
    { val: 20, label: '20秒' },
    { val: 30, label: '30秒' },
    { val: 60, label: '60秒' },
    { val: 120, label: '120秒' }
  ];
  document.getElementById('silentDelayPills').innerHTML = delayOpts.map(opt =>
    `<button class="cfg-pill ${silentConfig.delaySec === opt.val ? 'active' : ''}" onclick="setSilentField('delaySec', ${opt.val})">${opt.label}</button>`
  ).join('');

  const ratioOpts = [
    { val: 'third', label: '上 1/3 資訊 ＋ 下 2/3 黑化' },
    { val: 'half',  label: '上 1/2 資訊 ＋ 下 1/2 黑化' },
    { val: 'full',  label: '全螢幕純黑極簡' }
  ];
  document.getElementById('silentRatioPills').innerHTML = ratioOpts.map(opt =>
    `<button class="cfg-pill ${silentConfig.ratio === opt.val ? 'active' : ''}" onclick="setSilentField('ratio', '${opt.val}')">${opt.label}</button>`
  ).join('');

  const layoutOpts = [
    { val: 'center', label: '配置 A：經典居中' },
    { val: 'hud',    label: '配置 B：左右 HUD 儀表' },
    { val: 'drift',  label: '配置 C：防烙印微漂移' }
  ];
  document.getElementById('silentLayoutPills').innerHTML = layoutOpts.map(opt =>
    `<button class="cfg-pill ${silentConfig.layout === opt.val ? 'active' : ''}" onclick="setSilentField('layout', '${opt.val}')">${opt.label}</button>`
  ).join('');

  document.getElementById('chkSilentStation').checked = !!silentConfig.showStation;
  document.getElementById('chkSilentClock').checked   = !!silentConfig.showClock;
  document.getElementById('chkSilentMeta').checked    = !!silentConfig.showMeta;
  document.getElementById('chkSilentViz').checked     = !!silentConfig.showViz;
  document.getElementById('chkSilentSleep').checked   = !!silentConfig.showSleep;
  document.getElementById('chkSilentBtns').checked    = !!silentConfig.showBtns;
}

function setSilentField(key, val) {
  silentConfig[key] = val;
  renderSilentSettingsModal();
}

function collectSilentCheckboxes() {
  silentConfig.showStation = document.getElementById('chkSilentStation').checked;
  silentConfig.showClock   = document.getElementById('chkSilentClock').checked;
  silentConfig.showMeta    = document.getElementById('chkSilentMeta').checked;
  silentConfig.showViz     = document.getElementById('chkSilentViz').checked;
  silentConfig.showSleep   = document.getElementById('chkSilentSleep').checked;
  silentConfig.showBtns    = document.getElementById('chkSilentBtns').checked;
  localStorage.setItem('waltonSilentConfig', JSON.stringify(silentConfig));
}

function saveSilentSettings() {
  collectSilentCheckboxes();
  document.getElementById('silentModal').classList.remove('show');
  updateEqHintText();
  resetSilentIdleTimer();
}

function previewSilentModeNow() {
  collectSilentCheckboxes();
  document.getElementById('silentModal').classList.remove('show');
  enterSilentMode(true);
}

function updateEqHintText() {
  const hintEl = document.getElementById('eqHintBar');
  if (!hintEl) return;
  const silentStr = silentConfig.delaySec > 0 ? `串流成功後 ${silentConfig.delaySec} 秒進純黑靜默` : '自動靜默已關閉';
  hintEl.innerText = `💡 雙擊推桿歸零 • ${silentStr}`;
}

// ==================== 主題 / 駕駛模式 ====================
function applyTheme() {
  const btn = document.getElementById('themeToggleBtn');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const now = new Date();
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const isDaytimeSchedule = minsNow >= (6 * 60 + 30) && minsNow < (18 * 60);

  let useDay = false;
  if (themeMode === 'day') useDay = true;
  else if (themeMode === 'schedule') useDay = isDaytimeSchedule;
  else if (themeMode === 'system') useDay = prefersLight;

  document.body.classList.toggle('theme-day', useDay);
  if (themeMode === 'night') { btn.innerText = '🌙 夜間'; btn.classList.remove('on'); }
  else if (themeMode === 'day') { btn.innerText = '☀️ 日間'; btn.classList.add('on'); }
  else if (themeMode === 'schedule') { btn.innerText = '🌅 時段自動'; btn.classList.add('on'); }
  else { btn.innerText = '🌓 系統自動'; btn.classList.add('on'); }
}

function cycleThemeMode() {
  const order = ['night', 'day', 'schedule', 'system'];
  themeMode = order[(order.indexOf(themeMode) + 1) % order.length];
  localStorage.setItem('waltonThemeMode', themeMode);
  applyTheme();
}

setInterval(() => { if (themeMode === 'schedule') applyTheme(); }, 60000);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (themeMode === 'system') applyTheme();
  });
}

function applyDriveMode() {
  const btn = document.getElementById('driveModeBtn');
  document.body.classList.toggle('drive-mode', isDriveMode);
  btn.classList.toggle('active', isDriveMode);
  btn.innerText = isDriveMode ? '🚗 駕駛' : '🚗';
}

function toggleDriveMode() {
  isDriveMode = !isDriveMode;
  applyDriveMode();

  if (isDriveMode && isAudioActuallyStreaming()) {
    enterSilentMode();
  }
}

let swipeStartX = 0;
let swipeStartY = 0;
let swipeTracking = false;

container.addEventListener('pointerdown', (e) => {
  if (isDraggingMode) return;
  swipeStartX = e.clientX;
  swipeStartY = e.clientY;
  swipeTracking = true;
}, { passive: true });

container.addEventListener('pointerup', (e) => {
  if (!swipeTracking || isDraggingMode) { swipeTracking = false; return; }
  swipeTracking = false;
  const dx = e.clientX - swipeStartX;
  const dy = e.clientY - swipeStartY;
  if (Math.abs(dx) > 68 && Math.abs(dx) > Math.abs(dy) * 1.6) {
    clearTimeout(longPressTimer);
    draggedChannelId = null;
    if (navigator.vibrate) navigator.vibrate(30);
    if (dx < 0) stepChannelByScanRule(1);
    else stepChannelByScanRule(-1);
  }
}, { passive: true });

function updateFavOnlyUI() {
  const btn = document.getElementById('favOnlyBtn');
  btn.classList.toggle('on', favOnlyScan);
  btn.innerText = favOnlyScan ? '★ 僅播最愛' : '☆ 全部輪播';
}

function toggleFavOnlyScan() {
  const hasAnyFav = channels.some(c => c.fav);
  if (!favOnlyScan && !hasAnyFav) {
    alert('目前尚未標記任何「★ 最愛」電台，請先在「📻 電台」管理中點擊星星標記。');
    return;
  }
  favOnlyScan = !favOnlyScan;
  localStorage.setItem('waltonFavOnlyScan', favOnlyScan);
  updateFavOnlyUI();
}

function stepChannelByScanRule(direction) {
  if (channels.length === 0) return;
  if (!favOnlyScan) { playByIndex(currentIndex + direction, true); return; }
  const favIndices = channels.map((c, idx) => c.fav ? idx : -1).filter(idx => idx !== -1);
  if (favIndices.length === 0) { playByIndex(currentIndex + direction, true); return; }
  const posInFav = favIndices.indexOf(currentIndex);
  if (posInFav === -1) playByIndex(favIndices[0], true);
  else playByIndex(favIndices[(posInFav + direction + favIndices.length) % favIndices.length], true);
}

// ==================== 斷線重連秒數 / 螢幕常亮（預設長亮） / 睡眠定時 / 網格欄數 ====================
function updateReconnectBtnUI() {
  document.getElementById('reconnectSecBtn').innerText = `🔄 重連${reconnectDelaySec}s`;
}

function cycleReconnectSec() {
  const idx = reconnectOptions.indexOf(reconnectDelaySec);
  reconnectDelaySec = reconnectOptions[(idx + 1) % reconnectOptions.length];
  localStorage.setItem('waltonReconnectSec', reconnectDelaySec);
  updateReconnectBtnUI();
}

function updateWakeLockBtnUI() {
  const btn = document.getElementById('wakeLockBtn');
  if (!btn) return;
  if (wakeLockEnabled) {
    btn.innerText = '🔆 常亮';
    btn.classList.add('on');
  } else {
    btn.innerText = '💤 鎖屏省電';
    btn.classList.remove('on');
  }
}

async function requestWakeLockIfNeeded() {
  if (!wakeLockEnabled || wakeLockSentinel) return;
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } catch (_) {}
  }
}

async function toggleWakeLock() {
  if (!('wakeLock' in navigator)) {
    alert('目前瀏覽器不支援螢幕常亮鎖定，可透過 iPhone「設定 ＞ 螢幕顯示與亮度 ＞ 自動鎖定」調整。');
    return;
  }
  wakeLockEnabled = !wakeLockEnabled;
  updateWakeLockBtnUI();
  if (wakeLockEnabled) {
    await requestWakeLockIfNeeded();
  } else {
    if (wakeLockSentinel) { try { await wakeLockSentinel.release(); } catch (_) {} wakeLockSentinel = null; }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLockEnabled) requestWakeLockIfNeeded();
});

function cycleSleepTimer() {
  const idx = sleepTimerOptions.indexOf(sleepTimerMinutes);
  sleepTimerMinutes = sleepTimerOptions[(idx + 1) % sleepTimerOptions.length];
  if (sleepTimerMinutes === 0) cancelSleepTimer();
  else {
    sleepEndTimestamp = Date.now() + sleepTimerMinutes * 60 * 1000;
    startSleepTimerLoop();
  }
  updateSleepTimerUI();
  updateStatusEQText();
}

function cancelSleepTimer() {
  sleepTimerMinutes = 0;
  sleepEndTimestamp = 0;
  isSleepFadingOut = false;
  if (sleepCheckInterval) { clearInterval(sleepCheckInterval); sleepCheckInterval = null; }
  updateSleepTimerUI();
}

function getRemainingSleepMinutes() {
  if (!sleepTimerMinutes || !sleepEndTimestamp) return 0;
  const msLeft = sleepEndTimestamp - Date.now();
  return msLeft <= 0 ? 0 : Math.ceil(msLeft / 60000);
}

function updateSleepTimerUI() {
  const btn = document.getElementById('sleepTimerBtn');
  if (!btn) return;
  if (sleepTimerMinutes === 0) { btn.innerText = '⏰ 定時關'; btn.classList.remove('on'); }
  else {
    const minsLeft = getRemainingSleepMinutes();
    btn.innerText = isSleepFadingOut ? '⏰ 淡出中' : `⏰ 剩${minsLeft}分`;
    btn.classList.add('on');
  }
}

function startSleepTimerLoop() {
  if (sleepCheckInterval) clearInterval(sleepCheckInterval);
  sleepCheckInterval = setInterval(() => {
    if (!sleepTimerMinutes || !sleepEndTimestamp) return;
    const msLeft = sleepEndTimestamp - Date.now();
    if (msLeft <= 0 && !isSleepFadingOut) {
      clearInterval(sleepCheckInterval);
      sleepCheckInterval = null;
      triggerSleepFadeOutStop();
    } else {
      updateSleepTimerUI();
      updateStatusEQText();
      if (isSilentModeActive) renderSilentContent();
    }
  }, 1000);
}

function triggerSleepFadeOutStop() {
  if (currentPlayState === 'idle' || activePlayer.paused) {
    cancelSleepTimer();
    updateStatusEQText();
    return;
  }
  isSleepFadingOut = true;
  updateSleepTimerUI();
  statusSub.innerText = '🌙 睡眠時間到，5 秒平滑淡出停止中...';

  const myToken = ++switchToken;
  fadeOutCurrentAudio(() => {
    if (myToken !== switchToken) return;
    stopAllPlayersImmediately();
    cancelSleepTimer();
    exitSilentMode();
    updateUIState(currentIndex, 'idle', '🌙 已依睡眠定時淡出停止播放');
  }, SLEEP_FADE_DURATION);
}

function applyGridCols() {
  const btn = document.getElementById('gridColsBtn');
  container.classList.toggle('cols-3', gridCols === 3);
  if (btn) {
    btn.innerText = gridCols === 3 ? '3欄' : '2欄';
    btn.classList.toggle('on', gridCols === 3);
  }
}

function toggleGridCols() {
  gridCols = gridCols === 2 ? 3 : 2;
  localStorage.setItem('waltonGridCols', gridCols);
  applyGridCols();
}

// ==================== iPhone 雙軌降音機制 ====================
function getTargetOutputGain() {
  return isAttMuted ? 0.1 : 1.0;
}

function updateAttButtonUI() {
  const btn = document.getElementById('attBtn');
  btn.classList.toggle('active', isAttMuted);
  btn.innerText = isAttMuted ? '🔇' : '🔉';
}

function toggleAttMute() {
  isAttMuted = !isAttMuted;
  updateAttButtonUI();

  if (isAwaitingFirstTap) {
    isAwaitingFirstTap = false;
    playByIndex(currentIndex, true);
    return;
  }

  const targetGain = getTargetOutputGain();
  if (!isDirectMode && fadeGainNode && audioCtx && currentPlayState === 'playing') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    fadeGainNode.gain.cancelScheduledValues(now);
    fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, now);
    fadeGainNode.gain.linearRampToValueAtTime(targetGain, now + 0.25);
  } else if (isDirectMode && currentPlayState === 'playing') {
    playerDirect.muted = isAttMuted;
    playerDirect.volume = targetGain;
  }
  updateStatusEQText();
}

// ==================== 動態音波指示器 ====================
function startVisualizerLoop() {
  stopVisualizerLoop();
  const vizBox = document.getElementById('vizBars');
  const bars = [0, 1, 2, 3, 4].map(i => document.getElementById(`vbar${i}`));
  vizBox.classList.add('active');

  let phase = 0;
  const renderFrame = () => {
    const sbars = [0, 1, 2, 3, 4].map(i => document.getElementById(`svbar${i}`));

    if (currentPlayState !== 'playing' || !isStreamConfirmedPlaying || isAttMuted) {
      bars.forEach(b => { if (b) b.style.height = '3px'; });
      sbars.forEach(b => { if (b) b.style.height = '3px'; });
      vizBox.classList.remove('active');
      vizAnimFrame = requestAnimationFrame(renderFrame);
      return;
    }

    vizBox.classList.add('active');
    let hasRealEnergy = false;

    if (!isDirectMode && analyserNode && analyserData) {
      analyserNode.getByteFrequencyData(analyserData);
      const bins = [0, 1, 2, 3, 5];
      const sum = bins.reduce((acc, idx) => acc + (analyserData[idx] || 0), 0);
      if (sum > 10) {
        hasRealEnergy = true;
        bins.forEach((binIdx, i) => {
          const val = analyserData[binIdx] || 0;
          const h = Math.max(4, Math.min(16, Math.round((val / 255) * 16)));
          if (bars[i]) bars[i].style.height = h + 'px';
          if (sbars[i]) sbars[i].style.height = h + 'px';
        });
      }
    }

    if (!hasRealEnergy) {
      phase += 0.16;
      bars.forEach((b, i) => {
        const wave = Math.sin(phase + i * 1.15) * 0.5 + 0.5;
        const h = Math.max(4, Math.round(4 + wave * 11));
        if (b) b.style.height = h + 'px';
        if (sbars[i]) sbars[i].style.height = h + 'px';
      });
    }

    vizAnimFrame = requestAnimationFrame(renderFrame);
  };
  vizAnimFrame = requestAnimationFrame(renderFrame);
}

function stopVisualizerLoop() {
  if (vizAnimFrame) { cancelAnimationFrame(vizAnimFrame); vizAnimFrame = null; }
  const vizBox = document.getElementById('vizBars');
  if (vizBox) vizBox.classList.remove('active');
  for (let i = 0; i < 5; i++) {
    const b = document.getElementById(`vbar${i}`);
    if (b) b.style.height = '3px';
    const sb = document.getElementById(`svbar${i}`);
    if (sb) sb.style.height = '3px';
  }
}

function attachDoubleTapReset(sliderEl, resetCallback) {
  if (!sliderEl) return;
  let lastTapTime = 0;
  sliderEl.addEventListener('pointerup', (e) => {
    const now = Date.now();
    if (now - lastTapTime < 320) {
      e.preventDefault();
      sliderEl.value = 0;
      resetCallback();
      if (navigator.vibrate) navigator.vibrate(25);
      lastTapTime = 0;
    } else {
      lastTapTime = now;
    }
  });
  sliderEl.addEventListener('dblclick', () => { sliderEl.value = 0; resetCallback(); });
}

function renderChannelButtons() {
  container.innerHTML = '';
  channels.forEach((ch, idx) => {
    const btn = document.createElement('button');
    btn.className = 'ch-btn';
    btn.id = ch.id;
    btn.dataset.id = ch.id;

    const db = getChannelPreampDb(idx);
    const dbBadge = db !== 0 ? ` (${db > 0 ? '+' : ''}${db}dB)` : '';
    const starBadge = ch.fav ? `<span class="fav-star-badge">★</span>` : '';

    let titleText = ch.name;
    let subText = `${ch.sub}${dbBadge}`;

    if (idx === currentIndex) {
      if (currentPlayState === 'selected') {
        btn.classList.add('selected');
        if (!isAwaitingFirstTap) {
          btn.classList.add('buffering');
          titleText = `${ch.name} • 串流中`;
          subText = '⏳ 串流連線中...';
        }
      }
      if (currentPlayState === 'playing') {
        btn.classList.add('playing');
      }
    }

    btn.innerHTML = `${starBadge}<span class="ch-title-text">${escapeHtml(titleText)}</span><span class="sub-tag">${escapeHtml(subText)}</span>`;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      startX = e.clientX;
      startY = e.clientY;
      isDraggingMode = false;
      draggedChannelId = ch.id;
      dropTargetChannelId = null;

      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        isDraggingMode = true;
        swipeTracking = false;
        btn.classList.add('dragging');
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        if (navigator.vibrate) navigator.vibrate(40);
        statusSub.innerText = `🔀 拖曳【${ch.name}】至目標格，放開即完成交換`;
      }, 1000);
    });

    btn.addEventListener('pointermove', (e) => {
      if (draggedChannelId !== ch.id) return;
      if (!isDraggingMode) {
        const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (dist > 12) { clearTimeout(longPressTimer); draggedChannelId = null; }
        return;
      }

      btn.style.visibility = 'hidden';
      const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
      btn.style.visibility = 'visible';

      const targetBtn = elemBelow ? elemBelow.closest('.ch-btn') : null;
      const newTargetId = (targetBtn && targetBtn.dataset.id !== draggedChannelId) ? targetBtn.dataset.id : null;

      if (newTargetId !== dropTargetChannelId) {
        document.querySelectorAll('.ch-btn.drag-over').forEach(el => el.classList.remove('drag-over'));
        dropTargetChannelId = newTargetId;
        if (dropTargetChannelId && targetBtn) {
          targetBtn.classList.add('drag-over');
          const targetCh = channels.find(c => c.id === dropTargetChannelId);
          if (targetCh) statusSub.innerText = `🔀 放開即可與【${targetCh.name}】交換位置`;
        } else {
          statusSub.innerText = `🔀 拖曳【${ch.name}】至目標格，放開即完成交換`;
        }
      }
    });

    const finishPointer = (e) => {
      clearTimeout(longPressTimer);
      if (draggedChannelId !== ch.id) return;
      try { if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId); } catch (_) {}

      if (isDraggingMode) {
        const fromIdx = channels.findIndex(c => c.id === draggedChannelId);
        const toIdx = dropTargetChannelId ? channels.findIndex(c => c.id === dropTargetChannelId) : -1;
        isDraggingMode = false;
        draggedChannelId = null;
        dropTargetChannelId = null;

        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const temp = channels[fromIdx];
          channels[fromIdx] = channels[toIdx];
          channels[toIdx] = temp;
          currentIndex = Math.max(0, channels.findIndex(c => c.id === currentChannelId));
          saveChannelsData();
          renderChannelButtons();
          statusSub.innerText = '✅ 已完成交換並儲存順序';
        } else {
          renderChannelButtons();
          statusSub.innerText = '已取消移動';
        }
        setTimeout(() => updateStatusEQText(), 1500);
      } else {
        draggedChannelId = null;
        dropTargetChannelId = null;
        isAwaitingFirstTap = false;
        const targetIdx = channels.findIndex(c => c.id === ch.id);
        if (targetIdx !== -1) playByIndex(targetIdx, true);
      }
    };

    btn.addEventListener('pointerup', finishPointer);
    btn.addEventListener('pointercancel', () => {
      clearTimeout(longPressTimer);
      if (draggedChannelId === ch.id) {
        isDraggingMode = false;
        draggedChannelId = null;
        dropTargetChannelId = null;
        renderChannelButtons();
        updateStatusEQText();
      }
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    container.appendChild(btn);
  });
}

// ==================== 電台管理彈窗 ====================
function openChannelManager() {
  clearTimeout(silentIdleTimer);
  draftChannels = JSON.parse(JSON.stringify(channels));
  draftTrashChannels = JSON.parse(JSON.stringify(trashChannels));
  draftPreampMap = JSON.parse(JSON.stringify(perChannelPreamp));
  editingChannelId = null;
  initialSnapshotStr = JSON.stringify({ c: draftChannels, t: draftTrashChannels, p: draftPreampMap });

  document.getElementById('newChName').value = '';
  document.getElementById('newChSub').value = '';
  document.getElementById('newChUrl').value = '';
  document.getElementById('importBox').classList.remove('show');
  document.getElementById('importJsonInput').value = '';

  renderChannelManageList();
  document.getElementById('channelModal').classList.add('show');
}

function hasUnsavedChanges() {
  const pendingName = document.getElementById('newChName').value.trim();
  const pendingUrl = document.getElementById('newChUrl').value.trim();
  if (pendingName || pendingUrl) return true;
  return JSON.stringify({ c: draftChannels, t: draftTrashChannels, p: draftPreampMap }) !== initialSnapshotStr;
}

function attemptCloseChannelManager() {
  if (hasUnsavedChanges()) document.getElementById('unsavedConfirmModal').classList.add('show');
  else { document.getElementById('channelModal').classList.remove('show'); resetSilentIdleTimer(); }
}

function dismissConfirmModal() { document.getElementById('unsavedConfirmModal').classList.remove('show'); }

function confirmDiscardAndClose() {
  editingChannelId = null;
  document.getElementById('unsavedConfirmModal').classList.remove('show');
  document.getElementById('channelModal').classList.remove('show');
  resetSilentIdleTimer();
}

function confirmSaveAndClose() {
  document.getElementById('unsavedConfirmModal').classList.remove('show');
  commitChannelManagerChanges();
}

function commitChannelManagerChanges() {
  const pendingName = document.getElementById('newChName').value.trim();
  const pendingSub = document.getElementById('newChSub').value.trim() || '網路電台';
  const pendingUrl = document.getElementById('newChUrl').value.trim();
  if (pendingName && pendingUrl) {
    if (!pendingUrl.startsWith('https://')) { alert('串流網址必須以 https:// 開頭'); return; }
    draftChannels.push({ id: 'ch_' + Date.now(), name: pendingName, sub: pendingSub, url: pendingUrl, fav: false });
  }

  const prevPlayingCh = channels[currentIndex];
  const prevUrl = prevPlayingCh ? prevPlayingCh.url : '';

  const allRemainingIds = new Set([...draftChannels.map(c => c.id), ...draftTrashChannels.map(c => c.id)]);
  Object.keys(draftPreampMap).forEach(id => { if (!allRemainingIds.has(id)) delete draftPreampMap[id]; });

  channels = draftChannels;
  trashChannels = draftTrashChannels;
  perChannelPreamp = draftPreampMap;
  localStorage.setItem('perChannelPreampMap', JSON.stringify(perChannelPreamp));
  saveChannelsData();

  if (favOnlyScan && !channels.some(c => c.fav)) {
    favOnlyScan = false;
    localStorage.setItem('waltonFavOnlyScan', false);
    updateFavOnlyUI();
  }

  const newIdx = channels.findIndex(c => c.id === currentChannelId);
  if (newIdx === -1) {
    currentIndex = 0;
    currentChannelId = channels[0].id;
    localStorage.setItem('lastRadioChannelId', currentChannelId);
  } else {
    currentIndex = newIdx;
    if (currentPlayState === 'playing' && channels[currentIndex].url !== prevUrl) {
      currentPlayState = 'idle';
      playByIndex(currentIndex, true);
    }
  }

  applyCurrentChannelPreamp();
  document.getElementById('channelModal').classList.remove('show');
  renderChannelButtons();
  updateStatusEQText();
  resetSilentIdleTimer();
}

function toggleDraftFav(idx) {
  draftChannels[idx].fav = !draftChannels[idx].fav;
  renderChannelManageList();
}

function exportBackupToClipboard() {
  const backupPayload = {
    app: 'walton電台', version: APP_VERSION, exportedAt: new Date().toISOString(),
    channels: draftChannels, trashChannels: draftTrashChannels, perChannelPreamp: draftPreampMap,
    eqPresets: eqPresets, lastRadioEQ: currentEQ, themeMode: themeMode,
    reconnectDelaySec: reconnectDelaySec, gridCols: gridCols, eqHeightMode: eqHeightMode,
    favOnlyScan: favOnlyScan, silentConfig: silentConfig
  };
  const jsonStr = JSON.stringify(backupPayload);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(jsonStr).then(() => alert('✅ 已複製完整設定備份碼至剪貼簿！')).catch(() => prompt('請全選複製以下設定備份碼：', jsonStr));
  } else {
    prompt('請全選複製以下設定備份碼：', jsonStr);
  }
}

function toggleImportBox() { document.getElementById('importBox').classList.toggle('show'); }

function applyImportedBackup() {
  const raw = document.getElementById('importJsonInput').value.trim();
  if (!raw) { alert('請先貼上設定備份碼'); return; }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.channels) || parsed.channels.length === 0) throw new Error('缺少有效的電台清單');
    const cleaned = parsed.channels.map((item, idx) => sanitizeChannelItem(item, idx)).filter(Boolean);
    if (cleaned.length === 0) throw new Error('無有效電台資料');

    draftChannels = cleaned;
    draftTrashChannels = Array.isArray(parsed.trashChannels) ? parsed.trashChannels.map((item, idx) => sanitizeChannelItem(item, idx)).filter(Boolean) : [];
    if (parsed.perChannelPreamp && typeof parsed.perChannelPreamp === 'object') draftPreampMap = parsed.perChannelPreamp;
    if (parsed.eqPresets && typeof parsed.eqPresets === 'object') {
      eqPresets = parsed.eqPresets;
      localStorage.setItem('customRadioEQ10Presets_v2', JSON.stringify(eqPresets));
    }
    if (parsed.lastRadioEQ) setEQ(parsed.lastRadioEQ, false);
    if (parsed.themeMode) { themeMode = parsed.themeMode; localStorage.setItem('waltonThemeMode', themeMode); applyTheme(); }
    if (parsed.reconnectDelaySec) { reconnectDelaySec = parsed.reconnectDelaySec; localStorage.setItem('waltonReconnectSec', reconnectDelaySec); updateReconnectBtnUI(); }
    if (parsed.gridCols) { gridCols = parsed.gridCols === 3 ? 3 : 2; localStorage.setItem('waltonGridCols', gridCols); applyGridCols(); }
    if (parsed.eqHeightMode && eqHeightModes.includes(parsed.eqHeightMode)) { eqHeightMode = parsed.eqHeightMode; localStorage.setItem('waltonEqHeightMode', eqHeightMode); applyEqHeightMode(); }
    if (typeof parsed.favOnlyScan === 'boolean') { favOnlyScan = parsed.favOnlyScan; localStorage.setItem('waltonFavOnlyScan', favOnlyScan); updateFavOnlyUI(); }
    if (parsed.silentConfig && typeof parsed.silentConfig === 'object') {
      silentConfig = Object.assign({}, defaultSilentConfig, parsed.silentConfig);
      if (!validSilentDelays.includes(silentConfig.delaySec)) silentConfig.delaySec = 20;
      localStorage.setItem('waltonSilentConfig', JSON.stringify(silentConfig));
    }
    editingChannelId = null;
    document.getElementById('importJsonInput').value = '';
    document.getElementById('importBox').classList.remove('show');
    renderChannelManageList();
    alert('✅ 備份資料已載入預覽，請按右上角「儲存」套用生效！');
  } catch (err) {
    alert('❌ 備份碼格式不正確，請確認已完整貼上 JSON 內容');
  }
}

function renderChannelManageList() {
  const listEl = document.getElementById('chManageList');
  const trashEl = document.getElementById('chTrashList');
  document.getElementById('activeCount').innerText = draftChannels.length;
  document.getElementById('trashCount').innerText = draftTrashChannels.length;
  document.getElementById('emptyTrashBtn').style.display = draftTrashChannels.length > 0 ? 'inline-block' : 'none';

  listEl.innerHTML = '';
  draftChannels.forEach((ch, idx) => {
    const item = document.createElement('div');
    item.className = 'ch-manage-item';
    if (editingChannelId === ch.id) {
      item.innerHTML = `
        <div class="edit-inline-box">
          <div class="add-form-row">
            <input type="text" id="editName_${ch.id}" value="${escapeHtml(ch.name)}" placeholder="電台名稱">
            <input type="text" id="editSub_${ch.id}" value="${escapeHtml(ch.sub)}" placeholder="頻率標籤">
          </div>
          <input type="url" id="editUrl_${ch.id}" value="${escapeHtml(ch.url)}" placeholder="HTTPS 串流網址">
          <div class="edit-inline-actions">
            <button class="cancel-edit-btn" onclick="cancelEditChannel()">取消</button>
            <button class="apply-edit-btn" onclick="applyEditChannel(${idx}, '${ch.id}')">套用修改</button>
          </div>
        </div>
      `;
    } else {
      const isStar = !!ch.fav;
      item.innerHTML = `
        <div class="ch-item-top">
          <div class="ch-manage-left">
            <button class="star-toggle-btn ${isStar ? 'starred' : ''}" onclick="toggleDraftFav(${idx})">${isStar ? '★' : '☆'}</button>
            <div class="ch-manage-info">
              <span class="ch-manage-name">${escapeHtml(ch.name)} (${escapeHtml(ch.sub)})</span>
              <span class="ch-manage-url">${escapeHtml(ch.url)}</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="edit-ch-btn" onclick="startEditChannel('${ch.id}')">編輯</button>
            <button class="del-ch-btn" onclick="moveChannelToTrash(${idx})">刪除</button>
          </div>
        </div>
      `;
    }
    listEl.appendChild(item);
  });

  trashEl.innerHTML = '';
  if (draftTrashChannels.length === 0) {
    trashEl.innerHTML = '<div class="empty-hint">垃圾桶目前是空的</div>';
  } else {
    draftTrashChannels.forEach((ch, idx) => {
      const item = document.createElement('div');
      item.className = 'ch-manage-item trash-item';
      item.innerHTML = `
        <div class="ch-item-top">
          <div class="ch-manage-info">
            <span class="ch-manage-name">${escapeHtml(ch.name)} (${escapeHtml(ch.sub)})</span>
            <span class="ch-manage-url">${escapeHtml(ch.url)}</span>
          </div>
          <div class="item-actions">
            <button class="restore-ch-btn" onclick="restoreChannelFromTrash(${idx})">復原</button>
            <button class="perm-del-btn" onclick="permanentlyDeleteFromTrash(${idx})">永久刪除</button>
          </div>
        </div>
      `;
      trashEl.appendChild(item);
    });
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function startEditChannel(chId) { editingChannelId = chId; renderChannelManageList(); }
function cancelEditChannel() { editingChannelId = null; renderChannelManageList(); }

function applyEditChannel(idx, chId) {
  const newName = document.getElementById(`editName_${chId}`).value.trim();
  const newSub = document.getElementById(`editSub_${chId}`).value.trim() || '網路電台';
  const newUrl = document.getElementById(`editUrl_${chId}`).value.trim();
  if (!newName || !newUrl) { alert('電台名稱與串流網址不可空白'); return; }
  if (!newUrl.startsWith('https://')) { alert('串流網址必須以 https:// 開頭'); return; }
  draftChannels[idx].name = newName;
  draftChannels[idx].sub = newSub;
  draftChannels[idx].url = newUrl;
  editingChannelId = null;
  renderChannelManageList();
}

function addNewChannel() {
  const name = document.getElementById('newChName').value.trim();
  const sub = document.getElementById('newChSub').value.trim() || '網路電台';
  const url = document.getElementById('newChUrl').value.trim();
  if (!name || !url) { alert('請輸入電台名稱與 HTTPS 串流網址'); return; }
  if (!url.startsWith('https://')) { alert('串流網址必須以 https:// 開頭'); return; }
  draftChannels.push({ id: 'ch_' + Date.now(), name, sub, url, fav: false });
  document.getElementById('newChName').value = '';
  document.getElementById('newChSub').value = '';
  document.getElementById('newChUrl').value = '';
  renderChannelManageList();
}

function moveChannelToTrash(idx) {
  if (draftChannels.length <= 1) { alert('至少需保留一個電台在清單中'); return; }
  const removed = draftChannels.splice(idx, 1)[0];
  if (editingChannelId === removed.id) editingChannelId = null;
  draftTrashChannels.unshift(removed);
  renderChannelManageList();
}

function restoreChannelFromTrash(trashIdx) {
  const restored = draftTrashChannels.splice(trashIdx, 1)[0];
  if (!restored) return;
  draftChannels.push(restored);
  renderChannelManageList();
}

function permanentlyDeleteFromTrash(trashIdx) { draftTrashChannels.splice(trashIdx, 1); renderChannelManageList(); }
function emptyTrash() { draftTrashChannels = []; renderChannelManageList(); }

// ==================== 音訊、EQ 與直接有聲播放核心 ====================
function getChannelPreampDb(idx) {
  if (!channels[idx]) return 0;
  const val = parseInt(perChannelPreamp[channels[idx].id], 10);
  return isNaN(val) ? 0 : val;
}

function applyCurrentChannelPreamp() {
  const db = getChannelPreampDb(currentIndex);
  syncPreampUI(db);
  if (preampNode) preampNode.gain.value = dbToLinearGain(db);
}

function refreshChannelSubTags() {
  renderChannelButtons();
}

attachDoubleTapReset(document.getElementById('preampSlider'), onPreampChange);

eqBands.forEach((band, i) => {
  const col = document.createElement('div');
  col.className = 'band-col';
  col.innerHTML = `
    <span class="band-freq">${band.label}</span>
    <div class="v-slider-wrap">
      <input type="range" class="v-slider" id="eqSlider_${i}" min="-12" max="12" step="1" value="0" oninput="onSliderChange()">
    </div>
    <span class="band-val" id="eqVal_${i}">0</span>
  `;
  eqContainer.appendChild(col);
  attachDoubleTapReset(col.querySelector(`#eqSlider_${i}`), onSliderChange);
});

function dbToLinearGain(db) { return Math.pow(10, db / 20); }

function initAudioEQ() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(playerEQ);

    preampNode = audioCtx.createGain();
    preampNode.gain.value = dbToLinearGain(getChannelPreampDb(currentIndex));

    filterNodes = eqBands.map(band => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.freq;
      filter.Q.value = 1.414;
      return filter;
    });

    limiterNode = audioCtx.createDynamicsCompressor();
    limiterNode.threshold.value = -1.5;
    limiterNode.knee.value = 6;
    limiterNode.ratio.value = 12;
    limiterNode.attack.value = 0.003;
    limiterNode.release.value = 0.15;

    fadeGainNode = audioCtx.createGain();
    fadeGainNode.gain.value = getTargetOutputGain();

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;
    analyserNode.smoothingTimeConstant = 0.78;
    analyserData = new Uint8Array(analyserNode.frequencyBinCount);

    source.connect(preampNode);
    preampNode.connect(filterNodes[0]);
    for (let i = 0; i < filterNodes.length - 1; i++) filterNodes[i].connect(filterNodes[i + 1]);
    filterNodes[filterNodes.length - 1].connect(limiterNode);
    limiterNode.connect(fadeGainNode);
    fadeGainNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  preampNode.gain.value = dbToLinearGain(getChannelPreampDb(currentIndex));
  const gains = getCurrentSliderGains();
  filterNodes.forEach((f, i) => { f.gain.value = gains[i]; });
}

function startStallWatchdog(targetPlayer, token) {
  clearTimeout(stallWatchdogTimer);
  isStreamConfirmedPlaying = false;
  clearTimeout(silentIdleTimer);
  if (currentPlayState !== 'playing') return;

  stallWatchdogTimer = setTimeout(() => {
    if (token !== switchToken || currentPlayState !== 'playing') return;
    reconnectRetryCount++;
    statusSub.innerText = `🔄 訊號中斷(${reconnectDelaySec}s)，自動重連中 (${reconnectRetryCount})...`;
    currentPlayState = 'idle';
    playByIndex(currentIndex, true, true);
  }, reconnectDelaySec * 1000);
}

function clearStallWatchdog() { clearTimeout(stallWatchdogTimer); stallWatchdogTimer = null; }

function fadeOutCurrentAudio(callback, durationSec = FADE_DURATION) {
  if (activePlayer.paused || activePlayer.muted) { callback(); return; }
  if (!isDirectMode && fadeGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    fadeGainNode.gain.cancelScheduledValues(now);
    fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, now);
    fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + durationSec);
    setTimeout(callback, durationSec * 1000);
  } else {
    if (directFadeTimer) clearInterval(directFadeTimer);
    const startVol = playerDirect.volume;
    const steps = Math.max(15, Math.round(durationSec * 25));
    const stepTime = (durationSec * 1000) / steps;
    let currentStep = 0;
    directFadeTimer = setInterval(() => {
      currentStep++;
      playerDirect.volume = Math.max(0, startVol * (1 - currentStep / steps));
      if (currentStep >= steps) { clearInterval(directFadeTimer); directFadeTimer = null; callback(); }
    }, stepTime);
  }
}

function fadeInTargetAudio(isDirect) {
  const targetGain = getTargetOutputGain();
  if (!isDirect && fadeGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    fadeGainNode.gain.cancelScheduledValues(now);
    fadeGainNode.gain.setValueAtTime(0.0001, now);
    fadeGainNode.gain.linearRampToValueAtTime(targetGain, now + FADE_DURATION);
  } else {
    if (directFadeTimer) clearInterval(directFadeTimer);
    playerDirect.volume = 0;
    const steps = 15;
    const stepTime = (FADE_DURATION * 1000) / steps;
    let currentStep = 0;
    directFadeTimer = setInterval(() => {
      currentStep++;
      playerDirect.volume = Math.min(targetGain, (currentStep / steps) * targetGain);
      if (currentStep >= steps) { clearInterval(directFadeTimer); directFadeTimer = null; }
    }, stepTime);
  }
}

function onPreampChange() {
  const db = parseInt(document.getElementById('preampSlider').value, 10);
  perChannelPreamp[channels[currentIndex].id] = db;
  localStorage.setItem('perChannelPreampMap', JSON.stringify(perChannelPreamp));
  syncPreampUI(db);
  refreshChannelSubTags();
  if (preampNode) preampNode.gain.value = dbToLinearGain(db);
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  updateStatusEQText();
}

function syncPreampUI(db) {
  const slider = document.getElementById('preampSlider');
  const valText = document.getElementById('preampVal');
  if (slider) slider.value = db;
  if (valText) valText.innerText = (db > 0 ? '+' : '') + db;
}

function applyEQGains(presetKey) {
  const preset = eqPresets[presetKey] || eqPresets.flat;
  syncSlidersUI(preset.gains);
  if (filterNodes.length === 10) preset.gains.forEach((g, i) => { filterNodes[i].gain.value = g; });
}

function syncSlidersUI(gains) {
  if (!Array.isArray(gains)) return;
  gains.forEach((g, i) => {
    const slider = document.getElementById(`eqSlider_${i}`);
    const valText = document.getElementById(`eqVal_${i}`);
    if (slider) slider.value = g;
    if (valText) valText.innerText = (g > 0 ? '+' : '') + g;
  });
}

function getCurrentSliderGains() {
  return eqBands.map((_, i) => parseInt(document.getElementById(`eqSlider_${i}`).value, 10) || 0);
}

function setEQ(presetKey, isUserGesture = false) {
  currentEQ = presetKey;
  localStorage.setItem('lastRadioEQ', presetKey);
  document.querySelectorAll('.eq-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.eq === presetKey));
  applyEQGains(presetKey);
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  updateStatusEQText();
  if (isUserGesture && isAwaitingFirstTap) {
    isAwaitingFirstTap = false;
    playByIndex(currentIndex, true);
  }
}

function selectCustomEQ() {
  if (currentEQ === 'custom') toggleEQPanel();
  else {
    setEQ('custom', true);
    if (!document.getElementById('eqPanel').classList.contains('show')) toggleEQPanel();
  }
}

function onSliderChange() {
  const gains = getCurrentSliderGains();
  syncSlidersUI(gains);
  if (filterNodes.length === 10) gains.forEach((g, i) => { filterNodes[i].gain.value = g; });
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  eqPresets.custom.gains = gains;
  localStorage.setItem('customRadioEQ10Presets_v2', JSON.stringify(eqPresets));
  currentEQ = 'custom';
  localStorage.setItem('lastRadioEQ', 'custom');
  document.querySelectorAll('.eq-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.eq === 'custom'));
  updateStatusEQText();
}

function overwritePreset(targetKey) {
  eqPresets[targetKey].gains = getCurrentSliderGains();
  localStorage.setItem('customRadioEQ10Presets_v2', JSON.stringify(eqPresets));
  setEQ(targetKey, true);
  statusSub.innerText = `✅ 已覆蓋至「${eqPresets[targetKey].label}」`;
}

function resetDefaultPresets() {
  eqPresets = JSON.parse(JSON.stringify(defaultPresets));
  localStorage.removeItem('customRadioEQ10Presets_v2');
  perChannelPreamp = {};
  localStorage.removeItem('perChannelPreampMap');
  syncPreampUI(0);
  refreshChannelSubTags();
  if (preampNode) preampNode.gain.value = 1;
  setEQ(currentEQ, true);
  statusSub.innerText = '🔄 已還原 EQ 曲線與各台前級歸零';
}

function toggleEQPanel() {
  const panel = document.getElementById('eqPanel');
  const toggleBtn = document.getElementById('tuneToggleBtn');
  const isOpen = panel.classList.toggle('show');
  toggleBtn.classList.toggle('open', isOpen);
  document.body.classList.toggle('eq-expanded', isOpen);
}

function updateStatusEQText() {
  if (isSleepFadingOut) return;
  const sleepTag = sleepTimerMinutes > 0 ? ` | ⏰${getRemainingSleepMinutes()}m` : '';

  if (isAwaitingFirstTap) {
    statusSub.innerText = `點擊畫面任一處或電台按鈕即刻出聲${sleepTag}`;
    return;
  }
  if (currentPlayState === 'idle') {
    statusSub.innerText = `walton電台 • 長按1秒排序 | 左右滑切台${sleepTag}`;
    return;
  }
  if (currentPlayState === 'selected') {
    statusSub.innerText = `已選台，串流連線緩衝中...${sleepTag}`;
    return;
  }
  const ch = channels[currentIndex];
  const db = getChannelPreampDb(currentIndex);
  const attTag = isAttMuted ? (isDirectMode ? '🔇靜音保活 | ' : '🔇降音-20dB | ') : '';
  if (isDirectMode) {
    statusSub.innerText = `${attTag}直通原音 • ${ch.sub}${sleepTag}`;
  } else {
    const eqLabel = eqPresets[currentEQ]?.label || '原音';
    const preampStr = db !== 0 ? ` | 前級${db > 0 ? '+' : ''}${db}dB` : '';
    statusSub.innerText = `${attTag}EQ:${eqLabel}${preampStr} • ${ch.sub}${sleepTag}`;
  }
}

function stopAllPlayersImmediately() {
  isStreamConfirmedPlaying = false;
  clearTimeout(silentIdleTimer);
  clearStallWatchdog();
  stopVisualizerLoop();
  if (directFadeTimer) { clearInterval(directFadeTimer); directFadeTimer = null; }
  playerEQ.onplaying = null; playerEQ.ontimeupdate = null; playerEQ.onstalled = null; playerEQ.onwaiting = null; playerEQ.onerror = null;
  playerEQ.pause(); playerEQ.removeAttribute('src'); playerEQ.load();

  playerDirect.onplaying = null; playerDirect.ontimeupdate = null; playerDirect.onstalled = null; playerDirect.onwaiting = null; playerDirect.onerror = null;
  playerDirect.muted = false; playerDirect.pause(); playerDirect.removeAttribute('src'); playerDirect.load();

  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
}

function attachAndPlay(targetPlayer, url, token, onStreamConfirmed, onFail) {
  if (!url || typeof url !== 'string') { onFail(); return; }
  const isM3u8 = url.includes('.m3u8') || url.includes('sonnykuo.appspot.com');
  let confirmed = false;

  targetPlayer.muted = (targetPlayer === playerDirect) ? isAttMuted : false;
  if (targetPlayer === playerEQ && fadeGainNode && audioCtx) {
    fadeGainNode.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  } else if (targetPlayer === playerDirect) {
    targetPlayer.volume = 0;
  }

  const confirmPlaybackActive = () => {
    if (token !== switchToken) return;
    clearStallWatchdog();
    reconnectRetryCount = 0;
    isStreamConfirmedPlaying = true;
    if (!confirmed) {
      confirmed = true;
      onStreamConfirmed();
    } else {
      updateStatusEQText();
      resetSilentIdleTimer();
    }
  };

  targetPlayer.onplaying = confirmPlaybackActive;
  targetPlayer.ontimeupdate = () => {
    if (token === switchToken && !confirmed && targetPlayer.currentTime > 0) {
      confirmPlaybackActive();
    }
  };

  targetPlayer.onstalled = () => { if (token === switchToken && confirmed) startStallWatchdog(targetPlayer, token); };
  targetPlayer.onwaiting = () => { if (token === switchToken && confirmed) startStallWatchdog(targetPlayer, token); };
  targetPlayer.onerror = () => {
    if (token === switchToken) {
      isStreamConfirmedPlaying = false;
      clearTimeout(silentIdleTimer);
      if (!confirmed) onFail();
      else startStallWatchdog(targetPlayer, token);
    }
  };

  if (isM3u8 && !targetPlayer.canPlayType('application/vnd.apple.mpegurl') && window.Hls && Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(targetPlayer);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (token !== switchToken) return;
      targetPlayer.play().catch(() => { if (token === switchToken && !confirmed) onFail(); });
    });
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal && token === switchToken) {
        isStreamConfirmedPlaying = false;
        clearTimeout(silentIdleTimer);
        if (!confirmed) onFail();
        else startStallWatchdog(targetPlayer, token);
      }
    });
  } else {
    targetPlayer.src = url;
    targetPlayer.load();
    targetPlayer.play().catch(() => { if (token === switchToken && !confirmed) onFail(); });
  }
}

function playByIndex(idx, isUserClick = false, isAutoReconnect = false) {
  if (idx < 0) idx = channels.length - 1;
  if (idx >= channels.length) idx = 0;

  const ch = channels[idx];
  const myToken = ++switchToken;

  if (!isAutoReconnect && currentPlayState === 'playing' && currentIndex === idx) {
    cancelSleepTimer();
    fadeOutCurrentAudio(() => {
      if (myToken !== switchToken) return;
      stopAllPlayersImmediately();
      updateUIState(idx, 'idle', '已暫停');
    });
    return;
  }

  isStreamConfirmedPlaying = false;
  clearTimeout(silentIdleTimer);

  currentIndex = idx;
  currentChannelId = ch.id;
  localStorage.setItem('lastRadioChannelId', ch.id);
  applyCurrentChannelPreamp();

  if (!isUserClick) {
    updateUIState(idx, 'selected', '點擊畫面任一處或電台按鈕即刻出聲');
    stopAllPlayersImmediately();
    attachAndPlay(
      playerDirect,
      ch.url,
      myToken,
      () => {
        isAwaitingFirstTap = false;
        activePlayer = playerDirect;
        isDirectMode = true;
        fadeInTargetAudio(true);
        updateUIState(idx, 'playing', '');
        updateAttButtonUI();
        updateStatusEQText();
        setupMediaSession(ch);
      },
      () => {
        if (myToken !== switchToken) return;
        stopAllPlayersImmediately();
        isAwaitingFirstTap = true;
        updateUIState(idx, 'selected', '點擊畫面任一處或電台按鈕即刻出聲');
      }
    );
    return;
  }

  isAwaitingFirstTap = false;
  requestWakeLockIfNeeded();
  const loadingMsg = isAutoReconnect ? `🔄 訊號中斷(${reconnectDelaySec}s)，自動重連中 (${reconnectRetryCount})...` : '已選台，串流連線緩衝中...';
  updateUIState(idx, 'selected', loadingMsg);
  initAudioEQ();

  fadeOutCurrentAudio(() => {
    if (myToken !== switchToken) return;
    stopAllPlayersImmediately();

    attachAndPlay(
      playerEQ,
      ch.url,
      myToken,
      () => {
        activePlayer = playerEQ;
        isDirectMode = false;
        initAudioEQ();
        fadeInTargetAudio(false);
        updateUIState(idx, 'playing', '');
        updateAttButtonUI();
        updateStatusEQText();
        setupMediaSession(ch);
      },
      () => {
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
        attachAndPlay(
          playerDirect,
          ch.url,
          myToken,
          () => {
            activePlayer = playerDirect;
            isDirectMode = true;
            fadeInTargetAudio(true);
            updateUIState(idx, 'playing', '');
            updateAttButtonUI();
            updateStatusEQText();
            setupMediaSession(ch);
          },
          () => {
            isStreamConfirmedPlaying = false;
            clearTimeout(silentIdleTimer);
            updateUIState(idx, 'idle', '⚠️ 串流連線逾時，請再點一次重試');
          }
        );
      }
    );
  });
}

function toggleMasterPlay() {
  isAwaitingFirstTap = false;
  requestWakeLockIfNeeded();
  if (currentPlayState !== 'playing' || activePlayer.paused) {
    currentPlayState = 'idle';
    playByIndex(currentIndex, true);
  } else {
    cancelSleepTimer();
    const myToken = ++switchToken;
    fadeOutCurrentAudio(() => {
      if (myToken !== switchToken) return;
      stopAllPlayersImmediately();
      updateUIState(currentIndex, 'idle', '已暫停');
    });
  }
}

function updateUIState(activeIdx, state, subMsg) {
  currentPlayState = state;
  const ch = channels[activeIdx] || channels[0];
  statusMain.innerText = ch.name;
  if (subMsg) statusSub.innerText = subMsg;

  masterStopBtn.classList.remove('selected', 'active');
  if (state === 'playing' && isStreamConfirmedPlaying) {
    masterStopBtn.innerText = '⏸ 暫停';
    masterStopBtn.classList.add('active');
    startVisualizerLoop();
    if (isSilentModeActive) {
      renderSilentContent();
    } else if (isDriveMode && isAudioActuallyStreaming()) {
      enterSilentMode();
    } else {
      resetSilentIdleTimer();
    }
  } else if (state === 'selected') {
    isStreamConfirmedPlaying = false;
    masterStopBtn.innerText = isAwaitingFirstTap ? '▶ 播放' : '⏳ 連線';
    masterStopBtn.classList.add('selected');
    stopVisualizerLoop();
    clearTimeout(silentIdleTimer);
  } else {
    isStreamConfirmedPlaying = false;
    masterStopBtn.innerText = '▶ 播放';
    stopVisualizerLoop();
    clearTimeout(silentIdleTimer);
    exitSilentMode();
  }

  renderChannelButtons();
}

function setupMediaSession(ch) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ch.name,
      artist: ch.sub + ' • walton電台',
      album: 'CAR MULTIMEDIA'
    });
    navigator.mediaSession.setActionHandler('play', () => playByIndex(currentIndex, true));
    navigator.mediaSession.setActionHandler('pause', () => {
      cancelSleepTimer();
      const myToken = ++switchToken;
      fadeOutCurrentAudio(() => {
        if (myToken !== switchToken) return;
        stopAllPlayersImmediately();
        updateUIState(currentIndex, 'idle', '已暫停');
      });
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => stepChannelByScanRule(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => stepChannelByScanRule(1));
  }
}

window.addEventListener('online', () => {
  if (currentPlayState === 'playing' || reconnectRetryCount > 0) {
    currentPlayState = 'idle';
    playByIndex(currentIndex, true, true);
  }
});

document.addEventListener('pointerdown', (e) => {
  requestWakeLockIfNeeded();
  if (!isSilentModeActive) resetSilentIdleTimer();
  if (e.target.closest('#channelModal') || e.target.closest('#unsavedConfirmModal') || e.target.closest('#silentModal') || e.target.closest('#factoryResetConfirmModal')) return;
  if (isAwaitingFirstTap && !e.target.closest('.ch-btn') && !e.target.closest('button')) {
    isAwaitingFirstTap = false;
    playByIndex(currentIndex, true);
  }
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (isSilentModeActive) { exitSilentMode(); return; }
  resetSilentIdleTimer();
  if (isAwaitingFirstTap) {
    isAwaitingFirstTap = false;
    playByIndex(currentIndex, true);
  }
});

document.addEventListener('touchmove', (e) => {
  if (!e.target.closest('input[type=range]') && !e.target.closest('.modal-scroll-area') && !e.target.closest('textarea')) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('load', () => {
  localStorage.removeItem('waltonDriveMode');
  document.getElementById('versionBadge').innerText = APP_VERSION;
  applyTheme();
  applyDriveMode();
  applyEqHeightMode();
  updateWakeLockBtnUI();
  updateReconnectBtnUI();
  updateSleepTimerUI();
  updateFavOnlyUI();
  updateEqHintText();
  applyGridCols();
  renderChannelButtons();
  applyCurrentChannelPreamp();
  setEQ(currentEQ, false);
  playByIndex(currentIndex, false);
});
