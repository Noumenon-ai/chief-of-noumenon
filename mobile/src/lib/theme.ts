// Colors for the light and dark looks. The app follows the phone's setting; there is no switch of its own.
// Every screen takes its colors from here, so a pair that reads well in one look is checked once in
// `theme.test.tsx` (text on its background must reach a 4.5:1 contrast).
//
// The values are the web app's own tokens (frontend/app/globals.css), so the phone and the web look alike.
// `theme-drift.test.ts` reads that file and fails when a value here no longer matches its token; change
// a color in globals.css first, then here. `warnBackground` is the one phone-only color: the web has no
// tinted background for a warning.

import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

export type Palette = {
  /** Screens. */
  background: string;
  /** Assistant bubbles, chips and the like. */
  surface: string;
  /** Code blocks and inline code (the web's code background, set into a bubble). */
  surfaceStrong: string;
  /** The person's own messages (the web's neutral bubble); `text` is the text on it. */
  bubbleUser: string;
  text: string;
  muted: string;
  border: string;
  inputBorder: string;
  /** Fill of primary buttons and the person's own bubbles; `onAccent` is the text on it. */
  accent: string;
  onAccent: string;
  /** Links, outlines and text buttons on a screen. */
  accentText: string;
  /** Red text and outlines. `dangerFill` is a red button with `onAccent` text on it. */
  danger: string;
  /** Something went right (the web's success colour). */
  success: string;
  dangerFill: string;
  notice: string;
  /** The approval card and the reconnecting banner. */
  warnBackground: string;
  warnBorder: string;
  warnText: string;
  quoteBar: string;
};

export const light: Palette = {
  background: '#ffffff',
  surface: '#efebf8',
  surfaceStrong: '#f6f4fb',
  bubbleUser: '#ebe6ff',
  text: '#1d1828',
  muted: '#575064',
  border: '#e2deea',
  inputBorder: '#655d72',
  accent: '#5b3fd6',
  onAccent: '#ffffff',
  accentText: '#5b3fd6',
  danger: '#ad2241',
  success: '#17633f',
  dangerFill: '#ad2241',
  notice: '#6b507e',
  warnBackground: '#fff8e1',
  warnBorder: '#6b507e',
  warnText: '#6b507e',
  quoteBar: '#655d72',
};

export const dark: Palette = {
  background: '#17151c',
  surface: '#3c3545',
  surfaceStrong: '#211e27',
  bubbleUser: '#494053',
  text: '#f0edf5',
  muted: '#bfb7c8',
  border: '#49434f',
  inputBorder: '#aaa3b5',
  accent: '#d5cedc',
  onAccent: '#17151c',
  accentText: '#d5cedc',
  danger: '#ff92aa',
  success: '#73d6aa',
  dangerFill: '#ff92aa',
  notice: '#c5afe5',
  warnBackground: '#2e2608',
  warnBorder: '#c5afe5',
  warnText: '#c5afe5',
  quoteBar: '#aaa3b5',
};

/**
 * Corner radii, in points. `field` (inputs, buttons, chips) and `card` (bubbles, cards, blocks) are the web's
 * `--radius-field` and `--radius-card`, 0.5rem and 0.75rem at 16 points to the rem; `theme-drift.test.ts`
 * checks them. `round` makes a circle of any small square.
 */
export const radius = { field: 8, card: 12, round: 999 } as const;

/** The smallest a tappable control may be, in points (the platform guidelines say 44 on iOS and 48 dp on Android; 44 here, with `hitSlop` for a smaller-looking one). */
export const touch = { min: 44 } as const;

export function paletteFor(scheme: string | null | undefined): Palette {
  return scheme === 'dark' ? dark : light;
}

export function useTheme(): Palette {
  return paletteFor(useColorScheme());
}

/** Styles built from the current palette. Pass a function defined once at module level. */
export function useStyles<T>(create: (palette: Palette) => T): T {
  const palette = useTheme();
  return useMemo(() => create(palette), [create, palette]);
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two `#rrggbb` colors. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
