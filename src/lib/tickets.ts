/**
 * Wallet helpers: grouping tickets by event and describing each ticket's state (wording from the website's my-tickets).
 * Multiple dates (lib/dates.ts): DATES tickets group by event and date (each performance is its own card, upcoming or
 * past by its own date); DAYS passes group by event and are past after their last day.
 */
import { ownTimes, type TicketDate } from './dates';
import { isPast, money, when } from './format';
import type { Ticket } from './types';

export type TicketGroup = {
  /** the slug, or slug:dateId for a DATES performance */
  key: string;
  slug: string;
  event: Ticket['event'];
  tickets: Ticket[];
  past: boolean;
  cancelled: boolean;
  refunded: boolean;
  /** DATES: the performance these tickets are for */
  date: TicketDate | null;
  /** when the group starts (its date, or the first day of its passes) and its last day */
  start: string;
  last: string;
};

export function groupTickets(tickets: Ticket[]): { upcoming: TicketGroup[]; past: TicketGroup[] } {
  const by = new Map<string, TicketGroup>();
  for (const t of tickets) {
    const key = t.date ? `${t.event.slug}:${t.date.id}` : t.event.slug;
    const own = ownTimes(t, t.event);
    const g = by.get(key);
    if (g) {
      g.tickets.push(t);
      if (own.startsAt < g.start) g.start = own.startsAt;
      if (own.last > g.last) g.last = own.last;
    } else
      by.set(key, {
        key,
        slug: t.event.slug,
        event: t.event,
        tickets: [t],
        past: false,
        cancelled: t.event.status === 'CANCELLED' || t.date?.status === 'CANCELLED',
        refunded: t.order.status === 'REFUNDED',
        date: t.date ?? null,
        start: own.startsAt,
        last: own.last,
      });
  }
  const all = [...by.values()].map((g) => ({ ...g, past: isPast(g.last, 8) }));
  return {
    upcoming: all.filter((g) => !g.past).sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || a.start.localeCompare(b.start)),
    past: all.filter((g) => g.past).sort((a, b) => b.start.localeCompare(a.start)),
  };
}

/** A DAYS pass already scanned in on one day that still works on a later one (the QR seed stays). */
export const reentry = (t: Ticket) => t.status === 'CHECKED_IN' && !!t.validDates?.length && !!t.qrSeed && !isPast(ownTimes(t, t.event).last, 8);

/** The event's currency (GET /me/tickets has it on the event; older answers only had the order's). */
export const ticketCurrency = (t: Pick<Ticket, 'event' | 'order'>) => t.event.currency ?? t.order.currency;

/** "Lower Level 104 · Row A · Seat 3", or "General admission". */
export function seatLine(t: Pick<Ticket, 'sectionName' | 'section' | 'row' | 'seat'>) {
  const section = t.sectionName ?? (t.section ? `Section ${t.section}` : null);
  if (t.row && t.seat) return [section, `Row ${t.row}`, `Seat ${t.seat}`].filter(Boolean).join(' · ');
  return section ? `${section} · General admission` : 'General admission';
}

export type TicketState = { key: 'ready' | 'cancelled' | 'used' | 'ended' | 'gift' | 'sent' | 'listed' | 'refunded'; label: string; detail: string; tone: 'success' | 'accent' | 'plain' | 'warning' };

export function ticketState(t: Ticket): TicketState {
  // GET /me/tickets returns a VOID ticket only when it has an Eventro Guarantee claim (refunded under the guarantee),
  // its event was cancelled, or (multiple dates) its date was cancelled (both shown as cancelled below).
  const dateGone = t.date?.status === 'CANCELLED' && t.event.status !== 'CANCELLED';
  if (t.status === 'VOID' && (t.guarantee?.claim || (t.event.status !== 'CANCELLED' && !dateGone))) {
    const claim = t.guarantee?.claim;
    const refunded = claim?.status === 'APPROVED';
    return {
      key: 'refunded',
      label: refunded ? (claim.refundStatus === 'REFUNDED' ? 'Refunded · Eventro Guarantee' : 'Refund approved · Eventro Guarantee') : 'No longer valid',
      detail: refunded ? 'Refunded under the Eventro Guarantee. This ticket no longer works.' : 'This ticket no longer works.',
      tone: 'plain',
    };
  }
  if (t.event.status === 'CANCELLED') {
    const refunded = t.order.status === 'REFUNDED';
    return { key: 'cancelled', label: refunded ? 'Event cancelled · refunded' : 'Event cancelled · refund pending', detail: refunded ? 'Refunded. This ticket no longer works.' : 'Refund on its way. This ticket no longer works.', tone: 'accent' };
  }
  // Multiple dates: one performance cancelled (its orders are refunded in full).
  if (dateGone) {
    const refunded = t.order.status === 'REFUNDED' || t.order.status === 'PARTIALLY_REFUNDED' || t.status === 'VOID';
    return { key: 'cancelled', label: refunded ? 'Date cancelled · refunded' : 'Date cancelled · refund pending', detail: refunded ? 'This date was cancelled and you were refunded. This ticket no longer works.' : 'This date was cancelled. Your refund is on its way.', tone: 'accent' };
  }
  // A multi-day pass scanned in on one day still opens the door on its other days.
  if (reentry(t)) return { key: 'ready', label: 'Ready', detail: `Scanned in${t.checkedInAt ? ` ${when(t.checkedInAt).short}` : ''}. It works again on its other days.`, tone: 'success' };
  if (t.status === 'CHECKED_IN') return { key: 'used', label: 'Scanned at the door', detail: 'Enjoy the show!', tone: 'plain' };
  if (isPast(ownTimes(t, t.event).last, 8)) return { key: 'ended', label: t.date ? 'Date ended' : 'Event ended', detail: 'Thanks for going!', tone: 'plain' };
  if (t.status === 'TRANSFER_PENDING' && t.order.gift) {
    return { key: 'gift', label: `Gift for ${t.order.gift.recipientName}`, detail: t.order.gift.sentAt ? 'Held until they open it. No QR code until then.' : 'Held until it’s delivered. No QR code until then.', tone: 'warning' };
  }
  if (t.status === 'TRANSFER_PENDING') return { key: 'sent', label: `Sent to ${t.transferTo ?? 'a friend'}`, detail: 'Waiting for them to accept.', tone: 'warning' };
  if (t.status === 'LISTED') return { key: 'listed', label: `Listed for ${money(t.listCents ?? 0, ticketCurrency(t))}`, detail: 'Your QR code is off while it’s listed for resale.', tone: 'warning' };
  return { key: 'ready', label: 'Ready', detail: 'Show this code at the door.', tone: 'success' };
}
