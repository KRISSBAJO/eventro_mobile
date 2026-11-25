/**
 * Checkout for a hold (POST /holds made on the event screen): held seats and countdown, contact details,
 * ticket protection and promo codes, "This is a gift" (gift on POST /orders), the all-in total, then payment:
 *   mock      test mode: POST /orders, then POST /orders/:id/pay
 *   paystack  Paystack's page in an auth session (returnTo: 'app'): after paying, the website's return page confirms
 *             the payment and hands back to eventro://tickets, which closes the browser; then POST /orders/:id/verify
 *             until it's paid (also the fallback when the fan closes the browser themselves)
 *   stripe    Stripe's PaymentSheet in the app (needs a publishable key), then verify; otherwise the website's checkout
 *             (it makes the order itself): first PATCH /holds/:id { donationCents, amountCents } so the website picks
 *             up the donation and the pay-what-you-want amount chosen here (a failed PATCH shows its error and the
 *             browser stays shut), then ${WEB_URL}/checkout?hold=<id>. From then on those picks are locked here.
 *   free    a $0 order (free tickets or $0 pay what you want, and no donation): POST /orders fulfils it at once
 *             (provider 'free', status PAID), then POST /orders/:id/pay returns the order view. No card, no browser.
 * A failed or cancelled payment keeps the seats held, so the fan can try again.
 *
 * Pay what you want (lib/pwyw.ts): the amount chosen on the event page shows here and can be changed (`amountCents`
 * on /quote and /orders); promo codes don't apply to those tickets. Donations (lib/donations.ts): when the event takes
 * them, "Add a donation to {cause}" with suggested amounts or another one (`donationCents`), its own summary line.
 * `donationCents` always goes explicitly (0 included) on /quote and /orders then: left out, the API falls back to the
 * donation stored on the hold. A donation already stored on the hold (an earlier hand-off) is the starting pick.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { AmountPicker } from '@/components/amount-picker';
import { CheckoutSuccess } from '@/components/checkout-success';
import { GiftOption, giftBody, giftErrors, NO_GIFT, type GiftDraft } from '@/components/gift-option';
import { Icon } from '@/components/icons';
import { TierChip } from '@/components/tier-look';
import { Button, Card, EmptyState, ErrorState, Field, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText, WEB_URL } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { NATIVE, openPaystack, providerFor, sleep } from '@/lib/checkout';
import { DONATION_NO_REFUND, DONATION_ON_BEHALF, donationLabel, donationProblem } from '@/lib/donations';
import { instantOf, money, when, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { allInLine, allInOf, amountProblem, isPwyw, pickChips, PROMO_PWYW_NOTE, startAmount } from '@/lib/pwyw';
import { useHealth } from '@/lib/queries';
import { payWithStripeSheet, stripeSheetAvailable } from '@/lib/stripe-sheet';
import type { Hold, Order, OrderCreated, Quote } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

type Phase = 'form' | 'paying' | 'waiting' | 'done';

export default function Checkout() {
  const { holdId } = useLocalSearchParams<{ holdId: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const health = useHealth();
  const hold = useQuery({
    queryKey: ['hold', holdId],
    queryFn: () => api<Hold>(`/holds/${encodeURIComponent(holdId!)}`),
    enabled: !!holdId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [protection, setProtection] = useState(false);
  const [gift, setGift] = useState<GiftDraft>(NO_GIFT);
  const patchGift = (p: Partial<GiftDraft>) => setGift((g) => ({ ...g, ...p }));
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
  // Pay what you want: the amount per ticket (undefined: the one the hold was made with); and the donation (0: none).
  const [amountPick, setAmountPick] = useState<number | null | undefined>(undefined);
  const [changingAmount, setChangingAmount] = useState(false);
  const [donation, setDonation] = useState<number | null>(0);
  /** The picks went to the website with the hold (card payments there): they can't change here any more. */
  const [handedOff, setHandedOff] = useState(false);

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

  const h = hold.data;
  // A donation already stored on the hold (handed to the website earlier) is where the picker starts.
  const [donationSeeded, setDonationSeeded] = useState(false);
  if (h && !donationSeeded) {
    setDonationSeeded(true);
    if (h.event.donations && h.donationCents) setDonation(h.donationCents);
  }
  const currency = h?.event.currency ?? 'USD';
  const pw = h && isPwyw(h.ticketType) ? h.ticketType.pwyw : null;
  const amount = pw ? (amountPick === undefined ? (h?.amountCents ?? startAmount(pw)) : amountPick) : null;
  const amountErr = pw ? amountProblem(amount, pw, currency) : null;
  const dn = h?.event.donations ?? null;
  const donationErr = dn ? donationProblem(donation, dn, currency) : null;
  const donationCents = dn && donation && !donationErr ? donation : 0;
  /** all-in per ticket at the amount picked now */
  const unit = pw ? (amount !== null && !amountErr ? allInOf(amount, pw.feePermille) : 0) : (h?.unitCents ?? h?.ticketType.priceCents ?? 0);
  // Ticket protection covers what the tickets cost: nothing to protect on a $0 ticket.
  const protect = protection && unit > 0;
  // Typed amounts settle for a moment before they're quoted. The donation always goes (0 too) when the event takes
  // them: left out, the API uses the one stored on the hold.
  const extras = { amountCents: pw && amount !== null && !amountErr ? amount : undefined, donationCents: dn ? donationCents : undefined };
  const extrasKey = JSON.stringify(extras);
  const [quoted, setQuoted] = useState(extrasKey);
  useEffect(() => {
    const t = setTimeout(() => setQuoted(extrasKey), 350);
    return () => clearTimeout(t);
  }, [extrasKey]);
  const quoteExtras = JSON.parse(quoted) as typeof extras;

  const quote = useQuery({
    queryKey: ['quote', holdId, protect, promo, quoted],
    queryFn: () => api<Quote>('/quote', { body: { holdId, protection: protect, ...(promo ? { promoCode: promo } : {}), ...quoteExtras } }),
    enabled: !!hold.data && !order && !amountErr && !donationErr,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status === 400),
  });
  /** Nothing to pay (free tickets, $0 pay what you want or a full discount, and no donation): no card, no browser. */
  // Only a quote for what's picked right now counts (not one for an amount still settling).
  const free = !!h && (order ? order.totalCents === 0 : quote.data && !quote.isPlaceholderData && quoted === extrasKey ? quote.data.totalCents === 0 : unit === 0 && donationCents === 0);

  const msLeft = h ? new Date(h.expiresAt).getTime() - now : null;
  const expired = !!h && (h.status === 'EXPIRED' || h.status === 'RELEASED' || (msLeft !== null && msLeft <= 0)) && phase !== 'done' && !order;
  const provider: OrderCreated['provider'] = providerFor(currency, health.data);
  const testMode = health.data?.payments === 'mock' || provider === 'mock';
  const errors = {
    name: name.trim().length < 2 ? 'Enter the name for the tickets.' : '',
    email: !emailOk(email) ? (gift.on ? 'Enter a valid email; your receipt goes there.' : 'Enter a valid email; your tickets go there.') : '',
  };
  // Event times are the venue's wall-clock time; with its zone this is the real start, which a gift must beat.
  const eventStart = h ? (h.event.timezone ? instantOf(h.event.startsAt, h.event.timezone) : new Date(h.event.startsAt)).getTime() : 0;
  const giftErr = giftErrors(gift, email, eventStart, now);
  const valid = !errors.name && !errors.email && !giftErr.name && !giftErr.email && !giftErr.at;

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z0-9]{3,15}$/.test(code)) {
      setPromoError('That code isn’t valid for this event.');
      return;
    }
    setPromoBusy(true);
    try {
      const q = await api<Quote>('/quote', { body: { holdId, promoCode: code, protection: protect, ...extras } });
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
    qc.invalidateQueries({ queryKey: ['event', h?.event.slug] });
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

  /** A $0 order is already PAID: its order view, from POST /orders/:id/pay (which takes 'free'), else GET /orders/:id. */
  const freeOrder = async (orderId: string) => {
    try {
      return await api<Order>(`/orders/${encodeURIComponent(orderId)}/pay`, { method: 'POST' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) throw e;
      return api<Order>(`/orders/${encodeURIComponent(orderId)}?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    }
  };

  /** The website's checkout, for card payments where the in-app sheet isn't available (web, or no publishable key). */
  const webCheckoutStatus = async (): Promise<Order | null> => {
    const fresh = await api<Hold>(`/holds/${encodeURIComponent(holdId!)}`);
    if (fresh.order?.status !== 'PAID') return null;
    return api<Order>(`/orders/${encodeURIComponent(fresh.order.id)}?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  };

  const check = async () => {
    // Already confirming (the browser just closed and the pay flow is checking): don't report "not seen yet" over it.
    if (verifying.current) return;
    setPayError('');
    try {
      const o = order ? await confirmPaid(order.orderId, 3) : await webCheckoutStatus();
      if (o) finish(o);
      else setPayError('We haven’t seen your payment yet. If you paid, give it a moment and check again. Your seats are still held.');
    } catch (e) {
      setPayError(errorText(e));
    }
  };

  // Back from Paystack's page or the website (Android doesn't tell us when the browser closes): check on return.
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
    if (!valid || !h) {
      haptic.warning();
      return;
    }
    if (!order && (amountErr || donationErr)) {
      haptic.warning();
      setPayError(amountErr ?? donationErr ?? '');
      return;
    }
    setPhase('paying');
    setPayError('');
    try {
      // Stripe without the in-app sheet: the website takes the card (it creates the order itself). A $0 order needs no card.
      if (provider === 'stripe' && !stripeSheetAvailable && !order && !free) {
        // The website reads the donation and the pay-what-you-want amount from the hold: store them first. If that's
        // refused, the error shows (below) and the browser stays shut.
        const handOff = { ...(dn ? { donationCents } : {}), ...(pw && amount !== null ? { amountCents: amount } : {}) };
        if (!handedOff && Object.keys(handOff).length) {
          const fresh = await api<Hold>(`/holds/${encodeURIComponent(h.id)}`, { method: 'PATCH', body: handOff });
          qc.setQueryData(['hold', holdId], fresh);
        }
        setHandedOff(true);
        setChangingAmount(false);
        setPhase('waiting');
        await WebBrowser.openBrowserAsync(`${WEB_URL}/checkout?hold=${encodeURIComponent(h.id)}`, { toolbarColor: colors.bg, controlsColor: colors.accent, dismissButtonStyle: 'close' });
        await check();
        return;
      }

      const created =
        order ??
        (await api<OrderCreated>('/orders', {
          body: {
            holdId: h.id,
            email: email.trim().toLowerCase(),
            name: name.trim(),
            protection: protect,
            ...(promo ? { promoCode: promo } : {}),
            ...(pw && amount !== null ? { amountCents: amount } : {}),
            // Always sent (0 too) when the event takes donations: left out, the API uses the hold's stored one.
            ...(dn ? { donationCents } : {}),
            ...giftBody(gift),
            // Paystack sends the fan back to the website; with this, the website hands them back to the app.
            ...(NATIVE && provider === 'paystack' ? { returnTo: 'app' } : {}),
          },
        }));
      setOrder(created);

      // Nothing to pay: fulfilled straight away.
      if (created.provider === 'free') {
        finish(await freeOrder(created.orderId));
        return;
      }
      if (created.provider === 'mock') {
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

  const release = async () => {
    haptic.tap();
    if (h && !order) await api(`/holds/${encodeURIComponent(h.id)}`, { method: 'DELETE' }).catch(() => undefined);
    if (h) qc.invalidateQueries({ queryKey: ['event', h.event.slug] });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const header = (title: string, canClose = true) => (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      {canClose ? <IconButton icon="back" label="Back to the event and release seats" onPress={release} /> : <View style={{ width: 44 }} />}
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      <View style={{ width: 44 }} />
    </View>
  );

  if (hold.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header('Checkout')}
        <View style={{ padding: gutter, gap: space.lg }}>
          <Skeleton height={96} />
          <Skeleton height={170} />
          <Skeleton height={140} />
        </View>
      </View>
    );
  }
  if (hold.error || !h) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header('Checkout')}
        {hold.error instanceof ApiError && hold.error.status === 404 ? (
          <EmptyState icon="ticket" title="Those seats aren’t held any more" body="Pick your tickets again to continue." action="Back" onAction={() => router.back()} />
        ) : (
          <ErrorState message={errorText(hold.error)} onRetry={() => hold.refetch()} />
        )}
      </View>
    );
  }

  if (phase === 'done' && paid) return <CheckoutSuccess order={paid} eventSlug={h.event.slug} testMode={paid.provider === 'mock'} signedIn={!!user && user.email === paid.email} />;

  const d = when(h.event.startsAt);
  const abbr = zoneAbbr(h.event.timezone, h.event.startsAt);
  const totals = quote.data;
  const mm = msLeft !== null ? Math.max(0, Math.floor(msLeft / 60000)) : 10;
  const ss = msLeft !== null ? String(Math.max(0, Math.floor((msLeft % 60000) / 1000))).padStart(2, '0') : '00';
  const low = msLeft !== null && msLeft < 120000;
  const holdTotal = 10 * 60_000;
  const busy = phase === 'paying';
  const total = order?.totalCents ?? totals?.totalCents ?? unit * h.quantity + donationCents;
  const seatLine = seatText(h);
  /** The order exists, or the picks went to the website with the hold: the amount and the donation are fixed. */
  const locked = !!order || handedOff;
  const donated = order?.donationCents ?? totals?.donationCents ?? donationCents;

  if (expired) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header('Checkout')}
        <EmptyState icon="clock" title="Your seats were released" body="Holds last 10 minutes, so other fans get a chance. Pick them again to continue." action="Pick seats again" onAction={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header('Checkout', phase !== 'waiting')}
      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: 140 + insets.bottom, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {/* Hold timer */}
        <View style={[styles.timer, low && { borderColor: colors.accentLine, backgroundColor: colors.accentSoft }]} accessibilityLiveRegion={low ? 'polite' : 'none'}>
          <Icon name="clock" size={18} color={low ? colors.accent : colors.muted} />
          <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
            {h.quantity} × {h.ticketType.name} held for{' '}
            <Txt variant="smallStrong" color={low ? colors.accent : colors.text}>
              {mm}:{ss}
            </Txt>
          </Txt>
        </View>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.max(0, Math.min(1, (msLeft ?? 0) / holdTotal)) * 100}%` }]} />
        </View>

        {/* Event + seats */}
        <Card style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Image source={h.event.imageUrl ? { uri: h.event.imageUrl } : null} style={styles.eventThumb} contentFit="cover" />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title" numberOfLines={2}>
              {h.event.title}
            </Txt>
            <Txt variant="small" color={colors.muted}>
              {d.short} · {d.time}
              {abbr ? ` ${abbr}` : ''}
            </Txt>
            {h.event.venue ? (
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {[h.event.venue.name, h.event.venue.city].filter(Boolean).join(', ')}
              </Txt>
            ) : null}
            <TierChip tier={h.ticketType} style={{ marginTop: 4 }} />
          </View>
        </Card>
        <Card style={{ gap: space.sm }}>
          <Txt variant="eyebrow" color={colors.accent}>
            Your seats
          </Txt>
          <Txt variant="bodyStrong">{seatLine}</Txt>
          <Txt variant="small" color={colors.dim}>
            {!h.seats.some((s) => s.seat) ? 'Standing or general admission: no seat numbers.' : together(h) ? 'Side by side, held for you.' : 'The seats you picked, held for you.'}
          </Txt>
        </Card>

        {/* Pay what you want: the amount per ticket */}
        {pw ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="eyebrow" color={colors.accent}>
              Your price
            </Txt>
            <Txt variant="bodyStrong">{amount !== null && !amountErr ? allInLine(amount, pw, currency) : 'Choose an amount per ticket.'}</Txt>
            {!locked && changingAmount ? (
              <>
                <AmountPicker label="Your price per ticket" chips={pickChips(pw)} value={amount} onChange={setAmountPick} currency={currency} error={amountErr ?? undefined} />
                <Txt variant="small" color={colors.dim}>
                  {`Pay what you want${pw.minCents > 0 ? `, from ${money(pw.minCents, currency, { decimals: pw.minCents % 100 !== 0 })}` : ''}${pw.maxSet ? ` up to ${money(pw.maxCents, currency)}` : ''}. Every ticket in this order is at the same price.`}
                </Txt>
              </>
            ) : !locked ? (
              <Button label="Change amount" variant="ghost" size="sm" onPress={() => setChangingAmount(true)} style={{ alignSelf: 'flex-start' }} />
            ) : null}
            {amount === 0 ? (
              <Txt variant="tiny" color={colors.dim}>
                A ticket taken for free isn’t covered by the Eventro Guarantee: there’s nothing to refund.
              </Txt>
            ) : null}
          </Card>
        ) : null}

        {/* Contact */}
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
            hint={gift.on ? 'Your receipt goes here. You can manage the gift from My tickets.' : 'Your tickets and receipt go here.'}
            editable={!order}
          />
        </View>

        {/* Gift */}
        {!order ? <GiftOption gift={gift} patch={patchGift} errors={giftErr} show={submitted} eventStart={eventStart} now={now} /> : null}
        {provider === 'stripe' && !stripeSheetAvailable && gift.on ? (
          <Notice tone="warning" icon="gift">
            Card payments finish on the Eventro website: turn on “This is a gift” there too.
          </Notice>
        ) : null}

        {/* Donation */}
        {dn && !locked ? (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
              <View style={styles.donationIcon}>
                <Icon name="heart" size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">Add a donation to {dn.cause}</Txt>
                <Txt variant="small" color={colors.muted}>
                  {dn.description ? `${dn.description} ` : ''}Optional. No Eventro fee is taken on it.
                </Txt>
              </View>
            </View>
            <AmountPicker label="Donation" chips={dn.suggestedCents} none="No donation" value={donation} onChange={setDonation} currency={currency} error={donationErr ?? undefined} />
            <Txt variant="tiny" color={colors.dim}>
              {`${DONATION_NO_REFUND} ${DONATION_ON_BEHALF}`}
            </Txt>
          </Card>
        ) : null}

        {/* Protection + promo */}
        {!order ? (
          <>
            {unit > 0 ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: protection }}
                onPress={() => {
                  haptic.select();
                  setProtection((p) => !p);
                }}
                style={[styles.protect, protection && { borderColor: colors.accent, backgroundColor: 'rgba(255,77,61,0.06)' }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt variant="bodyStrong">Ticket protection</Txt>
                  <Txt variant="small" color={colors.muted}>
                    Get a full refund if you can’t go because of illness, travel delays or a family emergency.
                    {donationCents ? ' It covers the tickets, not the donation.' : ''}
                  </Txt>
                  <Txt variant="smallStrong" color={colors.text}>
                    +{money(Math.round(unit * h.quantity * 0.07), currency)}
                  </Txt>
                </View>
                <Switch
                  value={protection}
                  onValueChange={(v) => {
                    haptic.select();
                    setProtection(v);
                  }}
                  trackColor={{ true: colors.accent, false: colors.line2 }}
                  thumbColor="#ffffff"
                  accessibilityLabel="Ticket protection"
                />
              </Pressable>
            ) : null}
            {pw ? (
              <View style={styles.promoOff}>
                <Icon name="tag" size={15} color={colors.dim} />
                <Txt variant="small" color={colors.dim} style={{ flex: 1 }}>
                  {PROMO_PWYW_NOTE}
                </Txt>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                <Field
                  label="Promo code"
                  value={promo ?? promoInput}
                  onChangeText={(t) => {
                    setPromo(null);
                    setPromoInput(t.toUpperCase());
                    setPromoError('');
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="Optional"
                  error={promoError}
                  hint={promo ? `${promo} applied` : undefined}
                  style={{ flex: 1 }}
                  returnKeyType="done"
                  onSubmitEditing={applyPromo}
                />
                <Button label={promo ? 'Applied' : 'Apply'} variant="ghost" size="md" loading={promoBusy} disabled={!!promo || !promoInput.trim()} onPress={applyPromo} style={{ marginTop: 26 }} />
              </View>
            )}
          </>
        ) : null}

        {/* Summary */}
        <Card style={{ gap: space.sm }}>
          <Txt variant="h3" accessibilityRole="header">
            Order summary
          </Txt>
          <TierChip tier={h.ticketType} label={`${h.quantity} × ${h.ticketType.name}`} size="md" />
          <Line label={pw ? `${h.quantity} × ${h.ticketType.name} at ${money(totals?.unitCents ?? unit, currency)}` : `${h.quantity} × ${h.ticketType.name}`} value={money(totals?.subtotalCents ?? unit * h.quantity, currency)} />
          {pw && totals?.feeCents ? <Line label="Eventro fee, included above" value={money(totals.feeCents, currency, { decimals: true })} /> : null}
          {totals?.protectionCents ? <Line label="Ticket protection" value={money(totals.protectionCents, currency)} /> : null}
          {totals?.discountCents ? <Line label={`Promo ${totals.promo?.code ?? ''}`} value={`−${money(totals.discountCents, currency)}`} accent /> : null}
          {donated ? <Line label={donationLabel(dn?.cause)} value={money(donated, currency, { decimals: donated % 100 !== 0 })} /> : null}
          <View style={styles.totalRow}>
            <View>
              <Txt variant="bodyStrong">Total</Txt>
              <Txt variant="small" color={colors.dim}>
                {total === 0 ? 'Nothing to pay.' : 'Fees included. No surprises.'}
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

        {free ? null : testMode ? (
          <Notice tone="success" icon="shield" title="Test mode">
            No card needed and nothing is charged. Your tickets are issued straight away.
          </Notice>
        ) : provider === 'paystack' ? (
          <Notice tone="plain" icon="card" title="Pay securely with Paystack">
            Card, bank transfer or USSD. You’ll finish on Paystack’s page and come straight back here.
          </Notice>
        ) : provider === 'stripe' && !stripeSheetAvailable ? (
          <Notice tone="plain" icon="card" title="Pay on eventro">
            Card payments open the secure Eventro checkout in your browser. Come back here when you’ve paid.
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
            <Button label="I’ve paid, check now" icon="refresh" onPress={check} />
            <Button
              label="Open the payment page again"
              variant="ghost"
              size="md"
              onPress={() => {
                if (order?.provider === 'paystack' && order.redirectUrl) {
                  // Back from the auth session: check straight away (the AppState listener may not fire on iOS).
                  void openPaystack(order.redirectUrl).then(() => check());
                  return;
                }
                const url = order?.redirectUrl ?? `${WEB_URL}/checkout?hold=${encodeURIComponent(h.id)}`;
                void WebBrowser.openBrowserAsync(url, { toolbarColor: colors.bg, controlsColor: colors.accent });
              }}
            />
          </View>
        ) : (
          <Button
            label={busy ? 'Processing…' : free ? 'Get tickets · Free' : testMode ? `Complete test order · ${money(total, currency)}` : `Pay ${money(total, currency)}`}
            icon={busy ? undefined : free ? 'ticket' : 'lock'}
            loading={busy}
            onPress={pay}
            feedback="firm"
          />
        )}
        {phase !== 'waiting' && !order ? (
          <Pressable accessibilityRole="button" onPress={release} hitSlop={8} style={{ alignSelf: 'center' }}>
            <Txt variant="small" color={colors.dim}>
              Release seats
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** One row, seat numbers in a run. */
function together(h: Hold) {
  const s = [...h.seats].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  return s.every((x, i) => x.row === s[0].row && (i === 0 || x.seat === (s[i - 1].seat ?? 0) + 1));
}

function seatText(h: Hold) {
  const section = h.section ? [h.section.level, h.section.label].filter(Boolean).join(' ') : null;
  const first = h.seats[0];
  if (first?.row && h.seats.every((s) => s.row && s.seat)) {
    // Picked seats can be in different rows: "Row C · Seats 7, 8" or "Seats C8, D7".
    const sameRow = h.seats.every((s) => s.row === first.row);
    const sorted = [...h.seats].sort((a, b) => a.row!.localeCompare(b.row!) || a.seat! - b.seat!);
    const seats = sameRow ? sorted.map((s) => s.seat).join(', ') : sorted.map((s) => `${s.row}${s.seat}`).join(', ');
    return [section ? `Section ${section}` : null, sameRow ? `Row ${first.row}` : null, `Seat${h.seats.length > 1 ? 's' : ''} ${seats}`].filter(Boolean).join(' · ');
  }
  return section ? `${section} · General admission` : 'General admission';
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="smallStrong" color={accent ? colors.success : colors.text}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter - 4, paddingBottom: space.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden', marginTop: -space.sm },
  trackFill: { height: 4, backgroundColor: colors.accent },
  eventThumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface2 },
  protect: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  promoOff: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, borderStyle: 'dashed' },
  donationIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: space.md, marginTop: space.xs, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.sm, paddingTop: space.md, paddingHorizontal: gutter, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line2 },
});
