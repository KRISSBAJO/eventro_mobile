/**
 * Omoshow design tokens: colours, radii, spacing and type, in one place.
 *
 * Colours mirror the website's theme (eventro/app/tailwind.css). Fonts match the website too:
 * Archivo for headings, prices and big numbers, Inter for UI and body text, Reddit Mono for eyebrows, codes and labels.
 * To change a family, edit `fontAssets` (the files to load) and `font` (the names screens use) below; nothing else
 * refers to a font by name.
 */
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { RedditMono_500Medium } from '@expo-google-fonts/reddit-mono/500Medium';
import { RedditMono_600SemiBold } from '@expo-google-fonts/reddit-mono/600SemiBold';
import { Appearance, type TextStyle } from 'react-native';
import { readAppearance } from './lib/theme-store';

/**
 * Dark: black on black. A near-black page with slightly lighter black cards and rows (no tint), so photos and the red
 * carry the colour.
 */
const DARK = {
  bg: '#0b0b0c',
  bg2: '#111112',
  surface: '#1a1a1b',
  surface2: '#242426',
  /** Inside of text fields, pickers and search boxes: a touch lighter than the page, so they read as places to type. */
  field: '#1a1a1b',
  /** A field's border: a touch brighter than line2, so the well's edge shows on dark cards. */
  fieldLine: 'rgba(255,255,255,0.16)',
  line: 'rgba(255,255,255,0.08)',
  line2: 'rgba(255,255,255,0.13)',
  text: '#f5f5f5',
  muted: '#a8a8ad',
  dim: '#77777c',
  accent: '#ff4d3d',
  accentHi: '#ff6a5c',
  accentInk: '#ffffff',
  accentSoft: 'rgba(255,77,61,0.12)',
  accentLine: 'rgba(255,77,61,0.35)',
  success: '#2fbf71',
  successSoft: 'rgba(47,191,113,0.12)',
  successLine: 'rgba(47,191,113,0.35)',
  warning: '#f5a524',
  warningSoft: 'rgba(245,165,36,0.12)',
  scrim: 'rgba(0,0,0,0.72)',
  glass: 'rgba(0,0,0,0.55)',
  /** image overlays fade to black */
  fade0: 'rgba(0,0,0,0)',
  fade: 'rgba(0,0,0,0.82)',
  paper: '#f3f1ec',
  ink: '#0d0d0f',
  inkMuted: '#55555c',
  /** Text and icons laid over photos (which keep a dark fade in both themes) */
  onImage: '#ffffff',
  onImageSoft: 'rgba(255,255,255,0.82)',
} as const;

export type Palette = { [K in keyof typeof DARK]: string };

/**
 * Light: clean white. A pure white page, white cards with hairline edges and very light grey fills, neutral greys for
 * text, and Omoshow red (deepened to #D63A2B so text and white-on-red buttons pass contrast). Photos keep their dark
 * fade and white text (fade, glass, onImage), so event imagery reads the same in both themes.
 */
const LIGHT: Palette = {
  bg: '#ffffff',
  bg2: '#f6f6f7',
  surface: '#ffffff',
  surface2: '#f3f3f4',
  field: '#ffffff',
  fieldLine: 'rgba(17,17,19,0.16)',
  line: 'rgba(17,17,19,0.09)',
  line2: 'rgba(17,17,19,0.15)',
  text: '#111113',
  muted: '#55555c',
  dim: '#7c7c83',
  accent: '#d63a2b',
  accentHi: '#b8321f',
  accentInk: '#ffffff',
  accentSoft: 'rgba(214,58,43,0.08)',
  accentLine: 'rgba(214,58,43,0.30)',
  success: '#17824a',
  successSoft: 'rgba(23,130,74,0.10)',
  successLine: 'rgba(23,130,74,0.30)',
  warning: '#a35f00',
  warningSoft: 'rgba(163,95,0,0.10)',
  scrim: 'rgba(17,17,19,0.45)',
  glass: 'rgba(0,0,0,0.5)',
  fade0: 'rgba(0,0,0,0)',
  fade: 'rgba(0,0,0,0.78)',
  paper: '#f3f1ec',
  ink: '#0d0d0f',
  inkMuted: '#55555c',
  onImage: '#ffffff',
  onImageSoft: 'rgba(255,255,255,0.82)',
};

/** What the person picked in Account → Appearance. "system" follows the phone's light/dark setting. */
export type AppearanceChoice = 'dark' | 'light' | 'system';
export const APPEARANCES: AppearanceChoice[] = ['system', 'light', 'dark'];

const saved = readAppearance();
/** The saved choice; the phone's setting until the person picks one. */
export const appearance: AppearanceChoice = saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system';
/**
 * The palette in use, fixed for this run of the app: screens build their styles from it when they load, so changing
 * the appearance saves the choice and reloads the app (lib/appearance.ts).
 */
export const scheme: 'dark' | 'light' = appearance === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : appearance;
export const colors: Palette = scheme === 'light' ? LIGHT : DARK;

export const radius = {
  sm: 10,
  md: 14,
  card: 18,
  lg: 22,
  panel: 28,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Side padding for screens. */
export const gutter = space.xl;

/* ---------- type ---------- */

/** Font files to load at start-up (expo-font). Keys are the family names used in `font` below. */
export const fontAssets = {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  RedditMono_500Medium,
  RedditMono_600SemiBold,
};

/**
 * Families by role and weight. Custom fonts carry their weight in the family name, so styles set `fontFamily`
 * and never `fontWeight` (Android would otherwise fall back to the system font).
 */
export const font = {
  display: { semibold: 'Archivo_600SemiBold', bold: 'Archivo_700Bold', heavy: 'Archivo_800ExtraBold' },
  body: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' },
  mono: { medium: 'RedditMono_500Medium', semibold: 'RedditMono_600SemiBold' },
} as const;

/** Text styles used across the app. */
export const type = {
  hero: { fontFamily: font.display.heavy, fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  h1: { fontFamily: font.display.bold, fontSize: 28, lineHeight: 33, letterSpacing: -0.9 },
  h2: { fontFamily: font.display.bold, fontSize: 22, lineHeight: 27, letterSpacing: -0.6 },
  h3: { fontFamily: font.display.semibold, fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  title: { fontFamily: font.body.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
  body: { fontFamily: font.body.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: font.body.semibold, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.body.regular, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: font.body.semibold, fontSize: 13, lineHeight: 18 },
  tiny: { fontFamily: font.body.medium, fontSize: 11, lineHeight: 14 },
  eyebrow: { fontFamily: font.mono.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: 'uppercase' },
  mono: { fontFamily: font.mono.medium, fontSize: 12, lineHeight: 16 },
  price: { fontFamily: font.display.bold, fontSize: 18, lineHeight: 22, letterSpacing: -0.4 },
  priceLg: { fontFamily: font.display.heavy, fontSize: 30, lineHeight: 34, letterSpacing: -1 },
  button: { fontFamily: font.body.semibold, fontSize: 16, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

export type TypeName = keyof typeof type;

/** Smallest comfortable touch target. */
export const touch = 44;

export const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  accent: { shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
} as const;
