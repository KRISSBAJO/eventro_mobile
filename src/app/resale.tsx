/** "Sales & payouts" (GET /me/resale): everything this account has listed, what sold, and where each payout stands. */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, EmptyState, ErrorState, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ticketWhen } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useMyResale, useRefreshWallet } from '@/lib/queries';
import { fmt, LISTING_CHIP, payoutLabel, shortDate, sumBy, vsFace } from '@/lib/resale';
import type { MyListing } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

export default function SalesPayouts() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useMyResale(user?.id);
  const refresh = useRefreshWallet();
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ tone: 'success' | 'warning' | 'accent'; text: string } | null>(null);
  const [pulling, setPulling] = useState(false);

  const unlist = async (ticketId: string) => {
    setBusy(ticketId);
    setNote(null);
    try {
      await api(`/tickets/${encodeURIComponent(ticketId)}/listing`, { method: 'DELETE' });
      haptic.success();
      setNote({ tone: 'success', text: 'Listing removed. Your ticket is back in your wallet and works as normal.' });
      await refresh();
    } catch (e) {
      haptic.error();
      const msg = errorText(e);
      setNote(/buying this ticket right now/i.test(msg) ? { tone: 'warning', text: 'Someone is buying it right now. A buyer is checking out with this ticket. Try again in a few minutes.' } : { tone: 'accent', text: msg });
    } finally {
      setBusy('');
    }
  };

  const rows = q.data?.listings ?? [];
  const owed = rows.filter((r) => r.payoutStatus === 'PENDING' || r.payoutStatus === 'AVAILABLE' || r.payoutStatus === 'HELD');
  const paid = rows.filter((r) => r.payoutStatus === 'PAID');
  const live = rows.filter((r) => r.status === 'ACTIVE' || r.status === 'HELD');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={async () => {
            setPulling(true);
            await q.refetch();
            setPulling(false);
          }}
          tintColor={colors.accent}
        />
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Txt variant="h2" accessibilityRole="header">
          Sales & payouts
        </Txt>
      </View>

      {!user ? (
        <EmptyState icon="lock" title="Sign in to see your sales" action="Sign in" onAction={() => router.push({ pathname: '/sign-in', params: { then: '/resale' } })} />
      ) : q.isPending ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={90} radius={radius.card} />
          <Skeleton height={160} radius={radius.card} />
        </View>
      ) : q.error && !q.data ? (
        <ErrorState message={`We couldn’t load your sales. ${errorText(q.error)}`} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon="tag" title="Nothing listed yet" body="Can’t make it? Open an upcoming ticket and choose Sell. Fans buy it on the event page and you’re paid after the show." action="My tickets" onAction={() => router.navigate('/tickets')} />
      ) : (
        <>
          <View style={styles.stats}>
            <Stat label="On sale now" value={String(live.length)} />
            <Stat label="Owed to you" value={sumBy(owed, (r) => r.payoutCents ?? 0)} />
            <Stat label="Paid out" value={sumBy(paid, (r) => r.payoutCents ?? 0)} />
          </View>
          {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
          <View style={styles.list}>
            {rows.map((l, i) => (
              <ListingRow key={l.id} l={l} first={i === 0} busy={busy === l.ticketId} onUnlist={() => unlist(l.ticketId)} />
            ))}
          </View>
          <Txt variant="small" color={colors.dim}>
            A seller’s payout becomes available a day after the event starts, so every buyer is protected, and then the Eventro team sends it. Eventro keeps 5% of each sale; some organizers take a share too.
          </Txt>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Txt variant="tiny" color={colors.dim}>
        {label}
      </Txt>
      <Txt variant="price" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
    </View>
  );
}

function ListingRow({ l, first, busy, onUnlist }: { l: MyListing; first: boolean; busy: boolean; onUnlist: () => void }) {
  const [label, tone] = LISTING_CHIP[l.status] ?? ['Listed', 'accent'];
  const pay = payoutLabel(l);
  const section = l.ticket.sectionName ?? (l.ticket.section ? `Section ${l.ticket.section}` : '');
  const seat = [section, l.ticket.row ? `Row ${l.ticket.row}` : '', l.ticket.seat ? `Seat ${l.ticket.seat}` : ''].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2 }]}>
      <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/event/[slug]', params: { slug: l.event.slug } })}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {l.event.title}
        </Txt>
      </Pressable>
      <Txt variant="small" color={colors.muted}>
        {[l.ticket.ticketType.name, seat].filter(Boolean).join(' · ')} · {ticketWhen(l.ticket, l.event.startsAt, { time: false }).line}
      </Txt>
      <Txt variant="tiny" color={colors.dim}>
        Listed {shortDate(l.createdAt)}
        {l.soldAt ? ` · sold ${shortDate(l.soldAt)}` : ''}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          {l.status === 'SOLD' && l.payoutCents !== null ? (
            <>
              <Txt variant="smallStrong">
                {fmt(l.payoutCents, l.currency)} <Txt variant="small" color={colors.muted}>to you</Txt>
              </Txt>
              <Txt variant="tiny" color={colors.dim}>
                {fmt(l.priceCents, l.currency)} − {fmt(l.sellerFeeCents ?? 0, l.currency)} fee{l.royaltyCents ? ` − ${fmt(l.royaltyCents, l.currency)} organizer` : ''}
              </Txt>
            </>
          ) : (
            <>
              <Txt variant="smallStrong">{fmt(l.priceCents, l.currency)}</Txt>
              <Txt variant="tiny" color={colors.dim}>
                {vsFace(l.priceCents, l.faceCents).text}
              </Txt>
            </>
          )}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Badge label={label} tone={tone} />
          {pay ? <Badge label={pay[0]} tone={pay[1]} /> : null}
          {l.status === 'ACTIVE' ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={onUnlist} hitSlop={8} style={{ paddingHorizontal: 4 }}>
              <Txt variant="smallStrong" color={colors.accent}>
                {busy ? 'Removing…' : 'Unlist'}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </View>
      {l.status === 'CANCELLED' && l.cancelReason ? (
        <Txt variant="tiny" color={colors.dim}>
          {l.cancelReason}
        </Txt>
      ) : null}
      {l.status === 'HELD' ? (
        <Txt variant="tiny" color={colors.warning}>
          A buyer is checking out with it. If they don’t finish within 10 minutes, it goes back on sale.
        </Txt>
      ) : null}
      {l.payoutStatus === 'HELD' ? (
        <Txt variant="tiny" color={colors.muted}>
          On hold{l.payoutNote ? `: ${l.payoutNote}` : ''}. Our team will be in touch if we need anything from you.
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  list: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { gap: 2, padding: space.lg },
});
