/**
 * Selling and transferring rules and wording, as on the website (eventro components/my-resale.tsx): the organizer's
 * rules for an event, why an action is off, transfer expiry, the resale price breakdown and payout labels.
 */
import { ownTimes } from './dates';
import { isPast, money, when } from './format';
import type { MyListing, Ticket } from './types';

/** Eventro's share of each resale, per mille, unless the API says otherwise (GET /me/tickets → resaleFeePermille). */
export const RESALE_FEE_PERMILLE = 50;
export const permille = (cents: number, pm: number) => Math.round((cents * pm) / 1000);
export const fmt = (cents: number, currency: string) => money(cents, currency, { decimals: true });

/** What we know about an event's rules. `undefined` = not known; a `capPercent` of null = no cap. */
export type Rules = {
  resaleEnabled: boolean | undefined;
  capPercent: number | null | undefined;
  royaltyPermille: number | undefined;
  transfersEnabled: boolean | undefined;
  cutoffMinutes: number | undefined;
};

export const rulesOf = (e: Ticket['event'], learnedCap?: number): Rules => ({
  resaleEnabled: e.resaleEnabled,
  capPercent: e.resaleCapPercent !== undefined ? e.resaleCapPercent : learnedCap,
  royaltyPermille: e.resaleRoyaltyPermille,
  transfersEnabled: e.transfersEnabled,
  cutoffMinutes: e.transferCutoffMinutes,
});

/** "1 hour", "30 minutes", "2 days" */
export function span(minutes: number) {
  if (minutes % 1440 === 0 && minutes >= 1440) return minutes === 1440 ? '1 day' : `${minutes / 1440} days`;
  if (minutes % 60 === 0 && minutes >= 60) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** "in 3 days", "in 5 hours", "in 12 min" */
export function inTime(ms: number) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h} ${h === 1 ? 'hour' : 'hours'}`;
  const d = Math.round(h / 24);
  return `in ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** Resale and transfers stop `cutoff` minutes before the start (wall-clock UTC, compared like the API does). */
export const closedNow = (startsAt: string, cutoffMinutes: number | undefined, now: number) =>
  cutoffMinutes !== undefined && now > new Date(startsAt).getTime() - cutoffMinutes * 60_000;

/**
 * Why a ticket can't be sold or transferred right now ('' = it can, as far as we know). Multiple dates: the cut-offs
 * run from the ticket's own date (DATES) or its first valid day (DAYS), as the API's do.
 */
export function blockers(t: Ticket, rules: Rules, now: number) {
  if (t.event.status === 'CANCELLED' || t.date?.status === 'CANCELLED') {
    const why = t.event.status === 'CANCELLED' ? 'This event was cancelled, so its tickets can’t be sold or sent.' : 'This date was cancelled, so its tickets can’t be sold or sent.';
    return { sell: why, transfer: why };
  }
  const start = ownTimes(t, t.event).startsAt;
  if (isPast(start, 6)) {
    const why = t.date ? 'This date has already happened.' : t.validDates?.length ? 'This pass has already been used from its first day.' : 'This event has already happened.';
    return { sell: why, transfer: why };
  }
  const closed = closedNow(start, rules.cutoffMinutes, now);
  const before = rules.cutoffMinutes ? `${span(rules.cutoffMinutes)} before the start` : 'at the start';
  return {
    sell:
      rules.resaleEnabled === false
        ? 'The organizer doesn’t allow resale for this event.'
        : closed
          ? `Resale closed ${before}.`
          : t.ownerId === null
            ? 'This ticket is held under your email but isn’t in your account yet, so it can’t be sold from here.'
            : '',
    transfer: rules.transfersEnabled === false ? 'The organizer doesn’t allow transfers for this event.' : closed ? `Transfers closed ${before}.` : '',
  };
}

/** One line for a ticket card when both or either action is off. */
export function blockedLine(b: { sell: string; transfer: string }) {
  if (b.sell && b.sell === b.transfer) return b.sell;
  if (b.sell && b.transfer && b.sell.startsWith('Resale closed')) return b.sell.replace('Resale closed', 'Resale and transfers closed');
  return [b.transfer, b.sell].filter(Boolean).join(' ');
}

/** "If they don’t accept within 7 days (or 1 hour before the start, if that’s sooner), it comes back to you." */
export const transferTerms = (cutoffMinutes?: number) =>
  `If they don’t accept within 7 days${cutoffMinutes !== undefined ? ` (or ${cutoffMinutes ? `${span(cutoffMinutes)} before the start` : 'by the start'}, if that’s sooner)` : ', or by the organizer’s cutoff before the event'}, it comes back to you.`;

/**
 * "Expires in 3 days" for a pending transfer. When the expiry falls exactly on a whole number of minutes before the
 * start, it was set by the organizer's cutoff (the week-long default lands on an arbitrary second), so we say so.
 */
export function transferExpiry(expiresAt: string | null | undefined, startsAt: string, now: number, cutoffMinutes?: number) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt).getTime();
  const gap = new Date(startsAt).getTime() - exp;
  const atCutoff = cutoffMinutes !== undefined ? gap === cutoffMinutes * 60_000 : gap >= 0 && gap % 60_000 === 0 && gap <= 10_080 * 60_000;
  const rel = exp - now <= 0 ? 'any moment now' : inTime(exp - now);
  return {
    text: `Expires ${rel}`,
    detail: atCutoff ? `That’s the organizer’s cutoff, ${gap ? `${span(Math.round(gap / 60_000))} before the start` : 'when the event starts'}.` : 'If it isn’t accepted by then, it comes back to you.',
    soon: exp - now < 24 * 3600_000,
  };
}

/** "12% above face value", "At face value", "8% below face value" */
export function vsFace(priceCents: number, faceCents: number) {
  if (!faceCents) return { pct: 0, text: 'Resale price' };
  const pct = Math.round(((priceCents - faceCents) / faceCents) * 100);
  return { pct, text: pct === 0 ? 'At face value' : pct > 0 ? `${pct}% above face value` : `${-pct}% below face value` };
}

/** The sell sheet's numbers for a price. `royalty` is null when the organizer's share isn't known. */
export function breakdown(cents: number, feePermille: number, royaltyPermille: number | undefined) {
  const fee = permille(cents, feePermille);
  const royalty = royaltyPermille !== undefined ? permille(cents, royaltyPermille) : null;
  return { fee, royalty, payout: Math.max(0, cents - fee - (royalty ?? 0)) };
}

/** The cap in cents (null = no cap or unknown). */
export const capCentsOf = (faceCents: number, capPercent: number | null | undefined) => (capPercent === undefined || capPercent === null ? null : Math.floor((faceCents * capPercent) / 100));

/** Price presets: face value, +10%, +25% (under the cap) and the cap itself. */
export function presets(faceCents: number, capCents: number | null): [string, number][] {
  const out: [string, number][] = [['Face value', faceCents]];
  for (const [label, pct] of [['+10%', 110], ['+25%', 125]] as const) {
    const c = Math.round((faceCents * pct) / 100);
    if (capCents === null || c < capCents) out.push([label, c]);
  }
  if (capCents !== null && capCents > faceCents) out.push(['Max allowed', capCents]);
  return out;
}

export const pct = (pm: number) => `${(pm / 10).toFixed(pm % 10 ? 1 : 0)}%`;

const SHORT = (iso: string) => {
  const d = new Date(iso);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
};
export const shortDate = SHORT;

export const LISTING_CHIP: Record<MyListing['status'], [string, 'accent' | 'warning' | 'success' | 'plain']> = {
  ACTIVE: ['Listed', 'accent'],
  HELD: ['Held', 'warning'],
  SOLD: ['Sold', 'success'],
  CANCELLED: ['Cancelled', 'plain'],
};

export function payoutLabel(l: Pick<MyListing, 'payoutStatus' | 'payoutAvailableAt' | 'paidOutAt'>): [string, 'accent' | 'warning' | 'success' | 'plain'] | null {
  switch (l.payoutStatus) {
    case 'PENDING':
      return [l.payoutAvailableAt ? `Pending until ${when(l.payoutAvailableAt).short}` : 'Pending', 'warning'];
    case 'AVAILABLE':
      return ['Available', 'plain'];
    case 'PAID':
      return [l.paidOutAt ? `Paid ${SHORT(l.paidOutAt)}` : 'Paid', 'success'];
    case 'HELD':
      return ['On hold', 'accent'];
    default:
      return null;
  }
}

/** Sums by currency: "$120.00" or "₦45,000.00 + $20.00". */
export function sumBy(rows: MyListing[], pick: (l: MyListing) => number) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? 0) + pick(r));
  const parts = [...m.entries()].filter(([, v]) => v > 0).map(([c, v]) => fmt(v, c));
  return parts.length ? parts.join(' + ') : fmt(0, rows[0]?.currency ?? 'USD');
}
