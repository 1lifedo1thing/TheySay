const { colord } = require('colord');
const {
  DEFAULT_HEADER_BG_COLOR,
  DEFAULT_DARK_HEADER_BG_COLOR,
  DEFAULT_CHAT_BG_COLOR,
  DEFAULT_DARK_CHAT_BG_COLOR,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_DARK_BUBBLE_BG_COLOR,
  HEADER_COLOR_PRESETS,
  THEME_PALETTE_PRESETS
} = require('../core/constants');
const {
  normalizeThemePreference,
  resolveEffectiveTheme,
  getEffectiveTheme,
  getStoredTheme,
  saveStoredTheme,
  getModeAppearanceColors,
  saveModeAppearanceColors,
  syncLegacyAppearanceKeysForMode,
  getHeaderBgColor,
  getChatBgColor,
  getBubbleBgColor
} = require('../core/storage');
const { clearPostWidgetCache } = require('./popup');
const { t } = require('../core/i18n');

let themeListenersBound = false;

function getIpcRenderer() {
  try {
    const electron = require('electron');
    return electron && electron.ipcRenderer ? electron.ipcRenderer : null;
  } catch (_) {
    return null;
  }
}

function syncNativeThemePreference(preference, { persist = true } = {}) {
  const pref = normalizeThemePreference(preference);
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return null;
  try {
    if (typeof ipcRenderer.sendSync === 'function') {
      return ipcRenderer.sendSync('set-theme-preference-sync', {
        preference: pref,
        persist
      });
    }
    if (typeof ipcRenderer.send === 'function') {
      ipcRenderer.send('set-theme-preference', {
        preference: pref,
        persist
      });
    }
  } catch (_) {}
  return null;
}

function getActiveEffectiveTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  return getEffectiveTheme();
}

function normalizeHexColor(val, fallback = DEFAULT_HEADER_BG_COLOR) {
  const str = String(val || '').trim();
  if (/^#?[0-9A-Fa-f]{6}$/.test(str)) {
    const parsed = colord(str.startsWith('#') ? str : `#${str}`);
    if (parsed.isValid()) return parsed.toHex();
  }
  return fallback;
}

function resolveHeaderPalette(bgHex, mode) {
  const effectiveMode = getActiveEffectiveTheme(mode);
  const fallback =
    effectiveMode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
  const bg = normalizeHexColor(bgHex, fallback);
  const preset = HEADER_COLOR_PRESETS.find((p) => p.bg.toLowerCase() === bg);
  if (preset) {
    return { ...preset, name: t(`settings.colorPreset.${preset.id}`) };
  }

  const color = colord(bg);
  const isDark = color.brightness() < 0.55;

  if (isDark) {
    return {
      id: 'custom',
      name: t('settings.customColor'),
      bg,
      text: '#f4f7fa',
      subtext: 'rgba(226, 232, 240, 0.72)',
      border: color.darken(0.12).toHex(),
      hoverBg: 'rgba(255, 255, 255, 0.1)',
      activeIcon: '#38bdf8',
      activeBg: 'rgba(56, 189, 248, 0.2)',
      badgeBorder: 'rgba(255, 255, 255, 0.8)'
    };
  }

  return {
    id: 'custom',
    name: t('settings.customColor'),
    bg,
    text: '#0f1419',
    subtext: '#787b86',
    border: color.darken(0.08).toHex(),
    hoverBg: 'rgba(15, 23, 42, 0.07)',
    activeIcon: '#1d9bf0',
    activeBg: 'rgba(29, 155, 240, 0.15)',
    badgeBorder: 'transparent'
  };
}

function buildHeaderSurfaceGradient(bgHex, mode) {
  const effectiveMode = getActiveEffectiveTheme(mode);
  const fallback =
    effectiveMode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
  const norm = normalizeHexColor(bgHex, fallback);
  const { r, g, b } = colord(norm).toRgb();
  return [
    'linear-gradient(180deg',
    `rgba(${r}, ${g}, ${b}, 1) 0%`,
    `rgba(${r}, ${g}, ${b}, 1) 78%`,
    `rgba(${r}, ${g}, ${b}, 0.86) 84%`,
    `rgba(${r}, ${g}, ${b}, 0.54) 90%`,
    `rgba(${r}, ${g}, ${b}, 0.2) 96%`,
    `rgba(${r}, ${g}, ${b}, 0) 100%)`
  ].join(', ');
}

function resolveChatBgPalette(bgHex, mode) {
  const effectiveMode = getActiveEffectiveTheme(mode);
  const fallback =
    effectiveMode === 'dark' ? DEFAULT_DARK_CHAT_BG_COLOR : DEFAULT_CHAT_BG_COLOR;
  const bg = normalizeHexColor(bgHex, fallback);
  const color = colord(bg);
  const isDark = color.brightness() < 0.55;
  return {
    bg,
    isDark,
    text: isDark ? '#f4f7fa' : '#131722',
    subtext: isDark ? '#8696a7' : '#787b86',
    pillBg: isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(19, 23, 34, 0.055)'
  };
}

function applyHeaderColor(bgHex, mode) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const effectiveMode = getActiveEffectiveTheme(mode);
  const fallback =
    effectiveMode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
  const norm = normalizeHexColor(bgHex, fallback);
  const root = document.documentElement;
  root.style.setProperty('--slot-header-bg', norm);
  root.style.setProperty('--slot-header-surface', buildHeaderSurfaceGradient(norm, effectiveMode));

  const currentChatBg = normalizeHexColor(
    getChatBgColor(effectiveMode),
    effectiveMode === 'dark' ? DEFAULT_DARK_CHAT_BG_COLOR : DEFAULT_CHAT_BG_COLOR
  );
  if (norm === currentChatBg) {
    const seamlessPalette = resolveChatBgPalette(norm, effectiveMode);
    root.style.setProperty('--slot-header-text', seamlessPalette.text);
    root.style.setProperty('--slot-header-subtext', seamlessPalette.subtext);
    root.style.setProperty('--slot-header-pill-bg', seamlessPalette.pillBg);
    root.style.setProperty('--slot-header-border', 'transparent');
    root.style.setProperty(
      '--slot-header-hover-bg',
      seamlessPalette.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(19, 23, 34, 0.06)'
    );
    root.style.setProperty('--slot-header-active-icon', '#2962ff');
    root.style.setProperty('--slot-header-active-bg', 'rgba(41, 98, 255, 0.12)');
    root.style.setProperty('--slot-header-badge-border', 'transparent');
    return;
  }

  const palette = resolveHeaderPalette(norm, effectiveMode);
  const headerIsDark = colord(norm).brightness() < 0.55;
  root.style.setProperty('--slot-header-text', palette.text);
  root.style.setProperty('--slot-header-subtext', palette.subtext);
  root.style.setProperty(
    '--slot-header-pill-bg',
    headerIsDark ? 'rgba(255, 255, 255, 0.11)' : 'rgba(19, 23, 34, 0.055)'
  );
  root.style.setProperty('--slot-header-border', palette.border);
  root.style.setProperty('--slot-header-hover-bg', palette.hoverBg);
  root.style.setProperty('--slot-header-active-icon', palette.activeIcon);
  root.style.setProperty('--slot-header-active-bg', palette.activeBg);
  root.style.setProperty('--slot-header-badge-border', palette.badgeBorder || 'transparent');
}

function applyChatBgColor(bgHex, mode) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const effectiveMode = getActiveEffectiveTheme(mode);
  const palette = resolveChatBgPalette(bgHex, effectiveMode);
  const root = document.documentElement;
  root.style.setProperty('--bg-card', palette.bg);
  root.style.setProperty('--slot-header-pill-bg', palette.pillBg);

  const headerBg = normalizeHexColor(
    getHeaderBgColor(effectiveMode),
    effectiveMode === 'dark' ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR
  );
  if (headerBg === palette.bg) {
    root.style.setProperty('--slot-header-surface', buildHeaderSurfaceGradient(headerBg, effectiveMode));
    root.style.setProperty('--slot-header-text', palette.text);
    root.style.setProperty('--slot-header-subtext', palette.subtext);
    root.style.setProperty('--slot-header-border', 'transparent');
    root.style.setProperty(
      '--slot-header-hover-bg',
      palette.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(19, 23, 34, 0.06)'
    );
  }
}

function resolveBubblePalette(bgHex, mode) {
  const effectiveMode = getActiveEffectiveTheme(mode);
  const fallback =
    effectiveMode === 'dark' ? DEFAULT_DARK_BUBBLE_BG_COLOR : DEFAULT_BUBBLE_BG_COLOR;
  const bg = normalizeHexColor(bgHex, fallback);
  const color = colord(bg);
  const isDark = color.brightness() < 0.55;
  const rgb = color.toRgb();
  const ratio = isDark ? 0.22 : 0.14;
  const unreadBg =
    bg === '#ffffff'
      ? '#e7f3fd'
      : bg === '#172332'
        ? '#163650'
        : colord({
            r: Math.round(rgb.r * (1 - ratio) + 29 * ratio),
            g: Math.round(rgb.g * (1 - ratio) + 155 * ratio),
            b: Math.round(rgb.b * (1 - ratio) + 240 * ratio)
          }).toHex();
  return {
    bg,
    isDark,
    hoverBg: isDark ? color.lighten(0.04).toHex() : color.darken(0.015).toHex(),
    border: isDark
      ? 'rgba(255, 255, 255, 0.07)'
      : color.darken(0.07).alpha(0.55).toRgbString(),
    borderHover: isDark
      ? 'rgba(255, 255, 255, 0.13)'
      : color.darken(0.12).alpha(0.75).toRgbString(),
    text: isDark ? '#e4e9ef' : '#0f1419',
    timeText: isDark ? '#8696a7' : '#536471',
    unreadBg,
    unreadBorder: isDark
      ? 'rgba(29, 155, 240, 0.45)'
      : 'rgba(29, 155, 240, 0.38)'
  };
}

function applyBubbleColor(bgHex, mode) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const effectiveMode = getActiveEffectiveTheme(mode);
  const palette = resolveBubblePalette(bgHex, effectiveMode);
  const root = document.documentElement;
  root.style.setProperty('--bg-bubble', palette.bg);
  root.style.setProperty('--bg-bubble-hover', palette.hoverBg);
  root.style.setProperty('--border-bubble', palette.border);
  root.style.setProperty('--border-bubble-hover', palette.borderHover);
  root.style.setProperty('--bubble-text-color', palette.text);
  root.style.setProperty('--bubble-time-color', palette.timeText);
  root.style.setProperty('--bg-bubble-unread', palette.unreadBg);
  root.style.setProperty('--border-bubble-unread', palette.unreadBorder);
}

function applyModeAppearance(mode) {
  const resolvedMode = getActiveEffectiveTheme(mode);
  const { headerBgColor, chatBgColor, bubbleBgColor } = getModeAppearanceColors(resolvedMode);
  applyChatBgColor(chatBgColor, resolvedMode);
  applyHeaderColor(headerBgColor, resolvedMode);
  applyBubbleColor(bubbleBgColor, resolvedMode);
  return { headerBgColor, chatBgColor, bubbleBgColor };
}

function applyThemePalettePreset(paletteId, mode) {
  const resolvedMode = getActiveEffectiveTheme(mode);
  const list = THEME_PALETTE_PRESETS[resolvedMode] || [];
  const palette = list.find((p) => p.id === paletteId);
  if (!palette) return null;
  saveModeAppearanceColors(
    {
      chatBgColor: palette.chatBg,
      bubbleBgColor: palette.bubbleBg,
      headerBgColor: palette.headerBg
    },
    resolvedMode
  );
  applyModeAppearance(resolvedMode);
  return palette;
}

function getThemeToggleTitle(preference, effectiveTheme) {
  if (preference === 'system') {
    return effectiveTheme === 'dark'
      ? t('nav.systemDarkSwitchToLight')
      : t('nav.systemLightSwitchToDark');
  }
  return effectiveTheme === 'light' ? t('nav.switchToDark') : t('nav.switchToLight');
}

function applyTheme(themePreference, btnThemeToggle, options = {}) {
  const pref = normalizeThemePreference(themePreference);
  const shouldPersist = options.persist !== false;

  const nativeState = syncNativeThemePreference(pref, { persist: shouldPersist });
  const systemIsDark =
    typeof options.systemIsDark === 'boolean'
      ? options.systemIsDark
      : nativeState && nativeState.themeSource === 'system' && typeof nativeState.shouldUseDarkColors === 'boolean'
        ? nativeState.shouldUseDarkColors
        : undefined;

  const effectiveTheme = resolveEffectiveTheme(pref, { systemIsDark });
  const prevEffective =
    typeof document !== 'undefined' && document.documentElement
      ? document.documentElement.getAttribute('data-theme')
      : null;

  if (shouldPersist) {
    saveStoredTheme(pref);
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.documentElement.setAttribute('data-theme-preference', pref);
    document.documentElement.setAttribute('data-mantine-color-scheme', effectiveTheme);
  }

  if (prevEffective && prevEffective !== effectiveTheme && typeof clearPostWidgetCache === 'function') {
    clearPostWidgetCache();
  }

  const toggleEl =
    btnThemeToggle ||
    (typeof document !== 'undefined' ? document.getElementById('btn-theme-toggle') : null);
  if (toggleEl) {
    toggleEl.setAttribute('aria-checked', effectiveTheme === 'dark' ? 'true' : 'false');
    toggleEl.setAttribute('data-theme-preference', pref);
    toggleEl.title = getThemeToggleTitle(pref, effectiveTheme);
  }

  syncLegacyAppearanceKeysForMode(effectiveTheme);
  applyModeAppearance(effectiveTheme);

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('theysay:theme-changed', {
        detail: {
          preference: pref,
          effectiveTheme
        }
      })
    );
  }

  return { preference: pref, effectiveTheme };
}

function initTheme(btnThemeToggle) {
  const savedPref = getStoredTheme();
  applyTheme(savedPref, btnThemeToggle, { persist: false });

  if (btnThemeToggle && !btnThemeToggle.dataset.themeBound) {
    btnThemeToggle.dataset.themeBound = '1';
    btnThemeToggle.addEventListener('click', () => {
      const curEffective =
        document.documentElement.getAttribute('data-theme') || getEffectiveTheme();
      const next = curEffective === 'dark' ? 'light' : 'dark';
      applyTheme(next, btnThemeToggle);
    });
  }

  if (!themeListenersBound) {
    themeListenersBound = true;

    const ipcRenderer = getIpcRenderer();
    if (ipcRenderer && typeof ipcRenderer.on === 'function') {
      ipcRenderer.on('system-theme-updated', (event, payload) => {
        if (getStoredTheme() !== 'system') return;
        const nextSystemIsDark =
          payload && typeof payload.shouldUseDarkColors === 'boolean'
            ? payload.shouldUseDarkColors
            : undefined;
        applyTheme('system', btnThemeToggle, {
          persist: false,
          systemIsDark: nextSystemIsDark
        });
      });
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const onMediaChange = (e) => {
          if (getStoredTheme() !== 'system') return;
          const nextEffective = e.matches ? 'dark' : 'light';
          if (document.documentElement.getAttribute('data-theme') !== nextEffective) {
            applyTheme('system', btnThemeToggle, {
              persist: false,
              systemIsDark: Boolean(e.matches)
            });
          }
        };
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', onMediaChange);
        } else if (typeof mql.addListener === 'function') {
          mql.addListener(onMediaChange);
        }
      } catch (_) {}
    }
  }
}

module.exports = {
  applyTheme,
  initTheme,
  applyModeAppearance,
  applyThemePalettePreset,
  applyHeaderColor,
  buildHeaderSurfaceGradient,
  resolveHeaderPalette,
  applyChatBgColor,
  resolveChatBgPalette,
  applyBubbleColor,
  resolveBubblePalette,
  normalizeHexColor,
  syncNativeThemePreference
};
