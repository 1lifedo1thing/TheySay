import React from 'react';
import { UnstyledButton, Tooltip } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

function calcHorizontal(val) {
  if (val === 0) return '0px';
  if (val === 1) return 'var(--gs-column-width)';
  return `calc(${val} * var(--gs-column-width))`;
}

function calcVertical(val) {
  if (val === 0) return '0px';
  if (val === 1) return 'var(--gs-cell-height)';
  return `calc(${val} * var(--gs-cell-height))`;
}

export function GridEmptySlotsOverlay({
  regions = [],
  addLabel = '添加新板块',
  onAdd
}) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return null;
  }

  return regions.map((region) => {
    const key = `${region.x}-${region.y}-${region.w}-${region.h}`;
    return (
      <div
        key={key}
        className="grid-empty-slot"
        data-empty-x={region.x}
        data-empty-y={region.y}
        data-empty-w={region.w}
        data-empty-h={region.h}
        style={{
          left: calcHorizontal(region.x),
          top: calcVertical(region.y),
          width: calcHorizontal(region.w),
          height: calcVertical(region.h)
        }}
      >
        <UnstyledButton
          type="button"
          className="grid-empty-slot-btn"
          data-empty-x={region.x}
          data-empty-y={region.y}
          data-empty-w={region.w}
          data-empty-h={region.h}
          aria-label={addLabel}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof onAdd === 'function') {
              onAdd(region);
            }
          }}
        >
          <Tooltip label={addLabel} position="top" offset={8} withArrow openDelay={300}>
            <span className="grid-empty-slot-plus" aria-hidden="true">
              <IconPlus size={22} stroke={2} />
            </span>
          </Tooltip>
        </UnstyledButton>
      </div>
    );
  });
}

