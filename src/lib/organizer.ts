/**
 * Organizer tools: the API's shapes (GET/POST … /organizer/*), data hooks, roles and the small calculations the
 * screens share. The website (eventro/components/org-*.tsx) is the reference for how each one behaves.
 *
 * Roles (the API's organizer.service.ts): ADMIN does everything; MANAGER runs events (create, edit, promos, comps and
 * the guest list, pause, recent orders) but not payouts, the team or cancelling; DOOR scans tickets, checks guests in
 * and can see (not change) comps and the guest list.
 */
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { api, qs, WEB_URL } from './api';
import { useAuth } from './auth';
import { haptic } from './haptics';
import type { EventBooking } from './bookings';
import type { Attendee, Category, GuestList, MyOrg } from './types';
import type { DateMode, EventDate } from './dates';
import { colors } from '@/theme';
import type { SessionStat } from './schedule';
import type { TierLook } from './tiers';

/* ---------- roles ---------- */

export type OrgRole = 'ADMIN' | 'MANAGER' | 'DOOR';
export const ROLE_NAME: Record<string, string> = { ADMIN: 'Admin', MANAGER: 'Manager', DOOR: 'Door staff' };
export const ROLE_INFO: Record<OrgRole, string> = {
  ADMIN: 'Everything, including payouts, the team and cancelling events.',
  MANAGER: 'Create and edit events, promo codes and sales. No payouts or team.',
  DOOR: 'Scan tickets and check in the guest list at the door. Can see comps, not issue them.',
};
/** Create and edit events, promos, pause sales, recent orders. */
export const canEdit = (role: string | undefined) => role === 'ADMIN' || role === 'MANAGER';
/** Payouts, the team, cancelling. */
export const isAdmin = (role: string | undefined) => role === 'ADMIN';

/* ---------- shapes ---------- */

export type OrgStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'CANCELLED';

export type OrgTicketType = {
  id: string;
  name: string;
  description: string;
  /** all-in price fans pay */
  priceCents: number;
  capacity: number;
  sold: number;
  maxPerOrder: number;
  sortOrder: number;
  perks?: string[];
  badge?: string | null;
  /** the organizer's pick of look; null = Auto (from the name) */
  style?: TierLook | null;
  /** the look fans see (style, else from the name) */
  look?: TierLook;
  /** pay what you want: base amounts (`priceCents` is then the all-in price of the minimum). Older APIs leave them out. */
  pricing?: 'FIXED' | 'PWYW';
  pwywMinCents?: number | null;
  pwywSuggestedCents?: number | null;
  pwywMaxCents?: number | null;
  pwywQuickPicks?: number[];
  /** multiple dates: the date of this tier copy (DATES; copies share `tierKey`) or the days it admits on (DAYS) */
  eventDateId?: string | null;
  tierKey?: string | null;
  validDateIds?: string[];
};

/** An event's donation settings (GET /organizer/events/:id; also what create and edit send). */
export type DonationSettings = {
  donationsEnabled?: boolean;
  donationCause?: string | null;
  donationDescription?: string | null;
  donationSuggestedCents?: number[];
  donationMinCents?: number | null;
};

/** GET /organizer/orgs/:orgId/events */
export type OrgEvent = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: Category;
  status: OrgStatus;
  previewToken?: string | null;
  reviewNote: string | null;
  salesPaused: boolean;
  feeMode: 'BUYER' | 'ORGANIZER';
  currency: string;
  timezone?: string | null;
  startsAt: string;
  venue: { name: string; city: string; address: string; country?: string | null; region?: string | null } | null;
  online: boolean;
  imageUrl: string | null;
  hasSeatMap: boolean;
  /** a venue booked on Omoshow for this event, or null */
  venueBooking?: EventBooking | null;
  ticketTypes: OrgTicketType[];
  sold: number;
  capacity: number;
  grossCents: number;
  /** 60 days, oldest first, the last entry is today */
  daily: { tickets: number[]; cents: number[] };
  /** donations, net of refunds (separate from ticket sales), and live comps issued */
  donationsCents?: number;
  comps?: number;
  /** multiple dates (lib/dates.ts); totals above are across every date */
  dateMode?: DateMode;
  dates?: EventDate[];
  nextDate?: { id: string; startsAt: string } | null;
};

/** GET /organizer/events/:id (the event row with its venue, promos and media) */
export type OrgEventDetail = DonationSettings & {
  /** a change to the live event's name, tagline or cover waiting for Omoshow to check it, and why the last one was turned down */
  pendingEdit?: { title?: string; subtitle?: string; imageUrl?: string | null; media?: unknown } | null;
  pendingEditNote?: string | null;
  id: string;
  orgId: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: Category;
  status: OrgStatus;
  reviewNote: string | null;
  salesPaused: boolean;
  feeMode: 'BUYER' | 'ORGANIZER';
  currency: string;
  timezone: string | null;
  startsAt: string;
  doorsAt: string | null;
  endsAt: string | null;
  online: boolean;
  streamUrl: string | null;
  imageUrl: string | null;
  seatMap: { sections?: { ticketTypeId?: string }[] } | null;
  venue: { name: string; address: string; city: string; country: string | null; region: string | null; postalCode: string | null } | null;
  ticketTypes: OrgTicketType[];
  media: { id: string; kind: 'image' | 'video' }[];
  previewToken?: string | null;
  /** The venue booked on Omoshow for this event: it can't be submitted for review until this is CONFIRMED */
  venueBooking?: EventBooking | null;
  /** most live comps the event allows (null: no limit) */
  compLimit?: number | null;
  /** multiple dates (lib/dates.ts): DATES performances or DAYS days, cancelled ones too, in start order */
  dateMode?: DateMode;
  dates?: EventDate[];
};

/**
 * GET /organizer/events/:id/stats. `sold`, revenue and daily numbers are sales only: comps, the guest list and
 * donations are counted separately (older APIs leave those blocks out).
 */
export type EventStats = {
  sold: number;
  capacity: number;
  grossCents: number;
  netCents: number;
  checkedIn: number;
  byTicketType: { id: string; name: string; sold: number; capacity: number; priceCents: number; comps?: number; eventDateId?: string | null; tierKey?: string | null; validDateIds?: string[] }[];
  /** multiple dates: per date (DAYS: a pass counts on each of its days; gross split evenly over them); [] for SINGLE */
  byDate?: { dateId: string; startsAt: string; label: string | null; status: string; sold: number; comps?: number; capacity: number; checkedIn: number; grossCents: number }[];
  daily: { date: string; tickets: number; cents: number }[];
  /** cents: net of donation refunds */
  donations?: { orders: number; cents: number; refundedCents: number; cause: string | null };
  comps?: { issued: number; claimed: number; checkedIn: number; revoked: number; limit: number | null };
  guestList?: { entries: number; expected: number; arrived: number };
  /** bookable sessions on the schedule (lib/schedule.ts), by time; [] (or left out by older APIs) without */
  sessions?: SessionStat[];
};

/* ---------- donations ---------- */

/** One order with a donation on it (sales and resale orders): GET /organizer/events/:id/donations `items`. */
export type DonationOrder = {
  orderId: string;
  buyerName: string;
  email: string;
  currency: string;
  donationCents: number;
  donationRefundedCents: number;
  /** what can still be refunded */
  leftCents: number;
  /** the cause when they bought (the event's may have changed since) */
  cause: string | null;
  status: 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  paidAt: string | null;
  resale: boolean;
};

/**
 * GET /organizer/events/:id/donations (admins, managers and door staff), newest first, up to 500. `cause` is the
 * event's current cause; `canRefund` is true for org admins (POST …/orders/:orderId/refund-donation).
 */
export type EventDonations = { cause: string | null; canRefund: boolean; summary: { orders: number; cents: number; refundedCents: number }; items: DonationOrder[] };

/** POST /organizer/events/:id/orders/:orderId/refund-donation. `donationOwedCents` > 0: already paid out, owed to Omoshow. */
export type DonationRefund = {
  id: string;
  status: string;
  refundedCents: number;
  totalCents: number;
  donationCents: number;
  donationRefundedCents: number;
  donationCause: string | null;
  currency: string;
  refundedNowCents: number;
  donationOwedCents: number;
};

/* ---------- comps ---------- */

export type CompStatus = 'SENT' | 'CLAIMED' | 'CHECKED_IN' | 'REVOKED';

/** One comp: a real ticket on a $0 order, emailed to its holder to claim (GET/POST /organizer/events/:id/comps). */
export type Comp = {
  orderId: string;
  ticketId: string;
  name: string;
  email: string;
  group: string | null;
  note: string | null;
  status: CompStatus;
  ticketType: { id: string; name: string };
  section: string | null;
  row: string | null;
  seat: number | null;
  issuedAt: string;
  issuedBy: { id: string; name: string } | null;
  claimedAt: string | null;
  checkedInAt: string | null;
  revokedAt: string | null;
};

/** GET /organizer/events/:id/comps (`issued` counts live comps; `remaining` = limit − issued, or null) */
export type CompList = { limit: number | null; summary: { issued: number; claimed: number; checkedIn: number; revoked: number; remaining: number | null }; items: Comp[] };

export const COMP_STATUS: Record<CompStatus, { label: string; tone: 'plain' | 'success' | 'warning' | 'accent' }> = {
  SENT: { label: 'Sent', tone: 'warning' },
  CLAIMED: { label: 'Claimed', tone: 'plain' },
  CHECKED_IN: { label: 'Checked in', tone: 'success' },
  REVOKED: { label: 'Revoked', tone: 'accent' },
};

/** Groups offered for comps and guest-list entries (anything else can be typed; the API allows 40 characters). */
export const GROUPS = ['Press', 'Artist', 'Sponsor', 'Crew'];
export const GROUP_MAX = 40;
export const COMP_MAX = 200;

/** GET /organizer/orgs/:orgId/orders/recent */
export type RecentOrder = { id: string; buyerName: string; quantity: number; totalCents: number; currency: string; paidAt: string; ticketType: { name: string }; event: { title: string } };

/** GET /organizer/orgs/:orgId/payouts (admins) */
export type Payouts = {
  currency: string;
  converted: boolean;
  schedule: 'DAILY' | 'WEEKLY';
  pendingCents: number;
  nextPayoutCents: number;
  payoutMethod: { provider: 'stripe' | 'paystack'; bankLast4: string | null; bankName: string | null; accountName: string | null; country: string | null; updatedAt: string | null } | null;
  holdUntil: string | null;
  /** amountCents = ticketCents + donationCents (older APIs send amountCents only) */
  history: { salesDate: string; amountCents: number; ticketCents?: number; donationCents?: number; status: 'PAID' }[];
  /** donations inside pendingCents / nextPayoutCents, and the last 31 days' (net) */
  pendingDonationCents?: number;
  nextPayoutDonationCents?: number;
  donationsCents?: number;
  donationNote?: string;
  /** all-time donation refunds made after the organizer had been paid for the order: owed to Omoshow (0 normally) */
  donationOwedCents?: number;
};

/** GET /organizer/events/:id/price-drops */
export type PriceDrops = {
  watchers: number;
  subscribers: number;
  total: number;
  published: boolean;
  drops: { id: string; ticketName: string; fromCents: number; toCents: number; currency: string; notified: number; skipReason: string | null; createdAt: string }[];
};

/**
 * GET /organizer/events/:id/guarantee-refunds (org admins and managers; door staff get 403): approved Omoshow
 * Guarantee claims on the event that come out of the organizer's payout. `count` and the totals cover refunded claims;
 * `items` also holds approved ones whose refund is still PENDING or FAILED. `amountCents` went back to the fan;
 * `organizerCents` came out of the payout (less: Omoshow returns its own fee and ticket protection);
 * `organizerOwedCents` is owed to Omoshow when the order had already been paid out.
 */
export type GuaranteeRefunds = {
  currency: string;
  count: number;
  refundedCents: number;
  payoutReductionCents: number;
  owedCents: number;
  items: {
    id: string;
    ticketId: string;
    orderId: string;
    ticketType: string;
    section: string | null;
    row: string | null;
    seat: number | null;
    reason: string;
    amountCents: number;
    organizerCents: number;
    organizerOwedCents: number;
    currency: string;
    refundStatus: 'NONE' | 'PENDING' | 'REFUNDED' | 'FAILED';
    decidedAt: string | null;
    refundedAt: string | null;
  }[];
};

export type Promo = { code: string; percent: number; limit: number | null; used: number; active: boolean };

export type TeamMember = { id: string; email: string; role: OrgRole; status: 'ACTIVE' | 'INVITED'; user: { name: string } | null };

/** GET /organizer/events/:id/cancel-preview */
export type CancelPreview = {
  id: string;
  title: string;
  status: OrgStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  paidOrders: number;
  refundCents: { currency: string; cents: number }[];
  tickets: number;
  resaleListings: number;
};

/** GET /organizer/events/:id/dates/:dateId/cancel-preview (DATES, org admins) */
export type CancelDatePreview = {
  id: string;
  title: string;
  date: EventDate;
  paidOrders: number;
  refundCents: { currency: string; cents: number }[];
  tickets: number;
  resaleListings: number;
  /** it's the last active date: cancelling it cancels the event */
  cancelsEvent: boolean;
  /** a day of a multi-day event: passes for other days too, which get the day's share back and keep working (else undefined) */
  partial?: number;
};

/** POST /organizer/events/:id/dates/:dateId/cancel */
export type CancelDateSummary = {
  status: 'CANCELLED';
  dateId: string;
  eventCancelled: boolean;
  alreadyCancelled: boolean;
  refunded: number;
  failed: { orderId: string; message: string }[];
  totalRefundedCents: Record<string, number> | number;
  ticketsVoided: number;
  listingsCancelled: number;
};

/** POST /organizer/events/:id/cancel */
export type CancelSummary = {
  status: 'CANCELLED';
  alreadyCancelled: boolean;
  refunded: number;
  failed: { orderId: string; message: string }[];
  totalRefundedCents: Record<string, number>;
  ticketsVoided: number;
  listingsCancelled: number;
  holdsReleased: number;
};

/* ---------- hooks ---------- */

const enc = encodeURIComponent;
/** Organizer data needs the session: wait for it (a cold start from a notification restores it first). */
const useSignedIn = () => !!useAuth().user;

export function useOrgEvents(orgId: string | undefined, enabled = true) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'events', orgId], queryFn: () => api<OrgEvent[]>(`/organizer/orgs/${enc(orgId!)}/events`), enabled: on && !!orgId && enabled, staleTime: 30_000 });
}

export function useRecentOrders(orgId: string | undefined, enabled = true) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'recent', orgId], queryFn: () => api<RecentOrder[]>(`/organizer/orgs/${enc(orgId!)}/orders/recent`), enabled: on && !!orgId && enabled, staleTime: 30_000 });
}

export function usePayouts(orgId: string | undefined, enabled = true) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'payouts', orgId], queryFn: () => api<Payouts>(`/organizer/orgs/${enc(orgId!)}/payouts`), enabled: on && !!orgId && enabled, staleTime: 60_000 });
}

export function useOrgEvent(id: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'event', id], queryFn: () => api<OrgEventDetail>(`/organizer/events/${enc(id!)}`), enabled: on && !!id, staleTime: 15_000 });
}

export function useEventStats(id: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'stats', id], queryFn: () => api<EventStats>(`/organizer/events/${enc(id!)}/stats${qs({ days: 30 })}`), enabled: on && !!id, staleTime: 15_000 });
}

export function usePriceDrops(id: string | undefined, enabled = true) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'price-drops', id], queryFn: () => api<PriceDrops>(`/organizer/events/${enc(id!)}/price-drops`), enabled: on && !!id && enabled, staleTime: 60_000, retry: 0 });
}

/** The event's scan guarantee refunds (read-only; `enabled` for admins and managers, door staff get 403). */
export function useGuaranteeRefunds(id: string | undefined, enabled = true) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'guarantee-refunds', id], queryFn: () => api<GuaranteeRefunds>(`/organizer/events/${enc(id!)}/guarantee-refunds`), enabled: on && !!id && enabled, staleTime: 60_000, retry: 0 });
}

/** `date`: multiple dates, that date's tickets (DATES) or the tickets valid that day (DAYS; status is then "entered that day"). */
export function useAttendees(id: string | undefined, q: string, status: '' | 'checked-in' | 'not-checked-in', type: '' | 'paid' | 'comp' = '', date = '') {
  const on = useSignedIn();
  return useQuery({
    queryKey: ['organizer', 'attendees', id, q, status, type, date],
    queryFn: ({ signal }) => api<Attendee[]>(`/organizer/events/${enc(id!)}/attendees${qs({ q: q.trim() || undefined, status: status || undefined, type: type || undefined, date: date || undefined })}`, { signal }),
    enabled: on && !!id,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

/** The orders with a donation on the event (admins, managers and door staff; others get 403/404, so no retry). */
export function useEventDonations(id: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'donations', id], queryFn: () => api<EventDonations>(`/organizer/events/${enc(id!)}/donations`), enabled: on && !!id, staleTime: 15_000, retry: 0 });
}

/** The event's comps (admins, managers and door staff). */
export function useComps(id: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'comps', id], queryFn: () => api<CompList>(`/organizer/events/${enc(id!)}/comps`), enabled: on && !!id, staleTime: 10_000 });
}

/** The event's guest list (admins, managers and door staff); `q` searches name, email and group. */
export function useGuestList(id: string | undefined, q = '') {
  const on = useSignedIn();
  return useQuery({
    queryKey: ['organizer', 'guest-list', id, q.trim()],
    queryFn: ({ signal }) => api<GuestList>(`/organizer/events/${enc(id!)}/guest-list${qs({ q: q.trim() || undefined })}`, { signal }),
    enabled: on && !!id,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

export function usePromos(id: string | undefined, enabled = true) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'promos', id], queryFn: () => api<Promo[]>(`/organizer/events/${enc(id!)}/promos`), enabled: on && !!id && enabled });
}

export function useTeam(orgId: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: ['organizer', 'team', orgId], queryFn: () => api<TeamMember[]>(`/organizer/orgs/${enc(orgId!)}/team`), enabled: on && !!orgId });
}

/** Daily exchange rates (GET /fx/rates), for totals across events priced in different currencies. */
export type Rates = { base: string; rates: Record<string, number> };
export function useRates(enabled = true) {
  return useQuery({ queryKey: ['fx', 'rates'], queryFn: () => api<Rates>('/fx/rates'), enabled, staleTime: 60 * 60_000, retry: 1 });
}

/** Approximate conversion between currencies (minor units), as the website's; null when a rate is missing. */
export function convert(cents: number, from: string, to: string, rates: Rates | null | undefined) {
  if (from === to) return cents;
  const a = rates?.rates[from];
  const b = rates?.rates[to];
  if (!a || !b) return null;
  return Math.round((cents / a) * b);
}

/** The team's membership for an org (the role decides what the screens show). */
export const membershipOf = (orgs: MyOrg[] | undefined, orgId: string | undefined) => orgs?.find((o) => o.org.id === orgId);

/* ---------- status ---------- */

export type EventStatus = 'On sale' | 'Paused' | 'Sold out' | 'Ended' | 'In review' | 'Rejected' | 'Draft' | 'Cancelled';

/**
 * As the website's statusOf (org-data.ts). Times are wall-clock UTC, so "ended" compares the date as stored. An event
 * with more than one date has ended when its last active date has started.
 */
export function statusOf(e: { status: OrgStatus; startsAt: string; salesPaused: boolean; sold: number; capacity: number; dateMode?: string; dates?: EventDate[] }, now = Date.now()): EventStatus {
  if (e.status === 'CANCELLED') return 'Cancelled';
  if (new Date(lastStart(e)).getTime() < now) return 'Ended';
  if (e.status === 'DRAFT') return 'Draft';
  if (e.status === 'IN_REVIEW') return 'In review';
  if (e.status === 'REJECTED') return 'Rejected';
  if (e.capacity > 0 && e.sold >= e.capacity) return 'Sold out';
  if (e.salesPaused) return 'Paused';
  return 'On sale';
}

export const STATUS_TONE: Record<EventStatus, 'plain' | 'accent' | 'success' | 'warning'> = {
  'On sale': 'success',
  Paused: 'warning',
  'Sold out': 'accent',
  Ended: 'plain',
  'In review': 'warning',
  Rejected: 'accent',
  Draft: 'plain',
  Cancelled: 'accent',
};

/* ---------- multiple dates ---------- */

/** The last active date's start (the event's own start for one date). */
export function lastStart(e: { startsAt: string; dateMode?: string; dates?: EventDate[] }) {
  const live = (e.dates ?? []).filter((d) => d.status !== 'CANCELLED');
  if (!e.dateMode || e.dateMode === 'SINGLE' || !live.length) return e.startsAt;
  return live.map((d) => d.startsAt).sort().pop()!;
}

/**
 * DATES events store one ticket type per tier and date (copies share `tierKey`). The tiers as the organizer thinks of
 * them: one entry per tier with the copy on the earliest active date as its face, every copy, and the totals.
 */
export function tiersOf<T extends OrgTicketType>(types: T[], dates: EventDate[] = []): { tier: T; copies: T[]; sold: number; capacity: number }[] {
  const order = new Map(dates.map((d, i) => [d.id, d.status === 'CANCELLED' ? 1000 + i : i]));
  const groups = new Map<string, T[]>();
  for (const t of types) groups.set(t.tierKey ?? t.id, [...(groups.get(t.tierKey ?? t.id) ?? []), t]);
  return [...groups.values()]
    .map((copies) => {
      const sorted = [...copies].sort((a, b) => (order.get(a.eventDateId ?? '') ?? 0) - (order.get(b.eventDateId ?? '') ?? 0));
      return { tier: sorted[0], copies: sorted, sold: copies.reduce((n, c) => n + c.sold, 0), capacity: copies.reduce((n, c) => n + c.capacity, 0) };
    })
    .sort((a, b) => a.tier.sortOrder - b.tier.sortOrder);
}

/* ---------- money ---------- */

/** The organizer fee (the API's ORGANIZER_FEE_PERMILLE default and the website's FEE_PERMILLE). */
export const FEE_PERMILLE = 35;

/** All-in price for an organizer's base price, as the API's buyerPrice. */
export function buyerPrice(baseCents: number, feeMode: 'BUYER' | 'ORGANIZER') {
  if (baseCents <= 0) return 0;
  return feeMode === 'BUYER' ? Math.round((baseCents * (1000 + FEE_PERMILLE)) / 1000) : baseCents;
}

/** What the organizer gets per ticket, as the API's organizerNet. */
export function organizerNet(priceCents: number, feeMode: 'BUYER' | 'ORGANIZER') {
  if (priceCents <= 0) return 0;
  if (feeMode === 'BUYER') return Math.round((priceCents * 1000) / (1000 + FEE_PERMILLE));
  return priceCents - Math.round((priceCents * FEE_PERMILLE) / 1000);
}

/** The base price that gives this all-in price (the website's baseFromAllIn): edits show what fans pay. */
export function baseFromAllIn(allInCents: number, feeMode: 'BUYER' | 'ORGANIZER') {
  if (feeMode === 'ORGANIZER' || allInCents <= 0) return allInCents;
  const base = Math.round((allInCents * 1000) / (1000 + FEE_PERMILLE));
  for (const d of [0, 1, -1]) if (buyerPrice(base + d, feeMode) === allInCents) return base + d;
  return base;
}

/** "25", "25.5" → cents; null when it isn't a price. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** cents → "25" or "25.50" for an input. */
export const moneyInput = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/* ---------- currencies, countries and zones ---------- */

/** What events can be priced in (the website's CURRENCIES). Paystack for NGN, GHS, KES and ZAR; Stripe for the rest. */
export const CURRENCIES = [
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'GHS', name: 'Ghanaian cedi' },
  { code: 'KES', name: 'Kenyan shilling' },
  { code: 'ZAR', name: 'South African rand' },
] as const;

/** Countries offered for a venue (the rest can be typed as a 2-letter code). */
export const VENUE_COUNTRIES = ['NG', 'GH', 'KE', 'ZA', 'US', 'GB', 'CA', 'AU', 'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'AE'];

/**
 * Countries with more than one time zone: the API would otherwise use the country's main zone (no map position on
 * the phone), so the organizer picks one. Times entered are wall-clock times in this zone.
 */
export const COUNTRY_ZONES: Record<string, { id: string; label: string }[]> = {
  US: [
    { id: 'America/New_York', label: 'Eastern' },
    { id: 'America/Chicago', label: 'Central' },
    { id: 'America/Denver', label: 'Mountain' },
    { id: 'America/Phoenix', label: 'Arizona' },
    { id: 'America/Los_Angeles', label: 'Pacific' },
    { id: 'America/Anchorage', label: 'Alaska' },
    { id: 'Pacific/Honolulu', label: 'Hawaii' },
  ],
  CA: [
    { id: 'America/Toronto', label: 'Eastern' },
    { id: 'America/Winnipeg', label: 'Central' },
    { id: 'America/Edmonton', label: 'Mountain' },
    { id: 'America/Vancouver', label: 'Pacific' },
    { id: 'America/Halifax', label: 'Atlantic' },
    { id: 'America/St_Johns', label: 'Newfoundland' },
  ],
  AU: [
    { id: 'Australia/Sydney', label: 'Sydney, Canberra' },
    { id: 'Australia/Melbourne', label: 'Melbourne' },
    { id: 'Australia/Brisbane', label: 'Brisbane' },
    { id: 'Australia/Adelaide', label: 'Adelaide' },
    { id: 'Australia/Darwin', label: 'Darwin' },
    { id: 'Australia/Perth', label: 'Perth' },
    { id: 'Australia/Hobart', label: 'Hobart' },
  ],
};

/** This device's IANA zone ('' when the runtime can't tell). */
export function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/* ---------- wall-clock times ---------- */

/** Stored event times are the venue's wall-clock time written as UTC: "2026-12-27T20:00:00.000Z" is 8 PM there. */
export const wallIso = (date: string, time: string) => `${date}T${time}:00.000Z`;
/** "2026-12-27" and "20:00" from a stored time. */
export const wallParts = (iso: string | null | undefined) => (iso ? { date: iso.slice(0, 10), time: iso.slice(11, 16) } : null);

/* ---------- the website ---------- */

/** Opens a website page in the in-app browser (seat maps, payouts, branding: the heavy work stays on the web). */
export function openWeb(path: string) {
  haptic.select();
  void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined);
}

export const webPaths = {
  event: (id: string) => `/organizer/events/${enc(id)}`,
  seating: (id: string) => `/organizer/events/${enc(id)}/seating`,
  payouts: '/organizer/payouts',
  settings: '/organizer/settings',
  create: '/create',
};

/** The event's public page, or its private preview before it's published. */
export function publicLink(e: { slug: string; status: OrgStatus; previewToken?: string | null }) {
  return e.status === 'PUBLISHED' || !e.previewToken ? `${WEB_URL}/events/${e.slug}` : `${WEB_URL}/events/${e.slug}?preview=${enc(e.previewToken)}`;
}
