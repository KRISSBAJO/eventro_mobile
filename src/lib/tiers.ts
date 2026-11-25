/**
 * Ticket tiers: presets, perks, badges, rank, and each tier's "look" (the design a VIP ticket wears).
 *
 * Keep in sync with the website: eventro/components/tier-perks.tsx (presets, perks, badges, tierLevel) and its
 * tier looks, and with the API's resolved `look` (eventro-be/src/domain). The six looks, their colours and the
 * auto rule below are shared by all three, so a tier looks the same on the web, in the app and in the wallet.
 */

/** Same limits the API applies to ticket types. */
export const PERK_LIMIT = 8;
export const PERK_MIN = 2;
export const PERK_MAX = 60;
export const BADGE_MAX = 24;

export const BADGE_SUGGESTIONS = ['Best view', 'Most popular', 'Limited', 'Best value'];

export type TierPreset = {
  key: string;
  name: string;
  hint: string;
  perks: string[];
  badge?: string;
  /** How premium the tier is: a new preset is slotted above the first tier that ranks lower. */
  level: number;
};

export const TIER_PRESETS: TierPreset[] = [
  { key: 'ga', name: 'General admission', hint: 'Standard entry', level: 1, perks: ['Entry to the event', 'Open seating or standing', 'Access to bars and food'] },
  { key: 'vip', name: 'VIP', hint: 'Priority entry, lounge', level: 3, perks: ['Priority entry', 'Reserved seating near the stage', 'VIP lounge access'] },
  { key: 'vvip', name: 'VVIP', hint: 'VIP plus drinks, meet & greet', level: 4, perks: ['Everything in VIP', 'Dedicated entrance', 'Complimentary drinks', 'Meet & greet'] },
  {
    key: 'svip',
    name: 'Special VIP',
    hint: 'Front row, personal host',
    level: 5,
    perks: ['Everything in VVIP', 'Front-row seating', 'Personal host or usher', 'Reserved parking', 'Gift pack'],
  },
  { key: 'table', name: 'Table for 10', hint: 'One ticket seats a group', level: 2.5, perks: ['Reserved table for 10', 'Bottle service', 'Dedicated table host', 'Priority entry for the group'] },
  { key: 'early', name: 'Early bird', hint: 'Lower price, while it lasts', level: 0, badge: 'Limited', perks: ['Best price, while it lasts', 'Entry to the event'] },
];

/** Perks that suit most tiers, offered after the tier's own suggestions. */
const GENERIC_PERKS = ['Priority entry', 'Reserved seating', 'Complimentary drink', 'Fast-track entry', 'Merch discount', 'Free parking', 'Coat check', 'Early entry'];

/** How premium a tier name reads (see `TierPreset.level`), or null when the name doesn't say. */
export function tierLevel(name: string): number | null {
  if (/special\s*vip|\bsvip\b|platinum|diamond|royal|ultimate/i.test(name)) return 5;
  if (/vvip/i.test(name)) return 4;
  // VIP words win over table/package words: "VIP package" is a VIP tier.
  if (/vip|premium|gold|backstage/i.test(name)) return 3;
  if (/table|group|bundle|package|party of/i.test(name)) return 2.5;
  if (/early/i.test(name)) return 0;
  if (/general|regular|standard|\bga\b|admission|entry|free/i.test(name)) return 1;
  return null;
}

/** Where a preset goes in the list: above the first tier that clearly ranks lower, else at the end. */
export function presetIndex(names: string[], level: number) {
  const i = names.findIndex((n) => {
    const l = tierLevel(n);
    return l !== null && l < level;
  });
  return i < 0 ? names.length : i;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Suggested perks for a tier name, leaving out the ones it already has. */
export function perkSuggestions(name: string, have: string[], max = 6) {
  const level = tierLevel(name);
  const own = TIER_PRESETS.find((p) => p.level === level)?.perks ?? [];
  const out: string[] = [];
  for (const p of [...own, ...GENERIC_PERKS]) {
    if (out.length >= max) break;
    if (!have.some((h) => same(h, p)) && !out.some((o) => same(o, p))) out.push(p);
  }
  return out;
}

/** Trimmed, de-duplicated and capped, as the API stores them. */
export function cleanPerks(perks: string[]) {
  const out: string[] = [];
  for (const p of perks) {
    const v = tidy(p).slice(0, PERK_MAX);
    if (v.length >= PERK_MIN && !out.some((o) => same(o, v))) out.push(v);
  }
  return out.slice(0, PERK_LIMIT);
}

export const samePerks = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);
export const hasPerk = (list: string[], p: string) => list.some((x) => same(x, p));

/* ---------- looks ---------- */

export const TIER_LOOK_KEYS = ['early', 'standard', 'vip', 'vvip', 'platinum', 'table'] as const;
export type TierLook = (typeof TIER_LOOK_KEYS)[number];

export type TierLookDef = {
  key: TierLook;
  /** what the organizer sees in the look picker */
  name: string;
  /** gradient stops, top-left to bottom-right */
  colors: readonly [string, string, ...string[]];
  /** text and glyph colour on the gradient (chosen for WCAG AA contrast) */
  ink: string;
  /** softer ink for secondary text on the gradient */
  inkSoft: string;
  /** a 1px border (General only, so the dark ticket shows on dark screens) */
  border?: string;
  /** Omoshow orange edge line (General) */
  edge?: string;
  /** the glyph that marks the tier */
  glyph: 'leaf' | 'ticket' | 'crown' | 'star' | 'diamond' | 'table';
  /** a dark wash laid over light gradient starts so white ink stays readable (Early bird, Table) */
  scrim?: string;
  /** holographic: a static sheen is laid over it */
  sheen?: boolean;
  /** premium looks get a glow on fan screens */
  premium: boolean;
};

export const TIER_LOOKS: Record<TierLook, TierLookDef> = {
  early: { key: 'early', name: 'Early bird', colors: ['#34d399', '#047857'], ink: '#ffffff', inkSoft: 'rgba(255,255,255,0.86)', glyph: 'leaf', premium: false, scrim: 'rgba(2,44,34,0.5)' },
  standard: {
    key: 'standard',
    name: 'General',
    colors: ['#2a2024', '#140d0f'],
    ink: '#f7f2f2',
    inkSoft: 'rgba(247,242,242,0.72)',
    border: 'rgba(255,228,232,0.14)',
    edge: '#ff4d3d',
    glyph: 'ticket',
    premium: false,
  },
  vip: { key: 'vip', name: 'VIP', colors: ['#f7d774', '#c8922a'], ink: '#2b1d05', inkSoft: 'rgba(43,29,5,0.78)', glyph: 'crown', premium: true },
  vvip: { key: 'vvip', name: 'VVIP', colors: ['#f6c1b4', '#b76e79'], ink: '#2a1215', inkSoft: 'rgba(42,18,21,0.78)', glyph: 'star', premium: true },
  platinum: {
    key: 'platinum',
    name: 'Special VIP',
    colors: ['#e0e7ff', '#fbcfe8', '#a5f3fc', '#ddd6fe'],
    ink: '#1a1430',
    inkSoft: 'rgba(26,20,48,0.74)',
    glyph: 'diamond',
    sheen: true,
    premium: true,
  },
  table: { key: 'table', name: 'Table / group', colors: ['#8b5cf6', '#4c1d95'], ink: '#ffffff', inkSoft: 'rgba(255,255,255,0.86)', glyph: 'table', premium: true, scrim: 'rgba(30,10,70,0.3)' },
};

export const isTierLook = (v: unknown): v is TierLook => typeof v === 'string' && (TIER_LOOK_KEYS as readonly string[]).includes(v);

/** The look a tier gets from its name alone (Auto). */
export function autoLook(name: string): TierLook {
  const l = tierLevel(name);
  if (l === 5) return 'platinum';
  if (l === 4) return 'vvip';
  if (l === 2.5) return 'table';
  if (l === 3) return 'vip';
  if (l === 0) return 'early';
  return 'standard';
}

/** The look to show: the organizer's pick, else the auto one from the name. */
export function resolveLook(name: string, style?: string | null): TierLook {
  return isTierLook(style) ? style : autoLook(name);
}

/** A ticket type as the API sends it to fans: prefers the API's resolved `look`, else works it out. */
export function lookOf(t: { name: string; style?: string | null; look?: string | null } | null | undefined): TierLookDef {
  if (!t) return TIER_LOOKS.standard;
  return TIER_LOOKS[isTierLook(t.look) ? t.look : resolveLook(t.name, t.style)];
}
