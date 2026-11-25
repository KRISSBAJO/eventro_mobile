/**
 * The door scanner for one event (team members with the DOOR role or higher).
 *
 *   Online   each scan → POST /organizer/events/:id/check-in (with this phone's device id); "Undo" reverses the last.
 *   Offline  "Download for offline" saves the door pack; codes are checked on the phone against each ticket's seed,
 *            admissions are queued and synced (POST …/check-ins/sync) when the API can be reached, or on "Sync now".
 *            Scans another scanner got to first come back as conflicts.
 *   Manual   find a ticket holder by name or ticket number and check them in by hand.
 *   Guests   the "Guest list" tab: people with no ticket, searchable by name. Check a guest in and record their
 *            plus-ones as they arrive ("2 of 3 here", + and −). Online it's POST …/guest-list/:entryId/check-in (and
 *            …/undo for −); with no signal it's checked against the guest list in the door pack, queued with an opId
 *            and synced (POST …/guest-list/sync) with the scans. Offline − only takes back this phone's unsynced
 *            check-ins (lib/door.ts).
 *
 * Every result fills the screen (green admit, amber already scanned, red not valid) with a haptic, then the camera
 * resumes after about 1.5 seconds; a comp shows "Comp · {group}". On the web preview there's no camera: type or
 * paste a code instead.
 *
 * Multiple dates (lib/dates.ts): the door works on one date at a time, picked from date cards under the title (with
 * each date's check-ins); it starts on the API's current date (the one running today at the venue, else the next),
 * or offline the same rule on this phone's clock. Scans, manual check-ins, undo and offline sync carry that
 * `eventDateId`; a ticket for another date, or a pass not valid that day, fills the screen in violet: "Wrong date",
 * with the ticket's own date ("This ticket is for Sat, Dec 13") or its days ("Valid Sat 12, Sun 13").
 *
 * Sessions (lib/schedule.ts): an event with bookable sessions gets a "Sessions" tab: pick the session (those on the
 * door's date), then scan tickets at its entrance: POST …/schedule/:itemId/check-in answers Admit (booked), Already
 * in, Not booked, Wrong date or Not valid, in the same full-screen style. It needs signal (nothing is saved for
 * offline), and it doesn't check anyone in at the event door. `?session=<itemId>` opens it on that session.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateCards } from '@/components/date-cards';
import { DoorCamera, HAS_CAMERA } from '@/components/door-camera';
import { Segmented } from '@/components/form-ui';
import { Icon, type IconName } from '@/components/icons';
import { KeepAwake } from '@/components/keep-awake';
import { Badge, Button, Chip, Field, IconButton, Notice, Txt } from '@/components/ui';
import { api, errorText, isOffline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deviceId as getDeviceId } from '@/lib/device';
import {
  admitLocally,
  applyGuestSync,
  checkInGuestOffline,
  clock,
  compLabel,
  conflictText,
  defaultDoorDate,
  downloadPack,
  dropDoor,
  emptyStore,
  guestConflictText,
  guestTotals,
  hereText,
  inKey,
  loadDoor,
  markGuest,
  markPack,
  matchesGuest,
  mergeScanSync,
  packGuests,
  saveDoor,
  seatText,
  sendGuestQueue,
  syncDoor,
  undoGuestLocal,
  undoLocal,
  unmarkPack,
  verdictOf,
  verifyOffline,
  withQueued,
  type DoorStore,
  type Verdict,
} from '@/lib/door';
import { dateLine, shortDay, type DateMode, type EventDate } from '@/lib/dates';
import { isPast, localStamp, num, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useGuestList } from '@/lib/organizer';
import { checkInSession, sessionVerdict, timeRange, undoBooking, useOrgSchedule } from '@/lib/schedule';
import { useDoorEvents } from '@/lib/queries';
import { useConfirm } from '@/components/confirm';
import type { Attendee, CheckInAnswer, GuestCheckIn, GuestEntry, GuestList } from '@/lib/types';
import { colors, font, gutter, radius, space } from '@/theme';

/** A session has ended (venue wall clock, read on this phone's clock). */
const isPastWall = (iso: string) => isPast(iso, 0);

type EventInfo = { id: string; orgId: string; title: string; startsAt: string; status: string; timezone?: string | null; dateMode?: DateMode; dates?: EventDate[] };

const TONE: Record<Verdict['tone'], { bg: string; icon: IconName }> = {
  admit: { bg: '#178a4c', icon: 'check' },
  already: { bg: '#b87a0c', icon: 'alert' },
  invalid: { bg: '#b8291d', icon: 'close' },
  // a ticket for another date: its own colour, so it isn't read as a fake
  wrong: { bg: '#5a3fc0', icon: 'calendar' },
};

export default function Door() {
  const confirm = useConfirm();
  const confirmAsk = (title: string, message: string, confirmLabel: string, go: () => void) =>
    void confirm({ title, message, confirmLabel, destructive: true }).then((yes) => {
      if (yes) go();
    });
  const { eventId = '', session: sessionParam } = useLocalSearchParams<{ eventId: string; session?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();

  const [deviceId, setDeviceId] = useState('');
  const [store, setStoreState] = useState<DoorStore>(() => emptyStore(eventId));
  const storeRef = useRef(store);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'online' | 'offline'>('online');
  const [autoOffline, setAutoOffline] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [lastAdmit, setLastAdmit] = useState<{ ticketId: string; offline: boolean; name: string; dateId?: string | null } | null>(null);
  /** multiple dates: the date picked at the door (null: the default) */
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [typing, setTyping] = useState(!HAS_CAMERA);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'warning' | 'accent' | 'plain'; text: string } | null>(null);
  const [lookup, setLookup] = useState('');
  const busyRef = useRef(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'scan' | 'guests' | 'sessions'>(sessionParam ? 'sessions' : 'scan');
  /** Sessions: the session being checked, and the last one let in (for Undo) */
  const [sessionId, setSessionId] = useState<string | null>(sessionParam ?? null);
  const [lastSession, setLastSession] = useState<{ itemId: string; reservationId: string; name: string } | null>(null);
  const [guestText, setGuestText] = useState('');
  const [guestQ, setGuestQ] = useState('');
  const [guestBusy, setGuestBusy] = useState<string | null>(null);
  const [guestNote, setGuestNote] = useState<{ tone: 'success' | 'warning' | 'accent' | 'plain'; text: string } | null>(null);
  /** guest check-ins in a sync request right now: offline undo leaves them alone */
  const guestSending = useRef<Set<string>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => setGuestQ(guestText.trim()), 250);
    return () => clearTimeout(t);
  }, [guestText]);

  const setStore = useCallback((next: DoorStore) => {
    storeRef.current = next;
    setStoreState(next);
    void saveDoor(next);
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([getDeviceId(), loadDoor(eventId)]).then(([id, s]) => {
      if (!live) return;
      setDeviceId(id);
      storeRef.current = s;
      setStoreState(s);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [eventId]);

  const online = mode === 'online' && !autoOffline;
  const info = useQuery({ queryKey: ['organizer', 'event', eventId], queryFn: () => api<EventInfo>(`/organizer/events/${encodeURIComponent(eventId)}`), enabled: !!user && !!eventId, retry: 1 });
  // "N of M checked in" counts non-void tickets both ways: online from the door list (GET …/door-events),
  // offline from the downloaded pack (which holds the same tickets).
  const orgId = user ? info.data?.orgId : undefined;
  const doorEvents = useDoorEvents(online ? orgId : undefined, { refetchMs: online ? 15_000 : false });
  const live = doorEvents.data?.find((e) => e.id === eventId);
  const refetchDoor = doorEvents.refetch;
  const refreshCounts = useCallback(() => {
    if (orgId) void refetchDoor();
  }, [orgId, refetchDoor]);

  const pack = store.pack;
  // Multiple dates: the door's date. Picked, else the API's current date (online), else the same rule on this phone.
  const dateMode = live?.dateMode ?? pack?.dateMode ?? info.data?.dateMode ?? 'SINGLE';
  const multi = dateMode === 'DATES' || dateMode === 'DAYS';
  const allDates = multi ? (live?.dates ?? pack?.dates ?? info.data?.dates ?? []) : [];
  const doorDates = allDates.filter((d) => d.status !== 'CANCELLED');
  const tz = info.data?.timezone ?? pack?.timezone ?? null;
  const liveCurrent = live?.currentDateId ?? null;
  const doorDateId = multi
    ? ((pickedDate && doorDates.some((d) => d.id === pickedDate) ? pickedDate : null) ??
      (online && liveCurrent && doorDates.some((d) => d.id === liveCurrent) ? liveCurrent : null) ??
      defaultDoorDate(doorDates, tz)?.id ??
      null)
    : null;
  // Scans read it from a ref (the scan callbacks stay the same between renders).
  const doorDateRef = useRef<string | null>(doorDateId);
  useEffect(() => {
    doorDateRef.current = doorDateId;
  }, [doorDateId]);
  const doorDate = doorDates.find((d) => d.id === doorDateId) ?? null;
  // Bookable sessions (online only): those on the door's date, plus the one a link asked for.
  const schedule = useOrgSchedule(eventId, online, online && tab === 'sessions' ? 15_000 : false);
  const bookable = (schedule.data?.items ?? []).filter((i) => i.bookable);
  const doorSessions = bookable.filter((i) => !doorDateId || !i.eventDateId || i.eventDateId === doorDateId || i.id === sessionId);
  const session = doorSessions.find((i) => i.id === sessionId) ?? doorSessions.find((i) => !isPastWall(i.endsAt ?? i.startsAt)) ?? doorSessions[0] ?? null;
  // A link to a session on another date (multiple dates): the door moves to that date, once.
  const [linkDated, setLinkDated] = useState(false);
  const linked = sessionParam ? bookable.find((i) => i.id === sessionParam) : undefined;
  if (linked && !linkDated) {
    setLinkDated(true);
    if (linked.eventDateId && multi && linked.eventDateId !== doorDateId) setPickedDate(linked.eventDateId);
  }
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // The guest list: from the API while online (with this phone's unsynced check-ins on top), else the door pack's.
  const remoteGuests = useGuestList(online && tab === 'guests' ? eventId : undefined, guestQ);
  const useRemote = online && !!remoteGuests.data && !remoteGuests.error;
  const guests = useRemote ? withQueued(remoteGuests.data!.items, store.guestQueue) : packGuests(store).filter((g) => matchesGuest(g, guestQ));
  const guestSum = useRemote && !guestQ ? guestTotals(guests) : pack?.guestList ? guestTotals(packGuests(store)) : (remoteGuests.data?.summary ?? null);
  const pendingSync = store.queue.length + store.guestQueue.length;
  const title = info.data?.title ?? pack?.title ?? 'Door';
  const startsAt = doorDate?.startsAt ?? info.data?.startsAt ?? pack?.startsAt;
  // Multiple dates: the tickets for the door's date (DATES: that date's; DAYS: passes valid that day) and who's in.
  const forDate = (t: { eventDateId?: string | null; validDateIds?: string[]; status: string }) => t.status !== 'VOID' && (dateMode === 'DATES' ? t.eventDateId === doorDateId : (t.validDateIds ?? []).includes(doorDateId ?? ''));
  const packTickets = pack ? (doorDateId ? pack.tickets.filter(forDate) : pack.tickets) : [];
  const packIn = doorDateId
    ? packTickets.filter((t) => store.localIn[inKey(t.id, doorDateId)] || (t.checkIns ?? []).some((c) => c.eventDateId === doorDateId) || (dateMode === 'DATES' && t.status === 'CHECKED_IN')).length
    : packTickets.filter((t) => t.status === 'CHECKED_IN' || store.localIn[t.id]).length;
  const liveDate = doorDateId ? live?.dates?.find((d) => d.id === doorDateId) : undefined;
  const counter: { n: number; of: number | null } | null = doorDateId
    ? online && liveDate
      ? { n: liveDate.checkedIn ?? 0, of: pack ? packTickets.length : null }
      : pack
        ? { n: packIn, of: packTickets.length }
        : null
    : online && live
      ? { n: live.checkedIn, of: live.ticketsIssued }
      : pack
        ? { n: packIn, of: pack.tickets.length }
        : live
          ? { n: live.checkedIn, of: live.ticketsIssued }
          : null;

  /* ---------- results ---------- */

  const show = useCallback((v: Verdict) => {
    if (v.tone === 'admit') haptic.success();
    else if (v.tone === 'already') haptic.warning();
    else haptic.error();
    setVerdict(v);
    if (v.tone === 'admit' && v.undo && v.ticket) setLastAdmit({ ticketId: v.ticket.id, offline: v.undo.offline, name: v.ticket.holderName, dateId: v.undo.dateId ?? null });
  }, []);

  // The camera resumes ~1.5 s after a result (tap the result to resume sooner).
  useEffect(() => {
    if (!verdict) return;
    // A wrong date stays a little longer: there's a date to read out.
    const t = setTimeout(() => setVerdict(null), verdict.tone === 'admit' ? 1500 : verdict.tone === 'wrong' ? 2600 : 1900);
    return () => clearTimeout(t);
  }, [verdict]);

  const checkOffline = useCallback(
    (raw: string, manual: boolean, why?: string) => {
      const r = verifyOffline(storeRef.current, raw, Date.now(), manual, doorDateRef.current);
      if (r.scan) setStore(admitLocally(storeRef.current, r.scan));
      show(why ? { ...r.verdict, detail: [r.verdict.detail, why].filter(Boolean).join(' ') } : r.verdict);
    },
    [doorDateRef, setStore, show],
  );

  const process = useCallback(
    async (raw: string, manual = false) => {
      const value = raw.trim();
      if (!value || busyRef.current || !deviceId) return;
      if (mode === 'offline' || autoOffline) {
        checkOffline(value, manual);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const on = doorDateRef.current;
        const a = await api<CheckInAnswer>(`/organizer/events/${encodeURIComponent(eventId)}/check-in`, { body: { code: value, deviceId, ...(on ? { eventDateId: on } : {}) }, timeoutMs: 8000 });
        if (a.result === 'ok' && a.ticket) setStore(markPack(storeRef.current, a.ticket.id, new Date().toISOString(), deviceId, a.date?.id ?? on));
        show(verdictOf(a, deviceId, storeRef.current.pack));
        refreshCounts();
      } catch (e) {
        if (isOffline(e) && storeRef.current.pack) {
          // No signal: carry on against the downloaded list; the scan syncs later.
          setAutoOffline(true);
          checkOffline(value, manual, 'No connection: checked against the downloaded list.');
        } else if (isOffline(e)) {
          show({ tone: 'invalid', title: 'No connection', detail: 'Download the door list while you have signal to scan offline.' });
        } else {
          show({ tone: 'invalid', title: 'Not valid', detail: errorText(e) });
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [autoOffline, checkOffline, deviceId, doorDateRef, eventId, mode, refreshCounts, setStore, show],
  );

  /** Session check-in: online only; a scan or typed code for the session picked. */
  const processSession = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const s = sessionRef.current;
      if (!value || busyRef.current || !s) return;
      if (mode === 'offline' || autoOffline) {
        show({ tone: 'invalid', title: 'No connection', detail: 'Session check-in needs signal. It doesn’t work offline.' });
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const a = await checkInSession(eventId, s.id, value);
        const v = sessionVerdict(a, s.title);
        show(v);
        if (a.result === 'ADMIT' && a.reservation && a.ticket) setLastSession({ itemId: s.id, reservationId: a.reservation.id, name: a.ticket.holderName });
        void schedule.refetch();
      } catch (e) {
        show(isOffline(e) ? { tone: 'invalid', title: 'No connection', detail: 'Session check-in needs signal. Try again when you’re back online.' } : { tone: 'invalid', title: 'Not valid', detail: errorText(e) });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [autoOffline, eventId, mode, schedule, show],
  );

  const undoSession = async () => {
    if (!lastSession) return;
    setNote(null);
    try {
      await undoBooking(eventId, lastSession.itemId, lastSession.reservationId);
      haptic.select();
      setNote({ tone: 'plain', text: `Undone: ${lastSession.name} is no longer checked in to the session.` });
      setLastSession(null);
      void schedule.refetch();
    } catch (e) {
      setNote({ tone: 'accent', text: `Couldn’t undo. ${errorText(e)}` });
    }
  };

  const undo = async () => {
    if (!lastAdmit) return;
    const { ticketId, offline, dateId } = lastAdmit;
    setNote(null);
    if (offline && storeRef.current.queue.some((q) => q.ticketId === ticketId && (!dateId || q.eventDateId === dateId))) {
      setStore(undoLocal(storeRef.current, ticketId, dateId));
      setLastAdmit(null);
      haptic.select();
      setNote({ tone: 'plain', text: `Undone: ${lastAdmit.name} is no longer checked in on this phone.` });
      return;
    }
    try {
      // Multi-day: that day's entry
      await api(`/organizer/events/${encodeURIComponent(eventId)}/check-in/${encodeURIComponent(ticketId)}${dateId ? `?eventDateId=${encodeURIComponent(dateId)}` : ''}`, { method: 'DELETE' });
      setStore(unmarkPack(undoLocal(storeRef.current, ticketId, dateId), ticketId, dateId));
      setLastAdmit(null);
      haptic.select();
      setNote({ tone: 'plain', text: `Undone: ${lastAdmit.name} is no longer checked in.` });
      refreshCounts();
    } catch (e) {
      setNote({ tone: 'accent', text: `Couldn’t undo. ${errorText(e)}` });
    }
  };

  /* ---------- the guest list ---------- */

  const patchGuestCache = useCallback(
    (entry: GuestEntry) =>
      qc.setQueriesData<GuestList>({ queryKey: ['organizer', 'guest-list', eventId] }, (old) => (old ? { ...old, items: old.items.map((g) => (g.id === entry.id ? entry : g)) } : old)),
    [qc, eventId],
  );

  /** Checks `n` people of an entry in: online first, else (or with no signal) against the downloaded list. */
  const checkInGuest = async (g: GuestEntry, n: number) => {
    if (!deviceId || guestBusy) return;
    setGuestNote(null);
    setGuestBusy(g.id);
    try {
      if (mode === 'online' && !autoOffline) {
        try {
          const a = await api<GuestCheckIn>(`/organizer/events/${encodeURIComponent(eventId)}/guest-list/${encodeURIComponent(g.id)}/check-in`, { body: { guests: n, deviceId }, timeoutMs: 8000 });
          setStore(markGuest(storeRef.current, a.entry));
          patchGuestCache(a.entry);
          if (a.result === 'ok') haptic.success();
          else haptic.warning();
          setGuestNote({ tone: a.result === 'ok' ? 'success' : 'warning', text: `${a.entry.name}: ${a.message || hereText(a.entry)}` });
          return;
        } catch (e) {
          if (!isOffline(e) || !storeRef.current.pack?.guestList) {
            haptic.error();
            setGuestNote({ tone: 'accent', text: isOffline(e) ? 'No connection. Download the door list while you have signal to check guests in offline.' : errorText(e) });
            return;
          }
          // No signal: carry on against the downloaded list; it syncs later.
          setAutoOffline(true);
        }
      }
      const r = checkInGuestOffline(storeRef.current, g.id, n);
      if (r.store) setStore(r.store);
      if (r.result === 'ok') haptic.success();
      else haptic.warning();
      setGuestNote({ tone: r.result === 'ok' ? 'success' : 'warning', text: `${r.entry?.name ?? g.name}: ${r.message} Saved on this phone; it syncs when you’re back online.` });
    } finally {
      setGuestBusy(null);
    }
  };

  /** One fewer here: this phone's unsynced check-in first (it never reached Omoshow), else POST …/undo online. */
  const undoGuest = async (g: GuestEntry) => {
    if (guestBusy) return;
    setGuestNote(null);
    const local = undoGuestLocal(storeRef.current, g.id, guestSending.current);
    if (local) {
      setStore(local);
      haptic.select();
      const now = packGuests(local).find((x) => x.id === g.id);
      setGuestNote({ tone: 'plain', text: `Undone on this phone: ${g.name}${now ? `, ${hereText(now).toLowerCase()}` : ''}.` });
      return;
    }
    if (mode === 'offline' || autoOffline) {
      haptic.warning();
      setGuestNote({ tone: 'warning', text: 'Offline, “−” only takes back check-ins made on this phone that haven’t synced yet. This one needs a connection to undo.' });
      return;
    }
    setGuestBusy(g.id);
    try {
      const r = await api<{ entry: GuestEntry }>(`/organizer/events/${encodeURIComponent(eventId)}/guest-list/${encodeURIComponent(g.id)}/undo`, { body: { guests: 1 }, timeoutMs: 8000 });
      setStore(markGuest(storeRef.current, r.entry));
      patchGuestCache(r.entry);
      haptic.select();
      setGuestNote({ tone: 'plain', text: `Undone: ${r.entry.name}, ${hereText(r.entry).toLowerCase()}.` });
    } catch (e) {
      haptic.error();
      setGuestNote({ tone: 'accent', text: isOffline(e) ? 'No connection: undo needs one for check-ins Omoshow already has.' : `Couldn’t undo. ${errorText(e)}` });
    } finally {
      setGuestBusy(null);
    }
  };

  /* ---------- offline pack and sync ---------- */

  const download = async () => {
    setDownloading(true);
    setNote(null);
    try {
      const p = await downloadPack(eventId);
      setStore({ ...storeRef.current, pack: p, packAt: Date.now() });
      haptic.success();
      const listed = p.guestList?.length ?? 0;
      setNote({ tone: 'success', text: `Saved ${num(p.tickets.length)} tickets${listed ? ` and ${num(listed)} guest-list ${listed === 1 ? 'entry' : 'entries'}` : ''} on this phone. You can check people in with no signal now.` });
    } catch (e) {
      haptic.error();
      setNote({ tone: 'accent', text: `Couldn’t download the list. ${errorText(e)}` });
    } finally {
      setDownloading(false);
    }
  };

  const sync = useCallback(
    async (quiet: boolean) => {
      if (!deviceId || (!storeRef.current.queue.length && !storeRef.current.guestQueue.length)) return;
      setSyncing(true);
      let synced = 0;
      let issues = 0;
      let failed: unknown = null;
      try {
        // Scans first. syncDoor works on a snapshot; scans made meanwhile stay queued (mergeScanSync).
        if (storeRef.current.queue.length) {
          const sent = storeRef.current;
          const r = await syncDoor(sent, deviceId);
          setStore(mergeScanSync(storeRef.current, sent, r));
          synced += r.synced;
          issues += r.conflicts.length;
        }
        // Then guest-list check-ins, each with its opId (the API applies it once, so a resend is harmless).
        const ops = [...storeRef.current.guestQueue];
        if (ops.length) {
          ops.forEach((o) => guestSending.current.add(o.opId));
          try {
            const g = await sendGuestQueue(eventId, ops, deviceId);
            const a = applyGuestSync(storeRef.current, g.answered);
            setStore(a.store);
            synced += a.synced;
            issues += a.conflicts.length;
            if (g.answered.length) void qc.invalidateQueries({ queryKey: ['organizer', 'guest-list', eventId] });
            if (g.error) failed = g.error;
          } finally {
            ops.forEach((o) => guestSending.current.delete(o.opId));
          }
        }
      } catch (e) {
        failed = e;
      }
      setSyncing(false);
      if (!failed) setAutoOffline(false);
      refreshCounts();
      if (failed) {
        if (!quiet) setNote({ tone: 'warning', text: isOffline(failed) ? 'Still offline. Your check-ins are safe on this phone and will sync when you’re back online.' : `Couldn’t sync. ${errorText(failed)}` });
      } else if (!quiet || issues) {
        if (issues) haptic.warning();
        setNote({ tone: issues ? 'warning' : 'success', text: `Synced ${synced} check-in${synced === 1 ? '' : 's'}.${issues ? ` ${issues} need${issues === 1 ? 's' : ''} a look: see below.` : ''}` });
      }
    },
    [deviceId, eventId, qc, refreshCounts, setStore],
  );

  // Queued scans and guest check-ins go up on their own every 20 seconds when the API can be reached.
  useEffect(() => {
    if (!pendingSync) return;
    const t = setInterval(() => void sync(true), 20_000);
    return () => clearInterval(t);
  }, [pendingSync, sync]);

  const leave = () => {
    const pending = storeRef.current.queue.length + storeRef.current.guestQueue.length;
    const go = async () => {
      await dropDoor(eventId);
      router.back();
    };
    if (pending) confirmAsk('Check-ins haven’t synced', `${pending} check-in${pending === 1 ? '' : 's'} on this phone ${pending === 1 ? 'hasn’t' : 'haven’t'} reached Omoshow yet. Leave anyway and lose ${pending === 1 ? 'it' : 'them'}?`, 'Leave and delete', () => void go());
    else confirmAsk('Leave this event?', 'The offline guest list is deleted from this phone.', 'Leave', () => void go());
  };

  /* ---------- manual lookup ---------- */

  const q = lookup.trim();
  const remote = useQuery({
    queryKey: ['organizer', 'attendees', eventId, q],
    queryFn: ({ signal }) => api<Attendee[]>(`/organizer/events/${encodeURIComponent(eventId)}/attendees?q=${encodeURIComponent(q)}`, { signal }),
    enabled: online && q.length >= 2,
    staleTime: 5_000,
    retry: 0,
  });
  type Hit = { id: string; name: string; type: string; seat: string; status: string; checkedInAt: string | null; comp: string | null; when: string | null };
  /** Multiple dates: a run's ticket shows its date; a multi-day pass is "in" only for the door's date. */
  const dateText = (dateId: string | null | undefined) => {
    const d = allDates.find((x) => x.id === dateId);
    return d ? `${shortDay(d.startsAt)} · ${when(d.startsAt).time}` : null;
  };
  const hits: Hit[] =
    q.length < 2
      ? []
      : online && !remote.error
        ? (remote.data ?? []).slice(0, 20).map((a) => {
            const inToday = dateMode === 'DAYS' && doorDateId ? !!a.checkedInDates?.includes(doorDateId) : a.status === 'CHECKED_IN';
            const status = dateMode === 'DAYS' && a.status === 'CHECKED_IN' && !inToday ? 'ACTIVE' : a.status;
            return { id: a.id, name: a.holderName, type: a.ticketType.name, seat: seatText(a), status, checkedInAt: inToday ? a.checkedInAt : null, comp: a.type === 'COMP' ? compLabel({ comp: true, compGroup: a.compGroup }) : null, when: dateMode === 'DATES' ? dateText(a.eventDateId) : null };
          })
        : (pack?.tickets ?? [])
            .filter((t) => t.holderName.toLowerCase().includes(q.toLowerCase()) || t.id.includes(q.toUpperCase()))
            .slice(0, 20)
            .map((t) => {
              const mine = store.localIn[inKey(t.id, doorDateId)] ?? (doorDateId ? undefined : store.localIn[t.id]);
              const entry = doorDateId ? (t.checkIns ?? []).find((c) => c.eventDateId === doorDateId) : undefined;
              const inNow = !!mine || (dateMode === 'DAYS' ? !!entry : t.status === 'CHECKED_IN');
              const status = inNow ? 'CHECKED_IN' : t.status === 'CHECKED_IN' ? 'ACTIVE' : t.status;
              return { id: t.id, name: t.holderName, type: t.ticketType, seat: seatText(t), status, checkedInAt: mine ?? entry?.at ?? (inNow ? t.checkedInAt : null), comp: compLabel(t), when: dateMode === 'DATES' ? dateText(t.eventDateId) : null };
            });

  const camH = Math.min(width - gutter * 2, 440);

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.lg, paddingHorizontal: gutter }}>
        <Notice tone="plain" icon="lock" action="Sign in" onAction={() => router.push('/sign-in')}>
          Sign in with your organizer team account to scan tickets.
        </Notice>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeepAwake />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/organizer'))} />
          <View style={{ flex: 1 }}>
            <Txt variant="title" numberOfLines={1} accessibilityRole="header">
              {title}
            </Txt>
            {doorDate ? (
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {dateLine(doorDate)}
              </Txt>
            ) : startsAt ? (
              <Txt variant="small" color={colors.muted}>
                {when(startsAt).short} · {when(startsAt).time}
              </Txt>
            ) : null}
          </View>
        </View>

        {doorDates.length > 1 ? (
          // Multiple dates: which date this door is checking (each with its entries so far, online).
          <DateCards
            dates={doorDates}
            value={doorDateId}
            onChange={(id) => {
              setPickedDate(id);
              setLastAdmit(null);
              // Sessions: that date's sessions (the next one on it is picked)
              setSessionId(null);
              setLastSession(null);
            }}
            note={(d) => {
              const c = live?.dates?.find((x) => x.id === d.id)?.checkedIn;
              return online && c !== undefined ? `${num(c)} in` : null;
            }}
            label="Door date"
          />
        ) : null}

        <Segmented
          label="Door"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'scan', label: bookable.length || sessionParam ? 'Tickets' : 'Scan tickets' },
            { id: 'guests', label: 'Guest list' },
            ...(bookable.length || sessionParam ? [{ id: 'sessions' as const, label: 'Sessions' }] : []),
          ]}
        />

        <View style={styles.counterRow}>
          <View style={{ flex: 1 }}>
            <Txt variant="priceLg" accessibilityLiveRegion="polite">
              {tab === 'sessions'
                ? session && online
                  ? `${num(session.checkedIn)} of ${num(session.reserved)}`
                  : '—'
                : tab === 'guests'
                  ? guestSum
                    ? `${num(guestSum.arrived)} of ${num(guestSum.expected)}`
                    : '—'
                  : counter
                    ? counter.of !== null
                      ? `${counter.n} of ${counter.of}`
                      : num(counter.n)
                    : '—'}
            </Txt>
            <Txt variant="small" color={colors.muted} numberOfLines={1}>
              {tab === 'sessions' ? 'checked in' : tab === 'guests' ? `guests here${guestSum ? ` · ${num(guestSum.entries)} on the list` : ''}` : doorDate ? `checked in · ${shortDay(doorDate.startsAt)}` : 'checked in'}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Chip label="Online" icon="globe" active={mode === 'online'} onPress={() => setMode('online')} />
            <Chip label="Offline" icon="offline" active={mode === 'offline'} onPress={() => (pack ? setMode('offline') : setNote({ tone: 'plain', text: 'Download the guest list first to scan offline.' }))} />
          </View>
        </View>

        {autoOffline && mode === 'online' ? (
          <Notice tone="warning" icon="offline" title="No connection — scanning offline" action="Try online again" onAction={() => setAutoOffline(false)}>
            Codes are checked against the downloaded list and sync when you’re back online.
          </Notice>
        ) : null}

        {tab === 'guests' ? (
          <View style={{ gap: space.md }}>
            <Field label="Search the guest list" value={guestText} onChangeText={setGuestText} autoCorrect={false} autoCapitalize="none" placeholder="Name, email or group" clearButtonMode="while-editing" />
            {!online ? (
              <Txt variant="small" color={colors.dim}>
                {pack?.guestList
                  ? 'Offline: check-ins are saved on this phone and sync when you’re back online. “−” only takes back ones that haven’t synced yet.'
                  : 'Download the door list (below) while you have signal to check guests in offline.'}
              </Txt>
            ) : null}
            {guestNote ? <Notice tone={guestNote.tone}>{guestNote.text}</Notice> : null}
            {online && remoteGuests.isPending && !pack?.guestList ? (
              <Txt variant="small" color={colors.dim}>
                Loading the guest list…
              </Txt>
            ) : online && remoteGuests.error && !pack?.guestList ? (
              <Notice tone="warning" icon="alert" action="Try again" onAction={() => void remoteGuests.refetch()}>
                {errorText(remoteGuests.error)}
              </Notice>
            ) : !guests.length ? (
              <Txt variant="small" color={colors.dim}>
                {guestQ ? `Nobody on the guest list matches “${guestQ}”.` : 'Nobody is on the guest list yet.'}
              </Txt>
            ) : null}
            {guests.slice(0, 60).map((g) => (
              <GuestRow key={g.id} g={g} busy={guestBusy === g.id} disabled={!!guestBusy || !deviceId} onIn={(n) => void checkInGuest(g, n)} onOut={() => void undoGuest(g)} />
            ))}
            {guests.length > 60 ? (
              <Txt variant="small" color={colors.dim}>
                Showing 60 of {num(guests.length)}. Search to find someone.
              </Txt>
            ) : null}
          </View>
        ) : null}

        {tab === 'sessions' ? (
          <View style={{ gap: space.md }}>
            {!online ? (
              <Notice tone="warning" icon="offline" title="Session check-in needs signal" action={mode === 'offline' ? 'Go online' : 'Try again'} onAction={() => {
                setMode('online');
                setAutoOffline(false);
              }}>
                It isn’t saved for offline. Check people in at the event door offline, and at sessions once you’re back online.
              </Notice>
            ) : schedule.error ? (
              <Notice tone="warning" icon="alert" action="Try again" onAction={() => void schedule.refetch()}>
                {errorText(schedule.error)}
              </Notice>
            ) : schedule.isPending ? (
              <Txt variant="small" color={colors.dim}>
                Loading the sessions…
              </Txt>
            ) : !doorSessions.length ? (
              <Txt variant="small" color={colors.dim}>
                {doorDate ? `No bookable sessions on ${shortDay(doorDate.startsAt)}.` : 'This event has no bookable sessions.'}
              </Txt>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityLabel="Session">
                  {doorSessions.map((i) => (
                    <Chip
                      key={i.id}
                      label={`${when(i.startsAt).time} · ${i.title}`}
                      active={session?.id === i.id}
                      onPress={() => {
                        setSessionId(i.id);
                        setLastSession(null);
                      }}
                    />
                  ))}
                </ScrollView>
                {session ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`${session.title}: see the bookings`}
                    onPress={() => router.push({ pathname: '/organizer/events/[id]/sessions/[itemId]', params: { id: eventId, itemId: session.id } })}
                    style={({ pressed }) => [styles.sessionHead, pressed && { opacity: 0.7 }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {session.title}
                      </Txt>
                      <Txt variant="small" color={colors.muted} numberOfLines={1}>
                        {[`${multi ? `${shortDay(session.startsAt)} · ` : ''}${timeRange(session.startsAt, session.endsAt)}`, session.stage, session.capacity !== null && session.reserved >= session.capacity ? 'Full' : null].filter(Boolean).join(' · ')}
                      </Txt>
                    </View>
                    <Txt variant="smallStrong" color={colors.accent}>
                      Bookings
                    </Txt>
                    <Icon name="chevronRight" size={15} color={colors.accent} />
                  </Pressable>
                ) : null}
              </>
            )}
            {online && session ? (
              <>
                <View>
                  <DoorCamera paused={!!verdict || busy} torch={torch} onCode={(d) => void processSession(d)} height={camH} />
                  {HAS_CAMERA ? (
                    <View style={styles.camTools}>
                      <IconButton icon="flash" label={torch ? 'Turn the torch off' : 'Turn the torch on'} glass color={torch ? colors.warning : colors.text} onPress={() => setTorch((v) => !v)} />
                      <IconButton icon="keyboard" label="Enter a code" glass onPress={() => setTyping((v) => !v)} />
                    </View>
                  ) : null}
                </View>
                {typing ? (
                  <View style={{ gap: space.sm }}>
                    <Field
                      label="Enter code"
                      value={code}
                      onChangeText={setCode}
                      placeholder="EVT-…  or the full QR code"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="go"
                      onSubmitEditing={() => {
                        void processSession(code);
                        setCode('');
                      }}
                      hint="The ticket number or the full code from the ticket."
                    />
                    <Button
                      label="Check"
                      icon="scan"
                      loading={busy}
                      disabled={!code.trim()}
                      onPress={() => {
                        void processSession(code);
                        setCode('');
                      }}
                    />
                  </View>
                ) : null}
                {lastSession ? (
                  <Pressable accessibilityRole="button" onPress={() => void undoSession()} style={({ pressed }) => [styles.undo, pressed && { opacity: 0.7 }]}>
                    <Icon name="undo" size={16} color={colors.muted} />
                    <Txt variant="smallStrong" color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
                      Undo last check-in · {lastSession.name}
                    </Txt>
                  </Pressable>
                ) : null}
                <Txt variant="tiny" color={colors.dim}>
                  This checks people in to the session only, not at the event door.
                </Txt>
              </>
            ) : null}
          </View>
        ) : null}

        {tab === 'scan' ? (
          <>
            <View>
              <DoorCamera paused={!!verdict || busy} torch={torch} onCode={(d) => void process(d)} height={camH} />
              {HAS_CAMERA ? (
                <View style={styles.camTools}>
                  <IconButton icon="flash" label={torch ? 'Turn the torch off' : 'Turn the torch on'} glass color={torch ? colors.warning : colors.text} onPress={() => setTorch((v) => !v)} />
                  <IconButton icon="keyboard" label="Enter a code" glass onPress={() => setTyping((v) => !v)} />
                </View>
              ) : null}
            </View>

            {typing ? (
              <View style={{ gap: space.sm }}>
                <Field
                  label="Enter code"
                  value={code}
                  onChangeText={setCode}
                  placeholder="EVT-…  or the full QR code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    void process(code, !code.includes('.'));
                    setCode('');
                  }}
                  hint="A ticket number checks the ticket in by hand; a full code (ticket.window.signature) is verified like a scan."
                />
                <Button
                  label="Check"
                  icon="scan"
                  loading={busy}
                  disabled={!code.trim()}
                  onPress={() => {
                    void process(code, !code.includes('.'));
                    setCode('');
                  }}
                />
              </View>
            ) : null}

            {lastAdmit ? (
              <Pressable accessibilityRole="button" onPress={undo} style={({ pressed }) => [styles.undo, pressed && { opacity: 0.7 }]}>
                <Icon name="undo" size={16} color={colors.muted} />
                <Txt variant="smallStrong" color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
                  Undo last scan · {lastAdmit.name}
                </Txt>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}

        {/* Offline (not for sessions: they need signal) */}
        {tab !== 'sessions' ? (
        <View style={styles.panel}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.panelIcon}>
              <Icon name={pack ? 'shield' : 'download'} size={18} color={pack ? colors.success : colors.muted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">{pack ? 'Offline list saved' : 'Scan without signal'}</Txt>
              <Txt variant="small" color={colors.muted}>
                {pack
                  ? `${num(pack.tickets.length)} tickets${pack.guestList ? ` · ${num(pack.guestList.length)} on the guest list` : ''} · downloaded ${store.packAt ? localStamp(store.packAt) : ''}`
                  : 'Download the door list (encrypted on this phone) to check tickets and guests in with no connection.'}
              </Txt>
            </View>
          </View>
          {!loaded ? null : (
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Button label={pack ? 'Refresh list' : 'Download for offline'} icon="download" size="sm" variant={pack ? 'ghost' : 'primary'} loading={downloading} onPress={download} />
              {pack ? <Button label="Leave event" icon="trash" size="sm" variant="ghost" onPress={leave} /> : null}
            </View>
          )}
          {pendingSync ? (
            <View style={styles.queue}>
              <Icon name="sync" size={16} color={colors.warning} />
              <Txt variant="smallStrong" color={colors.warning} style={{ flex: 1 }}>
                {[
                  store.queue.length ? `${store.queue.length} scan${store.queue.length === 1 ? '' : 's'}` : '',
                  store.guestQueue.length ? `${store.guestQueue.length} guest check-in${store.guestQueue.length === 1 ? '' : 's'}` : '',
                ]
                  .filter(Boolean)
                  .join(' and ')}{' '}
                waiting to sync
              </Txt>
              <Button label={syncing ? 'Syncing…' : 'Sync now'} size="sm" variant="subtle" loading={syncing} onPress={() => void sync(false)} />
            </View>
          ) : store.lastSyncAt ? (
            <Txt variant="tiny" color={colors.dim}>
              Everything synced · {localStamp(store.lastSyncAt)}
            </Txt>
          ) : null}
          {store.conflicts.length ? (
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Txt variant="eyebrow" color={colors.warning} style={{ flex: 1 }}>
                  Needs a look ({store.conflicts.length})
                </Txt>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setStore({ ...storeRef.current, conflicts: [] })}>
                  <Txt variant="smallStrong" color={colors.muted}>
                    Clear
                  </Txt>
                </Pressable>
              </View>
              {store.conflicts.slice(0, 20).map((c, i) => (
                <View key={`${c.ticketId}-${c.scannedAt}-${i}`} style={styles.conflict}>
                  <Txt variant="smallStrong">
                    {c.holderName ?? 'Guest'} · <Txt variant="mono">{c.ticketId}</Txt>
                  </Txt>
                  <Txt variant="small" color={colors.muted}>
                    {conflictText(c, deviceId)} You scanned it at {clock(c.scannedAt)}.
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
          {store.guestConflicts.length ? (
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Txt variant="eyebrow" color={colors.warning} style={{ flex: 1 }}>
                  Guest list needs a look ({store.guestConflicts.length})
                </Txt>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setStore({ ...storeRef.current, guestConflicts: [] })}>
                  <Txt variant="smallStrong" color={colors.muted}>
                    Clear
                  </Txt>
                </Pressable>
              </View>
              {store.guestConflicts.slice(0, 20).map((c) => (
                <View key={c.opId} style={styles.conflict}>
                  <Txt variant="smallStrong">
                    {c.name ?? 'Guest'} · {c.guests} {c.guests === 1 ? 'person' : 'people'}
                  </Txt>
                  <Txt variant="small" color={colors.muted}>
                    {guestConflictText(c)} You checked them in at {clock(c.at)}.
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        ) : null}

        {/* Manual lookup */}
        {tab === 'scan' ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="h3">Find a ticket holder</Txt>
            <Field label="Name or ticket number" value={lookup} onChangeText={setLookup} autoCorrect={false} autoCapitalize="none" placeholder="e.g. Ada, or EVT-AB12" />
            {q.length >= 2 && !online && !pack ? (
              <Txt variant="small" color={colors.dim}>
                Download the door list to search offline.
              </Txt>
            ) : null}
            {q.length >= 2 && online && remote.isPending ? (
              <Txt variant="small" color={colors.dim}>
                Searching…
              </Txt>
            ) : null}
            {q.length >= 2 && !hits.length && !(online && remote.isPending) && (online || pack) ? (
              <Txt variant="small" color={colors.dim}>
                No ticket holders match “{q}”.
              </Txt>
            ) : null}
            {hits.map((h) => {
              const done = h.status === 'CHECKED_IN';
              const can = h.status === 'ACTIVE' || h.status === 'LISTED';
              return (
                <View key={h.id} style={styles.hit}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {h.name}
                    </Txt>
                    <Txt variant="small" color={colors.muted} numberOfLines={1}>
                      {h.type} · {h.seat}
                      {h.comp ? ` · ${h.comp}` : ''}
                    </Txt>
                    {h.when ? (
                      <Txt variant="tiny" color={colors.dim} numberOfLines={1}>
                        {h.when}
                      </Txt>
                    ) : null}
                    <Txt variant="mono" color={colors.dim}>
                      {h.id}
                    </Txt>
                  </View>
                  {done ? (
                    <Badge label={h.checkedInAt ? `In · ${clock(h.checkedInAt)}` : 'Checked in'} tone="success" />
                  ) : can ? (
                    <Button label="Check in" size="sm" onPress={() => void process(h.id, true)} />
                  ) : (
                    <Badge label={h.status === 'TRANSFER_PENDING' ? 'Being transferred' : h.status.toLowerCase()} tone="warning" />
                  )}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      {verdict ? <Result v={verdict} onDone={() => setVerdict(null)} /> : null}
    </View>
  );
}

/** The full-screen answer to a scan. Tap to dismiss early. */
function Result({ v, onDone }: { v: Verdict; onDone: () => void }) {
  const t = TONE[v.tone];
  const insets = useSafeAreaInsets();
  return (
    <Pressable accessibilityRole="alert" accessibilityLabel={`${v.title}. ${v.ticket?.holderName ?? ''}. ${v.detail ?? ''}`} onPress={onDone} style={[StyleSheet.absoluteFill, styles.result, { backgroundColor: t.bg, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }]}>
      <View style={styles.resultIcon}>
        <Icon name={t.icon} size={56} color="#ffffff" strokeWidth={2.6} />
      </View>
      <Txt style={styles.resultTitle}>{v.title}</Txt>
      {v.ticket ? (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Txt variant="h1" color="#ffffff" style={{ textAlign: 'center' }}>
            {v.ticket.holderName}
          </Txt>
          <Txt variant="title" color="rgba(255,255,255,0.9)" style={{ textAlign: 'center' }}>
            {v.line ?? `${v.ticket.ticketType} · ${seatText(v.ticket)}`}
          </Txt>
          {compLabel(v.ticket) ? (
            <View style={styles.compTag}>
              <Txt variant="smallStrong" color="#ffffff">
                {compLabel(v.ticket)}
              </Txt>
            </View>
          ) : null}
          <Txt variant="mono" color="rgba(255,255,255,0.75)">
            {v.ticket.id}
          </Txt>
        </View>
      ) : null}
      {v.detail ? (
        <Txt variant={v.tone === 'wrong' ? 'h3' : 'bodyStrong'} color="#ffffff" style={{ textAlign: 'center', maxWidth: 340 }}>
          {v.detail}
        </Txt>
      ) : null}
      {v.offline ? (
        <View style={styles.offlineTag}>
          <Icon name="offline" size={14} color="#ffffff" />
          <Txt variant="tiny" color="#ffffff">
            Checked offline
          </Txt>
        </View>
      ) : null}
      <Txt variant="small" color="rgba(255,255,255,0.7)" style={{ position: 'absolute', bottom: 28 }}>
        Tap to scan the next ticket
      </Txt>
    </Pressable>
  );
}

/** One guest-list entry at the door: who, "2 of 3 here", and check in (one or the whole party) or take one back. */
function GuestRow({ g, busy, disabled, onIn, onOut }: { g: GuestEntry; busy: boolean; disabled: boolean; onIn: (n: number) => void; onOut: () => void }) {
  const left = Math.max(0, g.partySize - g.arrived);
  const full = left === 0;
  return (
    <View style={[styles.hit, full && { borderColor: colors.successLine }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {g.name}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Txt variant="smallStrong" color={full ? colors.success : g.arrived ? colors.text : colors.muted}>
            {hereText(g)}
          </Txt>
          {g.group ? <Badge label={g.group} /> : null}
        </View>
        {g.note ? (
          <Txt variant="tiny" color={colors.dim} numberOfLines={2}>
            {g.note}
          </Txt>
        ) : null}
      </View>
      {g.partySize === 1 ? (
        g.arrived ? (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Badge label={g.firstArrivedAt ? `Here · ${clock(g.firstArrivedAt)}` : 'Here'} tone="success" />
            <Pressable accessibilityRole="button" accessibilityLabel={`Undo ${g.name}’s check-in`} disabled={disabled} hitSlop={8} onPress={onOut}>
              <Txt variant="smallStrong" color={colors.muted}>
                Undo
              </Txt>
            </Pressable>
          </View>
        ) : (
          <Button label="Check in" size="sm" loading={busy} disabled={disabled} onPress={() => onIn(1)} />
        )
      ) : (
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <View style={styles.guestStepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`One fewer of ${g.name}’s party here`}
              accessibilityState={{ disabled: disabled || !g.arrived }}
              disabled={disabled || !g.arrived}
              onPress={onOut}
              style={({ pressed }) => [styles.stepBtn, (disabled || !g.arrived) && { opacity: 0.35 }, pressed && { backgroundColor: colors.surface2 }]}>
              <Icon name="minus" size={18} />
            </Pressable>
            <Txt variant="title" accessibilityLiveRegion="polite" style={{ minWidth: 44, textAlign: 'center' }}>
              {g.arrived}/{g.partySize}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`One more of ${g.name}’s party here`}
              accessibilityState={{ disabled: disabled || full }}
              disabled={disabled || full}
              onPress={() => onIn(1)}
              style={({ pressed }) => [styles.stepBtn, (disabled || full) && { opacity: 0.35 }, pressed && { backgroundColor: colors.surface2 }]}>
              <Icon name="plus" size={18} />
            </Pressable>
          </View>
          {left > 1 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Check in all ${left} still to come in ${g.name}’s party`} disabled={disabled} hitSlop={8} onPress={() => onIn(left)}>
              <Txt variant="smallStrong" color={colors.accent}>
                {g.arrived ? `All ${left} more` : `All ${left} in`}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  guestStepper: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: colors.line2, borderRadius: radius.pill, padding: 3 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  compTag: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  camTools: { position: 'absolute', right: space.md, top: space.md, gap: space.sm },
  undo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2 },
  panel: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  panelIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  queue: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  conflict: { gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(245,165,36,0.35)', backgroundColor: colors.bg2 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  hit: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  result: { alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: gutter, zIndex: 10 },
  resultIcon: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontFamily: font.display.heavy, fontSize: 52, lineHeight: 56, letterSpacing: -1.6, color: '#ffffff', textAlign: 'center' },
  offlineTag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.2)' },
});
