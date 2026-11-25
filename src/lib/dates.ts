/**
 * Events with more than one date (eventro-be src/domain/event-dates.ts): `dateMode`
 *
 *   SINGLE  one date (every event before this): the event's own startsAt/doorsAt/endsAt. Nothing here changes it.
 *   DATES   "Multiple dates", a run of separate performances. Fans pick a date, then that date's tiers (each tier has a
 *           copy per date: TicketType.eventDateId, copies share `tierKey`). A ticket is for one date (`date`).
 *   DAYS    "Multi-day event", a festival or conference. Ticket types are valid on one or more days (validDateIds);
 *           a ticket shows the days it admits on (`validDates`) and admits once per day.
 *
 * For DATES and DAYS the event's startsAt/doorsAt/endsAt are a summary (earliest active start, latest end). Times are
 * the venue's wall clock stored as UTC, like every other event time (format.ts `when`).
 */
import { isPast, when } from './format';

export type DateMode = 'SINGLE' | 'DATES' | 'DAYS';

/** One date of an event (GET /events/:slug, organizer views), in startsAt order. */
export type EventDate = {
  id: string;
  startsAt: string;
  doorsAt: string | null;
  endsAt: string | null;
  label: string | null;
  status: 'ACTIVE' | 'CANCELLED' | string;
  /** DATES, public: tickets left on that date (its copies together) */
  available?: number;
  /** DATES, public: active, not started, nothing left */
  soldOut?: boolean;
};

/** A DATES ticket's performance (tickets, orders, holds, gifts, resale). */
export type TicketDate = {
  id: string;
  startsAt: string;
  doorsAt: string | null;
  endsAt: string | null;
  label: string | null;
  status?: string;
  /** a cancelled date (GET /me/tickets keeps its voided tickets): when and why */
  cancelledAt?: string | null;
  cancelReason?: string | null;
};
/** A day a DAYS ticket admits on. */
export type ValidDate = { id: string; startsAt: string; label: string | null; status?: string };

/** What every ticket-shaped answer adds: `date` (DATES) and `validDates` (DAYS). Older APIs leave both out. */
export type Dated = { date?: TicketDate | null; validDates?: ValidDate[] };

/** The event-level fields (GET /events/:slug, organizer events). */
export type DatedEvent = { dateMode?: DateMode | string; dates?: EventDate[] };

/** Below this many tickets left, a date says "Few left". */
export const FEW_LEFT = 20;

export const isMulti = (mode: string | null | undefined): mode is 'DATES' | 'DAYS' => mode === 'DATES' || mode === 'DAYS';
export const activeOnly = <T extends { status?: string }>(dates: T[] | undefined) => (dates ?? []).filter((d) => d.status !== 'CANCELLED');
const byStart = <T extends { startsAt: string }>(a: T, b: T) => a.startsAt.localeCompare(b.startsAt);

/** "Sat 13" (DAYS chips and lists). */
export const shortDay = (iso: string) => {
  const d = when(iso);
  return `${d.dow} ${d.day}`;
};

/** "Sat, Dec 13 · 8:00 PM · Matinee" */
export function dateLine(d: { startsAt: string; label?: string | null }, opts: { time?: boolean; label?: boolean } = {}) {
  const w = when(d.startsAt);
  return [w.short, opts.time === false ? null : w.time, opts.label === false ? null : d.label || null].filter(Boolean).join(' · ');
}

/** "Sat 12, Sun 13" (one day: "Sat, Dec 13"). */
export function daysList(days: { startsAt: string }[], sep = ', ') {
  const sorted = [...days].sort(byStart);
  if (sorted.length === 1) return when(sorted[0].startsAt).short;
  return sorted.map((d) => shortDay(d.startsAt)).join(sep);
}

/** What a DAYS ticket type covers, for its card: "Sat 12 + Sun 13", or "All 3 days". */
export function coverLine(validIds: string[], dates: EventDate[]) {
  const live = activeOnly(dates);
  const days = live.filter((d) => validIds.includes(d.id));
  if (!days.length) return '';
  if (live.length > 1 && days.length === live.length) return `All ${live.length} days`;
  return daysList(days, ' + ');
}

/** "Fri, Dec 12 – Sun, Dec 14" for a run of dates (one date: just it). */
export function rangeLine(dates: { startsAt: string }[]) {
  const sorted = [...dates].sort(byStart);
  if (!sorted.length) return '';
  const a = when(sorted[0].startsAt);
  const b = when(sorted[sorted.length - 1].startsAt);
  return a.ymd === b.ymd ? a.short : `${a.short} – ${b.short}`;
}

/**
 * When a ticket-shaped thing is: its own date (DATES), its first valid day (DAYS), or the event's start. `last` is the
 * last day it's good for (DAYS), for "has it ended" and payouts.
 */
export function ownTimes(x: Dated, event: { startsAt: string; doorsAt?: string | null }) {
  if (x.date) return { startsAt: x.date.startsAt, doorsAt: x.date.doorsAt, last: x.date.startsAt };
  const days = [...activeOnly(x.validDates)].sort(byStart);
  if (days.length) return { startsAt: days[0].startsAt, doorsAt: null, last: days[days.length - 1].startsAt };
  return { startsAt: event.startsAt, doorsAt: event.doorsAt ?? null, last: event.startsAt };
}

/**
 * The when-line for a ticket, order, hold, gift or listing: "Sat, Dec 13 · 8:00 PM · Matinee" (DATES),
 * "Valid Sat 12, Sun 13" (DAYS), or the event's "Sat, Dec 13 · 8:00 PM". `days` is true for a DAYS line (no time).
 */
export function ticketWhen(x: Dated, eventStartsAt: string, opts: { time?: boolean } = {}) {
  if (x.date) return { line: dateLine(x.date, { time: opts.time }), startsAt: x.date.startsAt, days: false };
  const days = x.validDates ?? [];
  if (days.length) return { line: `Valid ${daysList(days)}`, startsAt: [...days].sort(byStart)[0].startsAt, days: true };
  const w = when(eventStartsAt);
  return { line: opts.time === false ? w.short : `${w.short} · ${w.time}`, startsAt: eventStartsAt, days: false };
}

/** The event's dates still to come (for the date picker and "is it over"). */
export function upcoming(dates: EventDate[] | undefined, graceHours = 3) {
  return activeOnly(dates).filter((d) => !isPast(d.startsAt, graceHours));
}

/** A multi-date event is over when its last active date is; a SINGLE one as before. */
export function eventEnded(e: DatedEvent & { startsAt: string }, graceHours = 3) {
  if (!isMulti(e.dateMode)) return isPast(e.startsAt, graceHours);
  const live = activeOnly(e.dates);
  if (!live.length) return isPast(e.startsAt, graceHours);
  return live.every((d) => isPast(d.startsAt, graceHours));
}

/** List cards: the start to show (the first upcoming date for DATES/DAYS) and "+2 more dates" / "3 days". */
export function cardWhen(c: { startsAt: string; dateMode?: string; nextDate?: { id: string; startsAt: string } | null; dateCount?: number }) {
  const startsAt = c.nextDate?.startsAt ?? c.startsAt;
  const n = c.dateCount ?? 0;
  const more = c.dateMode === 'DATES' && n > 1 ? `+${n - 1} more ${n - 1 === 1 ? 'date' : 'dates'}` : c.dateMode === 'DAYS' && n > 1 ? `${n} days` : null;
  return { startsAt, more };
}

/** "Few left" / "Sold out" / null for a DATES date. */
export function dateStock(d: EventDate) {
  if (d.status === 'CANCELLED') return 'Cancelled';
  if (d.soldOut || d.available === 0) return 'Sold out';
  if (d.available !== undefined && d.available <= FEW_LEFT) return 'Few left';
  return null;
}
