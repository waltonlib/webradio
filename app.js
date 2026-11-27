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

const playerEQ = document.getElementById('playerEQ');
const playerDirect = document.getElementById('playerDirect');
let activePlayer = playerDirect;
let isDirectMode = true;
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

function renderSilentContent() {
  const inner = document.getElementById('silentInnerContent');
  if (!inner) return;

  const ch = channels[currentIndex] || { name: 'walton電台', sub: '' };
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const eqLabel = isDirectMode ? '直通原音' : `EQ:${eqPresets[currentEQ]?.label || '原音'}`;
  const isBuffering = currentPlayState === 'selected';
  const sleepMins = getRemainingSleepMinutes();
  const sleepPart = (silentConfig.showSleep && sleepTimerMinutes > 0) ? ` • ⏰剩${sleepMins}分` : '';

  const metaStr = isBuffering
    ? `${ch.sub} • ⏳ 串流連線緩衝中...${sleepPart}`
    : `${ch.sub} • ${eqLabel}${isAttMuted ? ' • 降音中' : ''}${sleepPart}`;

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
