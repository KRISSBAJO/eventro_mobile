/**
 * One ticket: a large rotating QR code for the door (GET /tickets/:id/qr; the code changes every 15 seconds and
 * the API says when via `expiresInMs`), a countdown ring, seat details, and the screen kept awake while it shows.
 * The last code is saved so the ticket still opens offline (it may not scan once it has rotated).
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
import { api, errorText, isOffline, WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localStamp, when, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useMyTickets } from '@/lib/queries';
import { readJson, writeJson } from '@/lib/storage';
import { seatLine, ticketState } from '@/lib/tickets';
import type { QrToken, Ticket } from '@/lib/types';
import { colors, font, gutter, radius, space } from '@/theme';

const WINDOW_MS = 15_000;

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
        <EmptyState icon="lock" title="Sign in to see this ticket" action="Sign in" onAction={() => router.push('/sign-in')} />
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
            Pull down in your wallet to refresh when you’re back online.
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
        <TicketCard key={ticket.id} t={ticket} offline={t.offline} />
      </ScrollView>
    </View>
  );
}

function TicketCard({ t, offline }: { t: Ticket; offline: boolean }) {
  const { width } = useWindowDimensions();
  const d = when(t.event.startsAt);
  const abbr = zoneAbbr(t.event.timezone, t.event.startsAt);
  const state = ticketState(t);
  const qrSize = Math.min(260, width - gutter * 2 - space.xxxl * 2);
  const live = state.key === 'ready';

  return (
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
            <RotatingQr ticketId={t.id} size={qrSize} offline={offline} />
          </>
        ) : (
          <View style={[styles.statusBox, { width: qrSize + 24 }, state.key === 'cancelled' && { backgroundColor: 'rgba(255,77,61,0.08)' }]}>
            <Icon name={state.key === 'cancelled' ? 'alert' : state.key === 'gift' ? 'gift' : state.key === 'used' ? 'check' : state.key === 'listed' ? 'tag' : state.key === 'sent' ? 'mail' : 'clock'} size={28} color={state.key === 'cancelled' ? '#d7321f' : colors.inkMuted} />
            <Txt variant="title" color={colors.ink} style={{ textAlign: 'center' }}>
              {state.key === 'cancelled' ? 'Event cancelled' : state.label}
            </Txt>
            <Txt variant="small" color={colors.inkMuted} style={{ textAlign: 'center' }}>
              {state.detail}
            </Txt>
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
        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg }}>
          <Button label="Watch the stream" icon="stream" onPress={() => WebBrowser.openBrowserAsync(t.event.streamUrl!).catch(() => undefined)} />
        </View>
      ) : null}
      {state.key === 'sent' || state.key === 'listed' || state.key === 'gift' ? (
        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg }}>
          <Button label="Manage on the website" variant="ghost" size="md" iconRight="external" onPress={() => WebBrowser.openBrowserAsync(`${WEB_URL}/tickets`).catch(() => undefined)} style={{ borderColor: 'rgba(13,13,15,0.2)' }} />
        </View>
      ) : null}
      <Txt variant="mono" color={colors.inkMuted} style={{ textAlign: 'center', fontSize: 10, paddingBottom: space.lg }}>
        {t.id}
      </Txt>
    </View>
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

type SavedQr = QrToken & { at: number };

/** Fetches the door code, refreshes it when the API says it rotates, and shows a ring counting down to the next one. */
function RotatingQr({ ticketId, size, offline }: { ticketId: string; size: number; offline: boolean }) {
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
});
