/**
 * Hiring a venue on Omoshow (the API's src/venues/venue-bookings.ts): the shapes, data hooks and the small labels the
 * booking screens share.
 *
 * Venue managers (an approved claim on the venue) list it with terms and weekly hours; organizers (org admins and
 * managers) request a time, which is held for 48 hours while the venue confirms or declines. Listings with instant
 * booking confirm free times at once. Booking times are the venue's wall-clock time stored as UTC, like event times.
 * Payment happens outside Omoshow for now: the price is only shown.
 *
 *   GET  /venue-listings?q&city&country&guests&date       bookable venues
 *   GET  /venues/:slug/availability?from&to               busy times (no names), opening hours, earliest start
 *   POST /organizer/orgs/:orgId/venue-bookings            request a time
 *   GET  /organizer/orgs/:orgId/venue-bookings?status     the org's bookings
 *   GET  /organizer/venue-bookings/:id                    one booking with its messages (…/cancel, …/messages)
 *   GET  /me/venue-bookings?status                        the venue manager's inbox
 *   GET  /me/venue-bookings/:id                           one booking (…/confirm, …/decline, …/cancel, …/messages)
 */
import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import { useAuth } from './auth';
import { money, when } from './format';

/* ---------- shapes ---------- */

export type PriceMode = 'HOUR' | 'DAY' | 'QUOTE';
/** One opening window: day 0–6 (Sunday = 0), "09:00" to "23:00" ("24:00" is midnight). */
export type OpeningHours = { day: number; open: string; close: string };

/** A venue's terms for hire (`listing` on GET /venues/:slug; null when it isn't taking bookings). */
export type VenueListing = {
  active: true;
  priceMode: PriceMode;
  /** per hour or per day, in minor units of `currency`; null with QUOTE */
  priceCents: number | null;
  currency: string;
  minHours: number;
  noticeDays: number;
  bufferMinutes: number;
  capacity: number | null;
  amenities: string[];
  rules: string | null;
  photos: { url: string; alt?: string }[];
  instantBook: boolean;
  /** null: any time */
  hours: OpeningHours[] | null;
  timezone: string;
};

/** GET /venue-listings items */
export type ListingResult = {
  venue: { id: string; slug: string; name: string; address: string; city: string; region: string | null; country: string | null; imageUrl: string | null; verified: boolean; capacity: number | null; timezone: string };
  listing: VenueListing;
};

/** GET /venues/:slug/availability */
export type Availability = {
  venue: { id: string; slug: string; name: string };
  timezone: string;
  from: string;
  to: string;
  /** the earliest start the venue's notice allows, venue wall-clock */
  earliestStart: string;
  hours: OpeningHours[] | null;
  minHours: number;
  bufferMinutes: number;
  /** booked (confirmed), held (a request waiting for an answer) or closed (blocked out), setup and cleanup included */
  busy: { from: string; to: string; kind: 'booked' | 'held' | 'closed' }[];
};

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
export type Side = 'ORGANIZER' | 'VENUE';

export type Booking = {
  id: string;
  code: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  blockFrom: string;
  blockTo: string;
  timezone: string;
  guests: number | null;
  message: string | null;
  /** a real moment (not wall-clock): when a pending request stops holding its time */
  holdUntil: string;
  quotedCents: number | null;
  currency: string | null;
  decidedAt: string | null;
  declineReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: Side | null;
  createdAt: string;
  venue: { id: string; slug: string; name: string; address: string; city: string; region: string | null; country: string | null; imageUrl: string | null; phone?: string | null; website?: string | null };
  org: { id: string; name: string; supportEmail?: string };
  event: { id: string; title: string; slug?: string; status?: string } | null;
  side: Side;
};

export type BookingMessage = { id: string; side: Side; body: string; createdAt: string; author: string | null; mine: boolean };

/** GET /organizer/venue-bookings/:id and GET /me/venue-bookings/:id */
export type BookingDetail = Booking & {
  requestedBy: string | null;
  terms: { priceMode: PriceMode; priceCents: number | null; currency: string; rules: string | null; bufferMinutes: number } | null;
  can: { confirm: boolean; decline: boolean; cancel: boolean; message: boolean };
  messages: BookingMessage[];
};

/** GET /me/venue-bookings */
export type VenueInbox = { venues: string[]; pending: number; items: Booking[] };

/** `venueBooking` on the organizer's event (GET /organizer/events/:id and the org's event list) */
export type EventBooking = {
  id: string;
  code: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  holdUntil: string;
  quotedCents: number | null;
  currency: string | null;
  declineReason: string | null;
  cancelReason: string | null;
};

/** A venue this person manages, as GET /me/venues returns it (the fields the app uses). */
export type ManagedVenue = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  capacity: number | null;
  about: string | null;
  imageUrl: string | null;
  /** the gallery, cover first */
  photos?: { url: string; alt?: string }[] | null;
  website: string | null;
  phone: string | null;
  verified?: boolean;
  verifiedAt?: string | null;
  timezone?: string | null;
};

export type ClaimRole = 'owner' | 'manager' | 'staff';
export type ClaimStatus = 'PENDING' | 'REJECTED' | 'REVOKED';

/** A request to manage a venue (claiming one on Omoshow, or adding a new one) that isn't approved (yet). */
export type VenueRequest = {
  id: string;
  status: ClaimStatus;
  role: ClaimRole | string;
  /** Omoshow's note when it was declined */
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** an owner added the venue: it stays hidden (no public page) until approved */
  newVenue: boolean;
  venue: { id: string; slug: string; name: string; city: string; address: string; country: string | null; hidden: boolean };
};

/** GET /me/venues */
export type MyVenues = {
  managed: { role: string; venue: ManagedVenue; listing: { active: boolean; instantBook: boolean } | null; pendingBookings: number }[];
  requests: VenueRequest[];
};

/* ---------- hooks ---------- */

const enc = encodeURIComponent;
const useSignedIn = () => !!useAuth().user;

/** Where one booking lives, from each side. */
export const bookingPath = (side: Side, id: string) => (side === 'ORGANIZER' ? `/organizer/venue-bookings/${enc(id)}` : `/me/venue-bookings/${enc(id)}`);

export function useOrgBookings(orgId: string | undefined, status: BookingStatus | '' = '') {
  const on = useSignedIn();
  return useQuery({
    queryKey: ['bookings', 'org', orgId, status],
    queryFn: () => api<Booking[]>(`/organizer/orgs/${enc(orgId!)}/venue-bookings${qs({ status: status || undefined })}`),
    enabled: on && !!orgId,
    staleTime: 15_000,
  });
}

export function useVenueInbox(status: BookingStatus | '' = '') {
  const on = useSignedIn();
  return useQuery({ queryKey: ['bookings', 'inbox', status], queryFn: () => api<VenueInbox>(`/me/venue-bookings${qs({ status: status || undefined })}`), enabled: on, staleTime: 15_000 });
}

export function useBooking(side: Side, id: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['bookings', side, id], queryFn: () => api<BookingDetail>(bookingPath(side, id!)), enabled: on && !!id, staleTime: 10_000 });
}

/** The venues this person manages and their requests to manage one (the account tab, My venues). */
export function useMyVenues(userId: string | undefined) {
  return useQuery({
    queryKey: ['me', 'venues', userId],
    // Older APIs answered without `requests`.
    queryFn: () => api<MyVenues>('/me/venues').then((r) => ({ managed: r.managed ?? [], requests: r.requests ?? [] })),
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useAvailability(slug: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['venue', 'availability', slug, from ?? '', to ?? ''],
    queryFn: () => api<Availability>(`/venues/${enc(slug!)}/availability${qs({ from, to })}`),
    enabled: !!slug,
    staleTime: 15_000,
    retry: 0,
  });
}

/* ---------- labels ---------- */

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Waiting for the venue',
  CONFIRMED: 'Confirmed',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};
/** The venue's side of a pending request. */
export const statusLabel = (s: BookingStatus, side: Side) => (side === 'VENUE' && s === 'PENDING' ? 'Needs your answer' : STATUS_LABEL[s]);
export const BOOKING_TONE: Record<BookingStatus, 'plain' | 'accent' | 'success' | 'warning'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  DECLINED: 'accent',
  EXPIRED: 'plain',
  CANCELLED: 'accent',
};
export const STATUS_FILTERS: { id: BookingStatus | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'PENDING', label: 'Waiting' },
  { id: 'CONFIRMED', label: 'Confirmed' },
  { id: 'DECLINED', label: 'Declined' },
  { id: 'EXPIRED', label: 'Expired' },
  { id: 'CANCELLED', label: 'Cancelled' },
];
/** A live booking holds the time: confirmed, or still waiting. */
export const isLiveBooking = (s: BookingStatus | undefined) => s === 'PENDING' || s === 'CONFIRMED';

/** "₦50,000 / hour", "Ask for a quote" */
export function priceLabel(l: Pick<VenueListing, 'priceMode' | 'priceCents' | 'currency'>) {
  if (l.priceMode === 'QUOTE' || l.priceCents === null) return 'Price on request';
  return `${money(l.priceCents, l.currency)} / ${l.priceMode === 'HOUR' ? 'hour' : 'day'}`;
}

/** "Sat, Dec 27 · 6:00 PM – 11:00 PM", or across days "Sat, Dec 27, 6:00 PM – Sun, Dec 28, 2:00 AM" (wall-clock). */
export function rangeLabel(from: string, to: string) {
  const a = when(from);
  const b = when(to);
  return a.ymd === b.ymd ? `${a.short} · ${a.time} – ${b.time}` : `${a.short}, ${a.time} – ${b.short}, ${b.time}`;
}

/** "6:00 PM – 11:00 PM" within one day, else with the days. */
export function timesLabel(from: string, to: string) {
  const a = when(from);
  const b = when(to);
  return a.ymd === b.ymd ? `${a.time} – ${b.time}` : `${a.short} ${a.time} – ${b.short} ${b.time}`;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (hhmm: string) => {
  if (hhmm === '24:00') return 'midnight';
  const h = Number(hhmm.slice(0, 2));
  return `${((h + 11) % 12) + 1}:${hhmm.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Weekly hours as lines, Monday first: "Mon · 9:00 AM – 11:00 PM", "Tue · Closed". */
export function hoursLines(hours: OpeningHours[] | null) {
  if (!hours?.length) return null;
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const list = hours.filter((h) => h.day === day).sort((a, b) => a.open.localeCompare(b.open));
    return { day: DAY_SHORT[day], text: list.length ? list.map((h) => `${clock(h.open)} – ${clock(h.close)}`).join(', ') : 'Closed' };
  });
}

/** That weekday's opening hours ("9:00 AM – 11:00 PM", "Closed", or null when any time). */
export function hoursOn(hours: OpeningHours[] | null, ymd: string) {
  if (!hours?.length || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const list = hours.filter((h) => h.day === dow).sort((a, b) => a.open.localeCompare(b.open));
  return list.length ? list.map((h) => `${clock(h.open)} – ${clock(h.close)}`).join(', ') : 'Closed';
}

/** A real moment on this phone's clock: "Thu, Nov 26, 3:00 PM". */
export function localMoment(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${DAY_SHORT[d.getDay()]}, ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}, ${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Lagos time" */
export const zoneCity = (tz: string | null | undefined) => (tz && tz !== 'UTC' ? `${tz.split('/').pop()!.replace(/_/g, ' ')} time` : 'local time');

/** "2 hours", "1 day" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "60 min" / "1 h 30 min" setup and cleanup. */
export function minutesLabel(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/* ---------- a free time to suggest ---------- */

const MINUTE_MS = 60_000;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayAfter = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export type SlotRules = Pick<Availability, 'earliestStart' | 'hours' | 'busy' | 'bufferMinutes' | 'minHours'>;

/**
 * The first time a request form can suggest: a day at or after the venue's earliest start (its notice), inside its
 * opening hours (Sunday = 0), where the times, at least `minHours` long, plus the setup and cleanup buffer on both
 * sides don't touch any busy block (booked, on hold or blocked out). Everything is venue wall-clock time written as
 * UTC, so plain UTC arithmetic is right.
 *
 * It first keeps `want`'s times and moves the day; only when those times never fit (say they're outside every
 * opening window) does it try other starts: the day's opening times, the earliest start, and just after a busy
 * block. `date` searches that day only; `fixedTime` never changes the times. At most `maxDays` days are searched;
 * null when nothing fits.
 */
export function freeSlot(rules: SlotRules, want: { start: string; end: string; date?: string; fixedTime?: boolean }, maxDays = 120): { date: string; start: string; end: string } | null {
  const startMin = toMinutes(want.start);
  const len = toMinutes(want.end) - startMin > 0 ? toMinutes(want.end) - startMin : rules.minHours * 60;
  const blockLen = Math.max(len, rules.minHours * 60) * MINUTE_MS;
  const buffer = rules.bufferMinutes * MINUTE_MS;
  const earliest = Date.parse(rules.earliestStart);
  const busy = rules.busy.map((b) => [Date.parse(b.from), Date.parse(b.to)] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!Number.isFinite(earliest)) return null;
  const firstDay = want.date ?? rules.earliestStart.slice(0, 10);
  const days = want.date ? 1 : maxDays;

  const fits = (dayMs: number, windows: OpeningHours[] | null, s: number) => {
    if (s < 0 || s + len >= 24 * 60) return false;
    const from = dayMs + s * MINUTE_MS;
    if (from < earliest) return false;
    if (windows && !windows.some((w) => toMinutes(w.open) <= s && s + len <= (w.close === '24:00' ? 24 * 60 : toMinutes(w.close)))) return false;
    const a = from - buffer;
    const b = from + blockLen + buffer;
    return !busy.some(([x, y]) => x < b && y > a);
  };

  for (const flexible of want.fixedTime ? [false] : [false, true]) {
    let day = firstDay;
    for (let i = 0; i < days; i++, day = dayAfter(day)) {
      const dayMs = Date.parse(`${day}T00:00:00.000Z`);
      const dow = new Date(dayMs).getUTCDay();
      const windows = rules.hours?.length ? rules.hours.filter((h) => h.day === dow) : null;
      if (windows && !windows.length) continue;
      const starts = [startMin];
      if (flexible) {
        const more = new Set<number>();
        const ceil15 = (m: number) => Math.ceil(m / 15) * 15;
        for (const w of windows ?? []) more.add(toMinutes(w.open));
        if (earliest > dayMs && earliest < dayMs + 86_400_000) more.add(ceil15((earliest - dayMs) / MINUTE_MS));
        for (const [, y] of busy) {
          const m = (y + buffer - dayMs) / MINUTE_MS;
          if (m > 0 && m < 24 * 60) more.add(ceil15(m));
        }
        if (!windows) more.add(9 * 60);
        more.delete(startMin);
        starts.push(...[...more].sort((x, y) => x - y));
      }
      const s = starts.find((m) => fits(dayMs, windows, m));
      if (s !== undefined) return { date: day, start: hhmmOf(s), end: hhmmOf(s + len) };
    }
  }
  return null;
}
