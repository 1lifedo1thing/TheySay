const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_TWITTER_INTERVAL_KEY,
  STORAGE_THREADS_INTERVAL_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_HEADER_BG_COLOR_KEY,
  STORAGE_CHAT_BG_COLOR_KEY,
  STORAGE_BUBBLE_BG_COLOR_KEY,
  STORAGE_LANGUAGE_KEY,
  STORAGE_ONBOARDING_COMPLETED_KEY
} = require('../src/core/constants');
const { isChineseLocale, resolveLanguageCode } = require('../src/core/i18n');

test.describe.serial('TheySay Electron Integration Tests', () => {
  let electronApp;
  let page;
  let userDataDir;

  async function selectGridLayout(targetPage, preset) {
    await targetPage.locator('#layout-select').click();
    const popover = targetPage.locator('#layout-picker-popover');
    await expect(popover).toBeVisible();
    const cell = popover.locator(`.layout-picker-cell[data-preset="${preset}"]`);
    await cell.hover();
    await cell.click();
    await expect(popover).toBeHidden();
  }

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theysay-integration-'));
    fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });

    electronApp = await electron.launch({
      executablePath: require('electron'),
      args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        path.join(__dirname, '..', 'main.js')
      ],
      env: {
        ...process.env,
        THEYSAY_USER_DATA_DIR: userDataDir,
        THEYSAY_BACKGROUND_TEST: '1'
      }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#grid-stack-container')).toBeVisible();
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (userDataDir && fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('1. App bootstrap, main process metadata & window initialization', async () => {
    const appInfo = await electronApp.evaluate(async ({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const bounds = win ? win.getBounds() : null;
      return {
        name: app.getName(),
        userData: app.getPath('userData'),
        platform: process.platform,
        windowCount: BrowserWindow.getAllWindows().length,
        isVisible: win ? win.isVisible() : false,
        isMaximized: win ? win.isMaximized() : false,
        isFullScreen: win ? win.isFullScreen() : false,
        dockVisible: process.platform === 'darwin' && app.dock ? app.dock.isVisible() : null,
        bounds
      };
    });

    expect(appInfo.name).toBe('TheySay');
    expect(path.resolve(appInfo.userData)).toBe(path.resolve(userDataDir));
    expect(appInfo.windowCount).toBeGreaterThanOrEqual(1);
    expect(appInfo.bounds.width).toBeGreaterThanOrEqual(850);
    expect(appInfo.bounds.width).toBeLessThanOrEqual(1140);
    expect(appInfo.bounds.height).toBeGreaterThanOrEqual(650);
    expect(appInfo.bounds.height).toBeLessThanOrEqual(740);
    expect(appInfo.isMaximized).toBe(false);
    expect(appInfo.isFullScreen).toBe(false);
    if (process.platform === 'darwin') {
      expect(appInfo.isVisible).toBe(false);
      expect(appInfo.dockVisible).toBe(false);
    }

    await expect(page).toHaveTitle(/TheySay/);
    await expect(page.locator('.brand-title')).toHaveText('TheySay');
    await expect(page.locator('header.top-nav')).toHaveClass(/mantine-Paper-root/);
    await expect(page.locator('header.top-nav')).toHaveClass(/mantine-side-nav/);
    await expect(page.locator('header.top-nav')).toHaveClass(/is-collapsed/);

    // Verify first-launch onboarding tour automatically activates on Step 1 (left login button)
    await expect(page.locator('body')).toHaveClass(/driver-active/);
    await expect(page.locator('#btn-login-menu')).toHaveClass(/driver-active-element/);
    const onboardingPopover = page.locator('.driver-popover.theysay-onboarding-popover');
    await expect(onboardingPopover).toBeVisible();
    await expect(onboardingPopover.locator('.driver-popover-progress-text')).toHaveText('1 / 2');
    await expect(onboardingPopover.locator('[data-onboarding-step="login"]')).toBeVisible();
    await expect(onboardingPopover.locator('.onboarding-platform-row')).toHaveCount(3);

    // Advance to Step 2 (slot input wrapper showcasing all 3 platform formats in one pop-up)
    await onboardingPopover.locator('.driver-popover-next-btn').click();
    await expect(page.locator('#slot-input-wrapper-0')).toHaveClass(/driver-active-element/);
    await expect(onboardingPopover.locator('.driver-popover-progress-text')).toHaveText('2 / 2');
    await expect(onboardingPopover.locator('[data-onboarding-step="input"]')).toBeVisible();
    await expect(onboardingPopover.locator('.onboarding-format-card[data-platform="twitter"]')).toBeVisible();
    await expect(onboardingPopover.locator('.onboarding-format-card[data-platform="threads"]')).toBeVisible();
    await expect(onboardingPopover.locator('.onboarding-format-card[data-platform="discord"]')).toBeVisible();
    await expect(onboardingPopover.locator('.onboarding-format-code[data-example="elonmusk"]')).toBeVisible();
    await expect(onboardingPopover.locator('.onboarding-format-code[data-example="threads:@zuck"]')).toBeVisible();
    await expect(
      onboardingPopover.locator(
        '.onboarding-format-code[data-example="https://discord.com/channels/100000000000000001/200000000000000002"]'
      )
    ).toBeVisible();

    // Complete the onboarding tour and verify persistence
    await onboardingPopover.locator('.driver-popover-next-btn').click();
    await expect(page.locator('body')).not.toHaveClass(/driver-active/);
    const onboardingDoneVal = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_ONBOARDING_COMPLETED_KEY
    );
    expect(onboardingDoneVal).toBe('1');

    await expect(page.locator('#btn-sidebar-toggle')).toBeVisible();
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('header.top-nav')).toHaveClass(/is-expanded/);
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('header.top-nav')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#btn-mark-all-read')).toBeVisible();
    await expect(page.locator('#btn-mark-all-read')).toHaveClass(/mantine-Button-root/);
    await expect(page.locator('#layout-select')).toBeVisible();
    await expect(page.locator('#layout-select')).toHaveClass(/mantine-Button-root/);
    await expect(page.locator('#layout-select')).toHaveClass(/layout-picker-trigger/);
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#btn-theme-toggle')).toBeVisible();
    await expect(page.locator('#btn-settings')).toBeVisible();
    await expect(page.locator('#btn-settings')).toHaveClass(/mantine-ActionIcon-root/);
    await expect(page.locator('#btn-login-menu')).toBeVisible();
    await expect(page.locator('#btn-login-menu')).toHaveClass(/mantine-Button-root/);
  });

  test('2. Grid layout presets, slot mute toggle & borderless TradingView header', async () => {
    // Default preset is 2x2 (4 visible slots)
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);

    // Open Google Docs-style 4x4 grid layout picker popover and verify hover preview
    await page.locator('#layout-select').click();
    const layoutPopover = page.locator('#layout-picker-popover');
    await expect(layoutPopover).toBeVisible();
    await expect(layoutPopover.locator('.layout-picker-cell')).toHaveCount(16);
    await expect(layoutPopover.locator('.layout-picker-cell.is-current')).toHaveCount(4);
    await expect(layoutPopover.locator('#layout-picker-dimension .layout-picker-dim-value')).toHaveText('2 × 2');

    // Hover 2x3 cell (2 rows x 3 cols = 6 highlighted preview cells)
    await layoutPopover.locator('.layout-picker-cell[data-preset="2x3"]').hover();
    await expect(layoutPopover.locator('.layout-picker-cell.is-previewing')).toHaveCount(6);
    await expect(layoutPopover.locator('.layout-picker-cell[data-preset="2x3"]')).toHaveClass(/is-cursor/);
    await expect(layoutPopover.locator('#layout-picker-dimension .layout-picker-dim-value')).toHaveText('2 × 3');

    // Hover 1x4 cell (1 row x 4 cols = 4 highlighted preview cells)
    await layoutPopover.locator('.layout-picker-cell[data-preset="1x4"]').hover();
    await expect(layoutPopover.locator('.layout-picker-cell.is-previewing')).toHaveCount(4);
    await expect(layoutPopover.locator('#layout-picker-dimension .layout-picker-dim-value')).toHaveText('1 × 4');

    // Escape closes popover without changing active layout
    await page.keyboard.press('Escape');
    await expect(layoutPopover).toBeHidden();
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);

    // Select non-square 2x3 layout (2 rows x 3 cols = 6 visible slots) and verify geometry
    await selectGridLayout(page, '2x3');
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);
    const coords2x3 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item')).map((el) => ({
        x: el.gridstackNode.x,
        y: el.gridstackNode.y
      }))
    );
    expect(Math.max(...coords2x3.map((p) => p.x))).toBe(2);
    expect(Math.max(...coords2x3.map((p) => p.y))).toBe(1);

    // Select 1x1 layout (single full-screen slot) and verify close button is hidden when only 1 card remains
    await selectGridLayout(page, '1x1');
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '1x1');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(1);
    await expect(page.locator('#btn-close-0')).toBeHidden();

    // Verify resizing a card to 2x height in 2x3 pushes the slot underneath into overflow,
    // clicking its close (×) button removes it, the 5-card layout persists across reload,
    // and re-selecting 2x3 in the layout picker restores all 6 slots cleanly.
    await selectGridLayout(page, '2x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);
    await expect(page.locator('#btn-close-5')).toBeVisible();
    await page.waitForTimeout(250);

    // Drag the bottom resize handle of slot 2 (top-right, x=2, y=0) down to span 2 rows
    const slot2Item = page.locator('.grid-stack-item[data-slot-index="2"]');
    await slot2Item.hover();
    const resizeHandle2 = slot2Item.locator('.ui-resizable-s');
    await expect(resizeHandle2).toBeVisible();
    const slot5Box = await page.locator('.grid-stack-item[data-slot-index="5"]').boundingBox();
    const rhBox = await resizeHandle2.boundingBox();
    await page.mouse.move(rhBox.x + rhBox.width / 2, rhBox.y + rhBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rhBox.x + rhBox.width / 2,
      slot5Box.y + slot5Box.height - 8,
      { steps: 12 }
    );
    await page.waitForTimeout(200);
    await page.mouse.up();

    // Slot 2 is now h=2 and pushed slot 5 below row 2 (marked .is-grid-overflow)
    await expect(page.locator('.grid-stack-item[data-slot-index="2"]')).toHaveAttribute('gs-h', '2');
    const pushedSlot5 = page.locator('.grid-stack-item[data-slot-index="5"]');
    await expect(pushedSlot5).toHaveAttribute('gs-y', '2');
    await expect(pushedSlot5).toHaveClass(/is-grid-overflow/);

    // Close the pushed-down extra slot 5 via its header × button
    await page.locator('#btn-close-5').click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(5);
    await expect(page.locator('#slot-card-5')).toHaveCount(0);
    await expect(page.locator('.grid-stack-item.is-grid-overflow')).toHaveCount(0);

    // Reload and verify the 5-card asymmetric layout persists (slot 2 stays h=2, slot 5 stays closed)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(5);
    await expect(page.locator('.grid-stack-item[data-slot-index="2"]')).toHaveAttribute('gs-h', '2');
    await expect(page.locator('#slot-card-5')).toHaveCount(0);

    // Re-selecting 2x3 in the layout picker restores all 6 slots cleanly
    await selectGridLayout(page, '2x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);
    const slot2RestoredH = await page
      .locator('.grid-stack-item[data-slot-index="2"]')
      .evaluate((el) => (el.gridstackNode && el.gridstackNode.h) || 1);
    expect(slot2RestoredH).toBe(1);

    // Verify upward resize from a bottom-row card's top edge (.ui-resizable-n)
    await page.waitForTimeout(250);
    const slot4Item = page.locator('.grid-stack-item[data-slot-index="4"]');
    await slot4Item.hover();
    const northHandle4 = slot4Item.locator('.ui-resizable-n');
    await expect(northHandle4).toBeVisible();
    const slot1Box = await page.locator('.grid-stack-item[data-slot-index="1"]').boundingBox();
    const nhBox = await northHandle4.boundingBox();
    await page.mouse.move(nhBox.x + nhBox.width / 2, nhBox.y + nhBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      nhBox.x + nhBox.width / 2,
      slot1Box.y + 8,
      { steps: 12 }
    );
    await page.waitForTimeout(200);
    await page.mouse.up();

    // Slot 4 grew upward to row 0 (y=0, h=2) and pushed slot 1 below row 2
    await expect(slot4Item).toHaveAttribute('gs-y', '0');
    await expect(slot4Item).toHaveAttribute('gs-h', '2');
    const pushedSlot1 = page.locator('.grid-stack-item[data-slot-index="1"]');
    await expect(pushedSlot1).toHaveAttribute('gs-y', '2');
    await expect(pushedSlot1).toHaveClass(/is-grid-overflow/);

    // Close pushed slot 1 and restore full 2x3 cleanly
    await page.locator('#btn-close-1').click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(5);
    await selectGridLayout(page, '2x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);

    // Select 1x4 layout (1 row x 4 columns)
    await selectGridLayout(page, '1x4');
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '1x4');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    const coords1x4 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item')).map((el) => ({
        x: el.gridstackNode.x,
        y: el.gridstackNode.y
      }))
    );
    expect(coords1x4.every((p) => p.y === 0)).toBe(true);
    expect(Math.max(...coords1x4.map((p) => p.x))).toBe(3);

    // Select 4x1 layout (4 rows x 1 column)
    await selectGridLayout(page, '4x1');
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '4x1');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    const coords4x1 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item')).map((el) => ({
        x: el.gridstackNode.x,
        y: el.gridstackNode.y
      }))
    );
    expect(coords4x1.every((p) => p.x === 0)).toBe(true);
    expect(Math.max(...coords4x1.map((p) => p.y))).toBe(3);

    // Switch layout preset to 3x3 (9 visible slots) and verify expanded sidebar badge
    await selectGridLayout(page, '3x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(9);
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#layout-picker-badge')).toHaveText('3 × 3');
    await page.locator('#btn-sidebar-toggle').click();

    const storedPreset = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_PRESET_KEY
    );
    expect(storedPreset).toBe('3x3');

    // Switch back to 2x2
    await selectGridLayout(page, '2x2');
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);

    // Toggle slot 0 mute button
    await expect(page.locator('#slot-card-0')).toHaveClass(/mantine-Paper-root/);
    const muteBtn0 = page.locator('#btn-mute-0');
    await expect(muteBtn0).toHaveClass(/mantine-ActionIcon-root/);
    await expect(muteBtn0).toHaveClass(/is-muted/);
    await muteBtn0.click();
    await expect(muteBtn0).not.toHaveClass(/is-muted/);
    await expect(muteBtn0).toHaveAttribute('aria-pressed', 'true');

    const mutedArray = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || '[]'),
      STORAGE_MUTED_SLOTS_KEY
    );
    expect(mutedArray[0]).toBe(false);

    // Clear adjacent slot 2 (row 2, col 1)
    await page.locator('#handle-input-2').fill('');
    await page.locator('#handle-input-2').dispatchEvent('input');

    // Verify legacy expand/size menu button (⤢) and drag indicator (⋮⋮) are removed
    // and the slot header uses the borderless TradingView inline layout
    await expect(page.locator('#btn-expand-0')).toHaveCount(0);
    await expect(page.locator('#size-menu-0')).toHaveCount(0);
    await expect(page.locator('#slot-card-0 .slot-drag-indicator')).toHaveCount(0);

    const headerStyle = await page.locator('#slot-card-0 .slot-header').evaluate((el) => {
      const cs = getComputedStyle(el);
      const beforeCs = getComputedStyle(el, '::before');
      const afterCs = getComputedStyle(el, '::after');
      return {
        borderBottomStyle: cs.borderBottomStyle,
        justifyContent: cs.justifyContent,
        beforeBackdropFilter: beforeCs.backdropFilter || beforeCs.webkitBackdropFilter || '',
        afterBgImage: afterCs.backgroundImage || ''
      };
    });
    expect(headerStyle.borderBottomStyle).toBe('none');
    expect(headerStyle.justifyContent).toBe('flex-start');
    expect(headerStyle.beforeBackdropFilter).toContain('blur');
    expect(headerStyle.afterBgImage).toContain('linear-gradient');
    expect(headerStyle.afterBgImage).toContain('78%');
  });

  test('3. Theme switching, Settings modal & Windows/macOS global Escape handling', async () => {
    const initialThemeState = await page.evaluate(() => ({
      dataTheme: document.documentElement.getAttribute('data-theme'),
      mantineScheme: document.documentElement.getAttribute('data-mantine-color-scheme')
    }));
    expect(initialThemeState.dataTheme).toBe('light');
    expect(initialThemeState.mantineScheme).toBe('light');

    await page.locator('#btn-theme-toggle').click();
    const toggledTheme = await page.evaluate(() => ({
      dataTheme: document.documentElement.getAttribute('data-theme'),
      mantineScheme: document.documentElement.getAttribute('data-mantine-color-scheme')
    }));
    expect(toggledTheme.dataTheme).toBe('dark');
    expect(toggledTheme.mantineScheme).toBe('dark');

    // Open Settings Modal
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await expect(settingsOverlay).toHaveClass(/is-closed/);
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);
    await expect(settingsOverlay.locator('.settings-modal-dialog')).toHaveClass(/mantine-Paper-root/);

    // Press Escape to verify main process before-input-event -> global-escape closes modal
    await page.keyboard.press('Escape');
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    // Reopen Settings Modal, modify settings (auto-saved immediately), and close
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    await expect(page.locator('#setting-twitter-interval')).toHaveClass(/mantine-NativeSelect-input/);
    await page.selectOption('#setting-twitter-interval', '15');
    const bluePresetChip = page.locator('#setting-header-presets .header-preset-chip[data-bg="#2563eb"]');
    await expect(bluePresetChip).toHaveClass(/mantine-ColorSwatch-root/);
    await bluePresetChip.click();

    const chatBgPresetChip = page.locator('#setting-chat-bg-presets .chat-bg-preset-chip[data-bg="#eef2f6"]');
    await expect(chatBgPresetChip).toHaveClass(/mantine-ColorSwatch-root/);
    await chatBgPresetChip.click();

    const bubbleBgPresetChip = page.locator('#setting-bubble-bg-presets .bubble-bg-preset-chip[data-bg="#f1f4f9"]');
    await expect(bubbleBgPresetChip).toHaveClass(/mantine-ColorSwatch-root/);
    await bubbleBgPresetChip.click();

    await page.locator('#btn-settings-close').click();
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    const savedSettings = await page.evaluate(
      ({ intervalKey, headerBgKey, chatBgKey, bubbleBgKey }) => ({
        twitterInterval: localStorage.getItem(intervalKey),
        headerBg: localStorage.getItem(headerBgKey),
        chatBg: localStorage.getItem(chatBgKey),
        bubbleBg: localStorage.getItem(bubbleBgKey),
        cssHeaderBg: document.documentElement.style.getPropertyValue('--slot-header-bg'),
        cssChatBg: document.documentElement.style.getPropertyValue('--bg-card'),
        cssBubbleBg: document.documentElement.style.getPropertyValue('--bg-bubble')
      }),
      {
        intervalKey: STORAGE_TWITTER_INTERVAL_KEY,
        headerBgKey: STORAGE_HEADER_BG_COLOR_KEY,
        chatBgKey: STORAGE_CHAT_BG_COLOR_KEY,
        bubbleBgKey: STORAGE_BUBBLE_BG_COLOR_KEY
      }
    );

    expect(savedSettings.twitterInterval).toBe('15');
    expect(savedSettings.headerBg).toBe('#2563eb');
    expect(savedSettings.chatBg).toBe('#eef2f6');
    expect(savedSettings.bubbleBg).toBe('#f1f4f9');
    expect(savedSettings.cssHeaderBg).toBe('#2563eb');
    expect(savedSettings.cssChatBg).toBe('#eef2f6');
    expect(savedSettings.cssBubbleBg).toBe('#f1f4f9');
  });

  test('4. Cached feed rendering, Ticker highlighting & Mark All Read', async () => {
    const nowIso = new Date().toISOString();
    await page.evaluate(
      ({ timestamp, handlesKey, cacheKey }) => {
        const handles = ['elonmusk', 'OpenAI', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'elonmusk',
            source: 'twitter',
            displayName: 'Elon Musk',
            userHandle: '@elonmusk',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '1900000000000000001',
                text: 'Watching $NVDA and AAPL earnings closely today!',
                time: timestamp,
                url: 'https://x.com/elonmusk/status/1900000000000000001',
                isPinned: false,
                isRetweet: false,
                isUnread: true,
                images: []
              }
            ]
          }
        };
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        saveAllSlotCache(cache);
      },
      {
        timestamp: nowIso,
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('#author-name-0')).toHaveText('Elon Musk');
    await expect(page.locator('#author-handle-0')).toHaveText('@elonmusk');
    await expect(page.locator('#slot-unread-badge-0')).toBeVisible();
    await expect(page.locator('#slot-unread-badge-0')).toHaveClass(/mantine-Badge-root/);
    await expect(page.locator('#slot-unread-badge-0')).toContainText('1');

    await page.evaluate(async () => {
      if (navigator.setAppBadge) {
        await navigator.setAppBadge(99);
      }
    });

    const unreadAppBadge = await page.evaluate(() =>
      require('electron').ipcRenderer.invoke('get-app-badge-count')
    );
    expect(unreadAppBadge).toBe(1);

    // Toggle App Icon Badge setting off and verify OS app badge clears while slot unread badge remains
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);
    await expect(page.locator('#setting-app-badge')).toHaveValue('true');
    await page.selectOption('#setting-app-badge', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => require('electron').ipcRenderer.invoke('get-app-badge-count'))
      )
      .toBe(0);
    await expect(page.locator('#slot-unread-badge-0')).toBeVisible();

    // Toggle App Icon Badge setting back on and verify OS app badge restores to 1
    await page.selectOption('#setting-app-badge', 'true');
    await expect
      .poll(() =>
        page.evaluate(() => require('electron').ipcRenderer.invoke('get-app-badge-count'))
      )
      .toBe(1);
    await page.locator('#btn-settings-close').click();
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    // Verify close button (×) is pinned tightly to the far right edge of the card header in author mode
    const closeBtnRightGap = await page.evaluate(() => {
      const header = document.querySelector('#slot-card-0 .slot-header');
      const closeBtn = document.getElementById('btn-close-0');
      if (!header || !closeBtn) return Infinity;
      return Math.abs(header.getBoundingClientRect().right - closeBtn.getBoundingClientRect().right);
    });
    expect(closeBtnRightGap).toBeLessThanOrEqual(6);

    // Verify post bubble and stock ticker highlights ($NVDA and AAPL)
    await expect(page.locator('#slot-content-0 .im-date-pill').first()).toHaveClass(
      /mantine-Badge-root/
    );
    const postBubble = page.locator('#slot-content-0 .im-bubble').first();
    await expect(postBubble).toBeVisible();
    await expect(postBubble).toHaveClass(/mantine-Paper-root/);
    await expect(postBubble).toHaveClass(/unread/);

    const tickerChips = postBubble.locator('.ticker-highlight');
    await expect(tickerChips).toHaveCount(2);
    await expect(tickerChips.nth(0)).toHaveText('$NVDA');
    await expect(tickerChips.nth(1)).toHaveText('AAPL');

    // Click Mark All Read and verify unread state clears
    await page.locator('#btn-mark-all-read').click();
    await expect(postBubble).not.toHaveClass(/unread/);
    await expect(page.locator('#slot-unread-badge-0')).toBeHidden();

    const clearedAppBadge = await page.evaluate(() =>
      require('electron').ipcRenderer.invoke('get-app-badge-count')
    );
    expect(clearedAppBadge).toBe(0);
  });

  test('5. Profile Export & Import end-to-end via Electron IPC', async () => {
    const exportFilePath = path.join(userDataDir, 'test-profile-export.json');

    // Stub dialog.showSaveDialog and dialog.showOpenDialog in the main process
    await electronApp.evaluate(({ dialog }, targetPath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: targetPath
      });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [targetPath]
      });
    }, exportFilePath);

    // Open Login/Profile dropdown menu and trigger Export Profile
    await page.locator('#btn-login-menu').click();
    await expect(page.locator('#login-dropdown-menu')).toBeVisible();
    await expect(page.locator('#login-dropdown-menu')).toHaveClass(/mantine-Paper-root/);
    await page.locator('#item-export-profile').click();

    // Wait for file to be written on disk and Mantine Notification toast to appear
    await expect.poll(() => fs.existsSync(exportFilePath)).toBe(true);
    await expect(page.locator('.mantine-Notification-root.mantine-toast-item').first()).toBeVisible();
    const exportedJson = JSON.parse(fs.readFileSync(exportFilePath, 'utf8'));
    expect(exportedJson.app).toBe('TheySay');
    expect(exportedJson.settings.gridPreset).toBe('2x2');
    expect(exportedJson.settings.headerBgColor).toBe('#2563eb');
    expect(exportedJson.settings.chatBgColor).toBe('#eef2f6');
    expect(exportedJson.settings.bubbleBgColor).toBe('#f1f4f9');
    expect(exportedJson.settings.appBadgeEnabled).toBe(true);
    expect(exportedJson.handles[0]).toBe('elonmusk');

    // Mutate current state to 3x2 layout and different theme before importing back
    await selectGridLayout(page, '3x2');
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '3x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);

    // Trigger Import Profile from Login dropdown menu
    await page.locator('#btn-login-menu').click();
    await page.locator('#item-import-profile').click();

    // Verify state is restored to exported 2x2 preset and cached posts remain intact
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    await expect(page.locator('#author-name-0')).toHaveText('Elon Musk');
  });

  test('6. Window state persistence (window-state.json) & screenshot capture', async () => {
    const stateFilePath = path.join(userDataDir, 'window-state.json');

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMaximized()) win.unmaximize();
        win.setSize(1240, 820);
      }
    });

    // Wait for debounced window-state.json save (150ms in main.js)
    await expect.poll(() => fs.existsSync(stateFilePath), { timeout: 5000 }).toBe(true);
    const savedState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    expect(savedState.width).toBeGreaterThanOrEqual(850);
    expect(savedState.height).toBeGreaterThanOrEqual(650);
    expect(typeof savedState.isMaximized).toBe('boolean');
    expect(typeof savedState.isFullScreen).toBe('boolean');

    // Save a visual snapshot artifact for CI inspection
    await page.screenshot({
      path: path.join(__dirname, '..', 'test-results', `dashboard-${process.platform}.png`)
    });
  });

  test('7. Localization: system language detection (English default vs Chinese variants) & live switching', async () => {
    // Unit-level verification of locale detection rules:
    // Default to English unless system language is Chinese (Simplified, Traditional, HK, TW, Hans, Hant, etc.)
    expect(isChineseLocale('en-US')).toBe(false);
    expect(isChineseLocale('en-GB')).toBe(false);
    expect(isChineseLocale('ja-JP')).toBe(false);
    expect(isChineseLocale('fr-FR')).toBe(false);
    expect(resolveLanguageCode('en-US')).toBe('en');
    expect(resolveLanguageCode('ja-JP')).toBe('en');

    expect(isChineseLocale('zh')).toBe(true);
    expect(isChineseLocale('zh-CN')).toBe(true);
    expect(isChineseLocale('zh-TW')).toBe(true);
    expect(isChineseLocale('zh-HK')).toBe(true);
    expect(isChineseLocale('zh-Hant-HK')).toBe(true);
    expect(isChineseLocale('zh-Hans-CN')).toBe(true);
    expect(resolveLanguageCode('zh-CN')).toBe('zh');
    expect(resolveLanguageCode('zh-TW')).toBe('zh');
    expect(resolveLanguageCode('zh-Hant')).toBe('zh');

    // Verify detectSystemLanguage() inside the renderer with simulated system locales
    const detectedLocales = await page.evaluate(() => {
      const { detectSystemLanguage } = require('./src/core/i18n');
      const prev = window.__THEYSAY_SYSTEM_LOCALE;
      const results = {};
      for (const loc of ['en-US', 'fr-FR', 'ja-JP', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hant']) {
        window.__THEYSAY_SYSTEM_LOCALE = loc;
        results[loc] = detectSystemLanguage();
      }
      if (prev === undefined) {
        delete window.__THEYSAY_SYSTEM_LOCALE;
      } else {
        window.__THEYSAY_SYSTEM_LOCALE = prev;
      }
      return results;
    });
    expect(detectedLocales['en-US']).toBe('en');
    expect(detectedLocales['fr-FR']).toBe('en');
    expect(detectedLocales['ja-JP']).toBe('en');
    expect(detectedLocales['zh-CN']).toBe('zh');
    expect(detectedLocales['zh-TW']).toBe('zh');
    expect(detectedLocales['zh-HK']).toBe('zh');
    expect(detectedLocales['zh-Hant']).toBe('zh');

    // Open Settings and switch to English ('en')
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-modal-overlay')).not.toHaveClass(/is-closed/);
    await page.selectOption('#setting-language', 'en');

    // Live preview updates UI to English immediately
    await expect(page.locator('#btn-mark-all-read [data-i18n="nav.markAllRead"]')).toHaveText(
      'Mark All Read'
    );
    await expect(page.locator('#settings-dialog-title')).toHaveText('Preferences');
    await expect(page.locator('#handle-input-1')).toHaveAttribute(
      'placeholder',
      'Twitter / Threads handle or Discord URL'
    );

    // Ensure no settings card title or subtitle is clipped/overflowing in English
    const overflowCount = await page.evaluate(() => {
      const els = document.querySelectorAll(
        '#settings-modal-overlay .settings-row-title, #settings-modal-overlay .settings-row-subtitle'
      );
      let clipped = 0;
      els.forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) {
          clipped++;
        }
      });
      return clipped;
    });
    expect(overflowCount).toBe(0);

    // Verify English setting auto-saved immediately
    await page.locator('#btn-settings-close').click();
    await expect(page.locator('#settings-modal-overlay')).toHaveClass(/is-closed/);
    const savedLangEn = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_LANGUAGE_KEY
    );
    expect(savedLangEn).toBe('en');
    await expect(page).toHaveTitle('TheySay - Follow What People Say');
    await expect(page.locator('#layout-select [data-i18n="nav.gridLayout"]')).toHaveText('Layout');
    await page.locator('#layout-select').click();
    await expect(page.locator('#layout-picker-popover')).toBeVisible();
    await expect(page.locator('#layout-picker-popover .layout-picker-title')).toHaveText('Grid Layout');
    await expect(page.locator('#layout-picker-dimension .layout-picker-dim-detail')).toHaveText('2 rows · 2 cols');
    await page.keyboard.press('Escape');
    await expect(page.locator('#layout-picker-popover')).toBeHidden();

    // Switch to Chinese ('zh') and verify UI updates to Chinese & persists to disk immediately
    const prefFilePath = path.join(userDataDir, 'preferences.json');
    await page.locator('#btn-settings').click();
    await page.selectOption('#setting-language', 'zh');
    await expect(page.locator('#btn-mark-all-read [data-i18n="nav.markAllRead"]')).toHaveText(
      '全部已读'
    );
    await expect(page.locator('#settings-dialog-title')).toHaveText('偏好设置');
    await expect(page.locator('#handle-input-1')).toHaveAttribute(
      'placeholder',
      'Twitter / Threads 用户名 或 Discord 频道链接'
    );
    await expect.poll(() => {
      if (!fs.existsSync(prefFilePath)) return null;
      return JSON.parse(fs.readFileSync(prefFilePath, 'utf8')).language;
    }, { timeout: 3000 }).toBe('zh');

    await page.locator('#btn-settings-close').click();
    await expect(page.locator('#layout-select [data-i18n="nav.gridLayout"]')).toHaveText('网格布局');
    await page.locator('#layout-select').click();
    await expect(page.locator('#layout-picker-popover')).toBeVisible();
    await expect(page.locator('#layout-picker-popover .layout-picker-title')).toHaveText('网格布局');
    await expect(page.locator('#layout-picker-dimension .layout-picker-dim-detail')).toHaveText('2 行 · 2 列');
    await page.keyboard.press('Escape');
    await expect(page.locator('#layout-picker-popover')).toBeHidden();
    const savedLangZh = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_LANGUAGE_KEY
    );
    expect(savedLangZh).toBe('zh');
    await expect(page).toHaveTitle('TheySay - 动态网格看板');
  });

  test('8. Dragging a slot keeps every feed\'s scroll position', async () => {
    // Seed four slots with long feeds so each content container is scrollable
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const handles = ['elonmusk', 'OpenAI', 'nasa', 'github'];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const feed = (handle, name) => ({
          handle,
          source: 'twitter',
          displayName: name,
          userHandle: `@${handle}`,
          avatarUrl: '',
          lastFetchedAt: Date.now(),
          posts: Array.from({ length: 40 }, (_, i) => {
            const id = `19000000000000${String(i).padStart(5, '0')}`;
            return {
              id,
              text: `${name} message #${i} — lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
              time: new Date(Date.now() - (40 - i) * 3600e3).toISOString(),
              url: `https://x.com/${handle}/status/${id}`,
              isPinned: false,
              isRetweet: false,
              isUnread: false,
              images: []
            };
          })
        });
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        saveAllSlotCache({
          0: feed('elonmusk', 'Elon'),
          1: feed('OpenAI', 'OpenAI'),
          2: feed('nasa', 'NASA'),
          3: feed('github', 'GitHub')
        });
      },
      { handlesKey: STORAGE_HANDLES_KEY, cacheKey: STORAGE_CACHE_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#slot-content-3 .im-bubble').first()).toBeVisible();

    // Slot 0 stays at the bottom (default); scroll slots 1-3 to mid-feed so that both a
    // "reset to top" and a "snap to bottom" regression would be detectable.
    const before = await page.evaluate(() => [0, 1, 2, 3].map((i) => {
      const c = document.getElementById(`slot-content-${i}`);
      if (i > 0) c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) / 2);
      return c.scrollTop;
    }));
    expect(before[0]).toBeGreaterThan(0);
    expect(before[1]).toBeGreaterThan(0);

    // Drag slot 0 by its header onto slot 1's cell (real mouse events through GridStack DD)
    const handle0 = await page.locator('.grid-stack-item[gs-id="slot-0"] .slot-drag-handle').boundingBox();
    const target = await page.locator('.grid-stack-item[gs-id="slot-1"]').boundingBox();
    const startX = handle0.x + handle0.width / 2;
    const startY = handle0.y + handle0.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 15, startY + 5, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + 20, { steps: 12 });
    await page.waitForTimeout(400);
    await page.mouse.up();

    // Layout swapped...
    await expect(page.locator('.grid-stack-item[gs-id="slot-0"]')).toHaveAttribute('gs-x', '1');
    await expect(page.locator('.grid-stack-item[gs-id="slot-1"]')).toHaveAttribute('gs-x', '0');
    await page.waitForTimeout(500);

    // ...but no feed moved.
    const after = await page.evaluate(() =>
      [0, 1, 2, 3].map((i) => document.getElementById(`slot-content-${i}`).scrollTop)
    );
    expect(after).toEqual(before);
  });

  test('9. Section drag-and-drop & resize layout persistence across app close and reopen', async () => {
    const readGridPositions = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item'))
          .map((el) => ({
            slotIndex: parseInt(el.getAttribute('data-slot-index'), 10),
            x: el.gridstackNode.x,
            y: el.gridstackNode.y,
            w: el.gridstackNode.w,
            h: el.gridstackNode.h
          }))
          .sort((a, b) => a.slotIndex - b.slotIndex)
      );

    // 1. Switch to 3x3 preset and drag slot-0 (top-left, y=0) down to bottom-left (y=2),
    // swapping with slot-6 (originally y=2) — previously reverted on restart due to out-of-order packing
    await selectGridLayout(page, '3x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(9);
    await page.waitForTimeout(350);

    const handle0 = page.locator('.grid-stack-item[data-slot-index="0"] .slot-drag-handle');
    const slot6 = page.locator('.grid-stack-item[data-slot-index="6"]');
    const box0 = await handle0.boundingBox();
    const box6 = await slot6.boundingBox();

    const dragStartX0 = box0.x + box0.width - 56;
    const dragStartY0 = box0.y + box0.height / 2;
    await page.mouse.move(dragStartX0, dragStartY0);
    await page.mouse.down();
    await page.mouse.move(dragStartX0, dragStartY0 + 12, { steps: 3 });
    await page.mouse.move(box6.x + box6.width / 2, box6.y + box6.height / 2, { steps: 15 });
    await page.waitForTimeout(300);
    await page.mouse.up();

    const posAfter3x3Drag = await readGridPositions();
    // Verify slot-0 moved away from (0, 0) to row 2
    expect(posAfter3x3Drag.find((p) => p.slotIndex === 0).y).toBe(2);

    // Reload and verify 3x3 dragged layout is preserved
    await page.reload({ waitUntil: 'domcontentloaded' });
    const posAfter3x3Reload = await readGridPositions();
    expect(posAfter3x3Reload).toEqual(posAfter3x3Drag);

    // 2. Switch to 2x2, perform a diagonal drag (slot-0 onto slot-3) AND close + reopen the Electron app
    await selectGridLayout(page, '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    await page.waitForTimeout(350);

    const h0 = page.locator('.grid-stack-item[data-slot-index="0"] .slot-drag-handle');
    const s3 = page.locator('.grid-stack-item[data-slot-index="3"]');
    const b0 = await h0.boundingBox();
    const b3 = await s3.boundingBox();

    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 12, b0.y + b0.height / 2 + 12, { steps: 3 });
    await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2, { steps: 15 });
    await page.waitForTimeout(300);
    await page.mouse.up();

    const posBeforeRestart = await readGridPositions();
    expect(posBeforeRestart.find((p) => p.slotIndex === 0)).toMatchObject({ x: 1, y: 1 });

    // Close the Electron app completely and relaunch with the same userDataDir
    await electronApp.close();
    electronApp = await electron.launch({
      executablePath: require('electron'),
      args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        path.join(__dirname, '..', 'main.js')
      ],
      env: {
        ...process.env,
        THEYSAY_USER_DATA_DIR: userDataDir,
        THEYSAY_BACKGROUND_TEST: '1'
      }
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#grid-stack-container')).toBeVisible();

    const posAfterRestart = await readGridPositions();
    expect(posAfterRestart).toEqual(posBeforeRestart);

    // 3. Multi-step Cmd+Z / Ctrl+Z layout Undo & Cmd+Shift+Z / Ctrl+Shift+Z Redo
    const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

    // Step 1: Switch layout preset to 2x3 (6 slots)
    await selectGridLayout(page, '2x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);
    await page.waitForTimeout(250);
    const posStep1 = await readGridPositions();

    // Step 2: Resize slot 2 down to h=2 (pushes slot 5 into overflow at y=2)
    const slot2Item = page.locator('.grid-stack-item[data-slot-index="2"]');
    await slot2Item.hover();
    const rh2 = slot2Item.locator('.ui-resizable-s');
    await expect(rh2).toBeVisible();
    const s5Box = await page.locator('.grid-stack-item[data-slot-index="5"]').boundingBox();
    const rh2Box = await rh2.boundingBox();
    await page.mouse.move(rh2Box.x + rh2Box.width / 2, rh2Box.y + rh2Box.height / 2);
    await page.mouse.down();
    await page.mouse.move(rh2Box.x + rh2Box.width / 2, s5Box.y + s5Box.height - 8, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect(slot2Item).toHaveAttribute('gs-h', '2');
    const posStep2 = await readGridPositions();

    // Step 3: Close pushed-down slot 5 (5 slots)
    await page.locator('#btn-close-5').click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(5);
    await page.waitForTimeout(300);
    const posStep3 = await readGridPositions();

    // Step 4: Drag slot 0 by its header center onto slot 1 (horizontal swap)
    const h0Drag = page.locator('.grid-stack-item[data-slot-index="0"] .slot-drag-handle');
    const s1Target = page.locator('.grid-stack-item[data-slot-index="1"]');
    const hb0 = await h0Drag.boundingBox();
    const sb1 = await s1Target.boundingBox();
    const step4StartX = hb0.x + hb0.width / 2;
    const step4StartY = hb0.y + hb0.height / 2;
    await page.mouse.move(step4StartX, step4StartY);
    await page.mouse.down();
    await page.mouse.move(step4StartX + 15, step4StartY + 5, { steps: 3 });
    await page.mouse.move(sb1.x + sb1.width / 2, sb1.y + 20, { steps: 12 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    const posStep4 = await readGridPositions();
    expect(posStep4).not.toEqual(posStep3);

    // Guard 1: Cmd/Ctrl+Z while focused in an <input> must NOT undo grid layout
    const input4 = page.locator('#handle-input-4');
    await input4.click();
    await page.keyboard.press(undoShortcut);
    await page.waitForTimeout(150);
    expect(await readGridPositions()).toEqual(posStep4);
    await input4.blur();

    // Guard 2: Cmd/Ctrl+Z while Settings modal is open must NOT undo grid layout
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-modal-overlay')).not.toHaveClass(/is-closed/);
    await page.keyboard.press(undoShortcut);
    await page.waitForTimeout(150);
    expect(await readGridPositions()).toEqual(posStep4);
    await page.locator('#btn-settings-close').click();
    await expect(page.locator('#settings-modal-overlay')).toHaveClass(/is-closed/);

    // Multi-step Undo #1 -> reverts Step 4 drag (back to posStep3, 5 cards) without showing any toast
    await page.keyboard.press(undoShortcut);
    await expect.poll(() => readGridPositions()).toEqual(posStep3);
    await expect(page.locator('.mantine-Notification-root.mantine-toast-item')).toHaveCount(0);

    // Multi-step Undo #2 -> reverts Step 3 card close (slot 5 returns, 6 cards, slot 2 still h=2)
    await page.keyboard.press(undoShortcut);
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);
    await expect.poll(() => readGridPositions()).toEqual(posStep2);

    // Multi-step Undo #3 -> reverts Step 2 resize (slot 2 back to h=1)
    await page.keyboard.press(undoShortcut);
    await expect.poll(() => readGridPositions()).toEqual(posStep1);

    // Multi-step Undo #4 -> reverts Step 1 preset switch (back to 2x2 and posAfterRestart)
    await page.keyboard.press(undoShortcut);
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    await expect.poll(() => readGridPositions()).toEqual(posAfterRestart);

    // Multi-step Redo #1 & #2 -> replays Step 1 (2x3) and Step 2 (slot 2 h=2)
    await page.keyboard.press(redoShortcut);
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x3');
    await expect.poll(() => readGridPositions()).toEqual(posStep1);

    await page.keyboard.press(redoShortcut);
    await expect(slot2Item).toHaveAttribute('gs-h', '2');
    await expect.poll(() => readGridPositions()).toEqual(posStep2);

    // Undo twice back to 2x2 cleanly for subsequent tests
    await page.keyboard.press(undoShortcut);
    await page.keyboard.press(undoShortcut);
    await expect(page.locator('#layout-select')).toHaveAttribute('data-value', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
  });

  test('10. Threads data source detection, cached feed rendering, Threads popup modal & settings', async () => {
    // 1. Verify source detection & canonical target key resolution for Threads URLs/shorthands
    const sourceParsing = await page.evaluate(() => {
      const {
        detectSourceType,
        parseThreadsInput,
        buildThreadsProfileUrl,
        getCanonicalTargetKey
      } = require('./src/core/source');
      return {
        comUrl: detectSourceType('https://www.threads.com/@zuck'),
        netUrl: detectSourceType('https://www.threads.net/@mosseri/post/DVZ8a9bXk12'),
        shorthand: detectSourceType('threads:@zuck'),
        slashForm: detectSourceType('threads/zuck'),
        parsedHandle: parseThreadsInput('https://www.threads.com/@Zuck/post/DVZ8a9bXk12')?.handle,
        profileUrl: buildThreadsProfileUrl('threads:@zuck'),
        canonicalCom: getCanonicalTargetKey('https://www.threads.com/@Zuck'),
        canonicalShort: getCanonicalTargetKey('threads:zuck')
      };
    });

    expect(sourceParsing.comUrl).toBe('threads');
    expect(sourceParsing.netUrl).toBe('threads');
    expect(sourceParsing.shorthand).toBe('threads');
    expect(sourceParsing.slashForm).toBe('threads');
    expect(sourceParsing.parsedHandle).toBe('zuck');
    expect(sourceParsing.profileUrl).toBe('https://www.threads.com/@zuck');
    expect(sourceParsing.canonicalCom).toBe('threads:zuck');
    expect(sourceParsing.canonicalShort).toBe('threads:zuck');

    // 2. Seed slot 0 with a Threads account and cached Threads posts
    const nowIso = new Date().toISOString();
    await page.evaluate(
      ({ timestamp, handlesKey, cacheKey }) => {
        const handles = ['threads:@zuck', 'OpenAI', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'threads:@zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'DVZ8a9bXk12',
                text: 'Shipping Llama 4 and tracking $META and NVDA compute clusters!',
                time: timestamp,
                url: 'https://www.threads.com/@zuck/post/DVZ8a9bXk12',
                author: 'zuck',
                isPinned: true,
                isRetweet: false,
                isQuote: true,
                quoteAuthor: '@mosseri',
                quoteText: 'Threads web updates rolling out today.',
                isUnread: true,
                images: []
              }
            ]
          },
          1: {
            handle: 'OpenAI',
            source: 'twitter',
            displayName: 'OpenAI',
            userHandle: '@OpenAI',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '1900000000000099999',
                text: 'Cached OpenAI status update.',
                time: timestamp,
                url: 'https://x.com/OpenAI/status/1900000000000099999',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: []
              }
            ]
          }
        };
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        saveAllSlotCache(cache);
      },
      {
        timestamp: nowIso,
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('#author-name-0')).toHaveText('Mark Zuckerberg');
    await expect(page.locator('#author-handle-0')).toHaveText('threads:@zuck');
    await expect(page.locator('#slot-card-0')).toHaveClass(/is-threads/);

    const threadsBubble = page.locator('#slot-content-0 .im-bubble.threads').first();
    await expect(threadsBubble).toBeVisible();
    await expect(threadsBubble.locator('.ticker-highlight')).toHaveCount(2);
    await expect(threadsBubble.locator('.ticker-highlight').nth(0)).toHaveText('$META');
    await expect(threadsBubble.locator('.ticker-highlight').nth(1)).toHaveText('NVDA');
    await expect(threadsBubble.locator('.tweet-tag.pinned')).toBeVisible();
    await expect(threadsBubble.locator('.tweet-tag.pinned')).toHaveClass(/mantine-Badge-root/);
    await expect(threadsBubble.locator('.tweet-tag.quote')).toBeVisible();
    await expect(threadsBubble.locator('.tweet-tag.quote')).toHaveClass(/mantine-Badge-root/);

    // 3. Click the Threads bubble to open the zero-latency local Threads popup modal
    const closedPopupWidth = await page
      .locator('#tweet-popup-embed-container')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(closedPopupWidth).toBeGreaterThan(0);

    await threadsBubble.click();
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    await expect(popupOverlay.locator('.tweet-popup-dialog')).toHaveClass(/mantine-Paper-root/);
    const threadsPopupCard = popupOverlay.locator('.threads-popup-card');
    await expect(threadsPopupCard).toBeVisible();
    await expect(threadsPopupCard).toHaveClass(/mantine-Paper-root/);
    await expect(threadsPopupCard.locator('.discord-popup-name')).toHaveText('Mark Zuckerberg');
    await expect(threadsPopupCard.locator('.tweet-tag.threads')).toHaveText('Threads');
    await expect(threadsPopupCard.locator('.tweet-tag.threads')).toHaveClass(/mantine-Badge-root/);
    await expect(threadsPopupCard.locator('.threads-popup-quote .tweet-tag.quote')).toHaveClass(
      /mantine-Badge-root/
    );
    await expect(threadsPopupCard.locator('.threads-popup-quote-author')).toHaveText('@mosseri');
    await expect(threadsPopupCard.locator('.threads-popup-quote-text')).toContainText(
      'Threads web updates rolling out today.'
    );
    await expect(threadsPopupCard.locator('.discord-popup-open-btn')).toBeVisible();
    await expect(threadsPopupCard.locator('.discord-popup-open-btn')).toHaveClass(
      /mantine-UnstyledButton-root/
    );

    // Press Escape to close the Threads popup modal
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    // 4. Verify Threads login item in Accounts menu & Threads refresh interval in Settings
    await page.locator('#btn-login-menu').click();
    await expect(page.locator('#item-login-threads')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('#btn-settings').click();
    await expect(page.locator('#setting-threads-interval')).toBeVisible();
    await page.selectOption('#setting-threads-interval', '15');
    await page.locator('#btn-settings-close').click();

    const savedThreadsInterval = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_THREADS_INTERVAL_KEY
    );
    expect(savedThreadsInterval).toBe('15');

    // 5. Verify dual-platform handle search dropdown when a handle exists on both Twitter & Threads
    await page.evaluate(() => {
      window.__THEYSAY_MOCK_PLATFORM_PROBE = async (handle) => {
        if (handle.toLowerCase() === 'mosseri') {
          return {
            twitter: {
              exists: true,
              handle: 'mosseri',
              displayName: 'Adam',
              avatarUrl: ''
            },
            threads: {
              exists: true,
              handle: 'mosseri',
              displayName: 'Adam Mosseri',
              avatarUrl: ''
            }
          };
        }
        return { twitter: { exists: false }, threads: { exists: false } };
      };
    });

    await page.locator('#slot-author-header-1').click();
    const input1 = page.locator('#handle-input-1');
    await expect(input1).toBeVisible();
    await input1.fill('mosseri');
    await input1.press('Enter');

    const dropdown1 = page.locator('#slot-source-dropdown-1');
    await expect(dropdown1).toBeVisible();
    await expect(dropdown1).toHaveClass(/mantine-Paper-root/);
    await expect(dropdown1.locator('.source-dropdown-item[data-source="twitter"]')).toBeVisible();
    await expect(dropdown1.locator('.source-dropdown-item[data-source="twitter"]')).toHaveClass(
      /mantine-UnstyledButton-root/
    );
    await expect(dropdown1.locator('.source-dropdown-item[data-source="threads"]')).toBeVisible();
    await expect(dropdown1.locator('.source-dropdown-item[data-source="threads"] .source-dropdown-name')).toHaveText(
      'Adam Mosseri'
    );
    await expect(dropdown1.locator('.source-dropdown-badge.threads')).toHaveClass(
      /mantine-Badge-root/
    );

    await dropdown1.locator('.source-dropdown-item[data-source="threads"]').click();
    await expect(dropdown1).toBeHidden();
    await expect(input1).toHaveValue('threads.com/@mosseri');
  });

  test('11. Image post bubbles: full-width layout, 50% right image split, height matching & cached post backfill', async () => {
    const baseMs = Date.now();
    const t0 = new Date(baseMs - 3 * 60000).toISOString();
    const t1 = new Date(baseMs - 2 * 60000).toISOString();
    const t2 = new Date(baseMs - 1 * 60000).toISOString();
    const t3 = new Date(baseMs).toISOString();
    const dummySvgDataUri =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#2563eb"/></svg>'
      );

    await page.evaluate(
      ({ times, imgUri, handlesKey, cacheKey }) => {
        localStorage.setItem('theysay_onboarding_completed', '1');
        localStorage.setItem(
          'theysay_mock_tweet_data',
          JSON.stringify({
            '998877665544332211': {
              id: '998877665544332211',
              text: 'Cached legacy tweet that originally had no images field saved.',
              images: [imgUri]
            },
            '2119789073883656473': {
              id: '2119789073883656473',
              text: '',
              images: [],
              isMemberOnly: true
            }
          })
        );

        const handles = ['threads:@zuck', '@VitalikButerin', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'threads:@zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'post_text_only_1',
                text: 'Short one-line update.',
                time: times[0],
                url: 'https://www.threads.com/@zuck/post/post_text_only_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: []
              },
              {
                id: 'post_with_img_1',
                text: 'Short one-line update.',
                time: times[1],
                url: 'https://www.threads.com/@zuck/post/post_with_img_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: [imgUri]
              },
              {
                id: 'post_z_media_only_1',
                text: '(该推文为纯媒体/卡片内容，无文本)',
                time: times[2],
                url: 'https://www.threads.com/@zuck/post/post_z_media_only_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: [imgUri]
              },
              {
                id: 'post_zz_blank_lines_1',
                text: 'Remember this...\n\nCheap can get cheaper.\n\nOverweight ETF companies have not sold off yet.\n\n$SPY\n$QQQ $IWM',
                time: times[3],
                url: 'https://www.threads.com/@zuck/post/post_zz_blank_lines_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: [imgUri]
              }
            ]
          },
          1: {
            handle: '@VitalikButerin',
            source: 'twitter',
            displayName: 'vitalik.eth',
            userHandle: '@VitalikButerin',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '998877665544332211',
                text: 'Long term\n$QQQ\n model continues to track extremely well.',
                time: times[2],
                url: 'https://x.com/VitalikButerin/status/998877665544332211',
                author: 'VitalikButerin',
                isPinned: false,
                isRetweet: false,
                isUnread: false
                // Intentionally omit `images` and `imagesBackfilled` to simulate old cached posts
              },
              {
                id: '2119789073883656473',
                text: '(该推文为纯媒体/卡片内容，无文本)',
                time: times[3],
                url: 'https://x.com/BeardoTrader/status/2119789073883656473',
                author: 'BeardoTrader',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: []
              }
            ]
          }
        };
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        saveAllSlotCache(cache);
      },
      {
        times: [t0, t1, t2, t3],
        imgUri: dummySvgDataUri,
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const bubbles = page.locator('#slot-content-0 .im-bubble');
    await expect(bubbles).toHaveCount(4);

    const textOnlyBubble = bubbles.nth(0);
    const mediaBubble = bubbles.nth(1);
    const pureImageBubble = bubbles.nth(2);
    const blankLinesBubble = bubbles.nth(3);

    await expect(textOnlyBubble).not.toHaveClass(/has-media/);
    await expect(mediaBubble).toHaveClass(/has-media/);
    await expect(mediaBubble).not.toHaveClass(/media-only/);
    await expect(mediaBubble.locator('.im-bubble-left')).toBeVisible();
    await expect(mediaBubble.locator('.im-media-grid .im-media-thumb .im-media-img')).toBeVisible();

    // Pure-image bubble displays only the image without "(该推文为纯媒体/卡片内容，无文本)"
    await expect(pureImageBubble).toHaveClass(/has-media/);
    await expect(pureImageBubble).toHaveClass(/media-only/);
    await expect(pureImageBubble.locator('.im-text-content')).toHaveCount(0);
    await expect(pureImageBubble.locator('.im-media-grid .im-media-thumb .im-media-img')).toBeVisible();

    // Blank lines are stripped in bubble display, last line expands past 100 chars when space is available,
    // and original blank lines are preserved in popup modal when clicked
    const bubbleDisplayText = await blankLinesBubble.locator('.im-text-content').textContent();
    expect(bubbleDisplayText).toBe(
      'Remember this...\nCheap can get cheaper.\nOverweight ETF companies have not sold off yet. $SPY $QQQ $IWM'
    );
    await blankLinesBubble.click();
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const popupText = await popupOverlay.locator('.threads-popup-card .discord-popup-text').textContent();
    expect(popupText).toBe(
      'Remember this...\n\nCheap can get cheaper.\n\nOverweight ETF companies have not sold off yet.\n\n$SPY\n$QQQ $IWM'
    );
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    const metrics = await page.evaluate(() => {
      const listEl = document.getElementById('slot-posts-list-0');
      const listStyle = getComputedStyle(listEl);
      const listInnerWidth =
        listEl.clientWidth -
        parseFloat(listStyle.paddingLeft || '0') -
        parseFloat(listStyle.paddingRight || '0');

      const [bText, bMedia] = Array.from(listEl.querySelectorAll('.im-bubble'));
      const bMediaStyle = getComputedStyle(bMedia);
      const mediaInnerWidth =
        bMedia.clientWidth -
        parseFloat(bMediaStyle.paddingLeft || '0') -
        parseFloat(bMediaStyle.paddingRight || '0');

      const leftCol = bMedia.querySelector('.im-bubble-left');
      const rightMedia = bMedia.querySelector('.im-media-grid');

      const bTextRect = bText.getBoundingClientRect();
      const bMediaRect = bMedia.getBoundingClientRect();
      const leftRect = leftCol.getBoundingClientRect();
      const rightRect = rightMedia.getBoundingClientRect();

      return {
        listInnerWidth,
        mediaInnerWidth,
        textBubbleWidth: bTextRect.width,
        mediaBubbleWidth: bMediaRect.width,
        textBubbleHeight: bTextRect.height,
        mediaBubbleHeight: bMediaRect.height,
        leftWidth: leftRect.width,
        rightWidth: rightRect.width,
        leftX: leftRect.left,
        leftRightEdge: leftRect.right,
        rightX: rightRect.left
      };
    });

    // 1. Media bubble fills 100% of the slot list inner width and is wider than normal text bubble
    expect(Math.abs(metrics.mediaBubbleWidth - metrics.listInnerWidth)).toBeLessThanOrEqual(1.5);
    expect(metrics.mediaBubbleWidth).toBeGreaterThan(metrics.textBubbleWidth);

    // 2. Left side is text, right side is image thumbnail occupying ~50% of the bubble inner width
    expect(metrics.rightX).toBeGreaterThanOrEqual(metrics.leftRightEdge);
    const rightWidthRatio = metrics.rightWidth / metrics.mediaInnerWidth;
    expect(rightWidthRatio).toBeGreaterThanOrEqual(0.45);
    expect(rightWidthRatio).toBeLessThanOrEqual(0.55);

    // 3. Thumbnail matches the original bubble height without inflating it vertically
    expect(Math.abs(metrics.mediaBubbleHeight - metrics.textBubbleHeight)).toBeLessThanOrEqual(1);

    // 4. Cached legacy Twitter post in Slot 1 automatically backfills its image and cleans inline $QQQ newlines
    const backfilledBubble = page.locator('#slot-content-1 .im-bubble').first();
    await expect(backfilledBubble).toHaveClass(/has-media/);
    await expect(backfilledBubble.locator('.im-media-grid .im-media-thumb .im-media-img')).toBeVisible();
    const cleanedText = await backfilledBubble.locator('.im-text-content').textContent();
    expect(cleanedText).toBe('Long term $QQQ model continues to track extremely well.');

    // 4b. Subscriber-only post without preview text shows member badge and subscriber notice instead of media-only fallback
    const memberBubble = page.locator('#slot-content-1 .im-bubble').nth(1);
    await expect(memberBubble).toHaveClass(/is-member-only/);
    await expect(memberBubble.locator('.tweet-tag.member')).toBeVisible();
    await expect(memberBubble.locator('.im-text-content')).toHaveText(
      /此推文为创作者会员 \/ 订阅专享内容|This post is exclusive to subscribers/
    );
    await memberBubble.click();
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const activeMemberCard = popupOverlay.locator('.tweet-embed-slot.is-active .tweet-popup-fallback');
    await expect(activeMemberCard.locator('.tweet-tag.member')).toBeVisible();
    await expect(activeMemberCard.locator('.tweet-popup-fallback-text')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    // 5. Verify Twitter fallback popup card renders via Mantine Paper, Badge, and UnstyledButton
    await page.evaluate(() => {
      const { openPostPopup } = require('./src/ui/popup');
      openPostPopup({
        id: '998877665544332211',
        source: 'twitter',
        displayName: 'vitalik.eth',
        userHandle: '@VitalikButerin',
        text: 'Subscriber alpha on $ETH and $QQQ.',
        time: '12:00 PM',
        url: 'https://x.com/VitalikButerin/status/998877665544332211',
        isMemberOnly: true,
        hasQuote: true,
        quoteUrl: 'https://x.com/ethereum/status/112233'
      });
    });
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const fallbackCard = popupOverlay.locator('.tweet-embed-slot.is-active .tweet-popup-fallback');
    await expect(fallbackCard).toBeVisible();
    await expect(fallbackCard).toHaveClass(/mantine-Paper-root/);
    await expect(fallbackCard.locator('.tweet-tag.member')).toHaveClass(/mantine-Badge-root/);
    await expect(fallbackCard.locator('.tweet-tag.quote')).toHaveClass(/mantine-Badge-root/);
    await expect(fallbackCard.locator('.tweet-popup-fallback-btn')).toHaveClass(
      /mantine-UnstyledButton-root/
    );
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    // 5b. Verify Super Follow X Article popup renders full interleaved title, headings, text & images in-app
    await page.evaluate(
      ({ imgUri }) => {
        const { openPostPopup } = require('./src/ui/popup');
        openPostPopup({
          id: '2119789073883656474',
          source: 'twitter',
          displayName: 'Beardo',
          userHandle: '@BeardoTrader',
          text: 'THE WEEKLY OPEN\n\nMarket Overview\n\nBullish structure on $SPY and $QQQ heading into Monday.',
          time: '5:47 AM',
          url: 'https://x.com/BeardoTrader/status/2119789073883656474',
          isMemberOnly: true,
          isArticle: true,
          hasFullArticleBody: true,
          authDetailFetched: true,
          images: [imgUri],
          articleBlocks: [
            { type: 'image', url: imgUri },
            { type: 'title', text: 'THE WEEKLY OPEN' },
            { type: 'heading', text: 'Market Overview' },
            { type: 'text', text: 'Bullish structure on $SPY and $QQQ heading into Monday.' }
          ]
        });
      },
      { imgUri: dummySvgDataUri }
    );
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const articlePopupCard = popupOverlay.locator('.tweet-embed-slot.is-active .tweet-popup-fallback');
    await expect(articlePopupCard.locator('.tweet-popup-fallback-article')).toBeVisible();
    await expect(articlePopupCard.locator('.tweet-popup-fallback-article-title')).toHaveText(
      'THE WEEKLY OPEN'
    );
    await expect(articlePopupCard.locator('.tweet-popup-fallback-article-heading')).toHaveText(
      'Market Overview'
    );
    await expect(articlePopupCard.locator('.discord-popup-image')).toBeVisible();
    await expect(articlePopupCard.locator('.ticker-highlight')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);
  });

  test('12. Same-minute message merging: Discord merges with Chinese (。) & English (.) separators, while Twitter & Threads do not merge', async () => {
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const handles = [
          'https://discord.com/channels/111111/222222',
          'threads:@zuck',
          '@elonmusk',
          ''
        ];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        // 5 Chinese messages within the exact same minute (19:47) + 2 English messages in the next minute (19:48)
        const baseMinute = '2026-10-23T19:47:';
        const nextMinutePrefix = '2026-10-23T19:48:';

        const cache = {
          0: {
            handle: 'https://discord.com/channels/111111/222222',
            source: 'discord',
            sourceTitle: '#trading',
            sourceSubtitle: 'Alpha Guild',
            displayName: '#trading',
            userHandle: 'Alpha Guild',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '1001',
                text: 'add了 igv + panw put',
                datetime: `${baseMinute}02.000Z`,
                time: `${baseMinute}02.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1002',
                text: 'igv 110左右是上周五大阴线的起点',
                datetime: `${baseMinute}15.000Z`,
                time: `${baseMinute}15.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1003',
                text: '这里今天拉回去就被抛售是很bearish的',
                datetime: `${baseMinute}28.000Z`,
                time: `${baseMinute}28.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1004',
                text: '做空，盈亏比很高，拉过去我们就止损',
                datetime: `${baseMinute}41.000Z`,
                time: `${baseMinute}41.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1005',
                text: '很多 igv 的估值比半导体还高，而且当前软件板块整体面临非常明显的估值压缩压力，长线资金也在持续撤出高估值SaaS标的，反弹就是很好的加仓做空机会',
                datetime: `${baseMinute}55.000Z`,
                time: `${baseMinute}55.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1006',
                text: 'Added igv and panw puts at the open today as software names hit major overhead supply',
                datetime: `${nextMinutePrefix}10.000Z`,
                time: `${nextMinutePrefix}10.000Z`,
                displayName: 'TraderA',
                isUnread: false,
                images: []
              },
              {
                id: '1007',
                text: '110 on igv was the exact origin of last Friday breakdown candle and getting rejected right here is extremely bearish for the sector',
                datetime: `${nextMinutePrefix}35.000Z`,
                time: `${nextMinutePrefix}35.000Z`,
                displayName: 'TraderA',
                isUnread: false,
                images: []
              }
            ]
          },
          1: {
            handle: 'threads:@zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'en_msg_1',
                text: 'Added igv and panw puts at the open today as software names hit major overhead supply',
                datetime: `${baseMinute}05.000Z`,
                time: `${baseMinute}05.000Z`,
                url: 'https://www.threads.com/@zuck/post/en_msg_1',
                author: 'zuck',
                isUnread: false,
                images: []
              },
              {
                id: 'en_msg_2',
                text: '110 on igv was the exact origin of last Friday breakdown candle and getting rejected right here is extremely bearish for the sector.\nSecond paragraph with more details that definitely exceeds the 100 character limit and must be truncated.',
                datetime: `${baseMinute}35.000Z`,
                time: `${baseMinute}35.000Z`,
                url: 'https://www.threads.com/@zuck/post/en_msg_2',
                author: 'zuck',
                isUnread: false,
                images: []
              }
            ]
          },
          2: {
            handle: '@elonmusk',
            source: 'twitter',
            displayName: 'Elon Musk',
            userHandle: '@elonmusk',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '2001',
                text: 'Every time DCA Optimizer flashed a buy signal on $UBER ...\n14 signal months. Average price move 12 months later: +34.1%.\nThe ONE time it hit 4X Extreme Buy Zone? +111.0%\nTry it FREE for 7 days:',
                datetime: `${baseMinute}12.000Z`,
                time: `${baseMinute}12.000Z`,
                url: 'https://x.com/elonmusk/status/2001',
                author: 'elonmusk',
                isUnread: false,
                images: []
              },
              {
                id: '2002',
                text: 'Follow-up thread reply posted in the exact same minute.',
                datetime: `${baseMinute}40.000Z`,
                time: `${baseMinute}40.000Z`,
                url: 'https://x.com/elonmusk/status/2002',
                author: 'elonmusk',
                isUnread: false,
                images: []
              }
            ]
          }
        };
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        saveAllSlotCache(cache);
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    // Slot 0 (Discord): 5 Chinese messages at 19:47 merge into 1 bubble + 2 English messages at 19:48 merge into 1 bubble = 2 bubbles total
    const discordBubbles = page.locator('#slot-content-0 .im-bubble');
    await expect(discordBubbles).toHaveCount(2);

    const mergedChineseBubble = discordBubbles.nth(0);
    await expect(mergedChineseBubble).toHaveClass(/unread/);
    // Merged Discord bubble must NOT be truncated even though it exceeds 100 chars
    await expect(mergedChineseBubble.locator('.im-text-ellipsis')).toHaveCount(0);

    const chineseText = await mergedChineseBubble.locator('.im-text-content').textContent();
    expect(chineseText).toBe(
      'add了 igv + panw put。 igv 110左右是上周五大阴线的起点。这里今天拉回去就被抛售是很bearish的。做空，盈亏比很高，拉过去我们就止损。很多 igv 的估值比半导体还高，而且当前软件板块整体面临非常明显的估值压缩压力，长线资金也在持续撤出高估值SaaS标的，反弹就是很好的加仓做空机会'
    );

    // Tickers (igv x3, panw x1) are highlighted inside the merged Chinese bubble
    await expect(mergedChineseBubble.locator('.ticker-highlight')).toHaveCount(4);

    // Clicking the merged bubble marks all 5 underlying messages as read, expands the section in the background, and opens popup with full merged text
    const item0 = page.locator('.grid-stack-item[data-slot-index="0"]');
    const squeezedItems = page.locator('.grid-stack-item.is-hover-squeezed');
    await mergedChineseBubble.click();
    await expect(page.locator('#slot-unread-badge-0')).toBeHidden();
    await expect(item0).toHaveClass(/is-hover-expanded/);
    await expect(squeezedItems).toHaveCount(1);
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    await expect(popupOverlay.locator('.discord-embed-slot .discord-popup-card')).toHaveClass(
      /mantine-Paper-root/
    );
    await expect(popupOverlay.locator('.discord-popup-text')).toHaveText(chineseText);
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);
    await expect(item0).toHaveClass(/is-hover-expanded/);

    // Second Discord bubble: 2 English messages in the same minute merge into 1 bubble separated by ". " and are not truncated
    const mergedEnglishBubble = discordBubbles.nth(1);
    await expect(mergedEnglishBubble.locator('.im-text-ellipsis')).toHaveCount(0);
    const englishText = await mergedEnglishBubble.locator('.im-text-content').textContent();
    expect(englishText).toBe(
      'Added igv and panw puts at the open today as software names hit major overhead supply. 110 on igv was the exact origin of last Friday breakdown candle and getting rejected right here is extremely bearish for the sector'
    );

    // Slot 1 (Threads): 2 posts in the same minute must NOT merge and long post must be truncated
    const threadsBubbles = page.locator('#slot-content-1 .im-bubble');
    await expect(threadsBubbles).toHaveCount(2);
    await expect(threadsBubbles.nth(1).locator('.im-text-ellipsis')).toHaveCount(1);

    // Slot 2 (Twitter): 2 tweets in the same minute must NOT merge and long tweet must be truncated
    const twitterBubbles = page.locator('#slot-content-2 .im-bubble');
    await expect(twitterBubbles).toHaveCount(2);
    await expect(twitterBubbles.nth(0).locator('.im-text-ellipsis')).toHaveCount(1);
    const truncatedTweetText = await twitterBubbles.nth(0).locator('.im-text-content').textContent();
    expect(truncatedTweetText).not.toContain('Try it FREE for 7 days:');
  });

  test('13. Hovering a slot content area hides its header to reveal obscured content and moving to top header area restores it', async () => {
    const card0 = page.locator('#slot-card-0');
    const header0 = card0.locator('.slot-header');
    const content0 = page.locator('#slot-content-0');
    const header1 = page.locator('#slot-card-1 .slot-header');

    // Move cursor onto slot 0's header first to restore any background section expansion from the previous test
    await page.waitForTimeout(260);
    const initialHeaderBox = await header0.boundingBox();
    await page.mouse.move(
      initialHeaderBox.x + initialHeaderBox.width / 2,
      initialHeaderBox.y + initialHeaderBox.height / 2
    );
    await expect(page.locator('.grid-stack-item[data-slot-index="0"]')).not.toHaveClass(
      /is-hover-expanded/
    );

    // Verify content container spans full card height behind overlay header
    const geometry = await page.evaluate(() => {
      const cRect = document.getElementById('slot-card-0').getBoundingClientRect();
      const hRect = document.querySelector('#slot-card-0 .slot-header').getBoundingClientRect();
      const ctRect = document.getElementById('slot-content-0').getBoundingClientRect();
      return {
        cardTop: cRect.top,
        cardHeight: cRect.height,
        headerTop: hRect.top,
        headerHeight: hRect.height,
        contentTop: ctRect.top,
        contentHeight: ctRect.height
      };
    });
    expect(Math.abs(geometry.contentTop - geometry.cardTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.contentHeight - geometry.cardHeight)).toBeLessThanOrEqual(4);
    expect(geometry.headerHeight).toBe(28);

    // Move cursor to top navbar (outside all slot cards): header is visible
    await page.mouse.move(100, 15);
    await expect(card0).not.toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(1);

    // Move cursor into slot 0's lower message content area: slot 0's header hides, slot 1's header stays visible
    const contentBox = await content0.boundingBox();
    await page.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + contentBox.height / 2);
    await expect(card0).toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(0);
    await expect.poll(() =>
      header1.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(1);

    // Move cursor to the right edge resize handle (.ui-resizable-e where horizontal resize arrow appears):
    // header must remain hidden, and clicking on the resize handle area expands/restores the section
    const item0 = page.locator('.grid-stack-item[data-slot-index="0"]');
    const cornerHandleStyles = await item0.evaluate((el) => {
      const se = el.querySelector(':scope > .ui-resizable-se');
      const sw = el.querySelector(':scope > .ui-resizable-sw');
      const seStyle = se ? getComputedStyle(se) : null;
      const swStyle = sw ? getComputedStyle(sw) : null;
      const seAfter = se ? getComputedStyle(se, '::after') : null;
      return {
        seBg: seStyle ? seStyle.backgroundImage : null,
        swBg: swStyle ? swStyle.backgroundImage : null,
        seCursor: seStyle ? seStyle.cursor : null,
        swCursor: swStyle ? swStyle.cursor : null,
        seAfterContent: seAfter ? seAfter.content : null
      };
    });
    expect(cornerHandleStyles.seBg).toBe('none');
    expect(cornerHandleStyles.swBg).toBe('none');
    expect(cornerHandleStyles.seCursor).toBe('se-resize');
    expect(cornerHandleStyles.swCursor).toBe('sw-resize');
    expect(cornerHandleStyles.seAfterContent).toBe('none');

    const squeezedItems = page.locator('.grid-stack-item.is-hover-squeezed');
    const resizeEastBox = await page
      .locator('.grid-stack-item[data-slot-index="0"] > .ui-resizable-e')
      .boundingBox();
    const resizeClickX = resizeEastBox.x + resizeEastBox.width / 2;
    const resizeClickY = resizeEastBox.y + resizeEastBox.height / 2;
    await page.mouse.move(resizeClickX, resizeClickY);
    await expect(card0).toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(0);

    // Click on the resize arrow area (.ui-resizable-e) to expand slot 0 in its column
    await page.mouse.click(resizeClickX, resizeClickY);
    await expect(item0).toHaveClass(/is-hover-expanded/);
    await expect(squeezedItems).toHaveCount(1);

    // Click on the resize arrow area again to restore column heights
    await page.mouse.click(resizeClickX, resizeClickY);
    await expect(item0).not.toHaveClass(/is-hover-expanded/);
    await expect(squeezedItems).toHaveCount(0);

    // Move cursor up to slot 0's top header area: slot 0's header reappears for button/drag interaction
    const headerBox = await header0.boundingBox();
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
    await expect(card0).not.toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(1);
  });

  test('14. Login expiration vs initial unlogged-in state: persistent banner, per-slot prompt & recovery on login', async () => {
    // Part A: Simulate a fresh first-time install (never logged into Discord/Twitter/Threads, no Discord cache)
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        localStorage.removeItem('theysay_discord_logged_in');
        localStorage.removeItem('theysay_discord_ever_logged_in');
        localStorage.removeItem('theysay_discord_login_expired');
        localStorage.removeItem('theysay_twitter_ever_logged_in');
        localStorage.removeItem('theysay_twitter_login_expired');
        localStorage.removeItem('theysay_threads_logged_in');
        localStorage.removeItem('theysay_threads_ever_logged_in');
        localStorage.removeItem('theysay_threads_login_expired');
        const { clearAllPostCache } = require('./src/core/storage');
        clearAllPostCache();

        const handles = ['elonmusk', '', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const topBanner = page.locator('#auth-expired-banner');
    const discordBadge = page.locator('#discord-status-badge');
    const discordLabel = page.locator('#discord-status-label');
    const menuDot = page.locator('#login-menu-status-dot');
    const menuBtn = page.locator('#btn-login-menu');

    // Initial unlogged-in state must NOT show any login-expired banner or warning
    await expect(topBanner).toBeHidden();
    await expect(discordBadge).toHaveClass(/logged-out/);
    await expect(discordBadge).not.toHaveClass(/expired/);
    await expect(discordLabel).toHaveText('未登录');
    await expect(menuDot).not.toHaveClass(/has-expired/);
    await expect(menuBtn).not.toHaveClass(/has-expired/);
    await expect(page.locator('#slot-expired-banner-0')).toBeHidden();

    // Even if an unlogged-in user tries a Discord slot before ever logging in (force: false),
    // it remains in the initial unlogged-in state without triggering the global expired banner
    await page.evaluate(() => {
      const { markPlatformLoginExpired } = require('./src/ui/auth');
      markPlatformLoginExpired('discord', { force: false });
    });
    await expect(topBanner).toBeHidden();
    await expect(discordLabel).toHaveText('未登录');

    // Part B: Simulate an existing Discord user whose session has expired (cached Discord messages + logged_in = '0')
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const handles = [
          'https://discord.com/channels/100000000000000001/200000000000000002',
          'elonmusk',
          '',
          ''
        ];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));
        localStorage.setItem('theysay_discord_logged_in', '0');

        const cache = {
          0: {
            handle: 'https://discord.com/channels/100000000000000001/200000000000000002',
            source: 'discord',
            sourceTitle: '#general',
            sourceSubtitle: 'AlphaResearch',
            displayName: '#general',
            userHandle: 'AlphaResearch',
            avatarUrl: '',
            lastFetchedAt: Date.now() - 3600000,
            posts: [
              {
                id: 'msg_oct23',
                text: 'Previous cached message from Discord channel',
                datetime: '2026-10-23T18:55:00.000Z',
                time: '2026-10-23T18:55:00.000Z',
                displayName: 'Analyst',
                isUnread: false,
                images: []
              }
            ]
          }
        };
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        saveAllSlotCache(cache);
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    // Global top banner must be prominently visible and have NO close button
    await expect(topBanner).toBeVisible();
    await expect(topBanner.locator('.auth-expired-banner-text')).toContainText(
      'Discord 登录已过期，无法拉取最新消息，请重新登录以恢复更新。'
    );
    const bannerLoginBtn = topBanner.locator('.auth-expired-login-btn[data-platform="discord"]');
    await expect(bannerLoginBtn).toBeVisible();
    await expect(bannerLoginBtn).toHaveText('立即登录 Discord');
    await expect(topBanner.locator('button')).toHaveCount(1);

    // Header account button & Discord dropdown badge show expired state
    await expect(menuDot).toHaveClass(/has-expired/);
    await expect(menuBtn).toHaveClass(/has-expired/);
    await expect(discordBadge).toHaveClass(/expired/);
    await expect(discordLabel).toHaveText('登录已过期');

    // Discord slot (Slot 0) shows per-slot expired banner; Twitter slot (Slot 1) does not
    await expect(page.locator('#slot-card-0')).toHaveClass(/is-login-expired/);
    await expect(page.locator('#slot-expired-banner-0')).toBeVisible();
    await expect(page.locator('#slot-expired-text-0')).toHaveText('Discord 登录已过期，无法更新最新消息');
    await expect(page.locator('#slot-expired-btn-0')).toHaveText('重新登录');
    await expect(page.locator('#slot-expired-banner-1')).toBeHidden();

    // Pressing Escape or clicking elsewhere must NOT dismiss the banner before logging in
    await page.keyboard.press('Escape');
    await page.mouse.click(20, 20);
    await expect(topBanner).toBeVisible();
    await expect(page.locator('#slot-expired-banner-0')).toBeVisible();

    // Verify updateSlotHeaderMeta helper works without error
    await page.evaluate(() => {
      const { updateSlotHeaderMeta } = require('./src/ui/slot');
      const slotEl = document.getElementById('author-name-0');
      const fakeSlot = {
        source: 'discord',
        sourceTitle: '#general',
        sourceSubtitle: 'AlphaResearch',
        authorName: slotEl,
        authorHandle: document.getElementById('author-handle-0'),
        authorHeader: document.getElementById('slot-author-header-0'),
        lastFetchedAt: Date.now()
      };
      updateSlotHeaderMeta(fakeSlot, {
        source: 'discord',
        title: '#general',
        subtitle: 'AlphaResearch'
      });
    });

    // Part C: Simulate user completing Discord login; banner and slot warning must disappear immediately
    await electronApp.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        wins[0].webContents.send('discord-login-status-changed', { loggedIn: true });
      }
    });

    await expect(topBanner).toBeHidden();
    await expect(page.locator('#slot-expired-banner-0')).toBeHidden();
    await expect(page.locator('#slot-card-0')).not.toHaveClass(/is-login-expired/);
    await expect(discordBadge).toHaveClass(/logged-in/);
    await expect(discordLabel).toHaveText('已登录');
    await expect(menuDot).toHaveClass(/has-login/);
    await expect(menuDot).not.toHaveClass(/has-expired/);
  });

  test('17. Long URLs in messages resolve and display webpage <title> instead of raw links in bubbles and popups', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      const reqUrl = req.url || '';
      if (reqUrl.startsWith('/not-found-x')) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><title>未找到帖子 - X | 404 错误</title></head><body>404</body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (reqUrl.startsWith('/p/10262026-trading-recap-and-outlook')) {
        res.end('<!doctype html><html><head><title>10/26/2026 Trading Recap and Outlook - Alpha&#x27;s Substack</title></head><body>Recap</body></html>');
      } else if (reqUrl.startsWith('/p/10262026')) {
        res.end('<!doctype html><html><head><title>10/26/2026 复盘与展望 - Alpha&#x27;s Substack</title></head><body>复盘</body></html>');
      } else {
        res.end('<!doctype html><html><head><title>Default Page Title</title></head><body>ok</body></html>');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const longUrl1 = `http://127.0.0.1:${port}/p/10262026?r=2wn5pz&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true`;
    const longUrl2 = `http://127.0.0.1:${port}/p/10262026-trading-recap-and-outlook?r=2wn5pz&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true`;
    const notFoundUrl = `http://127.0.0.1:${port}/not-found-x`;

    try {
      await page.evaluate(
        ({ handlesKey, cacheKey, u1, u2 }) => {
          localStorage.removeItem('theysay_url_titles_cache');
          const handles = [
            'https://discord.com/channels/100000000000000001/200000000000000002',
            '',
            '',
            ''
          ];
          while (handles.length < 16) handles.push('');
          localStorage.setItem(handlesKey, JSON.stringify(handles));
          localStorage.setItem('theysay_discord_logged_in', '1');

          const cache = {
            0: {
              handle: 'https://discord.com/channels/100000000000000001/200000000000000002',
              source: 'discord',
              sourceTitle: '#general',
              sourceSubtitle: 'AlphaResearch',
              displayName: '#general',
              userHandle: 'AlphaResearch',
              avatarUrl: '',
              lastFetchedAt: Date.now(),
              posts: [
                {
                  id: '1499000000000000001',
                  text: u1,
                  datetime: '2026-10-26T11:44:10.000Z',
                  time: '2026-10-26T11:44:10.000Z',
                  displayName: 'AlphaAnalyst',
                  url: 'https://discord.com/channels/100000000000000001/200000000000000002/1499000000000000001',
                  isUnread: false,
                  images: [],
                  attachments: ['嵌入卡片']
                },
                {
                  id: '1499000000000000002',
                  text: u2,
                  datetime: '2026-10-26T11:44:25.000Z',
                  time: '2026-10-26T11:44:25.000Z',
                  displayName: 'AlphaAnalyst',
                  url: 'https://discord.com/channels/100000000000000001/200000000000000002/1499000000000000002',
                  isUnread: false,
                  images: [],
                  attachments: ['嵌入卡片']
                },
                {
                  id: '1499000000000000003',
                  text: u2,
                  datetime: '2026-10-26T11:50:00.000Z',
                  time: '2026-10-26T11:50:00.000Z',
                  displayName: 'AlphaAnalyst',
                  url: 'https://discord.com/channels/100000000000000001/200000000000000002/1499000000000000003',
                  isUnread: false,
                  images: []
                }
              ]
            }
          };
          const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
          clearAllPostCache();
          saveAllSlotCache(cache);
        },
        {
          handlesKey: STORAGE_HANDLES_KEY,
          cacheKey: STORAGE_CACHE_KEY,
          u1: longUrl1,
          u2: longUrl2
        }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });

      const bubbles = page.locator('#slot-posts-list-0 .im-bubble');
      await expect(bubbles).toHaveCount(2);

      const mergedBubbleText = bubbles.nth(0).locator('.im-text-content');
      const singleBubbleText = bubbles.nth(1).locator('.im-text-content');

      // Wait for async URL title resolution to update both bubbles in place
      await expect(mergedBubbleText).toContainText("10/26/2026 复盘与展望 - Alpha's Substack");
      await expect(mergedBubbleText).toContainText("10/26/2026 Trading Recap and Outlook - Alpha's Substack");
      await expect(mergedBubbleText).not.toContainText('showWelcomeOnShare=true');

      // Single post with >100-char raw URL should display its 55-char title without '...' truncation
      await expect(singleBubbleText).toHaveText("10/26/2026 Trading Recap and Outlook - Alpha's Substack");
      await expect(singleBubbleText.locator('.im-text-ellipsis')).toHaveCount(0);

      // Click the merged bubble to open the popup and verify popup links show titles and keep original URLs
      await bubbles.nth(0).click();
      const overlay = page.locator('#tweet-popup-overlay');
      await expect(overlay).not.toHaveClass(/is-closed/);

      const popupLinks = overlay.locator('.discord-popup-text .popup-inline-link');
      await expect(popupLinks).toHaveCount(2);
      await expect(popupLinks.nth(0)).toHaveText("10/26/2026 复盘与展望 - Alpha's Substack");
      await expect(popupLinks.nth(0)).toHaveAttribute('data-url', longUrl1);
      await expect(popupLinks.nth(1)).toHaveText("10/26/2026 Trading Recap and Outlook - Alpha's Substack");
      await expect(popupLinks.nth(1)).toHaveAttribute('data-url', longUrl2);

      await page.keyboard.press('Escape');
      await expect(overlay).toHaveClass(/is-closed/);

      // Verify HTTP 404 / error-page titles are never resolved or cached as link titles
      const errorTitleCheck = await page.evaluate(async (nfUrl) => {
        const { ipcRenderer } = require('electron');
        const { cleanUrlTitleString, registerUrlTitle, getCachedUrlTitle } = require('./src/core/ticker');
        const ipcRes = await ipcRenderer.invoke('fetch-url-title', nfUrl);
        registerUrlTitle('https://x.com/foo/status/1234567890', '未找到帖子 - X | 404 错误', { persist: false });
        return {
          ipcRes,
          rejectedX404: cleanUrlTitleString('未找到帖子 - X | 404 错误', 'https://x.com/foo/status/1234567890'),
          rejectedGeneric404: cleanUrlTitleString('404 Not Found', 'https://example.com/missing'),
          valid404Guide: cleanUrlTitleString('How to handle 404 errors', 'https://example.com/guide'),
          cachedX404: getCachedUrlTitle('https://x.com/foo/status/1234567890')
        };
      }, notFoundUrl);
      expect(errorTitleCheck.ipcRes.ok).toBe(false);
      expect(errorTitleCheck.ipcRes.title).toBe('');
      expect(errorTitleCheck.rejectedX404).toBe('');
      expect(errorTitleCheck.rejectedGeneric404).toBe('');
      expect(errorTitleCheck.valid404Guide).toBe('How to handle 404 errors');
      expect(errorTitleCheck.cachedX404).toBe('');

      // Verify linkify-it + tlds, normalize-url, and colord behavior
      const linkifyCheck = await page.evaluate(() => {
        const {
          extractUrlsFromText,
          formatTextWithTickers,
          registerUrlTitle,
          getCachedUrlTitle
        } = require('./src/core/ticker');
        const { resolveHeaderPalette, normalizeHexColor } = require('./src/ui/theme');

        registerUrlTitle(
          'https://example.com:443/report/?b=2&utm_source=twitter&a=1#section',
          'Normalized Report Title',
          { persist: false }
        );
        const canonicalHit = getCachedUrlTitle('https://example.com/report?a=1&b=2&fbclid=xyz');

        const sample =
          '看下https://en.wikipedia.org/wiki/Apple_(company)，以及 defillama.finance/chains 和 @elonmusk 提到的 $NVDA (还有 coin.market 域名)';
        return {
          urls: extractUrlsFromText(sample),
          html: formatTextWithTickers(sample, sample, {
            linkifyUrls: true,
            linkTitles: {
              'https://en.wikipedia.org/wiki/Apple_(company)': 'Apple Inc. - Wikipedia'
            }
          }),
          spacedMid: formatTextWithTickers('我intc的 call 废了'),
          spacedStart: formatTextWithTickers('amzn也跟着去了'),
          alreadySpaced: formatTextWithTickers('哈哈 intc 看不明白了'),
          canonicalHit,
          normalizedHex: normalizeHexColor('1E293B'),
          darkPalette: resolveHeaderPalette('#1e293b'),
          lightPalette: resolveHeaderPalette('#f1f5f9')
        };
      });
      expect(linkifyCheck.urls).toEqual([
        'https://en.wikipedia.org/wiki/Apple_(company)',
        'defillama.finance/chains'
      ]);
      expect(linkifyCheck.html).toContain('Apple Inc. - Wikipedia');
      expect(linkifyCheck.html).toContain('<span class="ticker-highlight">$NVDA</span>');
      // 'coin' inside bare domain 'coin.market' must not be highlighted as a ticker
      expect(linkifyCheck.html).not.toContain('<span class="ticker-highlight">coin</span>');
      expect(linkifyCheck.spacedMid).toBe('我 <span class="ticker-highlight">intc</span> 的 call 废了');
      expect(linkifyCheck.spacedStart).toBe('<span class="ticker-highlight">amzn</span> 也跟着去了');
      expect(linkifyCheck.alreadySpaced).toBe('哈哈 <span class="ticker-highlight">intc</span> 看不明白了');
      expect(linkifyCheck.canonicalHit).toBe('Normalized Report Title');
      expect(linkifyCheck.normalizedHex).toBe('#1e293b');
      expect(linkifyCheck.darkPalette.text).toBe('#f8fafc');
      expect(linkifyCheck.lightPalette.text).toBe('#0f1419');

      // Verify .background-webviews-container matches window innerWidth/innerHeight (preventing Discord DevTools hideToken)
      // and verify Discord auth token backup / LevelDB recovery IPC round-trip
      const discordGuardCheck = await page.evaluate(async () => {
        const { ipcRenderer } = require('electron');
        const bg = document.querySelector('.background-webviews-container');
        const rect = bg.getBoundingClientRect();
        const widthDiff = Math.abs(rect.width - window.innerWidth);
        const heightDiff = Math.abs(rect.height - window.innerHeight);

        const sampleToken = 'dummy-discord-test-token-for-ipc-roundtrip';
        ipcRenderer.send('discord-auth-captured', {
          token: sampleToken,
          userId: '100000000000000001',
          tokens: { '100000000000000001': sampleToken },
          multiAccountStore: {
            _state: { users: [{ id: '100000000000000001', username: 'test_user', tokenStatus: 0 }] },
            _version: 2
          }
        });
        const backup = await ipcRenderer.invoke('get-discord-auth-backup');
        await ipcRenderer.invoke('clear-discord-auth-backup');
        const afterClear = await ipcRenderer.invoke('get-discord-auth-backup');

        return {
          widthDiff,
          heightDiff,
          backedUpToken: backup && backup.token,
          backedUpStatus:
            backup &&
            backup.multiAccountStore &&
            backup.multiAccountStore._state.users[0].tokenStatus,
          afterClear
        };
      });
      expect(discordGuardCheck.widthDiff).toBeLessThanOrEqual(1);
      expect(discordGuardCheck.heightDiff).toBeLessThanOrEqual(1);
      expect(discordGuardCheck.backedUpToken).toBe(
        'dummy-discord-test-token-for-ipc-roundtrip'
      );
      expect(discordGuardCheck.backedUpStatus).toBe(2);
      expect(discordGuardCheck.afterClear).toBeNull();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('16. Filter Keywords: multi-word phrases & single keywords directly discard matching posts', async () => {
    // Move cursor outside slot 0 so hovering does not auto-mark newly rendered bubbles as read
    await page.mouse.move(10, 10);

    // Seed slot 0 with 4 posts:
    // 1) Normal post
    // 2) Post matching multi-word phrase "crypto giveaway" (with extra whitespace/newline)
    // 3) Post containing only "crypto" (partial match of multi-word phrase — must NOT be discarded)
    // 4) Post matching single keyword "sponsored"
    await page.evaluate(() => {
      const { saveFilterKeywords } = require('./src/core/storage');
      const { getRegisteredSlots, renderSlotPosts } = require('./src/ui/slot');
      saveFilterKeywords([]);
      const slots = getRegisteredSlots();
      const slot = slots[0];
      slot.monitoredHandle = 'filtertest';
      slot.handleInput.value = 'filtertest';
      renderSlotPosts(
        slot,
        [
          {
            id: 'fk-1',
            url: 'https://x.com/filtertest/status/91001',
            text: 'Market update: $NVDA earnings look strong today.',
            time: '10:01',
            datetime: '2026-10-28T10:01:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          },
          {
            id: 'fk-2',
            url: 'https://x.com/filtertest/status/91002',
            text: 'Join our CRYPTO   GIVEAWAY\nright now for free tokens!',
            time: '10:02',
            datetime: '2026-10-28T10:02:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          },
          {
            id: 'fk-3',
            url: 'https://x.com/filtertest/status/91003',
            text: 'Crypto markets are quiet today.',
            time: '10:03',
            datetime: '2026-10-28T10:03:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          },
          {
            id: 'fk-4',
            url: 'https://x.com/filtertest/status/91004',
            text: 'Check out this sponsored post from our partner.',
            time: '10:04',
            datetime: '2026-10-28T10:04:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          }
        ],
        'filtertest',
        null,
        slots
      );
    });

    const slot0Bubbles = page.locator('#slot-content-0 .im-bubble');
    await expect(slot0Bubbles).toHaveCount(4);
    await expect(page.locator('#slot-unread-badge-0')).toHaveText('4');

    // Open Settings and add a multi-word phrase ("crypto giveaway") and a single word ("sponsored")
    await page.locator('#btn-settings').click();
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    const filterInput = page.locator('#setting-filter-keywords-input');
    await filterInput.fill('crypto giveaway');
    await filterInput.press('Enter');

    await filterInput.fill('sponsored, limited time offer');
    await filterInput.press('Enter');

    const chips = page.locator('.settings-row-filter-keywords .filter-keyword-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0).locator('.mantine-Pill-label')).toHaveText('crypto giveaway');
    await expect(chips.nth(1).locator('.mantine-Pill-label')).toHaveText('sponsored');
    await expect(chips.nth(2).locator('.mantine-Pill-label')).toHaveText('limited time offer');

    // Matching posts (fk-2 and fk-4) are directly discarded; fk-1 and fk-3 (partial word "Crypto") remain
    await expect(slot0Bubbles).toHaveCount(2);
    await expect(slot0Bubbles.nth(0).locator('.im-text-content')).toContainText(
      'Market update: $NVDA earnings look strong today.'
    );
    await expect(slot0Bubbles.nth(1).locator('.im-text-content')).toContainText(
      'Crypto markets are quiet today.'
    );
    await expect(page.locator('#slot-unread-badge-0')).toHaveText('2');

    // Remove the "sponsored" chip and re-render all 4 posts: fk-4 should now be allowed, while fk-2 is still discarded
    await chips.nth(1).locator('.mantine-Pill-remove').click();
    await expect(chips).toHaveCount(2);

    await page.evaluate(() => {
      const { getRegisteredSlots, renderSlotPosts } = require('./src/ui/slot');
      const slots = getRegisteredSlots();
      const slot = slots[0];
      renderSlotPosts(
        slot,
        [
          {
            id: 'fk-1',
            url: 'https://x.com/filtertest/status/91001',
            text: 'Market update: $NVDA earnings look strong today.',
            time: '10:01',
            datetime: '2026-10-28T10:01:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          },
          {
            id: 'fk-2',
            url: 'https://x.com/filtertest/status/91002',
            text: 'Join our CRYPTO   GIVEAWAY right now for free tokens!',
            time: '10:02',
            datetime: '2026-10-28T10:02:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          },
          {
            id: 'fk-3',
            url: 'https://x.com/filtertest/status/91003',
            text: 'Crypto markets are quiet today.',
            time: '10:03',
            datetime: '2026-10-28T10:03:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          },
          {
            id: 'fk-4',
            url: 'https://x.com/filtertest/status/91004',
            text: 'Check out this sponsored post from our partner.',
            time: '10:04',
            datetime: '2026-10-28T10:04:00.000Z',
            displayName: 'Filter Tester',
            userHandle: '@filtertest',
            isUnread: true,
            images: []
          }
        ],
        'filtertest',
        null,
        slots
      );
    });
    await expect(slot0Bubbles).toHaveCount(3);

    // Click Restore Defaults in Settings and verify filter keywords are cleared
    await page.locator('#btn-settings-reset').click();
    await expect(chips).toHaveCount(0);
    await page.locator('#btn-settings-close').click();
    await expect(settingsOverlay).toHaveClass(/is-closed/);
  });

  test('17. Auto-update (GitHub Releases): cross-platform asset resolution, UI check/download/install flow, and settings persistence', async () => {
    // 1. Verify cross-platform GitHub Release asset selection (macOS, Windows NSIS/Portable, Linux AppImage/deb)
    const unitCheck = await page.evaluate(() => {
      const {
        isVersionNewer,
        selectPlatformReleaseAsset
      } = require('./src/core/updater');
      const {
        getAutoCheckUpdates,
        saveAutoCheckUpdates,
        buildProfileData
      } = require('./src/core/storage');

      const sampleAssets = [
        {
          name: 'TheySay-1.2.0-arm64.dmg',
          browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-1.2.0-arm64.dmg',
          size: 102400
        },
        {
          name: 'TheySay-Setup-1.2.0.exe',
          browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-Setup-1.2.0.exe',
          size: 204800
        },
        {
          name: 'TheySay-Portable-1.2.0.exe',
          browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-Portable-1.2.0.exe',
          size: 198000
        },
        {
          name: 'TheySay-1.2.0-x86_64.AppImage',
          browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-1.2.0-x86_64.AppImage',
          size: 307200
        }
      ];

      const macAsset = selectPlatformReleaseAsset(sampleAssets, {
        platform: 'darwin',
        arch: 'arm64'
      });
      const winNsisAsset = selectPlatformReleaseAsset(sampleAssets, {
        platform: 'win32',
        arch: 'x64',
        env: {}
      });
      const winPortableAsset = selectPlatformReleaseAsset(sampleAssets, {
        platform: 'win32',
        arch: 'x64',
        env: { PORTABLE_EXECUTABLE_FILE: 'C:\\TheySay-Portable.exe' }
      });
      const linuxAsset = selectPlatformReleaseAsset(sampleAssets, {
        platform: 'linux',
        arch: 'x64'
      });

      saveAutoCheckUpdates(false);
      const savedFalse = getAutoCheckUpdates();
      const exportedProfile = buildProfileData({ slots: [], grid: null });
      saveAutoCheckUpdates(true);

      return {
        newerPatch: isVersionNewer('1.0.1', '1.0.0'),
        sameVer: isVersionNewer('1.0.0', 'v1.0.0'),
        olderVer: isVersionNewer('0.9.9', '1.0.0'),
        macAssetName: macAsset && macAsset.name,
        winNsisAssetName: winNsisAsset && winNsisAsset.name,
        winPortableAssetName: winPortableAsset && winPortableAsset.name,
        linuxAssetName: linuxAsset && linuxAsset.name,
        savedFalse,
        exportedAutoCheck: exportedProfile.settings.autoCheckUpdates
      };
    });

    expect(unitCheck.newerPatch).toBe(true);
    expect(unitCheck.sameVer).toBe(false);
    expect(unitCheck.olderVer).toBe(false);
    expect(unitCheck.macAssetName).toBe('TheySay-1.2.0-arm64.dmg');
    expect(unitCheck.winNsisAssetName).toBe('TheySay-Setup-1.2.0.exe');
    expect(unitCheck.winPortableAssetName).toBe('TheySay-Portable-1.2.0.exe');
    expect(unitCheck.linuxAssetName).toBe('TheySay-1.2.0-x86_64.AppImage');
    expect(unitCheck.savedFalse).toBe(false);
    expect(unitCheck.exportedAutoCheck).toBe(false);

    // 2. Open Settings and test up-to-date check -> available update -> download -> ready to install
    await page.locator('#btn-settings').click();
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    const autoUpdateSelect = page.locator('#setting-auto-update');
    await expect(autoUpdateSelect).toHaveValue('true');
    await autoUpdateSelect.selectOption('false');
    await expect(autoUpdateSelect).toHaveValue('false');

    // Mock GitHub Release API returning current version v1.1.0 (up to date)
    await page.evaluate(async () => {
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('set-mock-update-release', {
        tag_name: 'v1.1.0',
        html_url: 'https://github.com/laike9m/TheySay/releases/tag/v1.1.0',
        assets: []
      });
    });

    const btnCheckUpdates = page.locator('#btn-check-updates');
    const statusText = page.locator('#setting-update-status-text');
    await btnCheckUpdates.click();
    await expect(statusText).toContainText('1.1.0');
    await expect(btnCheckUpdates).not.toHaveClass(/is-update-available/);
    await expect(page.locator('#btn-settings')).not.toHaveClass(/has-update-badge/);

    // Now mock a newer GitHub Release v1.2.0 with assets for all platforms
    await page.evaluate(async () => {
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('set-mock-update-release', {
        tag_name: 'v1.2.0',
        html_url: 'https://github.com/laike9m/TheySay/releases/tag/v1.2.0',
        body: 'Cross-platform auto-update support',
        assets: [
          {
            name: 'TheySay-1.2.0-arm64.dmg',
            browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-1.2.0-arm64.dmg',
            size: 102400
          },
          {
            name: 'TheySay-Setup-1.2.0.exe',
            browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-Setup-1.2.0.exe',
            size: 204800
          },
          {
            name: 'TheySay-1.2.0-x86_64.AppImage',
            browser_download_url: 'https://github.com/laike9m/TheySay/releases/download/v1.2.0/TheySay-1.2.0-x86_64.AppImage',
            size: 307200
          }
        ]
      });
    });

    await btnCheckUpdates.click();
    await expect(statusText).toContainText('v1.2.0');
    await expect(btnCheckUpdates).toHaveClass(/is-update-available/);
    await expect(btnCheckUpdates).toContainText('v1.2.0');
    await expect(page.locator('#btn-settings')).toHaveClass(/has-update-badge/);

    // Click #btn-check-updates again to download the update
    await btnCheckUpdates.click();
    await expect(btnCheckUpdates).toHaveClass(/is-update-ready/);
    await expect(statusText).toContainText('v1.2.0');

    // Restore Defaults resets autoCheckUpdates back to true
    await page.locator('#btn-settings-reset').click();
    await expect(autoUpdateSelect).toHaveValue('true');

    // Clean up mock release state
    await page.evaluate(async () => {
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('set-mock-update-release', null);
    });

    await page.locator('#btn-settings-close').click();
    await expect(settingsOverlay).toHaveClass(/is-closed/);
  });

  test('22. Onboarding tour format example selection, header visibility & Escape dismissal', async () => {
    const prevInputVal = await page.locator('#handle-input-0').inputValue();

    // Launch onboarding tour programmatically
    await page.evaluate(() => {
      window.__THEYSAY_ONBOARDING.start({ startIndex: 0 });
    });

    const popover = page.locator('.driver-popover.theysay-onboarding-popover');
    await expect(popover).toBeVisible();
    await expect(page.locator('#btn-login-menu')).toHaveClass(/driver-active-element/);

    // Advance to step 2
    await popover.locator('.driver-popover-next-btn').click();
    await expect(page.locator('#slot-input-wrapper-0')).toBeVisible();
    await expect(page.locator('#slot-input-wrapper-0')).toHaveClass(/driver-active-element/);

    // Click Threads format example chip and verify input updates
    await popover.locator('.onboarding-format-code[data-example="threads:@zuck"]').click();
    await expect(page.locator('#handle-input-0')).toHaveValue('threads:@zuck');
    await expect(page.locator('#slot-input-prefix-0')).toHaveClass(/is-threads/);

    // Click Discord format example chip and verify input prefix switches to #
    await popover
      .locator(
        '.onboarding-format-code[data-example="https://discord.com/channels/100000000000000001/200000000000000002"]'
      )
      .click();
    await expect(page.locator('#slot-input-prefix-0')).toHaveText('#');

    // Restore original input value
    await page.evaluate((val) => {
      const input = document.getElementById('handle-input-0');
      if (input) input.value = val;
    }, prevInputVal);

    // Dismiss onboarding tour with Escape key
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/driver-active/);
  });

  test('23. Runtime-matched Chrome User-Agent & Client Hints consistency across sessions, webviews, and OAuth popups (Issue #4)', async () => {
    const rendererUaCheck = await page.evaluate(() => {
      const { getOrCreateSlotWebview, getOrCreateThreadsSlotWebview } = require('./src/data/webview');
      const { getOrCreateDiscordWebview } = require('./src/data/discord');
      const bgContainer = document.getElementById('bg-webviews-container');
      const xWv = getOrCreateSlotWebview(0, bgContainer, []);
      const threadsWv = getOrCreateThreadsSlotWebview(0, bgContainer, []);
      const discordWv = getOrCreateDiscordWebview(bgContainer);
      const uaDataBrands =
        navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)
          ? navigator.userAgentData.brands
          : [];

      return {
        chromeVersion: process.versions.chrome,
        navigatorUa: navigator.userAgent,
        uaDataBrands,
        xWebviewUa: xWv ? xWv.getAttribute('useragent') : null,
        threadsWebviewUa: threadsWv ? threadsWv.getAttribute('useragent') : null,
        discordWebviewUa: discordWv ? discordWv.getAttribute('useragent') : null
      };
    });

    const expectedMajor = String(rendererUaCheck.chromeVersion).split('.')[0];
    expect(Number(expectedMajor)).toBeGreaterThanOrEqual(131);

    // 1. User-Agent must be a clean Chrome/<major>.0.0.0 UA without Electron or TheySay tokens
    expect(rendererUaCheck.navigatorUa).not.toContain('Electron/');
    expect(rendererUaCheck.navigatorUa).not.toContain('TheySay/');
    expect(rendererUaCheck.navigatorUa).toContain(`Chrome/${expectedMajor}.0.0.0`);

    // 2. Background webviews (X, Threads, Discord) must all match the runtime Chrome UA
    expect(rendererUaCheck.xWebviewUa).toBe(rendererUaCheck.navigatorUa);
    expect(rendererUaCheck.threadsWebviewUa).toBe(rendererUaCheck.navigatorUa);
    expect(rendererUaCheck.discordWebviewUa).toBe(rendererUaCheck.navigatorUa);

    // 3. Verify main process sessions and child OAuth popup window User-Agent / Sec-CH-UA / stealth consistency
    const http = require('http');
    const requests = {};
    const server = http.createServer((req, res) => {
      requests[req.url] = {
        userAgent: req.headers['user-agent'] || '',
        secChUa: req.headers['sec-ch-ua'] || '',
        secChUaMobile: req.headers['sec-ch-ua-mobile'] || '',
        secChUaPlatform: req.headers['sec-ch-ua-platform'] || ''
      };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (req.url === '/login') {
        res.end('<script>window.open("/oauth-popup", "_blank", "width=400,height=500");</script>');
      } else {
        res.end('<html><body>OAuth Popup</body></html>');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    let mainUaCheck;
    try {
      mainUaCheck = await electronApp.evaluate(
        async ({ app, BrowserWindow, session }, serverPort) => {
          const xSession = session.fromPartition('persist:x_session');
          const discordSession = session.fromPartition('persist:discord_session');
          const threadsSession = session.fromPartition('persist:threads_session');

          const testLoginWin = new BrowserWindow({
            show: false,
            webPreferences: {
              partition: 'persist:x_session',
              backgroundThrottling: false,
              disableBlinkFeatures: 'AutomationControlled'
            }
          });

          const popupLoaded = new Promise((resolve) => {
            testLoginWin.webContents.on('did-create-window', (childWin) => {
              childWin.webContents.once('did-finish-load', async () => {
                const childUa = childWin.webContents.getUserAgent();
                const childUaData = await childWin.webContents.executeJavaScript(`
                  (async () => {
                    const highEntropy = navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function'
                      ? await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion', 'formFactors'])
                      : null;
                    return {
                      ua: navigator.userAgent,
                      webdriver: navigator.webdriver,
                      uaData: navigator.userAgentData ? {
                        brands: navigator.userAgentData.brands,
                        mobile: navigator.userAgentData.mobile,
                        platform: navigator.userAgentData.platform
                      } : null,
                      highEntropy,
                      chromeKeys: window.chrome ? Object.keys(window.chrome) : []
                    };
                  })()
                `);
                childWin.destroy();
                resolve({ childUa, childUaData });
              });
            });
          });

          await testLoginWin.loadURL(`http://127.0.0.1:${serverPort}/login`);
          const { childUa: childWindowUa, childUaData } = await popupLoaded;
          const loginWindowUa = testLoginWin.webContents.getUserAgent();
          testLoginWin.destroy();

          return {
            fallbackUa: app.userAgentFallback,
            defaultSessionUa: session.defaultSession.getUserAgent(),
            xSessionUa: xSession.getUserAgent(),
            discordSessionUa: discordSession.getUserAgent(),
            threadsSessionUa: threadsSession.getUserAgent(),
            loginWindowUa,
            childWindowUa,
            childUaData
          };
        },
        port
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    expect(mainUaCheck.fallbackUa).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.defaultSessionUa).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.xSessionUa).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.discordSessionUa).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.threadsSessionUa).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.loginWindowUa).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.childWindowUa).toBe(rendererUaCheck.navigatorUa);

    const expectedPlatform =
      process.platform === 'win32'
        ? 'Windows'
        : process.platform === 'darwin'
          ? 'macOS'
          : 'Linux';
    if (process.platform === 'win32') {
      expect(rendererUaCheck.navigatorUa).toContain('Windows NT 10.0; Win64; x64');
    } else if (process.platform === 'darwin') {
      expect(rendererUaCheck.navigatorUa).toContain('Macintosh; Intel Mac OS X');
    } else {
      expect(rendererUaCheck.navigatorUa).toContain('X11; Linux');
    }

    // 4. Verify outgoing HTTP headers on both parent login window and child OAuth popup
    expect(requests['/login'].userAgent).toBe(rendererUaCheck.navigatorUa);
    expect(requests['/oauth-popup'].userAgent).toBe(rendererUaCheck.navigatorUa);
    expect(requests['/login'].secChUa).toContain(`"Google Chrome";v="${expectedMajor}"`);
    expect(requests['/login'].secChUa).toContain(`"Chromium";v="${expectedMajor}"`);
    expect(requests['/oauth-popup'].secChUa).toContain(`"Google Chrome";v="${expectedMajor}"`);
    expect(requests['/oauth-popup'].secChUaMobile).toBe('?0');
    expect(requests['/oauth-popup'].secChUaPlatform).toBe(`"${expectedPlatform}"`);

    // 5. Verify main-world JS identity inside the OAuth popup (Google BotGuard checks)
    expect(mainUaCheck.childUaData.ua).toBe(rendererUaCheck.navigatorUa);
    expect(mainUaCheck.childUaData.webdriver).toBe(false);
    expect(mainUaCheck.childUaData.uaData.mobile).toBe(false);
    expect(mainUaCheck.childUaData.uaData.platform).toBe(expectedPlatform);
    expect(mainUaCheck.childUaData.uaData.brands).toEqual(
      expect.arrayContaining([
        { brand: 'Chromium', version: expectedMajor },
        { brand: 'Google Chrome', version: expectedMajor }
      ])
    );
    expect(
      mainUaCheck.childUaData.uaData.brands.some((b) => /Electron/i.test(b.brand))
    ).toBe(false);
    expect(mainUaCheck.childUaData.highEntropy.uaFullVersion).toBe(rendererUaCheck.chromeVersion);
    expect(mainUaCheck.childUaData.highEntropy.fullVersionList).toEqual(
      expect.arrayContaining([
        { brand: 'Chromium', version: rendererUaCheck.chromeVersion },
        { brand: 'Google Chrome', version: rendererUaCheck.chromeVersion }
      ])
    );
    expect(mainUaCheck.childUaData.chromeKeys).toEqual(
      expect.arrayContaining(['app', 'csi', 'loadTimes', 'runtime'])
    );
  });

  test('24. Pin Post feature pins one or multiple posts below header, removes from timeline, supports collapse/popup/persistence, and restores on unpin', async () => {
    await page.evaluate(
      ({ handlesKey, cacheKey, onboardingKey }) => {
        localStorage.setItem(onboardingKey, '1');
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();
        const handles = ['threads:@zuck', '', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'th_post_1',
                text: 'First chronological post about Llama 4 open weights release',
                datetime: '2026-10-26T09:00:00.000Z',
                time: '2026-10-26T09:00:00.000Z',
                displayName: 'Mark Zuckerberg',
                userHandle: '@zuck',
                url: 'https://www.threads.com/@zuck/post/th_post_1',
                isPinned: false,
                isUnread: false,
                images: []
              },
              {
                id: 'th_post_2',
                text: 'Second chronological post in the middle of the timeline',
                datetime: '2026-10-26T10:00:00.000Z',
                time: '2026-10-26T10:00:00.000Z',
                displayName: 'Mark Zuckerberg',
                userHandle: '@zuck',
                url: 'https://www.threads.com/@zuck/post/th_post_2',
                isPinned: true,
                isUnread: false,
                images: []
              },
              {
                id: 'th_post_3',
                text: 'Third chronological post with $META update at the bottom',
                datetime: '2026-10-26T11:00:00.000Z',
                time: '2026-10-26T11:00:00.000Z',
                displayName: 'Mark Zuckerberg',
                userHandle: '@zuck',
                url: 'https://www.threads.com/@zuck/post/th_post_3',
                isPinned: false,
                isUnread: false,
                images: []
              }
            ]
          }
        };
        saveAllSlotCache(cache);
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY,
        onboardingKey: STORAGE_ONBOARDING_COMPLETED_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const pinnedContainer = page.locator('#slot-pinned-0');
    const timelineBubbles = page.locator('#slot-posts-list-0 .im-bubble');

    // Author's own isPinned:true post must NOT be auto-placed in the user pinned bar
    await expect(pinnedContainer).toBeHidden();
    await expect(timelineBubbles).toHaveCount(3);
    await expect(timelineBubbles.nth(0).locator('.im-text-content')).toContainText('First chronological post');
    await expect(timelineBubbles.nth(1).locator('.im-text-content')).toContainText('Second chronological post');
    await expect(timelineBubbles.nth(2).locator('.im-text-content')).toContainText('Third chronological post');

    // Pin the 1st and 3rd posts via the hover pin button (.im-btn-pin)
    await timelineBubbles.nth(0).locator('.im-btn-pin').dispatchEvent('click');
    await expect(pinnedContainer).toBeVisible();
    await expect(pinnedContainer.locator('.slot-pinned-item')).toHaveCount(1);
    await expect(timelineBubbles).toHaveCount(2);

    // Pin the remaining last post ("Third chronological post")
    await timelineBubbles.nth(1).locator('.im-btn-pin').dispatchEvent('click');
    await expect(pinnedContainer.locator('.slot-pinned-item')).toHaveCount(2);
    await expect(timelineBubbles).toHaveCount(1);
    await expect(timelineBubbles.nth(0).locator('.im-text-content')).toContainText('Second chronological post');

    // Verify geometry & bubble color inheritance: pinned bar is positioned right below the 28px header,
    // content padding-top increased, and pinned item background color matches chat bubble background color
    const layoutInfo = await page.evaluate(() => {
      const card = document.getElementById('slot-card-0');
      const header = card.querySelector('.slot-header');
      const pinned = document.getElementById('slot-pinned-0');
      const pinnedItem = pinned.querySelector('.slot-pinned-item');
      const bubble = document.querySelector('#slot-posts-list-0 .im-bubble');
      const content = document.getElementById('slot-content-0');
      return {
        hasPinnedClass: card.classList.contains('has-pinned-posts'),
        pinnedTopOffset: pinned.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
        paddingTopPx: parseFloat(window.getComputedStyle(content).paddingTop),
        pinnedBgColor: window.getComputedStyle(pinnedItem).backgroundColor,
        bubbleBgColor: window.getComputedStyle(bubble).backgroundColor
      };
    });
    expect(layoutInfo.hasPinnedClass).toBe(true);
    expect(Math.abs(layoutInfo.pinnedTopOffset)).toBeLessThanOrEqual(2);
    expect(layoutInfo.paddingTopPx).toBeGreaterThan(45);
    expect(layoutInfo.pinnedBgColor).toBe(layoutInfo.bubbleBgColor);

    // Clicking a pinned item opens the post detail popup modal
    await pinnedContainer.locator('.slot-pinned-item').nth(0).click();
    const overlay = page.locator('#tweet-popup-overlay');
    await expect(overlay).not.toHaveClass(/is-closed/);
    await expect(overlay.locator('.discord-popup-text')).toContainText('First chronological post');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveClass(/is-closed/);

    // Collapse the pinned bar into a single compact summary bar, then expand it back
    await pinnedContainer.locator('.slot-pinned-btn-collapse').first().click();
    const collapsedBar = pinnedContainer.locator('.slot-pinned-collapsed-bar');
    await expect(collapsedBar).toBeVisible();
    await expect(collapsedBar.locator('.slot-pinned-count')).toContainText('2');
    await collapsedBar.click();
    await expect(pinnedContainer.locator('.slot-pinned-item')).toHaveCount(2);

    // Reload and verify pinned posts and timeline exclusion persist in cache & profile export
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(pinnedContainer).toBeVisible();
    await expect(pinnedContainer.locator('.slot-pinned-item')).toHaveCount(2);
    await expect(timelineBubbles).toHaveCount(1);

    const exportedPinnedCheck = await page.evaluate(() => {
      const { buildProfileData } = require('./src/core/storage');
      const { getRegisteredSlots } = require('./src/ui/slot');
      const profile = buildProfileData(getRegisteredSlots());
      const slot0 = profile.slots && profile.slots[0];
      return {
        pinnedKeysCount: slot0 && Array.isArray(slot0.pinnedKeys) ? slot0.pinnedKeys.length : 0,
        pinnedPostsCount: slot0 && Array.isArray(slot0.pinnedPosts) ? slot0.pinnedPosts.length : 0
      };
    });
    expect(exportedPinnedCheck.pinnedKeysCount).toBe(2);
    expect(exportedPinnedCheck.pinnedPostsCount).toBe(2);

    // Unpin the first pinned post -> restores to the first position in chronological timeline
    await pinnedContainer.locator('.slot-pinned-btn-unpin').nth(0).click();
    await expect(pinnedContainer.locator('.slot-pinned-item')).toHaveCount(1);
    await expect(timelineBubbles).toHaveCount(2);
    await expect(timelineBubbles.nth(0).locator('.im-text-content')).toContainText('First chronological post');
    await expect(timelineBubbles.nth(1).locator('.im-text-content')).toContainText('Second chronological post');

    // Unpin the remaining pinned post -> pinned bar hides and all 3 posts are in chronological order
    await pinnedContainer.locator('.slot-pinned-btn-unpin').nth(0).click();
    await expect(pinnedContainer).toBeHidden();
    await expect(timelineBubbles).toHaveCount(3);
    await expect(timelineBubbles.nth(0).locator('.im-text-content')).toContainText('First chronological post');
    await expect(timelineBubbles.nth(1).locator('.im-text-content')).toContainText('Second chronological post');
    await expect(timelineBubbles.nth(2).locator('.im-text-content')).toContainText('Third chronological post');
  });

  test('25. SQLite (better-sqlite3) history storage retains all historical messages without 20/40 truncation and migrates legacy localStorage', async () => {
    // 1. Seed 35 Twitter posts (>20) and 55 Discord messages (>40) via SQLite storage
    await page.evaluate(
      ({ handlesKey, onboardingKey }) => {
        localStorage.setItem(onboardingKey, '1');
        const { clearAllPostCache, saveAllSlotCache } = require('./src/core/storage');
        clearAllPostCache();

        const handles = [
          'history_tw',
          'https://discord.com/channels/900001/900002',
          '',
          ''
        ];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const baseTime = Date.parse('2026-10-01T00:00:00.000Z');
        const twPosts = Array.from({ length: 35 }, (_, i) => ({
          id: String(800000 + i),
          text: `Twitter history post #${i}`,
          datetime: new Date(baseTime + i * 3600000).toISOString(),
          time: new Date(baseTime + i * 3600000).toISOString(),
          displayName: 'History Author',
          userHandle: '@history_tw',
          url: `https://x.com/history_tw/status/${800000 + i}`,
          isUnread: i >= 33,
          images: []
        }));

        const dcPosts = Array.from({ length: 55 }, (_, i) => ({
          id: String(900000 + i),
          source: 'discord',
          text: `Discord history message #${i}`,
          datetime: new Date(baseTime + i * 1800000).toISOString(),
          time: new Date(baseTime + i * 1800000).toISOString(),
          displayName: `Member${i % 3}`,
          url: `https://discord.com/channels/900001/900002/${900000 + i}`,
          isUnread: i === 54,
          images: []
        }));

        saveAllSlotCache({
          0: {
            handle: 'history_tw',
            source: 'twitter',
            displayName: 'History Author',
            userHandle: '@history_tw',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: twPosts
          },
          1: {
            handle: 'https://discord.com/channels/900001/900002',
            source: 'discord',
            sourceTitle: '#history-log',
            sourceSubtitle: 'ArchiveServer',
            displayName: '#history-log',
            userHandle: 'ArchiveServer',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: dcPosts
          }
        });
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        onboardingKey: STORAGE_ONBOARDING_COMPLETED_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    // All 35 Twitter posts and all 55 Discord messages must render without hiding older items
    const twBubbles = page.locator('#slot-posts-list-0 .im-bubble');
    const dcBubbles = page.locator('#slot-posts-list-1 .im-bubble');
    await expect(twBubbles).toHaveCount(35);
    await expect(twBubbles.nth(0).locator('.im-text-content')).toContainText('Twitter history post #0');
    await expect(twBubbles.nth(34).locator('.im-text-content')).toContainText('Twitter history post #34');
    await expect(page.locator('#slot-unread-badge-0')).toHaveText('2');

    await expect(dcBubbles).toHaveCount(55);
    await expect(dcBubbles.nth(0).locator('.im-text-content')).toContainText('Discord history message #0');
    await expect(dcBubbles.nth(54).locator('.im-text-content')).toContainText('Discord history message #54');
    await expect(page.locator('#slot-unread-badge-1')).toHaveText('1');

    // Verify SQLite file exists on disk in userData and localStorage is completely unused for message caches
    const dbFilePath = path.join(userDataDir, 'theysay.db');
    expect(fs.existsSync(dbFilePath)).toBe(true);

    const storageAudit = await page.evaluate(
      ({ cacheKey }) => {
        const { getHistoryDbStats } = require('./src/core/storage');
        return {
          localSlotCache: localStorage.getItem(cacheKey),
          localTargetCache: localStorage.getItem('theysay_target_cache'),
          stats: getHistoryDbStats()
        };
      },
      { cacheKey: STORAGE_CACHE_KEY }
    );
    expect(storageAudit.localSlotCache).toBeNull();
    expect(storageAudit.localTargetCache).toBeNull();
    expect(storageAudit.stats.postCount).toBe(90);
    expect(storageAudit.stats.slotCount).toBe(2);
    expect(storageAudit.stats.targetCount).toBe(2);

    // 2. Mark one unread Twitter bubble as read via hover (fast SQLite markTargetPostsRead) and verify reload persistence
    await twBubbles.nth(33).hover();
    await expect(page.locator('#slot-unread-badge-0')).toHaveText('1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#slot-unread-badge-0')).toHaveText('1');
    await expect(twBubbles).toHaveCount(35);

    // 3. Clearing slot 0 removes the slot binding while preserving all 35 historical posts in SQLite target archive
    const archiveCheck = await page.evaluate(() => {
      const { saveSlotCache, getSlotCache, getTargetCacheEntry } = require('./src/core/storage');
      saveSlotCache(0, null);
      const slotsAfterClear = getSlotCache();
      const archived = getTargetCacheEntry('history_tw', 'twitter');
      return {
        slot0Exists: Boolean(slotsAfterClear[0]),
        archivedCount: archived && Array.isArray(archived.posts) ? archived.posts.length : 0
      };
    });
    expect(archiveCheck.slot0Exists).toBe(false);
    expect(archiveCheck.archivedCount).toBe(35);

    // 4. Legacy localStorage -> SQLite one-time automatic migration
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const { clearAllPostCache } = require('./src/core/storage');
        clearAllPostCache();
        const handles = ['legacy_migrated', '', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            0: {
              handle: 'legacy_migrated',
              source: 'twitter',
              displayName: 'Legacy User',
              userHandle: '@legacy_migrated',
              avatarUrl: '',
              lastFetchedAt: Date.now(),
              posts: [
                {
                  id: '777001',
                  text: 'Migrated from legacy localStorage slot cache',
                  datetime: '2026-10-20T10:00:00.000Z',
                  time: '2026-10-20T10:00:00.000Z',
                  displayName: 'Legacy User',
                  userHandle: '@legacy_migrated',
                  url: 'https://x.com/legacy_migrated/status/777001',
                  isUnread: false,
                  images: []
                }
              ]
            }
          })
        );
        localStorage.setItem(
          'theysay_target_cache',
          JSON.stringify({
            'twitter:legacy_migrated': {
              handle: 'legacy_migrated',
              source: 'twitter',
              displayName: 'Legacy User',
              userHandle: '@legacy_migrated',
              posts: [
                {
                  id: '777000',
                  text: 'Older post migrated from legacy target cache',
                  datetime: '2026-10-19T10:00:00.000Z',
                  time: '2026-10-19T10:00:00.000Z',
                  displayName: 'Legacy User',
                  userHandle: '@legacy_migrated',
                  url: 'https://x.com/legacy_migrated/status/777000',
                  isUnread: false,
                  images: []
                }
              ]
            }
          })
        );
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const migratedBubbles = page.locator('#slot-posts-list-0 .im-bubble');
    await expect(migratedBubbles).toHaveCount(2);
    await expect(migratedBubbles.nth(0).locator('.im-text-content')).toContainText(
      'Older post migrated from legacy target cache'
    );
    await expect(migratedBubbles.nth(1).locator('.im-text-content')).toContainText(
      'Migrated from legacy localStorage slot cache'
    );

    const postMigrationCheck = await page.evaluate(
      ({ cacheKey }) => ({
        localSlotCache: localStorage.getItem(cacheKey),
        localTargetCache: localStorage.getItem('theysay_target_cache')
      }),
      { cacheKey: STORAGE_CACHE_KEY }
    );
    expect(postMigrationCheck.localSlotCache).toBeNull();
    expect(postMigrationCheck.localTargetCache).toBeNull();
  });

  test('26. Horizontal drag swaps positions with target column block instead of pushing cards vertically', async () => {
    // 1. Unit-level verification of horizontal block-swap geometry & midpoint hysteresis
    const engineChecks = await page.evaluate(() => {
      const {
        computeAdjacentHorizontalBlockSwap,
        tryHorizontalBlockSwap,
        createHorizontalSwapEngineClass
      } = require('./src/ui/grid');

      const HorizontalEngine = createHorizontalSwapEngineClass(GridStack.Engine);

      // Case A: Tall card (1x2) at (0,0) swapped right onto two stacked 1x1 cards at (1,0) & (1,1)
      const nodesA = [
        { id: 'A', x: 0, y: 0, w: 1, h: 2 },
        { id: 'B', x: 0, y: 2, w: 1, h: 1 },
        { id: 'C', x: 1, y: 0, w: 1, h: 1 },
        { id: 'D', x: 1, y: 1, w: 1, h: 1 },
        { id: 'E', x: 1, y: 2, w: 1, h: 1 },
        { id: 'F', x: 2, y: 0, w: 1, h: 1 },
        { id: 'G', x: 2, y: 1, w: 1, h: 1 },
        { id: 'H', x: 2, y: 2, w: 1, h: 1 }
      ];
      const resA1 = tryHorizontalBlockSwap(nodesA, nodesA[0], 1, 3);
      const afterA1 = Object.fromEntries(nodesA.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
      // Fast jump back across two columns isn't needed here; jump right again to col 2
      const resA2 = tryHorizontalBlockSwap(nodesA, nodesA[0], 2, 3);
      const afterA2 = Object.fromEntries(nodesA.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));

      // Case B: Staggered/interlocked columns ([1x1, 1x2] vs [1x2, 1x1]) via HorizontalEngine.moveNode
      const engineB = new HorizontalEngine({
        column: 2,
        float: false,
        nodes: [
          { _id: 1, id: 'X', x: 0, y: 0, w: 1, h: 1 },
          { _id: 2, id: 'A', x: 0, y: 1, w: 1, h: 2 },
          { _id: 3, id: 'D', x: 1, y: 0, w: 1, h: 2 },
          { _id: 4, id: 'E', x: 1, y: 2, w: 1, h: 1 }
        ]
      });
      engineB.cacheRects(300, 200, 2, 2, 2, 2);
      const nodeB = engineB.nodes.find((n) => n.id === 'A');
      nodeB._moving = true;
      const movedB = engineB.moveNode(nodeB, {
        x: 1,
        y: 1,
        w: 1,
        h: 2,
        cellWidth: 300,
        cellHeight: 200,
        rect: { x: 182, y: 202, w: 296, h: 396 },
        resizing: false,
        pack: true
      });
      const afterB = Object.fromEntries(
        engineB.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }])
      );

      // Case C: Wide card (2x2) vs stacked 1x1 cards — midpoint hysteresis prevents early trigger & bounce-back
      const nodesC = [
        { id: 'C1', x: 0, y: 0, w: 1, h: 1, _rect: { x: 2, y: 2, w: 296, h: 196 } },
        { id: 'C2', x: 0, y: 1, w: 1, h: 1, _rect: { x: 2, y: 202, w: 296, h: 196 } },
        { id: 'W', x: 1, y: 0, w: 2, h: 2, _rect: { x: 302, y: 2, w: 596, h: 396 } }
      ];
      // Drag C1 right by 0.6 * cellWidth (< 1.0 * cellWidth midpoint for R=2) -> pending
      const resCPending = tryHorizontalBlockSwap(nodesC, nodesC[0], 1, 3, {
        cellWidth: 300,
        rect: { x: 182, y: 2, w: 296, h: 196 }
      });
      // Drag C1 right by 1.05 * cellWidth (> 1.0 * cellWidth midpoint) -> swapped
      const resCSwapped = tryHorizontalBlockSwap(nodesC, nodesC[0], 1, 3, {
        cellWidth: 300,
        rect: { x: 317, y: 2, w: 296, h: 196 }
      });
      const afterCSwap = Object.fromEntries(nodesC.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
      // Update cached rect after swap; staying at x=317 should NOT bounce back left
      nodesC[0]._rect = { x: 602, y: 2, w: 296, h: 196 };
      const resCNoBounce = tryHorizontalBlockSwap(nodesC, nodesC[0], 1, 3, {
        cellWidth: 300,
        rect: { x: 317, y: 2, w: 296, h: 196 }
      });

      // Case D: Interlocked pinwheel where a card strictly crosses splitX -> returns null
      const nodesD = [
        { id: 'A', x: 0, y: 0, w: 1, h: 2 },
        { id: 'W1', x: 1, y: 0, w: 2, h: 1 },
        { id: 'D', x: 1, y: 1, w: 1, h: 1 },
        { id: 'H', x: 2, y: 1, w: 1, h: 2 },
        { id: 'W2', x: 0, y: 2, w: 2, h: 1 }
      ];
      const planD = computeAdjacentHorizontalBlockSwap(nodesD, nodesD[0], 1, 3);

      return {
        resA1,
        afterA1,
        resA2,
        afterA2,
        movedB,
        afterB,
        resCPending,
        resCSwapped,
        afterCSwap,
        resCNoBounce,
        planD
      };
    });

    expect(engineChecks.resA1).toBe('swapped');
    expect(engineChecks.afterA1).toEqual({
      A: { x: 1, y: 0, w: 1, h: 2 },
      B: { x: 0, y: 2, w: 1, h: 1 },
      C: { x: 0, y: 0, w: 1, h: 1 },
      D: { x: 0, y: 1, w: 1, h: 1 },
      E: { x: 1, y: 2, w: 1, h: 1 },
      F: { x: 2, y: 0, w: 1, h: 1 },
      G: { x: 2, y: 1, w: 1, h: 1 },
      H: { x: 2, y: 2, w: 1, h: 1 }
    });
    expect(engineChecks.resA2).toBe('swapped');
    expect(engineChecks.afterA2).toEqual({
      A: { x: 2, y: 0, w: 1, h: 2 },
      B: { x: 0, y: 2, w: 1, h: 1 },
      C: { x: 0, y: 0, w: 1, h: 1 },
      D: { x: 0, y: 1, w: 1, h: 1 },
      E: { x: 1, y: 2, w: 1, h: 1 },
      F: { x: 1, y: 0, w: 1, h: 1 },
      G: { x: 1, y: 1, w: 1, h: 1 },
      H: { x: 2, y: 2, w: 1, h: 1 }
    });
    expect(engineChecks.movedB).toBe(true);
    expect(engineChecks.afterB).toEqual({
      X: { x: 1, y: 0, w: 1, h: 1 },
      A: { x: 1, y: 1, w: 1, h: 2 },
      D: { x: 0, y: 0, w: 1, h: 2 },
      E: { x: 0, y: 2, w: 1, h: 1 }
    });
    expect(engineChecks.resCPending).toBe('pending');
    expect(engineChecks.resCSwapped).toBe('swapped');
    expect(engineChecks.afterCSwap).toEqual({
      C1: { x: 2, y: 0, w: 1, h: 1 },
      C2: { x: 2, y: 1, w: 1, h: 1 },
      W: { x: 0, y: 0, w: 2, h: 2 }
    });
    expect(engineChecks.resCNoBounce).toBe('pending');
    expect(engineChecks.planD).toBeNull();

    // 2. End-to-end Electron drag test reproducing the 3x3 tall-card horizontal drag scenario
    const readGridPositions = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item'))
          .map((el) => ({
            slotIndex: parseInt(el.getAttribute('data-slot-index'), 10),
            x: el.gridstackNode.x,
            y: el.gridstackNode.y,
            w: el.gridstackNode.w,
            h: el.gridstackNode.h
          }))
          .sort((a, b) => a.slotIndex - b.slotIndex)
      );

    // Dismiss onboarding popover if running standalone
    const closeOnboardingBtn = page.locator('.driver-popover-close-btn');
    if (await closeOnboardingBtn.isVisible().catch(() => false)) {
      await closeOnboardingBtn.click();
    }

    await selectGridLayout(page, '3x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(9);
    await page.waitForTimeout(300);

    // Resize slot-0 (x=0, y=0) down to h=2, then close the overflowed slot at bottom of col 0
    const slot0Item = page.locator('.grid-stack-item[data-slot-index="0"]');
    await slot0Item.hover();
    const rh0 = slot0Item.locator('.ui-resizable-s');
    await expect(rh0).toBeVisible();
    const slot3Box = await page.locator('.grid-stack-item[data-slot-index="3"]').boundingBox();
    const rh0Box = await rh0.boundingBox();
    await page.mouse.move(rh0Box.x + rh0Box.width / 2, rh0Box.y + rh0Box.height / 2);
    await page.mouse.down();
    await page.mouse.move(rh0Box.x + rh0Box.width / 2, slot3Box.y + slot3Box.height - 8, { steps: 12 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect(slot0Item).toHaveAttribute('gs-h', '2');

    // Close the single overflow slot pushed past row 3 so the 3x3 grid is flush (8 cards total)
    const overflowSlot = page.locator('.grid-stack-item.is-grid-overflow').first();
    await expect(overflowSlot).toBeVisible();
    const overflowIdx = await overflowSlot.getAttribute('data-slot-index');
    await page.locator(`#btn-close-${overflowIdx}`).click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(8);
    await expect(page.locator('.grid-stack-item.is-grid-overflow')).toHaveCount(0);
    await page.waitForTimeout(300);

    const beforeDrag = await readGridPositions();
    const findAt = (list, x, y) => list.find((p) => p.x === x && p.y === y);
    const tallSlot = findAt(beforeDrag, 0, 0);
    const col0Bottom = findAt(beforeDrag, 0, 2);
    const col1Top = findAt(beforeDrag, 1, 0);
    const col1Mid = findAt(beforeDrag, 1, 1);
    const col1Bottom = findAt(beforeDrag, 1, 2);
    const col2Top = findAt(beforeDrag, 2, 0);
    const col2Mid = findAt(beforeDrag, 2, 1);
    const col2Bottom = findAt(beforeDrag, 2, 2);
    expect(tallSlot).toMatchObject({ slotIndex: 0, x: 0, y: 0, w: 1, h: 2 });
    expect(col0Bottom).toBeTruthy();
    expect(col1Top).toBeTruthy();
    expect(col1Mid).toBeTruthy();
    expect(col1Bottom).toBeTruthy();

    // Drag the tall card (slot-0) horizontally right by 1 column onto column 1
    // (grabbing the empty header drag region to the right of the handle input)
    const handleTall = page.locator(`.grid-stack-item[data-slot-index="${tallSlot.slotIndex}"] .slot-drag-handle`);
    const targetCol1 = page.locator(`.grid-stack-item[data-slot-index="${col1Top.slotIndex}"]`);
    const hbTall = await handleTall.boundingBox();
    const tbCol1 = await targetCol1.boundingBox();
    const dragStartX = hbTall.x + hbTall.width - 56;
    const dragStartY = hbTall.y + hbTall.height / 2;
    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragStartX + 16, dragStartY, { steps: 3 });
    await page.mouse.move(dragStartX + tbCol1.width, dragStartY, { steps: 14 });
    await page.waitForTimeout(350);
    await page.mouse.up();
    await page.waitForTimeout(450);

    const afterRightDrag = await readGridPositions();
    expect(afterRightDrag.find((p) => p.slotIndex === tallSlot.slotIndex)).toMatchObject({
      x: 1,
      y: 0,
      w: 1,
      h: 2
    });
    // Both stacked cards from column 1 swapped into column 0's top two rows
    expect(afterRightDrag.find((p) => p.slotIndex === col1Top.slotIndex)).toMatchObject({
      x: 0,
      y: 0,
      w: 1,
      h: 1
    });
    expect(afterRightDrag.find((p) => p.slotIndex === col1Mid.slotIndex)).toMatchObject({
      x: 0,
      y: 1,
      w: 1,
      h: 1
    });
    // Bottom row and column 2 cards were NOT pushed up or down
    expect(afterRightDrag.find((p) => p.slotIndex === col0Bottom.slotIndex)).toMatchObject({ x: 0, y: 2 });
    expect(afterRightDrag.find((p) => p.slotIndex === col1Bottom.slotIndex)).toMatchObject({ x: 1, y: 2 });
    expect(afterRightDrag.find((p) => p.slotIndex === col2Top.slotIndex)).toMatchObject({ x: 2, y: 0 });
    expect(afterRightDrag.find((p) => p.slotIndex === col2Mid.slotIndex)).toMatchObject({ x: 2, y: 1 });
    expect(afterRightDrag.find((p) => p.slotIndex === col2Bottom.slotIndex)).toMatchObject({ x: 2, y: 2 });
    await expect(page.locator('.grid-stack-item.is-grid-overflow')).toHaveCount(0);

    // Reverse: drag the shorter second card (now at x=0, y=1) horizontally right onto the tall card at col 1
    const handleCol0Mid = page.locator(`.grid-stack-item[data-slot-index="${col1Mid.slotIndex}"] .slot-drag-handle`);
    const targetTall = page.locator(`.grid-stack-item[data-slot-index="${tallSlot.slotIndex}"]`);
    const hbMid = await handleCol0Mid.boundingBox();
    const tbTall = await targetTall.boundingBox();
    const revStartX = hbMid.x + hbMid.width - 56;
    const revStartY = hbMid.y + hbMid.height / 2;
    await page.mouse.move(revStartX, revStartY);
    await page.mouse.down();
    await page.mouse.move(revStartX + 16, revStartY, { steps: 3 });
    await page.mouse.move(revStartX + tbTall.width, revStartY, { steps: 14 });
    await page.waitForTimeout(350);
    await page.mouse.up();
    await page.waitForTimeout(450);

    const afterReverseDrag = await readGridPositions();
    expect(afterReverseDrag).toEqual(beforeDrag);
    await expect(page.locator('.grid-stack-item.is-grid-overflow')).toHaveCount(0);

    // Undo reverts the reverse drag back to afterRightDrag in a single Cmd/Ctrl+Z step
    const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    await page.keyboard.press(undoShortcut);
    await expect.poll(() => readGridPositions()).toEqual(afterRightDrag);

    // Restore 2x2 cleanly
    await selectGridLayout(page, '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
  });

  test('27. Empty grid area displays a plus (+) button that adds a new panel, persists across reload, and supports undo/redo', async () => {
    // 1. Unit-level checks for computeEmptyGridRegions
    const regionChecks = await page.evaluate(() => {
      const { computeEmptyGridRegions } = require('./src/ui/grid');

      // Full 2x2 grid -> no empty regions
      const full2x2 = computeEmptyGridRegions(
        [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 1, y: 0, w: 1, h: 1 },
          { x: 0, y: 1, w: 1, h: 1 },
          { x: 1, y: 1, w: 1, h: 1 }
        ],
        2,
        2
      );

      // 3x4 asymmetric grid with only bottom-left (0, 2) empty (matches user layout)
      const singleEmpty3x4 = computeEmptyGridRegions(
        [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 0, y: 1, w: 1, h: 1 },
          { x: 1, y: 0, w: 1, h: 2 },
          { x: 1, y: 2, w: 1, h: 1 },
          { x: 2, y: 0, w: 1, h: 1 },
          { x: 2, y: 1, w: 1, h: 1 },
          { x: 2, y: 2, w: 1, h: 1 },
          { x: 3, y: 0, w: 1, h: 2 },
          { x: 3, y: 2, w: 1, h: 1 }
        ],
        3,
        4
      );

      // Column 0 has two stacked empty cells (0, 1) & (0, 2) -> merged into one vertical 1x2 region
      const verticalRun = computeEmptyGridRegions(
        [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 1, y: 0, w: 1, h: 3 }
        ],
        3,
        2
      );

      // Adjacent columns with empty bottom cells -> one button per column
      const horizontalEmpty = computeEmptyGridRegions(
        [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 1, y: 0, w: 1, h: 1 }
        ],
        2,
        2
      );

      // Overflow card below configured rows must not create empty regions in overflow rows
      const withOverflow = computeEmptyGridRegions(
        [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 1, y: 0, w: 1, h: 1 },
          { x: 2, y: 0, w: 1, h: 2 },
          { x: 0, y: 1, w: 1, h: 1 },
          { x: 1, y: 1, w: 1, h: 1 },
          { x: 2, y: 2, w: 1, h: 1 }
        ],
        2,
        3
      );

      return { full2x2, singleEmpty3x4, verticalRun, horizontalEmpty, withOverflow };
    });

    expect(regionChecks.full2x2).toEqual([]);
    expect(regionChecks.singleEmpty3x4).toEqual([{ x: 0, y: 2, w: 1, h: 1 }]);
    expect(regionChecks.verticalRun).toEqual([{ x: 0, y: 1, w: 1, h: 2 }]);
    expect(regionChecks.horizontalEmpty).toEqual([
      { x: 0, y: 1, w: 1, h: 1 },
      { x: 1, y: 1, w: 1, h: 1 }
    ]);
    expect(regionChecks.withOverflow).toEqual([]);

    // Dismiss onboarding popover if running standalone
    const closeOnboardingBtn = page.locator('.driver-popover-close-btn');
    if (await closeOnboardingBtn.isVisible().catch(() => false)) {
      await closeOnboardingBtn.click();
    }

    // 2. End-to-end Electron flow in 3x4 grid
    await selectGridLayout(page, '3x4');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(12);
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(0);

    // Close bottom-left slot (x=0, y=2 -> slot 8) -> single '+' appears at (0, 2)
    await page.locator('#btn-close-8').click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(11);
    const addBtn02 = page.locator('.grid-empty-slot-btn[data-empty-x="0"][data-empty-y="2"]');
    await expect(addBtn02).toBeVisible();
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(1);
    await expect(addBtn02).toHaveAttribute('data-empty-w', '1');
    await expect(addBtn02).toHaveAttribute('data-empty-h', '1');

    // Close (0, 1) (slot 4) as well -> column 0 now has one contiguous 1x2 empty area at (0, 1..2)
    await page.locator('#btn-close-4').click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(10);
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(1);
    const addBtn01Tall = page.locator('.grid-empty-slot-btn[data-empty-x="0"][data-empty-y="1"]');
    await expect(addBtn01Tall).toBeVisible();
    await expect(addBtn01Tall).toHaveAttribute('data-empty-h', '2');

    // Click '+' on the 1x2 empty area -> adds a fresh blank 1x1 panel at (0, 1), focuses its input,
    // and leaves a single '+' at (0, 2)
    await addBtn01Tall.click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(11);
    const addedAt01 = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item'));
      const item = items.find((el) => el.gridstackNode && el.gridstackNode.x === 0 && el.gridstackNode.y === 1);
      if (!item) return null;
      const idx = parseInt(item.getAttribute('data-slot-index'), 10);
      const input = document.getElementById(`handle-input-${idx}`);
      return {
        slotIndex: idx,
        x: item.gridstackNode.x,
        y: item.gridstackNode.y,
        w: item.gridstackNode.w,
        h: item.gridstackNode.h,
        inputVal: input ? input.value : null,
        isFocused: Boolean(input && document.activeElement === input)
      };
    });
    expect(addedAt01).toMatchObject({
      x: 0,
      y: 1,
      w: 1,
      h: 1,
      inputVal: '',
      isFocused: true
    });
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(1);
    await expect(addBtn02).toBeVisible();

    // Reload and verify the 11-card layout + remaining '+' at (0, 2) persist cleanly
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(11);
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(1);
    await expect(page.locator('.grid-empty-slot-btn[data-empty-x="0"][data-empty-y="2"]')).toBeVisible();

    // Click the remaining '+' at (0, 2) -> fills the 12th panel and removes all '+' buttons
    await page.locator('.grid-empty-slot-btn[data-empty-x="0"][data-empty-y="2"]').click();
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(12);
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(0);

    // Blur focused input, then test Cmd/Ctrl+Z Undo and Cmd/Ctrl+Shift+Z Redo
    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    });
    const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

    await page.keyboard.press(undoShortcut);
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(11);
    await expect(page.locator('.grid-empty-slot-btn[data-empty-x="0"][data-empty-y="2"]')).toBeVisible();

    await page.keyboard.press(redoShortcut);
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(12);
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(0);

    // Restore 2x2 cleanly
    await selectGridLayout(page, '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    await expect(page.locator('.grid-empty-slot-btn')).toHaveCount(0);
  });

  test('28. Tweet embed click exclusion: avatar/name/links/quoted cards open externally while plain text, blank space, Show more, and Copy link stay in-place', async () => {
    const result = await page.evaluate(async () => {
      const { shell } = require('electron');
      const origOpenExternal = shell.openExternal;
      const openedUrls = [];
      shell.openExternal = (url) => {
        openedUrls.push(url);
        return Promise.resolve();
      };

      const prevMock = window.__THEYSAY_MOCK_TWEET_DATA;
      const iframe = document.createElement('iframe');
      try {
        window.__THEYSAY_MOCK_TWEET_DATA = {
          '2000000000000000001': {
            id: '2000000000000000001',
            text: '$SOXL full expanded note_tweet body text without leaving the app.',
            codePointLength: 64,
            entities: null,
            images: []
          }
        };

        iframe.style.width = '650px';
        iframe.style.height = '600px';
        document.body.appendChild(iframe);

        const frameWin = iframe.contentWindow;
        const frameDoc = iframe.contentDocument;
        frameDoc.open();
        frameDoc.write(`<!doctype html><html><head><meta charset="utf-8"></head><body>
          <div id="app">
            <article role="article" id="main-article">
              <div id="blank-space" style="height:20px;"></div>
              <div id="header">
                <a id="avatar-link" href="https://twitter.com/BeardoTrader?ref_src=twsrc%5Etfw&s=20">
                  <img id="avatar-img" alt="Beardo" />
                </a>
                <a id="name-link" href="https://twitter.com/BeardoTrader?ref_src=twsrc%5Etfw">
                  <span id="name-span">Beardo</span>
                </a>
                <a id="handle-link" href="https://twitter.com/BeardoTrader?ref_url=https%3A%2F%2Fexample.com">
                  <span id="handle-span">@BeardoTrader</span>
                </a>
                <a id="follow-link" href="https://twitter.com/intent/follow?screen_name=BeardoTrader&ref_src=twsrc%5Etfw">Follow</a>
                <a id="x-logo-link" href="https://twitter.com/BeardoTrader/status/2000000000000000001?ref_src=twsrc%5Etfw">X</a>
              </div>
              <div data-testid="tweetText" id="main-text">
                <a id="cashtag-link" href="https://twitter.com/search?q=%24SOXL&src=cashtag_click&s=20"><span>$SOXL</span></a>
                <span id="plain-text"> trying to set the record today for its largest total drawdown in history.</span>
                <a id="inline-url" href="https://example.com/report?ref_src=twsrc%5Etfw">example.com/report</a>
                <a id="show-more" data-testid="tweet-text-show-more-link" href="https://x.com/BeardoTrader/status/2000000000000000001">Show more</a>
              </div>
              <a id="photo-link" href="https://twitter.com/BeardoTrader/status/2000000000000000001/photo/1?s=20">
                <img id="photo-img" alt="chart" />
              </a>
              <article role="article" id="quoted-article">
                <a href="https://twitter.com/QuotedUser/status/2000000000000000002?ref_src=twsrc%5Etfw"></a>
                <div id="quoted-author">QuotedUser</div>
                <div data-testid="tweetText" id="quoted-text"><span>Quoted post content</span></div>
              </article>
              <div id="footer">
                <a id="timestamp-link" href="https://twitter.com/BeardoTrader/status/2000000000000000001?ref_src=twsrc%5Etfw">4:32 AM · Nov 25, 2026</a>
                <div id="copy-link-btn" role="button">Copy link to post</div>
                <div id="anchorless-pivot" role="link">Community Note</div>
                <a id="replies-link" href="https://twitter.com/BeardoTrader/status/2000000000000000001?ref_src=twsrc%5Etfw">Read 78 replies</a>
              </div>
            </article>
          </div>
        </body></html>`);
        frameDoc.close();

        window.__theysayInitEmbedFrame(frameWin, frameDoc);

        let copyLinkClicks = 0;
        frameDoc.getElementById('copy-link-btn').addEventListener('click', () => {
          copyLinkClicks += 1;
        });
        frameDoc.getElementById('anchorless-pivot').addEventListener('click', () => {
          frameWin.open('https://x.com/i/birdwatch/n/123?ref_src=twsrc%5Etfw');
        });

        const waitTick = () => new Promise((r) => setTimeout(r, 25));
        const clickEl = async (el) => {
          el.dispatchEvent(
            new frameWin.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, detail: 1 })
          );
          el.dispatchEvent(
            new frameWin.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, detail: 1 })
          );
          await waitTick();
        };

        // Check computed cursors
        const cursors = {
          blank: frameWin.getComputedStyle(frameDoc.getElementById('blank-space')).cursor,
          plainText: frameWin.getComputedStyle(frameDoc.getElementById('plain-text')).cursor,
          avatar: frameWin.getComputedStyle(frameDoc.getElementById('avatar-img')).cursor,
          name: frameWin.getComputedStyle(frameDoc.getElementById('name-span')).cursor,
          cashtag: frameWin.getComputedStyle(frameDoc.getElementById('cashtag-link')).cursor,
          quotedText: frameWin.getComputedStyle(frameDoc.getElementById('quoted-text')).cursor,
          copyBtn: frameWin.getComputedStyle(frameDoc.getElementById('copy-link-btn')).cursor
        };

        // 1. Clicking plain text & blank background must NOT open external browser
        await clickEl(frameDoc.getElementById('plain-text'));
        await clickEl(frameDoc.getElementById('blank-space'));
        const afterExcludedCount = openedUrls.length;

        // 2. Clicking avatar, name, handle, follow, X logo, photo, inline links, timestamp, replies, quoted tweet all open cleanly
        await clickEl(frameDoc.getElementById('avatar-img'));
        await clickEl(frameDoc.getElementById('name-span'));
        await clickEl(frameDoc.getElementById('handle-span'));
        await clickEl(frameDoc.getElementById('follow-link'));
        await clickEl(frameDoc.getElementById('x-logo-link'));
        await clickEl(frameDoc.getElementById('cashtag-link'));
        await clickEl(frameDoc.getElementById('inline-url'));
        await clickEl(frameDoc.getElementById('photo-img'));
        await clickEl(frameDoc.getElementById('quoted-text'));
        await clickEl(frameDoc.getElementById('timestamp-link'));
        await clickEl(frameDoc.getElementById('replies-link'));
        await clickEl(frameDoc.getElementById('anchorless-pivot'));

        // 3. Copy link button triggers native handler without opening external browser
        const beforeCopyCount = openedUrls.length;
        await clickEl(frameDoc.getElementById('copy-link-btn'));
        const afterCopyCount = openedUrls.length;

        // 4. Dragging across a link must NOT open it, while clicking avatar after selecting plain text DOES open it
        const beforeDragCount = openedUrls.length;
        const cashtagEl = frameDoc.getElementById('cashtag-link');
        cashtagEl.dispatchEvent(
          new frameWin.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, detail: 1 })
        );
        cashtagEl.dispatchEvent(
          new frameWin.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 90, clientY: 10, detail: 1 })
        );
        await waitTick();
        const afterDragCount = openedUrls.length;

        // Select plain text, then click avatar -> should still open avatar profile!
        const range = frameDoc.createRange();
        range.selectNodeContents(frameDoc.getElementById('plain-text'));
        const sel = frameWin.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        await clickEl(frameDoc.getElementById('avatar-img'));
        const afterSelectThenAvatarCount = openedUrls.length;

        // 5. Clicking "Show more" expands full text in-place without opening external browser
        const beforeShowMoreCount = openedUrls.length;
        await clickEl(frameDoc.getElementById('show-more'));
        await new Promise((r) => setTimeout(r, 80));
        const afterShowMoreCount = openedUrls.length;
        const expandedText = frameDoc.getElementById('main-text').textContent;

        return {
          cursors,
          afterExcludedCount,
          openedUrls,
          copyLinkClicks,
          beforeCopyCount,
          afterCopyCount,
          beforeDragCount,
          afterDragCount,
          afterSelectThenAvatarCount,
          beforeShowMoreCount,
          afterShowMoreCount,
          expandedText
        };
      } finally {
        shell.openExternal = origOpenExternal;
        window.__THEYSAY_MOCK_TWEET_DATA = prevMock;
        iframe.remove();
      }
    });

    expect(result.cursors).toEqual({
      blank: 'default',
      plainText: 'text',
      avatar: 'pointer',
      name: 'pointer',
      cashtag: 'pointer',
      quotedText: 'pointer',
      copyBtn: 'pointer'
    });
    expect(result.afterExcludedCount).toBe(0);
    expect(result.openedUrls.slice(0, 12)).toEqual([
      'https://twitter.com/BeardoTrader',
      'https://twitter.com/BeardoTrader',
      'https://twitter.com/BeardoTrader',
      'https://twitter.com/intent/follow?screen_name=BeardoTrader',
      'https://twitter.com/BeardoTrader/status/2000000000000000001',
      'https://twitter.com/search?q=%24SOXL&src=cashtag_click',
      'https://example.com/report',
      'https://twitter.com/BeardoTrader/status/2000000000000000001/photo/1',
      'https://twitter.com/QuotedUser/status/2000000000000000002',
      'https://twitter.com/BeardoTrader/status/2000000000000000001',
      'https://twitter.com/BeardoTrader/status/2000000000000000001',
      'https://x.com/i/birdwatch/n/123'
    ]);
    expect(result.copyLinkClicks).toBe(1);
    expect(result.afterCopyCount).toBe(result.beforeCopyCount);
    expect(result.afterDragCount).toBe(result.beforeDragCount);
    expect(result.afterSelectThenAvatarCount).toBe(result.afterDragCount + 1);
    expect(result.openedUrls[result.openedUrls.length - 1]).toBe('https://twitter.com/BeardoTrader');
    expect(result.afterShowMoreCount).toBe(result.beforeShowMoreCount);
    expect(result.expandedText).toContain('$SOXL full expanded note_tweet body text');

    // Also verify TwitterFallbackCard & ThreadsPopupCard author avatar/name open profile URL on click
    const fallbackProfileUrls = await page.evaluate(async () => {
      const { shell } = require('electron');
      const { openPostPopup, closePostPopup } = require('./src/ui/popup');
      const origOpenExternal = shell.openExternal;
      const urls = [];
      shell.openExternal = (url) => {
        urls.push(url);
        return Promise.resolve();
      };
      try {
        openPostPopup({
          id: '998877665544332299',
          source: 'twitter',
          displayName: 'Beardo',
          userHandle: '@BeardoTrader',
          text: 'Fallback card header profile click test.',
          time: '4:32 AM',
          url: 'https://x.com/BeardoTrader/status/998877665544332299',
          isMemberOnly: true
        });
        await new Promise((r) => setTimeout(r, 50));
        const twCard = document.querySelector('.tweet-embed-slot.is-active .tweet-popup-fallback');
        twCard.querySelector('.tweet-popup-fallback-avatar').click();
        twCard.querySelector('.tweet-popup-fallback-name').click();

        openPostPopup({
          id: 'threads_99887766',
          source: 'threads',
          displayName: 'Mark Zuckerberg',
          userHandle: '@zuck',
          text: 'Threads header profile click test.',
          time: '4:32 AM',
          url: 'https://www.threads.com/@zuck/post/ABC123'
        });
        await new Promise((r) => setTimeout(r, 50));
        const thCard = document.querySelector('.tweet-embed-slot.is-active .threads-popup-card');
        thCard.querySelector('.discord-popup-avatar').click();
        thCard.querySelector('.discord-popup-name').click();

        closePostPopup();
        return urls;
      } finally {
        shell.openExternal = origOpenExternal;
      }
    });
    expect(fallbackProfileUrls).toEqual([
      'https://x.com/BeardoTrader',
      'https://x.com/BeardoTrader',
      'https://www.threads.com/@zuck',
      'https://www.threads.com/@zuck'
    ]);
  });
});



