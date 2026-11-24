/**
 * Formatting shared by every screen: money (all-in prices in the event's currency), event dates and times,
 * time zones, categories, countries and distances. Copied from the website's helpers (components/money-format.ts,
 * api.ts `when`, zones.ts, near.ts) and made safe for Hermes, whose Intl support differs by platform.
 */
import type { Category } from './types';

/* ---------- money ---------- */

const SYMBOL: Record<string, string> = {
  USD: '$',
  CAD: '$',
  AUD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  GHS: 'GH₵',
  KES: 'KSh',
  ZAR: 'R',
};

/** Paid through Paystack; the rest through Stripe. */
export const PAYSTACK = new Set(['NGN', 'GHS', 'KES', 'ZAR']);

export const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "$25", "$25.88", "₦25,000". Whole amounts drop the decimals unless `decimals` is forced. */
export function money(cents: number, currency = 'USD', opts: { decimals?: boolean } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = abs % 100 === 0;
  const decimals = opts.decimals ?? !whole;
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  const sym = SYMBOL[currency.toUpperCase()];
  const digits = decimals ? `${num(major)}.${minor}` : num(Math.round(abs / 100));
  const text = sym ? `${sym}${digits}` : `${currency.toUpperCase()} ${digits}`;
  return neg ? `−${text}` : text;
}

export const currencySymbol = (currency = 'USD') => SYMBOL[currency.toUpperCase()] ?? currency.toUpperCase();

/* ---------- dates ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Event times are stored as the venue's wall-clock time in UTC (no time zone conversion), so they read the same
 * for every visitor. These helpers format them that way.
 */
export function when(iso: string | Date) {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return {
    date: `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    short: `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
    month: MONTHS[d.getUTCMonth()],
    day: d.getUTCDate(),
    dow: DAYS[d.getUTCDay()],
    time: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`,
    /** "2026-12-27" in the venue's calendar */
    ymd: d.toISOString().slice(0, 10),
  };
}

/** Today's date ("2026-11-23") on this device's calendar. */
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type DateRange = 'any' | 'today' | 'weekend' | 'week' | 'month';
export const DATE_RANGES: { id: DateRange; label: string }[] = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'month', label: 'Next 30 days' },
];

/** `from`/`to` (inclusive ISO dates) for the API, in the venue's wall-clock calendar like the stored times. */
export function dateRange(range: DateRange, now = new Date()): { from?: string; to?: string } {
  const today = todayYmd(now);
  if (range === 'today') return { from: today, to: today };
  if (range === 'week') return { from: today, to: addDays(today, 6) };
  if (range === 'month') return { from: today, to: addDays(today, 29) };
  if (range === 'weekend') {
    // Friday to Sunday; from Friday on, the current one (starting today).
    const dow = now.getDay(); // 0 Sun … 6 Sat
    const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
    const fri = addDays(today, toFri);
    return { from: toFri < 0 ? today : fri, to: addDays(fri, 2) };
  }
  return {};
}

/** Whether a stored start time has passed (with a few hours' grace so tonight's show stays "upcoming"). */
export function isPast(iso: string, graceHours = 6) {
  // The stored time is venue wall-clock; compare against the device's wall clock written the same way.
  const d = new Date();
  const wallNow = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
  return new Date(iso).getTime() + graceHours * 3600_000 < wallNow;
}

/* ---------- time zones ---------- */

function zoneOk(tz: string | null | undefined): tz is string {
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Minutes `tz` is ahead of UTC at the instant `at` (Lagos: 60), or null if the runtime can't tell. */
function offsetAt(tz: string, at: Date): number | null {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const p: Record<string, number> = {};
    for (const x of f.formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
    return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

/** "GMT+1", "EST" for an event's zone at its start time; '' when unknown or plain UTC (the catalog's default). */
export function zoneAbbr(tz: string | null | undefined, wallIso: string) {
  if (!zoneOk(tz)) return '';
  try {
    const at = instantOf(wallIso, tz);
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
    return p.find((x) => x.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** The real instant of a stored wall-clock time in `tz`. */
export function instantOf(wallIso: string, tz: string): Date {
  const naive = Date.parse(`${wallIso.slice(0, 16)}:00Z`);
  const o1 = offsetAt(tz, new Date(naive));
  if (o1 === null) return new Date(naive);
  let t = naive - o1 * 60000;
  const o2 = offsetAt(tz, new Date(t));
  if (o2 !== null) t = naive - o2 * 60000;
  return new Date(t);
}

/** "3:00 PM your time" when the device is in another zone than the event; null otherwise. */
export function localTimeText(wallIso: string, tz: string | null | undefined) {
  if (!zoneOk(tz)) return null;
  try {
    const at = instantOf(wallIso, tz);
    const theirs = offsetAt(tz, at);
    const mine = -at.getTimezoneOffset();
    if (theirs === null || theirs === mine) return null;
    const h = at.getHours();
    const time = `${((h + 11) % 12) + 1}:${String(at.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    const sameDay = todayYmd(at) === wallIso.slice(0, 10);
    return `${sameDay ? '' : `${DAYS[at.getDay()]}, ${MONTHS[at.getMonth()]} ${at.getDate()}, `}${time} your time`;
  } catch {
    return null;
  }
}

/* ---------- categories ---------- */

export const CATEGORY_NAME: Record<Category, string> = {
  CONCERTS: 'Concerts',
  SPORTS: 'Sports',
  COMEDY: 'Comedy',
  THEATER: 'Theater',
  FESTIVALS: 'Festivals',
  FAMILY: 'Family',
  NIGHTLIFE: 'Nightlife',
  CONFERENCE: 'Conference',
  WORKSHOP: 'Workshop',
  FAITH: 'Faith',
  OTHER: 'Other',
};

/** The categories fans browse by, in the website's order. */
export const BROWSE_CATEGORIES: Category[] = ['CONCERTS', 'SPORTS', 'COMEDY', 'THEATER', 'FESTIVALS', 'FAMILY', 'FAITH', 'NIGHTLIFE'];

/* ---------- places ---------- */

const COUNTRY: Record<string, string> = {
  NG: 'Nigeria',
  GH: 'Ghana',
  KE: 'Kenya',
  ZA: 'South Africa',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  IE: 'Ireland',
  FR: 'France',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  AE: 'United Arab Emirates',
};

export function countryName(code: string) {
  const c = code.toUpperCase();
  if (COUNTRY[c]) return COUNTRY[c];
  try {
    const dn = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of: (c: string) => string | undefined } }).DisplayNames;
    return (dn && new dn(['en'], { type: 'region' }).of(c)) || c;
  } catch {
    return c;
  }
}

/** Flag emoji for a country code. */
export const flag = (code: string) =>
  code.length === 2 ? String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '';

export const distanceLabel = (d: number) => (d < 1 ? 'Under 1 km away' : d < 100 ? `${Math.round(d)} km away` : `${Math.round(d / 10) * 10} km away`);

/** Great-circle distance in km. */
export function km(a: [number, number], b: [number, number]) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "Lagos" from "Lagos" or "Austin, TX". */
export const cityOnly = (city: string | null | undefined) => (city ?? '').split(',')[0].trim();

export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** "Good evening" for the Discover header. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Mon, Nov 23, 9:41 PM" in this device's time (for "saved at" notes). */
export function localStamp(ms: number) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
