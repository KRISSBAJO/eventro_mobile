/**
 * The screen after a paid order, for both checkouts: what was bought, the order number, the push offer, and the
 * way to the tickets. A resale order (one fan's ticket, re-issued to the buyer) links straight to its ticket. A
 * donation added at checkout has its own line; a $0 order says it was free.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DONATION_NO_REFUND, donationLabel } from '@/lib/donations';
import { daysList } from '@/lib/dates';
import { localStamp, money, when } from '@/lib/format';
import { enablePush, markPushOffered, shouldOfferPush } from '@/lib/push';
import type { Order } from '@/lib/types';
import { colors, gutter, space } from '@/theme';
import { Icon } from './icons';
import { TierChip } from './tier-look';
import { Badge, Button, Card, Notice, Txt } from './ui';

/**
 * After a first purchase: the moment notifications are worth asking for (reminders before doors open). Shown once,
 * only when the phone hasn't been asked yet; the system prompt appears only if they tap the button.
 */
function PushOffer() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    void shouldOfferPush().then((v) => {
      if (!live || !v) return;
      setShow(true);
      void markPushOffered();
    });
    return () => {
      live = false;
    };
  }, []);
  if (!show) return null;
  if (result) {
    return (
      <Notice tone={result.ok ? 'success' : 'plain'} icon={result.ok ? 'check' : 'bell'}>
        {result.text}
      </Notice>
    );
  }
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong">Get a reminder before doors open?</Txt>
          <Txt variant="small" color={colors.muted}>
            We’ll also tell you when a friend sends you a ticket. Change it any time in Account.
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label="Turn on"
          size="md"
          loading={busy}
          style={{ flex: 1 }}
          onPress={async () => {
            setBusy(true);
            const r = await enablePush(true);
            setBusy(false);
            setResult(r.ok ? { ok: true, text: 'Notifications are on. We’ll remind you before the show.' } : { ok: false, text: r.reason });
          }}
        />
        <Button label="Not now" size="md" variant="ghost" style={{ flex: 1 }} onPress={() => setShow(false)} />
      </View>
    </Card>
  );
}

export function CheckoutSuccess({ order, eventSlug, testMode, signedIn, resale }: { order: Order; eventSlug: string; testMode: boolean; signedIn: boolean; resale?: boolean }) {
  const insets = useSafeAreaInsets();
  // The tickets' own date (DATES) or the event's start; DAYS tickets list their days.
  const d = when(order.date?.startsAt ?? order.event.startsAt);
  const whenText = order.validDates?.length ? `Valid ${daysList(order.validDates)}` : `${d.date} · ${d.time}${order.date?.label ? ` · ${order.date.label}` : ''}`;
  // Delivery runs right after payment, so a gift that's due now is on its way; read once so rendering stays pure.
  const [scheduled] = useState(() => !!order.gift && new Date(order.gift.sendAt).getTime() > Date.now() + 60_000);
  const ticketId = resale ? order.tickets[0]?.id : undefined;
  const donation = order.donationCents ?? 0;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: gutter, paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.xxxl, gap: space.lg }}>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <View style={styles.successIcon}>
          <Icon name="check" size={34} color="#ffffff" strokeWidth={2.6} />
        </View>
        <Txt variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          You’re in!
        </Txt>
        <Txt color={colors.muted} style={{ textAlign: 'center' }}>
          {resale ? 'Your resale ticket' : `${order.quantity} ticket${order.quantity === 1 ? '' : 's'}`} for {order.event.title}. We’ve emailed the receipt to {order.email}.
        </Txt>
        {testMode ? <Badge label="Test order · nothing was charged" tone="success" style={{ alignSelf: 'center' }} /> : null}
      </View>

      {resale ? (
        <Notice tone="success" icon="shield" title="A new ticket, just for you">
          The seller’s ticket has been cancelled. Yours is a new ticket with its own QR code.
        </Notice>
      ) : null}

      {order.gift ? (
        <Notice tone="success" icon="gift" title={scheduled ? `Gift scheduled for ${localStamp(new Date(order.gift.sendAt).getTime())}` : `Gift on its way to ${order.gift.recipientName.split(' ')[0]}`}>
          {`We’ll email ${order.gift.recipientEmail} a private link to open it. The tickets stay held until they do. Manage it from My tickets.`}
        </Notice>
      ) : null}

      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="eyebrow" color={colors.dim}>
            Order
          </Txt>
          <Txt variant="mono" color={colors.muted}>
            {order.id}
          </Txt>
        </View>
        <Txt variant="title">{order.event.title}</Txt>
        <TierChip tier={order.ticketType} label={`${order.quantity} × ${order.ticketType.name}`} />
        <Txt variant="small" color={colors.muted}>
          {whenText}
          {order.event.venue ? `\n${[order.event.venue.name, order.event.venue.city].filter(Boolean).join(', ')}` : ''}
        </Txt>
        <View style={{ gap: 6, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
          {order.tickets.map((t, i) => (
            <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt variant="small" color={colors.muted}>
                Ticket {i + 1} · {order.ticketType.name}
              </Txt>
              <Txt variant="smallStrong">{t.row && t.seat ? `${t.section ?? ''} ${t.row}${t.seat}`.trim() : 'GA'}</Txt>
            </View>
          ))}
        </View>
        {donation ? (
          <View style={{ gap: 4, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
                {donationLabel(order.donationCause)}
              </Txt>
              <Txt variant="smallStrong">{money(donation, order.currency, { decimals: donation % 100 !== 0 })}</Txt>
            </View>
            <Txt variant="tiny" color={colors.dim}>
              {`Thank you. ${DONATION_NO_REFUND}`}
            </Txt>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Txt variant="bodyStrong">{order.totalCents ? 'Total paid' : 'Total'}</Txt>
          <Txt variant="price">{order.totalCents ? money(order.totalCents, order.currency) : 'Free'}</Txt>
        </View>
      </Card>

      {signedIn ? <PushOffer /> : null}

      {signedIn ? (
        ticketId ? (
          <Button label="View my ticket" icon="ticket" onPress={() => router.replace({ pathname: '/ticket/[id]', params: { id: ticketId } })} />
        ) : (
          <Button label="View my tickets" icon="ticket" onPress={() => router.replace('/tickets')} />
        )
      ) : (
        <>
          <Notice tone="plain" icon="user" title={resale ? 'Keep your ticket in the app' : 'Keep your tickets in the app'}>
            {resale
              ? `Create an account with ${order.email} and this ticket moves into your wallet, with the QR code for the door.`
              : `Create an account with ${order.email} and these tickets move into your wallet, with the QR code for the door.`}
          </Notice>
          <Button label="Create an account" onPress={() => router.replace({ pathname: '/sign-up', params: { email: order.email, name: order.buyerName } })} />
        </>
      )}
      <Button label="Back to the event" variant="ghost" onPress={() => router.replace({ pathname: '/event/[slug]', params: { slug: eventSlug } })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  successIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
