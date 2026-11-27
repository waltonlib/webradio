// 版本變更紀錄：20261128_v01 - iOS HLS (.m3u8/.ts) 清單解析與 TS 音訊抽離送入輸出末端 EQ ＋ 既有影格對齊解碼與直通保底
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
    'lastRadioEQ', 'waltonSilentConfig', 'waltonSilentV3Migrated', 'waltonThemeMode',
    'waltonReconnectSec', 'waltonGridCols', 'waltonDriveMode', 'waltonFavOnlyScan', 'waltonEqHeightMode'
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
  fontSize: 'large',
  brightness: 'normal',
  showStation: true,
  showClock: true,
  showMeta: true,
  showViz: true,
  showSleep: true,
  showBtns: true,
  unlockMode: 'swipeUp',
  enableSwipeCh: true,
  enableDblTitle: true
};

let silentConfig = Object.assign({}, defaultSilentConfig, safeParseJSON('waltonSilentConfig', {}));
if (!validSilentDelays.includes(silentConfig.delaySec)) silentConfig.delaySec = 20;

if (!localStorage.getItem('waltonSilentV3Migrated')) {
  silentConfig = JSON.parse(JSON.stringify(defaultSilentConfig));
  localStorage.setItem('waltonSilentConfig', JSON.stringify(silentConfig));
  localStorage.setItem('waltonSilentV3Migrated', 'true');
}

let silentIdleTimer = null;
let silentClockTimer = null;
let silentDriftTimer = null;
let silentHintResetTimer = null;
let isSilentModeActive = false;

let themeMode = localStorage.getItem('waltonThemeMode') || 'night';
const reconnectOptions = [8, 16, 25, 35];
let reconnectDelaySec = parseFloat(localStorage.getItem('waltonReconnectSec')) || 25;
if (!reconnectOptions.includes(reconnectDelaySec)) {
  reconnectDelaySec = 25;
  localStorage.setItem('waltonReconnectSec', reconnectDelaySec);
}

const eqHeightModes = ['normal', 'tall', 'compact'];
let eqHeightMode = localStorage.getItem('waltonEqHeightMode') || 'normal';
if (!eqHeightModes.includes(eqHeightMode)) eqHeightMode = 'normal';

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

const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const playerEQ = document.getElementById('playerEQ');
const playerDirect = document.getElementById('playerDirect');
let activePlayer = playerDirect;
let isDirectMode = true;

// iOS 影格邊界對齊 ＋ HLS 抽音軌 ＋ 輸出末端 EQ 引擎狀態
let isIosFramedEqActive = false;
let isIosHlsMode = false;
let iosAbortController = null;
let iosHlsPollTimer = null;
let iosSeenSegments = new Set();
let iosByteRing = new Uint8Array(0);
let iosFrameBatch = [];
let iosDecodeBusy = false;
let iosScheduleTimer = null;
let iosFeedWatchdog = null;
let iosNextPlayTime = 0;
let iosActiveSources = [];

let isAwaitingFirstTap = true;
let isStreamConfirmedPlaying = false;
let hlsInstance = null;
let switchToken = 0;

let stallWatchdogTimer = null;
let connectGraceTimer = null;
let reconnectRetryCount = 0;

const statusMain = document.getElementById('statusMain');
const statusSub = document.getElementById('statusSub');
const masterStopBtn = document.getElementById('masterStopBtn');
const container = document.getElementById('btnContainer');
const eqContainer = document.getElementById('graphicEqContainer');

let currentChannelId = localStorage.getItem('lastRadioChannelId') || channels[0].id;
let currentIndex = Math.max(0, channels.findIndex(c => c.id === currentChannelId));
let currentEQ = localStorage.getItem('lastRadioEQ') || 'flat';
let currentPlayState = 'selected';

let audioCtx = null;
let eqMediaSourceNode = null;
let eqChainInputNode = null;
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

function updateResponsiveLayout() {
  const w = window.innerWidth || document.documentElement.clientWidth || 390;
  const h = window.innerHeight || document.documentElement.clientHeight || 844;
  const isLandscapeDesk = w >= 768 && w > h;

  const rootStyle = document.documentElement.style;

  if (isLandscapeDesk) {
    const deskCols = w >= 1360 ? 'minmax(0, 1.38fr) minmax(0, 1fr)' : 'minmax(0, 1.22fr) minmax(0, 1fr)';
    rootStyle.setProperty('--desk-cols', deskCols);

    const heightFactor = eqHeightMode === 'tall' ? 1.32 : (eqHeightMode === 'compact' ? 0.72 : 1.0);
    const rawTrackH = Math.round(h * 0.25 * heightFactor);
    const trackH = Math.max(120, Math.min(310, rawTrackH));
    const sliderW = Math.max(108, Math.min(296, trackH - 12));

    const eqWrapEl = document.getElementById('graphicEqContainer');
    const eqWrapW = eqWrapEl ? eqWrapEl.clientWidth : Math.round(w * 0.4);
    const perColW = Math.max(20, (eqWrapW - 28) / 11);
    const labelSize = Math.max(9.5, Math.min(13, Math.floor(perColW * 0.28)));

    rootStyle.setProperty('--eq-track-h', `${trackH}px`);
    rootStyle.setProperty('--eq-slider-w', `${sliderW}px`);
    rootStyle.setProperty('--eq-label-size', `${labelSize}px`);
  } else {
    const heightFactor = eqHeightMode === 'tall' ? 1.42 : (eqHeightMode === 'compact' ? 0.68 : 1.0);
    const rawTrackH = Math.round(h * 0.092 * heightFactor);
    const trackH = Math.max(48, Math.min(118, rawTrackH));
    const sliderW = Math.max(42, Math.min(108, trackH - 8));

    const eqWrapEl = document.getElementById('graphicEqContainer');
    const eqWrapW = eqWrapEl ? eqWrapEl.clientWidth : (w - 28);
    const perColW = Math.max(16, (eqWrapW - 24) / 11);
    const labelSize = Math.max(9, Math.min(11.5, Math.floor(perColW * 0.34)));

    rootStyle.setProperty('--eq-track-h', `${trackH}px`);
    rootStyle.setProperty('--eq-slider-w', `${sliderW}px`);
    rootStyle.setProperty('--eq-label-size', `${labelSize}px`);
  }
}

function applyEqHeightMode() {
  const btn = document.getElementById('eqHeightBtn');
  if (btn) {
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
  updateResponsiveLayout();
}

function cycleEqHeight() {
  eqHeightMode = eqHeightModes[(eqHeightModes.indexOf(eqHeightMode) + 1) % eqHeightModes.length];
  localStorage.setItem('waltonEqHeightMode', eqHeightMode);
  applyEqHeightMode();
}

let lastTitleTapTime = 0;
const titleVizRowEl = document.getElementById('titleVizRow');
if (titleVizRowEl) {
  titleVizRowEl.addEventListener('pointerup', (e) => {
    if (!silentConfig.enableDblTitle) return;
    const now = Date.now();
    if (now - lastTitleTapTime < 350) {
      e.preventDefault();
      lastTitleTapTime = 0;
      if (navigator.vibrate) navigator.vibrate(25);
      enterSilentMode(true);
    } else {
      lastTitleTapTime = now;
    }
  });
}

function isAudioActuallyStreaming() {
  if (currentPlayState !== 'playing' || !isStreamConfirmedPlaying) return false;
  if (isIosFramedEqActive) {
    return !!(audioCtx && audioCtx.state === 'running');
  }
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

function getDefaultWakeHintText() {
  const swipePart = silentConfig.enableSwipeCh ? ' • 左右滑動切台' : '';
  if (silentConfig.unlockMode === 'doubleTap') return `⌃ 雙擊螢幕解鎖${swipePart}`;
  if (silentConfig.unlockMode === 'singleTap') return `⌃ 輕點螢幕解鎖${swipePart}`;
  return `⌃ 向上滑動解鎖${swipePart}`;
}

function enterSilentMode(forcePreview = false) {
  if (isSilentModeActive) return;
  if (!forcePreview && !isAudioActuallyStreaming()) return;

  isSilentModeActive = true;
  clearTimeout(silentIdleTimer);

  const overlay = document.getElementById('silentOverlay');
  overlay.classList.remove('ratio-half', 'ratio-full', 'font-normal', 'font-large', 'font-xlarge', 'bright-dim', 'bright-normal', 'bright-clear');

  if (silentConfig.ratio === 'half') overlay.classList.add('ratio-half');
  if (silentConfig.ratio === 'full') overlay.classList.add('ratio-full');

  overlay.classList.add(`font-${silentConfig.fontSize || 'large'}`);
  overlay.classList.add(`bright-${silentConfig.brightness || 'normal'}`);

  const infoZone = document.getElementById('silentInfoZone');
  if (infoZone) infoZone.style.transform = 'translateY(0px)';

  const wakeHint = document.getElementById('silentWakeHint');
  if (wakeHint) {
    wakeHint.classList.remove('alert-prompt');
    wakeHint.innerText = getDefaultWakeHintText();
  }

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
  clearTimeout(silentHintResetTimer);

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

function getEngineModeLabel() {
  if (isIosFramedEqActive) {
    const tag = isIosHlsMode ? 'iOS-HLS-EQ' : 'iOS末端EQ';
    return `${tag}:${eqPresets[currentEQ]?.label || '原音'}`;
  }
  if (isDirectMode) return isIOSDevice ? 'iOS直通保底' : '直通原音';
  return `EQ:${eqPresets[currentEQ]?.label || '原音'}`;
}

function renderSilentContent() {
  const inner = document.getElementById('silentInnerContent');
  if (!inner) return;

  const ch = channels[currentIndex] || { name: 'walton電台', sub: '' };
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const eqLabel = getEngineModeLabel();
  const isBuffering = currentPlayState === 'selected';
  const sleepMins = getRemainingSleepMinutes();
  const sleepPart = (silentConfig.showSleep && sleepTimerMinutes > 0) ? ` • ⏰剩${sleepMins}分` : '';
  const attLabel = isAttMuted ? (isDirectMode && isIOSDevice && !isIosFramedEqActive ? ' • 🔇靜音' : ' • 降音') : '';

  const metaStr = isBuffering
    ? `${ch.sub} • ⏳ 串流連線緩衝中...${sleepPart}`
    : `${ch.sub} • ${eqLabel}${attLabel}${sleepPart}`;

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
         <button class="silent-dim-btn ${isAttMuted ? 'active' : ''}" onclick="event.stopPropagation(); toggleAttMute();">${isAttMuted ? '🔇 恢復音量' : '🔉 降音'}</button>
         <button class="silent-dim-btn" onclick="event.stopPropagation(); exitSilentMode(); toggleMasterPlay();">⏸ 暫停</button>
       </div>`
    : '';

  inner.className = 'silent-inner-content ' + (silentConfig.layout === 'hud' ? 'layout-hud' : 'layout-center');

  if (silentConfig.layout === 'hud') {
    inner.innerHTML = `
      <div class="silent-hud-left">
        ${silentConfig.showClock ? `<div class="silent-clock">${timeStr}</div>` : ''}
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
      ${btnsHtml}
    `;
  }
}

const silentOverlayEl = document.getElementById('silentOverlay');
let silentTouchStartX = 0;
let silentTouchStartY = 0;
let silentTracking = false;
let silentTapTimestamps = [];

function triggerSwipeUpPromptAlert() {
  const wakeHint = document.getElementById('silentWakeHint');
  if (!wakeHint) return;
  if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  wakeHint.innerText = '⌃ 請向上滑動螢幕以解鎖';
  wakeHint.classList.remove('alert-prompt');
  void wakeHint.offsetWidth;
  wakeHint.classList.add('alert-prompt');

  clearTimeout(silentHintResetTimer);
  silentHintResetTimer = setTimeout(() => {
    wakeHint.classList.remove('alert-prompt');
    wakeHint.innerText = getDefaultWakeHintText();
  }, 3000);
}

silentOverlayEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  silentTouchStartX = e.clientX;
  silentTouchStartY = e.clientY;
  silentTracking = true;
}, { passive: true });

silentOverlayEl.addEventListener('pointermove', (e) => {
  if (!isSilentModeActive || !silentTracking) return;
  if (silentConfig.unlockMode !== 'swipeUp') return;
  const dy = e.clientY - silentTouchStartY;
  const infoZone = document.getElementById('silentInfoZone');
  const wakeHint = document.getElementById('silentWakeHint');
  if (dy < 0) {
    const lift = Math.max(-46, dy * 0.45);
    if (infoZone) infoZone.style.transform = `translateY(${lift}px)`;
    if (wakeHint && !wakeHint.classList.contains('alert-prompt')) {
      wakeHint.style.color = dy < -60 ? '#9BB7C7' : '#56626B';
      wakeHint.innerText = dy < -60 ? '⌃ 放開立即解鎖' : getDefaultWakeHintText();
    }
  }
}, { passive: true });

const handleSilentPointerEnd = (e) => {
  if (!isSilentModeActive || !silentTracking) return;
  silentTracking = false;

  const infoZone = document.getElementById('silentInfoZone');
  const wakeHint = document.getElementById('silentWakeHint');
  if (infoZone) infoZone.style.transform = 'translateY(0px)';
  if (wakeHint && !wakeHint.classList.contains('alert-prompt')) {
    wakeHint.style.color = '';
    wakeHint.innerText = getDefaultWakeHintText();
  }

  if (e.target.closest('button')) return;

  const dx = e.clientX - silentTouchStartX;
  const dy = e.clientY - silentTouchStartY;
  const moveDist = Math.hypot(dx, dy);

  if (silentConfig.unlockMode === 'swipeUp' && dy < -60 && Math.abs(dy) > Math.abs(dx) * 1.4) {
    if (navigator.vibrate) navigator.vibrate(25);
    e.preventDefault();
    e.stopPropagation();
    exitSilentMode();
    return;
  }

  if (silentConfig.enableSwipeCh && Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (navigator.vibrate) navigator.vibrate(25);
    if (dx < 0) stepChannelByScanRule(1, true);
    else stepChannelByScanRule(-1, true);
    return;
  }

  if (moveDist < 18) {
    if (silentConfig.unlockMode === 'singleTap') {
      if (navigator.vibrate) navigator.vibrate(20);
      e.preventDefault();
      e.stopPropagation();
      exitSilentMode();
      return;
    }

    const now = Date.now();
    silentTapTimestamps = silentTapTimestamps.filter(t => now - t < 1500);
    silentTapTimestamps.push(now);

    if (silentConfig.unlockMode === 'doubleTap' && silentTapTimestamps.length >= 2) {
      silentTapTimestamps = [];
      if (navigator.vibrate) navigator.vibrate(25);
      e.preventDefault();
      e.stopPropagation();
      exitSilentMode();
      return;
    }

    if (silentConfig.unlockMode === 'swipeUp' && silentTapTimestamps.length >= 2) {
      triggerSwipeUpPromptAlert();
    }
  }

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
    { val: 0, label: '關閉' }, { val: 10, label: '10秒' }, { val: 20, label: '20秒' },
    { val: 30, label: '30秒' }, { val: 60, label: '60秒' }, { val: 120, label: '120秒' }
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

  const activeFont = silentConfig.fontSize || 'large';
  document.querySelectorAll('#silentFontSizePills .cfg-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === activeFont);
  });

  const activeBright = silentConfig.brightness || 'normal';
  document.querySelectorAll('#silentBrightnessPills .cfg-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bright === activeBright);
  });

  const activeUnlock = silentConfig.unlockMode || 'swipeUp';
  document.querySelectorAll('#silentUnlockModePills .cfg-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.unlock === activeUnlock);
  });

  document.getElementById('chkSilentStation').checked  = !!silentConfig.showStation;
  document.getElementById('chkSilentClock').checked    = !!silentConfig.showClock;
  document.getElementById('chkSilentMeta').checked     = !!silentConfig.showMeta;
  document.getElementById('chkSilentViz').checked      = !!silentConfig.showViz;
  document.getElementById('chkSilentSleep').checked    = !!silentConfig.showSleep;
  document.getElementById('chkSilentBtns').checked     = !!silentConfig.showBtns;
  document.getElementById('chkSilentSwipeCh').checked  = !!silentConfig.enableSwipeCh;
  document.getElementById('chkSilentDblTitle').checked = !!silentConfig.enableDblTitle;
}

function setSilentField(key, val) {
  silentConfig[key] = val;
  renderSilentSettingsModal();
}

function collectSilentCheckboxes() {
  silentConfig.showStation    = document.getElementById('chkSilentStation').checked;
  silentConfig.showClock      = document.getElementById('chkSilentClock').checked;
  silentConfig.showMeta       = document.getElementById('chkSilentMeta').checked;
  silentConfig.showViz        = document.getElementById('chkSilentViz').checked;
  silentConfig.showSleep      = document.getElementById('chkSilentSleep').checked;
  silentConfig.showBtns       = document.getElementById('chkSilentBtns').checked;
  silentConfig.enableSwipeCh  = document.getElementById('chkSilentSwipeCh').checked;
  silentConfig.enableDblTitle = document.getElementById('chkSilentDblTitle').checked;
  localStorage.setItem('waltonSilentConfig', JSON.stringify(silentConfig));
}

function resetSilentDefaults() {
  silentConfig = JSON.parse(JSON.stringify(defaultSilentConfig));
  localStorage.setItem('waltonSilentConfig', JSON.stringify(silentConfig));
  renderSilentSettingsModal();
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

function stepChannelByScanRule(direction, keepSilent = false) {
  if (channels.length === 0) return;
  const preserveSilent = keepSilent || isSilentModeActive;

  if (!favOnlyScan) {
    playByIndex(currentIndex + direction, true, false, preserveSilent);
    return;
  }
  const favIndices = channels.map((c, idx) => c.fav ? idx : -1).filter(idx => idx !== -1);
  if (favIndices.length === 0) {
    playByIndex(currentIndex + direction, true, false, preserveSilent);
    return;
  }
  const posInFav = favIndices.indexOf(currentIndex);
  if (posInFav === -1) {
    playByIndex(favIndices[0], true, false, preserveSilent);
  } else {
    const nextFavPos = (posInFav + direction + favIndices.length) % favIndices.length;
    playByIndex(favIndices[nextFavPos], true, false, preserveSilent);
  }
}

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
  if (currentPlayState === 'idle') {
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

// ==================== 增益職責切分：Preamp 僅負責前級，fadeGainNode 統一負責降音與淡入淡出 ====================
function getTargetOutputGain() {
  return isAttMuted ? 0.1 : 1.0;
}

function applyAudioAttenuation() {
  const targetGain = getTargetOutputGain();
  const chDb = getChannelPreampDb(currentIndex);

  if (audioCtx && audioCtx.state !== 'running') {
    audioCtx.resume().catch(() => {});
  }

  if (fadeGainNode) {
    fadeGainNode.gain.value = targetGain;
    if (audioCtx) {
      try {
        fadeGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        fadeGainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.02);
      } catch (_) {}
    }
  }

  if (preampNode) {
    preampNode.gain.value = dbToLinearGain(chDb);
  }

  if (isIOSDevice && isDirectMode && !isIosFramedEqActive) {
    playerDirect.muted = isAttMuted;
    playerDirect.volume = 1.0;
  } else {
    playerDirect.muted = false;
    playerDirect.volume = targetGain;
  }
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

  applyAudioAttenuation();
  updateStatusEQText();
  if (isSilentModeActive) renderSilentContent();
}

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
      sbars.forEach(b => { if (b) b.style.height = '4px'; });
      vizBox.classList.remove('active');
      vizAnimFrame = requestAnimationFrame(renderFrame);
      return;
    }

    vizBox.classList.add('active');
    let hasRealEnergy = false;

    if ((!isDirectMode || isIosFramedEqActive) && analyserNode && analyserData) {
      analyserNode.getByteFrequencyData(analyserData);
      const bins = [0, 1, 2, 3, 5];
      const sum = bins.reduce((acc, idx) => acc + (analyserData[idx] || 0), 0);
      if (sum > 10) {
        hasRealEnergy = true;
        bins.forEach((binIdx, i) => {
          const val = analyserData[binIdx] || 0;
          const h = Math.max(4, Math.min(16, Math.round((val / 255) * 16)));
          const sh = Math.max(5, Math.min(24, Math.round((val / 255) * 24)));
          if (bars[i]) bars[i].style.height = h + 'px';
          if (sbars[i]) sbars[i].style.height = sh + 'px';
        });
      }
    }

    if (!hasRealEnergy) {
      phase += 0.16;
      bars.forEach((b, i) => {
        const wave = Math.sin(phase + i * 1.15) * 0.5 + 0.5;
        const h = Math.max(4, Math.round(4 + wave * 11));
        const sh = Math.max(5, Math.round(5 + wave * 18));
        if (b) b.style.height = h + 'px';
        if (sbars[i]) sbars[i].style.height = sh + 'px';
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
    if (sb) sb.style.height = '4px';
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

// ==================== 音訊、輸出末端 EQ 與 iOS 影格邊界對齊 / HLS 抽音軌引擎 ====================
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

function ensureAudioGraph(resumeNow = false) {
  try {
    if (!audioCtx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return false;
      audioCtx = new AudioContextCtor();

      eqChainInputNode = audioCtx.createGain();
      eqChainInputNode.gain.value = 1.0;

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

      eqChainInputNode.connect(preampNode);
      preampNode.connect(filterNodes[0]);
      for (let i = 0; i < filterNodes.length - 1; i++) filterNodes[i].connect(filterNodes[i + 1]);
      filterNodes[filterNodes.length - 1].connect(limiterNode);
      limiterNode.connect(fadeGainNode);
      fadeGainNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);
    }

    if (!isIOSDevice && !eqMediaSourceNode) {
      try {
        playerEQ.crossOrigin = 'anonymous';
        eqMediaSourceNode = audioCtx.createMediaElementSource(playerEQ);
        eqMediaSourceNode.connect(eqChainInputNode);
      } catch (_) {}
    }

    if (resumeNow && audioCtx.state !== 'running') {
      const rp = audioCtx.resume();
      if (rp && typeof rp.catch === 'function') rp.catch(() => {});
    }

    preampNode.gain.value = dbToLinearGain(getChannelPreampDb(currentIndex));
    if (fadeGainNode && !isDirectMode) fadeGainNode.gain.value = getTargetOutputGain();
    const gains = getCurrentSliderGains();
    filterNodes.forEach((f, i) => { f.gain.value = gains[i] || 0; });
    return true;
  } catch (_) {
    return false;
  }
}

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SAMPLERATES_V1 = [44100, 48000, 32000, 0];
const MP3_SAMPLERATES_V2 = [22050, 24000, 16000, 0];
const AAC_SAMPLERATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, 0, 0, 0];

function parseMp3FrameLength(buf, offset) {
  if (offset + 4 > buf.length) return 0;
  const b0 = buf[offset];
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];
  if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) return 0;

  const verBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (verBits === 0x01 || layerBits !== 0x01) return 0;

  const brIdx = (b2 >> 4) & 0x0F;
  const srIdx = (b2 >> 2) & 0x03;
  const pad = (b2 >> 1) & 0x01;

  const isMpeg1 = (verBits === 0x03);
  const bitrateKbps = isMpeg1 ? MP3_BITRATES_V1_L3[brIdx] : MP3_BITRATES_V2_L3[brIdx];
  const sampleRate = isMpeg1 ? MP3_SAMPLERATES_V1[srIdx] : MP3_SAMPLERATES_V2[srIdx];
  if (!bitrateKbps || !sampleRate) return 0;

  const frameLen = isMpeg1
    ? Math.floor((144 * bitrateKbps * 1000) / sampleRate) + pad
    : Math.floor((72 * bitrateKbps * 1000) / sampleRate) + pad;

  return frameLen >= 24 ? frameLen : 0;
}

function parseAdtsFrameLength(buf, offset) {
  if (offset + 7 > buf.length) return 0;
  if (buf[offset] !== 0xFF || (buf[offset + 1] & 0xF0) !== 0xF0) return 0;
  const srIdx = (buf[offset + 2] >> 2) & 0x0F;
  if (AAC_SAMPLERATES[srIdx] === 0) return 0;
  const frameLen = ((buf[offset + 3] & 0x03) << 11) | (buf[offset + 4] << 3) | ((buf[offset + 5] >> 5) & 0x07);
  return frameLen >= 7 ? frameLen : 0;
}

function extractAlignedAudioFrames(ring, maxFrames = 40) {
  const frames = [];
  let cursor = 0;

  if (ring.length >= 10 && ring[0] === 0x49 && ring[1] === 0x44 && ring[2] === 0x33) {
    const tagSize = ((ring[6] & 0x7F) << 21) | ((ring[7] & 0x7F) << 14) | ((ring[8] & 0x7F) << 7) | (ring[9] & 0x7F);
    if (ring.length > 10 + tagSize) cursor = 10 + tagSize;
  }

  while (cursor + 7 < ring.length && frames.length < maxFrames) {
    if (ring[cursor] !== 0xFF || (ring[cursor + 1] & 0xE0) !== 0xE0) {
      cursor++;
      continue;
    }

    const adtsLen = parseAdtsFrameLength(ring, cursor);
    if (adtsLen > 0) {
      if (cursor + adtsLen > ring.length) break;
      frames.push(ring.slice(cursor, cursor + adtsLen));
      cursor += adtsLen;
      continue;
    }

    const mp3Len = parseMp3FrameLength(ring, cursor);
    if (mp3Len > 0) {
      if (cursor + mp3Len > ring.length) break;
      frames.push(ring.slice(cursor, cursor + mp3Len));
      cursor += mp3Len;
      continue;
    }

    cursor++;
  }

  return {
    frames,
    remainder: ring.slice(cursor)
  };
}

// 抽離 MPEG-TS（188 bytes/packet）中的音訊 PES 酬載，供後續影格邊界對齊
function extractAudioPayloadFromTs(tsBytes) {
  if (!tsBytes || tsBytes.length < 188) return new Uint8Array(0);
  const payloads = [];
  let totalLen = 0;
  let offset = 0;

  while (offset + 188 <= tsBytes.length) {
    if (tsBytes[offset] !== 0x47) {
      offset++;
      continue;
    }
    const pkt = tsBytes.subarray(offset, offset + 188);
    offset += 188;

    const pusi = (pkt[1] & 0x40) !== 0;
    const pid = ((pkt[1] & 0x1F) << 8) | pkt[2];
    const adaptCtrl = (pkt[3] >> 4) & 0x03;

    if (pid === 0x0000 || pid === 0x1FFF) continue;

    let idx = 4;
    if (adaptCtrl === 0x02 || adaptCtrl === 0x03) {
      if (idx >= 188) continue;
      const adaptLen = pkt[idx];
      idx += 1 + adaptLen;
    }
    if (adaptCtrl === 0x02 || idx >= 188) continue;

    let dataSlice = pkt.subarray(idx);
    if (pusi && dataSlice.length >= 9 && dataSlice[0] === 0x00 && dataSlice[1] === 0x00 && dataSlice[2] === 0x01) {
      const streamId = dataSlice[3];
      // 音訊 PES stream_id 範圍 0xC0..0xDF
      if (streamId < 0xC0 || streamId > 0xDF) continue;
      const pesHeaderDataLen = dataSlice[8];
      const pesPayloadStart = 9 + pesHeaderDataLen;
      if (pesPayloadStart < dataSlice.length) {
        dataSlice = dataSlice.subarray(pesPayloadStart);
      } else {
        continue;
      }
    }

    if (dataSlice.length > 0) {
      payloads.push(dataSlice);
      totalLen += dataSlice.length;
    }
  }

  if (totalLen === 0) return new Uint8Array(0);
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const p of payloads) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

function resolvePlaylistUrl(baseUrl, line) {
  try {
    return new URL(line.trim(), baseUrl).href;
  } catch (_) {
    return line.trim();
  }
}

async function parseM3u8Playlist(playlistUrl, signal, depth = 0) {
  if (depth > 3) return { segments: [], targetDuration: 4 };
  const resp = await fetch(playlistUrl, { mode: 'cors', signal });
  if (!resp.ok) throw new Error('M3U8 fetch failed');
  const text = await resp.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let targetDuration = 4;
  const variantUrls = [];
  const segmentUrls = [];
  let expectVariant = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const val = parseFloat(line.split(':')[1]);
      if (!isNaN(val) && val > 0) targetDuration = val;
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      expectVariant = true;
    } else if (!line.startsWith('#')) {
      const absUrl = resolvePlaylistUrl(playlistUrl, line);
      if (expectVariant || absUrl.includes('.m3u8')) {
        variantUrls.push(absUrl);
        expectVariant = false;
      } else {
        segmentUrls.push(absUrl);
      }
    }
  }

  if (segmentUrls.length === 0 && variantUrls.length > 0) {
    return parseM3u8Playlist(variantUrls[0], signal, depth + 1);
  }

  return { segments: segmentUrls, targetDuration };
}

function stopIosBufferStream() {
  isIosFramedEqActive = false;
  isIosHlsMode = false;
  iosDecodeBusy = false;
  clearTimeout(iosScheduleTimer);
  iosScheduleTimer = null;
  clearTimeout(iosFeedWatchdog);
  iosFeedWatchdog = null;
  clearInterval(iosHlsPollTimer);
  iosHlsPollTimer = null;
  iosSeenSegments.clear();
  if (iosAbortController) {
    try { iosAbortController.abort(); } catch (_) {}
    iosAbortController = null;
  }
  iosByteRing = new Uint8Array(0);
  iosFrameBatch = [];
  iosNextPlayTime = 0;
  iosActiveSources.forEach(src => {
    try { src.stop(); src.disconnect(); } catch (_) {}
  });
  iosActiveSources = [];
}

function drainIosFrameQueue(token, onFirstBufferReady, minFramesThreshold = 10) {
  if (iosDecodeBusy || token !== switchToken || !audioCtx || !eqChainInputNode) return;
  if (iosFrameBatch.length < minFramesThreshold) return;

  const takeCount = Math.min(28, iosFrameBatch.length);
  const selected = iosFrameBatch.splice(0, takeCount);
  const totalLen = selected.reduce((acc, f) => acc + f.length, 0);
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const f of selected) {
    merged.set(f, pos);
    pos += f.length;
  }

  iosDecodeBusy = true;
  audioCtx.decodeAudioData(merged.buffer.slice(0))
    .then(decoded => {
      iosDecodeBusy = false;
      if (token !== switchToken || !audioCtx || !eqChainInputNode) return;
      if (audioCtx.state !== 'running') {
        audioCtx.resume().catch(() => {});
      }
      const now = audioCtx.currentTime;
      if (iosNextPlayTime < now + 0.05) {
        iosNextPlayTime = now + 0.09;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(eqChainInputNode);
      src.start(iosNextPlayTime);
      iosNextPlayTime += decoded.duration;
      iosActiveSources.push(src);
      src.onended = () => {
        iosActiveSources = iosActiveSources.filter(s => s !== src);
      };

      if (onFirstBufferReady) {
        const cb = onFirstBufferReady;
        onFirstBufferReady = null;
        cb();
      }
    })
    .catch(() => {
      iosDecodeBusy = false;
      iosFrameBatch = selected.concat(iosFrameBatch);
    });
}

function promoteIosEqTakeover(token, isHls, onTakeoverSuccess) {
  if (token !== switchToken) return;
  isIosFramedEqActive = true;
  isIosHlsMode = !!isHls;
  isDirectMode = false;
  activePlayer = null;

  try {
    playerDirect.pause();
    playerDirect.removeAttribute('src');
    playerDirect.load();
  } catch (_) {}

  fadeInTargetAudio(false);
  applyAudioAttenuation();
  onTakeoverSuccess();
}

// iOS 連續音訊串流（MP3 / ADTS AAC）：影格對齊解碼 ＋ 輸出末端 EQ
function startIosFramedEqEngine(url, token, onTakeoverSuccess) {
  if (!url || typeof url !== 'string') return;
  if (!ensureAudioGraph(true) || !audioCtx || !eqChainInputNode) return;

  const controller = new AbortController();
  iosAbortController = controller;
  iosByteRing = new Uint8Array(0);
  iosFrameBatch = [];
  iosNextPlayTime = 0;

  let takenOver = false;

  const armFeedWatchdog = () => {
    clearTimeout(iosFeedWatchdog);
    iosFeedWatchdog = setTimeout(() => {
      if (!takenOver || token !== switchToken || currentPlayState !== 'playing') return;
      reconnectRetryCount++;
      statusSub.innerText = `🔄 iOS 串流中斷(${reconnectDelaySec}s)，自動重連中 (${reconnectRetryCount})...`;
      currentPlayState = 'idle';
      playByIndex(currentIndex, true, true, isSilentModeActive);
    }, reconnectDelaySec * 1000);
  };

  const failTimeout = setTimeout(() => {
    if (!takenOver && token === switchToken) {
      controller.abort();
    }
  }, 7500);

  const onReadyCallback = () => {
    if (takenOver || token !== switchToken) return;
    takenOver = true;
    clearTimeout(failTimeout);
    promoteIosEqTakeover(token, false, () => {
      armFeedWatchdog();
      onTakeoverSuccess();
    });
  };

  fetch(url, { mode: 'cors', signal: controller.signal })
    .then(res => {
      if (!res.ok || !res.body) throw new Error('Stream unavailable');
      const reader = res.body.getReader();

      const readLoop = () => {
        reader.read().then(({ done, value }) => {
          if (token !== switchToken || controller.signal.aborted) return;
          if (done) {
            if (takenOver) armFeedWatchdog();
            return;
          }
          if (value && value.byteLength > 0) {
            if (takenOver) armFeedWatchdog();
            const nextRing = new Uint8Array(iosByteRing.length + value.byteLength);
            nextRing.set(iosByteRing, 0);
            nextRing.set(value, iosByteRing.length);

            const extracted = extractAlignedAudioFrames(nextRing);
            iosByteRing = extracted.remainder;
            if (extracted.frames.length > 0) {
              iosFrameBatch.push(...extracted.frames);
              drainIosFrameQueue(token, onReadyCallback, 10);
            }
          }
          readLoop();
        }).catch(() => {
          clearTimeout(failTimeout);
        });
      };
      readLoop();
    })
    .catch(() => {
      clearTimeout(failTimeout);
    });
}

// iOS HLS（.m3u8 / .ts）抽音軌送入輸出末端 EQ 引擎
function startIosHlsEqEngine(url, token, onTakeoverSuccess) {
  if (!url || typeof url !== 'string') return;
  if (!ensureAudioGraph(true) || !audioCtx || !eqChainInputNode) return;

  const controller = new AbortController();
  iosAbortController = controller;
  iosSeenSegments.clear();
  iosByteRing = new Uint8Array(0);
  iosFrameBatch = [];
  iosNextPlayTime = 0;

  let takenOver = false;
  let initialBatchDone = false;

  const armHlsWatchdog = () => {
    clearTimeout(iosFeedWatchdog);
    iosFeedWatchdog = setTimeout(() => {
      if (!takenOver || token !== switchToken || currentPlayState !== 'playing') return;
      reconnectRetryCount++;
      statusSub.innerText = `🔄 iOS HLS 斷流(${reconnectDelaySec}s)，自動重連中 (${reconnectRetryCount})...`;
      currentPlayState = 'idle';
      playByIndex(currentIndex, true, true, isSilentModeActive);
    }, Math.max(reconnectDelaySec * 1000, 12000));
  };

  const onReadyCallback = () => {
    if (takenOver || token !== switchToken) return;
    takenOver = true;
    promoteIosEqTakeover(token, true, () => {
      armHlsWatchdog();
      onTakeoverSuccess();
    });
  };

  const ingestSegmentBytes = (rawBytes) => {
    if (!rawBytes || rawBytes.byteLength === 0 || token !== switchToken || controller.signal.aborted) return;
    const u8 = new Uint8Array(rawBytes);
    const isTsPacketStream = u8.length >= 188 && (u8[0] === 0x47 || u8[188] === 0x47);
    const audioChunks = isTsPacketStream ? extractAudioPayloadFromTs(u8) : u8;
    if (!audioChunks || audioChunks.length === 0) return;

    const nextRing = new Uint8Array(iosByteRing.length + audioChunks.length);
    nextRing.set(iosByteRing, 0);
    nextRing.set(audioChunks, iosByteRing.length);

    const extracted = extractAlignedAudioFrames(nextRing, 60);
    iosByteRing = extracted.remainder;
    if (extracted.frames.length > 0) {
      iosFrameBatch.push(...extracted.frames);
      drainIosFrameQueue(token, onReadyCallback, 6);
    }
  };

  const pollPlaylist = async () => {
    if (token !== switchToken || controller.signal.aborted) return;
    try {
      const { segments, targetDuration } = await parseM3u8Playlist(url, controller.signal);
      if (token !== switchToken || controller.signal.aborted) return;

      const freshSegments = segments.filter(s => !iosSeenSegments.has(s));
      const queueToFetch = !initialBatchDone ? freshSegments.slice(-2) : freshSegments.slice(-3);
      initialBatchDone = true;

      for (const segUrl of segments) {
        iosSeenSegments.add(segUrl);
      }
      if (iosSeenSegments.size > 120) {
        const arr = Array.from(iosSeenSegments).slice(-60);
        iosSeenSegments = new Set(arr);
      }

      for (const segUrl of queueToFetch) {
        if (token !== switchToken || controller.signal.aborted) return;
        try {
          const segResp = await fetch(segUrl, { mode: 'cors', signal: controller.signal });
          if (segResp.ok) {
            const buf = await segResp.arrayBuffer();
            ingestSegmentBytes(buf);
            if (takenOver) armHlsWatchdog();
          }
        } catch (_) {}
      }

      if (token === switchToken && !controller.signal.aborted) {
        const nextIntervalMs = Math.max(1500, Math.min(4500, Math.round((targetDuration || 3) * 750)));
        clearTimeout(iosHlsPollTimer);
        iosHlsPollTimer = setTimeout(pollPlaylist, nextIntervalMs);
      }
    } catch (_) {
      if (!takenOver) {
        controller.abort();
      }
    }
  };

  pollPlaylist();
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
    playByIndex(currentIndex, true, true, isSilentModeActive);
  }, reconnectDelaySec * 1000);
}

function clearStallWatchdog() { clearTimeout(stallWatchdogTimer); stallWatchdogTimer = null; }
function clearConnectGraceTimer() { clearTimeout(connectGraceTimer); connectGraceTimer = null; }

function fadeOutCurrentAudio(callback, durationSec = FADE_DURATION) {
  if (currentPlayState !== 'playing' || !isStreamConfirmedPlaying) {
    callback();
    return;
  }
  if ((!isDirectMode || isIosFramedEqActive) && fadeGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    try {
      fadeGainNode.gain.cancelScheduledValues(now);
      fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, now);
      fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + durationSec);
    } catch (_) {}
    setTimeout(callback, durationSec * 1000);
  } else {
    if (!activePlayer || activePlayer.paused || activePlayer.muted) { callback(); return; }
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
  if ((!isDirect || isIosFramedEqActive) && fadeGainNode && audioCtx) {
    const now = audioCtx.currentTime;
    try {
      fadeGainNode.gain.cancelScheduledValues(now);
      fadeGainNode.gain.setValueAtTime(0.0001, now);
      fadeGainNode.gain.linearRampToValueAtTime(targetGain, now + FADE_DURATION);
    } catch (_) {
      fadeGainNode.gain.value = targetGain;
    }
  } else {
    if (isIOSDevice && isDirect) {
      playerDirect.muted = isAttMuted;
      playerDirect.volume = 1.0;
      return;
    }
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
  if (isSilentModeActive) renderSilentContent();
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
  if (preampNode) preampNode.gain.value = 1.0;
  setEQ(currentEQ, true);
  statusSub.innerText = '🔄 已還原 EQ 曲線與各台前級歸零';
}

function toggleEQPanel() {
  const panel = document.getElementById('eqPanel');
  const toggleBtn = document.getElementById('tuneToggleBtn');
  const isOpen = panel.classList.toggle('show');
  toggleBtn.classList.toggle('open', isOpen);
  document.body.classList.toggle('eq-expanded', isOpen);
  updateResponsiveLayout();
}

function updateStatusEQText() {
  if (isSleepFadingOut) return;
  const sleepTag = sleepTimerMinutes > 0 ? ` | ⏰${getRemainingSleepMinutes()}m` : '';

  if (isAwaitingFirstTap) {
    statusSub.innerText = `已選台就緒 • 點擊播放或任一電台出聲${sleepTag}`;
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
  const attTag = isAttMuted ? (isDirectMode && isIOSDevice && !isIosFramedEqActive ? '🔇靜音 | ' : '🔇降音-20dB | ') : '';

  if (isIosFramedEqActive) {
    const eqLabel = eqPresets[currentEQ]?.label || '原音';
    const preampStr = db !== 0 ? ` | 前級${db > 0 ? '+' : ''}${db}dB` : '';
    const modeTag = isIosHlsMode ? 'iOS-HLS末端EQ' : 'iOS末端EQ';
    statusSub.innerText = `${attTag}${modeTag}:${eqLabel}${preampStr} • ${ch.sub}${sleepTag}`;
  } else if (isDirectMode) {
    const modeTag = isIOSDevice ? 'iOS直通保底' : '直通原音';
    statusSub.innerText = `${attTag}${modeTag} • ${ch.sub}${sleepTag}`;
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
  clearConnectGraceTimer();
  stopVisualizerLoop();
  stopIosBufferStream();
  if (directFadeTimer) { clearInterval(directFadeTimer); directFadeTimer = null; }
  playerEQ.onplaying = null; playerEQ.ontimeupdate = null; playerEQ.onstalled = null; playerEQ.onwaiting = null; playerEQ.onerror = null;
  playerEQ.pause(); playerEQ.removeAttribute('src'); playerEQ.load();

  playerDirect.onplaying = null; playerDirect.ontimeupdate = null; playerDirect.onstalled = null; playerDirect.onwaiting = null; playerDirect.onerror = null;
  playerDirect.muted = false; playerDirect.pause(); playerDirect.removeAttribute('src'); playerDirect.load();

  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
}

function shouldPreferDirectStream(url) {
  if (!url) return true;
  if (isIOSDevice) return true;
  return url.includes('.m3u8') || url.includes('sonnykuo.appspot.com');
}

function attachAndPlay(targetPlayer, url, token, onStreamConfirmed, onFail, allowGracePeriod = false) {
  if (!url || typeof url !== 'string') { onFail(); return; }
  const isM3u8 = url.includes('.m3u8') || url.includes('sonnykuo.appspot.com');
  let confirmed = false;
  let failed = false;

  const triggerFailOnce = () => {
    if (failed || confirmed || token !== switchToken) return;
    failed = true;
    clearConnectGraceTimer();
    onFail();
  };

  if (allowGracePeriod) {
    clearConnectGraceTimer();
    connectGraceTimer = setTimeout(() => {
      if (!confirmed && token === switchToken) {
        triggerFailOnce();
      }
    }, reconnectDelaySec * 1000);
  }

  targetPlayer.muted = (targetPlayer === playerDirect) ? isAttMuted : false;
  if (targetPlayer === playerEQ && fadeGainNode && audioCtx) {
    fadeGainNode.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  } else if (targetPlayer === playerDirect) {
    targetPlayer.volume = isIOSDevice ? 1.0 : 0;
  }

  const confirmPlaybackActive = () => {
    if (token !== switchToken || failed) return;
    clearStallWatchdog();
    clearConnectGraceTimer();
    reconnectRetryCount = 0;
    isStreamConfirmedPlaying = true;
    if (!confirmed) {
      confirmed = true;
      onStreamConfirmed();
    } else {
      updateStatusEQText();
      if (isSilentModeActive) renderSilentContent();
      else resetSilentIdleTimer();
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
    if (token !== switchToken) return;
    if (!confirmed) {
      if (!allowGracePeriod) triggerFailOnce();
    } else {
      isStreamConfirmedPlaying = false;
      clearTimeout(silentIdleTimer);
      startStallWatchdog(targetPlayer, token);
    }
  };

  if (isM3u8 && !targetPlayer.canPlayType('application/vnd.apple.mpegurl') && window.Hls && Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(targetPlayer);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (token !== switchToken) return;
      targetPlayer.play().catch(() => { if (!allowGracePeriod) triggerFailOnce(); });
    });
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal && token === switchToken) {
        if (!confirmed) {
          if (!allowGracePeriod) triggerFailOnce();
        } else {
          isStreamConfirmedPlaying = false;
          clearTimeout(silentIdleTimer);
          startStallWatchdog(targetPlayer, token);
        }
      }
    });
  } else {
    targetPlayer.src = url;
    targetPlayer.load();
    targetPlayer.play().catch(() => { if (!allowGracePeriod) triggerFailOnce(); });
  }
}

function playByIndex(idx, isUserClick = false, isAutoReconnect = false, keepSilent = false) {
  if (idx < 0) idx = channels.length - 1;
  if (idx >= channels.length) idx = 0;

  const ch = channels[idx];
  const myToken = ++switchToken;
  const preserveSilent = keepSilent || isSilentModeActive;

  if (!isAutoReconnect && currentPlayState === 'playing' && currentIndex === idx) {
    cancelSleepTimer();
    fadeOutCurrentAudio(() => {
      if (myToken !== switchToken) return;
      stopAllPlayersImmediately();
      updateUIState(idx, 'idle', '已暫停', false);
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
    isAwaitingFirstTap = true;
    stopAllPlayersImmediately();
    updateUIState(idx, 'selected', '已選台就緒 • 點擊播放或任一電台出聲', preserveSilent);
    return;
  }

  isAwaitingFirstTap = false;
  requestWakeLockIfNeeded();
  ensureAudioGraph(true);

  const loadingMsg = isAutoReconnect ? `🔄 訊號中斷(${reconnectDelaySec}s)，自動重連中 (${reconnectRetryCount})...` : '已選台，串流連線緩衝中...';
  updateUIState(idx, 'selected', loadingMsg, preserveSilent);

  const useDirectFirst = shouldPreferDirectStream(ch.url);

  fadeOutCurrentAudio(() => {
    if (myToken !== switchToken) return;
    stopAllPlayersImmediately();

    if (useDirectFirst) {
      attachAndPlay(
        playerDirect,
        ch.url,
        myToken,
        () => {
          activePlayer = playerDirect;
          isDirectMode = true;
          fadeInTargetAudio(true);
          updateUIState(idx, 'playing', '', preserveSilent);
          updateAttButtonUI();
          updateStatusEQText();
          setupMediaSession(ch);

          if (isIOSDevice) {
            const isHlsLike = ch.url.includes('.m3u8') || ch.url.includes('sonnykuo.appspot.com');
            if (isHlsLike) {
              startIosHlsEqEngine(ch.url, myToken, () => {
                if (myToken !== switchToken) return;
                updateStatusEQText();
                if (isSilentModeActive) renderSilentContent();
              });
            } else {
              startIosFramedEqEngine(ch.url, myToken, () => {
                if (myToken !== switchToken) return;
                updateStatusEQText();
                if (isSilentModeActive) renderSilentContent();
              });
            }
          }
        },
        () => {
          isStreamConfirmedPlaying = false;
          clearTimeout(silentIdleTimer);
          updateUIState(idx, 'idle', '⚠️ 串流連線逾時，請再點一次重試', preserveSilent);
        },
        true
      );
    } else {
      attachAndPlay(
        playerEQ,
        ch.url,
        myToken,
        () => {
          activePlayer = playerEQ;
          isDirectMode = false;
          ensureAudioGraph(true);
          fadeInTargetAudio(false);
          updateUIState(idx, 'playing', '', preserveSilent);
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
              updateUIState(idx, 'playing', '', preserveSilent);
              updateAttButtonUI();
              updateStatusEQText();
              setupMediaSession(ch);
            },
            () => {
              isStreamConfirmedPlaying = false;
              clearTimeout(silentIdleTimer);
              updateUIState(idx, 'idle', '⚠️ 串流連線逾時，請再點一次重試', preserveSilent);
            },
            true
          );
        },
        false
      );
    }
  });
}

function toggleMasterPlay() {
  isAwaitingFirstTap = false;
  requestWakeLockIfNeeded();
  ensureAudioGraph(true);
  if (currentPlayState !== 'playing' || (!isIosFramedEqActive && activePlayer && activePlayer.paused)) {
    playByIndex(currentIndex, true);
  } else {
    cancelSleepTimer();
    const myToken = ++switchToken;
    fadeOutCurrentAudio(() => {
      if (myToken !== switchToken) return;
      stopAllPlayersImmediately();
      updateUIState(currentIndex, 'idle', '已暫停', false);
    });
  }
}

function updateUIState(activeIdx, state, subMsg, preserveSilent = false) {
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
    if (isSilentModeActive) renderSilentContent();
  } else {
    isStreamConfirmedPlaying = false;
    masterStopBtn.innerText = '▶ 播放';
    stopVisualizerLoop();
    clearTimeout(silentIdleTimer);
    if (!preserveSilent) {
      exitSilentMode();
    } else if (isSilentModeActive) {
      renderSilentContent();
    }
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
    navigator.mediaSession.setActionHandler('play', () => playByIndex(currentIndex, true, false, isSilentModeActive));
    navigator.mediaSession.setActionHandler('pause', () => {
      cancelSleepTimer();
      const myToken = ++switchToken;
      fadeOutCurrentAudio(() => {
        if (myToken !== switchToken) return;
        stopAllPlayersImmediately();
        updateUIState(currentIndex, 'idle', '已暫停', false);
      });
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => stepChannelByScanRule(-1, isSilentModeActive));
    navigator.mediaSession.setActionHandler('nexttrack', () => stepChannelByScanRule(1, isSilentModeActive));
  }
}

window.addEventListener('online', () => {
  if (currentPlayState === 'playing' || reconnectRetryCount > 0) {
    currentPlayState = 'idle';
    playByIndex(currentIndex, true, true, isSilentModeActive);
  }
});

document.addEventListener('pointerdown', (e) => {
  requestWakeLockIfNeeded();
  if (audioCtx && audioCtx.state !== 'running') {
    audioCtx.resume().catch(() => {});
  }
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

window.addEventListener('resize', updateResponsiveLayout);
window.addEventListener('orientationchange', () => setTimeout(updateResponsiveLayout, 120));

if (typeof ResizeObserver !== 'undefined') {
  const resizeObs = new ResizeObserver(() => updateResponsiveLayout());
  resizeObs.observe(document.documentElement);
}

window.addEventListener('load', () => {
  localStorage.removeItem('waltonDriveMode');
  const vBadge = document.getElementById('versionBadge');
  if (vBadge && typeof APP_VERSION !== 'undefined') vBadge.innerText = APP_VERSION;
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
  updateResponsiveLayout();
  playByIndex(currentIndex, false);
});
