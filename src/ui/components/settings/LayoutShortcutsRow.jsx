import React from 'react';
import { ThemeIcon } from '@mantine/core';
import { IconKeyboard } from '@tabler/icons-react';
import {
  DEFAULT_UNDO_SHORTCUT,
  DEFAULT_REDO_SHORTCUT,
  isMacPlatform,
  normalizeShortcut,
  areShortcutsEquivalent,
  shortcutFromKeyEvent,
  formatShortcutParts
} from '../../../core/shortcuts';

function ShortcutDisplay({ shortcut, isRecording, recordingLabel }) {
  if (isRecording) {
    return (
      <span className="settings-shortcut-recording-text">{recordingLabel}</span>
    );
  }
  const isMac = isMacPlatform();
  const parts = formatShortcutParts(shortcut);
  if (parts.length === 0) {
    return <span className="settings-shortcut-empty">—</span>;
  }
  return (
    <span className={`settings-shortcut-keys${isMac ? ' is-mac' : ''}`}>
      {parts.map((part, idx) => (
        <React.Fragment key={`${part}-${idx}`}>
          {!isMac && idx > 0 && (
            <span className="settings-shortcut-plus" aria-hidden="true">
              +
            </span>
          )}
          <kbd className="settings-shortcut-key">{part}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

export function LayoutShortcutsRow() {
  const [shortcuts, setShortcuts] = React.useState({
    undo: DEFAULT_UNDO_SHORTCUT,
    redo: DEFAULT_REDO_SHORTCUT
  });
  const [recordingField, setRecordingField] = React.useState(null);
  const [recordingLabel, setRecordingLabel] = React.useState('按下快捷键...');

  const shortcutsRef = React.useRef(shortcuts);
  const recordingFieldRef = React.useRef(null);
  const groupRef = React.useRef(null);

  const updateRecordingField = React.useCallback((nextField) => {
    const prev = recordingFieldRef.current;
    recordingFieldRef.current = nextField;
    setRecordingField(nextField);
    if (
      !nextField &&
      typeof document !== 'undefined' &&
      groupRef.current &&
      groupRef.current.contains(document.activeElement) &&
      typeof document.activeElement.blur === 'function'
    ) {
      document.activeElement.blur();
    }
    if (
      Boolean(prev) !== Boolean(nextField) &&
      typeof window !== 'undefined' &&
      typeof window.__THEYSAY_ON_SHORTCUT_RECORDING_CHANGE === 'function'
    ) {
      window.__THEYSAY_ON_SHORTCUT_RECORDING_CHANGE(Boolean(nextField));
    }
  }, []);

  const cancelRecording = React.useCallback(
    ({ fromEscape = false } = {}) => {
      if (!recordingFieldRef.current) return;
      updateRecordingField(null);
      if (
        fromEscape &&
        typeof window !== 'undefined' &&
        typeof window.__THEYSAY_ON_SHORTCUT_RECORDING_CANCEL === 'function'
      ) {
        window.__THEYSAY_ON_SHORTCUT_RECORDING_CANCEL();
      }
    },
    [updateRecordingField]
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__THEYSAY_SHORTCUTS_BRIDGE = {
      setShortcuts: ({ undo, redo } = {}) => {
        const next = {
          undo: normalizeShortcut(undo, DEFAULT_UNDO_SHORTCUT),
          redo: normalizeShortcut(redo, DEFAULT_REDO_SHORTCUT)
        };
        shortcutsRef.current = next;
        setShortcuts(next);
        return next;
      },
      getShortcuts: () => ({ ...shortcutsRef.current }),
      isRecording: () => Boolean(recordingFieldRef.current),
      cancelRecording: () => cancelRecording({ fromEscape: false }),
      setRecordingLabel: (label) => {
        if (typeof label === 'string' && label.trim()) {
          setRecordingLabel(label);
        }
      }
    };
  }, [cancelRecording]);

  React.useEffect(() => {
    if (!recordingField) return;

    const handleKeyDown = (e) => {
      const targetField = recordingFieldRef.current;
      if (!targetField) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      const res = shortcutFromKeyEvent(e);
      if (!res.ok) {
        if (res.reason === 'modifier-only') {
          return;
        }
        if (res.reason === 'cancel') {
          cancelRecording({ fromEscape: true });
          return;
        }
        if (
          typeof window !== 'undefined' &&
          typeof window.__THEYSAY_ON_SHORTCUT_ERROR === 'function'
        ) {
          window.__THEYSAY_ON_SHORTCUT_ERROR(res.reason);
        }
        return;
      }

      const otherVal =
        targetField === 'undo'
          ? shortcutsRef.current.redo
          : shortcutsRef.current.undo;
      if (areShortcutsEquivalent(res.shortcut, otherVal)) {
        if (
          typeof window !== 'undefined' &&
          typeof window.__THEYSAY_ON_SHORTCUT_ERROR === 'function'
        ) {
          window.__THEYSAY_ON_SHORTCUT_ERROR('duplicate');
        }
        return;
      }

      const next = {
        ...shortcutsRef.current,
        [targetField]: res.shortcut
      };
      shortcutsRef.current = next;
      setShortcuts(next);
      updateRecordingField(null);
      if (
        typeof window !== 'undefined' &&
        typeof window.__THEYSAY_ON_SHORTCUTS_CHANGE === 'function'
      ) {
        window.__THEYSAY_ON_SHORTCUTS_CHANGE(next);
      }
    };

    const handleMouseDown = (e) => {
      if (groupRef.current && groupRef.current.contains(e.target)) {
        return;
      }
      cancelRecording({ fromEscape: false });
    };

    const handleWindowBlur = () => {
      cancelRecording({ fromEscape: false });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [recordingField, cancelRecording, updateRecordingField]);

  const handleToggleRecord = (field) => {
    if (recordingFieldRef.current === field) {
      updateRecordingField(null);
    } else {
      updateRecordingField(field);
    }
  };

  return (
    <div
      className="settings-row settings-row-shortcuts"
      data-i18n-title="settings.layoutShortcutsTip"
      title="自定义撤回与重做网格布局操作的快捷键（点击按键框后按下组合键录制，按 Esc 取消）"
    >
      <div className="settings-row-main">
        <ThemeIcon
          variant="light"
          color="violet"
          size={28}
          radius="md"
          className="platform-icon layout-shortcuts"
        >
          <IconKeyboard size={14} stroke={2.1} />
        </ThemeIcon>
        <div className="settings-row-text">
          <div
            className="settings-row-title"
            data-i18n="settings.layoutShortcutsTitle"
          >
            布局快捷键
          </div>
          <div
            className="settings-row-subtitle"
            data-i18n="settings.layoutShortcutsSubtitle"
          >
            点击录制撤回与重做按键
          </div>
        </div>
      </div>

      <div
        ref={groupRef}
        className="settings-input-group settings-shortcuts-group"
      >
        <div className="settings-shortcut-item">
          <span
            className="settings-shortcut-label"
            data-i18n="settings.shortcutUndoLabel"
          >
            撤回
          </span>
          <button
            type="button"
            id="setting-shortcut-undo"
            className={`settings-shortcut-btn${
              recordingField === 'undo' ? ' is-recording' : ''
            }`}
            data-shortcut={shortcuts.undo}
            data-recording={recordingField === 'undo' ? 'true' : 'false'}
            data-i18n-title="settings.shortcutUndoTitle"
            title="点击录制撤回布局快捷键（按 Esc 取消）"
            onClick={() => handleToggleRecord('undo')}
          >
            <ShortcutDisplay
              shortcut={shortcuts.undo}
              isRecording={recordingField === 'undo'}
              recordingLabel={recordingLabel}
            />
          </button>
        </div>

        <div className="settings-shortcut-item">
          <span
            className="settings-shortcut-label"
            data-i18n="settings.shortcutRedoLabel"
          >
            重做
          </span>
          <button
            type="button"
            id="setting-shortcut-redo"
            className={`settings-shortcut-btn${
              recordingField === 'redo' ? ' is-recording' : ''
            }`}
            data-shortcut={shortcuts.redo}
            data-recording={recordingField === 'redo' ? 'true' : 'false'}
            data-i18n-title="settings.shortcutRedoTitle"
            title="点击录制重做布局快捷键（按 Esc 取消）"
            onClick={() => handleToggleRecord('redo')}
          >
            <ShortcutDisplay
              shortcut={shortcuts.redo}
              isRecording={recordingField === 'redo'}
              recordingLabel={recordingLabel}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
