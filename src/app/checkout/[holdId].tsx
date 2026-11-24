/**
 * Checkout for a hold (POST /holds made on the event screen): held seats and countdown, contact details,
 * ticket protection and promo codes, the all-in total, then payment:
 *   mock      test mode: POST /orders, then POST /orders/:id/pay
 *   paystack  Paystack's page in the in-app browser, then POST /orders/:id/verify until it's paid
 *   stripe    Stripe's PaymentSheet in the app (needs a publishable key), then verify; otherwise the website's checkout
 * A failed or cancelled payment keeps the seats held, so the fan can try again.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText, WEB_URL } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { money, PAYSTACK, when, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useHealth } from '@/lib/queries';
import { payWithStripeSheet, stripeSheetAvailable } from '@/lib/stripe-sheet';
import type { Hold, Order, OrderCreated, Quote } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const quote = useQuery({
    queryKey: ['quote', holdId, protection, promo],
    queryFn: () => api<Quote>('/quote', { body: { holdId, protection, ...(promo ? { promoCode: promo } : {}) } }),
    enabled: !!hold.data && !order,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
  });

  const h = hold.data;
  const msLeft = h ? new Date(h.expiresAt).getTime() - now : null;
  const expired = !!h && (h.status === 'EXPIRED' || h.status === 'RELEASED' || (msLeft !== null && msLeft <= 0)) && phase !== 'done' && !order;
  const currency = h?.event.currency ?? 'USD';
  const provider: OrderCreated['provider'] = PAYSTACK.has(currency) ? (health.data?.paystack ? 'paystack' : 'mock') : health.data?.stripe ? 'stripe' : 'mock';
  const testMode = health.data?.payments === 'mock' || provider === 'mock';
  const errors = {
    name: name.trim().length < 2 ? 'Enter the name for the tickets.' : '',
    email: !emailOk(email) ? 'Enter a valid email; your tickets go there.' : '',
  };
  const valid = !errors.name && !errors.email;

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z0-9]{3,15}$/.test(code)) {
      setPromoError('That code isn’t valid for this event.');
      return;
    }
    setPromoBusy(true);
    try {
      const q = await api<Quote>('/quote', { body: { holdId, promoCode: code, protection } });
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

  /** The website's checkout, for card payments where the in-app sheet isn't available (web, or no publishable key). */
  const webCheckoutStatus = async (): Promise<Order | null> => {
    const fresh = await api<Hold>(`/holds/${encodeURIComponent(holdId!)}`);
    if (fresh.order?.status !== 'PAID') return null;
    return api<Order>(`/orders/${encodeURIComponent(fresh.order.id)}?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  };

  const check = async () => {
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
    setPhase('paying');
    setPayError('');
    try {
      // Stripe without the in-app sheet: the website takes the card (it creates the order itself).
      if (provider === 'stripe' && !stripeSheetAvailable && !order) {
        setPhase('waiting');
        await WebBrowser.openBrowserAsync(`${WEB_URL}/checkout?hold=${encodeURIComponent(h.id)}`, { toolbarColor: colors.bg, controlsColor: colors.accent, dismissButtonStyle: 'close' });
        await check();
        return;
      }

      const created =
        order ??
        (await api<OrderCreated>('/orders', {
          body: { holdId: h.id, email: email.trim().toLowerCase(), name: name.trim(), protection, ...(promo ? { promoCode: promo } : {}) },
        }));
      setOrder(created);

      if (created.provider === 'mock') {
        finish(await api<Order>(`/orders/${encodeURIComponent(created.orderId)}/pay`, { method: 'POST' }));
        return;
      }
      if (created.provider === 'paystack' && created.redirectUrl) {
        setPhase('waiting');
        await WebBrowser.openBrowserAsync(created.redirectUrl, { toolbarColor: colors.bg, controlsColor: colors.accent, dismissButtonStyle: 'close' });
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

  if (phase === 'done' && paid) return <Success order={paid} hold={h} testMode={paid.provider === 'mock'} signedIn={!!user && user.email === paid.email} />;

  const d = when(h.event.startsAt);
  const abbr = zoneAbbr(h.event.timezone, h.event.startsAt);
  const totals = quote.data;
  const mm = msLeft !== null ? Math.max(0, Math.floor(msLeft / 60000)) : 10;
  const ss = msLeft !== null ? String(Math.max(0, Math.floor((msLeft % 60000) / 1000))).padStart(2, '0') : '00';
  const low = msLeft !== null && msLeft < 120000;
  const holdTotal = 10 * 60_000;
  const busy = phase === 'paying';
  const total = order?.totalCents ?? totals?.totalCents ?? h.ticketType.priceCents * h.quantity;
  const seatLine = seatText(h);

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
          </View>
        </Card>
        <Card style={{ gap: space.sm }}>
          <Txt variant="eyebrow" color={colors.accent}>
            Your seats
          </Txt>
          <Txt variant="bodyStrong">{seatLine}</Txt>
          <Txt variant="small" color={colors.dim}>
            {h.seats.some((s) => s.seat) ? 'Side by side, the best available right now.' : 'Standing or general admission: no seat numbers.'}
          </Txt>
        </Card>

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
            hint="Your tickets and receipt go here."
            editable={!order}
          />
        </View>

        {/* Protection + promo */}
        {!order ? (
          <>
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
                </Txt>
                <Txt variant="smallStrong" color={colors.text}>
                  +{money(Math.round(h.ticketType.priceCents * h.quantity * 0.07), currency)}
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
          </>
        ) : null}

        {/* Summary */}
        <Card style={{ gap: space.sm }}>
          <Txt variant="h3" accessibilityRole="header">
            Order summary
          </Txt>
          <Line label={`${h.quantity} × ${h.ticketType.name}`} value={money(totals?.subtotalCents ?? h.ticketType.priceCents * h.quantity, currency)} />
          {totals?.protectionCents ? <Line label="Ticket protection" value={money(totals.protectionCents, currency)} /> : null}
          {totals?.discountCents ? <Line label={`Promo ${totals.promo?.code ?? ''}`} value={`−${money(totals.discountCents, currency)}`} accent /> : null}
          <View style={styles.totalRow}>
            <View>
              <Txt variant="bodyStrong">Total</Txt>
              <Txt variant="small" color={colors.dim}>
                Fees included. No surprises.
              </Txt>
            </View>
            <Txt variant="priceLg">{money(total, currency)}</Txt>
          </View>
        </Card>

        {testMode ? (
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
                const url = order?.redirectUrl ?? `${WEB_URL}/checkout?hold=${encodeURIComponent(h.id)}`;
                void WebBrowser.openBrowserAsync(url, { toolbarColor: colors.bg, controlsColor: colors.accent });
              }}
            />
          </View>
        ) : (
          <Button
            label={busy ? 'Processing…' : testMode ? `Complete test order · ${money(total, currency)}` : `Pay ${money(total, currency)}`}
            icon={busy ? undefined : 'lock'}
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

function seatText(h: Hold) {
  const section = h.section ? [h.section.level, h.section.label].filter(Boolean).join(' ') : null;
  const first = h.seats[0];
  if (first?.row && h.seats.every((s) => s.seat)) {
    const seats = h.seats.map((s) => s.seat).join(', ');
    return [section ? `Section ${section}` : null, `Row ${first.row}`, `Seat${h.seats.length > 1 ? 's' : ''} ${seats}`].filter(Boolean).join(' · ');
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

function Success({ order, hold, testMode, signedIn }: { order: Order; hold: Hold; testMode: boolean; signedIn: boolean }) {
  const insets = useSafeAreaInsets();
  const d = when(order.event.startsAt);
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
          {order.quantity} ticket{order.quantity === 1 ? '' : 's'} for {order.event.title}. We’ve emailed the receipt to {order.email}.
        </Txt>
        {testMode ? <Badge label="Test order · nothing was charged" tone="success" style={{ alignSelf: 'center' }} /> : null}
      </View>

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
        <Txt variant="small" color={colors.muted}>
          {d.date} · {d.time}
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Txt variant="bodyStrong">Total paid</Txt>
          <Txt variant="price">{money(order.totalCents, order.currency)}</Txt>
        </View>
      </Card>

      {signedIn ? (
        <Button label="View my tickets" icon="ticket" onPress={() => router.replace('/tickets')} />
      ) : (
        <>
          <Notice tone="plain" icon="user" title="Keep your tickets in the app">
            {`Create an account with ${order.email} and these tickets move into your wallet, with the QR code for the door.`}
          </Notice>
          <Button label="Create an account" onPress={() => router.replace({ pathname: '/sign-up', params: { email: order.email, name: order.buyerName } })} />
        </>
      )}
      <Button label="Back to the event" variant="ghost" onPress={() => router.replace({ pathname: '/event/[slug]', params: { slug: hold.event.slug } })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter - 4, paddingBottom: space.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden', marginTop: -space.sm },
  trackFill: { height: 4, backgroundColor: colors.accent },
  eventThumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface2 },
  protect: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: space.md, marginTop: space.xs, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.sm, paddingTop: space.md, paddingHorizontal: gutter, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line2 },
  successIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
