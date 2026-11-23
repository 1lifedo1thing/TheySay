import React, { useState, useEffect, useRef } from 'react';
import {
  Popover,
  Tooltip,
  Button,
  UnstyledButton
} from '@mantine/core';
import { IconLayoutGrid } from '@tabler/icons-react';

const MIN_GRID_DIM = 1;
const MAX_GRID_DIM = 4;
const GRID_DIM_INDICES = [1, 2, 3, 4];
const STORAGE_PRESET_KEY = 'theysay_grid_preset';

export function normalizeGridPreset(presetStr) {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(String(presetStr || '2x2'));
  if (!match) {
    return { rows: 2, cols: 2, preset: '2x2' };
  }
  const rows = Math.max(
    MIN_GRID_DIM,
    Math.min(MAX_GRID_DIM, parseInt(match[1], 10) || 2)
  );
  const cols = Math.max(
    MIN_GRID_DIM,
    Math.min(MAX_GRID_DIM, parseInt(match[2], 10) || 2)
  );
  return { rows, cols, preset: `${rows}x${cols}` };
}

function readInitialPreset() {
  try {
    if (typeof localStorage !== 'undefined') {
      return normalizeGridPreset(localStorage.getItem(STORAGE_PRESET_KEY)).preset;
    }
  } catch (_) {}
  return '2x2';
}

export function GridLayoutPicker({ collapsed = true, isEn = false }) {
  const [opened, setOpened] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(readInitialPreset);
  const [hovered, setHovered] = useState(null);
  const cellRefs = useRef({});

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleSyncPreset = (e) => {
      const next = e && e.detail && e.detail.preset;
      if (!next) return;
      setSelectedPreset(normalizeGridPreset(next).preset);
    };

    const handleClosePicker = () => {
      setOpened(false);
      setHovered(null);
    };

    window.addEventListener('theysay:sync-grid-preset', handleSyncPreset);
    window.addEventListener('theysay:close-layout-picker', handleClosePicker);
    return () => {
      window.removeEventListener('theysay:sync-grid-preset', handleSyncPreset);
      window.removeEventListener('theysay:close-layout-picker', handleClosePicker);
    };
  }, []);

  useEffect(() => {
    if (!opened || typeof window === 'undefined') return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpened(false);
        setHovered(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [opened]);

  const current = normalizeGridPreset(selectedPreset);
  const isHovering = hovered !== null;
  const previewRows = isHovering ? hovered.rows : current.rows;
  const previewCols = isHovering ? hovered.cols : current.cols;

  const handleOpenChange = (nextOpened) => {
    setHovered(null);
    setOpened(nextOpened);
  };

  const handleSelectCell = (r, c) => {
    const nextPreset = `${r}x${c}`;
    setSelectedPreset(nextPreset);
    setOpened(false);
    setHovered(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('theysay:grid-preset-change', {
          detail: { preset: nextPreset, rows: r, cols: c }
        })
      );
    }
  };

  const handleCellKeyDown = (e, r, c) => {
    let nextR = r;
    let nextC = c;
    if (e.key === 'ArrowRight') {
      nextC = Math.min(MAX_GRID_DIM, c + 1);
    } else if (e.key === 'ArrowLeft') {
      nextC = Math.max(MIN_GRID_DIM, c - 1);
    } else if (e.key === 'ArrowDown') {
      nextR = Math.min(MAX_GRID_DIM, r + 1);
    } else if (e.key === 'ArrowUp') {
      nextR = Math.max(MIN_GRID_DIM, r - 1);
    } else if (e.key === 'Home') {
      nextC = MIN_GRID_DIM;
    } else if (e.key === 'End') {
      nextC = MAX_GRID_DIM;
    } else {
      return;
    }

    e.preventDefault();
    const targetKey = `${nextR}x${nextC}`;
    const targetEl = cellRefs.current[targetKey];
    if (targetEl && typeof targetEl.focus === 'function') {
      targetEl.focus();
    }
    setHovered({ rows: nextR, cols: nextC });
  };

  const currentDimText = `${current.rows} × ${current.cols}`;
  const navLabel = isEn ? 'Layout' : '网格布局';
  const headerLabel = isEn ? 'Grid Layout' : '网格布局';
  const tooltipLabel = isEn
    ? `Grid Layout (${currentDimText})`
    : `网格布局 (${currentDimText})`;
  const dimDetailText = isEn
    ? `${previewRows} ${previewRows === 1 ? 'row' : 'rows'} · ${previewCols} ${
        previewCols === 1 ? 'col' : 'cols'
      }`
    : `${previewRows} 行 · ${previewCols} 列`;

  return (
    <Popover
      opened={opened}
      onChange={handleOpenChange}
      position="right-start"
      offset={10}
      shadow="lg"
      radius="md"
      zIndex={1000}
      withRoles={false}
      returnFocus={false}
      transitionProps={{ transition: 'fade-right', duration: 130 }}
    >
      <Popover.Target>
        <Tooltip
          label={tooltipLabel}
          position="right"
          withArrow
          disabled={!collapsed || opened}
          events={{ hover: collapsed && !opened, focus: false, touch: false }}
        >
          <Button
            id="layout-select"
            data-value={selectedPreset}
            variant="subtle"
            size="compact-sm"
            radius="md"
            fullWidth
            className={`btn-tool sidebar-nav-item layout-picker-trigger${
              opened ? ' active' : ''
            }`}
            aria-haspopup="dialog"
            aria-expanded={opened}
            aria-controls="layout-picker-popover"
            aria-label={tooltipLabel}
            onClick={() => handleOpenChange(!opened)}
            leftSection={
              <span className="sidebar-icon-wrap">
                <IconLayoutGrid
                  className="layout-grid-icon"
                  size={18}
                  stroke={1.8}
                  aria-hidden="true"
                />
              </span>
            }
            rightSection={
              !collapsed ? (
                <span className="layout-picker-badge" id="layout-picker-badge">
                  {currentDimText}
                </span>
              ) : null
            }
          >
            <span className="sidebar-label-text" data-i18n="nav.gridLayout">
              {navLabel}
            </span>
          </Button>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown
        id="layout-picker-popover"
        className="layout-picker-popover"
        role="dialog"
        aria-label={headerLabel}
        p={0}
      >
        <div className="layout-picker-header">
          <span
            className="layout-picker-title"
            data-i18n="nav.gridLayoutPickerHeader"
          >
            {headerLabel}
          </span>
        </div>

        <div className="layout-picker-body">
          <div
            className="layout-picker-grid"
            role="grid"
            aria-label={headerLabel}
            onMouseLeave={() => setHovered(null)}
          >
            {GRID_DIM_INDICES.map((r) => (
              <div key={r} className="layout-picker-row" role="row">
                {GRID_DIM_INDICES.map((c) => {
                  const isInPreview = r <= previewRows && c <= previewCols;
                  const isCursor =
                    isHovering && r === hovered.rows && c === hovered.cols;
                  const cellPreset = `${r}x${c}`;
                  const cellAriaLabel = isEn
                    ? `${r} ${r === 1 ? 'row' : 'rows'} by ${c} ${
                        c === 1 ? 'column' : 'columns'
                      } (${r}×${c})`
                    : `${r} 行 × ${c} 列 (${r}×${c})`;

                  return (
                    <UnstyledButton
                      key={cellPreset}
                      ref={(el) => {
                        cellRefs.current[cellPreset] = el;
                      }}
                      type="button"
                      role="gridcell"
                      aria-selected={isInPreview}
                      aria-label={cellAriaLabel}
                      data-rows={r}
                      data-cols={c}
                      data-preset={cellPreset}
                      className={[
                        'layout-picker-cell',
                        isInPreview ? 'is-selected' : '',
                        isHovering && isInPreview ? 'is-previewing' : '',
                        !isHovering && isInPreview ? 'is-current' : '',
                        isCursor ? 'is-cursor' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onMouseEnter={() => {
                        if (opened) setHovered({ rows: r, cols: c });
                      }}
                      onFocus={() => {
                        if (opened) setHovered({ rows: r, cols: c });
                      }}
                      onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                      onClick={() => handleSelectCell(r, c)}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div
            id="layout-picker-dimension"
            className={`layout-picker-footer${isHovering ? ' is-previewing' : ''}`}
            aria-live="polite"
          >
            <span className="layout-picker-dim-value">
              {previewRows} × {previewCols}
            </span>
            <span className="layout-picker-dim-detail">{dimDetailText}</span>
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
