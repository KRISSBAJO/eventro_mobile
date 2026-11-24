/** The wallet: tickets grouped by event, upcoming first, past ones folded away. Opens offline from the saved copy. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Badge, Button, EmptyState, ErrorState, FadeIn, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { firstName, localStamp, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useMyTickets, useRefreshWallet } from '@/lib/queries';
import { inTime } from '@/lib/resale';
import { groupTickets, seatLine, ticketState, type TicketGroup } from '@/lib/tickets';
import type { IncomingTransfer } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

export default function Tickets() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const t = useMyTickets(user?.id);
  const [showPast, setShowPast] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const groups = groupTickets(t.data?.tickets ?? []);
  const incoming = t.data?.incomingTransfers ?? [];

  const refresh = async () => {
    setRefreshing(true);
    await t.refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.lg, flexGrow: 1 }}
      refreshControl={user ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface} /> : undefined}>
      <Txt variant="h1" accessibilityRole="header">
        Tickets
      </Txt>

      {!ready ? null : !user ? (
        <View style={styles.signedOut}>
          <View style={styles.bigIcon}>
            <Icon name="ticket" size={26} color={colors.accent} />
          </View>
          <Txt variant="h2">Your tickets live here</Txt>
          <Txt color={colors.muted}>Sign in to see your tickets and show the QR code at the door, even without signal.</Txt>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Button label="Sign in" onPress={() => router.push({ pathname: '/sign-in', params: { then: 'tickets' } })} />
            <Button label="Create an account" variant="ghost" onPress={() => router.push({ pathname: '/sign-up', params: { then: 'tickets' } })} />
          </View>
          <Txt variant="small" color={colors.dim}>
            Bought as a guest? Create an account with the same email and your tickets come with you.
          </Txt>
        </View>
      ) : t.loading ? (
        <View style={{ gap: space.lg }}>
          <Skeleton height={200} radius={radius.card} />
          <Skeleton height={200} radius={radius.card} />
        </View>
      ) : t.error && !t.data ? (
        <ErrorState message={errorText(t.error)} onRetry={() => t.refetch()} />
      ) : (
        <>
          {t.offline ? (
            <Notice tone="warning" icon="offline" title="Offline — showing saved tickets">
              {t.savedAt ? `Saved ${localStamp(t.savedAt)}. Pull down to refresh when you’re back online.` : 'Pull down to refresh when you’re back online.'}
            </Notice>
          ) : null}

          {incoming.length && !t.offline ? <IncomingTransfers items={incoming} /> : null}

          {!groups.upcoming.length && !groups.past.length ? (
            <EmptyState icon="ticket" title="No tickets yet" body="When you buy tickets, they’ll show up here with the QR code for the door." action="Find events" onAction={() => router.navigate('/')} />
          ) : null}

          {!groups.upcoming.length && groups.past.length ? <EmptyState compact icon="calendar" title="Nothing coming up" body="Your past events are below." action="Find something to do" onAction={() => router.navigate('/')} /> : null}

          {groups.upcoming.map((g, i) => (
            <FadeIn key={g.slug} delay={i * 60}>
              <GroupCard g={g} />
            </FadeIn>
          ))}

          {groups.upcoming.length || groups.past.length ? (
            <Pressable accessibilityRole="link" onPress={() => router.push('/resale')} style={({ pressed }) => [styles.salesLink, pressed && { backgroundColor: colors.surface2 }]}>
              <Icon name="cash" size={18} color={colors.muted} />
              <Txt variant="bodyStrong" style={{ flex: 1 }}>
                Sales & payouts
              </Txt>
              <Icon name="chevronRight" size={17} color={colors.dim} />
            </Pressable>
          ) : null}

          {groups.past.length ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showPast }}
                onPress={() => {
                  haptic.select();
                  setShowPast((s) => !s);
                }}
                style={styles.pastToggle}>
                <Txt variant="bodyStrong" color={colors.muted} style={{ flex: 1 }}>
                  Past events ({groups.past.length})
                </Txt>
                <View style={{ transform: [{ rotate: showPast ? '180deg' : '0deg' }] }}>
                  <Icon name="chevronDown" size={18} color={colors.muted} />
                </View>
              </Pressable>
              {showPast ? groups.past.map((g) => <GroupCard key={g.slug} g={g} />) : null}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/** Tickets friends sent to this account's email: accept them into the wallet (POST /tickets/:id/accept). */
function IncomingTransfers({ items }: { items: IncomingTransfer[] }) {
  const refresh = useRefreshWallet();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());
  const accept = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await api(`/tickets/${encodeURIComponent(id)}/accept`, { method: 'POST' });
      haptic.success();
      await refresh();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <View style={styles.incoming} accessibilityLabel="Tickets sent to you">
      <Txt variant="h3">Tickets waiting for you</Txt>
      {/* A gift shows once (accepting it takes all its tickets); transfers show per ticket. */}
      {items
        .filter((x, i) => !x.gift || items.findIndex((y) => y.gift?.id === x.gift!.id) === i)
        .map((x) => {
        const left = x.transferExpiresAt ? new Date(x.transferExpiresAt).getTime() - now : null;
        if (x.gift) {
          const n = items.filter((y) => y.gift?.id === x.gift!.id).length;
          return (
            <View key={x.gift.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong" numberOfLines={2}>
                  🎁 A gift from {x.gift.from}: {x.event.title}
                </Txt>
                <Txt variant="small" color={colors.muted}>
                  {n} × {x.ticketType.name} · {when(x.event.startsAt).short}
                </Txt>
                {x.gift.message ? (
                  <Txt variant="small" color={colors.text} numberOfLines={3}>
                    “{x.gift.message}”
                  </Txt>
                ) : null}
              </View>
              <Button label={busy === x.id ? 'Accepting…' : 'Accept gift'} size="sm" loading={busy === x.id} onPress={() => accept(x.id)} />
            </View>
          );
        }
        return (
          <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {x.event.title}
              </Txt>
              <Txt variant="small" color={colors.muted}>
                {x.ticketType.name} · {when(x.event.startsAt).short} · from {x.holderName}
              </Txt>
              {left !== null ? (
                <Txt variant="tiny" color={left < 24 * 3600_000 ? colors.accentHi : colors.dim}>
                  Accept {inTime(left)}, or it goes back to {firstName(x.holderName)}
                </Txt>
              ) : null}
            </View>
            <Button label={busy === x.id ? 'Accepting…' : 'Accept ticket'} size="sm" loading={busy === x.id} onPress={() => accept(x.id)} />
          </View>
        );
      })}
      {error ? (
        <Txt variant="small" color={colors.accentHi}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

function GroupCard({ g }: { g: TicketGroup }) {
  const d = when(g.event.startsAt);
  const dim = g.past || g.cancelled;
  const ready = g.tickets.filter((x) => ticketState(x).key === 'ready').length;
  return (
    <View style={[styles.group, dim && { opacity: 0.85 }]}>
      <Pressable accessibilityRole="link" accessibilityLabel={`${g.event.title}, ${d.date}`} onPress={() => router.push({ pathname: '/event/[slug]', params: { slug: g.slug } })}>
        <View style={styles.banner}>
          <Image source={g.event.imageUrl ? { uri: g.event.imageUrl } : null} style={[StyleSheet.absoluteFill, dim && { opacity: 0.45 }]} contentFit="cover" transition={200} />
          <LinearGradient colors={[colors.fade0, colors.fade]} locations={[0.2, 1]} style={StyleSheet.absoluteFill} />
          <View style={styles.bannerText}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {g.cancelled ? <Badge label={g.refunded ? 'Event cancelled · refunded' : 'Event cancelled · refund pending'} tone="accent" /> : null}
              {!g.cancelled && ready ? <Badge label={`${ready} ready`} tone="success" /> : null}
              {g.past && !g.cancelled ? <Badge label="Ended" tone="glass" /> : null}
            </View>
            <Txt variant="h3" numberOfLines={1}>
              {g.event.title}
            </Txt>
            <Txt variant="small" color="rgba(247,242,242,0.8)" numberOfLines={1}>
              {d.short} · {d.time}
              {g.event.venue ? ` · ${g.event.venue.name}` : g.event.online ? ' · Online' : ''}
            </Txt>
          </View>
        </View>
      </Pressable>
      {g.tickets.map((tk, i) => {
        const s = ticketState(tk);
        return (
          <Pressable
            key={tk.id}
            accessibilityRole="button"
            accessibilityLabel={`Ticket ${i + 1}, ${tk.ticketType.name}, ${seatLine(tk)}. ${s.label}. Open ticket`}
            onPress={() => {
              haptic.tap();
              router.push({ pathname: '/ticket/[id]', params: { id: tk.id } });
            }}
            style={({ pressed }) => [styles.ticketRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2 }, pressed && { backgroundColor: colors.surface2 }]}>
            <View style={[styles.ticketIcon, s.key === 'ready' && { backgroundColor: colors.accentSoft }]}>
              <Icon name={s.key === 'ready' ? 'ticket' : s.key === 'gift' ? 'gift' : s.key === 'cancelled' ? 'alert' : 'ticket'} size={18} color={s.key === 'ready' ? colors.accent : colors.muted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {tk.ticketType.name}
              </Txt>
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {seatLine(tk)}
              </Txt>
              {s.key !== 'ready' ? (
                <Txt variant="tiny" color={s.tone === 'accent' ? colors.accentHi : s.tone === 'warning' ? colors.warning : colors.dim} numberOfLines={1}>
                  {s.label}
                </Txt>
              ) : null}
            </View>
            {s.key === 'ready' ? (
              <View style={styles.showQr}>
                <Txt variant="tiny" color={colors.accentInk}>
                  Show
                </Txt>
              </View>
            ) : (
              <Icon name="chevronRight" size={17} color={colors.dim} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  signedOut: { gap: space.sm, padding: space.xl, borderRadius: radius.panel, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  bigIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  banner: { height: 132, backgroundColor: colors.surface2 },
  bannerText: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.md, gap: 4 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 68, paddingVertical: space.sm },
  ticketIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  showQr: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  incoming: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  salesLink: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pastToggle: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: space.xs, marginTop: space.sm },
});
