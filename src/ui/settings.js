const { ipcRenderer } = require('electron');
const {
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_THREADS_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_FILTER_KEYWORDS,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_APP_BADGE_ENABLED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  DEFAULT_HEADER_BG_COLOR,
  DEFAULT_DARK_HEADER_BG_COLOR,
  DEFAULT_CHAT_BG_COLOR,
  DEFAULT_DARK_CHAT_BG_COLOR,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_DARK_BUBBLE_BG_COLOR,
  THEME_PALETTE_PRESETS,
  DEFAULT_AUTO_CHECK_UPDATES,
  DEFAULT_UNDO_SHORTCUT,
  DEFAULT_REDO_SHORTCUT
} = require('../core/constants');
const {
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getThreadsIntervalMinutes,
  saveThreadsIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getShowMemberOnlyPosts,
  saveShowMemberOnlyPosts,
  getFilterKeywords,
  saveFilterKeywords,
  getDiscordSoundEnabled,
  saveDiscordSoundEnabled,
  getAppBadgeEnabled,
  saveAppBadgeEnabled,
  getLayoutUndoShortcut,
  saveLayoutUndoShortcut,
  getLayoutRedoShortcut,
  saveLayoutRedoShortcut,
  getAutoCheckUpdates,
  saveAutoCheckUpdates,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor,
  getHeaderBgColor,
  saveHeaderBgColor,
  getChatBgColor,
  saveChatBgColor,
  getBubbleBgColor,
  saveBubbleBgColor,
  resetAllAppearanceColors,
  getEffectiveTheme,
  getStoredTheme,
  getLanguage,
  saveLanguage,
  clearStoredLanguage
} = require('../core/storage');
const {
  applyTickerColors,
  syncOnlineTickers,
  getTickerStats
} = require('../core/ticker');
const {
  applyTheme,
  applyModeAppearance,
  applyThemePalettePreset,
  applyHeaderColor,
  buildHeaderSurfaceGradient,
  resolveHeaderPalette,
  applyChatBgColor,
  resolveChatBgPalette,
  applyBubbleColor,
  resolveBubblePalette,
  normalizeHexColor
} = require('./theme');
const { showToast } = require('../core/utils');
const {
  t,
  detectSystemLanguage,
  setActiveLanguageOverride
} = require('../core/i18n');

const { colord } = require('colord');

const INTERVAL_CONTROLS = [
  {
    key: 'twitterIntervalMinutes',
    selectId: 'setting-twitter-interval',
    wrapId: 'setting-twitter-custom-wrap',
    inputId: 'setting-twitter-custom',
    get: getTwitterIntervalMinutes,
    save: saveTwitterIntervalMinutes,
    defaultVal: DEFAULT_TWITTER_INTERVAL_MINUTES,
    normalize: (v) => Math.max(1, Math.round(v)),
    errKey: 'settings.toastInvalidTwitterInterval'
  },
  {
    key: 'threadsIntervalMinutes',
    selectId: 'setting-threads-interval',
    wrapId: 'setting-threads-custom-wrap',
    inputId: 'setting-threads-custom',
    get: getThreadsIntervalMinutes,
    save: saveThreadsIntervalMinutes,
    defaultVal: DEFAULT_THREADS_INTERVAL_MINUTES,
    normalize: (v) => Math.max(1, Math.round(v)),
    errKey: 'settings.toastInvalidThreadsInterval'
  },
  {
    key: 'discordIntervalMinutes',
    selectId: 'setting-discord-interval',
    wrapId: 'setting-discord-custom-wrap',
    inputId: 'setting-discord-custom',
    get: getDiscordIntervalMinutes,
    save: saveDiscordIntervalMinutes,
    defaultVal: DEFAULT_DISCORD_INTERVAL_MINUTES,
    normalize: (v) => Math.max(0.5, Math.round(v * 10) / 10),
    errKey: 'settings.toastInvalidDiscordInterval'
  }
];

const BOOL_SELECT_CONTROLS = [
  {
    key: 'showMemberOnlyPosts',
    id: 'setting-show-member-only',
    get: getShowMemberOnlyPosts,
    save: saveShowMemberOnlyPosts,
    defaultVal: DEFAULT_SHOW_MEMBER_ONLY
  },
  {
    key: 'discordSoundEnabled',
    id: 'setting-discord-sound',
    get: getDiscordSoundEnabled,
    save: saveDiscordSoundEnabled,
    defaultVal: DEFAULT_DISCORD_SOUND_ENABLED
  },
  {
    key: 'appBadgeEnabled',
    id: 'setting-app-badge',
    get: getAppBadgeEnabled,
    save: saveAppBadgeEnabled,
    defaultVal: DEFAULT_APP_BADGE_ENABLED
  },
  {
    key: 'autoCheckUpdates',
    id: 'setting-auto-update',
    get: getAutoCheckUpdates,
    save: saveAutoCheckUpdates,
    defaultVal: DEFAULT_AUTO_CHECK_UPDATES
  }
];

let isInitialized = false;
let onLanguageChangeCallback = null;
let onSaveCallback = null;
let autoUpdateIntervalId = null;
let suppressEscCloseUntil = 0;
let currentUpdateState = {
  state: 'idle',
  currentVersion: '1.1.1',
  latestVersion: null,
  updateAvailable: false,
  progress: 0
};

function setMainShortcutRecording(active) {
  try {
    if (ipcRenderer) {
      if (typeof ipcRenderer.sendSync === 'function') {
        ipcRenderer.sendSync('set-shortcut-recording', Boolean(active));
      } else if (typeof ipcRenderer.send === 'function') {
        ipcRenderer.send('set-shortcut-recording', Boolean(active));
      }
    }
  } catch (_) {}
}

function isShortcutRecording() {
  return Boolean(
    typeof window !== 'undefined' &&
      window.__THEYSAY_SHORTCUTS_BRIDGE &&
      window.__THEYSAY_SHORTCUTS_BRIDGE.isRecording()
  );
}

function cancelShortcutRecording({ suppressEsc = false } = {}) {
  if (suppressEsc) {
    suppressEscCloseUntil = Date.now() + 200;
  }
  if (typeof window !== 'undefined' && window.__THEYSAY_SHORTCUTS_BRIDGE) {
    window.__THEYSAY_SHORTCUTS_BRIDGE.cancelRecording();
  }
  setMainShortcutRecording(false);
}

function syncShortcutsControl(
  undo = getLayoutUndoShortcut(),
  redo = getLayoutRedoShortcut()
) {
  if (typeof window !== 'undefined' && window.__THEYSAY_SHORTCUTS_BRIDGE) {
    window.__THEYSAY_SHORTCUTS_BRIDGE.setShortcuts({ undo, redo });
    window.__THEYSAY_SHORTCUTS_BRIDGE.setRecordingLabel(t('settings.shortcutRecording'));
  }
}

function refreshShortcutsLocaleUI() {
  if (typeof window !== 'undefined' && window.__THEYSAY_SHORTCUTS_BRIDGE) {
    window.__THEYSAY_SHORTCUTS_BRIDGE.setRecordingLabel(t('settings.shortcutRecording'));
  }
}

function notifySaved() {
  if (typeof onSaveCallback === 'function') {
    onSaveCallback({
      language: getLanguage(),
      twitterMinutes: getTwitterIntervalMinutes(),
      threadsMinutes: getThreadsIntervalMinutes(),
      discordMinutes: getDiscordIntervalMinutes(),
      showMemberOnly: getShowMemberOnlyPosts(),
      filterKeywords: getFilterKeywords(),
      discordSoundEnabled: getDiscordSoundEnabled(),
      appBadgeEnabled: getAppBadgeEnabled(),
      layoutUndoShortcut: getLayoutUndoShortcut(),
      layoutRedoShortcut: getLayoutRedoShortcut(),
      autoCheckUpdates: getAutoCheckUpdates(),
      headerBgColor: getHeaderBgColor(),
      chatBgColor: getChatBgColor(),
      bubbleBgColor: getBubbleBgColor(),
      tickerFgColor: getTickerFgColor(),
      tickerBgColor: getTickerBgColor()
    });
  }
}

function syncFilterKeywordsControl(keywords = getFilterKeywords()) {
  if (typeof window !== 'undefined' && window.__THEYSAY_FILTER_KEYWORDS_BRIDGE) {
    window.__THEYSAY_FILTER_KEYWORDS_BRIDGE.setKeywords(keywords);
  }
}

function commitPendingFilterKeywordsInput({ triggerSave = true } = {}) {
  if (typeof window !== 'undefined' && window.__THEYSAY_FILTER_KEYWORDS_BRIDGE) {
    return window.__THEYSAY_FILTER_KEYWORDS_BRIDGE.commitPending({ notify: triggerSave });
  }
  return getFilterKeywords();
}

function getOverlay() {
  return document.getElementById('settings-modal-overlay');
}

function isSettingsModalOpen() {
  const overlay = getOverlay();
  return !!(overlay && !overlay.classList.contains('is-closed'));
}

function syncCustomVisibility(selectEl, customWrapEl) {
  customWrapEl.style.display = selectEl.value === 'custom' ? 'flex' : 'none';
}

function populateSelectAndInput(selectEl, customWrapEl, customInputEl, currentVal) {
  const matchingOption = Array.from(selectEl.options).find(
    opt => opt.value !== 'custom' && parseFloat(opt.value) === currentVal
  );
  selectEl.value = matchingOption ? matchingOption.value : 'custom';
  customWrapEl.style.display = matchingOption ? 'none' : 'flex';
  customInputEl.value = currentVal;
}

function updateThemePaletteActiveUI() {
  const mode = getEffectiveTheme();
  const curChat = getChatBgColor(mode).toLowerCase();
  const curBubble = getBubbleBgColor(mode).toLowerCase();
  const curHeader = getHeaderBgColor(mode).toLowerCase();
  const presets = THEME_PALETTE_PRESETS[mode] || [];
  const matched = presets.find(
    (p) =>
      p.chatBg.toLowerCase() === curChat &&
      p.bubbleBg.toLowerCase() === curBubble &&
      p.headerBg.toLowerCase() === curHeader
  );
  const matchedId = matched ? matched.id : null;
  document.querySelectorAll('#setting-theme-palettes .theme-palette-card').forEach((btn) => {
    const pid = btn.getAttribute('data-palette-id') || '';
    const isActive = Boolean(matchedId && pid === matchedId);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function updateHeaderPreviewUI(bgColor, { liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  const fallback = mode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const curChat = getChatBgColor(mode);
  const palette =
    bg === curChat
      ? resolveChatBgPalette(bg, mode)
      : resolveHeaderPalette(bg, mode);

  const barEl = document.getElementById('setting-header-preview-bar');
  const nameEl = document.getElementById('setting-header-preview-name');
  const handleEl = document.getElementById('setting-header-preview-handle');
  const dragEl = document.getElementById('setting-header-preview-drag');
  const iconEl = document.getElementById('setting-header-preview-icon');

  if (barEl) {
    barEl.style.background = buildHeaderSurfaceGradient(bg, mode);
    barEl.style.borderBottomColor = 'transparent';
  }
  if (nameEl) nameEl.style.color = palette.text;
  if (handleEl) handleEl.style.color = palette.subtext;
  if (dragEl) dragEl.style.color = palette.subtext;
  if (iconEl) iconEl.style.color = palette.subtext;

  document.querySelectorAll('#setting-header-presets .header-preset-chip').forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === bg);
  });

  if (liveApply) {
    applyHeaderColor(bg, mode);
  }
  updateThemePaletteActiveUI();
}

function setHeaderColorInputs(bgColor, { liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  const fallback = mode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const bgInput = document.getElementById('setting-header-bg-color');
  const bgHex = document.getElementById('setting-header-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateHeaderPreviewUI(bg, { liveApply });
}

function updateChatBgPreviewUI(bgColor, { liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  const palette = resolveChatBgPalette(bgColor, mode);

  const cardEl = document.getElementById('setting-header-preview');
  const bodyEl = document.getElementById('setting-ticker-preview');
  const barEl = document.getElementById('setting-header-preview-bar');
  const nameEl = document.getElementById('setting-header-preview-name');
  const handleEl = document.getElementById('setting-header-preview-handle');
  const iconEl = document.getElementById('setting-header-preview-icon');

  if (cardEl) cardEl.style.backgroundColor = palette.bg;
  if (bodyEl) bodyEl.style.backgroundColor = palette.bg;

  const curHeader = getHeaderBgColor(mode);
  if (curHeader === palette.bg) {
    if (barEl) barEl.style.background = buildHeaderSurfaceGradient(palette.bg, mode);
    if (nameEl) nameEl.style.color = palette.text;
    if (handleEl) handleEl.style.color = palette.subtext;
    if (iconEl) iconEl.style.color = palette.subtext;
  }

  document.querySelectorAll('#setting-chat-bg-presets .chat-bg-preset-chip').forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === palette.bg);
  });

  if (liveApply) {
    applyChatBgColor(palette.bg, mode);
  }
  updateThemePaletteActiveUI();
}

function setChatBgColorInputs(bgColor, { liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  const fallback = mode === 'dark' ? DEFAULT_DARK_CHAT_BG_COLOR : DEFAULT_CHAT_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const bgInput = document.getElementById('setting-chat-bg-color');
  const bgHex = document.getElementById('setting-chat-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateChatBgPreviewUI(bg, { liveApply });
}

function updateBubbleBgPreviewUI(bgColor, { liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  const palette = resolveBubblePalette(bgColor, mode);

  const bubbleEl =
    document.getElementById('setting-bubble-preview-item') ||
    document.querySelector('#setting-ticker-preview .header-preview-bubble');
  const timeEl = document.querySelector('#setting-ticker-preview .header-preview-time');

  if (bubbleEl) {
    bubbleEl.style.backgroundColor = palette.bg;
    bubbleEl.style.borderColor = palette.border;
    bubbleEl.style.color = palette.text;
  }
  if (timeEl) {
    timeEl.style.color = palette.timeText;
  }

  document.querySelectorAll('#setting-bubble-bg-presets .bubble-bg-preset-chip').forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === palette.bg);
  });

  if (liveApply) {
    applyBubbleColor(palette.bg, mode);
  }
  updateThemePaletteActiveUI();
}

function setBubbleBgColorInputs(bgColor, { liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  const fallback = mode === 'dark' ? DEFAULT_DARK_BUBBLE_BG_COLOR : DEFAULT_BUBBLE_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const bgInput = document.getElementById('setting-bubble-bg-color');
  const bgHex = document.getElementById('setting-bubble-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateBubbleBgPreviewUI(bg, { liveApply });
}

function syncAppearanceInputsForActiveMode({ liveApply = false } = {}) {
  const mode = getEffectiveTheme();
  setChatBgColorInputs(getChatBgColor(mode), { liveApply });
  setBubbleBgColorInputs(getBubbleBgColor(mode), { liveApply });
  setHeaderColorInputs(getHeaderBgColor(mode), { liveApply });
  updateThemePaletteActiveUI();
}

function updateTickerPreviewUI(fgColor, bgColor) {
  const fg = normalizeHexColor(fgColor, DEFAULT_TICKER_FG_COLOR);
  const bg = normalizeHexColor(bgColor, DEFAULT_TICKER_BG_COLOR);

  document.querySelectorAll('#setting-ticker-preview .ticker-preview-chip').forEach(chip => {
    chip.style.color = fg;
    chip.style.backgroundColor = bg;
  });

  document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip').forEach(btn => {
    const pFg = (btn.getAttribute('data-fg') || '').toLowerCase();
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pFg === fg && pBg === bg);
  });
}

function setTickerColorInputs(fgColor, bgColor) {
  const fg = normalizeHexColor(fgColor, DEFAULT_TICKER_FG_COLOR);
  const bg = normalizeHexColor(bgColor, DEFAULT_TICKER_BG_COLOR);

  const fgInput = document.getElementById('setting-ticker-fg-color');
  const fgHex = document.getElementById('setting-ticker-fg-hex');
  const bgInput = document.getElementById('setting-ticker-bg-color');
  const bgHex = document.getElementById('setting-ticker-bg-hex');

  if (fgInput) fgInput.value = fg;
  if (fgHex) fgHex.value = fg;
  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateTickerPreviewUI(fg, bg);
}

function setMantineBtnLabel(btnEl, text) {
  if (!btnEl) return;
  const labelEl =
    btnEl.querySelector && btnEl.querySelector('.mantine-Button-label');
  if (labelEl) labelEl.textContent = text;
  else btnEl.textContent = text;
}

function refreshTickerStatsLabel() {
  const statsEl = document.getElementById('setting-ticker-stats-text');
  if (!statsEl) return;
  const stats = getTickerStats();
  const countStr = stats && stats.totalCount ? stats.totalCount.toLocaleString() : '9,600+';
  statsEl.textContent = t('settings.tickerStats', { count: countStr });
}

function refreshUpdateStatusUI(nextState = null) {
  if (nextState && typeof nextState === 'object') {
    currentUpdateState = {
      ...currentUpdateState,
      ...nextState
    };
  }

  const statusEl = document.getElementById('setting-update-status-text');
  const btnCheck = document.getElementById('btn-check-updates');
  const btnSettings = document.getElementById('btn-settings');

  const curVer = currentUpdateState.currentVersion || '1.1.1';
  const latestVer = currentUpdateState.latestVersion || curVer;
  const state = currentUpdateState.state || 'idle';
  const hasUpdate = !!(currentUpdateState.updateAvailable || state === 'downloaded');

  if (btnSettings) {
    btnSettings.classList.toggle('has-update-badge', hasUpdate);
  }

  if (state === 'checking') {
    if (statusEl) statusEl.textContent = t('settings.autoUpdateSubtitle', { version: curVer });
    if (btnCheck) {
      btnCheck.disabled = true;
      btnCheck.classList.remove('is-update-available', 'is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.checkingUpdatesBtn'));
    }
    return;
  }

  if (state === 'downloading') {
    const rawPct =
      typeof currentUpdateState.percent === 'number'
        ? currentUpdateState.percent
        : currentUpdateState.progress || 0;
    const pct = Math.max(0, Math.min(100, Math.round(rawPct)));
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateDownloadingSubtitle', {
        version: latestVer,
        percent: pct
      });
    }
    if (btnCheck) {
      btnCheck.disabled = true;
      btnCheck.classList.add('is-update-available');
      btnCheck.classList.remove('is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.downloadingUpdateBtn', { percent: pct }));
    }
    return;
  }

  if (state === 'downloaded') {
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateReadySubtitle', { version: latestVer });
    }
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.classList.remove('is-update-available');
      btnCheck.classList.add('is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.installUpdateBtn', { version: latestVer }));
    }
    return;
  }

  if (currentUpdateState.updateAvailable || state === 'available') {
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateAvailableSubtitle', {
        latest: latestVer,
        current: curVer
      });
    }
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.classList.add('is-update-available');
      btnCheck.classList.remove('is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.downloadUpdateBtn', { version: latestVer }));
    }
    return;
  }

  if (state === 'up-to-date') {
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateUpToDateSubtitle', { version: curVer });
    }
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.classList.remove('is-update-available', 'is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.checkUpdatesBtn'));
    }
    return;
  }

  if (statusEl) {
    statusEl.textContent = t('settings.autoUpdateSubtitle', { version: curVer });
  }
  if (btnCheck) {
    btnCheck.disabled = false;
    btnCheck.classList.remove('is-update-available', 'is-update-ready');
    setMantineBtnLabel(btnCheck, t('settings.checkUpdatesBtn'));
  }
}

async function runSilentUpdateCheck() {
  if (!ipcRenderer || !getAutoCheckUpdates()) return;
  try {
    const res = await ipcRenderer.invoke('check-for-updates', { silent: true });
    if (res && res.ok) {
      refreshUpdateStatusUI(res);
      if (res.updateAvailable && res.latestVersion) {
        showToast(
          t('settings.toastUpdateAvailable', { version: res.latestVersion }),
          'info',
          4500
        );
      }
    }
  } catch (e) {
    // Ignore background update check network errors
  }
}

function startAutoUpdateCheck() {
  if (!ipcRenderer) return;
  ipcRenderer
    .invoke('get-update-state')
    .then((state) => {
      if (state && typeof state === 'object') {
        refreshUpdateStatusUI(state);
      }
    })
    .catch(() => {});

  if (autoUpdateIntervalId) {
    clearInterval(autoUpdateIntervalId);
  }
  // Check periodically every 4 hours when autoCheckUpdates is enabled
  autoUpdateIntervalId = setInterval(() => {
    runSilentUpdateCheck();
  }, 4 * 60 * 60 * 1000);

  if (process.env.THEYSAY_BACKGROUND_TEST !== '1') {
    setTimeout(() => {
      runSilentUpdateCheck();
    }, 3500);
  }
}

function loadCurrentSettings() {
  const languageSelect = document.getElementById('setting-language');
  if (languageSelect) {
    languageSelect.value = getLanguage();
  }

  INTERVAL_CONTROLS.forEach(({ selectId, wrapId, inputId, get }) => {
    const selectEl = document.getElementById(selectId);
    const wrapEl = document.getElementById(wrapId);
    const inputEl = document.getElementById(inputId);
    if (selectEl && wrapEl && inputEl) {
      populateSelectAndInput(selectEl, wrapEl, inputEl, get());
    }
  });

  BOOL_SELECT_CONTROLS.forEach(({ id, get }) => {
    const selectEl = document.getElementById(id);
    if (selectEl) {
      selectEl.value = get() ? 'true' : 'false';
    }
  });

  syncFilterKeywordsControl(getFilterKeywords());
  syncShortcutsControl(getLayoutUndoShortcut(), getLayoutRedoShortcut());
  syncAppearanceInputsForActiveMode({ liveApply: false });
  setTickerColorInputs(getTickerFgColor(), getTickerBgColor());
  refreshTickerStatsLabel();
  refreshUpdateStatusUI();
}

function openSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

  setActiveLanguageOverride(null);
  loadCurrentSettings();
  overlay.classList.remove('is-closed');
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.classList.add('active');
}

function closeSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

  cancelShortcutRecording();
  commitPendingFilterKeywordsInput({ triggerSave: true });
  overlay.classList.add('is-closed');
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.classList.remove('active');
}

function readColorFromInputs(colorId, hexId, fallback) {
  const colorInput = document.getElementById(colorId);
  const hexInput = document.getElementById(hexId);
  return normalizeHexColor(
    hexInput ? hexInput.value : (colorInput && colorInput.value),
    fallback
  );
}

function getFormSettingsOverrides() {
  if (!isSettingsModalOpen()) return {};

  const languageSelect = document.getElementById('setting-language');
  const language =
    languageSelect && (languageSelect.value === 'zh' || languageSelect.value === 'en')
      ? languageSelect.value
      : getLanguage();

  const overrides = { language };

  INTERVAL_CONTROLS.forEach(({ key, selectId, inputId, get, normalize }) => {
    const selectEl = document.getElementById(selectId);
    const inputEl = document.getElementById(inputId);
    let mins = get();
    if (selectEl) {
      if (selectEl.value === 'custom' && inputEl) {
        const val = parseFloat(inputEl.value);
        if (!isNaN(val) && val > 0) mins = normalize(val);
      } else {
        const val = parseFloat(selectEl.value);
        if (!isNaN(val) && val > 0) mins = val;
      }
    }
    overrides[key] = mins;
  });

  BOOL_SELECT_CONTROLS.forEach(({ key, id, get }) => {
    const selectEl = document.getElementById(id);
    overrides[key] = selectEl ? selectEl.value === 'true' : get();
  });

  overrides.filterKeywords =
    typeof window !== 'undefined' && window.__THEYSAY_FILTER_KEYWORDS_BRIDGE
      ? window.__THEYSAY_FILTER_KEYWORDS_BRIDGE.getKeywords()
      : getFilterKeywords();
  const currentShortcuts =
    typeof window !== 'undefined' && window.__THEYSAY_SHORTCUTS_BRIDGE
      ? window.__THEYSAY_SHORTCUTS_BRIDGE.getShortcuts()
      : { undo: getLayoutUndoShortcut(), redo: getLayoutRedoShortcut() };
  overrides.layoutUndoShortcut = currentShortcuts.undo;
  overrides.layoutRedoShortcut = currentShortcuts.redo;
  overrides.headerBgColor = readColorFromInputs(
    'setting-header-bg-color',
    'setting-header-bg-hex',
    getHeaderBgColor()
  );
  overrides.chatBgColor = readColorFromInputs(
    'setting-chat-bg-color',
    'setting-chat-bg-hex',
    getChatBgColor()
  );
  overrides.bubbleBgColor = readColorFromInputs(
    'setting-bubble-bg-color',
    'setting-bubble-bg-hex',
    getBubbleBgColor()
  );
  overrides.tickerFgColor = readColorFromInputs(
    'setting-ticker-fg-color',
    'setting-ticker-fg-hex',
    getTickerFgColor()
  );
  overrides.tickerBgColor = readColorFromInputs(
    'setting-ticker-bg-color',
    'setting-ticker-bg-hex',
    getTickerBgColor()
  );

  return overrides;
}

function bindColorPair(colorInputEl, hexInputEl, defaultColor, onCommit) {
  if (!colorInputEl || !hexInputEl) return;
  colorInputEl.addEventListener('input', () => {
    const hex = normalizeHexColor(colorInputEl.value, defaultColor);
    hexInputEl.value = hex;
    onCommit(hex);
  });
  hexInputEl.addEventListener('input', () => {
    const raw = hexInputEl.value.trim();
    const parsed = raw ? colord(raw) : null;
    if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
      const hex = parsed.toHex();
      colorInputEl.value = hex;
      onCommit(hex);
    }
  });
  hexInputEl.addEventListener('blur', () => {
    const norm = normalizeHexColor(hexInputEl.value, colorInputEl.value || defaultColor);
    hexInputEl.value = norm;
    colorInputEl.value = norm;
    onCommit(norm);
  });
}

function initSettings({ onSave, onExportProfile, onImportProfile, onLanguageChange } = {}) {
  if (typeof onLanguageChange === 'function') {
    onLanguageChangeCallback = onLanguageChange;
  }
  if (typeof onSave === 'function') {
    onSaveCallback = onSave;
  }
  if (isInitialized) return;
  isInitialized = true;

  if (typeof window !== 'undefined') {
    window.__THEYSAY_ON_FILTER_KEYWORDS_CHANGE = (nextKeywords) => {
      saveFilterKeywords(nextKeywords);
      notifySaved();
    };
    window.__THEYSAY_ON_SHORTCUTS_CHANGE = ({ undo, redo } = {}) => {
      const savedUndo = saveLayoutUndoShortcut(undo);
      const savedRedo = saveLayoutRedoShortcut(redo);
      syncShortcutsControl(savedUndo, savedRedo);
      notifySaved();
    };
    window.__THEYSAY_ON_SHORTCUT_RECORDING_CHANGE = (active) => {
      setMainShortcutRecording(Boolean(active));
    };
    window.__THEYSAY_ON_SHORTCUT_RECORDING_CANCEL = () => {
      suppressEscCloseUntil = Date.now() + 200;
    };
    window.__THEYSAY_ON_SHORTCUT_ERROR = (reason) => {
      if (reason === 'duplicate') {
        showToast(t('settings.toastShortcutDuplicate'), 'warning', 2500);
      } else if (reason === 'reserved') {
        showToast(t('settings.toastShortcutReserved'), 'warning', 2500);
      } else {
        showToast(t('settings.toastShortcutNeedsModifier'), 'warning', 2500);
      }
    };
    window.__THEYSAY_ON_THEME_MODE_CHANGE = (nextPref) => {
      applyTheme(nextPref);
      // Defer one tick so React re-renders mode-specific swatches/palettes before marking active chips
      setTimeout(() => {
        syncAppearanceInputsForActiveMode({ liveApply: false });
      }, 0);
    };
    window.__THEYSAY_ON_THEME_PALETTE_SELECT = (paletteId) => {
      const mode = getEffectiveTheme();
      const applied = applyThemePalettePreset(paletteId, mode);
      if (applied) {
        syncAppearanceInputsForActiveMode({ liveApply: false });
      }
    };
    window.addEventListener('theysay:theme-changed', () => {
      setTimeout(() => {
        syncAppearanceInputsForActiveMode({ liveApply: false });
      }, 0);
    });
  }
  syncFilterKeywordsControl(getFilterKeywords());
  syncShortcutsControl(getLayoutUndoShortcut(), getLayoutRedoShortcut());

  const btnSettings = document.getElementById('btn-settings');
  const overlay = getOverlay();
  const btnClose = document.getElementById('btn-settings-close');
  const btnReset = document.getElementById('btn-settings-reset');
  const languageSelect = document.getElementById('setting-language');
  const btnSyncTickers = document.getElementById('btn-sync-tickers');
  const btnCheckUpdates = document.getElementById('btn-check-updates');
  const btnExportProfile = document.getElementById('btn-export-profile');
  const btnImportProfile = document.getElementById('btn-import-profile');

  if (languageSelect) {
    languageSelect.addEventListener('change', () => {
      const nextLang = languageSelect.value === 'zh' ? 'zh' : 'en';
      saveLanguage(nextLang);
      refreshTickerStatsLabel();
      refreshUpdateStatusUI();
      if (typeof onLanguageChangeCallback === 'function') {
        onLanguageChangeCallback(nextLang);
      }
    });
  }

  if (btnCheckUpdates && ipcRenderer) {
    btnCheckUpdates.addEventListener('click', async () => {
      if (
        btnCheckUpdates.disabled ||
        currentUpdateState.state === 'checking' ||
        currentUpdateState.state === 'downloading'
      ) {
        return;
      }

      if (currentUpdateState.state === 'downloaded') {
        const targetVer =
          currentUpdateState.latestVersion || currentUpdateState.currentVersion || '1.1.1';
        showToast(t('settings.toastUpdateInstalling', { version: targetVer }), 'info', 3000);
        try {
          const res = await ipcRenderer.invoke('apply-downloaded-update');
          if (res && !res.ok && res.error) {
            showToast(t('settings.toastUpdateError', { error: res.error }), 'error', 3500);
          }
        } catch (err) {
          showToast(
            t('settings.toastUpdateError', { error: err.message || String(err) }),
            'error',
            3500
          );
        }
        return;
      }

      if (currentUpdateState.updateAvailable || currentUpdateState.state === 'available') {
        refreshUpdateStatusUI({ state: 'downloading', progress: 0 });
        try {
          const res = await ipcRenderer.invoke('download-update');
          if (res && res.ok) {
            refreshUpdateStatusUI({
              state: 'downloaded',
              latestVersion: res.version || currentUpdateState.latestVersion,
              progress: 100
            });
            showToast(
              t('settings.toastUpdateDownloaded', {
                version: res.version || currentUpdateState.latestVersion || '1.1.1'
              }),
              'success',
              3500
            );
          } else {
            refreshUpdateStatusUI({ state: 'available' });
            showToast(
              t('settings.toastUpdateError', {
                error: (res && res.error) || t('settings.networkErrorFallback')
              }),
              'error',
              3500
            );
          }
        } catch (err) {
          refreshUpdateStatusUI({ state: 'available' });
          showToast(
            t('settings.toastUpdateError', { error: err.message || String(err) }),
            'error',
            3500
          );
        }
        return;
      }

      refreshUpdateStatusUI({ state: 'checking' });
      try {
        const res = await ipcRenderer.invoke('check-for-updates', { silent: false });
        if (res && res.ok) {
          refreshUpdateStatusUI(res);
          if (res.updateAvailable) {
            showToast(
              t('settings.toastUpdateAvailable', { version: res.latestVersion }),
              'info',
              4000
            );
          } else {
            showToast(
              t('settings.toastUpToDate', {
                version: res.currentVersion || currentUpdateState.currentVersion
              }),
              'success',
              2500
            );
          }
        } else {
          refreshUpdateStatusUI(res || { state: 'error' });
          showToast(
            t('settings.toastUpdateError', {
              error: (res && res.error) || t('settings.networkErrorFallback')
            }),
            'warning',
            3000
          );
        }
      } catch (err) {
        refreshUpdateStatusUI({ state: 'error' });
        showToast(
          t('settings.toastUpdateError', { error: err.message || String(err) }),
          'warning',
          3000
        );
      }
    });
  }

  if (btnExportProfile) {
    btnExportProfile.addEventListener('click', () => {
      commitPendingFilterKeywordsInput({ triggerSave: true });
      if (typeof onExportProfile === 'function') {
        onExportProfile(getFormSettingsOverrides());
      }
    });
  }

  if (btnImportProfile) {
    btnImportProfile.addEventListener('click', () => {
      if (typeof onImportProfile === 'function') {
        onImportProfile();
      }
    });
  }

  if (btnSettings) {
    btnSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSettingsModalOpen()) {
        closeSettingsModal();
      } else {
        openSettingsModal();
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => closeSettingsModal());
  }

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeSettingsModal();
      }
    });
  }

  INTERVAL_CONTROLS.forEach(({ selectId, wrapId, inputId, get, save, normalize, errKey }) => {
    const selectEl = document.getElementById(selectId);
    const wrapEl = document.getElementById(wrapId);
    const inputEl = document.getElementById(inputId);
    if (!selectEl || !wrapEl || !inputEl) return;

    selectEl.addEventListener('change', () => {
      syncCustomVisibility(selectEl, wrapEl);
      if (selectEl.value === 'custom') {
        inputEl.focus();
        inputEl.select();
        const val = parseFloat(inputEl.value);
        if (!isNaN(val) && val > 0) {
          save(normalize(val));
          notifySaved();
        }
      } else {
        const mins = parseFloat(selectEl.value);
        if (!isNaN(mins) && mins > 0) {
          save(mins);
          notifySaved();
        }
      }
    });

    const commitCustom = () => {
      const val = parseFloat(inputEl.value);
      if (isNaN(val) || val <= 0) {
        showToast(t(errKey), 'error', 2500);
        inputEl.value = get();
        return;
      }
      const mins = normalize(val);
      inputEl.value = mins;
      save(mins);
      notifySaved();
    };

    inputEl.addEventListener('change', commitCustom);
    inputEl.addEventListener('blur', commitCustom);
  });

  BOOL_SELECT_CONTROLS.forEach(({ id, save }) => {
    const selectEl = document.getElementById(id);
    if (!selectEl) return;
    selectEl.addEventListener('change', () => {
      save(selectEl.value === 'true');
      notifySaved();
    });
  });

  const commitHeaderBg = (bg) => {
    const mode = getEffectiveTheme();
    const fallback = mode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
    const norm = normalizeHexColor(bg, fallback);
    saveHeaderBgColor(norm, mode);
    updateHeaderPreviewUI(norm, { liveApply: true });
  };

  bindColorPair(
    document.getElementById('setting-header-bg-color'),
    document.getElementById('setting-header-bg-hex'),
    DEFAULT_HEADER_BG_COLOR,
    commitHeaderBg
  );

  const headerPresetsWrap = document.getElementById('setting-header-presets');
  if (headerPresetsWrap) {
    headerPresetsWrap.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.header-preset-chip') : null;
      if (!btn) return;
      const mode = getEffectiveTheme();
      const fallback = mode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
      const bg = normalizeHexColor(btn.getAttribute('data-bg'), fallback);
      saveHeaderBgColor(bg, mode);
      setHeaderColorInputs(bg, { liveApply: true });
    });
  }

  const commitChatBg = (bg) => {
    const mode = getEffectiveTheme();
    const fallback = mode === 'dark' ? DEFAULT_DARK_CHAT_BG_COLOR : DEFAULT_CHAT_BG_COLOR;
    const norm = normalizeHexColor(bg, fallback);
    saveChatBgColor(norm, mode);
    updateChatBgPreviewUI(norm, { liveApply: true });
  };

  bindColorPair(
    document.getElementById('setting-chat-bg-color'),
    document.getElementById('setting-chat-bg-hex'),
    DEFAULT_CHAT_BG_COLOR,
    commitChatBg
  );

  const chatBgPresetsWrap = document.getElementById('setting-chat-bg-presets');
  if (chatBgPresetsWrap) {
    chatBgPresetsWrap.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.chat-bg-preset-chip') : null;
      if (!btn) return;
      const mode = getEffectiveTheme();
      const fallback = mode === 'dark' ? DEFAULT_DARK_CHAT_BG_COLOR : DEFAULT_CHAT_BG_COLOR;
      const bg = normalizeHexColor(btn.getAttribute('data-bg'), fallback);
      saveChatBgColor(bg, mode);
      setChatBgColorInputs(bg, { liveApply: true });
    });
  }

  const commitBubbleBg = (bg) => {
    const mode = getEffectiveTheme();
    const fallback = mode === 'dark' ? DEFAULT_DARK_BUBBLE_BG_COLOR : DEFAULT_BUBBLE_BG_COLOR;
    const norm = normalizeHexColor(bg, fallback);
    saveBubbleBgColor(norm, mode);
    updateBubbleBgPreviewUI(norm, { liveApply: true });
  };

  bindColorPair(
    document.getElementById('setting-bubble-bg-color'),
    document.getElementById('setting-bubble-bg-hex'),
    DEFAULT_BUBBLE_BG_COLOR,
    commitBubbleBg
  );

  const bubbleBgPresetsWrap = document.getElementById('setting-bubble-bg-presets');
  if (bubbleBgPresetsWrap) {
    bubbleBgPresetsWrap.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.bubble-bg-preset-chip') : null;
      if (!btn) return;
      const mode = getEffectiveTheme();
      const fallback = mode === 'dark' ? DEFAULT_DARK_BUBBLE_BG_COLOR : DEFAULT_BUBBLE_BG_COLOR;
      const bg = normalizeHexColor(btn.getAttribute('data-bg'), fallback);
      saveBubbleBgColor(bg, mode);
      setBubbleBgColorInputs(bg, { liveApply: true });
    });
  }

  const commitTickerState = () => {
    const fg = readColorFromInputs('setting-ticker-fg-color', 'setting-ticker-fg-hex', DEFAULT_TICKER_FG_COLOR);
    const bg = readColorFromInputs('setting-ticker-bg-color', 'setting-ticker-bg-hex', DEFAULT_TICKER_BG_COLOR);
    saveTickerFgColor(fg);
    saveTickerBgColor(bg);
    applyTickerColors(fg, bg);
    updateTickerPreviewUI(fg, bg);
  };

  bindColorPair(
    document.getElementById('setting-ticker-fg-color'),
    document.getElementById('setting-ticker-fg-hex'),
    DEFAULT_TICKER_FG_COLOR,
    commitTickerState
  );
  bindColorPair(
    document.getElementById('setting-ticker-bg-color'),
    document.getElementById('setting-ticker-bg-hex'),
    DEFAULT_TICKER_BG_COLOR,
    commitTickerState
  );

  document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const fg = btn.getAttribute('data-fg') || DEFAULT_TICKER_FG_COLOR;
      const bg = btn.getAttribute('data-bg') || DEFAULT_TICKER_BG_COLOR;
      setTickerColorInputs(fg, bg);
      commitTickerState();
    });
  });

  if (btnSyncTickers) {
    btnSyncTickers.addEventListener('click', async () => {
      if (btnSyncTickers.disabled) return;
      btnSyncTickers.disabled = true;
      setMantineBtnLabel(btnSyncTickers, t('settings.syncing'));
      try {
        const res = await syncOnlineTickers({ force: true });
        refreshTickerStatsLabel();
        if (res && res.ok) {
          showToast(
            t('settings.toastSyncSuccess', { count: (res.totalCount || 0).toLocaleString() }),
            'success',
            2500
          );
          if (typeof onSave === 'function') {
            onSave({ syncedTickersOnly: true });
          }
        } else {
          showToast(
            t('settings.toastSyncError', { error: (res && res.error) || t('settings.networkErrorFallback') }),
            'warning',
            2500
          );
        }
      } finally {
        btnSyncTickers.disabled = false;
        setMantineBtnLabel(btnSyncTickers, t('settings.syncOnlineBtn'));
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      clearStoredLanguage();
      const sysLang = detectSystemLanguage();
      if (languageSelect) {
        languageSelect.value = sysLang;
      }

      INTERVAL_CONTROLS.forEach(({ selectId, wrapId, inputId, save, defaultVal }) => {
        save(defaultVal);
        const selectEl = document.getElementById(selectId);
        const wrapEl = document.getElementById(wrapId);
        const inputEl = document.getElementById(inputId);
        if (selectEl && wrapEl && inputEl) {
          populateSelectAndInput(selectEl, wrapEl, inputEl, defaultVal);
        }
      });

      BOOL_SELECT_CONTROLS.forEach(({ id, save, defaultVal }) => {
        save(defaultVal);
        const selectEl = document.getElementById(id);
        if (selectEl) {
          selectEl.value = defaultVal ? 'true' : 'false';
        }
      });

      saveFilterKeywords(DEFAULT_FILTER_KEYWORDS);
      syncFilterKeywordsControl(DEFAULT_FILTER_KEYWORDS);

      cancelShortcutRecording();
      saveLayoutUndoShortcut(DEFAULT_UNDO_SHORTCUT);
      saveLayoutRedoShortcut(DEFAULT_REDO_SHORTCUT);
      syncShortcutsControl(DEFAULT_UNDO_SHORTCUT, DEFAULT_REDO_SHORTCUT);

      resetAllAppearanceColors();
      const activeMode = getEffectiveTheme();
      applyModeAppearance(activeMode);
      saveTickerFgColor(DEFAULT_TICKER_FG_COLOR);
      saveTickerBgColor(DEFAULT_TICKER_BG_COLOR);
      applyTickerColors(DEFAULT_TICKER_FG_COLOR, DEFAULT_TICKER_BG_COLOR);

      syncAppearanceInputsForActiveMode({ liveApply: true });
      setTickerColorInputs(DEFAULT_TICKER_FG_COLOR, DEFAULT_TICKER_BG_COLOR);

      if (typeof onLanguageChangeCallback === 'function') {
        onLanguageChangeCallback(sysLang);
      }
      refreshShortcutsLocaleUI();
      refreshTickerStatsLabel();
      refreshUpdateStatusUI();
      notifySaved();
      showToast(t('settings.toastResetDefaults'), 'success', 2000);
    });
  }

  const handleEscKey = (e) => {
    if (e.key === 'Escape' && isSettingsModalOpen()) {
      if (isShortcutRecording()) {
        e.preventDefault();
        e.stopPropagation();
        cancelShortcutRecording({ suppressEsc: true });
        return;
      }
      if (Date.now() < suppressEscCloseUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeSettingsModal();
    }
  };

  window.addEventListener('keydown', handleEscKey, true);
  document.addEventListener('keydown', handleEscKey, true);

  if (ipcRenderer) {
    ipcRenderer.on('global-escape', () => {
      if (!isSettingsModalOpen()) return;
      if (isShortcutRecording()) {
        cancelShortcutRecording({ suppressEsc: true });
        return;
      }
      if (Date.now() < suppressEscCloseUntil) return;
      closeSettingsModal();
    });
    ipcRenderer.on('update-status', (event, status) => {
      if (status && typeof status === 'object') {
        refreshUpdateStatusUI(status);
      }
    });
  }

  refreshUpdateStatusUI();
}

module.exports = {
  initSettings,
  openSettingsModal,
  closeSettingsModal,
  isSettingsModalOpen,
  loadCurrentSettings,
  getFormSettingsOverrides,
  refreshTickerStatsLabel,
  refreshUpdateStatusUI,
  refreshShortcutsLocaleUI,
  startAutoUpdateCheck
};
