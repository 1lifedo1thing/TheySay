import { createTheme } from '@mantine/core';
import { THEME_PALETTE_PRESETS } from '../../core/constants';

export const mantineTheme = createTheme({
  primaryColor: 'brand',
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  colors: {
    brand: [
      '#e5f4ff',
      '#cde4ff',
      '#9bc8ff',
      '#64aaff',
      '#3890fe',
      '#1d9bf0',
      '#0984db',
      '#0071c4',
      '#0060ad',
      '#004e91'
    ]
  },
  components: {
    Button: {
      defaultProps: {
        size: 'compact-xs',
        radius: 'md'
      }
    },
    ActionIcon: {
      defaultProps: {
        variant: 'subtle',
        radius: 'md'
      }
    },
    CloseButton: {
      defaultProps: {
        variant: 'subtle',
        radius: 'md'
      }
    },
    Badge: {
      defaultProps: {
        radius: 'xl'
      }
    },
    ThemeIcon: {
      defaultProps: {
        variant: 'light',
        radius: 'md',
        size: 28
      }
    },
    NativeSelect: {
      defaultProps: {
        size: 'xs',
        radius: 'md'
      }
    },
    TextInput: {
      defaultProps: {
        size: 'xs',
        radius: 'md'
      }
    }
  }
});

export const THEME_PALETTES_BY_MODE = THEME_PALETTE_PRESETS;

export const CHAT_BG_PRESETS_BY_MODE = {
  light: [
    '#f8f9fd',
    '#ffffff',
    '#eef2f6',
    '#e7efe4',
    '#f3ede2',
    '#e4f2ec',
    '#eef0fb'
  ],
  dark: [
    '#0f1723',
    '#131722',
    '#0f1915',
    '#181c24',
    '#181513',
    '#0a0c10',
    '#161421'
  ]
};

export const BUBBLE_BG_PRESETS_BY_MODE = {
  light: [
    '#ffffff',
    '#f3f6fa',
    '#f1f4f9',
    '#fffdf9',
    '#fef9e7',
    '#ecf7f1',
    '#f3effb'
  ],
  dark: [
    '#172332',
    '#1e222d',
    '#182721',
    '#222834',
    '#24201c',
    '#151921',
    '#221e33'
  ]
};

export const HEADER_PRESETS_BY_MODE = {
  light: [
    '#f8f9fd',
    '#ffffff',
    '#e7efe4',
    '#f3ede2',
    '#dff2ea',
    '#eae6f9',
    '#2563eb',
    '#1e293b'
  ],
  dark: [
    '#0f1723',
    '#131722',
    '#0f1915',
    '#181c24',
    '#1e293b',
    '#0a0c10',
    '#2563eb',
    '#1d3557'
  ]
};

export const HEADER_PRESETS = HEADER_PRESETS_BY_MODE.light;
export const CHAT_BG_PRESETS = CHAT_BG_PRESETS_BY_MODE.light;
export const BUBBLE_BG_PRESETS = BUBBLE_BG_PRESETS_BY_MODE.light;

export const TICKER_PRESETS = [
  { fg: '#fde047', bg: '#422006' },
  { fg: '#0f172a', bg: '#facc15' },
  { fg: '#4ade80', bg: '#063925' },
  { fg: '#38bdf8', bg: '#0c2d48' },
  { fg: '#c084fc', bg: '#2e1065' },
  { fg: '#fda4af', bg: '#4c0519' }
];
