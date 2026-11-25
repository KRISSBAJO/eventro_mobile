/** Wallet helpers: grouping tickets by event and describing each ticket's state (wording from the website's my-tickets). */
import { isPast, money } from './format';
import type { Ticket } from './types';

export type TicketGroup = { slug: string; event: Ticket['event']; tickets: Ticket[]; past: boolean; cancelled: boolean; refunded: boolean };

export function groupTickets(tickets: Ticket[]): { upcoming: TicketGroup[]; past: TicketGroup[] } {
  const by = new Map<string, TicketGroup>();
  for (const t of tickets) {
    const g = by.get(t.event.slug);
    if (g) g.tickets.push(t);
    else
      by.set(t.event.slug, {
        slug: t.event.slug,
        event: t.event,
        tickets: [t],
        past: isPast(t.event.startsAt, 8),
        cancelled: t.event.status === 'CANCELLED',
        refunded: t.order.status === 'REFUNDED',
      });
  }
  const all = [...by.values()];
  return {
    upcoming: all.filter((g) => !g.past).sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || a.event.startsAt.localeCompare(b.event.startsAt)),
    past: all.filter((g) => g.past).sort((a, b) => b.event.startsAt.localeCompare(a.event.startsAt)),
  };
}

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
  // GET /me/tickets returns a VOID ticket only when it has a resale guarantee claim (refunded under the guarantee).
  if (t.status === 'VOID') {
    const claim = t.guarantee?.claim;
    const refunded = claim?.status === 'APPROVED';
    return {
      key: 'refunded',
      label: refunded ? (claim.refundStatus === 'REFUNDED' ? 'Refunded · resale guarantee' : 'Refund approved · resale guarantee') : 'No longer valid',
      detail: refunded ? 'Refunded under the resale guarantee. This ticket no longer works.' : 'This ticket no longer works.',
      tone: 'plain',
    };
  }
  if (t.event.status === 'CANCELLED') {
    const refunded = t.order.status === 'REFUNDED';
    return { key: 'cancelled', label: refunded ? 'Event cancelled · refunded' : 'Event cancelled · refund pending', detail: refunded ? 'Refunded. This ticket no longer works.' : 'Refund on its way. This ticket no longer works.', tone: 'accent' };
  }
  if (t.status === 'CHECKED_IN') return { key: 'used', label: 'Scanned at the door', detail: 'Enjoy the show!', tone: 'plain' };
  if (isPast(t.event.startsAt, 8)) return { key: 'ended', label: 'Event ended', detail: 'Thanks for going!', tone: 'plain' };
  if (t.status === 'TRANSFER_PENDING' && t.order.gift) {
    return { key: 'gift', label: `Gift for ${t.order.gift.recipientName}`, detail: t.order.gift.sentAt ? 'Held until they open it. No QR code until then.' : 'Held until it’s delivered. No QR code until then.', tone: 'warning' };
  }
  if (t.status === 'TRANSFER_PENDING') return { key: 'sent', label: `Sent to ${t.transferTo ?? 'a friend'}`, detail: 'Waiting for them to accept.', tone: 'warning' };
  if (t.status === 'LISTED') return { key: 'listed', label: `Listed for ${money(t.listCents ?? 0, ticketCurrency(t))}`, detail: 'Your QR code is off while it’s listed for resale.', tone: 'warning' };
  return { key: 'ready', label: 'Ready', detail: 'Show this code at the door.', tone: 'success' };
}
