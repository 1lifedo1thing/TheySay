const { MAX_SLOTS } = require('../core/constants');
const { showToast } = require('../core/utils');
const { getSavedGridLayout, saveGridLayout } = require('../core/storage');
const {
  updateSlotSizeUI,
  slotHasContent,
  syncAppUnreadBadge,
  archiveSlotScrapedData
} = require('./slot');
const { t } = require('../core/i18n');

function calculateCellHeight(rows) {
  let bannerOffset = 0;
  try {
    const banner = typeof document !== 'undefined' ? document.getElementById('auth-expired-banner') : null;
    if (banner && banner.style.display !== 'none' && banner.offsetHeight > 0) {
      bannerOffset = banner.offsetHeight + 6;
    }
  } catch (_) {}
  const availableHeight = window.innerHeight - 4 - bannerOffset; // top/bottom grid padding (2px + 2px) + expired banner
  return Math.max(160, Math.floor(availableHeight / rows));
}

const MIN_GRID_DIM = 1;
const MAX_GRID_DIM = 4;
const MAX_LAYOUT_HISTORY = 50;

function clampGridDim(val, fallback = 2) {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(MIN_GRID_DIM, Math.min(MAX_GRID_DIM, Math.round(val)));
}

function parsePreset(presetStr) {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(String(presetStr || '2x2'));
  if (!match) return { rows: 2, cols: 2 };
  return {
    rows: clampGridDim(Number(match[1]), 2),
    cols: clampGridDim(Number(match[2]), 2)
  };
}

function normalizeSnapshotItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && typeof item === 'object' && Number.isFinite(item.slotIndex))
    .map(item => ({
      id: item.id || `slot-${item.slotIndex}`,
      slotIndex: item.slotIndex,
      x: typeof item.x === 'number' ? item.x : 0,
      y: typeof item.y === 'number' ? item.y : 0,
      w: typeof item.w === 'number' ? item.w : 1,
      h: typeof item.h === 'number' ? item.h : 1
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

function captureGridSnapshot(grid, rows, cols) {
  const safeRows = clampGridDim(rows, 2);
  const safeCols = clampGridDim(cols, 2);
  const rawItems = [];
  if (grid && typeof grid.getGridItems === 'function') {
    grid.getGridItems().forEach(el => {
      const node = el.gridstackNode || {};
      const slotIndex = parseInt(el.getAttribute('data-slot-index'), 10);
      if (!Number.isFinite(slotIndex)) return;
      rawItems.push({
        id: el.getAttribute('gs-id') || `slot-${slotIndex}`,
        slotIndex,
        x: typeof node.x === 'number' ? node.x : 0,
        y: typeof node.y === 'number' ? node.y : 0,
        w: typeof node.w === 'number' ? node.w : 1,
        h: typeof node.h === 'number' ? node.h : 1
      });
    });
  }
  return {
    rows: safeRows,
    cols: safeCols,
    preset: `${safeRows}x${safeCols}`,
    items: normalizeSnapshotItems(rawItems)
  };
}

function cloneSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    rows: snapshot.rows,
    cols: snapshot.cols,
    preset: snapshot.preset,
    items: normalizeSnapshotItems(snapshot.items)
  };
}

function snapshotsEqual(a, b) {
  if (!a || !b) return false;
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  if (!Array.isArray(a.items) || !Array.isArray(b.items)) return false;
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    const ia = a.items[i];
    const ib = b.items[i];
    if (
      ia.slotIndex !== ib.slotIndex ||
      ia.x !== ib.x ||
      ia.y !== ib.y ||
      ia.w !== ib.w ||
      ia.h !== ib.h
    ) {
      return false;
    }
  }
  return true;
}

function createLayoutHistory(maxEntries = MAX_LAYOUT_HISTORY) {
  let current = null;
  const undoStack = [];
  const redoStack = [];
  let restoring = false;
  let interacting = false;

  return {
    reset(snapshot) {
      current = cloneSnapshot(snapshot);
      undoStack.length = 0;
      redoStack.length = 0;
    },
    beginInteraction() {
      interacting = true;
    },
    endInteraction(nextSnapshot) {
      interacting = false;
      return this.commit(nextSnapshot);
    },
    isInteracting() {
      return interacting;
    },
    isRestoring() {
      return restoring;
    },
    setRestoring(flag) {
      restoring = Boolean(flag);
    },
    commit(nextSnapshot) {
      if (restoring || interacting) return false;
      const normalized = cloneSnapshot(nextSnapshot);
      if (!normalized) return false;
      if (!current) {
        current = normalized;
        return false;
      }
      if (snapshotsEqual(current, normalized)) {
        return false;
      }
      undoStack.push(current);
      if (undoStack.length > maxEntries) {
        undoStack.shift();
      }
      current = normalized;
      redoStack.length = 0;
      return true;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    undo() {
      if (undoStack.length === 0) return null;
      const prev = undoStack.pop();
      if (current) {
        redoStack.push(current);
      }
      current = cloneSnapshot(prev);
      return cloneSnapshot(prev);
    },
    redo() {
      if (redoStack.length === 0) return null;
      const next = redoStack.pop();
      if (current) {
        undoStack.push(current);
      }
      current = cloneSnapshot(next);
      return cloneSnapshot(next);
    },
    getCounts() {
      return { undo: undoStack.length, redo: redoStack.length };
    }
  };
}

/**
 * GridStack (>= 13) calls a private `_sortDom()` at the end of every change event, which
 * re-appends each widget so DOM order matches the x/y layout order. Re-attaching a node
 * recreates its layout boxes, so every slot's `.slot-content-container` loses its scroll
 * position (jumps back to the oldest message) whenever any slot is dragged or resized.
 *
 * We never rely on DOM order (slots are addressed via `data-slot-index` / `gs-id` and
 * `saveGridLayout` persists slotIndex per item), so the reorder is pure churn — disable it.
 */
function disableGridDomSorting(grid) {
  if (!grid || typeof grid._sortDom !== 'function') return;
  grid._sortDom = () => grid;
}

/**
 * Computes a clean, non-overlapping horizontal block swap across the vertical split line
 * immediately adjacent to `node` in direction `dir` (+1 right, -1 left).
 *
 * The algorithm grows a minimal bounding rectangle `[leftX, rightX) x [yMin, yMax)` split
 * at `splitX` until no node protrudes outside the rectangle or crosses `splitX`.
 * Swapping the left partition `[leftX, splitX)` and right partition `[splitX, rightX)`
 * shifts every left node right by `rightWidth` and every right node left by `leftWidth`
 * without pushing any card vertically up or down.
 *
 * Returns `null` if the move is out of bounds, hits a locked node, or encounters an
 * interlocked node strictly spanning `splitX`.
 */
function computeAdjacentHorizontalBlockSwap(nodes, node, dir, columns) {
  if (!Array.isArray(nodes) || !node || (dir !== 1 && dir !== -1)) return null;
  if (!Number.isFinite(columns) || columns < 2) return null;

  const sx = Number(node.x) || 0;
  const sy = Number(node.y) || 0;
  const sw = Math.max(1, Number(node.w) || 1);
  const sh = Math.max(1, Number(node.h) || 1);
  if (node.locked) return null;

  const splitX = dir > 0 ? (sx + sw) : sx;
  if (splitX <= 0 || splitX >= columns) return null;

  let leftX = dir > 0 ? sx : (splitX - 1);
  let rightX = dir > 0 ? (splitX + 1) : (sx + sw);
  let yMin = sy;
  let yMax = sy + sh;

  let leftNodes = [];
  let rightNodes = [];
  let changed = true;
  let guard = 0;
  const maxIterations = Math.max(16, nodes.length * 4);

  while (changed) {
    if (guard++ > maxIterations) return null;
    changed = false;
    leftNodes = [];
    rightNodes = [];

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n) continue;
      const nx = Number(n.x) || 0;
      const ny = Number(n.y) || 0;
      const nw = Math.max(1, Number(n.w) || 1);
      const nh = Math.max(1, Number(n.h) || 1);
      const nRight = nx + nw;
      const nBottom = ny + nh;

      if (nBottom <= yMin || ny >= yMax) continue;
      if (nRight <= leftX || nx >= rightX) continue;

      if (n.locked) return null;
      if (nx < splitX && nRight > splitX) return null;

      if (nx < leftX) {
        leftX = nx;
        changed = true;
      }
      if (nRight > rightX) {
        rightX = nRight;
        changed = true;
      }
      if (ny < yMin) {
        yMin = ny;
        changed = true;
      }
      if (nBottom > yMax) {
        yMax = nBottom;
        changed = true;
      }

      if (nRight <= splitX) {
        leftNodes.push(n);
      } else {
        rightNodes.push(n);
      }
    }
  }

  if (leftX < 0 || rightX > columns || leftX >= splitX || rightX <= splitX) {
    return null;
  }

  const leftWidth = splitX - leftX;
  const rightWidth = rightX - splitX;
  const nodeSide = dir > 0 ? leftNodes : rightNodes;
  if (!nodeSide.includes(node)) {
    return null;
  }

  return {
    splitX,
    leftX,
    rightX,
    yMin,
    yMax,
    leftWidth,
    rightWidth,
    leftNodes,
    rightNodes
  };
}

/**
 * Attempts one or more adjacent horizontal block swaps toward `targetX`.
 * Returns:
 * - `'swapped'`: at least one horizontal block swap was applied
 * - `'pending'`: a valid swap exists, waiting for the dragged card to cross the midpoint threshold
 * - `'impossible'`: no clean horizontal block swap exists (caller may fall back)
 */
function tryHorizontalBlockSwap(nodes, node, targetX, columns, opt = {}) {
  if (!Array.isArray(nodes) || !node || typeof targetX !== 'number') {
    return 'impossible';
  }
  const origX = Number(node.x) || 0;
  if (targetX === origX) return 'impossible';

  const dir = targetX > origX ? 1 : -1;
  const hasPixelContext = Boolean(
    opt &&
    opt.rect &&
    node._rect &&
    typeof opt.cellWidth === 'number' &&
    opt.cellWidth > 0
  );

  let swappedAny = false;
  let sawPending = false;
  let guard = 0;

  while ((dir > 0 ? node.x < targetX : node.x > targetX) && guard++ < columns) {
    const plan = computeAdjacentHorizontalBlockSwap(nodes, node, dir, columns);
    if (!plan) {
      break;
    }

    // Require the dragged item to pass the midpoint of its horizontal jump to prevent oscillation
    const shiftCols = dir > 0 ? plan.rightWidth : plan.leftWidth;
    if (hasPixelContext) {
      const currentRefRectX = node._rect.x + (node.x - origX) * opt.cellWidth;
      const travelPx = dir > 0
        ? (opt.rect.x - currentRefRectX)
        : (currentRefRectX - opt.rect.x);
      if (travelPx <= (shiftCols * opt.cellWidth) / 2) {
        sawPending = true;
        break;
      }
    }

    for (let i = 0; i < plan.leftNodes.length; i++) {
      const n = plan.leftNodes[i];
      n.x += plan.rightWidth;
      n._dirty = true;
    }
    for (let i = 0; i < plan.rightNodes.length; i++) {
      const n = plan.rightNodes[i];
      n.x -= plan.leftWidth;
      n._dirty = true;
    }
    swappedAny = true;
  }

  if (swappedAny) return 'swapped';
  if (sawPending) return 'pending';
  return 'impossible';
}

/**
 * Creates a GridStackEngine subclass that swaps horizontal card bands in place during
 * active horizontal drags (e.g. dragging a 2-row-tall card onto two stacked 1-row cards
 * moves both stacked cards into the tall card's original position instead of pushing cards
 * vertically up or down).
 */
function createHorizontalSwapEngineClass(BaseEngine) {
  if (typeof BaseEngine !== 'function') return BaseEngine;

  return class HorizontalSwapGridStackEngine extends BaseEngine {
    moveNode(node, o) {
      if (
        node &&
        o &&
        node._moving &&
        !node._resizing &&
        !node._isExternal &&
        !o.nested &&
        !o.resizing &&
        !o.skip &&
        !this._loading &&
        !this.batchMode &&
        !this.float
      ) {
        const w = typeof o.w === 'number' ? o.w : node.w;
        const h = typeof o.h === 'number' ? o.h : node.h;
        const rawX = typeof o.x === 'number' ? o.x : node.x;
        const rawY = typeof o.y === 'number' ? o.y : node.y;

        if (w === node.w && h === node.h) {
          const maxX = Math.max(0, this.column - node.w);
          const clampedX = Math.max(0, Math.min(maxX, rawX));
          let clampedY = Math.max(0, rawY);
          if (this.maxRow && clampedY + node.h > this.maxRow) {
            clampedY = Math.max(0, this.maxRow - node.h);
          }

          if (clampedX !== node.x && clampedY === node.y) {
            const targetArea = { x: clampedX, y: clampedY, w: node.w, h: node.h };
            const collides = this.collideAll(node, targetArea);
            if (collides.length > 0) {
              const prevX = node.x;
              const prevY = node.y;
              const outcome = tryHorizontalBlockSwap(this.nodes, node, clampedX, this.column, o);
              if (outcome === 'swapped') {
                const shouldPack = o.pack !== undefined ? o.pack : !this.batchMode;
                if (shouldPack) {
                  this._packNodes()._notify();
                }
                return node.x !== prevX || node.y !== prevY;
              }
              if (outcome === 'pending') {
                return false;
              }
            }
          }
        }
      }

      return super.moveNode(node, o);
    }
  };
}

function syncGridSlotsState(grid, slots, { rows } = {}) {
  if (!Array.isArray(slots)) return;
  const attachedSlots = slots.filter(s => s && s.element && s.element.parentElement);
  const canClose = attachedSlots.length > 1;

  slots.forEach((slot) => {
    if (!slot || !slot.element) return;
    const isAttached = Boolean(slot.element.parentElement);
    const node = slot.element.gridstackNode;
    const isOverflow = Boolean(
      isAttached &&
      node &&
      Number.isFinite(rows) &&
      (node.y + (node.h || 1) > rows)
    );
    slot.element.classList.toggle('is-grid-overflow', isOverflow);
    if (slot.btnClose) {
      slot.btnClose.style.display = isAttached && canClose ? 'flex' : 'none';
    }
  });
}

function removeSlotFromGrid({ grid, slot, slots, rows, cols }) {
  if (!grid || !slot || !slot.element || !slot.element.parentElement || !Array.isArray(slots)) {
    return false;
  }

  const attachedSlots = slots.filter(s => s && s.element && s.element.parentElement);
  if (attachedSlots.length <= 1) {
    return false;
  }

  const hadContent = slotHasContent(slot);
  resetColumnHoverEffect(slots);
  archiveSlotScrapedData(slot);

  try {
    grid.removeWidget(slot.element, true, false);
  } catch (e) {}
  if (slot.element.parentElement) {
    slot.element.remove();
  }
  slot.element.classList.remove('is-grid-overflow');
  updateSlotSizeUI(slot, 1, 1);

  saveGridLayout(grid);
  syncAppUnreadBadge(slots);
  syncGridSlotsState(grid, slots, { rows, cols });

  if (hadContent) {
    showToast(t('slot.toastClosed'), 'info', 3000);
  }
  return true;
}

function applyGridLayout({
  grid,
  gridContainer,
  slots,
  rows,
  cols,
  resetPositions = false,
  explicitLayout = null,
  maxSlots = MAX_SLOTS
}) {
  if (!grid || !gridContainer || !Array.isArray(slots)) return;

  resetColumnHoverEffect(slots);

  const totalSlots = rows * cols;
  const hasExplicitLayout = Array.isArray(explicitLayout) && explicitLayout.length > 0;
  const savedLayout = hasExplicitLayout
    ? explicitLayout
    : (!resetPositions ? getSavedGridLayout() : null);
  const savedBySlot = {};
  let validSavedCount = 0;

  if (
    Array.isArray(savedLayout) &&
    savedLayout.length > 0 &&
    (hasExplicitLayout || savedLayout.length <= totalSlots)
  ) {
    savedLayout.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const sIdx = typeof item.slotIndex === 'number'
        ? item.slotIndex
        : (typeof item.id === 'string' && item.id.startsWith('slot-')
            ? parseInt(item.id.replace('slot-', ''), 10)
            : idx);
      const maxIndexBound = hasExplicitLayout ? maxSlots : totalSlots;
      const validHeight = hasExplicitLayout ? item.h >= 1 : (item.h >= 1 && item.h <= rows);
      if (
        Number.isFinite(sIdx) &&
        sIdx >= 0 &&
        sIdx < maxIndexBound &&
        !savedBySlot[sIdx] &&
        typeof item.x === 'number' &&
        typeof item.y === 'number' &&
        typeof item.w === 'number' &&
        typeof item.h === 'number' &&
        item.x >= 0 &&
        item.y >= 0 &&
        item.w >= 1 &&
        validHeight &&
        item.x + item.w <= cols
      ) {
        savedBySlot[sIdx] = { x: item.x, y: item.y, w: item.w, h: item.h };
        validSavedCount += 1;
      }
    });
  }

  // When every entry in a saved/explicit layout is valid for this (rows, cols) preset — including
  // custom layouts where the user closed extra slots after resizing a card or restored via undo —
  // preserve that exact subset of active slots rather than recreating closed slots.
  const useSavedSubset =
    (hasExplicitLayout || !resetPositions) &&
    Array.isArray(savedLayout) &&
    savedLayout.length > 0 &&
    (hasExplicitLayout || savedLayout.length <= totalSlots) &&
    validSavedCount === savedLayout.length;

  const targetIndices = useSavedSubset
    ? Object.keys(savedBySlot).map(Number).sort((a, b) => a - b)
    : Array.from({ length: totalSlots }, (_, i) => i);

  // Build target positions for active slots
  const occupiedRects = [];
  const activePlans = [];
  for (const i of targetIndices) {
    const slot = slots[i];
    if (!slot) continue;
    if (!resetPositions && savedBySlot[i]) {
      occupiedRects.push(savedBySlot[i]);
    }
  }

  const isCellOccupied = (x, y, w = 1, h = 1) =>
    occupiedRects.some(
      r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y
    );

  const findFirstFreeCell = () => {
    for (let y = 0; ; y++) {
      for (let x = 0; x < cols; x++) {
        if (!isCellOccupied(x, y, 1, 1)) {
          return { x, y, w: 1, h: 1 };
        }
      }
    }
  };

  for (const i of targetIndices) {
    const slot = slots[i];
    if (!slot) continue;
    let pos;
    if (!resetPositions && savedBySlot[i]) {
      pos = savedBySlot[i];
    } else if (resetPositions || occupiedRects.length === 0) {
      pos = { x: i % cols, y: Math.floor(i / cols), w: 1, h: 1 };
      occupiedRects.push(pos);
    } else {
      const defX = i % cols;
      const defY = Math.floor(i / cols);
      pos = !isCellOccupied(defX, defY, 1, 1)
        ? { x: defX, y: defY, w: 1, h: 1 }
        : findFirstFreeCell();
      occupiedRects.push(pos);
    }
    activePlans.push({ index: i, slot, pos });
  }

  // Sort active slots by target (y, x) ascending so top-gravity packing in GridStack
  // never pulls lower-row widgets upward into not-yet-populated upper cells.
  activePlans.sort((a, b) => (a.pos.y - b.pos.y) || (a.pos.x - b.pos.x) || (a.index - b.index));

  const activeIndexSet = new Set(activePlans.map(p => p.index));

  if (typeof grid.batchUpdate === 'function') {
    grid.batchUpdate(true);
  }
  if (grid.engine) {
    grid.engine._loading = true;
  }

  try {
    // 1. Remove inactive or closed widgets from GridStack and DOM
    for (let i = 0; i < maxSlots; i++) {
      if (activeIndexSet.has(i)) continue;
      const slot = slots[i];
      if (slot && slot.element.parentElement) {
        try {
          grid.removeWidget(slot.element, true, false);
        } catch (e) {}
        if (slot.element.parentElement) {
          slot.element.remove();
        }
      }
      if (slot) {
        slot.element.classList.remove('is-grid-overflow');
        updateSlotSizeUI(slot, 1, 1);
      }
    }

    // 2. Purge any orphan elements that do not belong to active slots
    const activeElements = new Set(activePlans.map(p => p.slot.element));
    Array.from(gridContainer.children).forEach(child => {
      if (!activeElements.has(child) && !child.classList.contains('grid-stack-placeholder')) {
        try {
          grid.removeWidget(child, true, false);
        } catch (e) {}
        if (child.parentElement) {
          child.remove();
        }
      }
    });

    // 3. Temporarily detach existing active nodes from engine.nodes before column change & repositioning
    // so neither columnChanged nor out-of-order stale coordinates cause collisions.
    if (grid.engine && Array.isArray(grid.engine.nodes)) {
      grid.engine.nodes = grid.engine.nodes.filter(n => !n || !activeElements.has(n.el));
    }

    grid.column(cols, 'none');
    grid.cellHeight(calculateCellHeight(rows));

    // 4. Attach and position active slots in sorted (y, x) order
    for (const { index: i, slot, pos } of activePlans) {
      const el = slot.element;
      const isAttached = !!el.parentElement;

      el.setAttribute('gs-x', String(pos.x));
      el.setAttribute('gs-y', String(pos.y));
      el.setAttribute('gs-w', String(pos.w));
      el.setAttribute('gs-h', String(pos.h));

      if (!isAttached) {
        gridContainer.appendChild(el);
        grid.makeWidget(el, {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          autoPosition: false,
          id: `slot-${i}`
        });
      } else if (el.gridstackNode) {
        const node = el.gridstackNode;
        if (grid.engine && Array.isArray(grid.engine.nodes) && !grid.engine.nodes.includes(node)) {
          grid.engine.nodes.push(node);
        }
        if (node.x === pos.x && node.y === pos.y && node.w === pos.w && node.h === pos.h) {
          if (typeof grid.moveNode === 'function' && grid.engine && grid.engine.nodes.length > 1) {
            grid.moveNode(node, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, forceCollide: true });
          }
          node._dirty = true;
        } else {
          grid.update(el, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, autoPosition: false });
        }
      } else {
        grid.makeWidget(el, {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          autoPosition: false,
          id: `slot-${i}`
        });
      }
      updateSlotSizeUI(slot, pos.w, pos.h);
    }
  } finally {
    if (grid.engine) {
      delete grid.engine._loading;
    }
    if (typeof grid.batchUpdate === 'function') {
      grid.batchUpdate(false);
    }
  }

  saveGridLayout(grid);
  syncAppUnreadBadge(slots);
  syncGridSlotsState(grid, slots, { rows, cols });
}

function requestSlotResize({ grid, slot, targetW, targetH, currentRows, currentCols, slots }) {
  if (!grid || !slot) return;
  const node = slot.element.gridstackNode;
  if (!node) return;

  // Already at target size
  if (node.w === targetW && node.h === targetH) {
    return;
  }

  // Restoring to 1x1 is always allowed
  if (targetW === 1 && targetH === 1) {
    grid.update(slot.element, { w: 1, h: 1 });
    updateSlotSizeUI(slot, 1, 1);
    saveGridLayout(grid);
    syncGridSlotsState(grid, slots, { rows: currentRows, cols: currentCols });
    return;
  }

  // Check if grid capacity is sufficient (targetH is rows, targetW is cols)
  if (targetW > currentCols) {
    showToast(t('grid.notEnoughCols', { currentCols, targetW }), 'warning', 4500);
    return;
  }
  if (targetH > currentRows) {
    showToast(t('grid.notEnoughRows', { currentRows, targetH }), 'warning', 4500);
    return;
  }

  // Determine target coordinates in the grid (stay in bounds)
  let targetX = node.x;
  let targetY = node.y;

  if (targetX + targetW > currentCols) {
    targetX = Math.max(0, currentCols - targetW);
  }
  if (targetY + targetH > currentRows) {
    targetY = Math.max(0, currentRows - targetH);
  }

  // Collision detection: Check if any other slots inside target rectangle have content
  const conflicts = [];

  for (let i = 0; i < slots.length; i++) {
    const otherSlot = slots[i];
    if (!otherSlot || otherSlot.index === slot.index) continue;
    if (!otherSlot.element.parentElement) continue;
    const otherNode = otherSlot.element.gridstackNode;
    if (!otherNode) continue;

    // Check if otherNode intersects with [targetX, targetX + targetW) x [targetY, targetY + targetH)
    const overlaps = (
      otherNode.x < targetX + targetW &&
      otherNode.x + otherNode.w > targetX &&
      otherNode.y < targetY + targetH &&
      otherNode.y + otherNode.h > targetY
    );

    if (overlaps && slotHasContent(otherSlot)) {
      conflicts.push(otherSlot);
    }
  }

  if (conflicts.length > 0) {
    // Shake and highlight conflicting slots in red
    conflicts.forEach(c => {
      c.card.classList.remove('slot-card-conflict');
      void c.card.offsetWidth; // force DOM reflow
      c.card.classList.add('slot-card-conflict');
      setTimeout(() => c.card.classList.remove('slot-card-conflict'), 1800);
    });

    const conflictNames = conflicts.map(c => {
      const h = c.handleInput.value.trim();
      return h ? `@${h}` : t('grid.cardFallbackName');
    }).join(', ');

    showToast(t('grid.conflictResize', { targetH, targetW, conflictNames }), 'warning', 5000);
    return;
  }

  // No content conflict! Update widget position & dimensions
  resetColumnHoverEffect(slots);
  grid.update(slot.element, { x: targetX, y: targetY, w: targetW, h: targetH });
  updateSlotSizeUI(slot, targetW, targetH);
  saveGridLayout(grid);
  syncGridSlotsState(grid, slots, { rows: currentRows, cols: currentCols });
}

const SECTION_STAY_RESTORE_MS = 20000;
const HEADER_HOVER_DWELL_MS = 140;

let hoverEffectState = {
  expandedSlotIndex: null,
  staySlotIndex: null,
  stayTimer: null,
  headerTimer: null,
  pendingHeaderSlotIndex: null,
  pointerDownInfo: null,
  lastClientX: -1,
  lastClientY: -1,
  isInteractingWithGrid: false
};

function clearHoverTimers() {
  if (hoverEffectState.stayTimer) {
    clearTimeout(hoverEffectState.stayTimer);
    hoverEffectState.stayTimer = null;
  }
  if (hoverEffectState.headerTimer) {
    clearTimeout(hoverEffectState.headerTimer);
    hoverEffectState.headerTimer = null;
  }
  hoverEffectState.pendingHeaderSlotIndex = null;
}

function isAnyOverlayOpen() {
  if (typeof document === 'undefined') return false;
  const postPopup = document.getElementById('tweet-popup-overlay');
  if (postPopup && !postPopup.classList.contains('is-closed')) return true;
  const settingsModal = document.getElementById('settings-modal-overlay');
  if (settingsModal && !settingsModal.classList.contains('is-closed')) return true;
  return false;
}

function isSettingsOverlayOpen() {
  if (typeof document === 'undefined') return false;
  const settingsModal = document.getElementById('settings-modal-overlay');
  return Boolean(settingsModal && !settingsModal.classList.contains('is-closed'));
}

function restartSectionStayTimer(slots) {
  if (hoverEffectState.stayTimer) {
    clearTimeout(hoverEffectState.stayTimer);
    hoverEffectState.stayTimer = null;
  }
  if (hoverEffectState.expandedSlotIndex === null) {
    return;
  }
  hoverEffectState.stayTimer = setTimeout(() => {
    hoverEffectState.stayTimer = null;
    if (hoverEffectState.expandedSlotIndex !== null) {
      if (isAnyOverlayOpen()) {
        restartSectionStayTimer(slots);
      } else {
        restoreColumnHoverEffect(slots);
      }
    }
  }, SECTION_STAY_RESTORE_MS);
}

function formatCellCalc(multiplier) {
  const rounded = Math.round(multiplier * 1000) / 1000;
  if (rounded === 0) return '0px';
  if (rounded === 1) return 'var(--gs-cell-height)';
  return `calc(${rounded} * var(--gs-cell-height))`;
}

function applySlotVerticalGeometry(slot, newY, newH, isExpanded) {
  if (!slot || !slot.element) return;
  slot.element.style.top = formatCellCalc(newY);
  slot.element.style.height = formatCellCalc(newH);
  slot.element.classList.toggle('is-hover-expanded', Boolean(isExpanded));
  slot.element.classList.toggle('is-hover-squeezed', !isExpanded);
}

function restoreSlotVerticalGeometry(slot) {
  if (!slot || !slot.element) return;
  slot.element.classList.remove('is-hover-expanded', 'is-hover-squeezed');
  const n = slot.element.gridstackNode;
  if (!n) {
    slot.element.style.top = '';
    slot.element.style.height = '';
    return;
  }
  slot.element.style.top = n.y
    ? (n.y === 1 ? 'var(--gs-cell-height)' : `calc(${n.y} * var(--gs-cell-height))`)
    : '';
  slot.element.style.height = n.h > 1 ? `calc(${n.h} * var(--gs-cell-height))` : '';
}

function restoreColumnHoverEffect(slots) {
  clearHoverTimers();
  hoverEffectState.staySlotIndex = null;

  if (hoverEffectState.expandedSlotIndex === null) {
    return;
  }

  hoverEffectState.expandedSlotIndex = null;

  if (Array.isArray(slots)) {
    slots.forEach(s => restoreSlotVerticalGeometry(s));
  }
}

function clearHeaderHiddenState(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(s => {
    if (s && s.card) {
      s.card.classList.remove('is-header-hidden');
    }
  });
}

function resetColumnHoverEffect(slots) {
  clearHoverTimers();
  hoverEffectState.expandedSlotIndex = null;
  hoverEffectState.staySlotIndex = null;
  if (hoverEffectState.pointerDownInfo) {
    hoverEffectState.pointerDownInfo.didDragOrResize = true;
  }
  clearHeaderHiddenState(slots);
  if (Array.isArray(slots)) {
    slots.forEach(s => restoreSlotVerticalGeometry(s));
  }
}

function expandSlotInColumn(targetSlot, slots, getGridDimensions) {
  if (!targetSlot || !targetSlot.element || !targetSlot.element.parentElement) return;
  const targetNode = targetSlot.element.gridstackNode;
  if (!targetNode) return;

  const activeSlots = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && s.element && s.element.parentElement && s.element.gridstackNode) {
      activeSlots.push(s);
    }
  }

  // Group slots in the same column span vs other columns
  const colSlots = [];
  const otherSlots = [];
  activeSlots.forEach(s => {
    const n = s.element.gridstackNode;
    const overlapsColumn = (n.x < targetNode.x + targetNode.w) && (n.x + n.w > targetNode.x);
    if (overlapsColumn) {
      colSlots.push(s);
    } else {
      otherSlots.push(s);
    }
  });

  // Restore any slots in other columns
  otherSlots.forEach(s => restoreSlotVerticalGeometry(s));

  // If this column only has a single slot, nothing to squeeze
  if (colSlots.length <= 1) {
    clearHoverTimers();
    hoverEffectState.expandedSlotIndex = null;
    hoverEffectState.staySlotIndex = null;
    restoreSlotVerticalGeometry(targetSlot);
    return;
  }

  clearHoverTimers();
  hoverEffectState.expandedSlotIndex = targetSlot.index;
  hoverEffectState.staySlotIndex = targetSlot.index;

  // Compute new vertical positions per column covered by targetSlot
  const startCol = targetNode.x;
  const endCol = targetNode.x + (targetNode.w || 1);
  let targetApplied = false;

  for (let c = startCol; c < endCol; c++) {
    const trackSlots = colSlots
      .filter(s => {
        const n = s.element.gridstackNode;
        return n.x <= c && (n.x + (n.w || 1)) > c;
      })
      .sort((a, b) => {
        const na = a.element.gridstackNode;
        const nb = b.element.gridstackNode;
        if (na.y !== nb.y) return na.y - nb.y;
        return a.index - b.index;
      });

    if (trackSlots.length <= 1) {
      if (trackSlots[0]) restoreSlotVerticalGeometry(trackSlots[0]);
      continue;
    }

    let bonusH = 0;
    trackSlots.forEach(s => {
      const n = s.element.gridstackNode;
      const origH = (n && n.h) || 1;
      if (s.index !== targetSlot.index) {
        bonusH += origH * 0.5;
      }
    });

    let currentY = (trackSlots[0].element.gridstackNode && trackSlots[0].element.gridstackNode.y) || 0;
    trackSlots.forEach(s => {
      const n = s.element.gridstackNode;
      const origH = (n && n.h) || 1;
      const isTarget = s.index === targetSlot.index;
      const newH = isTarget ? (origH + bonusH) : (origH * 0.5);
      const newY = currentY;
      currentY += newH;

      if (!isTarget || !targetApplied) {
        applySlotVerticalGeometry(s, newY, newH, isTarget);
        if (isTarget) targetApplied = true;
      }
    });
  }

  // Restore after staying in the same section for > 20s
  restartSectionStayTimer(slots);
}

function initColumnHoverEffect({
  gridContainer,
  slots,
  getGrid,
  getGridDimensions,
  onInteractionStart,
  onInteractionEnd
}) {
  if (!gridContainer || !Array.isArray(slots)) return;

  gridContainer.addEventListener('mouseleave', () => {
    clearHeaderHiddenState(slots);
    if (hoverEffectState.headerTimer) {
      clearTimeout(hoverEffectState.headerTimer);
      hoverEffectState.headerTimer = null;
      hoverEffectState.pendingHeaderSlotIndex = null;
    }
  });

  gridContainer.addEventListener('mousedown', (e) => {
    if (e.button && e.button !== 0) {
      hoverEffectState.pointerDownInfo = null;
      return;
    }
    const target = e.target;
    const inIgnoredControl = Boolean(
      target &&
      typeof target.closest === 'function' &&
      target.closest('.im-date-pill, .slot-header, .slot-pinned-container, .slot-size-menu, .ui-resizable-n, .ui-resizable-nw, .ui-resizable-ne, a, button, input, textarea, select, label')
    );
    hoverEffectState.pointerDownInfo = {
      x: e.clientX,
      y: e.clientY,
      inIgnoredControl,
      wasOverlayOpen: isAnyOverlayOpen(),
      didDragOrResize: false
    };
  }, true);

  // Clicking on a post bubble, blank space, or resize handle arrows in a section triggers height expansion
  gridContainer.addEventListener('click', (e) => {
    const downInfo = hoverEffectState.pointerDownInfo;
    hoverEffectState.pointerDownInfo = null;

    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    const inBubble = Boolean(target.closest('.im-bubble'));
    const overlayWasOpen = downInfo
      ? downInfo.wasOverlayOpen
      : (isSettingsOverlayOpen() || (!inBubble && isAnyOverlayOpen()));

    if (hoverEffectState.isInteractingWithGrid || overlayWasOpen) {
      return;
    }
    if (e.button && e.button !== 0) {
      return;
    }
    if (downInfo) {
      if (downInfo.inIgnoredControl || downInfo.didDragOrResize) return;
      if (Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) > 6) return;
    }
    if (typeof window.getSelection === 'function') {
      const sel = window.getSelection();
      if (sel && String(sel).trim().length > 0) return;
    }

    // Ignore clicks on date pills, headers, top resize edges, pinned bars, or interactive controls
    if (target.closest('.im-date-pill, .slot-header, .slot-pinned-container, .slot-size-menu, .ui-resizable-n, .ui-resizable-nw, .ui-resizable-ne, a, button, input, textarea, select, label')) {
      return;
    }

    const contentEl = target.closest('.slot-content-container');
    const resizeHandleEl = target.closest('.ui-resizable-handle');
    if (!contentEl && !resizeHandleEl) return;

    if (contentEl && !inBubble) {
      // Ignore clicks on the scrollbar area of the content container
      const contentRect = contentEl.getBoundingClientRect();
      if (
        e.clientX > contentRect.left + contentEl.clientWidth ||
        e.clientY > contentRect.top + contentEl.clientHeight
      ) {
        return;
      }
    }

    const itemEl = (contentEl || resizeHandleEl).closest('.grid-stack-item');
    if (!itemEl || itemEl.parentElement !== gridContainer) return;

    const slotIndex = parseInt(itemEl.getAttribute('data-slot-index'), 10);
    if (!Number.isFinite(slotIndex) || !slots[slotIndex]) return;
    const slot = slots[slotIndex];

    if (!inBubble && hoverEffectState.expandedSlotIndex === slot.index) {
      restoreColumnHoverEffect(slots);
      return;
    }

    expandSlotInColumn(slot, slots, getGridDimensions);
  });

  gridContainer.addEventListener('mousemove', (e) => {
    // Ignore synthetic mousemove fired by layout reflow when cursor is stationary
    if (e.clientX === hoverEffectState.lastClientX && e.clientY === hoverEffectState.lastClientY) {
      return;
    }
    hoverEffectState.lastClientX = e.clientX;
    hoverEffectState.lastClientY = e.clientY;

    if (hoverEffectState.isInteractingWithGrid || isAnyOverlayOpen()) {
      clearHeaderHiddenState(slots);
      return;
    }

    const target = e.target;
    if (!target || typeof target.closest !== 'function') {
      clearHeaderHiddenState(slots);
      return;
    }

    const itemEl = target.closest('.grid-stack-item');
    if (!itemEl || itemEl.parentElement !== gridContainer) {
      clearHeaderHiddenState(slots);
      return;
    }

    const slotIndex = parseInt(itemEl.getAttribute('data-slot-index'), 10);
    if (!Number.isFinite(slotIndex) || !slots[slotIndex]) {
      clearHeaderHiddenState(slots);
      return;
    }
    const slot = slots[slotIndex];

    // Moving cursor onto a section's header (用户名那栏) or top resize edge shows the header and restores column heights
    const headerEl = target.closest('.slot-header, .ui-resizable-n, .ui-resizable-nw, .ui-resizable-ne');
    const cardRect = slot.card ? slot.card.getBoundingClientRect() : null;
    const inHeaderZone = Boolean(
      headerEl || (cardRect && e.clientY >= cardRect.top - 4 && e.clientY <= cardRect.top + 28)
    );
    if (inHeaderZone) {
      clearHeaderHiddenState(slots);
      if (hoverEffectState.expandedSlotIndex !== null) {
        const node = slot.element.gridstackNode;
        const isTopRowHeader = Boolean(node && node.y === 0);
        const isExpandedSectionHeader = slot.index === hoverEffectState.expandedSlotIndex;

        if (isTopRowHeader || isExpandedSectionHeader) {
          if (hoverEffectState.headerTimer) {
            clearTimeout(hoverEffectState.headerTimer);
            hoverEffectState.headerTimer = null;
          }
          hoverEffectState.pendingHeaderSlotIndex = null;
          restoreColumnHoverEffect(slots);
        } else if (hoverEffectState.pendingHeaderSlotIndex !== slot.index) {
          if (hoverEffectState.headerTimer) {
            clearTimeout(hoverEffectState.headerTimer);
          }
          hoverEffectState.pendingHeaderSlotIndex = slot.index;
          hoverEffectState.headerTimer = setTimeout(() => {
            hoverEffectState.headerTimer = null;
            hoverEffectState.pendingHeaderSlotIndex = null;
            restoreColumnHoverEffect(slots);
          }, HEADER_HOVER_DWELL_MS);
        }
      }
      return;
    }

    // Cursor is inside the section below the header (content area or resize handles):
    // hide this slot's header (unless its menu is open or its handle input is focused)
    const hasOpenMenu = Boolean(slot.header && slot.header.classList.contains('has-open-menu'));
    const isInputFocused = Boolean(slot.handleInput && document.activeElement === slot.handleInput);
    const shouldHideHeader = !hasOpenMenu && !isInputFocused;
    slots.forEach(s => {
      if (s && s.card) {
        s.card.classList.toggle('is-header-hidden', shouldHideHeader && s.index === slot.index);
      }
    });

    // Cursor is not in header: cancel any pending header restore timer
    if (hoverEffectState.headerTimer) {
      clearTimeout(hoverEffectState.headerTimer);
      hoverEffectState.headerTimer = null;
      hoverEffectState.pendingHeaderSlotIndex = null;
    }

    // Track 20s stay duration per section while a column is expanded
    if (hoverEffectState.expandedSlotIndex !== null && hoverEffectState.staySlotIndex !== slot.index) {
      hoverEffectState.staySlotIndex = slot.index;
      restartSectionStayTimer(slots);
    }
  });

  const grid = getGrid ? getGrid() : null;
  if (grid) {
    grid.on('dragstart resizestart', () => {
      hoverEffectState.isInteractingWithGrid = true;
      resetColumnHoverEffect(slots);
      if (typeof onInteractionStart === 'function') {
        onInteractionStart();
      }
    });
    grid.on('dragstop resizestop', () => {
      hoverEffectState.isInteractingWithGrid = false;
      saveGridLayout(grid);
      syncGridSlotsState(grid, slots, getGridDimensions ? getGridDimensions() : {});
      if (typeof onInteractionEnd === 'function') {
        onInteractionEnd();
      }
    });
  }
}

module.exports = {
  calculateCellHeight,
  parsePreset,
  captureGridSnapshot,
  snapshotsEqual,
  createLayoutHistory,
  disableGridDomSorting,
  computeAdjacentHorizontalBlockSwap,
  tryHorizontalBlockSwap,
  createHorizontalSwapEngineClass,
  syncGridSlotsState,
  removeSlotFromGrid,
  applyGridLayout,
  requestSlotResize,
  initColumnHoverEffect,
  resetColumnHoverEffect
};

