/** The wallet: tickets grouped by event, upcoming first, past ones folded away. Opens offline from the saved copy. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactEventCard } from '@/components/event-card';
import { Icon, type IconName } from '@/components/icons';
import { TierChip } from '@/components/tier-look';
import { Badge, Button, ErrorState, FadeIn, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CATEGORY_NAME, cityOnly, countryName, firstName, localStamp, money, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { rankNear, usePlace } from '@/lib/place';
import { useAllEvents, useMyTickets, useRefreshWallet } from '@/lib/queries';
import { inTime } from '@/lib/resale';
import { useSaved } from '@/lib/saved';
import { claimShort } from '@/lib/guarantee';
import { groupTickets, seatLine, ticketState, type TicketGroup } from '@/lib/tickets';
import type { EventCard, IncomingTransfer } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

export default function Tickets() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const t = useMyTickets(user?.id);
  const saved = useSaved();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [refreshing, setRefreshing] = useState(false);

  const groups = groupTickets(t.data?.tickets ?? []);
  const incoming = t.data?.incomingTransfers ?? [];
  // Tickets ready to show at the door for events still to come.
  const activeCount = groups.upcoming.reduce((n, g) => n + g.tickets.filter((x) => ticketState(x).key === 'ready').length, 0);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([t.refetch(), saved.refetch()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.lg, flexGrow: 1 }}
      refreshControl={user ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface} /> : undefined}>
      {/* Warm glow behind the top of the screen, like Discover (a zero-size anchor so it can't widen the page) */}
      <View style={styles.glowAnchor} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,77,61,0.16)', 'rgba(255,120,80,0.04)', 'rgba(15,10,11,0)']}
          locations={[0, 0.5, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={[styles.glow, { height: insets.top + 300 }]}
        />
      </View>
      <View style={styles.headRow}>
        <Txt variant="h1" accessibilityRole="header">
          Tickets
        </Txt>
        {user && t.data ? (
          <Txt variant="smallStrong" color={colors.muted}>
            {activeCount} active
          </Txt>
        ) : null}
      </View>

      {!ready ? null : !user ? (
        <>
          <View style={styles.signedOut}>
            <TicketArt />
            <Txt variant="h2" style={{ textAlign: 'center' }}>
              Your tickets live here
            </Txt>
            <Txt color={colors.muted} style={{ textAlign: 'center', maxWidth: 320 }}>
              Sign in to see your tickets and show the QR code at the door, even without signal.
            </Txt>
            <View style={{ gap: space.sm, marginTop: space.sm, alignSelf: 'stretch' }}>
              <Button label="Sign in" onPress={() => router.push({ pathname: '/sign-in', params: { then: 'tickets' } })} />
              <Button label="Create an account" variant="ghost" onPress={() => router.push({ pathname: '/sign-up', params: { then: 'tickets' } })} />
            </View>
            <Txt variant="small" color={colors.dim} style={{ textAlign: 'center' }}>
              Bought as a guest? Create an account with the same email and your tickets come with you.
            </Txt>
          </View>
          <Picks />
        </>
      ) : t.loading ? (
        <View style={{ gap: space.lg }}>
          <Skeleton height={46} radius={radius.pill} />
          <Skeleton height={200} radius={radius.card} />
          <Skeleton height={200} radius={radius.card} />
        </View>
      ) : t.error && !t.data ? (
        <ErrorState message={errorText(t.error)} onRetry={() => t.refetch()} />
      ) : (
        <>
          <Segments
            value={tab}
            onChange={setTab}
            items={[
              { id: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
              { id: 'past', label: 'Past', count: groups.past.length },
              { id: 'saved', label: 'Saved', count: saved.items.length },
            ]}
          />

          {t.offline ? (
            <Notice tone="warning" icon="offline" title="Offline — showing saved tickets">
              {t.savedAt ? `Saved ${localStamp(t.savedAt)}. Pull down to refresh when you’re back online.` : 'Pull down to refresh when you’re back online.'}
            </Notice>
          ) : null}

          {tab === 'upcoming' ? (
            <>
              {incoming.length && !t.offline ? <IncomingTransfers items={incoming} /> : null}

              {!groups.upcoming.length ? (
                <TicketsEmpty
                  title={groups.past.length ? 'Nothing coming up' : 'No tickets yet'}
                  body={
                    groups.past.length
                      ? 'Your past events are under Past. Find something new to look forward to.'
                      : 'When you buy tickets for concerts, comedy, nightlife and more, they’ll show up here with the QR code for the door.'
                  }
                />
              ) : null}

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

              {!groups.upcoming.length ? <Picks /> : null}
            </>
          ) : tab === 'past' ? (
            groups.past.length ? (
              <>
                <ListNote>{`${groups.past.length} past ${groups.past.length === 1 ? 'event' : 'events'} · your tickets stay here as a keepsake`}</ListNote>
                {groups.past.map((g, i) => (
                  <FadeIn key={g.slug} delay={i * 60}>
                    <GroupCard g={g} />
                  </FadeIn>
                ))}
              </>
            ) : (
              <>
                <TicketsEmpty icon="calendar" title="No past events yet" body="After you’ve been to an event, it moves here with your tickets, so you can look back on your nights out." />
                <Picks />
              </>
            )
          ) : saved.loading ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={104} radius={radius.card} />
              <Skeleton height={104} radius={radius.card} />
            </View>
          ) : saved.error ? (
            <ErrorState message={errorText(saved.error)} onRetry={() => void saved.refetch()} />
          ) : saved.items.length ? (
            <View>
              <ListNote>{`${saved.items.length} saved · the same list as on the Eventro website`}</ListNote>
              <View style={{ marginTop: space.md }}>
                {saved.items.map((e, i) => (
                  <FadeIn key={e.slug} delay={i * 40}>
                    <CompactEventCard e={e} />
                  </FadeIn>
                ))}
              </View>
            </View>
          ) : (
            <>
              <TicketsEmpty icon="heart" title="Nothing saved yet" body="Tap the heart on any event to keep it here. Saved events that have happened, or are no longer on sale, drop off." action="Find events to save" to="/search" />
              <Picks />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

type Tab = 'upcoming' | 'past' | 'saved';

/** Upcoming / Past / Saved in one pill bar, each with a count. */
function Segments({ value, onChange, items }: { value: Tab; onChange: (t: Tab) => void; items: { id: Tab; label: string; count: number }[] }) {
  return (
    <View style={styles.segments} accessibilityRole="tablist">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${it.label}, ${it.count}`}
            onPress={() => {
              haptic.select();
              onChange(it.id);
            }}
            style={[styles.segment, on && styles.segmentOn]}>
            <Txt variant="smallStrong" color={on ? colors.text : colors.muted}>
              {it.label}
            </Txt>
            {it.count ? (
              <View style={[styles.segCount, on && { backgroundColor: colors.accent }]}>
                <Txt variant="tiny" color={on ? colors.accentInk : colors.muted} style={{ fontSize: 10, lineHeight: 13 }}>
                  {it.count}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The ticket illustration for empty states: a ticket in a glowing tile. */
function TicketArt({ icon = 'ticket' }: { icon?: IconName }) {
  return (
    <View style={styles.art} accessible={false}>
      <View style={styles.artGlow} />
      <View style={[styles.artDot, { top: 8, right: 22, backgroundColor: colors.accent }]} />
      <View style={[styles.artDot, { bottom: 22, left: 14, width: 6, height: 6, backgroundColor: colors.warning, opacity: 0.8 }]} />
      <View style={styles.artTile}>
        <View style={styles.artTicket}>
          <Icon name={icon} size={30} color={colors.accent} />
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 10 }}>
          <View style={styles.artBar} />
          <View style={[styles.artBar, { width: 10, backgroundColor: colors.accent }]} />
          <View style={styles.artBar} />
        </View>
      </View>
    </View>
  );
}

function TicketsEmpty({ title, body, icon, action = 'Explore events', to = '/' }: { title: string; body: string; icon?: IconName; action?: string; to?: '/' | '/search' }) {
  return (
    <View style={styles.empty}>
      <TicketArt icon={icon} />
      <Txt variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt color={colors.muted} style={{ textAlign: 'center', maxWidth: 320 }}>
        {body}
      </Txt>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptic.tap();
          router.navigate(to);
        }}
        style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}>
        <LinearGradient colors={[colors.accent, '#ff7a45']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Txt variant="bodyStrong" color={colors.accentInk}>
          {action}
        </Txt>
        {/* In a View so it paints above the gradient on web */}
        <View>
          <Icon name="arrowRight" size={18} color={colors.accentInk} />
        </View>
      </Pressable>
    </View>
  );
}

/** A short line above a tab's list. */
function ListNote({ children }: { children: string }) {
  return (
    <Txt variant="small" color={colors.muted}>
      {children}
    </Txt>
  );
}

/** A few events near you, for when there's nothing in the wallet yet. */
function Picks() {
  const { place } = usePlace();
  const all = useAllEvents();
  const ranked = rankNear(all.data?.items ?? [], place);
  const local = ranked.filter((r) => r.tier === 'city' || r.tier === 'country');
  const picks = (local.length ? local : ranked).slice(0, 4).map((r) => r.event);
  const city = place?.city && place.source !== 'precise' && ranked.some((r) => r.tier === 'city') ? cityOnly(place.city) : '';
  if (!picks.length) return null;
  return (
    <View style={{ gap: space.md, marginTop: space.md }}>
      <View style={{ gap: 2 }}>
        <Txt variant="eyebrow" color={colors.accent}>
          Recommended picks
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="h3">{city ? `Happening in ${city}` : local.length && place ? `Happening in ${countryName(place.country)}` : 'On sale now'}</Txt>
          <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.navigate('/search')} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Txt variant="smallStrong" color={colors.accent}>
              See all
            </Txt>
            <Icon name="chevronRight" size={15} color={colors.accent} />
          </Pressable>
        </View>
      </View>
      {picks.map((e) => (
        <PickRow key={e.slug} e={e} />
      ))}
    </View>
  );
}

function PickRow({ e }: { e: EventCard }) {
  const d = when(e.startsAt);
  const open = () => {
    haptic.select();
    router.push({ pathname: '/event/[slug]', params: { slug: e.slug } });
  };
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${e.title}, ${d.date}. From ${money(e.fromCents, e.currency)}`}
      onPress={open}
      style={({ pressed }) => [styles.pick, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.pickThumb}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={e.slug} />
        <LinearGradient colors={['rgba(15,10,11,0.1)', 'rgba(15,10,11,0.7)']} style={StyleSheet.absoluteFill} />
        <View style={styles.pickDate}>
          <Txt variant="eyebrow" color={colors.accent} style={{ fontSize: 9, lineHeight: 11 }}>
            {d.month}
          </Txt>
          <Txt variant="bodyStrong" style={{ lineHeight: 18 }}>
            {d.day}
          </Txt>
        </View>
        <Txt variant="tiny" numberOfLines={1} style={styles.pickCat}>
          {CATEGORY_NAME[e.category] ?? e.category}
        </Txt>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="title" numberOfLines={1}>
          {e.title}
        </Txt>
        {e.subtitle ? (
          <Txt variant="small" color={colors.muted} numberOfLines={1}>
            {e.subtitle}
          </Txt>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={e.venue ? 'pin' : 'stream'} size={12} color={colors.accent} />
          <Txt variant="small" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
            {[e.venue, cityOnly(e.city)].filter(Boolean).join(', ') || 'Online'}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <Txt variant="small" color={colors.muted}>
            From{' '}
            <Txt variant="smallStrong" color={colors.accent}>
              {money(e.fromCents, e.currency)}
            </Txt>
          </Txt>
          <View style={styles.bookPill}>
            <Txt variant="tiny" color={colors.text}>
              Get tickets
            </Txt>
          </View>
        </View>
      </View>
    </Pressable>
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
              <Icon name={s.key === 'ready' ? 'ticket' : s.key === 'gift' ? 'gift' : s.key === 'cancelled' ? 'alert' : s.key === 'refunded' ? 'cash' : 'ticket'} size={18} color={s.key === 'ready' ? colors.accent : colors.muted} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <TierChip tier={tk.ticketType} />
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {seatLine(tk)}
              </Txt>
              {s.key !== 'ready' ? (
                <Txt variant="tiny" color={s.tone === 'accent' ? colors.accentHi : s.tone === 'warning' ? colors.warning : colors.dim} numberOfLines={1}>
                  {s.label}
                </Txt>
              ) : null}
              {/* Fan resale tickets: covered by the scan guarantee (or its claim's status). A refunded one already says so above. */}
              {tk.guarantee && s.key !== 'refunded' && s.key !== 'cancelled' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="shield" size={12} color={tk.guarantee.claim ? colors.warning : colors.dim} />
                  <Txt variant="tiny" color={tk.guarantee.claim ? colors.warning : colors.dim} numberOfLines={1}>
                    {tk.guarantee.claim ? claimShort(tk.guarantee.claim) : 'Resale guarantee'}
                  </Txt>
                </View>
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
  // Absolute offsets measure from the padding edge, so left/right 0 already spans the full width.
  glowAnchor: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  glow: { width: '100%' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  signedOut: { gap: space.sm, alignItems: 'center', padding: space.xl, borderRadius: radius.panel, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line2 },
  segCount: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: space.lg, paddingBottom: space.md },
  art: { width: 150, height: 130, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  artGlow: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,77,61,0.10)', shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 40, shadowOffset: { width: 0, height: 0 } },
  artDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  artTile: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line2, transform: [{ rotate: '-6deg' }] },
  artTicket: { width: 54, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  artBar: { width: 16, height: 3, borderRadius: 2, backgroundColor: colors.line2 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 54,
    paddingHorizontal: space.xxl,
    marginTop: space.md,
    alignSelf: 'stretch',
    marginHorizontal: space.xl,
    borderRadius: radius.pill,
    overflow: 'hidden',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  pick: { flexDirection: 'row', gap: space.md, padding: space.sm, paddingRight: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickThumb: { width: 84, height: 96, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
  pickDate: { position: 'absolute', top: 6, left: 6, width: 34, paddingVertical: 3, borderRadius: 9, alignItems: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  pickCat: { position: 'absolute', left: 6, right: 6, bottom: 6, color: colors.text },
  bookPill: { height: 28, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface2 },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  banner: { height: 132, backgroundColor: colors.surface2 },
  bannerText: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.md, gap: 4 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 68, paddingVertical: space.sm },
  ticketIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  showQr: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  incoming: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  salesLink: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
});
