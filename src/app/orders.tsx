/**
 * Account → Orders & receipts (GET /me/orders): every paid, refunded or cancelled order, newest first. Comps are
 * marked as complimentary, and an order with a donation says so.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { ScreenHeader } from '@/components/screen-header';
import { TierChip } from '@/components/tier-look';
import { Badge, EmptyState, ErrorState, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { donationLabel } from '@/lib/donations';
import { money, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { orderStatus, refundStatus, useMyOrders } from '@/lib/orders';
import type { MyOrder } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

export default function Orders() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useMyOrders(user?.id);
  const [pulling, setPulling] = useState(false);
  const orders = q.data?.orders ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => <OrderRow o={item} />}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.md }}
        refreshControl={
          user ? (
            <RefreshControl
              refreshing={pulling}
              onRefresh={async () => {
                setPulling(true);
                await q.refetch();
                setPulling(false);
              }}
              tintColor={colors.accent}
            />
          ) : undefined
        }
        ListHeaderComponent={
          <View style={{ gap: space.sm, paddingBottom: space.sm }}>
            <ScreenHeader title="Orders & receipts" fallback="/account" />
            {orders.length ? (
              <Txt variant="small" color={colors.muted}>
                Tap an order for the receipt, or to ask for a refund.
              </Txt>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !user ? (
            <EmptyState icon="lock" title="Sign in to see your orders" action="Sign in" onAction={() => router.push('/sign-in')} />
          ) : q.isPending ? (
            <View style={{ gap: space.md }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={92} radius={radius.card} />
              ))}
            </View>
          ) : q.error ? (
            <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
          ) : (
            <EmptyState icon="receipt" title="No orders yet" body="Tickets you buy show up here with their receipts." action="Find events" onAction={() => router.navigate('/search')} />
          )
        }
      />
    </View>
  );
}

function OrderRow({ o }: { o: MyOrder }) {
  const s = orderStatus(o.status);
  const refund = o.refundRequest ? refundStatus(o.refundRequest.status) : null;
  const d = when(o.event.startsAt);
  const comp = o.kind === 'COMP';
  const donation = o.donationCents ?? 0;
  const price = comp || !o.totalCents ? 'Free' : money(o.totalCents, o.currency);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${o.id}, ${o.event.title}, ${comp ? 'complimentary' : price}, ${s.label}${donation ? `, includes a ${money(donation, o.currency)} donation` : ''}`}
      onPress={() => {
        haptic.select();
        router.push({ pathname: '/order/[id]', params: { id: o.id } });
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
      <Image source={o.event.imageUrl ? { uri: o.event.imageUrl } : null} style={styles.thumb} contentFit="cover" />
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="title" numberOfLines={1}>
          {o.event.title}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {o.quantity} {o.quantity === 1 ? 'ticket' : 'tickets'} · {d.short}
        </Txt>
        {donation ? (
          <Txt variant="tiny" color={colors.dim} numberOfLines={1}>
            {`Includes ${money(donation, o.currency, { decimals: donation % 100 !== 0 })} · ${donationLabel(o.donationCause)}`}
          </Txt>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
          <TierChip tier={o.ticketType} />
          {comp ? <Badge label={o.compGroup ? `Complimentary · ${o.compGroup}` : 'Complimentary'} /> : <Badge label={s.label} tone={s.tone} />}
          {refund ? <Badge label={refund.short} tone={refund.tone} /> : null}
          {o.gift && !comp ? <Badge label="Gift" /> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Txt variant="title">{price}</Txt>
        <Icon name="chevronRight" size={16} color={colors.dim} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface2 },
});
