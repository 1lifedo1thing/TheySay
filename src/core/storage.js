const {
  MAX_SLOTS,
  DEFAULT_HANDLES,
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_TARGET_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_GRID_LAYOUT_KEY,
  STORAGE_THEME_KEY,
  STORAGE_LAST_FETCH_KEY,
  STORAGE_LAST_FETCH_TWITTER_KEY,
  STORAGE_LAST_FETCH_DISCORD_KEY,
  STORAGE_LAST_FETCH_THREADS_KEY,
  STORAGE_DISCORD_LOGIN_KEY,
  STORAGE_THREADS_LOGIN_KEY,
  STORAGE_TWITTER_EVER_LOGGED_IN_KEY,
  STORAGE_THREADS_EVER_LOGGED_IN_KEY,
  STORAGE_DISCORD_EVER_LOGGED_IN_KEY,
  STORAGE_TWITTER_LOGIN_EXPIRED_KEY,
  STORAGE_THREADS_LOGIN_EXPIRED_KEY,
  STORAGE_DISCORD_LOGIN_EXPIRED_KEY,
  STORAGE_TWITTER_INTERVAL_KEY,
  STORAGE_DISCORD_INTERVAL_KEY,
  STORAGE_THREADS_INTERVAL_KEY,
  STORAGE_SHOW_MEMBER_ONLY_KEY,
  STORAGE_DISCORD_SOUND_KEY,
  STORAGE_APP_BADGE_ENABLED_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_TICKER_FG_COLOR_KEY,
  STORAGE_TICKER_BG_COLOR_KEY,
  STORAGE_TICKER_REMOTE_CACHE_KEY,
  STORAGE_URL_TITLES_CACHE_KEY,
  STORAGE_HEADER_BG_COLOR_KEY,
  STORAGE_CHAT_BG_COLOR_KEY,
  STORAGE_BUBBLE_BG_COLOR_KEY,
  STORAGE_LIGHT_HEADER_BG_COLOR_KEY,
  STORAGE_LIGHT_CHAT_BG_COLOR_KEY,
  STORAGE_LIGHT_BUBBLE_BG_COLOR_KEY,
  STORAGE_DARK_HEADER_BG_COLOR_KEY,
  STORAGE_DARK_CHAT_BG_COLOR_KEY,
  STORAGE_DARK_BUBBLE_BG_COLOR_KEY,
  STORAGE_APPEARANCE_MIGRATED_KEY,
  STORAGE_LANGUAGE_KEY,
  STORAGE_FILTER_KEYWORDS_KEY,
  STORAGE_AUTO_CHECK_UPDATES_KEY,
  STORAGE_ONBOARDING_COMPLETED_KEY,
  STORAGE_UNDO_SHORTCUT_KEY,
  STORAGE_REDO_SHORTCUT_KEY,
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_THREADS_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_APP_BADGE_ENABLED,
  DEFAULT_AUTO_CHECK_UPDATES,
  DEFAULT_UNDO_SHORTCUT,
  DEFAULT_REDO_SHORTCUT,
  DEFAULT_SLOT_MUTED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  DEFAULT_HEADER_BG_COLOR,
  DEFAULT_DARK_HEADER_BG_COLOR,
  DEFAULT_CHAT_BG_COLOR,
  DEFAULT_DARK_CHAT_BG_COLOR,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_DARK_BUBBLE_BG_COLOR,
  DEFAULT_FILTER_KEYWORDS
} = require('./constants');
const { detectSourceType, getCanonicalTargetKey } = require('./source');
const { getPostKey, getPostTimestamp, parseFilterKeywordsInput } = require('./post');
const { getCurrentLanguage, setActiveLanguageOverride } = require('./i18n');
const { normalizeShortcut } = require('./shortcuts');
const { colord } = require('colord');

let fallbackMemoryDb = null;

function sanitizeForIpc(value) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return value;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const cleaned = sanitizeForIpc(value[i]);
      if (cleaned !== undefined) out.push(cleaned);
    }
    return out;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith('_')) continue;
    const cleaned = sanitizeForIpc(value[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function getFallbackHistoryDb() {
  if (!fallbackMemoryDb) {
    const { HistoryDatabase } = require('./history-db');
    fallbackMemoryDb = new HistoryDatabase(':memory:');
  }
  return fallbackMemoryDb;
}

function callHistoryDb(op, payload = {}) {
  try {
    const electron = require('electron');
    const ipcRenderer = electron && electron.ipcRenderer;
    if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
      const res = ipcRenderer.sendSync('history-db-sync', sanitizeForIpc({ op, ...payload }));
      if (res && res.ok) {
        return res.data;
      }
      return null;
    }
  } catch (_) {}

  // Fallback for direct Node unit tests without Electron IPC
  try {
    const db = getFallbackHistoryDb();
    switch (op) {
      case 'getSlotCache':
        return db.getSlotCache(payload.options || {});
      case 'saveSlotEntry':
        return db.saveSlotEntry(payload.slotIndex, payload.data);
      case 'saveAllSlotCache':
        return db.saveAllSlotCache(payload.cache);
      case 'getTargetCache':
        return db.getTargetCache(payload.options || {});
      case 'saveTargetCache':
        return db.saveTargetCache(payload.targetCache);
      case 'saveTargetEntry':
        return db.saveTargetEntry(payload.handleOrUrl, payload.data, payload.options || {});
      case 'getTargetEntry':
        return db.getTargetEntry(payload.handleOrUrl, payload.sourceHint, payload.options || {});
      case 'markTargetPostsRead':
        return db.markTargetPostsRead(
          payload.handleOrUrl,
          payload.sourceHint,
          payload.postKeys,
          payload.maxReadTimestamp
        );
      case 'markAllTargetPostsRead':
        return db.markAllTargetPostsRead(
          payload.handleOrUrl,
          payload.sourceHint,
          payload.maxReadTimestamp
        );
      case 'hasCachedPostsForSource':
        return db.hasCachedPostsForSource(payload.source);
      case 'migrateLegacyCaches':
        return db.migrateLegacyCaches({
          slotCache: payload.slotCache,
          targetCache: payload.targetCache
        });
      case 'clearAll':
        return db.clearAll();
      case 'getStats':
        return db.getStats();
      default:
        return null;
    }
  } catch (_) {
    return null;
  }
}

function migrateLegacyLocalStorageCachesIfNeeded() {
  try {
    if (typeof localStorage === 'undefined') return;
    const rawSlot = localStorage.getItem(STORAGE_CACHE_KEY);
    const rawTarget = localStorage.getItem(STORAGE_TARGET_CACHE_KEY);
    const rawTargetV1 = localStorage.getItem('theysay_target_cache_v1');
    if (rawSlot === null && rawTarget === null && rawTargetV1 === null) return;

    let slotCache = null;
    let targetCache = null;
    if (rawSlot) {
      try {
        const parsed = JSON.parse(rawSlot);
        if (parsed && typeof parsed === 'object') slotCache = parsed;
      } catch (_) {}
    }
    if (rawTarget) {
      try {
        const parsed = JSON.parse(rawTarget);
        if (parsed && typeof parsed === 'object') targetCache = parsed;
      } catch (_) {}
    }

    const hasAnyEntries =
      (slotCache && Object.keys(slotCache).length > 0) ||
      (targetCache && Object.keys(targetCache).length > 0);
    if (hasAnyEntries) {
      callHistoryDb('migrateLegacyCaches', { slotCache, targetCache });
    }

    localStorage.removeItem(STORAGE_CACHE_KEY);
    localStorage.removeItem(STORAGE_TARGET_CACHE_KEY);
    localStorage.removeItem('theysay_target_cache_v1');
  } catch (_) {}
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writeStorage(key, val) {
  try {
    localStorage.setItem(key, String(val));
  } catch (_) {}
}

function createBoolStorage(key, defaultValue = false) {
  return [
    () => {
      const raw = readStorage(key);
      return raw !== null && raw !== '' ? (raw === '1' || raw === 'true') : defaultValue;
    },
    (val) => writeStorage(key, val ? '1' : '0')
  ];
}

function createIntervalStorage(key, defaultValue) {
  return [
    () => {
      const raw = readStorage(key);
      const val = raw !== null && raw !== '' ? parseFloat(raw) : NaN;
      return !isNaN(val) && val > 0 ? val : defaultValue;
    },
    (minutes) => writeStorage(key, minutes)
  ];
}

function createColorStorage(key, defaultValue) {
  return [
    () => {
      const raw = (readStorage(key) || '').trim();
      const parsed = raw ? colord(raw) : null;
      return parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw) ? parsed.toHex() : defaultValue;
    },
    (color) => {
      const raw = String(color || '').trim();
      const parsed = raw ? colord(raw) : null;
      if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
        writeStorage(key, parsed.toHex());
      }
    }
  ];
}

function getEntryPosts(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (Array.isArray(entry.posts)) return entry.posts;
  if (Array.isArray(entry.tweets)) return entry.tweets;
  return null;
}

function mergeCacheEntryReadState(prevEntry, nextEntry) {
  if (!nextEntry || typeof nextEntry !== 'object') return nextEntry;
  const readSet = new Set();
  const knownSet = new Set();
  let maxReadTs = 0;

  const ingestEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry.readKeys)) {
      entry.readKeys.forEach(k => { if (k) readSet.add(k); });
    }
    if (Array.isArray(entry.knownKeys)) {
      entry.knownKeys.forEach(k => { if (k) knownSet.add(k); });
    }
    if (typeof entry.maxReadTimestamp === 'number' && entry.maxReadTimestamp > maxReadTs) {
      maxReadTs = entry.maxReadTimestamp;
    }
    const entryPosts = getEntryPosts(entry);
    if (Array.isArray(entryPosts)) {
      entryPosts.forEach(p => {
        if (!p) return;
        const k = getPostKey(p);
        if (k) knownSet.add(k);
        if (!p.isUnread) {
          if (k) readSet.add(k);
          const ts = getPostTimestamp(p);
          if (!p.isPinned && ts > maxReadTs) {
            maxReadTs = ts;
          }
        }
      });
    }
  };

  ingestEntry(prevEntry);
  ingestEntry(nextEntry);

  const nextPosts = getEntryPosts(nextEntry);
  const mergedPosts = Array.isArray(nextPosts)
    ? nextPosts.map(p => {
        if (!p) return p;
        const k = getPostKey(p);
        if (k && readSet.has(k) && p.isUnread) {
          return { ...p, isUnread: false };
        }
        return p;
      })
    : nextPosts;

  const pinnedKeys = Array.isArray(nextEntry.pinnedKeys)
    ? nextEntry.pinnedKeys
    : (prevEntry && Array.isArray(prevEntry.pinnedKeys) ? prevEntry.pinnedKeys : []);
  const pinnedPosts = Array.isArray(nextEntry.pinnedPosts)
    ? nextEntry.pinnedPosts
    : (prevEntry && Array.isArray(prevEntry.pinnedPosts) ? prevEntry.pinnedPosts : []);
  const pinnedCollapsed = typeof nextEntry.pinnedCollapsed === 'boolean'
    ? nextEntry.pinnedCollapsed
    : Boolean(prevEntry && prevEntry.pinnedCollapsed);

  const result = {
    ...nextEntry,
    posts: mergedPosts,
    readKeys: Array.from(readSet),
    knownKeys: Array.from(knownSet),
    maxReadTimestamp: maxReadTs,
    pinnedKeys,
    pinnedPosts,
    pinnedCollapsed
  };
  delete result.tweets;
  return result;
}

function getSavedHandles() {
  try {
    const raw = localStorage.getItem(STORAGE_HANDLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return DEFAULT_HANDLES;
}

function saveHandles(slots) {
  if (!Array.isArray(slots)) return;
  const current = slots.map(s => {
    if (!s) return '';
    // If the user is mid-edit on a slot that already has loaded posts for a monitored handle,
    // prefer the committed handle Input or monitoredHandle appropriately.
    return s.handleInput ? s.handleInput.value.trim() : (s.monitoredHandle || '');
  });
  localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(current));
}

function saveHandlesArray(handlesArray) {
  if (!Array.isArray(handlesArray)) return;
  try {
    const normalized = Array.from({ length: MAX_SLOTS }, (_, i) =>
      typeof handlesArray[i] === 'string' ? handlesArray[i].trim() : ''
    );
    localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(normalized));
  } catch (e) {}
}

function getMutedSlots() {
  try {
    const raw = localStorage.getItem(STORAGE_MUTED_SLOTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return Array.from({ length: MAX_SLOTS }, (_, i) =>
          typeof parsed[i] === 'boolean' ? parsed[i] : DEFAULT_SLOT_MUTED
        );
      }
    }
  } catch (e) {}
  return Array(MAX_SLOTS).fill(DEFAULT_SLOT_MUTED);
}

function saveMutedSlots(slots) {
  if (!Array.isArray(slots)) return;
  try {
    const current = slots.map(s => (s && typeof s.isMuted === 'boolean' ? s.isMuted : DEFAULT_SLOT_MUTED));
    localStorage.setItem(STORAGE_MUTED_SLOTS_KEY, JSON.stringify(current));
  } catch (e) {}
}

function saveMutedSlotsArray(mutedArray) {
  if (!Array.isArray(mutedArray)) return;
  try {
    const normalized = Array.from({ length: MAX_SLOTS }, (_, i) =>
      typeof mutedArray[i] === 'boolean' ? mutedArray[i] : DEFAULT_SLOT_MUTED
    );
    localStorage.setItem(STORAGE_MUTED_SLOTS_KEY, JSON.stringify(normalized));
  } catch (e) {}
}

function getTargetCache(options = {}) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    const res = callHistoryDb('getTargetCache', { options });
    return res && typeof res === 'object' ? res : {};
  } catch (e) {
    return {};
  }
}

function saveTargetCache(targetCache) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    if (targetCache && typeof targetCache === 'object') {
      callHistoryDb('saveTargetCache', { targetCache });
    }
  } catch (e) {}
}

function saveTargetCacheEntry(handleOrUrl, data) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    const posts = getEntryPosts(data);
    if (!data || !Array.isArray(posts) || posts.length === 0) return;
    const rawTarget = handleOrUrl || data.handle || '';
    const key = getCanonicalTargetKey(rawTarget, data.source);
    if (!key) return;

    callHistoryDb('saveTargetEntry', {
      handleOrUrl: rawTarget,
      data: {
        ...data,
        posts,
        handle: data.handle || rawTarget
      },
      options: { replacePosts: true, allowEmptyPosts: false }
    });
  } catch (e) {}
}

function getTargetCacheEntry(handleOrUrl, sourceHint, options = {}) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    const key = getCanonicalTargetKey(handleOrUrl, sourceHint);
    if (!key) return null;
    const res = callHistoryDb('getTargetEntry', {
      handleOrUrl,
      sourceHint,
      options
    });
    return res && typeof res === 'object' ? res : null;
  } catch (e) {}
  return null;
}

function getSlotCache(options = {}) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    const res = callHistoryDb('getSlotCache', { options });
    return res && typeof res === 'object' ? res : {};
  } catch (e) {
    return {};
  }
}

function saveSlotCache(slotIndex, data, slots = []) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    if (data) {
      const slotObj = slots[slotIndex];
      callHistoryDb('saveSlotEntry', {
        slotIndex,
        data: {
          ...data,
          isMuted: typeof data.isMuted === 'boolean'
            ? data.isMuted
            : (slotObj && typeof slotObj.isMuted === 'boolean' ? slotObj.isMuted : DEFAULT_SLOT_MUTED),
          lastFetchedAt: data.lastFetchedAt || (slotObj && slotObj.lastFetchedAt) || null
        }
      });
    } else {
      callHistoryDb('saveSlotEntry', { slotIndex, data: null });
    }
  } catch (e) {}
}

function saveAllSlotCache(cache) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    if (cache && typeof cache === 'object') {
      callHistoryDb('saveAllSlotCache', { cache });
    }
  } catch (e) {}
}

function markTargetPostsRead(handleOrUrl, sourceHint, postKeys = [], maxReadTimestamp = 0) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    return Boolean(
      callHistoryDb('markTargetPostsRead', {
        handleOrUrl,
        sourceHint,
        postKeys,
        maxReadTimestamp
      })
    );
  } catch (e) {
    return false;
  }
}

function markAllTargetPostsRead(handleOrUrl, sourceHint, maxReadTimestamp = 0) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    return Boolean(
      callHistoryDb('markAllTargetPostsRead', {
        handleOrUrl,
        sourceHint,
        maxReadTimestamp
      })
    );
  } catch (e) {
    return false;
  }
}

function hasCachedPostsForSource(source) {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    return Boolean(callHistoryDb('hasCachedPostsForSource', { source }));
  } catch (e) {
    return false;
  }
}

function clearAllPostCache() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_CACHE_KEY);
      localStorage.removeItem(STORAGE_TARGET_CACHE_KEY);
      localStorage.removeItem('theysay_target_cache_v1');
    }
    callHistoryDb('clearAll');
  } catch (e) {}
}

function getHistoryDbStats() {
  try {
    migrateLegacyLocalStorageCachesIfNeeded();
    return callHistoryDb('getStats') || { dbPath: '', targetCount: 0, slotCount: 0, postCount: 0 };
  } catch (e) {
    return { dbPath: '', targetCount: 0, slotCount: 0, postCount: 0 };
  }
}

function getSavedGridLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_GRID_LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return null;
}

function requestStorageFlush() {
  try {
    const { ipcRenderer } = require('electron');
    if (ipcRenderer && typeof ipcRenderer.send === 'function') {
      ipcRenderer.send('flush-storage-data');
    }
  } catch (_) {}
}

function saveRawGridLayout(layoutData) {
  try {
    if (Array.isArray(layoutData)) {
      const nextRaw = JSON.stringify(layoutData);
      const prevRaw = localStorage.getItem(STORAGE_GRID_LAYOUT_KEY);
      localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, nextRaw);
      if (prevRaw !== nextRaw) {
        requestStorageFlush();
      }
    }
  } catch (e) {}
}

function saveGridLayout(grid) {
  if (!grid) return;
  try {
    const items = typeof grid.getGridItems === 'function' ? grid.getGridItems() : [];
    let layoutData;
    if (items.length > 0) {
      layoutData = items.map(el => {
        const node = el.gridstackNode || {};
        const slotIndex = parseInt(el.getAttribute('data-slot-index'), 10);
        return {
          id: el.getAttribute('gs-id') || (Number.isFinite(slotIndex) ? `slot-${slotIndex}` : undefined),
          slotIndex: Number.isFinite(slotIndex) ? slotIndex : undefined,
          x: typeof node.x === 'number' ? node.x : 0,
          y: typeof node.y === 'number' ? node.y : 0,
          w: typeof node.w === 'number' ? node.w : 1,
          h: typeof node.h === 'number' ? node.h : 1
        };
      });
    } else {
      layoutData = grid.save(false);
    }
    const nextRaw = JSON.stringify(layoutData);
    const prevRaw = localStorage.getItem(STORAGE_GRID_LAYOUT_KEY);
    localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, nextRaw);
    if (prevRaw !== nextRaw) {
      requestStorageFlush();
    }
  } catch (e) {}
}

const getStoredPreset = () => readStorage(STORAGE_PRESET_KEY) || '2x2';
const saveStoredPreset = (preset) => writeStorage(STORAGE_PRESET_KEY, preset);

function normalizeThemePreference(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'dark' || v === 'light' || v === 'system') return v;
  return 'light';
}

function detectSystemDarkPreference() {
  try {
    const electron = require('electron');
    const ipcRenderer = electron && electron.ipcRenderer;
    if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
      const state = ipcRenderer.sendSync('get-native-theme-sync');
      if (state && typeof state.shouldUseDarkColors === 'boolean') {
        if (state.themeSource === 'system') {
          return state.shouldUseDarkColors;
        }
      }
    }
  } catch (_) {}
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  } catch (_) {}
  return false;
}

function resolveEffectiveTheme(preference = getStoredTheme(), { systemIsDark = null } = {}) {
  const pref = normalizeThemePreference(preference);
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  const isDark = typeof systemIsDark === 'boolean' ? systemIsDark : detectSystemDarkPreference();
  return isDark ? 'dark' : 'light';
}

const getStoredTheme = () => normalizeThemePreference(readStorage(STORAGE_THEME_KEY) || 'light');
const saveStoredTheme = (theme) => writeStorage(STORAGE_THEME_KEY, normalizeThemePreference(theme));
const getEffectiveTheme = () => {
  if (typeof document !== 'undefined' && document.documentElement) {
    const domTheme = document.documentElement.getAttribute('data-theme');
    if (domTheme === 'dark' || domTheme === 'light') {
      const storedPref = getStoredTheme();
      if (storedPref === 'system' || storedPref === domTheme) {
        return domTheme;
      }
    }
  }
  return resolveEffectiveTheme(getStoredTheme());
};

const getLastFetchTime = () => readStorage(STORAGE_LAST_FETCH_KEY);
const saveLastFetchTime = (timestamp) => writeStorage(STORAGE_LAST_FETCH_KEY, timestamp);

const getLastFetchTimeTwitter = () => readStorage(STORAGE_LAST_FETCH_TWITTER_KEY) || readStorage(STORAGE_LAST_FETCH_KEY);
const saveLastFetchTimeTwitter = (timestamp) => {
  writeStorage(STORAGE_LAST_FETCH_TWITTER_KEY, timestamp);
  writeStorage(STORAGE_LAST_FETCH_KEY, timestamp);
};

const getLastFetchTimeDiscord = () => readStorage(STORAGE_LAST_FETCH_DISCORD_KEY);
const saveLastFetchTimeDiscord = (timestamp) => writeStorage(STORAGE_LAST_FETCH_DISCORD_KEY, timestamp);

const getLastFetchTimeThreads = () => readStorage(STORAGE_LAST_FETCH_THREADS_KEY);
const saveLastFetchTimeThreads = (timestamp) => writeStorage(STORAGE_LAST_FETCH_THREADS_KEY, timestamp);

const [getTwitterIntervalMinutes, saveTwitterIntervalMinutes] = createIntervalStorage(
  STORAGE_TWITTER_INTERVAL_KEY,
  DEFAULT_TWITTER_INTERVAL_MINUTES
);
const [getDiscordIntervalMinutes, saveDiscordIntervalMinutes] = createIntervalStorage(
  STORAGE_DISCORD_INTERVAL_KEY,
  DEFAULT_DISCORD_INTERVAL_MINUTES
);
const [getThreadsIntervalMinutes, saveThreadsIntervalMinutes] = createIntervalStorage(
  STORAGE_THREADS_INTERVAL_KEY,
  DEFAULT_THREADS_INTERVAL_MINUTES
);

const [getTwitterEverLoggedIn, saveTwitterEverLoggedIn] = createBoolStorage(STORAGE_TWITTER_EVER_LOGGED_IN_KEY, false);
const [getThreadsEverLoggedIn, saveThreadsEverLoggedIn] = createBoolStorage(STORAGE_THREADS_EVER_LOGGED_IN_KEY, false);
const [getDiscordEverLoggedIn, saveDiscordEverLoggedIn] = createBoolStorage(STORAGE_DISCORD_EVER_LOGGED_IN_KEY, false);

const [getTwitterLoginExpired, saveTwitterLoginExpired] = createBoolStorage(STORAGE_TWITTER_LOGIN_EXPIRED_KEY, false);
const [getThreadsLoginExpired, saveThreadsLoginExpired] = createBoolStorage(STORAGE_THREADS_LOGIN_EXPIRED_KEY, false);
const [getDiscordLoginExpired, saveDiscordLoginExpired] = createBoolStorage(STORAGE_DISCORD_LOGIN_EXPIRED_KEY, false);

const getDiscordLoggedIn = () => readStorage(STORAGE_DISCORD_LOGIN_KEY) === '1';
const hasDiscordLoginStateBeenSet = () => readStorage(STORAGE_DISCORD_LOGIN_KEY) !== null;
function saveDiscordLoggedIn(loggedIn) {
  writeStorage(STORAGE_DISCORD_LOGIN_KEY, loggedIn ? '1' : '0');
  if (loggedIn) {
    saveDiscordEverLoggedIn(true);
    saveDiscordLoginExpired(false);
  }
}

const getThreadsLoggedIn = () => readStorage(STORAGE_THREADS_LOGIN_KEY) === '1';
const hasThreadsLoginStateBeenSet = () => readStorage(STORAGE_THREADS_LOGIN_KEY) !== null;
function saveThreadsLoggedIn(loggedIn) {
  writeStorage(STORAGE_THREADS_LOGIN_KEY, loggedIn ? '1' : '0');
  if (loggedIn) {
    saveThreadsEverLoggedIn(true);
    saveThreadsLoginExpired(false);
  }
}

function getPlatformEverLoggedIn(platform) {
  if (platform === 'discord') return getDiscordEverLoggedIn();
  if (platform === 'threads') return getThreadsEverLoggedIn();
  if (platform === 'twitter') return getTwitterEverLoggedIn();
  return false;
}

function savePlatformEverLoggedIn(platform, val) {
  if (platform === 'discord') saveDiscordEverLoggedIn(val);
  else if (platform === 'threads') saveThreadsEverLoggedIn(val);
  else if (platform === 'twitter') saveTwitterEverLoggedIn(val);
}

function getPlatformLoginExpired(platform) {
  if (platform === 'discord') return getDiscordLoginExpired();
  if (platform === 'threads') return getThreadsLoginExpired();
  if (platform === 'twitter') return getTwitterLoginExpired();
  return false;
}

function savePlatformLoginExpired(platform, val) {
  if (platform === 'discord') saveDiscordLoginExpired(val);
  else if (platform === 'threads') saveThreadsLoginExpired(val);
  else if (platform === 'twitter') saveTwitterLoginExpired(val);
}

const [getShowMemberOnlyPosts, saveShowMemberOnlyPosts] = createBoolStorage(
  STORAGE_SHOW_MEMBER_ONLY_KEY,
  DEFAULT_SHOW_MEMBER_ONLY
);
const [getDiscordSoundEnabled, saveDiscordSoundEnabled] = createBoolStorage(
  STORAGE_DISCORD_SOUND_KEY,
  DEFAULT_DISCORD_SOUND_ENABLED
);
const [getAppBadgeEnabled, saveAppBadgeEnabled] = createBoolStorage(
  STORAGE_APP_BADGE_ENABLED_KEY,
  DEFAULT_APP_BADGE_ENABLED
);
const [getAutoCheckUpdates, saveAutoCheckUpdates] = createBoolStorage(
  STORAGE_AUTO_CHECK_UPDATES_KEY,
  DEFAULT_AUTO_CHECK_UPDATES
);
const [getOnboardingCompleted, saveOnboardingCompleted] = createBoolStorage(
  STORAGE_ONBOARDING_COMPLETED_KEY,
  false
);

const [getTickerFgColor, saveTickerFgColor] = createColorStorage(
  STORAGE_TICKER_FG_COLOR_KEY,
  DEFAULT_TICKER_FG_COLOR
);
const [getTickerBgColor, saveTickerBgColor] = createColorStorage(
  STORAGE_TICKER_BG_COLOR_KEY,
  DEFAULT_TICKER_BG_COLOR
);
const MODE_COLOR_STORAGE_MAP = {
  light: {
    header: {
      key: STORAGE_LIGHT_HEADER_BG_COLOR_KEY,
      legacyKey: STORAGE_HEADER_BG_COLOR_KEY,
      defaultVal: DEFAULT_HEADER_BG_COLOR
    },
    chat: {
      key: STORAGE_LIGHT_CHAT_BG_COLOR_KEY,
      legacyKey: STORAGE_CHAT_BG_COLOR_KEY,
      defaultVal: DEFAULT_CHAT_BG_COLOR
    },
    bubble: {
      key: STORAGE_LIGHT_BUBBLE_BG_COLOR_KEY,
      legacyKey: STORAGE_BUBBLE_BG_COLOR_KEY,
      defaultVal: DEFAULT_BUBBLE_BG_COLOR
    }
  },
  dark: {
    header: {
      key: STORAGE_DARK_HEADER_BG_COLOR_KEY,
      legacyKey: STORAGE_HEADER_BG_COLOR_KEY,
      defaultVal: DEFAULT_DARK_HEADER_BG_COLOR
    },
    chat: {
      key: STORAGE_DARK_CHAT_BG_COLOR_KEY,
      legacyKey: STORAGE_CHAT_BG_COLOR_KEY,
      defaultVal: DEFAULT_DARK_CHAT_BG_COLOR
    },
    bubble: {
      key: STORAGE_DARK_BUBBLE_BG_COLOR_KEY,
      legacyKey: STORAGE_BUBBLE_BG_COLOR_KEY,
      defaultVal: DEFAULT_DARK_BUBBLE_BG_COLOR
    }
  }
};

function normalizeValidHex(color) {
  const raw = String(color || '').trim();
  const parsed = raw ? colord(raw) : null;
  return parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw) ? parsed.toHex() : null;
}

function normalizeAppearanceMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return getEffectiveTheme();
}

function migrateLegacyAppearanceColorsIfNeeded() {
  try {
    if (typeof localStorage === 'undefined') return;
    if (readStorage(STORAGE_APPEARANCE_MIGRATED_KEY) === '1') return;

    const legacyHeader = normalizeValidHex(readStorage(STORAGE_HEADER_BG_COLOR_KEY));
    const legacyChat = normalizeValidHex(readStorage(STORAGE_CHAT_BG_COLOR_KEY));
    const legacyBubble = normalizeValidHex(readStorage(STORAGE_BUBBLE_BG_COLOR_KEY));
    const effectiveMode = resolveEffectiveTheme(getStoredTheme());

    if (legacyChat) {
      const targetMode = colord(legacyChat).brightness() < 0.55 ? 'dark' : 'light';
      const slotKey = MODE_COLOR_STORAGE_MAP[targetMode].chat.key;
      if (!normalizeValidHex(readStorage(slotKey))) {
        writeStorage(slotKey, legacyChat);
      }
    }

    if (legacyBubble) {
      const targetMode = colord(legacyBubble).brightness() < 0.55 ? 'dark' : 'light';
      const slotKey = MODE_COLOR_STORAGE_MAP[targetMode].bubble.key;
      if (!normalizeValidHex(readStorage(slotKey))) {
        writeStorage(slotKey, legacyBubble);
      }
    }

    if (legacyHeader) {
      let targetMode;
      if (legacyHeader === DEFAULT_HEADER_BG_COLOR) {
        targetMode = 'light';
      } else if (legacyHeader === DEFAULT_DARK_HEADER_BG_COLOR) {
        targetMode = 'dark';
      } else {
        const headerIsDark = colord(legacyHeader).brightness() < 0.55;
        const chatIsLight = legacyChat
          ? colord(legacyChat).brightness() >= 0.55
          : effectiveMode === 'light';
        targetMode = headerIsDark && !(effectiveMode === 'light' && chatIsLight) ? 'dark' : 'light';
      }
      const slotKey = MODE_COLOR_STORAGE_MAP[targetMode].header.key;
      if (!normalizeValidHex(readStorage(slotKey))) {
        writeStorage(slotKey, legacyHeader);
      }
    }

    writeStorage(STORAGE_APPEARANCE_MIGRATED_KEY, '1');
  } catch (_) {}
}

function getModeColor(slot, mode) {
  migrateLegacyAppearanceColorsIfNeeded();
  const resolvedMode = normalizeAppearanceMode(mode);
  const cfg = MODE_COLOR_STORAGE_MAP[resolvedMode][slot];
  const stored = normalizeValidHex(readStorage(cfg.key));
  return stored || cfg.defaultVal;
}

function saveModeColor(slot, color, mode) {
  migrateLegacyAppearanceColorsIfNeeded();
  const hex = normalizeValidHex(color);
  if (!hex) return;
  const resolvedMode = normalizeAppearanceMode(mode);
  const cfg = MODE_COLOR_STORAGE_MAP[resolvedMode][slot];
  writeStorage(cfg.key, hex);
  if (resolvedMode === getEffectiveTheme()) {
    writeStorage(cfg.legacyKey, hex);
  }
}

function syncLegacyAppearanceKeysForMode(mode) {
  migrateLegacyAppearanceColorsIfNeeded();
  const resolvedMode = normalizeAppearanceMode(mode);
  const map = MODE_COLOR_STORAGE_MAP[resolvedMode];
  writeStorage(map.header.legacyKey, getModeColor('header', resolvedMode));
  writeStorage(map.chat.legacyKey, getModeColor('chat', resolvedMode));
  writeStorage(map.bubble.legacyKey, getModeColor('bubble', resolvedMode));
}

function getModeAppearanceColors(mode) {
  const resolvedMode = normalizeAppearanceMode(mode);
  return {
    headerBgColor: getModeColor('header', resolvedMode),
    chatBgColor: getModeColor('chat', resolvedMode),
    bubbleBgColor: getModeColor('bubble', resolvedMode)
  };
}

function saveModeAppearanceColors(colors, mode) {
  if (!colors || typeof colors !== 'object') return;
  const resolvedMode = normalizeAppearanceMode(mode);
  if (colors.headerBgColor) saveModeColor('header', colors.headerBgColor, resolvedMode);
  if (colors.chatBgColor) saveModeColor('chat', colors.chatBgColor, resolvedMode);
  if (colors.bubbleBgColor) saveModeColor('bubble', colors.bubbleBgColor, resolvedMode);
}

function resetAllAppearanceColors() {
  try {
    if (typeof localStorage !== 'undefined') {
      Object.values(MODE_COLOR_STORAGE_MAP).forEach((modeMap) => {
        Object.values(modeMap).forEach((cfg) => {
          localStorage.removeItem(cfg.key);
        });
      });
      writeStorage(STORAGE_APPEARANCE_MIGRATED_KEY, '1');
    }
  } catch (_) {}
  syncLegacyAppearanceKeysForMode(getEffectiveTheme());
}

function getHeaderBgColor(mode) {
  return getModeColor('header', mode);
}

function saveHeaderBgColor(color, mode) {
  saveModeColor('header', color, mode);
}

function getChatBgColor(mode) {
  return getModeColor('chat', mode);
}

function saveChatBgColor(color, mode) {
  saveModeColor('chat', color, mode);
}

function getBubbleBgColor(mode) {
  return getModeColor('bubble', mode);
}

function saveBubbleBgColor(color, mode) {
  saveModeColor('bubble', color, mode);
}

function getTickerRemoteCache() {
  try {
    const raw = readStorage(STORAGE_TICKER_REMOTE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveTickerRemoteCache(data) {
  try {
    writeStorage(STORAGE_TICKER_REMOTE_CACHE_KEY, JSON.stringify(data));
  } catch (_) {}
}

function getUrlTitlesCache() {
  try {
    const raw = readStorage(STORAGE_URL_TITLES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveUrlTitlesCache(cacheObj) {
  if (cacheObj && typeof cacheObj === 'object') {
    writeStorage(STORAGE_URL_TITLES_CACHE_KEY, JSON.stringify(cacheObj));
  }
}

function getLanguage() {
  return getCurrentLanguage();
}

function saveLanguage(lang) {
  try {
    if (lang === 'en' || lang === 'zh') {
      localStorage.setItem(STORAGE_LANGUAGE_KEY, lang);
      if (typeof process !== 'undefined' && process && process.env) {
        process.env.THEYSAY_SAVED_LANGUAGE = lang;
      }
      setActiveLanguageOverride(lang);
      try {
        const { ipcRenderer } = require('electron');
        if (ipcRenderer) {
          ipcRenderer.send('set-language', { lang, persist: true });
        }
      } catch (_) {}
    }
  } catch (e) {}
}

function clearStoredLanguage() {
  try {
    localStorage.removeItem(STORAGE_LANGUAGE_KEY);
    if (typeof process !== 'undefined' && process && process.env) {
      delete process.env.THEYSAY_SAVED_LANGUAGE;
    }
    setActiveLanguageOverride(null);
    try {
      const { ipcRenderer } = require('electron');
      if (ipcRenderer) {
        ipcRenderer.send('set-language', { lang: null, persist: true });
      }
    } catch (_) {}
  } catch (e) {}
}

function getFilterKeywords() {
  try {
    const raw = localStorage.getItem(STORAGE_FILTER_KEYWORDS_KEY);
    if (raw !== null && raw !== '') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parseFilterKeywordsInput(parsed);
        }
      } catch (_) {
        return parseFilterKeywordsInput(raw);
      }
    }
  } catch (e) {}
  return [...DEFAULT_FILTER_KEYWORDS];
}

function saveFilterKeywords(keywords) {
  try {
    const normalized = parseFilterKeywordsInput(keywords);
    localStorage.setItem(STORAGE_FILTER_KEYWORDS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (e) {
    return [];
  }
}

function getLayoutUndoShortcut() {
  const raw = readStorage(STORAGE_UNDO_SHORTCUT_KEY);
  return normalizeShortcut(raw, DEFAULT_UNDO_SHORTCUT);
}

function getLayoutRedoShortcut() {
  const raw = readStorage(STORAGE_REDO_SHORTCUT_KEY);
  return normalizeShortcut(raw, DEFAULT_REDO_SHORTCUT);
}

function syncLayoutShortcutsToMain(
  undoShortcut = getLayoutUndoShortcut(),
  redoShortcut = getLayoutRedoShortcut()
) {
  try {
    const { ipcRenderer } = require('electron');
    if (ipcRenderer) {
      const payload = {
        undoShortcut: normalizeShortcut(undoShortcut, DEFAULT_UNDO_SHORTCUT),
        redoShortcut: normalizeShortcut(redoShortcut, DEFAULT_REDO_SHORTCUT)
      };
      if (typeof ipcRenderer.sendSync === 'function') {
        ipcRenderer.sendSync('set-layout-shortcuts', payload);
      } else if (typeof ipcRenderer.send === 'function') {
        ipcRenderer.send('set-layout-shortcuts', payload);
      }
    }
  } catch (_) {}
}

function saveLayoutUndoShortcut(shortcut) {
  const normalized = normalizeShortcut(shortcut, DEFAULT_UNDO_SHORTCUT);
  writeStorage(STORAGE_UNDO_SHORTCUT_KEY, normalized);
  syncLayoutShortcutsToMain(normalized, getLayoutRedoShortcut());
  return normalized;
}

function saveLayoutRedoShortcut(shortcut) {
  const normalized = normalizeShortcut(shortcut, DEFAULT_REDO_SHORTCUT);
  writeStorage(STORAGE_REDO_SHORTCUT_KEY, normalized);
  syncLayoutShortcutsToMain(getLayoutUndoShortcut(), normalized);
  return normalized;
}

function buildProfileData({ slots = [], grid = null, settingsOverrides = {} } = {}) {
  if (grid) {
    saveGridLayout(grid);
  }

  const savedHandles = getSavedHandles();
  const savedMuted = getMutedSlots();
  const slotCache = getSlotCache({ includePosts: false });
  const gridLayout = getSavedGridLayout() || [];

  const layoutBySlot = {};
  gridLayout.forEach((item, idx) => {
    const sIdx = typeof item.slotIndex === 'number'
      ? item.slotIndex
      : (typeof item.id === 'string' && item.id.startsWith('slot-')
          ? parseInt(item.id.replace('slot-', ''), 10)
          : idx);
    if (Number.isFinite(sIdx)) {
      layoutBySlot[sIdx] = {
        x: typeof item.x === 'number' ? item.x : 0,
        y: typeof item.y === 'number' ? item.y : 0,
        w: typeof item.w === 'number' ? item.w : 1,
        h: typeof item.h === 'number' ? item.h : 1
      };
    }
  });

  const handles = [];
  const mutedSlots = [];
  const slotsData = [];
  const following = [];

  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = slots[i];
    const cached = slotCache[i] || {};
    const handle = slot
      ? ((slot.handleInput && slot.handleInput.value.trim()) || slot.monitoredHandle || '')
      : (savedHandles[i] || '');
    const isMuted = slot && typeof slot.isMuted === 'boolean'
      ? slot.isMuted
      : (typeof savedMuted[i] === 'boolean' ? savedMuted[i] : DEFAULT_SLOT_MUTED);
    const targetCached = handle
      ? (getTargetCacheEntry(handle, undefined, { includePosts: false }) || cached)
      : cached;

    const source = handle ? detectSourceType(handle) : (slot && slot.source) || targetCached.source || 'twitter';
    const displayName = (slot && slot.authorName && slot.authorName.innerText.trim()) || targetCached.displayName || '';
    const userHandle = (slot && slot.authorHandle && slot.authorHandle.innerText.trim()) || targetCached.userHandle || '';
    const sourceTitle = (slot && slot.sourceTitle) || targetCached.sourceTitle || '';
    const sourceSubtitle = (slot && slot.sourceSubtitle) || targetCached.sourceSubtitle || '';
    const avatarUrl = (slot && slot.avatarImg && slot.avatarImg.src) || targetCached.avatarUrl || '';
    const pinnedKeys = slot && slot.pinnedKeys instanceof Set
      ? Array.from(slot.pinnedKeys)
      : (Array.isArray(targetCached.pinnedKeys) ? targetCached.pinnedKeys : []);
    const pinnedPosts = slot && Array.isArray(slot.pinnedPosts) && slot.pinnedPosts.length > 0
      ? slot.pinnedPosts
      : (Array.isArray(targetCached.pinnedPosts) ? targetCached.pinnedPosts : []);
    const pinnedCollapsed = slot && typeof slot.pinnedCollapsed === 'boolean'
      ? slot.pinnedCollapsed
      : Boolean(targetCached.pinnedCollapsed);

    handles.push(handle);
    mutedSlots.push(isMuted);

    const slotEntry = {
      index: i,
      handle,
      source,
      isMuted,
      displayName,
      userHandle,
      sourceTitle,
      sourceSubtitle,
      avatarUrl,
      pinnedKeys,
      pinnedPosts,
      pinnedCollapsed,
      grid: layoutBySlot[i] || null
    };
    slotsData.push(slotEntry);

    if (handle) {
      following.push({
        slotIndex: i,
        handle,
        source,
        displayName,
        userHandle,
        sourceTitle,
        sourceSubtitle,
        isMuted,
        avatarUrl,
        pinnedKeys,
        pinnedPosts,
        pinnedCollapsed
      });
    }
  }

  const resolvedThemePref = normalizeThemePreference(
    settingsOverrides.theme !== undefined ? settingsOverrides.theme : getStoredTheme()
  );
  const activeEffectiveTheme = resolveEffectiveTheme(resolvedThemePref);
  const lightAppearance = getModeAppearanceColors('light');
  const darkAppearance = getModeAppearanceColors('dark');
  const activeAppearance = activeEffectiveTheme === 'dark' ? darkAppearance : lightAppearance;
  const exportedHeaderBg =
    settingsOverrides.headerBgColor !== undefined
      ? settingsOverrides.headerBgColor
      : activeAppearance.headerBgColor;
  const exportedChatBg =
    settingsOverrides.chatBgColor !== undefined
      ? settingsOverrides.chatBgColor
      : activeAppearance.chatBgColor;
  const exportedBubbleBg =
    settingsOverrides.bubbleBgColor !== undefined
      ? settingsOverrides.bubbleBgColor
      : activeAppearance.bubbleBgColor;
  const exportedAppearance = {
    light:
      activeEffectiveTheme === 'light'
        ? {
            headerBgColor: exportedHeaderBg,
            chatBgColor: exportedChatBg,
            bubbleBgColor: exportedBubbleBg
          }
        : lightAppearance,
    dark:
      activeEffectiveTheme === 'dark'
        ? {
            headerBgColor: exportedHeaderBg,
            chatBgColor: exportedChatBg,
            bubbleBgColor: exportedBubbleBg
          }
        : darkAppearance
  };

  const settings = {
    language: settingsOverrides.language !== undefined ? settingsOverrides.language : getLanguage(),
    theme: resolvedThemePref,
    gridPreset: settingsOverrides.gridPreset !== undefined ? settingsOverrides.gridPreset : getStoredPreset(),
    gridLayout,
    twitterIntervalMinutes: settingsOverrides.twitterIntervalMinutes !== undefined
      ? settingsOverrides.twitterIntervalMinutes
      : getTwitterIntervalMinutes(),
    discordIntervalMinutes: settingsOverrides.discordIntervalMinutes !== undefined
      ? settingsOverrides.discordIntervalMinutes
      : getDiscordIntervalMinutes(),
    threadsIntervalMinutes: settingsOverrides.threadsIntervalMinutes !== undefined
      ? settingsOverrides.threadsIntervalMinutes
      : getThreadsIntervalMinutes(),
    showMemberOnlyPosts: settingsOverrides.showMemberOnlyPosts !== undefined
      ? settingsOverrides.showMemberOnlyPosts
      : getShowMemberOnlyPosts(),
    filterKeywords: settingsOverrides.filterKeywords !== undefined
      ? parseFilterKeywordsInput(settingsOverrides.filterKeywords)
      : getFilterKeywords(),
    discordSoundEnabled: settingsOverrides.discordSoundEnabled !== undefined
      ? settingsOverrides.discordSoundEnabled
      : getDiscordSoundEnabled(),
    appBadgeEnabled: settingsOverrides.appBadgeEnabled !== undefined
      ? settingsOverrides.appBadgeEnabled
      : getAppBadgeEnabled(),
    layoutUndoShortcut: settingsOverrides.layoutUndoShortcut !== undefined
      ? normalizeShortcut(settingsOverrides.layoutUndoShortcut, DEFAULT_UNDO_SHORTCUT)
      : getLayoutUndoShortcut(),
    layoutRedoShortcut: settingsOverrides.layoutRedoShortcut !== undefined
      ? normalizeShortcut(settingsOverrides.layoutRedoShortcut, DEFAULT_REDO_SHORTCUT)
      : getLayoutRedoShortcut(),
    autoCheckUpdates: settingsOverrides.autoCheckUpdates !== undefined
      ? settingsOverrides.autoCheckUpdates
      : getAutoCheckUpdates(),
    headerBgColor: exportedHeaderBg,
    chatBgColor: exportedChatBg,
    bubbleBgColor: exportedBubbleBg,
    appearance: exportedAppearance,
    tickerFgColor: settingsOverrides.tickerFgColor !== undefined
      ? settingsOverrides.tickerFgColor
      : getTickerFgColor(),
    tickerBgColor: settingsOverrides.tickerBgColor !== undefined
      ? settingsOverrides.tickerBgColor
      : getTickerBgColor(),
    mutedSlots
  };

  return {
    app: 'TheySay',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    following,
    handles,
    slots: slotsData
  };
}

module.exports = {
  getSavedHandles,
  saveHandles,
  saveHandlesArray,
  getMutedSlots,
  saveMutedSlots,
  saveMutedSlotsArray,
  getTargetCache,
  saveTargetCache,
  saveTargetCacheEntry,
  getTargetCacheEntry,
  mergeCacheEntryReadState,
  getSlotCache,
  saveSlotCache,
  saveAllSlotCache,
  markTargetPostsRead,
  markAllTargetPostsRead,
  hasCachedPostsForSource,
  clearAllPostCache,
  getHistoryDbStats,
  getSavedGridLayout,
  saveRawGridLayout,
  saveGridLayout,
  getStoredPreset,
  saveStoredPreset,
  normalizeThemePreference,
  resolveEffectiveTheme,
  getEffectiveTheme,
  getStoredTheme,
  saveStoredTheme,
  getLastFetchTime,
  saveLastFetchTime,
  getLastFetchTimeTwitter,
  saveLastFetchTimeTwitter,
  getLastFetchTimeDiscord,
  saveLastFetchTimeDiscord,
  getLastFetchTimeThreads,
  saveLastFetchTimeThreads,
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getThreadsIntervalMinutes,
  saveThreadsIntervalMinutes,
  getDiscordLoggedIn,
  hasDiscordLoginStateBeenSet,
  saveDiscordLoggedIn,
  getThreadsLoggedIn,
  hasThreadsLoginStateBeenSet,
  saveThreadsLoggedIn,
  getTwitterEverLoggedIn,
  saveTwitterEverLoggedIn,
  getThreadsEverLoggedIn,
  saveThreadsEverLoggedIn,
  getDiscordEverLoggedIn,
  saveDiscordEverLoggedIn,
  getTwitterLoginExpired,
  saveTwitterLoginExpired,
  getThreadsLoginExpired,
  saveThreadsLoginExpired,
  getDiscordLoginExpired,
  saveDiscordLoginExpired,
  getPlatformEverLoggedIn,
  savePlatformEverLoggedIn,
  getPlatformLoginExpired,
  savePlatformLoginExpired,
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
  syncLayoutShortcutsToMain,
  getAutoCheckUpdates,
  saveAutoCheckUpdates,
  getOnboardingCompleted,
  saveOnboardingCompleted,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor,
  getTickerRemoteCache,
  saveTickerRemoteCache,
  getUrlTitlesCache,
  saveUrlTitlesCache,
  migrateLegacyAppearanceColorsIfNeeded,
  syncLegacyAppearanceKeysForMode,
  getModeAppearanceColors,
  saveModeAppearanceColors,
  resetAllAppearanceColors,
  getHeaderBgColor,
  saveHeaderBgColor,
  getChatBgColor,
  saveChatBgColor,
  getBubbleBgColor,
  saveBubbleBgColor,
  getLanguage,
  saveLanguage,
  clearStoredLanguage,
  buildProfileData
};

