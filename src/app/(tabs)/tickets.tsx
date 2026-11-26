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
import { dateLine, rangeLine, ticketWhen } from '@/lib/dates';
import { cityOnly, countryName, firstName, localStamp, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { rankNear, usePlace } from '@/lib/place';
import { useAllEvents, useMyTickets, useRefreshWallet } from '@/lib/queries';
import { inTime } from '@/lib/resale';
import { useSaved } from '@/lib/saved';
import { claimShort, COVERED_LABEL, FREE_NOTE, isComp } from '@/lib/guarantee';
import { groupTickets, seatLine, ticketState, type TicketGroup } from '@/lib/tickets';
import type { IncomingTransfer } from '@/lib/types';
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
      <Txt variant="h1" accessibilityRole="header">
        Tickets
      </Txt>

      {!ready ? null : !user ? (
        <>
          <View style={styles.empty}>
            <TicketArt />
            <Txt variant="h2" style={{ textAlign: 'center' }}>
              Your tickets live here
            </Txt>
            <Txt color={colors.muted} style={{ textAlign: 'center', maxWidth: 300 }}>
              Sign in to see your tickets and show the QR code at the door.
            </Txt>
            <View style={{ gap: space.sm, marginTop: space.md, alignSelf: 'stretch' }}>
              <InkButton label="Sign in" onPress={() => router.push({ pathname: '/sign-in', params: { then: 'tickets' } })} />
              <Button label="Create an account" variant="ghost" onPress={() => router.push({ pathname: '/sign-up', params: { then: 'tickets' } })} />
            </View>
            <FindOrderLink />
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
                  findOrder
                  title={groups.past.length ? 'Nothing coming up' : 'No tickets yet'}
                  body={
                    groups.past.length
                      ? 'Find something new to look forward to.'
                      : 'Tickets you buy show up here, ready for the door.'
                  }
                />
              ) : null}

              {groups.upcoming.map((g, i) => (
                <FadeIn key={g.key} delay={i * 60}>
                  <GroupCard g={g} />
                </FadeIn>
              ))}

              {groups.upcoming.length || groups.past.length ? (
                <Pressable accessibilityRole="link" onPress={() => router.push('/resale')} style={({ pressed }) => [styles.salesLink, pressed && { backgroundColor: colors.surface2 }]}>
                  <Icon name="cash" size={20} color={colors.text} />
                  <Txt variant="body" style={{ flex: 1 }}>
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
                {groups.past.map((g, i) => (
                  <FadeIn key={g.key} delay={i * 60}>
                    <GroupCard g={g} />
                  </FadeIn>
                ))}
              </>
            ) : (
              <>
                <TicketsEmpty icon="calendar" title="No past events yet" body="Events you’ve been to show up here." />
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
            <View style={{ marginHorizontal: -space.sm }}>
              {saved.items.map((e, i) => (
                <FadeIn key={e.slug} delay={i * 40}>
                  <CompactEventCard e={e} />
                </FadeIn>
              ))}
            </View>
          ) : (
            <>
              <TicketsEmpty icon="heart" title="Nothing saved yet" body="Tap the heart on any event to keep it here." action="Find events" to="/search" />
              <Picks />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

type Tab = 'upcoming' | 'past' | 'saved';

/** Upcoming / Past / Saved as underlined tabs. */
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
            <Txt variant="bodyStrong" color={on ? colors.text : colors.dim}>
              {it.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Can't find my order?": bought as a guest, or lost the email. */
function FindOrderLink() {
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push('/find-order')} hitSlop={8} style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center', marginTop: space.xs }, pressed && { opacity: 0.6 }]}>
      <Txt variant="smallStrong" style={{ textDecorationLine: 'underline' }}>
        Can’t find my order?
      </Txt>
    </Pressable>
  );
}

/** The main action in an empty state: a solid button in the text colour (black in Light, white in Dark). */
function InkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.ink, pressed && { opacity: 0.85 }]}>
      <Txt variant="button" color={colors.bg}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** The illustration for empty states: one quiet tile with an icon. */
function TicketArt({ icon = 'ticket' }: { icon?: IconName }) {
  return (
    <View style={styles.artTile} accessible={false}>
      <Icon name={icon} size={30} color={colors.text} />
    </View>
  );
}

function TicketsEmpty({ title, body, icon, action = 'Explore events', to = '/', findOrder }: { title: string; body: string; icon?: IconName; action?: string; to?: '/' | '/search'; findOrder?: boolean }) {
  return (
    <View style={styles.empty}>
      <TicketArt icon={icon} />
      <Txt variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt color={colors.muted} style={{ textAlign: 'center', maxWidth: 320 }}>
        {body}
      </Txt>
      <View style={{ alignSelf: 'stretch', marginTop: space.md }}>
        <InkButton label={action} onPress={() => router.navigate(to)} />
      </View>
      {findOrder ? <FindOrderLink /> : null}
    </View>
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
    <View style={{ gap: space.md, marginTop: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="h2">{city ? `Happening in ${city}` : local.length && place ? `Happening in ${countryName(place.country)}` : 'On sale now'}</Txt>
        <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.navigate('/search')}>
          <Txt variant="smallStrong">See all</Txt>
        </Pressable>
      </View>
      <View style={{ marginHorizontal: -space.sm }}>
        {picks.map((e) => (
          <CompactEventCard key={e.slug} e={e} />
        ))}
      </View>
    </View>
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
          // A comp: a complimentary ticket from the organizer, claimed the same way as a gift.
          const comp = !!x.gift.comp;
          return (
            <View key={x.gift.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong" numberOfLines={2}>
                  {comp ? `You’re on the guest list: ${x.event.title}` : `🎁 A gift from ${x.gift.from}: ${x.event.title}`}
                </Txt>
                <Txt variant="small" color={colors.muted}>
                  {comp ? `Complimentary ticket from ${x.gift.from}${x.gift.group ? ` · ${x.gift.group}` : ''}` : `${n} × ${x.ticketType.name}`} · {ticketWhen(x, x.event.startsAt, { time: false }).line}
                </Txt>
                {x.gift.message ? (
                  <Txt variant="small" color={colors.text} numberOfLines={3}>
                    “{x.gift.message}”
                  </Txt>
                ) : null}
              </View>
              <Button label={busy === x.id ? 'Accepting…' : comp ? 'Accept ticket' : 'Accept gift'} size="sm" loading={busy === x.id} onPress={() => accept(x.id)} />
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
                {x.ticketType.name} · {ticketWhen(x, x.event.startsAt, { time: false }).line} · from {x.holderName}
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
  const d = when(g.start);
  // DATES: the performance; DAYS: the event's days; else the event's start.
  const days = g.event.dateMode === 'DAYS' ? (g.event.dates ?? []).filter((x) => x.status !== 'CANCELLED') : [];
  const whenText = g.date ? dateLine(g.date) : days.length ? `${rangeLine(days)}${days.length > 1 ? ` · ${days.length} days` : ''}` : `${d.short} · ${d.time}`;
  const dateCancelled = g.date?.status === 'CANCELLED' && g.event.status !== 'CANCELLED';
  const dim = g.past || g.cancelled;
  return (
    <View style={[styles.group, dim && { opacity: 0.85 }]}>
      <Pressable accessibilityRole="link" accessibilityLabel={`${g.event.title}, ${whenText}`} onPress={() => router.push({ pathname: '/event/[slug]', params: { slug: g.slug } })}>
        <View style={styles.banner}>
          <Image source={g.event.imageUrl ? { uri: g.event.imageUrl } : null} style={[StyleSheet.absoluteFill, dim && { opacity: 0.45 }]} contentFit="cover" transition={200} />
          <LinearGradient colors={[colors.fade0, colors.fade]} locations={[0.2, 1]} style={StyleSheet.absoluteFill} />
          <View style={styles.bannerText}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {g.cancelled ? <Badge label={`${dateCancelled ? 'Date' : 'Event'} cancelled · ${g.refunded ? 'refunded' : 'refund pending'}`} tone="accent" /> : null}
            </View>
            <Txt variant="h3" color={colors.onImage} numberOfLines={1}>
              {g.event.title}
            </Txt>
            <Txt variant="small" color={colors.onImageSoft} numberOfLines={1}>
              {whenText}
              {g.event.venue ? ` · ${g.event.venue.name}` : g.event.online ? ' · Online' : ''}
            </Txt>
          </View>
        </View>
      </Pressable>
      {g.tickets.map((tk, i) => {
        const s = ticketState(tk);
        const comp = isComp(tk);
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
            <View style={styles.ticketIcon}>
              <Icon name={s.key === 'ready' ? 'ticket' : s.key === 'gift' ? 'gift' : s.key === 'cancelled' ? 'alert' : s.key === 'refunded' ? 'cash' : 'ticket'} size={20} color={s.key === 'ready' ? colors.text : colors.dim} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <TierChip tier={tk.ticketType} />
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {/* a multi-day pass leads with its days */}
                {tk.validDates?.length ? [ticketWhen(tk, g.event.startsAt).line, seatLine(tk) === 'General admission' ? '' : seatLine(tk)].filter(Boolean).join(' · ') : seatLine(tk)}
              </Txt>
              {s.key !== 'ready' ? (
                <Txt variant="tiny" color={s.tone === 'accent' ? colors.accentHi : s.tone === 'warning' ? colors.warning : colors.dim} numberOfLines={1}>
                  {s.label}
                </Txt>
              ) : null}
              {/* sessions booked with this ticket (the event's schedule) */}
              {tk.sessions?.length && s.key !== 'refunded' && s.key !== 'cancelled' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="calendar" size={12} color={colors.dim} />
                  <Txt variant="tiny" color={colors.dim} numberOfLines={1}>
                    {`${tk.sessions.length} ${tk.sessions.length === 1 ? 'session' : 'sessions'} booked`}
                  </Txt>
                </View>
              ) : null}
              {/* The Omoshow Guarantee: covered paid tickets (or the claim's status), or a note on free ones. A refunded or cancelled one already says so above. */}
              {tk.guarantee && s.key !== 'refunded' && s.key !== 'cancelled' && (tk.guarantee.covered || tk.guarantee.claim) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="shield" size={12} color={tk.guarantee.claim ? colors.warning : colors.dim} />
                  <Txt variant="tiny" color={tk.guarantee.claim ? colors.warning : colors.dim} numberOfLines={1}>
                    {tk.guarantee.claim ? claimShort(tk.guarantee.claim) : COVERED_LABEL}
                  </Txt>
                </View>
              ) : comp ? (
                <Txt variant="tiny" color={colors.dim} numberOfLines={1}>
                  {tk.order.compGroup ? `Complimentary ticket · ${tk.order.compGroup}` : 'Complimentary ticket'}
                </Txt>
              ) : tk.guarantee && s.key !== 'refunded' && s.key !== 'cancelled' && tk.guarantee.notCovered === 'FREE' ? (
                <Txt variant="tiny" color={colors.dim} numberOfLines={2}>
                  {FREE_NOTE}
                </Txt>
              ) : null}
            </View>
            {s.key === 'ready' ? (
              <View style={styles.showQr}>
                <Txt variant="smallStrong" color={colors.bg}>
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
  segments: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line2, marginHorizontal: -gutter, paddingHorizontal: gutter },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 46, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -StyleSheet.hairlineWidth },
  segmentOn: { borderBottomColor: colors.text },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xxxl, paddingBottom: space.md },
  artTile: { width: 88, height: 88, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, marginBottom: space.md },
  ink: { height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  banner: { height: 132, backgroundColor: colors.surface2 },
  bannerText: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.md, gap: 4 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 68, paddingVertical: space.sm },
  ticketIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  showQr: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  incoming: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface2 },
  salesLink: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line2 },
});
