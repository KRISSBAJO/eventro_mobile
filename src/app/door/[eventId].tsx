/**
 * The door scanner for one event (team members with the DOOR role or higher).
 *
 *   Online   each scan → POST /organizer/events/:id/check-in (with this phone's device id); "Undo" reverses the last.
 *   Offline  "Download for offline" saves the door pack; codes are checked on the phone against each ticket's seed,
 *            admissions are queued and synced (POST …/check-ins/sync) when the API can be reached, or on "Sync now".
 *            Scans another scanner got to first come back as conflicts.
 *   Manual   find a guest by name or ticket number and check them in by hand.
 *
 * Every result fills the screen (green admit, amber already scanned, red not valid) with a haptic, then the camera
 * resumes after about 1.5 seconds. On the web preview there's no camera: type or paste a code instead.
 */
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DoorCamera, HAS_CAMERA } from '@/components/door-camera';
import { Icon, type IconName } from '@/components/icons';
import { KeepAwake } from '@/components/keep-awake';
import { Badge, Button, Chip, Field, IconButton, Notice, Txt } from '@/components/ui';
import { api, errorText, isOffline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deviceId as getDeviceId } from '@/lib/device';
import {
  admitLocally,
  clock,
  conflictText,
  downloadPack,
  dropDoor,
  emptyStore,
  loadDoor,
  markPack,
  saveDoor,
  seatText,
  syncDoor,
  undoLocal,
  unmarkPack,
  verdictOf,
  verifyOffline,
  type DoorStore,
  type Verdict,
} from '@/lib/door';
import { localStamp, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { Attendee, CheckInAnswer } from '@/lib/types';
import { colors, font, gutter, radius, space } from '@/theme';

type Stats = { sold: number; checkedIn: number };
type EventInfo = { id: string; title: string; startsAt: string; status: string };

const TONE: Record<Verdict['tone'], { bg: string; icon: IconName }> = {
  admit: { bg: '#178a4c', icon: 'check' },
  already: { bg: '#b87a0c', icon: 'alert' },
  invalid: { bg: '#b8291d', icon: 'close' },
};

const confirmAsk = (title: string, body: string, ok: string, go: () => void) => {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${body}`) ?? true) go();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: ok, style: 'destructive', onPress: go },
  ]);
};

export default function Door() {
  const { eventId = '' } = useLocalSearchParams<{ eventId: string }>();
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
  const [lastAdmit, setLastAdmit] = useState<{ ticketId: string; offline: boolean; name: string } | null>(null);
  const [torch, setTorch] = useState(false);
  const [typing, setTyping] = useState(!HAS_CAMERA);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'warning' | 'accent' | 'plain'; text: string } | null>(null);
  const [lookup, setLookup] = useState('');
  const busyRef = useRef(false);

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
  const stats = useQuery({
    queryKey: ['organizer', 'stats', eventId],
    queryFn: () => api<Stats>(`/organizer/events/${encodeURIComponent(eventId)}/stats?days=1`),
    enabled: !!user && !!eventId && online,
    refetchInterval: online ? 15_000 : false,
    retry: 0,
  });

  const pack = store.pack;
  const title = info.data?.title ?? pack?.title ?? 'Door';
  const startsAt = info.data?.startsAt ?? pack?.startsAt;
  const packIn = pack ? pack.tickets.filter((t) => t.status === 'CHECKED_IN' || store.localIn[t.id]).length : 0;
  const counter = online && stats.data ? { n: stats.data.checkedIn, of: stats.data.sold } : pack ? { n: packIn, of: pack.tickets.length } : stats.data ? { n: stats.data.checkedIn, of: stats.data.sold } : null;

  /* ---------- results ---------- */

  const show = useCallback((v: Verdict) => {
    if (v.tone === 'admit') haptic.success();
    else if (v.tone === 'already') haptic.warning();
    else haptic.error();
    setVerdict(v);
    if (v.tone === 'admit' && v.undo && v.ticket) setLastAdmit({ ticketId: v.ticket.id, offline: v.undo.offline, name: v.ticket.holderName });
  }, []);

  // The camera resumes ~1.5 s after a result (tap the result to resume sooner).
  useEffect(() => {
    if (!verdict) return;
    const t = setTimeout(() => setVerdict(null), verdict.tone === 'admit' ? 1500 : 1900);
    return () => clearTimeout(t);
  }, [verdict]);

  const checkOffline = useCallback(
    (raw: string, manual: boolean, why?: string) => {
      const r = verifyOffline(storeRef.current, raw, Date.now(), manual);
      if (r.scan) setStore(admitLocally(storeRef.current, r.scan));
      show(why ? { ...r.verdict, detail: [r.verdict.detail, why].filter(Boolean).join(' ') } : r.verdict);
    },
    [setStore, show],
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
        const a = await api<CheckInAnswer>(`/organizer/events/${encodeURIComponent(eventId)}/check-in`, { body: { code: value, deviceId }, timeoutMs: 8000 });
        if (a.result === 'ok' && a.ticket) setStore(markPack(storeRef.current, a.ticket.id, new Date().toISOString(), deviceId));
        show(verdictOf(a, deviceId, storeRef.current.pack));
        void stats.refetch();
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
    [autoOffline, checkOffline, deviceId, eventId, mode, setStore, show, stats],
  );

  const undo = async () => {
    if (!lastAdmit) return;
    const { ticketId, offline } = lastAdmit;
    setNote(null);
    if (offline && storeRef.current.queue.some((q) => q.ticketId === ticketId)) {
      setStore(undoLocal(storeRef.current, ticketId));
      setLastAdmit(null);
      haptic.select();
      setNote({ tone: 'plain', text: `Undone: ${lastAdmit.name} is no longer checked in on this phone.` });
      return;
    }
    try {
      await api(`/organizer/events/${encodeURIComponent(eventId)}/check-in/${encodeURIComponent(ticketId)}`, { method: 'DELETE' });
      setStore(unmarkPack(undoLocal(storeRef.current, ticketId), ticketId));
      setLastAdmit(null);
      haptic.select();
      setNote({ tone: 'plain', text: `Undone: ${lastAdmit.name} is no longer checked in.` });
      void stats.refetch();
    } catch (e) {
      setNote({ tone: 'accent', text: `Couldn’t undo. ${errorText(e)}` });
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
      setNote({ tone: 'success', text: `Saved ${p.tickets.length} tickets on this phone. You can scan with no signal now.` });
    } catch (e) {
      haptic.error();
      setNote({ tone: 'accent', text: `Couldn’t download the list. ${errorText(e)}` });
    } finally {
      setDownloading(false);
    }
  };

  const sync = useCallback(
    async (quiet: boolean) => {
      if (!deviceId || !storeRef.current.queue.length) return;
      setSyncing(true);
      try {
        const r = await syncDoor(storeRef.current, deviceId);
        setStore(r.store);
        setAutoOffline(false);
        void stats.refetch();
        if (!quiet || r.conflicts.length) {
          if (r.conflicts.length) haptic.warning();
          setNote({
            tone: r.conflicts.length ? 'warning' : 'success',
            text: `Synced ${r.synced} scan${r.synced === 1 ? '' : 's'}.${r.conflicts.length ? ` ${r.conflicts.length} need${r.conflicts.length === 1 ? 's' : ''} a look: see below.` : ''}`,
          });
        }
      } catch (e) {
        if (!quiet) setNote({ tone: 'warning', text: isOffline(e) ? 'Still offline. Your scans are safe on this phone and will sync when you’re back online.' : `Couldn’t sync. ${errorText(e)}` });
      } finally {
        setSyncing(false);
      }
    },
    [deviceId, setStore, stats],
  );

  // Queued scans go up on their own every 20 seconds when the API can be reached.
  useEffect(() => {
    if (!store.queue.length) return;
    const t = setInterval(() => void sync(true), 20_000);
    return () => clearInterval(t);
  }, [store.queue.length, sync]);

  const leave = () => {
    const pending = storeRef.current.queue.length;
    const go = async () => {
      await dropDoor(eventId);
      router.back();
    };
    if (pending) confirmAsk('Scans haven’t synced', `${pending} scan${pending === 1 ? '' : 's'} on this phone haven’t reached Eventro yet. Leave anyway and lose them?`, 'Leave and delete', () => void go());
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
  type Hit = { id: string; name: string; type: string; seat: string; status: string; checkedInAt: string | null };
  const hits: Hit[] =
    q.length < 2
      ? []
      : online && !remote.error
        ? (remote.data ?? []).slice(0, 20).map((a) => ({ id: a.id, name: a.holderName, type: a.ticketType.name, seat: seatText(a), status: a.status, checkedInAt: a.checkedInAt }))
        : (pack?.tickets ?? [])
            .filter((t) => t.holderName.toLowerCase().includes(q.toLowerCase()) || t.id.includes(q.toUpperCase()))
            .slice(0, 20)
            .map((t) => ({ id: t.id, name: t.holderName, type: t.ticketType, seat: seatText(t), status: store.localIn[t.id] ? 'CHECKED_IN' : t.status, checkedInAt: store.localIn[t.id] ?? t.checkedInAt }));

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
            {startsAt ? (
              <Txt variant="small" color={colors.muted}>
                {when(startsAt).short} · {when(startsAt).time}
              </Txt>
            ) : null}
          </View>
        </View>

        <View style={styles.counterRow}>
          <View style={{ flex: 1 }}>
            <Txt variant="priceLg" accessibilityLiveRegion="polite">
              {counter ? `${counter.n} of ${counter.of}` : '—'}
            </Txt>
            <Txt variant="small" color={colors.muted}>
              checked in
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

        {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}

        {/* Offline */}
        <View style={styles.panel}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.panelIcon}>
              <Icon name={pack ? 'shield' : 'download'} size={18} color={pack ? colors.success : colors.muted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">{pack ? 'Offline list saved' : 'Scan without signal'}</Txt>
              <Txt variant="small" color={colors.muted}>
                {pack ? `${pack.tickets.length} tickets · downloaded ${store.packAt ? localStamp(store.packAt) : ''}` : 'Download the guest list (encrypted on this phone) to check codes with no connection.'}
              </Txt>
            </View>
          </View>
          {!loaded ? null : (
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Button label={pack ? 'Refresh list' : 'Download for offline'} icon="download" size="sm" variant={pack ? 'ghost' : 'primary'} loading={downloading} onPress={download} />
              {pack ? <Button label="Leave event" icon="trash" size="sm" variant="ghost" onPress={leave} /> : null}
            </View>
          )}
          {store.queue.length ? (
            <View style={styles.queue}>
              <Icon name="sync" size={16} color={colors.warning} />
              <Txt variant="smallStrong" color={colors.warning} style={{ flex: 1 }}>
                {store.queue.length} scan{store.queue.length === 1 ? '' : 's'} waiting to sync
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
        </View>

        {/* Manual lookup */}
        <View style={{ gap: space.sm }}>
          <Txt variant="h3">Find a guest</Txt>
          <Field label="Name or ticket number" value={lookup} onChangeText={setLookup} autoCorrect={false} autoCapitalize="none" placeholder="e.g. Ada, or EVT-AB12" />
          {q.length >= 2 && !online && !pack ? (
            <Txt variant="small" color={colors.dim}>
              Download the guest list to search offline.
            </Txt>
          ) : null}
          {q.length >= 2 && online && remote.isPending ? (
            <Txt variant="small" color={colors.dim}>
              Searching…
            </Txt>
          ) : null}
          {q.length >= 2 && !hits.length && !(online && remote.isPending) && (online || pack) ? (
            <Txt variant="small" color={colors.dim}>
              No guests match “{q}”.
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
                  </Txt>
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
            {v.ticket.ticketType} · {seatText(v.ticket)}
          </Txt>
          <Txt variant="mono" color="rgba(255,255,255,0.75)">
            {v.ticket.id}
          </Txt>
        </View>
      ) : null}
      {v.detail ? (
        <Txt variant="bodyStrong" color="#ffffff" style={{ textAlign: 'center', maxWidth: 340 }}>
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

const styles = StyleSheet.create({
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  camTools: { position: 'absolute', right: space.md, top: space.md, gap: space.sm },
  undo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2 },
  panel: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  panelIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  queue: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  conflict: { gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(245,165,36,0.35)', backgroundColor: colors.bg2 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  result: { alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: gutter, zIndex: 10 },
  resultIcon: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontFamily: font.display.heavy, fontSize: 52, lineHeight: 56, letterSpacing: -1.6, color: '#ffffff', textAlign: 'center' },
  offlineTag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.2)' },
});
