/**
 * Checkout for a cart: several ticket types of one event, held together on the event screen (POST /holds/cart) and
 * paid for once. `?holds=a,b,c` are the holds, in the order they were picked. The total comes from POST /quote/cart
 * (a promo code counts once for the whole cart); POST /orders/cart makes one order per ticket type under one cart
 * code and one payment, which the pay and verify endpoints take like an order id.
 *
 * Free and test-mode carts finish here; Paystack and the Stripe sheet work as in the one-type checkout; Stripe
 * without the in-app sheet hands the cart to the website's checkout. A cart can carry a donation (on its first
 * order) and be sent as a gift (one email, one claim for every ticket type). On a seat map each line gets the best
 * seats together in its sections. Pay-what-you-want amounts are fixed when the cart is held.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { CheckoutQuestions, answerList, questionProblem, type Answers } from '@/components/checkout-questions';
import { AmountPicker } from '@/components/amount-picker';
import { CheckoutSuccess } from '@/components/checkout-success';
import { GiftOption, giftBody, giftErrors, NO_GIFT, type GiftDraft } from '@/components/gift-option';
import { Icon } from '@/components/icons';
import { Button, Card, EmptyState, ErrorState, Field, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText, WEB_URL } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { NATIVE, openPaystack, providerFor, sleep } from '@/lib/checkout';
import { ownTimes, ticketWhen } from '@/lib/dates';
import { DONATION_NO_REFUND, DONATION_ON_BEHALF, donationLabel, donationProblem } from '@/lib/donations';
import { instantOf, money } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useHealth } from '@/lib/queries';
import { payWithStripeSheet, stripeSheetAvailable } from '@/lib/stripe-sheet';
import type { Hold, Order, OrderCreated } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

type CartQuote = { quantity: number; subtotalCents: number; discountCents: number; protectionCents: number; totalCents: number; promo: { code: string; percent: number } | null; lines: { totalCents: number }[] };
type Phase = 'form' | 'paying' | 'waiting' | 'done';

export default function CartCheckout() {
  const { holds: raw } = useLocalSearchParams<{ holds: string }>();
  const ids = (raw ?? '').split(',').filter(Boolean).slice(0, 6);
  const key = ids.join(',');
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const health = useHealth();
  const cart = useQuery({
    queryKey: ['cart-holds', key],
    queryFn: () => Promise.all(ids.map((id) => api<Hold>(`/holds/${encodeURIComponent(id)}`))),
    enabled: ids.length > 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);
  const [protection, setProtection] = useState(false);
  const [gift, setGift] = useState<GiftDraft>(NO_GIFT);
  const [donation, setDonation] = useState<number | null>(0);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<string | null>(null);
  const [promoError, setPromoError] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [order, setOrder] = useState<OrderCreated | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [payError, setPayError] = useState('');
  const [paid, setPaid] = useState<Order | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const verifying = useRef(false);

  // Prefill when the session arrives, without overwriting what was typed.
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

  const holds = cart.data ?? null;
  const first = holds?.[0];
  const currency = first?.event.currency ?? 'USD';
  const provider: OrderCreated['provider'] = providerFor(currency, health.data);
  const testMode = health.data?.payments === 'mock' || provider === 'mock';
  const sum = holds ? holds.reduce((n, h) => n + (h.unitCents ?? h.ticketType.priceCents) * h.quantity, 0) : 0;
  const protect = protection && sum > 0;
  // A donation to the event's cause (no fee on it); it rides on the cart's first order.
  const dn = first?.event.donations ?? null;
  const donationErr = dn ? donationProblem(donation, dn, currency) : null;
  const donationCents = dn && donation && !donationErr ? donation : 0;

  const quote = useQuery({
    queryKey: ['cart-quote', key, protect, promo, donationCents],
    queryFn: () => api<CartQuote>('/quote/cart', { body: { holdIds: ids, protection: protect, ...(promo ? { promoCode: promo } : {}), ...(dn ? { donationCents } : {}) } }),
    enabled: !!holds && !order && !donationErr,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status === 400),
  });
  const totals = quote.data;
  const total = order?.totalCents ?? totals?.totalCents ?? sum + donationCents;
  const free = !!holds && (order ? order.totalCents === 0 : totals && !quote.isPlaceholderData ? totals.totalCents === 0 : sum === 0 && donationCents === 0);
  /** Stripe without the in-app sheet: the website takes the card (and asks its own questions). */
  const handsOff = provider === 'stripe' && !stripeSheetAvailable && !free;

  const until = holds ? Math.min(...holds.map((h) => new Date(h.expiresAt).getTime())) : null;
  const msLeft = until !== null ? until - now : null;
  const expired = !!holds && (holds.some((h) => h.status === 'EXPIRED' || h.status === 'RELEASED') || (msLeft !== null && msLeft <= 0)) && phase !== 'done' && !order;

  const errors = {
    name: name.trim().length < 2 ? 'Enter the name for the tickets.' : '',
    email: !emailOk(email) ? (gift.on ? 'Enter a valid email; your receipt goes there.' : 'Enter a valid email; your tickets go there.') : '',
  };
  // A gift has to arrive before the event starts (the venue's wall-clock time, in its zone).
  const ownStart = first ? ownTimes(first, first.event).startsAt : '';
  const eventStart = first ? (first.event.timezone ? instantOf(ownStart, first.event.timezone) : new Date(ownStart)).getTime() : 0;
  const giftErr = giftErrors(gift, email, eventStart, now);
  const quantity = holds ? holds.reduce((n, h) => n + h.quantity, 0) : 0;
  // Each ticket in the cart's order, by name, for questions asked per ticket.
  const ticketNames = holds ? holds.flatMap((h) => Array.from({ length: h.quantity }, () => h.ticketType.name)) : [];
  const questions = first?.questions ?? [];

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z0-9]{3,15}$/.test(code)) {
      setPromoError('That code isn’t valid for this event.');
      return;
    }
    setPromoBusy(true);
    try {
      const q = await api<CartQuote>('/quote/cart', { body: { holdIds: ids, promoCode: code, protection: protect, ...(dn ? { donationCents } : {}) } });
      if (q.promo) {
        setPromo(q.promo.code);
        setPromoError('');
        haptic.success();
      }
    } catch (e) {
      setPromoError(errorText(e));
      haptic.error();
    } finally {
      setPromoBusy(false);
    }
  };

  const finish = (o: Order) => {
    setPaid(o);
    setPhase('done');
    haptic.success();
    qc.invalidateQueries({ queryKey: ['me', 'tickets'] });
    qc.invalidateQueries({ queryKey: ['event', first?.event.slug] });
  };

  /** Asks the API to confirm with the provider, a few times (webhooks and redirects can lag). */
  const confirmPaid = async (orderId: string, tries = 6): Promise<Order | null> => {
    if (verifying.current) return null;
    verifying.current = true;
    try {
      for (let i = 0; i < tries; i++) {
        const o = await api<Order>(`/orders/${encodeURIComponent(orderId)}/verify`, { method: 'POST' });
        if (o.status === 'PAID') return o;
        if (o.status === 'CANCELLED' || o.status === 'REFUNDED') throw new Error('This order was cancelled and refunded because the seats sold out while you paid. Nothing more will be charged.');
        await sleep(1500);
      }
      return null;
    } finally {
      verifying.current = false;
    }
  };

  /** Back from the website's checkout: the first hold says whether an order was made there, and that order whether it's paid. */
  const checkHandOff = async () => {
    try {
      const h = await api<Hold>(`/holds/${encodeURIComponent(ids[0])}`);
      if (!h.order) return setPayError('We haven’t seen your payment yet. Your seats are still held.');
      const o = await confirmPaid(h.order.id);
      if (o) finish(o);
      else setPayError('Your payment is still being confirmed. We’ll email your tickets as soon as it clears.');
    } catch (e) {
      setPayError(errorText(e));
    }
  };

  const pay = async () => {
    if (!holds) return;
    setPayError('');
    try {
      if (handsOff && !order) {
        setPhase('waiting');
        await WebBrowser.openBrowserAsync(`${WEB_URL}/checkout?holds=${encodeURIComponent(key)}`, { toolbarColor: colors.bg, controlsColor: colors.accent, dismissButtonStyle: 'close' });
        await checkHandOff();
        return;
      }
      setSubmitted(true);
      if (errors.name || errors.email || giftErr.name || giftErr.email || giftErr.at) {
        haptic.warning();
        return;
      }
      if (!order && donationErr) {
        haptic.warning();
        setPayError(donationErr);
        return;
      }
      const unanswered = order ? '' : questionProblem(questions, answers, quantity);
      if (unanswered) {
        haptic.warning();
        setPayError(unanswered);
        return;
      }
      setPhase('paying');
      const created =
        order ??
        (await api<OrderCreated>('/orders/cart', {
          body: {
            holdIds: ids,
            email: email.trim().toLowerCase(),
            name: name.trim(),
            protection: protect,
            ...(promo ? { promoCode: promo } : {}),
            ...(questions.length ? { answers: answerList(answers) } : {}),
            ...(dn ? { donationCents } : {}),
            ...giftBody(gift),
            ...(NATIVE && provider === 'paystack' ? { returnTo: 'app' } : {}),
          },
        }));
      setOrder(created);
      if (created.provider === 'free' || created.provider === 'mock') {
        finish(await api<Order>(`/orders/${encodeURIComponent(created.orderId)}/pay`, { method: 'POST' }));
        return;
      }
      if (created.provider === 'paystack' && created.redirectUrl) {
        setPhase('waiting');
        await openPaystack(created.redirectUrl);
        const o = await confirmPaid(created.orderId);
        if (o) finish(o);
        else setPayError('We haven’t seen your payment yet. If you paid, give it a moment and check again. Your seats are still held.');
        return;
      }
      if (created.provider === 'stripe' && created.clientSecret && stripeSheetAvailable) {
        const r = await payWithStripeSheet(created.clientSecret);
        if (r === 'cancelled') {
          setPhase('form');
          setPayError('Payment cancelled. Your seats are still held, so you can try again.');
          return;
        }
        setPhase('waiting');
        const o = await confirmPaid(created.orderId, 8);
        if (o) finish(o);
        else setPayError('Your payment is still being confirmed. We’ll email your tickets as soon as it clears.');
        return;
      }
      throw new Error('Card payments aren’t switched on for the app yet. Your seats are still held; please try again later.');
    } catch (e) {
      haptic.error();
      setPhase('form');
      setPayError(`${errorText(e)}${e instanceof ApiError && e.status === 409 ? '' : ' Your seats are still held.'}`);
    }
  };

  const check = async () => {
    setPayError('');
    if (order) {
      try {
        const o = await confirmPaid(order.orderId);
        if (o) finish(o);
        else setPayError('We haven’t seen your payment yet. If you paid, give it a moment and check again.');
      } catch (e) {
        setPayError(errorText(e));
      }
    } else await checkHandOff();
  };

  const release = async () => {
    if (!order) await Promise.all(ids.map((id) => api(`/holds/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)));
    qc.invalidateQueries({ queryKey: ['event', first?.event.slug] });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const header = (canClose = true) => (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      {canClose ? <IconButton icon="back" label="Back to the event and release seats" onPress={() => void release()} /> : <View style={{ width: 44 }} />}
      <Txt variant="title" accessibilityRole="header">
        Checkout
      </Txt>
      <View style={{ width: 44 }} />
    </View>
  );

  if (phase === 'done' && paid && first) return <CheckoutSuccess order={paid} eventSlug={first.event.slug} testMode={testMode} signedIn={!!user} lines={holds!.map((h) => ({ name: h.ticketType.name, quantity: h.quantity }))} />;
  if (cart.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <View style={{ padding: gutter, gap: space.lg }}>
          <Skeleton height={64} radius={radius.md} />
          <Skeleton height={220} radius={radius.card} />
        </View>
      </View>
    );
  }
  if (cart.error || !holds || !first) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <ErrorState message={cart.error ? errorText(cart.error) : 'These seats are no longer held.'} onRetry={() => void cart.refetch()} />
      </View>
    );
  }
  if (expired) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header()}
        <EmptyState icon="clock" title="Your seats were released" body="Holds last 10 minutes, so other fans get a chance. Pick them again to continue." action="Pick seats again" onAction={() => router.back()} />
      </View>
    );
  }

  const mm = msLeft !== null ? Math.max(0, Math.floor(msLeft / 60000)) : 10;
  const ss = msLeft !== null ? String(Math.max(0, Math.floor((msLeft % 60000) / 1000))).padStart(2, '0') : '00';
  const low = msLeft !== null && msLeft < 120000;
  const busy = phase === 'paying';
  const tw = ticketWhen(first, first.event.startsAt);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header(phase !== 'waiting')}
      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: 150 + insets.bottom, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={[styles.timer, low && { borderColor: colors.accentLine, backgroundColor: colors.accentSoft }]} accessibilityLiveRegion={low ? 'polite' : 'none'}>
          <Icon name="clock" size={18} color={low ? colors.accent : colors.muted} />
          <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
            {quantity} tickets held for{' '}
            <Txt variant="smallStrong" color={low ? colors.accent : colors.text}>
              {mm}:{ss}
            </Txt>
          </Txt>
        </View>

        <Card style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Image source={first.event.imageUrl ? { uri: first.event.imageUrl } : null} style={styles.thumb} contentFit="cover" />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title" numberOfLines={2}>
              {first.event.title}
            </Txt>
            <Txt variant="small" color={colors.muted}>
              {tw.line}
            </Txt>
            {first.event.venue ? (
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {[first.event.venue.name, first.event.venue.city].filter(Boolean).join(', ')}
              </Txt>
            ) : null}
          </View>
        </Card>

        {handsOff ? (
          <Notice tone="plain" icon="card" title="Pay on Omoshow">
            Card payments open the secure Omoshow checkout in your browser, where you add your details. Come back here when you’ve paid.
          </Notice>
        ) : (
          <>
            <View style={{ gap: space.md }}>
              <Txt variant="h3" accessibilityRole="header">
                Contact details
              </Txt>
              {!user ? (
                <Notice tone="plain" icon="user" title="Checking out as a guest" action="Sign in instead" onAction={() => router.push({ pathname: '/sign-in', params: { next: 'back' } })}>
                  We’ll email your tickets. Create an account with the same email afterwards to see them in the app.
                </Notice>
              ) : null}
              <Field label="Name on the tickets" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoCapitalize="words" error={submitted ? errors.name : ''} editable={!order} />
              <Field label="Email" value={email} onChangeText={setEmail} autoComplete="email" textContentType="emailAddress" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={submitted ? errors.email : ''} hint={gift.on ? 'Your receipt goes here. You can manage the gift from My tickets.' : 'Your tickets and receipt go here.'} editable={!order} />
              {first.event.minAge ? (
                <Notice tone="plain" icon="alert">
                  {`This event is ${first.event.minAge}+. Everyone needs ID showing their age at the door.`}
                </Notice>
              ) : null}
            </View>
            {questions.length ? (
              <CheckoutQuestions
                questions={questions}
                qty={quantity}
                tierName={first.ticketType.name}
                ticketNames={ticketNames}
                answers={answers}
                onChange={(k, v) => {
                  setAnswers((a) => ({ ...a, [k]: v }));
                  setPayError('');
                }}
                showErrors={submitted}
                disabled={!!order}
              />
            ) : null}
            {/* The whole cart as a gift: one email to them, one tap to claim every ticket. */}
            {!order ? <GiftOption gift={gift} patch={(p) => setGift((g) => ({ ...g, ...p }))} errors={giftErr} show={submitted} eventStart={eventStart} now={now} /> : null}
            {dn && !order ? (
              <Card style={{ gap: space.md }}>
                <View style={{ gap: 2 }}>
                  <Txt variant="bodyStrong">Add a donation to {dn.cause}</Txt>
                  <Txt variant="small" color={colors.muted}>
                    {dn.description ? `${dn.description} ` : ''}Optional. No Omoshow fee is taken on it.
                  </Txt>
                </View>
                <AmountPicker label="Donation" chips={dn.suggestedCents} none="No donation" value={donation} onChange={setDonation} currency={currency} error={donationErr ?? undefined} />
                <Txt variant="tiny" color={colors.dim}>
                  {`${DONATION_NO_REFUND} ${DONATION_ON_BEHALF}`}
                </Txt>
              </Card>
            ) : null}
            {sum > 0 ? (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong">Ticket protection</Txt>
                  <Txt variant="small" color={colors.muted}>
                    Get a full refund if you can’t go because of illness, travel delays or a family emergency.
                  </Txt>
                </View>
                <Switch value={protection} onValueChange={setProtection} disabled={!!order} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Ticket protection" />
              </Card>
            ) : null}
            {sum > 0 && !order ? (
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field label="Promo code" value={promoInput} onChangeText={(t) => (setPromoInput(t), setPromoError(''))} autoCapitalize="characters" autoCorrect={false} error={promoError} hint={promo ? `${promo} applied to the whole cart.` : undefined} />
                </View>
                <Button label={promo ? 'Applied' : 'Apply'} size="md" variant="ghost" loading={promoBusy} disabled={!promoInput.trim()} onPress={() => void applyPromo()} />
              </View>
            ) : null}
          </>
        )}

        <Card style={{ gap: space.md }}>
          <Txt variant="bodyStrong">Order summary</Txt>
          {holds.map((h) => (
            <View key={h.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={2}>{`${h.quantity} × ${h.ticketType.name}`}</Txt>
                {/* On a seat map: the seats held for this line (the best together in its sections). */}
                {seatLine(h) ? (
                  <Txt variant="small" color={colors.dim}>
                    {seatLine(h)}
                  </Txt>
                ) : null}
              </View>
              <Txt variant="smallStrong">{money((h.unitCents ?? h.ticketType.priceCents) * h.quantity, currency)}</Txt>
            </View>
          ))}
          {donationCents || order?.donationCents ? (
            <View style={styles.row}>
              <Txt style={{ flex: 1 }} color={colors.muted}>
                {donationLabel(dn?.cause)}
              </Txt>
              <Txt variant="smallStrong">{money(order?.donationCents ?? donationCents, currency)}</Txt>
            </View>
          ) : null}
          {totals?.discountCents ? (
            <View style={styles.row}>
              <Txt style={{ flex: 1 }} color={colors.muted}>{`Promo ${totals.promo?.code ?? ''}`}</Txt>
              <Txt variant="smallStrong" color={colors.success}>{`−${money(totals.discountCents, currency)}`}</Txt>
            </View>
          ) : null}
          {totals?.protectionCents ? (
            <View style={styles.row}>
              <Txt style={{ flex: 1 }} color={colors.muted}>
                Ticket protection
              </Txt>
              <Txt variant="smallStrong">{money(totals.protectionCents, currency)}</Txt>
            </View>
          ) : null}
          <View style={[styles.row, { paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line }]}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Total</Txt>
              <Txt variant="small" color={colors.dim}>
                Fees included. No surprises.
              </Txt>
            </View>
            <Txt variant="priceLg">{total === 0 ? 'Free' : money(total, currency)}</Txt>
          </View>
          {quote.error && !order ? (
            <Txt variant="small" color={colors.accentHi}>
              {errorText(quote.error)}
            </Txt>
          ) : null}
        </Card>

        {free || handsOff ? null : testMode ? (
          <Notice tone="success" icon="shield" title="Test mode">
            No card needed and nothing is charged. Your tickets are issued straight away.
          </Notice>
        ) : provider === 'paystack' ? (
          <Notice tone="plain" icon="card" title="Pay securely with Paystack">
            Card, bank transfer or USSD. You’ll finish on Paystack’s page and come straight back here.
          </Notice>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        {payError ? (
          <Notice tone="accent" icon="alert">
            {payError}
          </Notice>
        ) : null}
        {phase === 'waiting' ? (
          <View style={{ gap: space.sm }}>
            <Button label="I’ve paid, check now" icon="refresh" onPress={() => void check()} />
            <Button
              label="Open the payment page again"
              variant="ghost"
              size="md"
              onPress={() => {
                if (order?.provider === 'paystack' && order.redirectUrl) return void openPaystack(order.redirectUrl).then(() => check());
                void WebBrowser.openBrowserAsync(order?.redirectUrl ?? `${WEB_URL}/checkout?holds=${encodeURIComponent(key)}`, { toolbarColor: colors.bg, controlsColor: colors.accent });
              }}
            />
          </View>
        ) : (
          <Button
            label={busy ? 'Processing…' : handsOff ? `Continue to payment · ${money(total, currency)}` : free ? 'Get tickets · Free' : testMode ? `Complete test order · ${money(total, currency)}` : `Pay ${money(total, currency)}`}
            icon={busy ? undefined : free ? 'ticket' : 'lock'}
            loading={busy}
            onPress={() => void pay()}
            feedback="firm"
          />
        )}
        {phase !== 'waiting' && !order ? (
          <Pressable accessibilityRole="button" onPress={() => void release()} hitSlop={8} style={{ alignSelf: 'center' }}>
            <Txt variant="small" color={colors.dim}>
              Release seats
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** "Section 104 · Row C · Seats 7, 8" for a line held on a seat map ('' for general admission without a section). */
function seatLine(h: Hold) {
  const section = h.section ? [h.section.level !== h.section.label ? h.section.level : null, h.section.label].filter(Boolean).join(' ') : '';
  const seated = h.seats.filter((s) => s.row && s.seat);
  if (!seated.length) return section;
  const sameRow = seated.every((s) => s.row === seated[0].row);
  const seats = sameRow ? seated.map((s) => s.seat).join(', ') : seated.map((s) => `${s.row}${s.seat}`).join(', ');
  return [section, sameRow ? `Row ${seated[0].row}` : '', `Seat${seated.length > 1 ? 's' : ''} ${seats}`].filter(Boolean).join(' · ');
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter - 4, paddingBottom: space.md },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.sm, paddingTop: space.md, paddingHorizontal: gutter, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line2 },
});
