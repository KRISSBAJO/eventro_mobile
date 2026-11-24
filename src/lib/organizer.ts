/**
 * Organizer tools: the API's shapes (GET/POST … /organizer/*), data hooks, roles and the small calculations the
 * screens share. The website (eventro/components/org-*.tsx) is the reference for how each one behaves.
 *
 * Roles (the API's organizer.service.ts): ADMIN does everything; MANAGER runs events (create, edit, promos, pause,
 * recent orders) but not payouts, the team or cancelling; DOOR only scans tickets.
 */
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { api, qs, WEB_URL } from './api';
import { useAuth } from './auth';
import { haptic } from './haptics';
import type { EventBooking } from './bookings';
import type { Attendee, Category, MyOrg } from './types';
import { colors } from '@/theme';
import type { TierLook } from './tiers';

/* ---------- roles ---------- */

export type OrgRole = 'ADMIN' | 'MANAGER' | 'DOOR';
export const ROLE_NAME: Record<string, string> = { ADMIN: 'Admin', MANAGER: 'Manager', DOOR: 'Door staff' };
export const ROLE_INFO: Record<OrgRole, string> = {
  ADMIN: 'Everything, including payouts, the team and cancelling events.',
  MANAGER: 'Create and edit events, promo codes and sales. No payouts or team.',
  DOOR: 'Scan tickets at the door. Nothing else.',
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
  /** a venue booked on Eventro for this event, or null */
  venueBooking?: EventBooking | null;
  ticketTypes: OrgTicketType[];
  sold: number;
  capacity: number;
  grossCents: number;
  /** 60 days, oldest first, the last entry is today */
  daily: { tickets: number[]; cents: number[] };
};

/** GET /organizer/events/:id (the event row with its venue, promos and media) */
export type OrgEventDetail = {
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
  /** The venue booked on Eventro for this event: it can't be submitted for review until this is CONFIRMED */
  venueBooking?: EventBooking | null;
};

/** GET /organizer/events/:id/stats */
export type EventStats = {
  sold: number;
  capacity: number;
  grossCents: number;
  netCents: number;
  checkedIn: number;
  byTicketType: { id: string; name: string; sold: number; capacity: number; priceCents: number }[];
  daily: { date: string; tickets: number; cents: number }[];
};

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
  history: { salesDate: string; amountCents: number; status: 'PAID' }[];
};

/** GET /organizer/events/:id/price-drops */
export type PriceDrops = {
  watchers: number;
  subscribers: number;
  total: number;
  published: boolean;
  drops: { id: string; ticketName: string; fromCents: number; toCents: number; currency: string; notified: number; skipReason: string | null; createdAt: string }[];
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

export function useAttendees(id: string | undefined, q: string, status: '' | 'checked-in' | 'not-checked-in') {
  const on = useSignedIn();
  return useQuery({
    queryKey: ['organizer', 'attendees', id, q, status],
    queryFn: ({ signal }) => api<Attendee[]>(`/organizer/events/${enc(id!)}/attendees${qs({ q: q.trim() || undefined, status: status || undefined })}`, { signal }),
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

/** As the website's statusOf (org-data.ts). Times are wall-clock UTC, so "ended" compares the date as stored. */
export function statusOf(e: { status: OrgStatus; startsAt: string; salesPaused: boolean; sold: number; capacity: number }, now = Date.now()): EventStatus {
  if (e.status === 'CANCELLED') return 'Cancelled';
  if (new Date(e.startsAt).getTime() < now) return 'Ended';
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
