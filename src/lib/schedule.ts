/**
 * The event schedule (agenda) and bookable sessions (eventro-be src/schedule):
 *
 *   Fans        GET /events/:slug `schedule` and `stages`; GET /me/tickets `sessions` per ticket (what it has booked);
 *               GET /tickets/:id/sessions (what a ticket can book, with a status each); POST/DELETE
 *               /tickets/:id/sessions/:itemId to book or cancel a place.
 *   Organizers  GET/PUT /organizer/events/:id/schedule (full list), …/schedule/:itemId/reservations, session check-in
 *               by code or by tapping a booking (and undo). Stats add `sessions`.
 *
 * Times are the venue's wall clock stored as UTC, like every event time (format.ts `when`). DATES/DAYS items belong to
 * one date or day (`eventDateId`); a SINGLE event's items have none. Events without a schedule get `[]` everywhere.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';
import { when } from './format';

export type ScheduleKind = 'PERFORMANCE' | 'TALK' | 'WORKSHOP' | 'BREAK' | 'OTHER';
export const KINDS: { id: ScheduleKind; label: string }[] = [
  { id: 'PERFORMANCE', label: 'Performance' },
  { id: 'TALK', label: 'Talk' },
  { id: 'WORKSHOP', label: 'Workshop' },
  { id: 'BREAK', label: 'Break' },
  { id: 'OTHER', label: 'Other' },
];

/** One schedule item as fans see it (GET /events/:slug `schedule`). `capacity`/`placesLeft` are null unless bookable. */
export type ScheduleItem = {
  id: string;
  eventDateId: string | null;
  startsAt: string;
  endsAt: string | null;
  title: string;
  note: string;
  stage: string | null;
  people: string[];
  kind: ScheduleKind;
  bookable: boolean;
  capacity: number | null;
  placesLeft: number | null;
  /** empty: any ticket for that date or day */
  eligibleTierNames: string[];
};

export type SessionStatus = 'BOOKED' | 'OPEN' | 'FULL' | 'CLOSED' | 'NOT_ELIGIBLE' | 'CLASH';

/** GET /tickets/:id/sessions items: what this ticket can book. `reason` is a sentence for NOT_ELIGIBLE and CLASH. */
export type TicketSessionItem = ScheduleItem & { status: SessionStatus; reason: string | null; reservationId: string | null; checkedIn: boolean };
export type TicketSessions = { ticketId: string; items: TicketSessionItem[] };

/** GET /me/tickets: a ticket's booked sessions, by time. */
export type BookedSession = { reservationId: string; itemId: string; title: string; startsAt: string; endsAt: string | null; stage: string | null; checkedIn: boolean };

/** GET/PUT /organizer/events/:id/schedule items. `eligibleTiers`: TicketType ids (SINGLE/DAYS) or tier keys (DATES). */
export type OrganizerItem = ScheduleItem & { sortOrder: number; eligibleTiers: string[]; reserved: number; checkedIn: number };

/** GET /organizer/events/:id/stats `sessions` (bookable live items by time). */
export type SessionStat = { itemId: string; title: string; startsAt: string; capacity: number; reserved: number; checkedIn: number };

/** GET …/schedule/:itemId/reservations (active bookings, oldest first). */
export type Reservation = { reservationId: string; ticketId: string; holderName: string; holderEmail: string; ticketType: string; createdAt: string; checkedInAt: string | null };
export type Reservations = { item: OrganizerItem; items: Reservation[] };

/** POST …/schedule/:itemId/check-in (and a booking's own check-in). */
export type SessionCheckIn = {
  result: 'ADMIT' | 'ALREADY_IN' | 'NOT_BOOKED' | 'WRONG_DATE' | 'INVALID';
  message: string;
  ticket?: { id: string; holderName: string; ticketType: string; eventDateId: string | null } | null;
  reservation?: { id: string; itemId: string; ticketId: string; createdAt: string; checkedInAt: string | null } | null;
};

/* ---------- reading ---------- */

/** "10:30 – 11:30 AM", "11:30 AM – 12:30 PM", or "8:00 PM" without an end. */
export function timeRange(startsAt: string, endsAt: string | null | undefined) {
  const a = when(startsAt).time;
  if (!endsAt) return a;
  const b = when(endsAt).time;
  const [at, ap] = a.split(' ');
  const [bt, bp] = b.split(' ');
  return ap === bp ? `${at} – ${bt} ${bp}` : `${a} – ${b}`;
}

/** "12 places left" / "1 place left" / "Full" for a bookable item. */
export function placesText(left: number | null | undefined) {
  if (left === null || left === undefined) return '';
  if (left <= 0) return 'Full';
  return `${left} ${left === 1 ? 'place' : 'places'} left`;
}

/**
 * The schedule grouped for showing: one group per date/day (DATES/DAYS, in date order, items on cancelled dates are
 * already left out by the API), or one group for a SINGLE event. Items keep the API's order (start, then position).
 */
export function groupSchedule<T extends { eventDateId: string | null; startsAt: string }>(items: T[], dates: { id: string; startsAt: string; label?: string | null; status?: string }[] = []) {
  const live = dates.filter((d) => d.status !== 'CANCELLED');
  if (!live.length || items.every((i) => !i.eventDateId)) return [{ dateId: null as string | null, items }];
  return [...live]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((d) => ({ dateId: d.id as string | null, items: items.filter((i) => i.eventDateId === d.id) }))
    .filter((g) => g.items.length);
}

/** A short line for a fan's session status (the reasons for NOT_ELIGIBLE and CLASH come from the API). */
export function statusText(s: Pick<TicketSessionItem, 'status' | 'reason' | 'placesLeft' | 'checkedIn'>) {
  switch (s.status) {
    case 'BOOKED':
      return s.checkedIn ? 'Booked · checked in' : 'Booked';
    case 'FULL':
      return 'This session is full.';
    case 'CLOSED':
      return 'Booking closed when it started.';
    case 'NOT_ELIGIBLE':
    case 'CLASH':
      return s.reason ?? (s.status === 'CLASH' ? 'You’ve booked another session at that time.' : 'This ticket can’t book it.');
    default:
      return placesText(s.placesLeft);
  }
}

/* ---------- hooks ---------- */

const enc = encodeURIComponent;

/** What a ticket can book (signed-in holders). `enabled` false while offline or for tickets that can't book. */
export function useTicketSessions(ticketId: string | undefined, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['me', 'sessions', ticketId],
    queryFn: () => api<TicketSessions>(`/tickets/${enc(ticketId!)}/sessions`),
    enabled: !!user && !!ticketId && enabled,
    staleTime: 15_000,
    retry: 0,
  });
}

/** The organizer's schedule (DOOR and up). `refetchMs` keeps its counts fresh (the door's session check-in). */
export function useOrgSchedule(eventId: string | undefined, enabled = true, refetchMs: number | false = false) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['organizer', 'schedule', eventId],
    queryFn: () => api<{ items: OrganizerItem[] }>(`/organizer/events/${enc(eventId!)}/schedule`),
    enabled: !!user && !!eventId && enabled,
    staleTime: 15_000,
    refetchInterval: refetchMs,
    retry: 0,
  });
}

/** The door's full-screen answer for a session check-in (see the door's Result). */
export function sessionVerdict(a: SessionCheckIn, title: string) {
  const ticket = a.ticket ? { id: a.ticket.id, holderName: a.ticket.holderName, ticketType: a.ticket.ticketType, section: null, row: null, seat: null } : null;
  const line = a.ticket ? `${a.ticket.ticketType} · ${title}` : undefined;
  switch (a.result) {
    case 'ADMIT':
      return { tone: 'admit' as const, title: 'Admit', ticket, line, detail: `Booked for ${title}.` };
    case 'ALREADY_IN':
      return { tone: 'already' as const, title: 'Already in', ticket, line, detail: a.message };
    case 'NOT_BOOKED':
      return { tone: 'invalid' as const, title: 'Not booked', ticket, line, detail: a.message };
    case 'WRONG_DATE':
      return { tone: 'wrong' as const, title: 'Wrong date', ticket, line, detail: a.message };
    default:
      return { tone: 'invalid' as const, title: 'Not valid', ticket, line, detail: a.message };
  }
}

/** One session's bookings (DOOR and up). */
export function useReservations(eventId: string | undefined, itemId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['organizer', 'reservations', eventId, itemId],
    queryFn: () => api<Reservations>(`/organizer/events/${enc(eventId!)}/schedule/${enc(itemId!)}/reservations`),
    enabled: !!user && !!eventId && !!itemId,
    staleTime: 5_000,
  });
}

/* ---------- fan actions ---------- */

export const bookSession = (ticketId: string, itemId: string) => api<{ id: string; item: ScheduleItem }>(`/tickets/${enc(ticketId)}/sessions/${enc(itemId)}`, { method: 'POST' });
export const cancelSession = (ticketId: string, itemId: string) => api<null>(`/tickets/${enc(ticketId)}/sessions/${enc(itemId)}`, { method: 'DELETE' });

/* ---------- organizer actions ---------- */

export const checkInSession = (eventId: string, itemId: string, code: string) =>
  api<SessionCheckIn>(`/organizer/events/${enc(eventId)}/schedule/${enc(itemId)}/check-in`, { body: { code }, timeoutMs: 8000 });
export const checkInBooking = (eventId: string, itemId: string, reservationId: string) =>
  api<SessionCheckIn>(`/organizer/events/${enc(eventId)}/schedule/${enc(itemId)}/reservations/${enc(reservationId)}/check-in`, { method: 'POST' });
export const undoBooking = (eventId: string, itemId: string, reservationId: string) =>
  api<{ reservation: SessionCheckIn['reservation'] }>(`/organizer/events/${enc(eventId)}/schedule/${enc(itemId)}/reservations/${enc(reservationId)}/check-in`, { method: 'DELETE' });
