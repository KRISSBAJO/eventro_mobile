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
 */
import { api } from './api';
import { checkCode, parseCode } from './door-code';
import { isPast } from './format';
import type { CheckInAnswer, DoorPack, DoorPackTicket, DoorTicket, SyncAnswer } from './types';
import { listVault, readVault, writeVault } from './vault';

export type QueuedScan = { ticketId: string; scannedAt: string; code?: string };

/** A scan the API answered differently from this phone (another scanner was first, or the code was refused). */
export type Conflict = { ticketId: string; holderName: string | null; scannedAt: string; kind: 'already' | 'invalid'; at?: string | null; by?: string | null; device?: string | null; reason?: string };

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
};

const key = (eventId: string) => `door-${eventId.replace(/[^\w-]/g, '_')}`;

export const emptyStore = (eventId: string): DoorStore => ({ eventId, pack: null, packAt: null, localIn: {}, queue: [], conflicts: [], lastSyncAt: null });

export async function loadDoor(eventId: string): Promise<DoorStore> {
  const s = await readVault<DoorStore>(key(eventId));
  return s && s.eventId === eventId ? { ...emptyStore(eventId), ...s } : emptyStore(eventId);
}

export const saveDoor = (s: DoorStore) => writeVault(key(s.eventId), s);
export const dropDoor = (eventId: string) => writeVault(key(eventId), null);

/** Event ids with a door pack or queued scans on this phone. */
export const savedDoorEvents = () => listVault('door-').map((n) => n.slice('door-'.length));

/** Deletes packs for events that are over (12 h after the start) once nothing is waiting to sync. */
export async function sweepEndedDoors() {
  for (const id of savedDoorEvents()) {
    const s = await readVault<DoorStore>(`door-${id}`);
    if (!s) continue;
    const ended = s.pack ? isPast(s.pack.startsAt, 12) : true;
    if (ended && !s.queue?.length) await writeVault(`door-${id}`, null);
  }
}

export async function downloadPack(eventId: string): Promise<DoorPack> {
  return api<DoorPack>(`/organizer/events/${encodeURIComponent(eventId)}/door-pack`, { timeoutMs: 60_000 });
}

/* ---------- verdicts ---------- */

export type Verdict = {
  tone: 'admit' | 'already' | 'invalid';
  title: string;
  ticket?: DoorTicket | null;
  detail?: string;
  /** checked against the downloaded list rather than the API */
  offline?: boolean;
  /** what "Undo" reverses */
  undo?: { ticketId: string; offline: boolean };
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

const view = (t: DoorPackTicket): DoorTicket => ({ id: t.id, holderName: t.holderName, ticketType: t.ticketType, section: t.sectionName ?? t.section, row: t.row, seat: t.seat });

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
  const ticket = a.ticket ? { ...a.ticket, section: fromPack?.sectionName ?? a.ticket.section } : null;
  if (a.result === 'ok') return { tone: 'admit', title: 'Admit', ticket, undo: a.ticket ? { ticketId: a.ticket.id, offline: false } : undefined };
  if (a.result === 'duplicate') return { tone: 'already', title: 'Already scanned', ticket, detail: firstScanText(a, deviceId, fromPack) };
  return { tone: 'invalid', title: 'Not valid', ticket, detail: a.message };
}

/**
 * Offline: checks a scanned code (or a typed ticket id when `manual`) against the door pack and this phone's own
 * check-ins. Admitting returns the scan to queue; the caller saves it.
 */
export function verifyOffline(s: DoorStore, raw: string, now = Date.now(), manual = false): { verdict: Verdict; scan?: QueuedScan } {
  const pack = s.pack;
  if (!pack) return { verdict: { tone: 'invalid', title: 'Not valid', detail: 'Download the door list to check tickets offline.', offline: true } };
  const p = parseCode(raw);
  const id = (p ? p.ticketId : raw.trim()).toUpperCase();
  if (!p && !manual) return { verdict: { tone: 'invalid', title: 'Not valid', detail: 'Not a valid Eventro code.', offline: true } };
  const t = pack.tickets.find((x) => x.id === id);
  if (!t) return { verdict: { tone: 'invalid', title: 'Not valid', detail: p ? 'Not a valid Eventro code.' : 'Ticket not found for this event.', offline: true } };
  if (p) {
    const c = checkCode(p, t.seed, now);
    // A code made from an older seed (before a transfer) or for another ticket fails the signature.
    if (c === 'bad-signature') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'Not a valid Eventro code. If the ticket changed hands, ask them to refresh their app.', offline: true } };
    if (c === 'expired') return { verdict: { tone: 'invalid', title: 'Code expired', ticket: view(t), detail: 'This code has expired. Ask them to reopen the ticket. (Screenshots won’t scan.)', offline: true } };
  }
  const mine = s.localIn[t.id];
  if (mine) return { verdict: { tone: 'already', title: 'Already scanned', ticket: view(t), detail: `Already scanned at ${clock(mine)} on this device.`, offline: true } };
  if (t.status === 'CHECKED_IN') {
    return { verdict: { tone: 'already', title: 'Already scanned', ticket: view(t), detail: `Already scanned at ${clock(t.checkedInAt)}${t.checkedInDevice ? ' on another scanner' : ''}.`, offline: true } };
  }
  if (t.status === 'VOID') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'This ticket was refunded or cancelled.', offline: true } };
  if (t.status === 'TRANSFER_PENDING') return { verdict: { tone: 'invalid', title: 'Not valid', ticket: view(t), detail: 'This ticket is being transferred.', offline: true } };
  // ACTIVE or LISTED (the online check-in admits listed tickets too).
  const scannedAt = new Date(now).toISOString();
  return {
    verdict: { tone: 'admit', title: 'Admit', ticket: view(t), offline: true, undo: { ticketId: t.id, offline: true } },
    scan: { ticketId: t.id, scannedAt, ...(p ? { code: raw.trim() } : {}) },
  };
}

/** Records an offline admission in the store (returns a new store). */
export const admitLocally = (s: DoorStore, scan: QueuedScan): DoorStore => ({ ...s, localIn: { ...s.localIn, [scan.ticketId]: scan.scannedAt }, queue: [...s.queue, scan] });

/** Reverses an offline admission that hasn't synced yet. */
export function undoLocal(s: DoorStore, ticketId: string): DoorStore {
  const localIn = { ...s.localIn };
  delete localIn[ticketId];
  return { ...s, localIn, queue: s.queue.filter((q) => q.ticketId !== ticketId) };
}

/** The pack after the API admitted a ticket online (so an offline fallback knows). */
export function markPack(s: DoorStore, ticketId: string, at: string, deviceId: string | null): DoorStore {
  if (!s.pack) return s;
  return { ...s, pack: { ...s.pack, tickets: s.pack.tickets.map((t) => (t.id === ticketId ? { ...t, status: 'CHECKED_IN', checkedInAt: at, checkedInDevice: deviceId } : t)) } };
}

/** The pack after an online undo. */
export function unmarkPack(s: DoorStore, ticketId: string): DoorStore {
  if (!s.pack) return s;
  return { ...s, pack: { ...s.pack, tickets: s.pack.tickets.map((t) => (t.id === ticketId && t.status === 'CHECKED_IN' ? { ...t, status: 'ACTIVE', checkedInAt: null, checkedInDevice: null } : t)) } };
}

const REASON: Record<string, string> = {
  unknown: 'Ticket not found.',
  'wrong-event': 'This ticket is for a different event.',
  void: 'This ticket was refunded or cancelled.',
  'transfer-pending': 'This ticket is being transferred.',
  'bad-code': 'The code didn’t match the ticket (it may have changed hands).',
  'expired-code': 'The code was too old when it was scanned.',
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
        next = markPack(next, res.ticketId, res.checkedInAt ?? scan.scannedAt, res.checkedInDevice ?? deviceId);
      } else if (res.result === 'already') {
        found.push({ ticketId: res.ticketId, holderName: name, scannedAt: scan.scannedAt, kind: 'already', at: res.checkedInAt, by: res.checkedInBy?.name ?? null, device: res.checkedInDevice ?? null });
        next = markPack(next, res.ticketId, res.checkedInAt ?? scan.scannedAt, res.checkedInDevice ?? null);
      } else {
        found.push({ ticketId: res.ticketId, holderName: name, scannedAt: scan.scannedAt, kind: 'invalid', reason: res.reason });
      }
    }
    store = next;
  }
  store = { ...store, conflicts: [...found, ...store.conflicts].slice(0, 200), lastSyncAt: Date.now() };
  return { store, synced, conflicts: found };
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
  for (const id of savedDoorEvents()) n += (await readVault<DoorStore>(`door-${id}`))?.queue?.length ?? 0;
  return n;
}
