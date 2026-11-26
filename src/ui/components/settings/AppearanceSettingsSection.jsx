import React, { useState, useEffect } from 'react';
import {
  Paper,
  ColorSwatch,
  Button,
  TextInput,
  ThemeIcon,
  SegmentedControl,
  Badge
} from '@mantine/core';
import {
  IconLayoutNavbar,
  IconPalette,
  IconMessageCircle,
  IconInfoCircle,
  IconBellOff,
  IconRefresh,
  IconBrandX,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconSparkles
} from '@tabler/icons-react';
import {
  THEME_PALETTES_BY_MODE,
  HEADER_PRESETS_BY_MODE,
  CHAT_BG_PRESETS_BY_MODE,
  BUBBLE_BG_PRESETS_BY_MODE,
  TICKER_PRESETS
} from '../theme';
import { t } from '../../../core/i18n';

const HEX_INPUT_CLASS_NAMES = {
  root: 'mantine-ticker-hex-root',
  input: 'ticker-hex-input'
};

function readDomThemeState() {
  if (typeof document === 'undefined' || !document.documentElement) {
    return { effectiveTheme: 'light', themePreference: 'light', lang: 'zh' };
  }
  const root = document.documentElement;
  const effectiveTheme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const rawPref = root.getAttribute('data-theme-preference');
  const themePreference =
    rawPref === 'dark' || rawPref === 'light' || rawPref === 'system'
      ? rawPref
      : effectiveTheme;
  const lang = (root.getAttribute('lang') || 'zh').toLowerCase().startsWith('en')
    ? 'en'
    : 'zh';
  return { effectiveTheme, themePreference, lang };
}

function ColorField({
  labelI18n,
  labelText,
  colorId,
  hexId,
  defaultValue,
  titleI18n,
  titleText,
  ariaI18n,
  ariaText
}) {
  return (
    <div className="settings-color-field">
      <span className="color-sub-label" data-i18n={labelI18n}>
        {labelText}
      </span>
      <input
        type="color"
        id={colorId}
        className="ticker-color-input"
        defaultValue={defaultValue}
        data-i18n-title={titleI18n}
        title={titleText}
      />
      <TextInput
        type="text"
        id={hexId}
        size="xs"
        defaultValue={defaultValue}
        maxLength={7}
        spellCheck={false}
        data-i18n-aria-label={ariaI18n}
        aria-label={ariaText}
        classNames={HEX_INPUT_CLASS_NAMES}
      />
    </div>
  );
}

export function AppearanceSettingsSection() {
  const [domState, setDomState] = useState(readDomThemeState);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const sync = () => setDomState(readDomThemeState());
    sync();

    let observer = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(sync);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-theme-preference', 'lang']
      });
    }
    window.addEventListener('theysay:theme-changed', sync);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('theysay:theme-changed', sync);
    };
  }, []);

  const { effectiveTheme, themePreference, lang } = domState;
  const isDark = effectiveTheme === 'dark';
  const isEn = lang === 'en';

  const modePalettes = THEME_PALETTES_BY_MODE[effectiveTheme] || THEME_PALETTES_BY_MODE.light;
  const chatBgPresets = CHAT_BG_PRESETS_BY_MODE[effectiveTheme] || CHAT_BG_PRESETS_BY_MODE.light;
  const bubbleBgPresets = BUBBLE_BG_PRESETS_BY_MODE[effectiveTheme] || BUBBLE_BG_PRESETS_BY_MODE.light;
  const headerPresets = HEADER_PRESETS_BY_MODE[effectiveTheme] || HEADER_PRESETS_BY_MODE.light;

  const handleThemeModeChange = (nextMode) => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__THEYSAY_ON_THEME_MODE_CHANGE === 'function'
    ) {
      window.__THEYSAY_ON_THEME_MODE_CHANGE(nextMode);
    }
  };

  const handlePaletteSelect = (paletteId) => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__THEYSAY_ON_THEME_PALETTE_SELECT === 'function'
    ) {
      window.__THEYSAY_ON_THEME_PALETTE_SELECT(paletteId);
    }
  };

  const modeBadgeLabel = isDark
    ? isEn
      ? 'Dark Mode'
      : '深色模式'
    : isEn
      ? 'Light Mode'
      : '浅色模式';

  const paletteSubtitleText = isDark
    ? isEn
      ? 'Editing Dark Mode palette'
      : '当前正在编辑：深色模式配色'
    : isEn
      ? 'Editing Light Mode palette'
      : '当前正在编辑：浅色模式配色';

  return (
    <div className="settings-section">
      <div className="settings-section-header-row">
        <div
          className="settings-section-title"
          data-i18n="settings.sectionAppearance"
        >
          外观
        </div>
        <Badge
          id="setting-appearance-mode-badge"
          size="xs"
          variant="light"
          color={isDark ? 'indigo' : 'blue'}
          radius="xl"
          className="appearance-mode-badge"
        >
          {modeBadgeLabel}
        </Badge>
      </div>
      <Paper className="settings-group" radius="md" withBorder={false}>
        {/* 主题模式 (浅色 / 深色 / 跟随系统) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color={isDark ? 'indigo' : 'yellow'}
              size={28}
              radius="md"
              className="platform-icon theme-mode-icon"
            >
              {themePreference === 'system' ? (
                <IconDeviceDesktop size={14} stroke={2.1} />
              ) : isDark ? (
                <IconMoon size={14} stroke={2.1} />
              ) : (
                <IconSun size={14} stroke={2.1} />
              )}
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.themeModeLabel"
              >
                主题模式
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.themeModeSubtitle"
              >
                浅色与深色模式各自独立保存配色
              </div>
            </div>
          </div>
          <SegmentedControl
            id="setting-theme-mode"
            size="xs"
            radius="md"
            value={themePreference}
            onChange={handleThemeModeChange}
            className="theme-mode-segmented"
            data={[
              {
                value: 'light',
                label: (
                  <span className="theme-mode-segment-label" data-theme-option="light">
                    <IconSun size={12.5} stroke={2.1} />
                    <span>{isEn ? 'Light' : '浅色'}</span>
                  </span>
                )
              },
              {
                value: 'dark',
                label: (
                  <span className="theme-mode-segment-label" data-theme-option="dark">
                    <IconMoon size={12.5} stroke={2.1} />
                    <span>{isEn ? 'Dark' : '深色'}</span>
                  </span>
                )
              },
              {
                value: 'system',
                label: (
                  <span className="theme-mode-segment-label" data-theme-option="system">
                    <IconDeviceDesktop size={12.5} stroke={2.1} />
                    <span>{isEn ? 'System' : '跟随系统'}</span>
                  </span>
                )
              }
            ]}
          />
        </div>

        {/* 推荐主题方案 (按当前浅/深色模式展示成套配色包) */}
        <div className="settings-row settings-row-block settings-row-palettes">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="violet"
              size={28}
              radius="md"
              className="platform-icon palette-pack-theme"
            >
              <IconSparkles size={14} stroke={2.1} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.themePaletteLabel"
              >
                主题配色方案
              </div>
              <div
                id="setting-theme-palette-subtitle"
                className="settings-row-subtitle"
              >
                {paletteSubtitleText}
              </div>
            </div>
          </div>
          <div
            id="setting-theme-palettes"
            className="theme-palette-grid"
            data-mode={effectiveTheme}
          >
            {modePalettes.map((pack) => {
              const label = t(`settings.palette.${pack.id}`, {}, lang);
              return (
                <button
                  key={pack.id}
                  type="button"
                  className="theme-palette-card"
                  data-palette-id={pack.id}
                  data-chat-bg={pack.chatBg}
                  data-bubble-bg={pack.bubbleBg}
                  data-header-bg={pack.headerBg}
                  title={`${label} (${pack.chatBg} / ${pack.bubbleBg})`}
                  aria-label={label}
                  onClick={() => handlePaletteSelect(pack.id)}
                >
                  <span
                    className="theme-palette-swatch"
                    style={{ backgroundColor: pack.chatBg }}
                  >
                    <span
                      className="theme-palette-swatch-bar"
                      style={{ backgroundColor: pack.headerBg }}
                    />
                    <span className="theme-palette-swatch-bubbles">
                      <span
                        className="theme-palette-swatch-bubble is-wide"
                        style={{ backgroundColor: pack.bubbleBg }}
                      />
                      <span
                        className="theme-palette-swatch-bubble is-short"
                        style={{ backgroundColor: pack.bubbleBg }}
                      />
                    </span>
                  </span>
                  <span className="theme-palette-name">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 聊天背景配色 (Mantine ColorSwatch，按当前模式展示对应色板) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="indigo"
              size={28}
              radius="md"
              className="platform-icon chat-bg-theme"
            >
              <IconPalette size={14} stroke={2.1} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.chatBgColorLabel"
              >
                聊天背景配色
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.chatBgColorSubtitle"
              >
                卡片聊天区域底色
              </div>
            </div>
          </div>
          <div className="settings-color-inline-group">
            <div
              id="setting-chat-bg-presets"
              className="ticker-preset-list"
              data-mode={effectiveTheme}
            >
              {chatBgPresets.map((bg) => (
                <ColorSwatch
                  key={`${effectiveTheme}-${bg}`}
                  component="button"
                  type="button"
                  color={bg}
                  size={18}
                  radius="sm"
                  withShadow={false}
                  className="ticker-preset-chip chat-bg-preset-chip"
                  data-bg={bg}
                  style={{ backgroundColor: bg }}
                  title={bg}
                  aria-label={bg}
                />
              ))}
            </div>
            <span className="color-inline-divider"></span>
            <div className="settings-color-custom">
              <ColorField
                labelI18n="settings.customColor"
                labelText="自定义"
                colorId="setting-chat-bg-color"
                hexId="setting-chat-bg-hex"
                defaultValue={isDark ? '#0f1723' : '#f8f9fd'}
                titleI18n="settings.chatBgColorInputTitle"
                titleText="自定义聊天背景颜色"
                ariaI18n="settings.chatBgColorHexAria"
                ariaText="聊天背景色 Hex"
              />
            </div>
          </div>
        </div>

        {/* 消息气泡配色 (Mantine ColorSwatch，按当前模式展示对应色板) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="teal"
              size={28}
              radius="md"
              className="platform-icon bubble-bg-theme"
            >
              <IconMessageCircle size={14} stroke={2.1} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.bubbleBgColorLabel"
              >
                消息气泡配色
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.bubbleBgColorSubtitle"
              >
                聊天消息气泡底色
              </div>
            </div>
          </div>
          <div className="settings-color-inline-group">
            <div
              id="setting-bubble-bg-presets"
              className="ticker-preset-list"
              data-mode={effectiveTheme}
            >
              {bubbleBgPresets.map((bg) => (
                <ColorSwatch
                  key={`${effectiveTheme}-${bg}`}
                  component="button"
                  type="button"
                  color={bg}
                  size={18}
                  radius="sm"
                  withShadow={false}
                  className="ticker-preset-chip bubble-bg-preset-chip"
                  data-bg={bg}
                  style={{ backgroundColor: bg }}
                  title={bg}
                  aria-label={bg}
                />
              ))}
            </div>
            <span className="color-inline-divider"></span>
            <div className="settings-color-custom">
              <ColorField
                labelI18n="settings.customColor"
                labelText="自定义"
                colorId="setting-bubble-bg-color"
                hexId="setting-bubble-bg-hex"
                defaultValue={isDark ? '#172332' : '#ffffff'}
                titleI18n="settings.bubbleBgColorInputTitle"
                titleText="自定义消息气泡颜色"
                ariaI18n="settings.bubbleBgColorHexAria"
                ariaText="消息气泡色 Hex"
              />
            </div>
          </div>
        </div>

        {/* Title 栏背景配色 (Mantine ColorSwatch，按当前模式展示对应色板) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="brand"
              size={28}
              radius="md"
              className="platform-icon header-theme"
            >
              <IconLayoutNavbar size={14} stroke={2.1} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.headerColorLabel"
              >
                Title 栏配色
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.headerColorSubtitle"
              >
                卡片标题栏背景色
              </div>
            </div>
          </div>
          <div className="settings-color-inline-group">
            <div
              id="setting-header-presets"
              className="ticker-preset-list"
              data-mode={effectiveTheme}
            >
              {headerPresets.map((bg) => (
                <ColorSwatch
                  key={`${effectiveTheme}-${bg}`}
                  component="button"
                  type="button"
                  color={bg}
                  size={18}
                  radius="sm"
                  withShadow={false}
                  className="ticker-preset-chip header-preset-chip"
                  data-bg={bg}
                  style={{ backgroundColor: bg }}
                  title={bg}
                  aria-label={bg}
                />
              ))}
            </div>
            <span className="color-inline-divider"></span>
            <div className="settings-color-custom">
              <ColorField
                labelI18n="settings.customColor"
                labelText="自定义"
                colorId="setting-header-bg-color"
                hexId="setting-header-bg-hex"
                defaultValue={isDark ? '#0f1723' : '#f8f9fd'}
                titleI18n="settings.headerColorInputTitle"
                titleText="自定义 Title 栏背景颜色"
                ariaI18n="settings.headerColorHexAria"
                ariaText="Title 栏背景色 Hex"
              />
            </div>
          </div>
        </div>

        {/* Ticker 高亮配色 (Mantine ColorSwatch) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="yellow"
              size={28}
              radius="md"
              className="platform-icon ticker"
            >
              $
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.tickerHighlightLabel"
              >
                高亮显示 Ticker
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.tickerHighlightSubtitle"
              >
                自动高亮美股代码
              </div>
            </div>
          </div>
          <div className="settings-color-inline-group">
            <div id="setting-ticker-presets" className="ticker-preset-list">
              {TICKER_PRESETS.map(({ fg, bg }) => (
                <ColorSwatch
                  key={`${fg}-${bg}`}
                  component="button"
                  type="button"
                  color={bg}
                  size={18}
                  radius="sm"
                  withShadow={false}
                  className="ticker-preset-chip"
                  data-fg={fg}
                  data-bg={bg}
                  style={{ backgroundColor: bg }}
                  title={`${fg} / ${bg}`}
                  aria-label={`${fg} / ${bg}`}
                />
              ))}
            </div>
            <span className="color-inline-divider"></span>
            <div className="settings-color-custom">
              <ColorField
                labelI18n="settings.tickerFgLabel"
                labelText="文字"
                colorId="setting-ticker-fg-color"
                hexId="setting-ticker-fg-hex"
                defaultValue="#fde047"
                titleI18n="settings.tickerFgInputTitle"
                titleText="选择 Ticker 文字颜色"
                ariaI18n="settings.tickerFgHexAria"
                ariaText="Ticker 前景色 Hex"
              />
              <ColorField
                labelI18n="settings.tickerBgLabel"
                labelText="底色"
                colorId="setting-ticker-bg-color"
                hexId="setting-ticker-bg-hex"
                defaultValue="#422006"
                titleI18n="settings.tickerBgInputTitle"
                titleText="选择 Ticker 背景颜色"
                ariaI18n="settings.tickerBgHexAria"
                ariaText="Ticker 背景色 Hex"
              />
            </div>
          </div>
        </div>

        {/* 实时预览卡片 + 词库提示 */}
        <div className="settings-row settings-row-block">
          <div className="header-preview-card" id="setting-header-preview">
            <div className="header-preview-bar" id="setting-header-preview-bar">
              <span
                className="header-preview-avatar"
                data-i18n="settings.previewAvatar"
              >
                示
              </span>
              <span
                className="header-preview-name"
                id="setting-header-preview-name"
                data-i18n="settings.previewName"
              >
                示例账号
              </span>
              <span
                className="header-preview-handle"
                id="setting-header-preview-handle"
              >
                <IconBrandX size={12.5} stroke={2} />
              </span>
              <span
                className="header-preview-icon"
                id="setting-header-preview-icon"
              >
                <IconBellOff size={11} stroke={2.1} />
              </span>
            </div>
            <div className="header-preview-body" id="setting-ticker-preview">
              <div
                className="header-preview-bubble read"
                id="setting-bubble-preview-item"
              >
                <span id="setting-ticker-preview-text">
                  <span data-i18n="settings.previewPostPart1">关注 </span>
                  <span className="ticker-highlight ticker-preview-chip">
                    $NVDA
                  </span>
                  <span data-i18n="settings.previewPostPart2"> 与 </span>
                  <span className="ticker-highlight ticker-preview-chip">
                    AAPL
                  </span>
                  <span data-i18n="settings.previewPostPart3">
                    {' '}
                    财报表现，留意{' '}
                  </span>
                  <span className="ticker-highlight ticker-preview-chip">
                    qqq
                  </span>
                </span>
                <span className="header-preview-time">10:30 AM</span>
              </div>
            </div>
          </div>

          <div className="settings-tip ticker-sync-tip">
            <IconInfoCircle size={12} stroke={2} />
            <div className="ticker-sync-tip-body">
              <span id="setting-ticker-stats-text">
                支持 $ 符号识别及 NASDAQ 美股与 ETF 代码库自动匹配。
              </span>
              <Button
                type="button"
                id="btn-sync-tickers"
                variant="default"
                size="compact-xs"
                radius="sm"
                className="btn-tool btn-sync-tickers"
                data-i18n="settings.syncTickersBtn"
                data-i18n-title="settings.syncTickersTitle"
                title="从 NASDAQ 官方接口同步最新美股与 ETF 列表"
                leftSection={<IconRefresh size={11} stroke={2.2} />}
              >
                同步在线词库
              </Button>
            </div>
          </div>
        </div>
      </Paper>
    </div>
  );
}
