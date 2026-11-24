/**
 * One ticket: a large rotating QR code for the door, seat details, and what you can do with it (send it to a
 * friend, sell it on fan resale, take either back).
 *
 * The code is made on the phone from the ticket's QR seed (door-code.ts: HMAC-SHA256, a new code every 15 seconds),
 * so it works with no signal at all. Without a seed (an older saved copy) it falls back to GET /tickets/:id/qr.
 * The screen stays awake while the code shows.
 */
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CountdownRing } from '@/components/countdown-ring';
import { Icon } from '@/components/icons';
import { KeepAwake } from '@/components/keep-awake';
import { QrCode } from '@/components/qr';
import { Button, EmptyState, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText, isOffline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { codeAt, WINDOW_MS } from '@/lib/door-code';
import { localStamp, when, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useMyResale, useMyTickets, useRefreshWallet } from '@/lib/queries';
import { blockedLine, blockers, breakdown, fmt, RESALE_FEE_PERMILLE, rulesOf, transferExpiry } from '@/lib/resale';
import { readJson, writeJson } from '@/lib/storage';
import { seatLine, ticketState } from '@/lib/tickets';
import type { QrToken, Ticket } from '@/lib/types';
import { colors, font, gutter, radius, space } from '@/theme';

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const t = useMyTickets(user?.id);
  const ticket = t.data?.tickets.find((x) => x.id === id);
  const siblings = ticket ? (t.data?.tickets ?? []).filter((x) => x.event.slug === ticket.event.slug) : [];

  const back = () => (router.canGoBack() ? router.back() : router.replace('/tickets'));
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <IconButton icon="back" label="Back to tickets" onPress={back} />
      <Txt variant="title" accessibilityRole="header">
        {siblings.length > 1 && ticket ? `Ticket ${siblings.indexOf(ticket) + 1} of ${siblings.length}` : 'Your ticket'}
      </Txt>
      <View style={{ width: 44 }} />
    </View>
  );

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <EmptyState icon="lock" title="Sign in to see this ticket" action="Sign in" onAction={() => router.push({ pathname: '/sign-in', params: { then: `/ticket/${id}` } })} />
      </View>
    );
  }
  if (t.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <View style={{ padding: gutter }}>
          <Skeleton height={520} radius={radius.panel} />
        </View>
      </View>
    );
  }
  if (!ticket) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <EmptyState icon="ticket" title="Ticket not found" body={t.error ? errorText(t.error) : 'It may have been transferred, resold or refunded.'} action="Back to tickets" onAction={back} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.xxxl, gap: space.lg }}>
        {t.offline ? (
          <Notice tone="warning" icon="offline" title="Offline — showing saved tickets">
            {ticket.qrSeed ? 'Your door code still works: it’s made on this phone.' : 'Pull down in your wallet to refresh when you’re back online.'}
          </Notice>
        ) : null}
        {siblings.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {siblings.map((s, i) => {
              const on = s.id === ticket.id;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Ticket ${i + 1}`}
                  onPress={() => {
                    haptic.select();
                    router.setParams({ id: s.id });
                  }}
                  style={[styles.pagerChip, on && styles.pagerChipOn]}>
                  <Txt variant="smallStrong" color={on ? colors.accentInk : colors.text}>
                    {i + 1}
                  </Txt>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <TicketCard key={ticket.id} t={ticket} offline={t.offline} feePermille={t.data?.resaleFeePermille ?? RESALE_FEE_PERMILLE} userId={user.id} />
      </ScrollView>
    </View>
  );
}

function TicketCard({ t, offline, feePermille, userId }: { t: Ticket; offline: boolean; feePermille: number; userId: string }) {
  const { width } = useWindowDimensions();
  const d = when(t.event.startsAt);
  const abbr = zoneAbbr(t.event.timezone, t.event.startsAt);
  const state = ticketState(t);
  const qrSize = Math.min(260, width - gutter * 2 - space.xxxl * 2);
  const live = state.key === 'ready';
  const [now] = useState(() => Date.now());
  const rules = rulesOf(t.event);
  const blocked = blockers(t, rules, now);
  const expiry = state.key === 'sent' ? transferExpiry(t.transferExpiresAt, t.event.startsAt, now, rules.cutoffMinutes) : null;
  const resale = useMyResale(state.key === 'listed' ? userId : undefined);
  const listing = resale.data?.listings.find((l) => l.ticketId === t.id && (l.status === 'ACTIVE' || l.status === 'HELD'));
  const held = listing?.status === 'HELD';
  const net = t.listCents !== null ? breakdown(t.listCents, feePermille, rules.royaltyPermille).payout : null;
  const refresh = useRefreshWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'warning' | 'accent'; title: string; body: string } | null>(null);

  const undo = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (t.status === 'TRANSFER_PENDING') {
        await api(`/tickets/${encodeURIComponent(t.id)}/transfer`, { method: 'DELETE' });
        haptic.success();
        setNote({ tone: 'success', title: 'Transfer cancelled', body: 'The ticket is back in your wallet.' });
      } else {
        await api(`/tickets/${encodeURIComponent(t.id)}/listing`, { method: 'DELETE' });
        haptic.success();
        setNote({ tone: 'success', title: 'Listing removed', body: 'Your ticket is back in your wallet and works as normal.' });
      }
      await refresh();
    } catch (e) {
      haptic.error();
      const msg = errorText(e);
      if (/buying this ticket right now/i.test(msg)) setNote({ tone: 'warning', title: 'Someone is buying it right now', body: 'A buyer is checking out with this ticket. Try again in a few minutes.' });
      else setNote({ tone: 'accent', title: t.status === 'TRANSFER_PENDING' ? 'Couldn’t cancel the transfer' : 'Couldn’t remove the listing', body: msg });
    } finally {
      setBusy(false);
    }
  };

  const showActions = !offline && (state.key === 'ready' || state.key === 'sent' || state.key === 'listed');

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Image source={t.event.imageUrl ? { uri: t.event.imageUrl } : null} style={styles.cardImage} contentFit="cover" />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h3" color={colors.ink} numberOfLines={2}>
              {t.event.title}
            </Txt>
            <Txt variant="small" color={colors.inkMuted}>
              {d.short} · {d.time}
              {abbr ? ` ${abbr}` : ''}
              {t.event.doorsAt ? ` · Doors ${when(t.event.doorsAt).time}` : ''}
            </Txt>
            <Txt variant="small" color={colors.inkMuted} numberOfLines={1}>
              {t.event.online ? 'Online event' : [t.event.venue?.name, t.event.venue?.city].filter(Boolean).join(', ')}
            </Txt>
          </View>
        </View>

        <View style={styles.perforation}>
          <View style={[styles.notch, { left: -12 }]} />
          <View style={styles.dash} />
          <View style={[styles.notch, { right: -12 }]} />
        </View>

        <View style={{ alignItems: 'center', gap: space.md, paddingHorizontal: space.xl }}>
          {live ? (
            <>
              <KeepAwake />
              {t.qrSeed ? <LocalQr ticketId={t.id} seed={t.qrSeed} size={qrSize} /> : <ServerQr ticketId={t.id} size={qrSize} offline={offline} />}
            </>
          ) : (
            <View style={[styles.statusBox, { width: qrSize + 24 }, state.key === 'cancelled' && { backgroundColor: 'rgba(255,77,61,0.08)' }]}>
              <Icon name={state.key === 'cancelled' ? 'alert' : state.key === 'gift' ? 'gift' : state.key === 'used' ? 'check' : state.key === 'listed' ? 'tag' : state.key === 'sent' ? 'mail' : 'clock'} size={28} color={state.key === 'cancelled' ? '#d7321f' : colors.inkMuted} />
              <Txt variant="title" color={colors.ink} style={{ textAlign: 'center' }}>
                {state.key === 'cancelled' ? 'Event cancelled' : state.label}
              </Txt>
              {state.key === 'listed' ? (
                <>
                  <Txt variant="small" color={held ? '#b26b00' : colors.inkMuted} style={{ textAlign: 'center' }}>
                    {held ? 'A buyer is checking out with it right now.' : net !== null ? `You’ll receive ${rules.royaltyPermille === undefined ? 'about ' : ''}${fmt(net, t.order.currency)} when it sells.` : 'We’ll pay you when it sells.'}
                  </Txt>
                  <Txt variant="small" color={colors.inkMuted} style={{ textAlign: 'center' }}>
                    Your QR code is off while it’s listed.
                  </Txt>
                </>
              ) : (
                <Txt variant="small" color={colors.inkMuted} style={{ textAlign: 'center' }}>
                  {state.detail}
                </Txt>
              )}
              {expiry ? (
                <View style={{ alignItems: 'center', gap: 1, marginTop: 2 }}>
                  <Txt variant="smallStrong" color={expiry.soon ? '#d7321f' : colors.ink}>
                    {expiry.text}
                  </Txt>
                  <Txt variant="small" color={colors.inkMuted} style={{ textAlign: 'center' }}>
                    {expiry.detail}
                  </Txt>
                </View>
              ) : null}
              {state.key === 'cancelled' && t.event.cancelReason ? (
                <Txt variant="small" color={colors.inkMuted} style={{ textAlign: 'center', fontStyle: 'italic' }}>
                  “{t.event.cancelReason}”
                </Txt>
              ) : null}
            </View>
          )}
        </View>

        <View style={styles.details}>
          <Detail label="Ticket" value={t.ticketType.name} />
          <Detail label="Seat" value={seatLine(t)} />
          <Detail label="Name" value={t.holderName} />
          <Detail label="Order" value={t.orderId} mono />
        </View>

        {t.event.online && t.event.streamUrl && (t.status === 'ACTIVE' || t.status === 'CHECKED_IN') ? (
          <View style={{ paddingHorizontal: space.xl }}>
            <Button label="Watch the stream" icon="stream" onPress={() => WebBrowser.openBrowserAsync(t.event.streamUrl!).catch(() => undefined)} />
          </View>
        ) : null}

        {showActions && state.key === 'ready' && (blocked.sell || blocked.transfer) ? (
          <Txt variant="small" color={colors.inkMuted} style={{ paddingHorizontal: space.xl, textAlign: 'center' }}>
            {blockedLine(blocked)}
          </Txt>
        ) : null}

        {showActions ? (
          <View style={styles.actions}>
            {state.key === 'ready' ? (
              <>
                <Action
                  icon="send"
                  label="Transfer"
                  disabled={!!blocked.transfer}
                  hint={blocked.transfer || undefined}
                  onPress={() => router.push({ pathname: '/transfer/[id]', params: { id: t.id } })}
                />
                <View style={styles.actionSep} />
                {/* Sell stays tappable when resale is off: the sheet explains why and offers a transfer instead. */}
                <Action icon="tag" label="Sell" muted={!!blocked.sell} onPress={() => router.push({ pathname: '/sell/[id]', params: { id: t.id } })} />
              </>
            ) : (
              <Action icon="undo" label={busy ? 'Working…' : state.key === 'sent' ? 'Cancel transfer' : held ? 'Being bought…' : 'Remove listing'} disabled={busy || held} onPress={undo} />
            )}
          </View>
        ) : null}

        <Txt variant="mono" color={colors.inkMuted} style={{ textAlign: 'center', fontSize: 10, paddingBottom: space.lg }}>
          {t.id}
        </Txt>
      </View>
      {note ? (
        <Notice tone={note.tone} icon={note.tone === 'success' ? 'check' : 'alert'} title={note.title}>
          {note.body}
        </Notice>
      ) : null}
    </View>
  );
}

function Action({ icon, label, onPress, disabled, muted, hint }: { icon: 'send' | 'tag' | 'undo'; label: string; onPress: () => void; disabled?: boolean; muted?: boolean; hint?: string }) {
  const color = disabled || muted ? colors.inkMuted : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.action, disabled && { opacity: 0.45 }, pressed && { backgroundColor: 'rgba(13,13,15,0.05)' }]}>
      <Icon name={icon} size={17} color={color} />
      <Txt variant="smallStrong" color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.lg }}>
      <Txt variant="eyebrow" color={colors.inkMuted} style={{ fontSize: 10 }}>
        {label}
      </Txt>
      <Txt variant="smallStrong" color={colors.ink} style={[{ flex: 1, textAlign: 'right' }, mono && { fontFamily: font.mono.medium }]}>
        {value}
      </Txt>
    </View>
  );
}

/** The door code made on this phone from the ticket's seed: no network needed, a new code every window. */
function LocalQr({ ticketId, seed, size }: { ticketId: string; seed: string; size: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  let code: ReturnType<typeof codeAt> | null = null;
  try {
    code = codeAt(seed, ticketId, now);
  } catch {
    code = null;
  }
  if (!code) return <ServerQr ticketId={ticketId} size={size} offline={false} />;
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View style={styles.qrFrame}>
        <QrCode value={code.token} size={size} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLabel={`Code refreshes in ${Math.ceil(code.expiresInMs / 1000)} seconds`}>
        <CountdownRing fraction={code.expiresInMs / WINDOW_MS} size={26} stroke={3} track="rgba(13,13,15,0.12)" />
        <Txt variant="small" color={colors.inkMuted}>
          Live code · refreshes in {Math.ceil(code.expiresInMs / 1000)}s. Screenshots won’t scan.
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="shield" size={14} color={colors.inkMuted} />
        <Txt variant="tiny" color={colors.inkMuted}>
          Works offline · made on this phone
        </Txt>
      </View>
    </View>
  );
}

type SavedQr = QrToken & { at: number };

/** No seed saved: fetches the door code, refreshes it when the API says it rotates, and counts down. */
function ServerQr({ ticketId, size, offline }: { ticketId: string; size: number; offline: boolean }) {
  const [qr, setQr] = useState<{ token: string; expiresAt: number; window: number } | null>(null);
  const [stale, setStale] = useState<SavedQr | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const r = await api<QrToken>(`/tickets/${encodeURIComponent(ticketId)}/qr`);
        if (!live) return;
        const window = Math.max(WINDOW_MS, r.expiresInMs);
        setQr({ token: r.token, expiresAt: Date.now() + r.expiresInMs, window });
        setStale(null);
        setError('');
        void writeJson(`qr-${ticketId}`, { ...r, at: Date.now() });
        timer = setTimeout(load, Math.max(r.expiresInMs, 1000) + 150);
      } catch (e) {
        if (!live) return;
        if (isOffline(e)) {
          const saved = await readJson<SavedQr>(`qr-${ticketId}`);
          if (!live) return;
          setStale(saved);
          setError(saved ? '' : 'You’re offline and this ticket’s code hasn’t been saved yet. Connect once to load it.');
        } else {
          setError(errorText(e));
        }
        timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [ticketId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  if (error && !qr && !stale) {
    return (
      <View style={[styles.qrBox, { width: size + 24, height: size + 24 }]}>
        <Icon name={offline ? 'offline' : 'alert'} size={26} color={colors.inkMuted} />
        <Txt variant="small" color={colors.inkMuted} style={{ textAlign: 'center' }}>
          {error}
        </Txt>
      </View>
    );
  }
  const token = qr?.token ?? stale?.token;
  if (!token) {
    return <View style={[styles.qrBox, { width: size + 24, height: size + 24 }]} accessibilityLabel="Loading your code" />;
  }
  const left = qr ? Math.max(0, qr.expiresAt - now) : 0;
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View style={[styles.qrFrame, stale && { opacity: 0.55 }]}>
        <QrCode value={token} size={size} />
      </View>
      {qr ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLabel={`Code refreshes in ${Math.ceil(left / 1000)} seconds`}>
          <CountdownRing fraction={left / qr.window} size={26} stroke={3} track="rgba(13,13,15,0.12)" />
          <Txt variant="small" color={colors.inkMuted}>
            Live code · refreshes in {Math.ceil(left / 1000)}s. Screenshots won’t scan.
          </Txt>
        </View>
      ) : stale ? (
        <Txt variant="small" color="#b26b00" style={{ textAlign: 'center' }}>
          {`Offline: this is the last code, from ${localStamp(stale.at)}. It may not scan; door staff can look up your ticket number below.`}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter - 4, paddingBottom: space.md },
  pagerChip: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  pagerChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  card: { backgroundColor: colors.paper, borderRadius: radius.panel, overflow: 'hidden', gap: space.lg },
  cardTop: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.xl, paddingBottom: 0 },
  cardImage: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: '#ddd' },
  perforation: { height: 24, justifyContent: 'center' },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bg },
  dash: { marginHorizontal: space.xl, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(13,13,15,0.18)' },
  qrFrame: { padding: 12, borderRadius: radius.lg, backgroundColor: '#ffffff' },
  qrBox: { borderRadius: radius.lg, backgroundColor: 'rgba(13,13,15,0.05)', alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  statusBox: { minHeight: 200, borderRadius: radius.lg, backgroundColor: 'rgba(13,13,15,0.05)', alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  details: { gap: space.sm, marginHorizontal: space.xl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: 'rgba(13,13,15,0.1)' },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(13,13,15,0.1)', marginBottom: -space.lg + 4 },
  action: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  actionSep: { width: 1, backgroundColor: 'rgba(13,13,15,0.1)' },
});
