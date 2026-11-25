/**
 * Venue owners and managers on Omoshow: getting a venue onto Omoshow and running its listing from the app.
 *
 *   GET    /venues?q=                         find a venue to claim (2+ characters; up to 20, `managed` = has a manager)
 *   POST   /venues/:slug/claims               ask to manage a venue that's on Omoshow { role, message, website? }
 *   POST   /me/venues                         add one that isn't (hidden until Omoshow approves; 409 VENUE_EXISTS)
 *   GET    /me/venues                         managed venues and requests (lib/bookings.ts useMyVenues)
 *   PATCH  /me/venues/:id                     the venue's details
 *   GET    /me/venues/:id/listing             terms for hire, weekly hours (PUT saves; missing fields keep their value)
 *   GET    /me/venues/:id/blackouts?from&to   blocked-out times (POST adds, DELETE …/:blackoutId removes)
 *
 * The checks below are the API's own, so most mistakes are caught before anything is sent; the API's message is
 * shown when it still refuses. Times are the venue's wall-clock time written as UTC, like event times.
 */
import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import { useAuth } from './auth';
import { useMyVenues, type ClaimRole, type OpeningHours, type PriceMode } from './bookings';

const enc = encodeURIComponent;

/* ---------- shapes ---------- */

/** GET /venues?q= items */
export type VenueMatch = {
  slug: string;
  name: string;
  address: string;
  city: string;
  region: string | null;
  country: string | null;
  capacity: number | null;
  imageUrl: string | null;
  verified: boolean;
  /** it has an approved manager already */
  managed: boolean;
};

/** GET /me/venues/:id/listing (a venue not listed yet answers the defaults, its country's currency, `exists: false`) */
export type OwnerListing = {
  active: boolean;
  priceMode: PriceMode;
  priceCents: number | null;
  currency: string;
  minHours: number;
  noticeDays: number;
  bufferMinutes: number;
  capacity: number | null;
  amenities: string[];
  rules: string | null;
  photos: { url: string; alt?: string }[] | null;
  instantBook: boolean;
  hours: OpeningHours[] | null;
  exists: boolean;
  timezone: string;
  venueCapacity: number | null;
  hidden: boolean;
};

export type Blackout = { id: string; startsAt: string; endsAt: string; note: string | null };

/** 409 VENUE_EXISTS from POST /me/venues: the venue that's on Omoshow already. */
export type ExistingVenue = { slug: string; name: string; city: string; address: string };

/* ---------- hooks ---------- */

const useSignedIn = () => !!useAuth().user;

export const listingKey = (venueId: string | undefined) => ['me', 'venue-listing', venueId] as const;
export const blackoutsKey = (venueId: string | undefined) => ['me', 'venue-blackouts', venueId] as const;

/** One venue this person manages (from GET /me/venues), with the query for loading and errors. */
export function useManagedVenue(venueId: string | undefined) {
  const { user } = useAuth();
  const q = useMyVenues(user?.id);
  return { q, m: q.data?.managed.find((x) => x.venue.id === venueId) ?? null };
}

export function useOwnerListing(venueId: string | undefined) {
  const on = useSignedIn();
  return useQuery({ queryKey: listingKey(venueId), queryFn: () => api<OwnerListing>(`/me/venues/${enc(venueId!)}/listing`), enabled: on && !!venueId, staleTime: 30_000 });
}

export function useBlackouts(venueId: string | undefined, from: string, to: string) {
  const on = useSignedIn();
  return useQuery({
    queryKey: [...blackoutsKey(venueId), from, to],
    queryFn: () => api<Blackout[]>(`/me/venues/${enc(venueId!)}/blackouts${qs({ from, to })}`),
    enabled: on && !!venueId,
    staleTime: 15_000,
  });
}

/** Venues on Omoshow matching the search (nothing under 2 characters). */
export function useVenueMatches(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['venues', 'find', term.toLowerCase()],
    queryFn: () => api<VenueMatch[]>(`/venues${qs({ q: term })}`),
    enabled: term.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/* ---------- roles ---------- */

export const CLAIM_ROLES: { id: ClaimRole; label: string; sub: string; icon: 'key' | 'user' | 'users' }[] = [
  { id: 'owner', label: 'Owner', sub: 'Own the venue', icon: 'key' },
  { id: 'manager', label: 'Manager', sub: 'Run bookings', icon: 'user' },
  { id: 'staff', label: 'Staff', sub: 'Work there', icon: 'users' },
];
export const CLAIM_ROLE_NAME: Record<string, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

/* ---------- the API's checks ---------- */

/** http(s) links, as the API's IsUrl({ require_protocol }) takes them. */
export const URL_RE = /^https?:\/\/[^\s/$.?#][^\s.]*\.[^\s]+$/i;
/** The API's phone pattern: a country code or digit first, then 6–25 digits, spaces, brackets or dashes. */
export const PHONE_RE = /^[+\d][\d\s()-]{5,24}$/;

export const linkError = (v: string, what: string, max: number) => {
  const t = v.trim();
  if (!t) return '';
  if (!URL_RE.test(t)) return `${what} has to be a full link starting with https://`;
  if (t.length > max) return `${what} is too long (${max} characters at most).`;
  return '';
};

/** A whole number in [min, max] from a field, or an error naming `what`. */
export function wholeIn(v: string, min: number, max: number, what: string): { n: number; error: string } {
  const t = v.replace(/,/g, '').trim();
  const n = Number(t);
  return t && /^\d+$/.test(t) && n >= min && n <= max ? { n, error: '' } : { n: 0, error: `${what}: a whole number from ${min} to ${max.toLocaleString('en-US')}.` };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Problems with a week of opening hours, as the API words them (empty when fine). */
export function hoursProblems(hours: OpeningHours[]): string[] {
  const out: string[] = [];
  const byDay = new Map<number, OpeningHours[]>();
  for (const h of hours) {
    if (!TIME.test(h.open) || h.open === '24:00') out.push(`${DAY_NAMES[h.day] ?? 'A day'}: pick an opening time.`);
    else if (!TIME.test(h.close)) out.push(`${DAY_NAMES[h.day] ?? 'A day'}: pick a closing time.`);
    else if (minutesOf(h.close) <= minutesOf(h.open)) out.push(`${DAY_NAMES[h.day]}: closing has to be after opening. For late nights, close at midnight and open at 12:00 AM the next day.`);
    byDay.set(h.day, [...(byDay.get(h.day) ?? []), h]);
  }
  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => minutesOf(a.open) - minutesOf(b.open));
    for (let i = 1; i < sorted.length; i++) if (minutesOf(sorted[i].open) < minutesOf(sorted[i - 1].close)) out.push(`${DAY_NAMES[day]}: opening hours overlap.`);
  }
  return out;
}

/** Sorted by day (Monday first, as shown) then opening time. */
export const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
export const sortHours = (hours: OpeningHours[]) => [...hours].sort((a, b) => a.day - b.day || minutesOf(a.open) - minutesOf(b.open));
