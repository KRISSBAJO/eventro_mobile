/**
 * Checkout for a fan-resale listing held on the event screen (POST /resale/:id/hold), as on the website
 * (eventro components/checkout.tsx, CheckoutForResale). The hold (key, expiry, prices, seat, tier) comes from memory
 * (lib/resale-hold.ts), never the route; the event's details from GET /events/:slug.
 *
 * One seat from a fan: no promo codes, protection or gifting. When the event takes donations (GET /events/:slug
 * `donations`), the same optional "Add a donation to {cause}" as the normal checkout (lib/donations.ts): no Eventro fee,
 * the seller's payout is unchanged, and it's its own summary line; it's fixed once the order exists.
 * POST /resale/:id/orders { holdKey, email, name, donationCents } (the total is the price plus the donation), then
 * the same payment completion as the normal checkout (mock: POST /orders/:id/pay; Paystack's page then
 * POST /orders/:id/verify; Stripe's in-app sheet then verify). The browser build has no card sheet, so the event
 * screen sends Stripe buyers to the website instead of holding here. The hold lasts 10 minutes: when the timer ends
 * the checkout closes and the API puts the ticket back on sale.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmountPicker } from '@/components/amount-picker';
import { CheckoutSuccess } from '@/components/checkout-success';
import { FacePill, GuaranteeTermsLink, RESALE_PROMISE } from '@/components/fan-resale';
import { GradientButton, Section } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { TierBadge, TierGlyph, TierSurface } from '@/components/tier-look';
import { Button, EmptyState, ErrorState, Field, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { NATIVE, openPaystack, providerFor, sleep } from '@/lib/checkout';
import { DONATION_NO_REFUND, DONATION_ON_BEHALF, donationLabel, donationProblem } from '@/lib/donations';
import { ticketWhen } from '@/lib/dates';
import { money, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useEvent, useHealth, useRefreshWallet } from '@/lib/queries';
import { clearResaleHold, readResaleHold, seatText } from '@/lib/resale-hold';
import { payWithStripeSheet, stripeSheetAvailable } from '@/lib/stripe-sheet';
import { lookOf } from '@/lib/tiers';
import type { Order, OrderCreated } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

type Phase = 'form' | 'paying' | 'waiting' | 'done';
const HOLD_MS = 10 * 60_000;

export default function ResaleCheckout() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const refreshWallet = useRefreshWallet();
  const { user } = useAuth();
  const health = useHealth();
  // Read once: the key stays with this screen even after it's cleared from the store (when the order is created).
  const [hold] = useState(() => (listingId ? readResaleHold(listingId) : null));
  const ev = useEvent(hold?.slug);
  const e = ev.data;

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [order, setOrder] = useState<OrderCreated | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [payError, setPayError] = useState('');
  const [paid, setPaid] = useState<Order | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const verifying = useRef(false);
  /** the donation added to the order (0: none) */
  const [donation, setDonation] = useState<number | null>(0);

  // Prefill when the session arrives (e.g. signed in from the prompt below), without overwriting what was typed.
  const [prefilledFor, setPrefilledFor] = useState(user?.id ?? null);
  if (user && user.id !== prefilledFor) {
    setPrefilledFor(user.id);
    setName((n) => n || user.name);
    setEmail((m) => m || user.email);
  }

  useEffect(() => {
    if (phase === 'done') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const msLeft = hold ? new Date(hold.heldUntil).getTime() - now : null;
  // Once the order exists the payment may still finish (Paystack's page), so the timer no longer closes checkout.
  const expired = !!hold && msLeft !== null && msLeft <= 0 && phase !== 'done' && !order;

  // The hold ran out: forget it here; the API puts the ticket back on sale, so the event's list is stale.
  useEffect(() => {
    if (!expired || !hold) return;
    clearResaleHold(hold.listingId);
    void qc.invalidateQueries({ queryKey: ['event', hold.slug] });
  }, [expired, hold, qc]);

  const currency = hold?.currency || e?.currency || 'USD';
  const provider = providerFor(currency, health.data);
  const testMode = health.data?.payments === 'mock' || provider === 'mock';
  const cardOnWebsite = provider === 'stripe' && !stripeSheetAvailable;
  const errors = {
    name: name.trim().length < 2 ? 'Enter the name for the ticket.' : '',
    email: !emailOk(email) ? 'Enter a valid email; your ticket goes there.' : '',
  };
  const valid = !errors.name && !errors.email;
  const dn = e?.donations ?? null;
  const donationErr = dn && !order ? donationProblem(donation, dn, currency) : null;
  const donationCents = dn && donation && !donationErr ? donation : 0;

  const finish = (o: Order) => {
    setPaid(o);
    setPhase('done');
    haptic.success();
    void refreshWallet();
    void qc.invalidateQueries({ queryKey: ['me', 'orders'] });
    if (hold) void qc.invalidateQueries({ queryKey: ['event', hold.slug] });
  };

  /** Asks the API to confirm with the provider, a few times (webhooks and redirects can lag). */
  const confirmPaid = async (orderId: string, tries = 6): Promise<Order | null> => {
    if (verifying.current) return null;
    verifying.current = true;
    try {
      for (let i = 0; i < tries; i++) {
        const o = await api<Order>(`/orders/${encodeURIComponent(orderId)}/verify`, { method: 'POST' });
        if (o.status === 'PAID') return o;
        if (o.status === 'CANCELLED' || o.status === 'REFUNDED') throw new Error('This order was cancelled and refunded because the ticket was no longer available when your payment finished. Nothing more will be charged.');
        await sleep(1500);
      }
      return null;
    } finally {
      verifying.current = false;
    }
  };

  const check = async () => {
    // Already confirming (the browser just closed and the pay flow is checking): don't report "not seen yet" over it.
    if (verifying.current || !order) return;
    setPayError('');
    try {
      const o = await confirmPaid(order.orderId, 3);
      if (o) finish(o);
      else setPayError('We haven’t seen your payment yet. If you paid, give it a moment and check again.');
    } catch (err) {
      setPayError(errorText(err));
    }
  };

  // Back from Paystack's page (Android doesn't tell us when the browser closes): check on return.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, order]);

  const pay = async () => {
    setSubmitted(true);
    if (!valid || !hold) {
      haptic.warning();
      return;
    }
    if (cardOnWebsite) {
      setPayError('Card payments for resale tickets aren’t available in the browser version of the app. Use the Eventro app on your phone, or the website.');
      return;
    }
    if (donationErr) {
      haptic.warning();
      setPayError(donationErr);
      return;
    }
    setPhase('paying');
    setPayError('');
    try {
      // A resale ticket is one seat from a fan: no promo codes, protection or gifting, just the held listing.
      const created =
        order ??
        (await api<OrderCreated>(`/resale/${encodeURIComponent(hold.listingId)}/orders`, {
          body: {
            holdKey: hold.holdKey,
            email: email.trim().toLowerCase(),
            name: name.trim(),
            // The donation (0: none), only when the event takes them (otherwise the API refuses it).
            ...(dn ? { donationCents } : {}),
            // Paystack sends the fan back to the website; with this, the website hands them back to the app.
            ...(NATIVE && provider === 'paystack' ? { returnTo: 'app' } : {}),
          },
        }));
      setOrder(created);
      // The order holds the ticket now; retrying reuses it (a second order for the listing is refused).
      clearResaleHold(hold.listingId);

      if (created.provider === 'mock') {
        finish(await api<Order>(`/orders/${encodeURIComponent(created.orderId)}/pay`, { method: 'POST' }));
        return;
      }
      if (created.provider === 'paystack' && created.redirectUrl) {
        setPhase('waiting');
        await openPaystack(created.redirectUrl);
        const o = await confirmPaid(created.orderId);
        if (o) finish(o);
        else setPayError('We haven’t seen your payment yet. If you paid, give it a moment and check again.');
        return;
      }
      if (created.provider === 'stripe' && created.clientSecret && stripeSheetAvailable) {
        const r = await payWithStripeSheet(created.clientSecret);
        if (r === 'cancelled') {
          setPhase('form');
          setPayError('Payment cancelled. You can try again while the ticket is held.');
          return;
        }
        setPhase('waiting');
        const o = await confirmPaid(created.orderId, 8);
        if (o) finish(o);
        else setPayError('Your payment is still being confirmed. We’ll email your ticket as soon as it clears.');
        return;
      }
      throw new Error('Card payments aren’t switched on for the app yet. Please try again later.');
    } catch (err) {
      haptic.error();
      setPhase('form');
      setPayError(errorText(err));
    }
  };

  const back = () => {
    haptic.tap();
    if (router.canGoBack()) router.back();
    else if (hold) router.replace({ pathname: '/event/[slug]', params: { slug: hold.slug, resale: '1' } });
    else router.replace('/');
  };
  const backToResale = () => {
    if (hold) router.replace({ pathname: '/event/[slug]', params: { slug: hold.slug, resale: '1' } });
    else router.replace('/');
  };

  const header = (canClose = true) => (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      {canClose ? <IconButton icon="back" label="Back to the event" onPress={back} /> : <View style={{ width: 44 }} />}
      <Txt variant="title" accessibilityRole="header">
        Resale checkout
      </Txt>
      <View style={{ width: 44 }} />
    </View>
  );

  if (!hold) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <EmptyState icon="ticket" title="We couldn’t find that ticket" body="Resale holds last 10 minutes and stay on the device you picked the ticket on. Pick it again from the event." action="Browse events" onAction={() => router.replace('/search')} />
      </View>
    );
  }
  if (ev.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <View style={{ padding: gutter, gap: space.lg }}>
          <Skeleton height={56} />
          <Skeleton height={90} />
          <Skeleton height={190} />
          <Skeleton height={170} />
        </View>
      </View>
    );
  }
  if (ev.error || !e) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <ErrorState message={errorText(ev.error)} onRetry={() => ev.refetch()} />
      </View>
    );
  }

  if (phase === 'done' && paid) return <CheckoutSuccess order={paid} eventSlug={hold.slug} testMode={paid.provider === 'mock'} signedIn={!!user} resale />;

  if (expired) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <EmptyState icon="clock" title="Your hold on this ticket ran out" body="Resale holds last 10 minutes so every fan gets a fair shot. It may be back on sale." action="Back to fan resale" onAction={backToResale} />
      </View>
    );
  }

  // The ticket's own date (DATES), its days (DAYS) or the event's start
  const tw = ticketWhen(hold, e.startsAt);
  const tz = e.timezone || e.venue?.timezone || null;
  const abbr = tw.days ? '' : zoneAbbr(tz, tw.startsAt);
  const look = lookOf(hold.ticketType);
  const mm = msLeft !== null ? Math.max(0, Math.floor(msLeft / 60000)) : 10;
  const ss = msLeft !== null ? String(Math.max(0, Math.floor((msLeft % 60000) / 1000))).padStart(2, '0') : '00';
  const low = msLeft !== null && msLeft < 120000;
  const busy = phase === 'paying';
  const donated = order?.donationCents ?? donationCents;
  const total = order?.totalCents ?? hold.priceCents + donationCents;
  const seatLine = seatText(hold, 'No reserved seat');
  const seated = !!(hold.row && hold.seat);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header(phase !== 'waiting')}
      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: 150 + insets.bottom, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {/* Hold timer */}
        <View style={[styles.timer, low && { borderColor: colors.accentLine, backgroundColor: colors.accentSoft }]} accessibilityLiveRegion={low ? 'polite' : 'none'}>
          <Icon name="clock" size={18} color={low ? colors.accent : colors.muted} />
          <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
            Ticket held for{' '}
            <Txt variant="smallStrong" color={low ? colors.accent : colors.text}>
              {mm}:{ss}
            </Txt>
          </Txt>
        </View>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.max(0, Math.min(1, (msLeft ?? 0) / HOLD_MS)) * 100}%` }]} />
        </View>

        {/* The event */}
        <View style={styles.event}>
          <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={styles.eventThumb} contentFit="cover" />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title" numberOfLines={2}>
              {e.title}
            </Txt>
            <Txt variant="small" color={colors.muted}>
              {tw.line}
              {abbr ? ` ${abbr}` : ''}
            </Txt>
            <Txt variant="small" color={colors.muted} numberOfLines={1}>
              {e.online ? 'Online event' : e.venue ? [e.venue.name, e.venue.city].filter(Boolean).join(', ') : ''}
            </Txt>
          </View>
        </View>

        {/* The ticket, in its tier's look */}
        <Section icon="shield" title="Verified resale" sub="Sold by a fan who can’t make it">
          <View style={[styles.ticket, look.premium && { borderColor: `${look.colors[look.colors.length - 1]}66` }]}>
            <TierSurface look={look} edge="top" style={styles.ticketHead}>
              <View style={styles.ticketHeadRow}>
                <TierGlyph look={look} size={18} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="title" color={look.ink} numberOfLines={1}>
                    {hold.ticketType.name}
                  </Txt>
                  {hold.ticketType.badge ? <TierBadge label={hold.ticketType.badge} look={look} /> : null}
                </View>
                <Txt variant="price" color={look.ink}>
                  {money(hold.priceCents, currency)}
                </Txt>
              </View>
            </TierSurface>
            <View style={styles.ticketBody}>
              <View style={{ gap: 2 }}>
                <Txt variant="eyebrow" color={colors.dim}>
                  {seated ? 'Your seat' : 'Admission'}
                </Txt>
                <Txt variant="bodyStrong">{seatLine}</Txt>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <FacePill priceCents={hold.priceCents} faceCents={hold.faceCents} />
                <Txt variant="small" color={colors.dim}>
                  Face value {money(hold.faceCents, currency)}
                </Txt>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <Icon name="check" size={15} color={colors.success} />
            <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
              {RESALE_PROMISE}
              <GuaranteeTermsLink />
            </Txt>
          </View>
        </Section>

        {/* Contact */}
        <Section icon="user" title="Contact details" sub="Your ticket and receipt go to this email.">
          {!user ? (
            <Notice tone="plain" icon="user" title="Checking out as a guest" action="Sign in instead" onAction={() => router.push({ pathname: '/sign-in', params: { next: 'back' } })}>
              We’ll email your ticket. Create an account with the same email afterwards to see it in the app.
            </Notice>
          ) : null}
          <Field label="Name on the ticket" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoCapitalize="words" error={submitted ? errors.name : ''} editable={!order} />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={submitted ? errors.email : ''}
            editable={!order}
          />
        </Section>

        {/* Donation (optional, when the event takes them) */}
        {dn && !order ? (
          <Section icon="heart" title={`Add a donation to ${dn.cause}`} sub={`${dn.description ? `${dn.description} ` : ''}Optional. No Eventro fee is taken on it.`}>
            <AmountPicker label="Donation" chips={dn.suggestedCents} none="No donation" value={donation} onChange={setDonation} currency={currency} error={donationErr ?? undefined} />
            <Txt variant="tiny" color={colors.dim}>
              {`${DONATION_NO_REFUND} ${DONATION_ON_BEHALF}`}
            </Txt>
          </Section>
        ) : null}

        {/* Summary */}
        <Section icon="receipt" title="Order summary">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
            <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
              1 × {hold.ticketType.name} · resale
            </Txt>
            <Txt variant="smallStrong">{money(order?.ticketTotalCents ?? hold.priceCents, currency)}</Txt>
          </View>
          {donated ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
                {donationLabel(dn?.cause)}
              </Txt>
              <Txt variant="smallStrong">{money(donated, currency, { decimals: donated % 100 !== 0 })}</Txt>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Total</Txt>
              <Txt variant="small" color={colors.dim}>
                Fees included. No surprises.
              </Txt>
            </View>
            <Txt variant="priceLg">{money(total, currency)}</Txt>
          </View>
          <Txt variant="tiny" color={colors.dim}>
            Promo codes, ticket protection and gifting aren’t available on resale tickets.
          </Txt>
        </Section>

        {testMode ? (
          <Notice tone="success" icon="shield" title="Test mode">
            No card needed and nothing is charged. Your ticket is issued straight away.
          </Notice>
        ) : provider === 'paystack' ? (
          <Notice tone="plain" icon="card" title="Pay securely with Paystack">
            Card, bank transfer or USSD. You’ll finish on Paystack’s page and come straight back here.
          </Notice>
        ) : cardOnWebsite ? (
          <Notice tone="warning" icon="card" title="Pay in the app or on the website">
            Card payments for resale tickets aren’t available in the browser version of the app.
          </Notice>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        {payError ? (
          <Notice tone="accent" icon="alert" action={payError.includes('ran out') ? 'Back to fan resale' : undefined} onAction={backToResale}>
            {payError}
          </Notice>
        ) : null}
        {phase === 'waiting' ? (
          <View style={{ gap: space.sm }}>
            <Button label="I’ve paid, check now" icon="refresh" onPress={check} />
            {order?.provider === 'paystack' && order.redirectUrl ? (
              <Button
                label="Open the payment page again"
                variant="ghost"
                size="md"
                onPress={() => {
                  // Back from the auth session: check straight away (the AppState listener may not fire on iOS).
                  void openPaystack(order.redirectUrl!).then(() => check());
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <GradientButton
              label={busy ? 'Processing…' : testMode ? `Complete test order · ${money(total, currency)}` : `Pay ${money(total, currency)}`}
              icon="lock"
              loading={busy}
              disabled={cardOnWebsite}
              onPress={() => void pay()}
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter - 4, paddingBottom: space.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden', marginTop: -space.sm },
  trackFill: { height: 4, backgroundColor: colors.accent },
  event: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  eventThumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface2 },
  ticket: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, overflow: 'hidden' },
  ticketHead: { borderWidth: 0 },
  ticketHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, paddingHorizontal: space.lg },
  ticketBody: { gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.sm, paddingTop: space.md, paddingHorizontal: gutter, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line2 },
});
