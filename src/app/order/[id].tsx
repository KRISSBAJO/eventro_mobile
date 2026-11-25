/**
 * One order: the receipt (tickets and seats, price lines, a donation's own line, total, currency, payment status) and
 * refund requests (POST /orders/:id/refund-requests { reason }, 10–1000 characters, paid orders only, one open at a
 * time). A comp (kind COMP) is a complimentary ticket from the organizer: nothing was paid, so there's no refund.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { TierChip } from '@/components/tier-look';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DONATION_NO_REFUND, donationLabel } from '@/lib/donations';
import { daysList } from '@/lib/dates';
import { localStamp, money, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { orderStatus, providerLabel, REFUND_REASON_MAX, REFUND_REASON_MIN, refundStatus, useOrder } from '@/lib/orders';
import type { Order } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useOrder(id, user?.email);
  const o = q.data;

  const body = !user ? (
    <EmptyState icon="lock" title="Sign in to see this order" action="Sign in" onAction={() => router.push('/sign-in')} />
  ) : q.isPending ? (
    <View style={{ gap: space.md }}>
      <Skeleton height={120} radius={radius.card} />
      <Skeleton height={220} radius={radius.card} />
    </View>
  ) : q.error || !o ? (
    q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState icon="receipt" title="Order not found" body="It may belong to another account." />
    ) : (
      <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
    )
  ) : (
    <Receipt o={o} />
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }}
        keyboardShouldPersistTaps="handled">
        <ScreenHeader title={o ? o.event.title : 'Order'} eyebrow={id ? `Order ${id}` : undefined} fallback="/orders" />
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Receipt({ o }: { o: Order }) {
  const s = orderStatus(o.status);
  // The tickets' date (DATES) or the event's; DAYS tickets list their days
  const d = when(o.date?.startsAt ?? o.event.startsAt);
  const whenText = o.validDates?.length ? `Valid ${daysList(o.validDates)}` : `${d.date} · ${d.time}${o.date?.label ? ` · ${o.date.label}` : ''}`;
  const refunded = o.refundedCents ?? 0;
  const requests = o.refundRequests ?? [];
  const latest = requests[0] ?? null;
  const open = latest?.status === 'OPEN';
  const comp = o.kind === 'COMP';
  const canAsk = o.status === 'PAID' && !open && !comp;
  const donation = o.donationCents ?? 0;
  const donationBack = o.donationRefundedCents ?? 0;

  return (
    <>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <Txt variant="eyebrow" color={colors.dim}>
            {comp ? 'Complimentary ticket' : 'Receipt'}
          </Txt>
          <Badge label={comp ? (o.compGroup ? `Comp · ${o.compGroup}` : 'Comp') : s.label} tone={comp ? 'plain' : s.tone} />
        </View>
        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/event/[slug]', params: { slug: o.event.slug } })} hitSlop={6}>
          <Txt variant="title">{o.event.title}</Txt>
          <Txt variant="small" color={colors.muted}>
            {whenText}
            {o.event.venue ? ` · ${[o.event.venue.name, o.event.venue.city].filter(Boolean).join(', ')}` : ''}
          </Txt>
        </Pressable>
        <TierChip tier={o.ticketType} label={`${o.quantity} × ${o.ticketType.name}`} size="md" />

        <View style={styles.block}>
          {o.tickets.map((t, i) => (
            <View key={t.id} style={styles.line}>
              <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
                Ticket {i + 1} · {o.ticketType.name}
                {t.status === 'VOID' ? ' · void' : ''}
              </Txt>
              <Txt variant="smallStrong">{t.row && t.seat ? `${t.section ?? ''} Row ${t.row} · Seat ${t.seat}`.trim() : 'General admission'}</Txt>
            </View>
          ))}
        </View>

        <View style={styles.block}>
          {comp ? (
            <Line label={`${o.quantity} × ${o.ticketType.name}, complimentary`} value="Free" />
          ) : (
            <>
              <Line label={`${o.quantity} × ${o.ticketType.name} at ${money(o.unitCents, o.currency)}`} value={money(o.subtotalCents, o.currency)} />
              <Line label="Service and facility fees" value="Included" />
            </>
          )}
          {o.protectionCents ? <Line label="Ticket protection" value={money(o.protectionCents, o.currency)} /> : null}
          {o.discountCents ? <Line label={`Promo ${o.promoCode ?? ''}`.trim()} value={`−${money(o.discountCents, o.currency)}`} tone={colors.success} /> : null}
          {donation ? <Line label={donationLabel(o.donationCause)} value={money(donation, o.currency, { decimals: donation % 100 !== 0 })} /> : null}
        </View>
        <View style={[styles.line, { alignItems: 'flex-end' }]}>
          <View>
            <Txt variant="bodyStrong">Total</Txt>
            <Txt variant="small" color={colors.dim}>
              {o.currency} · fees included{donation ? ', donation included' : ''}
            </Txt>
          </View>
          <Txt variant="priceLg">{o.totalCents ? money(o.totalCents, o.currency) : 'Free'}</Txt>
        </View>
        {refunded ? <Line label="Refunded" value={`−${money(refunded, o.currency)}`} tone={colors.success} /> : null}
        {donationBack ? <Line label="Donation refunded" value={`−${money(donationBack, o.currency, { decimals: donationBack % 100 !== 0 })}`} tone={colors.success} /> : null}
        {donation ? (
          <Txt variant="tiny" color={colors.dim}>
            {`${DONATION_NO_REFUND} If the event is cancelled, the donation is refunded with the order.`}
          </Txt>
        ) : null}

        <View style={styles.block}>
          <Line label="Payment" value={providerLabel(o.provider)} />
          <Line label="Status" value={o.paymentStatus ? `${s.label} (${o.paymentStatus})` : s.label} />
          {o.paidAt ? <Line label="Paid" value={localStamp(new Date(o.paidAt).getTime())} /> : null}
          <Line label="Receipt sent to" value={o.email} />
        </View>
      </Card>

      {comp ? (
        <Notice tone="plain" icon="gift" title={o.compGroup ? `Complimentary ticket · ${o.compGroup}` : 'Complimentary ticket'}>
          The organizer gave you this ticket, so nothing was paid and there’s nothing to refund. It isn’t covered by the Omoshow Guarantee.
        </Notice>
      ) : null}

      {o.gift && !comp ? (
        <Notice tone="plain" icon="gift" title={`A gift for ${o.gift.recipientName}`}>
          {o.gift.claimedAt ? 'They’ve opened it: the tickets are in their account.' : o.gift.sentAt ? `Sent to ${o.gift.recipientEmail}. Waiting for them to open it.` : `Goes to ${o.gift.recipientEmail} on ${localStamp(new Date(o.gift.sendAt).getTime())}.`}
        </Notice>
      ) : null}

      {latest ? <RefundState r={latest} currency={o.currency} /> : null}
      {canAsk ? <RefundForm orderId={o.id} again={!!latest} /> : null}
      {o.status !== 'PAID' && !latest && !comp ? (
        <Txt variant="small" color={colors.dim}>
          {o.status === 'PENDING' ? 'Refunds can be asked for once the order is paid.' : 'This order has already been refunded or cancelled.'}
        </Txt>
      ) : null}
    </>
  );
}

function RefundState({ r, currency }: { r: NonNullable<Order['refundRequests']>[number]; currency: string }) {
  const s = refundStatus(r.status);
  return (
    <Notice tone={s.tone === 'success' ? 'success' : s.tone === 'warning' ? 'warning' : 'plain'} icon={r.status === 'OPEN' ? 'clock' : r.status === 'DENIED' ? 'alert' : 'check'} title={s.title}>
      <Txt variant="small" color={colors.muted}>
        {s.body}
        {r.amountCents && r.status !== 'OPEN' ? ` Amount: ${money(r.amountCents, currency)}.` : ''}
      </Txt>
      <Txt variant="tiny" color={colors.dim} style={{ marginTop: 4 }}>
        Asked {localStamp(new Date(r.createdAt).getTime())}
        {r.decidedAt ? ` · decided ${localStamp(new Date(r.decidedAt).getTime())}` : ''}
      </Txt>
      {r.reason ? (
        <Txt variant="small" color={colors.muted} style={{ marginTop: 4, fontStyle: 'italic' }}>
          “{r.reason}”
        </Txt>
      ) : null}
    </Notice>
  );
}

function RefundForm({ orderId, again }: { orderId: string; again: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const len = reason.trim().length;
  const invalid = len < REFUND_REASON_MIN ? `Tell us a little more (at least ${REFUND_REASON_MIN} characters).` : len > REFUND_REASON_MAX ? `Keep it under ${REFUND_REASON_MAX} characters.` : '';

  if (!open) {
    return <Button label={again ? 'Ask for a refund again' : 'Request a refund'} variant="ghost" icon="undo" onPress={() => setOpen(true)} />;
  }

  const send = async () => {
    setTried(true);
    if (invalid) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/orders/${encodeURIComponent(orderId)}/refund-requests`, { body: { reason: reason.trim() } });
      haptic.success();
      setOpen(false);
      setReason('');
      await Promise.all([qc.invalidateQueries({ queryKey: ['me', 'order', orderId] }), qc.invalidateQueries({ queryKey: ['me', 'orders'] })]);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="h3" accessibilityRole="header">
        Request a refund
      </Txt>
      <Txt variant="small" color={colors.muted}>
        Our team reviews every request against the organizer’s policy. Cancelled events are refunded automatically; you don’t need to ask.
      </Txt>
      <Field
        label="Why do you need a refund?"
        value={reason}
        onChangeText={(t) => setReason(t.slice(0, REFUND_REASON_MAX + 50))}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        placeholder="For example: I’m ill and can’t travel to the show."
        error={tried ? invalid : ''}
        hint={`${len}/${REFUND_REASON_MAX}`}
      />
      {error ? <Notice icon="alert">{error}</Notice> : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Send request" loading={busy} onPress={send} style={{ flex: 1 }} />
        <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.line}>
      <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="smallStrong" color={tone ?? colors.text} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
});
