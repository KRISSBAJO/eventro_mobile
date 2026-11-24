/** The wallet: tickets grouped by event, upcoming first, past ones folded away. Opens offline from the saved copy. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Badge, Button, EmptyState, ErrorState, FadeIn, Notice, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localStamp, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useMyTickets } from '@/lib/queries';
import { groupTickets, seatLine, ticketState, type TicketGroup } from '@/lib/tickets';
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

          {incoming.length ? (
            <Notice tone="plain" icon="gift" title={`${incoming.length} ticket${incoming.length === 1 ? '' : 's'} waiting for you`}>
              {`${incoming.map((x) => `${x.holderName} sent you ${x.ticketType.name} for ${x.event.title}`).join('. ')}. Accept on the Eventro website for now; accepting in the app is coming soon.`}
            </Notice>
          ) : null}

          {!groups.upcoming.length && !groups.past.length ? (
            <EmptyState icon="ticket" title="No tickets yet" body="When you buy tickets, they’ll show up here with the QR code for the door." action="Find events" onAction={() => router.navigate('/')} />
          ) : null}

          {!groups.upcoming.length && groups.past.length ? <EmptyState compact icon="calendar" title="Nothing coming up" body="Your past events are below." action="Find something to do" onAction={() => router.navigate('/')} /> : null}

          {groups.upcoming.map((g, i) => (
            <FadeIn key={g.slug} delay={i * 60}>
              <GroupCard g={g} />
            </FadeIn>
          ))}

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
  pastToggle: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: space.xs, marginTop: space.sm },
});
