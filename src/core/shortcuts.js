const DEFAULT_UNDO_SHORTCUT = 'Mod+Z';
const DEFAULT_REDO_SHORTCUT = 'Mod+Shift+Z';

const MODIFIER_KEYS = new Set([
  'control',
  'ctrl',
  'shift',
  'alt',
  'option',
  'meta',
  'command',
  'cmd',
  'os',
  'super',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'fn',
  'fnlock',
  'hyper',
  'symbol',
  'dead',
  'process',
  'unidentified'
]);

const CODE_TO_KEY = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
};

const SPECIAL_KEY_ALIASES = {
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  arrowup: 'ArrowUp',
  up: 'ArrowUp',
  arrowdown: 'ArrowDown',
  down: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  left: 'ArrowLeft',
  arrowright: 'ArrowRight',
  right: 'ArrowRight',
  plus: '+',
  minus: '-',
  slash: '/',
  backslash: '\\',
  comma: ',',
  period: '.',
  semicolon: ';',
  quote: "'",
  backquote: '`'
};

const DISPLAY_KEY_MAC = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Enter: '↩',
  Tab: '⇥',
  Space: 'Space',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
};

const DISPLAY_KEY_OTHER = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'Backspace',
  Delete: 'Del',
  Enter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
};

function isMacPlatform(platform) {
  if (typeof platform === 'string' && platform) {
    return platform === 'darwin';
  }
  if (typeof process !== 'undefined' && process && typeof process.platform === 'string') {
    return process.platform === 'darwin';
  }
  if (typeof navigator !== 'undefined' && navigator) {
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
  }
  return false;
}

function isFunctionKey(key) {
  return typeof key === 'string' && /^F(?:[1-9]|1[0-2])$/.test(key);
}

function normalizeCodeToKey(code) {
  if (!code || typeof code !== 'string') return '';
  if (CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  const letterMatch = /^Key([A-Z])$/.exec(code);
  if (letterMatch) return letterMatch[1];
  const digitMatch = /^Digit([0-9])$/.exec(code);
  if (digitMatch) return digitMatch[1];
  const numpadDigitMatch = /^Numpad([0-9])$/.exec(code);
  if (numpadDigitMatch) return numpadDigitMatch[1];
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  return '';
}

function normalizeKeyToken(rawKey, rawCode = '', { alt = false, shift = false } = {}) {
  const keyStr = typeof rawKey === 'string' ? rawKey : '';
  const codeStr = typeof rawCode === 'string' ? rawCode : '';
  const lower = keyStr.toLowerCase();

  if (MODIFIER_KEYS.has(lower)) return '';
  if (lower === 'escape' || lower === 'esc') return 'Escape';

  // On macOS Option+letter emits dead/accented glyphs (e.g. Option+Z -> Ω),
  // and Shift+digit/punctuation emits shifted symbols (e.g. Shift+1 -> !).
  // Use the physical code for those cases so recording and matching stay consistent.
  const fromCode = normalizeCodeToKey(codeStr);
  if (fromCode) {
    if (alt || !keyStr || keyStr.length !== 1 || !/^[a-z0-9]$/i.test(keyStr)) {
      if (shift && /^[a-z]$/i.test(keyStr)) {
        return keyStr.toUpperCase();
      }
      if (!alt && /^[a-z]$/i.test(keyStr)) {
        return keyStr.toUpperCase();
      }
      return fromCode;
    }
  }

  if (SPECIAL_KEY_ALIASES[lower]) {
    return SPECIAL_KEY_ALIASES[lower];
  }
  if (/^f(?:[1-9]|1[0-2])$/i.test(keyStr)) {
    return keyStr.toUpperCase();
  }
  if (keyStr.length === 1) {
    if (/^[a-z]$/i.test(keyStr)) return keyStr.toUpperCase();
    if (/^[0-9\-=[\]\\;',./`+]$/.test(keyStr)) return keyStr;
  }

  return fromCode || '';
}

function parseShortcut(shortcutStr, platform) {
  const isMac = isMacPlatform(platform);
  const result = {
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: '',
    resolvedCtrl: false,
    resolvedMeta: false,
    valid: false
  };

  if (typeof shortcutStr !== 'string') return result;
  const trimmed = shortcutStr.trim();
  if (!trimmed) return result;

  // Handle '+' as the key itself (e.g. 'Mod++' or 'Mod+Plus')
  const parts = trimmed
    .replace(/\+\+$/, '+Plus')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return result;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'mod' || lower === 'commandorcontrol' || lower === 'cmdorctrl') {
      result.mod = true;
    } else if (lower === 'ctrl' || lower === 'control') {
      result.ctrl = true;
    } else if (lower === 'alt' || lower === 'option' || lower === 'opt') {
      result.alt = true;
    } else if (lower === 'shift') {
      result.shift = true;
    } else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super') {
      result.meta = true;
    } else if (!result.key) {
      const normalizedKey = normalizeKeyToken(part);
      if (normalizedKey && normalizedKey !== 'Escape') {
        result.key = normalizedKey;
      } else {
        return result;
      }
    } else {
      return result;
    }
  }

  if (!result.key) return result;

  const hasNonShiftModifier = result.mod || result.ctrl || result.alt || result.meta;
  if (!hasNonShiftModifier && !isFunctionKey(result.key)) {
    return result;
  }

  result.resolvedCtrl = result.ctrl || (!isMac && result.mod);
  result.resolvedMeta = result.meta || (isMac && result.mod);
  result.valid = true;
  return result;
}

function buildCanonicalShortcut({ mod, ctrl, alt, shift, meta, key }) {
  const tokens = [];
  if (mod) tokens.push('Mod');
  if (ctrl) tokens.push('Ctrl');
  if (alt) tokens.push('Alt');
  if (shift) tokens.push('Shift');
  if (meta) tokens.push('Meta');
  if (key) tokens.push(key === '+' ? 'Plus' : key);
  return tokens.join('+');
}

function isReservedShortcut(parsed) {
  if (!parsed || !parsed.valid) return false;
  // Main process reserves Cmd/Ctrl+R for reloading the window
  if (
    parsed.key === 'R' &&
    !parsed.alt &&
    !parsed.shift &&
    (parsed.mod || parsed.ctrl || parsed.meta)
  ) {
    return true;
  }
  return false;
}

function normalizeShortcut(shortcutStr, fallback = '') {
  const parsed = parseShortcut(shortcutStr);
  if (!parsed.valid || isReservedShortcut(parsed)) {
    return fallback;
  }
  return buildCanonicalShortcut(parsed);
}

function areShortcutsEquivalent(a, b, platform) {
  const pa = parseShortcut(a, platform);
  const pb = parseShortcut(b, platform);
  if (!pa.valid || !pb.valid) return false;
  return (
    pa.resolvedCtrl === pb.resolvedCtrl &&
    pa.resolvedMeta === pb.resolvedMeta &&
    pa.alt === pb.alt &&
    pa.shift === pb.shift &&
    pa.key === pb.key
  );
}

function extractEventModifiers(inputOrEvent) {
  if (!inputOrEvent || typeof inputOrEvent !== 'object') {
    return { ctrl: false, alt: false, shift: false, meta: false };
  }
  const ctrl = Boolean(
    inputOrEvent.ctrlKey !== undefined ? inputOrEvent.ctrlKey : inputOrEvent.control
  );
  const alt = Boolean(
    inputOrEvent.altKey !== undefined ? inputOrEvent.altKey : inputOrEvent.alt
  );
  const shift = Boolean(
    inputOrEvent.shiftKey !== undefined ? inputOrEvent.shiftKey : inputOrEvent.shift
  );
  const meta = Boolean(
    inputOrEvent.metaKey !== undefined ? inputOrEvent.metaKey : inputOrEvent.meta
  );
  return { ctrl, alt, shift, meta };
}

function shortcutFromKeyEvent(event, platform) {
  if (!event || typeof event !== 'object') {
    return { ok: false, reason: 'invalid' };
  }
  const isMac = isMacPlatform(platform);
  const { ctrl, alt, shift, meta } = extractEventModifiers(event);
  const rawKey = typeof event.key === 'string' ? event.key : '';
  const rawLower = rawKey.toLowerCase();

  if (MODIFIER_KEYS.has(rawLower)) {
    return { ok: false, reason: 'modifier-only' };
  }

  if ((rawLower === 'escape' || rawLower === 'esc') && !ctrl && !alt && !shift && !meta) {
    return { ok: false, reason: 'cancel' };
  }

  const key = normalizeKeyToken(rawKey, event.code || '', { alt, shift });
  if (!key || key === 'Escape') {
    return { ok: false, reason: 'invalid' };
  }

  const mod = isMac ? meta : ctrl;
  const canonicalCtrl = isMac ? ctrl : false;
  const canonicalMeta = isMac ? false : meta;
  const hasNonShiftModifier = mod || canonicalCtrl || alt || canonicalMeta;

  if (!hasNonShiftModifier && !isFunctionKey(key)) {
    return { ok: false, reason: 'needs-modifier' };
  }

  const candidate = buildCanonicalShortcut({
    mod,
    ctrl: canonicalCtrl,
    alt,
    shift,
    meta: canonicalMeta,
    key
  });
  const parsed = parseShortcut(candidate, platform);
  if (!parsed.valid) {
    return { ok: false, reason: 'invalid' };
  }
  if (isReservedShortcut(parsed)) {
    return { ok: false, reason: 'reserved' };
  }
  return { ok: true, shortcut: candidate };
}

function matchesShortcut(shortcutStr, inputOrEvent, platform) {
  const parsed = parseShortcut(shortcutStr, platform);
  if (!parsed.valid || !inputOrEvent || typeof inputOrEvent !== 'object') {
    return false;
  }
  const { ctrl, alt, shift, meta } = extractEventModifiers(inputOrEvent);
  if (
    ctrl !== parsed.resolvedCtrl ||
    meta !== parsed.resolvedMeta ||
    alt !== parsed.alt ||
    shift !== parsed.shift
  ) {
    return false;
  }
  const eventKey = normalizeKeyToken(inputOrEvent.key || '', inputOrEvent.code || '', {
    alt,
    shift
  });
  return Boolean(eventKey && eventKey === parsed.key);
}

function isNativeEditUndoEvent(inputOrEvent, platform) {
  return matchesShortcut(DEFAULT_UNDO_SHORTCUT, inputOrEvent, platform);
}

function isNativeEditRedoEvent(inputOrEvent, platform) {
  if (matchesShortcut(DEFAULT_REDO_SHORTCUT, inputOrEvent, platform)) {
    return true;
  }
  if (!isMacPlatform(platform) && matchesShortcut('Mod+Y', inputOrEvent, platform)) {
    return true;
  }
  return false;
}

function formatShortcutParts(shortcutStr, platform) {
  const isMac = isMacPlatform(platform);
  const parsed = parseShortcut(shortcutStr, platform);
  if (!parsed.valid) return [];

  const parts = [];
  if (isMac) {
    // Apple HIG modifier order: Control, Option, Shift, Command
    if (parsed.resolvedCtrl) parts.push('⌃');
    if (parsed.alt) parts.push('⌥');
    if (parsed.shift) parts.push('⇧');
    if (parsed.resolvedMeta) parts.push('⌘');
    parts.push(DISPLAY_KEY_MAC[parsed.key] || parsed.key);
  } else {
    if (parsed.resolvedCtrl) parts.push('Ctrl');
    if (parsed.alt) parts.push('Alt');
    if (parsed.shift) parts.push('Shift');
    if (parsed.resolvedMeta) parts.push('Win');
    parts.push(DISPLAY_KEY_OTHER[parsed.key] || parsed.key);
  }
  return parts;
}

function formatShortcutDisplay(shortcutStr, platform) {
  const isMac = isMacPlatform(platform);
  const parts = formatShortcutParts(shortcutStr, platform);
  if (parts.length === 0) return '';
  return isMac ? parts.join(' ') : parts.join('+');
}

module.exports = {
  DEFAULT_UNDO_SHORTCUT,
  DEFAULT_REDO_SHORTCUT,
  isMacPlatform,
  parseShortcut,
  normalizeShortcut,
  areShortcutsEquivalent,
  shortcutFromKeyEvent,
  matchesShortcut,
  isNativeEditUndoEvent,
  isNativeEditRedoEvent,
  formatShortcutParts,
  formatShortcutDisplay
};

