/**
 * Door scanning for organizer teams.
 *
 * Online, each scan goes to POST /organizer/events/:id/check-in. For a venue with no signal, "Download for offline"
 * saves the event's door pack (GET …/door-pack: every ticket with its QR seed) in the encrypted vault; scans are
 * then checked on the phone (door-code.ts, current window ±1), remembered in a local checked-in set and queued.
 * The queue goes up with POST …/check-ins/sync whenever the API can be reached (and on "Sync now"); the API's
 * answer says which scans were first and which another scanner had already let in.
 *
 * The pack holds secrets, so it's deleted when the team member leaves the event, signs out, or the event is over
 * (12 hours after the start), as long as nothing is waiting to sync.
 *
 * The guest list (people with no ticket: name, plus-ones, group) works the same way. Online, a check-in is
 * POST …/guest-list/:entryId/check-in { guests, deviceId } and "−" is POST …/undo. The door pack carries the list
 * (`guestList`), so with no signal a check-in is applied on the phone against it (never past the party size) and
 * queued with its own random `opId`; the queue goes up with POST …/guest-list/sync { deviceId, checkIns }, which
 * applies each opId once (sending one again is a harmless replay). Each answer carries the entry as the API now has
 * it, which replaces the phone's copy; check-ins refused because everyone was already in (another scanner got there
 * first) or the entry was removed become conflicts. Offline "−" can only take back this phone's check-ins that haven't
 * been sent yet (and aren't being sent right now); arrivals Omoshow already has need a connection to undo.
 *
 * Multiple dates (lib/dates.ts): the door works on one date at a time (`dateId`: the API's current date, or the one
 * picked). Online scans, manual check-ins and synced scans carry `eventDateId`. Offline, a run's ticket (DATES) is
 * only good on its own date and a multi-day pass (DAYS) on its valid days, once per day: the pack has each ticket's
 * `eventDateId` / `validDateIds` and its entries per date (`checkIns`), and this phone's own admissions are kept per
 * ticket and date (`inKey`). Anything else is a "Wrong date" result, as the API's `wrong-date`.
 */
import * as Crypto from 'expo-crypto';
import { api } from './api';
import { checkCode, parseCode } from './door-code';
import { dateLine, daysList, type EventDate } from './dates';
import { isPast } from './format';
import type { CheckInAnswer, DoorPack, DoorPackTicket, DoorTicket, GuestEntry, GuestSyncAnswer, SyncAnswer } from './types';
import { listVault, readVault, writeVault } from './vault';

/** `eventDateId`: the door's date when it was scanned (multiple dates). */
export type QueuedScan = { ticketId: string; scannedAt: string; code?: string; eventDateId?: string };

/** This phone's admissions are kept per ticket, and per date for events with more than one. */
export const inKey = (ticketId: string, dateId?: string | null) => (dateId ? `${ticketId}@${dateId}` : ticketId);

/* ---------- the door's date ---------- */

/** The venue's wall clock now, written as UTC like stored event times (this phone's own clock without a zone). */
export function wallNow(tz: string | null | undefined, now = new Date()) {
  try {
    if (tz && tz !== 'UTC') {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const p: Record<string, number> = {};
      for (const x of f.formatToParts(now)) if (x.type !== 'literal') p[x.type] = Number(x.value);
      return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute));
    }
  } catch {
    /* fall through to the phone's clock */
  }
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()));
}

/**
 * The date the door works on by default, as the API's doorDate: the active date on today's calendar day at the venue
 * (the latest one that has started), else one still running, else the next one, else the last.
 */
export function defaultDoorDate(dates: EventDate[] | undefined, tz: string | null | undefined, now = new Date()): EventDate | null {
  const live = (dates ?? []).filter((d) => d.status !== 'CANCELLED').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (!live.length) return null;
  const wall = wallNow(tz, now);
  const today = wall.toISOString().slice(0, 10);
  const on = live.filter((d) => d.startsAt.slice(0, 10) === today);
  if (on.length) return [...on].reverse().find((d) => new Date(d.startsAt) <= wall) ?? on[0];
  const running = live.find((d) => new Date(d.startsAt) <= wall && new Date(d.endsAt ?? new Date(new Date(d.startsAt).getTime() + 6 * 3600_000).toISOString()) >= wall);
  if (running) return running;
  return live.find((d) => new Date(d.startsAt) > wall) ?? live[live.length - 1];
}

/** A scan the API answered differently from this phone (another scanner was first, or the code was refused). */
export type Conflict = { ticketId: string; holderName: string | null; scannedAt: string; kind: 'already' | 'invalid'; at?: string | null; by?: string | null; device?: string | null; reason?: string };

/** A guest-list check-in made on this phone with no signal, waiting to sync. `at` is this phone's clock. */
export type QueuedGuest = { opId: string; entryId: string; guests: number; at: string };

/** A queued guest check-in the API didn't apply: everyone was already in, or the entry is gone. */
export type GuestConflict = { opId: string; entryId: string; name: string | null; guests: number; at: string; kind: 'full' | 'invalid'; reason?: string; here?: string };

export type DoorStore = {
  eventId: string;
  pack: DoorPack | null;
  /** when the pack was downloaded (this phone's clock) */
  packAt: number | null;
  /** tickets this phone let in while offline: ticket id → ISO time */
  localIn: Record<string, string>;
  queue: QueuedScan[];
  conflicts: Conflict[];
  lastSyncAt: number | null;
  /** guest-list check-ins made offline, oldest first (not yet in the pack's guest list) */
  guestQueue: QueuedGuest[];
  guestConflicts: GuestConflict[];
};

const key = (eventId: string) => `door-${eventId.replace(/[^\w-]/g, '_')}`;

export const emptyStore = (eventId: string): DoorStore => ({ eventId, pack: null, packAt: null, localIn: {}, queue: [], conflicts: [], lastSyncAt: null, guestQueue: [], guestConflicts: [] });

export async function loadDoor(eventId: string): Promise<DoorStore> {
  const s = await readVault<DoorStore>(key(eventId));
  return s && s.eventId === eventId ? { ...emptyStore(eventId), ...s } : emptyStore(eventId);
}

export const saveDoor = (s: DoorStore) => writeVault(key(s.eventId), s);
export const dropDoor = (eventId: string) => writeVault(key(eventId), null);

/** Event ids with a door pack or queued scans on this phone. */
export const savedDoorEvents = () => listVault('door-').map((n) => n.slice('door-'.length));

/** Deletes packs for events that are over (12 h after the (last) start) once nothing is waiting to sync. */
export async function sweepEndedDoors() {
  for (const id of savedDoorEvents()) {
    const s = await readVault<DoorStore>(`door-${id}`);
    if (!s) continue;
    const last = (s.pack?.dates ?? []).filter((d) => d.status !== 'CANCELLED').map((d) => d.startsAt).sort().pop();
    const ended = s.pack ? isPast(last ?? s.pack.startsAt, 12) : true;
    if (ended && !s.queue?.length && !s.guestQueue?.length) await writeVault(`door-${id}`, null);
  }
}

export async function downloadPack(eventId: string): Promise<DoorPack> {
  return api<DoorPack>(`/organizer/events/${encodeURIComponent(eventId)}/door-pack`, { timeoutMs: 60_000 });
}

/* ---------- verdicts ---------- */

export type Verdict = {
  /** wrong: a ticket for another date (DATES) or a pass not valid on the door's date (DAYS) */
  tone: 'admit' | 'already' | 'invalid' | 'wrong';
  title: string;
  ticket?: DoorTicket | null;
  detail?: string;
  /** checked against the downloaded list rather than the API */
  offline?: boolean;
  /** what "Undo" reverses (and on which date) */
  undo?: { ticketId: string; offline: boolean; dateId?: string | null };
  /** the line under the name instead of "type · seat" (session check-in: the ticket type and the session) */
  line?: string;
};

export const seatText = (t: { sectionName?: string | null; section: string | null; row: string | null; seat: number | null }) =>
  [t.sectionName ?? (t.section ? `Section ${t.section}` : null), t.row ? `Row ${t.row}` : null, t.seat ? `Seat ${t.seat}` : null].filter(Boolean).join(' · ') || 'General admission';

/** "9:41 PM" today, "Sat 9:41 PM" otherwise (this phone's time). */
export function clock(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours();
  const t = `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const today = new Date().toDateString() === d.toDateString();
  return today ? t : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${t}`;
}

const viewOf = (t: DoorPackTicket, dates: EventDate[] = []): DoorTicket => ({
  id: t.id,
  holderName: t.holderName,
  ticketType: t.ticketType,
  section: t.sectionName ?? t.section,
  row: t.row,
  seat: t.seat,
  comp: !!t.comp,
  compGroup: t.compGroup ?? null,
  // multiple dates: its date, or the days it's good for
  date: t.eventDateId ? (dates.find((d) => d.id === t.eventDateId) ?? null) : null,
  validDates: (t.validDateIds ?? []).map((id) => dates.find((d) => d.id === id)).filter((d): d is EventDate => !!d),
});

/** "This ticket is for Sat, Dec 13 · 8:00 PM" / "Valid Sat 12, Sun 13" for a ticket on the wrong date. */
export function wrongDateText(t: Pick<DoorTicket, 'date' | 'validDates'> | null | undefined, fallback?: string) {
  if (t?.date) return `This ticket is for ${dateLine(t.date)}.`;
  if (t?.validDates?.length) return `Not valid today. Valid ${daysList(t.validDates)}.`;
  return fallback ?? 'This ticket isn’t for this date.';
}

/** "Comp · Press" (or "Comp") for a complimentary ticket, null for a paid one. */
export const compLabel = (t: { comp?: boolean; compGroup?: string | null } | null | undefined) => (t?.comp ? (t.compGroup ? `Comp · ${t.compGroup}` : 'Comp') : null);

/** "Already scanned at 7:42 PM by Sam (other device)." from the API's answer (the pack fills in for older APIs). */
export function firstScanText(a: Pick<CheckInAnswer, 'checkedInAt' | 'checkedInBy' | 'checkedInDevice'>, deviceId: string, fromPack?: DoorPackTicket) {
  const at = a.checkedInAt ?? fromPack?.checkedInAt;
  if (!at) return 'This ticket was already checked in.';
  const device = a.checkedInDevice !== undefined ? a.checkedInDevice : (fromPack?.checkedInDevice ?? null);
  const by = a.checkedInBy?.name ? ` by ${a.checkedInBy.name.trim().split(/\s+/)[0]}` : '';
  return `Already scanned at ${clock(at)}${by}${device === deviceId ? ' on this device' : ' (other device)'}.`;
}

/** Online: what the API said about a scan. */
export function verdictOf(a: CheckInAnswer, deviceId: string, pack: DoorPack | null): Verdict {
  const fromPack = a.ticket ? pack?.tickets.find((t) => t.id === a.ticket!.id) : undefined;
  const ticket = a.ticket ? { ...a.ticket, section: fromPack?.sectionName ?? a.ticket.section, comp: a.ticket.comp ?? fromPack?.comp, compGroup: a.ticket.compGroup ?? fromPack?.compGroup ?? null } : null;
  if (a.result === 'ok') return { tone: 'admit', title: 'Admit', ticket, undo: a.ticket ? { ticketId: a.ticket.id, offline: false, dateId: a.date?.id ?? null } : undefined };
  if (a.result === 'wrong-date') return { tone: 'wrong', title: 'Wrong date', ticket, detail: wrongDateText(a.ticket, a.message) };
  if (a.result === 'duplicate') return { tone: 'already', title: 'Already scanned', ticket, detail: a.date && /today/i.test(a.message) ? `Already in today. ${firstScanText(a, deviceId, fromPack)}` : firstScanText(a, deviceId, fromPack) };
  return { tone: 'invalid', title: 'Not valid', ticket, detail: a.message };
}

/**
 * Offline: checks a scanned code (or a typed ticket id when `manual`) against the door pack and this phone's own
 * check-ins. Admitting returns the scan to queue; the caller saves it. `dateId`: the door's date (multiple dates).
 */
export function verifyOffline(s: DoorStore, raw: string, now = Date.now(), manual = false, dateId: string | null = null): { verdict: Verdict; scan?: QueuedScan } {
  const pack = s.pack;
  if (!pack) return { verdict: { tone: 'invalid', title: 'Not valid', detail: 'Download the door list to check tickets offline.', offline: true } };
  const p = parseCode(raw);
  const id = (p ? p.ticketId : raw.trim()).toUpperCase();
  if (!p && !manual) return { verdict: { tone: 'invalid', title: 'Not valid', detail: 'Not a valid Omoshow code.', offline: true } };
  const t = pack.tickets.find((x) => x.id === id);
  if (!t) return { verdict: { tone: 'invalid', title: 'Not valid', detail: p ? 'Not a valid Omoshow code.' : 'Ticket not found for this event.', offline: true } };
  const dated = (pack.dateMode === 'DATES' || pack.dateMode === 'DAYS') && !!dateId;
  const view = (x: DoorPackTicket) => viewOf(x, pack.dates);
  if (p) {
    const c = checkCode(p, t.seed, now);
    // A code made from an older seed (before a transfer) or for another ticket fails the signature.
    if (c === 'bad-signature') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'Not a valid Omoshow code. If the ticket changed hands, ask them to refresh their app.', offline: true } };
    if (c === 'expired') return { verdict: { tone: 'invalid', title: 'Code expired', ticket: view(t), detail: 'This code has expired. Ask them to reopen the ticket. (Screenshots won’t scan.)', offline: true } };
  }
  if (dated) {
    // The API's order: void, transfer pending, wrong date, already in, admit.
    if (t.status === 'VOID') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'This ticket was refunded or cancelled.', offline: true } };
    if (t.status === 'TRANSFER_PENDING') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'This ticket is being transferred.', offline: true } };
    const ok = pack.dateMode === 'DATES' ? t.eventDateId === dateId : (t.validDateIds ?? []).includes(dateId!);
    if (!ok) return { verdict: { tone: 'wrong', title: 'Wrong date', ticket: view(t), detail: wrongDateText(view(t)), offline: true } };
    const mine = s.localIn[inKey(t.id, dateId)] ?? (pack.dateMode === 'DATES' ? s.localIn[t.id] : undefined);
    if (mine) return { verdict: { tone: 'already', title: 'Already scanned', ticket: view(t), detail: `Already scanned at ${clock(mine)} on this device.`, offline: true } };
    // DAYS: once per day (entries on other days don't count); DATES: once.
    const entry = (t.checkIns ?? []).find((c) => c.eventDateId === dateId);
    if (entry || (pack.dateMode === 'DATES' && t.status === 'CHECKED_IN')) {
      const at = entry?.at ?? t.checkedInAt;
      const device = entry ? entry.deviceId : t.checkedInDevice;
      return { verdict: { tone: 'already', title: 'Already scanned', ticket: view(t), detail: `Already ${pack.dateMode === 'DAYS' ? 'in today' : 'scanned'} at ${clock(at)}${device ? ' on another scanner' : ''}.`, offline: true } };
    }
  } else {
    const mine = s.localIn[t.id];
    if (mine) return { verdict: { tone: 'already', title: 'Already scanned', ticket: view(t), detail: `Already scanned at ${clock(mine)} on this device.`, offline: true } };
    if (t.status === 'CHECKED_IN') {
      return { verdict: { tone: 'already', title: 'Already scanned', ticket: view(t), detail: `Already scanned at ${clock(t.checkedInAt)}${t.checkedInDevice ? ' on another scanner' : ''}.`, offline: true } };
    }
    if (t.status === 'VOID') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'This ticket was refunded or cancelled.', offline: true } };
    if (t.status === 'TRANSFER_PENDING') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'This ticket is being transferred.', offline: true } };
  }
  // ACTIVE or LISTED (the online check-in admits listed tickets too), or a multi-day pass back on another day.
  const scannedAt = new Date(now).toISOString();
  return {
    verdict: { tone: 'admit', title: 'Admit', ticket: view(t), offline: true, undo: { ticketId: t.id, offline: true, dateId: dated ? dateId : null } },
    scan: { ticketId: t.id, scannedAt, ...(p ? { code: raw.trim() } : {}), ...(dated ? { eventDateId: dateId! } : {}) },
  };
}


/** Records an offline admission in the store (returns a new store). */
export const admitLocally = (s: DoorStore, scan: QueuedScan): DoorStore => ({ ...s, localIn: { ...s.localIn, [inKey(scan.ticketId, scan.eventDateId)]: scan.scannedAt }, queue: [...s.queue, scan] });

/** Reverses an offline admission that hasn't synced yet (on `dateId` for events with more than one date). */
export function undoLocal(s: DoorStore, ticketId: string, dateId?: string | null): DoorStore {
  const localIn = { ...s.localIn };
  delete localIn[inKey(ticketId, dateId)];
  return { ...s, localIn, queue: s.queue.filter((q) => !(q.ticketId === ticketId && (!dateId || q.eventDateId === dateId))) };
}

/** The pack after the API admitted a ticket online (so an offline fallback knows); `dateId` records the day's entry. */
export function markPack(s: DoorStore, ticketId: string, at: string, deviceId: string | null, dateId?: string | null): DoorStore {
  if (!s.pack) return s;
  return {
    ...s,
    pack: {
      ...s.pack,
      tickets: s.pack.tickets.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              status: 'CHECKED_IN',
              checkedInAt: t.status === 'CHECKED_IN' && t.checkedInAt ? t.checkedInAt : at,
              checkedInDevice: t.status === 'CHECKED_IN' ? t.checkedInDevice : deviceId,
              ...(dateId ? { checkIns: [...(t.checkIns ?? []).filter((c) => c.eventDateId !== dateId), { eventDateId: dateId, at, deviceId }] } : {}),
            }
          : t,
      ),
    },
  };
}

/** The pack after an online undo (a multi-day pass: that day's entry; it's ACTIVE again once it has none). */
export function unmarkPack(s: DoorStore, ticketId: string, dateId?: string | null): DoorStore {
  if (!s.pack) return s;
  return {
    ...s,
    pack: {
      ...s.pack,
      tickets: s.pack.tickets.map((t) => {
        if (t.id !== ticketId || t.status !== 'CHECKED_IN') return t;
        const left = dateId ? (t.checkIns ?? []).filter((c) => c.eventDateId !== dateId) : [];
        return left.length ? { ...t, checkIns: left } : { ...t, status: 'ACTIVE', checkedInAt: null, checkedInDevice: null, ...(t.checkIns ? { checkIns: [] } : {}) };
      }),
    },
  };
}

const REASON: Record<string, string> = {
  unknown: 'Ticket not found.',
  'wrong-event': 'This ticket is for a different event.',
  void: 'This ticket was refunded or cancelled.',
  'transfer-pending': 'This ticket is being transferred.',
  'bad-code': 'The code didn’t match the ticket (it may have changed hands).',
  'expired-code': 'The code was too old when it was scanned.',
  'wrong-date': 'This ticket isn’t for the date it was scanned on.',
};
export const reasonText = (r?: string) => (r ? (REASON[r] ?? r) : 'Not valid.');

/**
 * Uploads queued scans (500 at a time). Applied scans leave the queue; the ones another scanner had already let in,
 * or the API refused, become conflicts. Throws ApiError (status 0 when offline) and leaves the queue as it was.
 */
export async function syncDoor(s: DoorStore, deviceId: string): Promise<{ store: DoorStore; synced: number; conflicts: Conflict[] }> {
  let store = s;
  let synced = 0;
  const found: Conflict[] = [];
  while (store.queue.length) {
    const batch = store.queue.slice(0, 500);
    const r = await api<SyncAnswer>(`/organizer/events/${encodeURIComponent(s.eventId)}/check-ins/sync`, { body: { deviceId, scans: batch }, timeoutMs: 45_000 });
    let next = { ...store, queue: store.queue.slice(batch.length) };
    for (const res of r.results) {
      const scan = batch[res.index];
      if (!scan) continue;
      const name = res.ticket?.holderName ?? next.pack?.tickets.find((t) => t.id === res.ticketId)?.holderName ?? null;
      if (res.result === 'checked_in') {
        synced++;
        next = markPack(next, res.ticketId, res.checkedInAt ?? scan.scannedAt, res.checkedInDevice ?? deviceId, res.eventDateId ?? scan.eventDateId);
      } else if (res.result === 'already') {
        found.push({ ticketId: res.ticketId, holderName: name, scannedAt: scan.scannedAt, kind: 'already', at: res.checkedInAt, by: res.checkedInBy?.name ?? null, device: res.checkedInDevice ?? null });
        next = markPack(next, res.ticketId, res.checkedInAt ?? scan.scannedAt, res.checkedInDevice ?? null, res.eventDateId ?? scan.eventDateId);
      } else {
        found.push({ ticketId: res.ticketId, holderName: name, scannedAt: scan.scannedAt, kind: 'invalid', reason: res.reason });
      }
    }
    store = next;
  }
  store = { ...store, conflicts: [...found, ...store.conflicts].slice(0, 200), lastSyncAt: Date.now() };
  return { store, synced, conflicts: found };
}

/**
 * syncDoor works on a snapshot (`sent`); this puts its outcome into the store as it is now, so scans made while it
 * was syncing stay queued and checked in on this phone, and a pack refreshed meanwhile is kept.
 */
export function mergeScanSync(current: DoorStore, sent: DoorStore, r: { store: DoorStore; conflicts: Conflict[] }): DoorStore {
  const was = new Set(sent.queue);
  return {
    ...current,
    pack: current.pack === sent.pack ? r.store.pack : current.pack,
    queue: [...r.store.queue, ...current.queue.filter((q) => !was.has(q))],
    conflicts: [...r.conflicts, ...current.conflicts].slice(0, 200),
    lastSyncAt: r.store.lastSyncAt,
  };
}

/* ---------- the guest list ---------- */

/** "2 of 3 here", or who's still to come. */
export const hereText = (e: Pick<GuestEntry, 'arrived' | 'partySize'>) => (e.arrived ? `${e.arrived} of ${e.partySize} here` : e.partySize > 1 ? `Party of ${e.partySize} · not here yet` : 'Not here yet');

/** Entries with this phone's unsynced check-ins added (never past the party size). */
export function withQueued(entries: GuestEntry[], queue: QueuedGuest[]): GuestEntry[] {
  if (!queue.length) return entries;
  const extra = new Map<string, { n: number; at: string }>();
  for (const q of queue) {
    const cur = extra.get(q.entryId);
    extra.set(q.entryId, { n: (cur?.n ?? 0) + q.guests, at: cur?.at ?? q.at });
  }
  return entries.map((e) => {
    const x = extra.get(e.id);
    return x ? { ...e, arrived: Math.min(e.partySize, e.arrived + x.n), firstArrivedAt: e.firstArrivedAt ?? x.at } : e;
  });
}

/** The downloaded guest list as this phone sees it now (its own unsynced check-ins included). */
export const packGuests = (s: DoorStore) => withQueued(s.pack?.guestList ?? [], s.guestQueue);

/** Totals for a list of entries. */
export const guestTotals = (list: GuestEntry[]) => ({ entries: list.length, expected: list.reduce((n, e) => n + e.partySize, 0), arrived: list.reduce((n, e) => n + e.arrived, 0) });

/** Searches name, email and group, like the API's ?q=. */
export const matchesGuest = (e: GuestEntry, q: string) => !q || [e.name, e.email ?? '', e.group ?? ''].some((s) => s.toLowerCase().includes(q.toLowerCase()));

/**
 * Offline: checks `guests` people of an entry in against the downloaded list (as many as are still to come). Admitting
 * returns the store with the check-in queued under a new opId; the caller saves it.
 */
export function checkInGuestOffline(s: DoorStore, entryId: string, guests: number, now = Date.now()): { result: 'ok' | 'full' | 'unknown'; message: string; entry?: GuestEntry; store?: DoorStore } {
  const e = packGuests(s).find((x) => x.id === entryId);
  if (!e) return { result: 'unknown', message: 'Not on the downloaded guest list. Refresh the list when you have signal.' };
  const left = e.partySize - e.arrived;
  if (left <= 0) return { result: 'full', entry: e, message: `Everyone’s already here (${hereText(e)}).` };
  const n = Math.max(1, Math.min(guests, left));
  const op: QueuedGuest = { opId: Crypto.randomUUID(), entryId, guests: n, at: new Date(now).toISOString() };
  const entry = { ...e, arrived: e.arrived + n, firstArrivedAt: e.firstArrivedAt ?? op.at };
  return { result: 'ok', message: hereText(entry), entry, store: { ...s, guestQueue: [...s.guestQueue, op] } };
}

/**
 * Takes one guest back from this phone's latest unsynced check-in for the entry, or null when there's none. Check-ins
 * being sent right now (`sending`) are left alone: the API may already have them.
 */
export function undoGuestLocal(s: DoorStore, entryId: string, sending: ReadonlySet<string>): DoorStore | null {
  for (let i = s.guestQueue.length - 1; i >= 0; i--) {
    const q = s.guestQueue[i];
    if (q.entryId !== entryId || sending.has(q.opId)) continue;
    const guestQueue = [...s.guestQueue];
    if (q.guests > 1) guestQueue[i] = { ...q, guests: q.guests - 1 };
    else guestQueue.splice(i, 1);
    return { ...s, guestQueue };
  }
  return null;
}

/** The pack with the API's latest copy of an entry (after an online check-in or undo, or a sync). */
export function markGuest(s: DoorStore, entry: GuestEntry): DoorStore {
  if (!s.pack?.guestList) return s;
  return { ...s, pack: { ...s.pack, guestList: s.pack.guestList.map((g) => (g.id === entry.id ? entry : g)) } };
}

type GuestAnswered = { op: QueuedGuest; res: GuestSyncAnswer['results'][number] };

/**
 * Sends queued guest check-ins, 500 at a time. Returns what the API answered; at the first failure it stops and
 * returns the error too (what wasn't answered stays queued and goes again next time: the API applies an opId once).
 */
export async function sendGuestQueue(eventId: string, ops: QueuedGuest[], deviceId: string): Promise<{ answered: GuestAnswered[]; error: unknown }> {
  const answered: GuestAnswered[] = [];
  for (let i = 0; i < ops.length; i += 500) {
    const batch = ops.slice(i, i + 500);
    try {
      const r = await api<GuestSyncAnswer>(`/organizer/events/${encodeURIComponent(eventId)}/guest-list/sync`, {
        body: { deviceId, checkIns: batch.map(({ opId, entryId, guests, at }) => ({ opId, entryId, guests, at })) },
        timeoutMs: 45_000,
      });
      for (const res of r.results) {
        const op = batch[res.index]?.opId === res.opId ? batch[res.index] : batch.find((b) => b.opId === res.opId);
        if (op) answered.push({ op, res });
      }
    } catch (e) {
      return { answered, error: e };
    }
  }
  return { answered, error: null };
}

/**
 * Puts the API's answers into the store as it is now: answered check-ins leave the queue (ones made while syncing
 * stay), each entry takes the API's copy, and refusals become conflicts.
 */
export function applyGuestSync(s: DoorStore, answered: GuestAnswered[]): { store: DoorStore; synced: number; conflicts: GuestConflict[] } {
  const done = new Set(answered.map((a) => a.op.opId));
  let next: DoorStore = { ...s, guestQueue: s.guestQueue.filter((q) => !done.has(q.opId)) };
  let synced = 0;
  const found: GuestConflict[] = [];
  for (const { op, res } of answered) {
    if (res.entry) next = markGuest(next, res.entry);
    if (res.result === 'checked_in') {
      synced++;
      continue;
    }
    const name = res.entry?.name ?? s.pack?.guestList?.find((g) => g.id === op.entryId)?.name ?? null;
    found.push({ opId: op.opId, entryId: op.entryId, name, guests: op.guests, at: op.at, kind: res.result === 'full' ? 'full' : 'invalid', reason: res.reason, here: res.entry ? hereText(res.entry) : undefined });
  }
  return { store: { ...next, guestConflicts: [...found, ...next.guestConflicts].slice(0, 200), lastSyncAt: answered.length ? Date.now() : next.lastSyncAt }, synced, conflicts: found };
}

export function guestConflictText(c: GuestConflict) {
  if (c.kind === 'full') return `Everyone was already in when this synced (another scanner got there first)${c.here ? `: ${c.here}` : ''}.`;
  return c.reason === 'wrong-event' ? 'Refused when synced: this entry is for a different event.' : 'Refused when synced: they’re no longer on the guest list.';
}

/** "Already scanned on another device at 9:41 PM by Sam." */
export function conflictText(c: Conflict, deviceId: string) {
  if (c.kind === 'invalid') return `Refused when synced: ${reasonText(c.reason)}`;
  const where = c.device && c.device === deviceId ? 'on this device' : 'on another device';
  return `Already scanned ${where}${c.at ? ` at ${clock(c.at)}` : ''}${c.by ? ` by ${c.by}` : ''}.`;
}

/** Scans on this phone that haven't reached the API yet (sign-out warns before deleting them). */
export async function pendingDoorScans() {
  let n = 0;
  for (const id of savedDoorEvents()) {
    const s = await readVault<DoorStore>(`door-${id}`);
    n += (s?.queue?.length ?? 0) + (s?.guestQueue?.length ?? 0);
  }
  return n;
}
