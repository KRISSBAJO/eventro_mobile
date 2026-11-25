/**
 * A fan-resale listing the buyer is holding (POST /resale/:id/hold), carried from the event screen to the resale
 * checkout, as on the website (eventro components/resale-hold.ts).
 *
 * The hold key is what lets this buyer create the order, so it never goes in the route: it stays in memory for this
 * app session (and in sessionStorage on the web build, so a reload of the checkout tab keeps it). A held listing
 * drops out of GET /events/:slug/resale, so the seat, prices and tier travel with it.
 */
import { Platform } from 'react-native';
import type { ResaleHoldCreated, ResaleListing } from './types';

export type ResaleHold = {
  listingId: string;
  holdKey: string;
  /** ISO time the hold runs out (10 minutes after it was made) */
  heldUntil: string;
  priceCents: number;
  faceCents: number;
  currency: string;
  slug: string;
  ticketType: ResaleListing['ticketType'];
  sectionName: string | null;
  row: string | null;
  seat: number | null;
};

const holds = new Map<string, ResaleHold>();
const key = (id: string) => `eventro:resale-hold:${id}`;
const session = () => {
  if (Platform.OS !== 'web') return null;
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
};

/** The hold as the checkout needs it: the API's answer plus what the listing said. */
export const holdFrom = (h: ResaleHoldCreated, l: ResaleListing, slug: string): ResaleHold => ({
  listingId: h.listingId,
  holdKey: h.holdKey,
  heldUntil: h.heldUntil,
  priceCents: h.priceCents,
  faceCents: l.faceCents,
  currency: h.currency,
  slug,
  ticketType: l.ticketType,
  sectionName: l.sectionName ?? null,
  row: l.row ?? null,
  seat: l.seat ?? null,
});

export function saveResaleHold(h: ResaleHold) {
  holds.set(h.listingId, h);
  try {
    session()?.setItem(key(h.listingId), JSON.stringify(h));
  } catch {
    /* storage blocked: memory still has it */
  }
}

export function readResaleHold(id: string): ResaleHold | null {
  const mem = holds.get(id);
  if (mem) return mem;
  try {
    const raw = session()?.getItem(key(id));
    const h = raw ? (JSON.parse(raw) as ResaleHold) : null;
    return h && h.listingId === id && typeof h.holdKey === 'string' ? h : null;
  } catch {
    return null;
  }
}

export function clearResaleHold(id: string) {
  holds.delete(id);
  try {
    session()?.removeItem(key(id));
  } catch {
    /* nothing to clear */
  }
}

/** A hold this buyer still has on one of the event's listings (left checkout before paying), latest first. */
export function liveHoldFor(slug: string, now: number): ResaleHold | null {
  let best: ResaleHold | null = null;
  for (const h of holds.values()) {
    if (h.slug !== slug || new Date(h.heldUntil).getTime() <= now) continue;
    if (!best || h.heldUntil > best.heldUntil) best = h;
  }
  return best;
}

/** "Section 104 · Row C · Seat 12", or the ticket type for general admission. */
export const seatText = (l: { sectionName?: string | null; row?: string | null; seat?: number | null }, fallback: string) =>
  [l.sectionName, l.row ? `Row ${l.row}` : '', l.seat ? `Seat ${l.seat}` : ''].filter(Boolean).join(' · ') || fallback;

/** The hold's error in plain words (POST /resale/:id/hold), as the website says it. */
export function holdErrorText(message: string) {
  if (/someone else/i.test(message)) return 'Someone else is checking out with that ticket right now. Pick another one, or check back in a few minutes.';
  if (/own listing/i.test(message)) return 'That’s your own listing. You can change or remove it from Sales & payouts.';
  if (/closed/i.test(message)) return 'Resale has closed for this event.';
  if (/isn.t available|not found/i.test(message)) return 'That ticket just sold. Here’s what’s still available.';
  return message;
}
