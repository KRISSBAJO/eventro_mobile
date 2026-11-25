/**
 * An event: hero (save and share), when and where (venue, category and city pages), gallery, about, ticket types with
 * perks, a price-drop alert, quantity and a sticky "Get tickets" bar ("Choose seats" when the event has a seat map).
 * Below the organizer's tickets, "Fan resale" lists tickets other fans are selling (components/fan-resale.tsx); when
 * nothing else is on sale, the bar becomes "Sold out · Get resale tickets" and scrolls there. `?resale=1` (links to
 * /events/<slug>#resale) opens the screen scrolled to it.
 *
 * Pay-what-you-want tiers (lib/pwyw.ts): the selected tier gets "Choose your price" (quick picks, the suggested price
 * picked to start, or another amount) with the all-in per ticket; the quantity applies at that amount, and the hold
 * carries it (`amountCents` on POST /holds, or on to the seat map).
 *
 * Multiple dates (lib/dates.ts): a DATES event starts the tickets with "Pick a date" (date cards with "Few left" /
 * "Sold out"), then shows that date's tiers (each date has its own copy of every tier); `?date=` picks one. A DAYS
 * event lists its days under When, and each ticket type says which days it covers. SINGLE events are as before.
 *
 * Schedule (lib/schedule.ts, components/schedule.tsx): an event with one shows it as a timetable under About, by date or
 * day, with stage filters. A signed-in fan holding a ticket that can book a session gets "Book a place" on it (booked
 * with the first of their tickets that can); "Booked" opens that ticket. Events without a schedule are as before.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmountPicker } from '@/components/amount-picker';
import { DateCards } from '@/components/date-cards';
import { FanResale } from '@/components/fan-resale';
import { Gallery } from '@/components/gallery';
import { HeartButton } from '@/components/heart';
import { Icon } from '@/components/icons';
import { PriceAlert } from '@/components/price-alert';
import { ScheduleList } from '@/components/schedule';
import { TierBadge, TierGlyph, TierSurface } from '@/components/tier-look';
import { Badge, Button, EmptyState, ErrorState, FadeIn, IconButton, Notice, Skeleton, Stepper, Txt } from '@/components/ui';
import { api, ApiError, errorText, WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { activeOnly, coverLine, dateLine, eventEnded, rangeLine, upcoming } from '@/lib/dates';
import { CATEGORY_NAME, cityOnly, localTimeText, money, when, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { openMaps } from '@/lib/maps';
import { allInLine, allInOf, amountProblem, fromLabel, isPwyw, pickChips, PROMO_PWYW_NOTE, startAmount } from '@/lib/pwyw';
import { useEvent, useEventResale, useMyTickets } from '@/lib/queries';
import { cardOf } from '@/lib/saved';
import { bookSession, statusText, type ScheduleItem, type TicketSessions } from '@/lib/schedule';
import { lookOf } from '@/lib/tiers';
import type { EventDetail, HoldCreated, TicketType } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const HERO = 360;

export default function EventScreen() {
  const { slug, resale, date } = useLocalSearchParams<{ slug: string; resale?: string; date?: string }>();
  const insets = useSafeAreaInsets();
  const q = useEvent(slug);
  const e = q.data;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const topBar = (
    <View style={[styles.topBar, { top: insets.top + space.sm }]} pointerEvents="box-none">
      <IconButton icon="back" label="Back" glass onPress={back} />
      {e ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {e.status !== 'CANCELLED' ? <HeartButton card={cardOf(e)} glass size={44} /> : null}
          <IconButton icon="share" label="Share this event" glass onPress={() => share(e)} />
        </View>
      ) : null}
    </View>
  );

  if (q.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Skeleton height={HERO} radius={0} />
        <View style={{ padding: gutter, gap: space.md }}>
          <Skeleton height={14} width={90} />
          <Skeleton height={30} width="80%" />
          <Skeleton height={16} width="55%" />
          <Skeleton height={90} style={{ marginTop: space.lg }} />
          <Skeleton height={140} />
        </View>
        {topBar}
      </View>
    );
  }
  if (q.error || !e) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', paddingTop: insets.top }}>
        {missing ? (
          <EmptyState icon="ticket" title="Event not found" body="It may have been removed, or the link is wrong." action="Browse events" onAction={() => router.replace('/search')} />
        ) : (
          <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
        )}
        {topBar}
      </View>
    );
  }
  return <EventBody e={e} topBar={topBar} refetch={() => q.refetch()} jumpToResale={resale === '1'} dateParam={date} />;
}

function share(e: EventDetail) {
  haptic.tap();
  const url = `${WEB_URL}/events/${e.slug}`;
  Share.share(Platform.OS === 'ios' ? { message: `${e.title} on Omoshow`, url } : { message: `${e.title} on Omoshow: ${url}` }).catch(() => undefined);
}

function EventBody({ e, topBar, refetch, jumpToResale, dateParam }: { e: EventDetail; topBar: ReactNode; refetch: () => void; jumpToResale: boolean; dateParam?: string }) {
  const insets = useSafeAreaInsets();
  const d = when(e.startsAt);
  const tz = e.timezone || e.venue?.timezone || null;
  const abbr = zoneAbbr(tz, e.startsAt);
  const yours = localTimeText(e.startsAt, tz);
  const cancelled = e.status === 'CANCELLED';
  // Multiple dates (lib/dates.ts): DATES fans pick a date first, then that date's tiers; DAYS types cover days.
  const mode = e.dateMode ?? 'SINGLE';
  const byDate = mode === 'DATES';
  const liveDates = activeOnly(e.dates);
  const pickable = byDate ? upcoming(e.dates, 0) : [];
  const ended = eventEnded(e, 3);
  const allTypes = [...e.ticketTypes].sort((a, b) => a.sortOrder - b.sortOrder);
  const onSale = !cancelled && !ended && !e.salesPaused && allTypes.some((t) => t.available > 0);

  // DATES: the picked date (a link's ?date=, else the only date on sale, else none until the fan picks).
  const [dateId, setDateId] = useState<string | null>(() => {
    if (!byDate) return null;
    if (dateParam && pickable.some((x) => x.id === dateParam)) return dateParam;
    const open = pickable.filter((x) => !x.soldOut && x.available !== 0);
    return open.length === 1 ? open[0].id : null;
  });
  const picked = byDate ? (pickable.find((x) => x.id === dateId) ?? null) : null;
  const types = byDate ? allTypes.filter((t) => !!picked && t.eventDateId === picked.id) : allTypes;

  const [tierId, setTierId] = useState<string | null>(null);
  const tier = types.find((t) => t.id === tierId) ?? types.find((t) => t.available > 0) ?? types[0];
  const max = Math.max(1, Math.min(8, tier?.maxPerOrder ?? 8, tier?.available || 1));
  const [qtyRaw, setQty] = useState(2);
  const qty = Math.min(qtyRaw, max);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  // Pay what you want: the amount picked per tier (null while what's typed isn't an amount). DATES copies of a tier share one.
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const pw = isPwyw(tier) ? tier.pwyw : null;
  const amountKey = tier ? (tier.tierKey ?? tier.id) : '';
  const amount = pw && tier ? (amountKey in amounts ? amounts[amountKey] : startAmount(pw)) : null;
  const amountErr = pw ? amountProblem(amount, pw, e.currency) : null;
  const unit = pw ? (amount !== null && !amountErr ? allInOf(amount, pw.feePermille) : 0) : (tier?.priceCents ?? 0);
  const total = unit * qty;
  const lowest = allTypes.length ? Math.min(...allTypes.map((t) => t.priceCents)) : e.fromCents;
  const seatMap = !!e.seatMap?.sections.length;

  /** Another date: keep the same tier (its copy on that date) when it's on sale there. */
  const pickDate = (id: string) => {
    setError('');
    const key = tier?.tierKey;
    const same = key ? allTypes.find((t) => t.eventDateId === id && t.tierKey === key && t.available > 0) : undefined;
    setTierId(same?.id ?? null);
    setDateId(id);
  };
  const pickedWhen = picked ? when(picked.startsAt) : null;
  const city = e.venue?.city ?? null;

  // Fan resale: other fans' tickets, while the event is still ahead.
  const resaleQ = useEventResale(cancelled || ended ? undefined : e.slug);
  const listings = !cancelled && !ended && resaleQ.data?.enabled ? resaleQ.data.listings : [];
  const allSoldOut = allTypes.length > 0 && allTypes.every((t) => t.available === 0);
  // Nothing from the organizer (sold out, or sales paused) but fans are selling: the bar points to resale.
  const resaleBar = !cancelled && !ended && !onSale && listings.length > 0;
  const scroller = useRef<ScrollViewInstance>(null);
  const resaleY = useRef<number | null>(null);
  const jumped = useRef(false);
  const toResale = () => {
    if (resaleY.current === null) return;
    haptic.select();
    scroller.current?.scrollTo({ y: Math.max(0, resaleY.current - 96), animated: true });
  };
  // DATES: the "Pick a date" row, for the bar's button before a date is picked.
  const pickerY = useRef<number | null>(null);
  const toPicker = () => {
    haptic.select();
    if (pickerY.current !== null) scroller.current?.scrollTo({ y: Math.max(0, pickerY.current - 96), animated: true });
  };
  const onResaleLayout = (ev: LayoutChangeEvent) => {
    resaleY.current = ev.nativeEvent.layout.y;
    if (jumpToResale && !jumped.current) {
      jumped.current = true;
      const y = Math.max(0, ev.nativeEvent.layout.y - 96);
      setTimeout(() => scroller.current?.scrollTo({ y, animated: true }), 50);
    }
  };

  const getTickets = async () => {
    if (!tier) return;
    if (amountErr) {
      haptic.warning();
      setError(amountErr);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const h = await api<HoldCreated>('/holds', { body: { ticketTypeId: tier.id, quantity: qty, ...(pw && amount !== null ? { amountCents: amount } : {}) } });
      haptic.success();
      router.push({ pathname: '/checkout/[holdId]', params: { holdId: h.id } });
    } catch (err) {
      haptic.error();
      setError(errorText(err));
      refetch();
    } finally {
      setBusy(false);
    }
  };

  const status = cancelled ? (
    <Notice tone="accent" icon="alert" title="This event was cancelled">
      {`${e.cancelReason ? `${e.cancelReason} ` : ''}Everyone with tickets gets a full refund to the card they paid with.`}
    </Notice>
  ) : ended ? (
    <Notice tone="plain" icon="clock" title="This event has ended">
      Thanks to everyone who came. Browse what’s on next.
    </Notice>
  ) : e.salesPaused ? (
    <Notice tone="warning" icon="clock" title="Sales are paused">
      Sales are paused by the organizer. Check back soon.
    </Notice>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={{ paddingBottom: (onSale ? 120 : resaleBar ? 150 : space.huge) + insets.bottom }}
        scrollEventThrottle={32}
        onScroll={(ev) => setSolid(ev.nativeEvent.contentOffset.y > HERO - 140)}>
        <View style={{ height: HERO }}>
          <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={[StyleSheet.absoluteFill, cancelled && { opacity: 0.5 }]} contentFit="cover" transition={250} accessibilityIgnoresInvertColors />
          <LinearGradient colors={['rgba(15,10,11,0.5)', colors.fade0, colors.fade0, colors.bg]} locations={[0, 0.28, 0.55, 1]} style={StyleSheet.absoluteFill} />
        </View>

        <FadeIn style={{ paddingHorizontal: gutter, marginTop: -72, gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Pressable accessibilityRole="link" accessibilityLabel={`More ${CATEGORY_NAME[e.category] ?? e.category} events`} onPress={() => router.push({ pathname: '/category/[category]', params: { category: e.category } })} hitSlop={6}>
              <Badge label={CATEGORY_NAME[e.category] ?? e.category} tone="glass" />
            </Pressable>
            {cancelled ? <Badge label="Cancelled" tone="accent" /> : null}
            {e.online ? <Badge label="Online" tone="glass" /> : null}
          </View>
          <Txt variant="h1" accessibilityRole="header">
            {e.title}
          </Txt>
          {e.subtitle ? (
            <Txt variant="title" color={colors.muted} style={{ fontSize: 17 }}>
              {e.subtitle}
            </Txt>
          ) : null}
        </FadeIn>

        <View style={{ paddingHorizontal: gutter, marginTop: space.xl, gap: space.md }}>
          {status}

          <View style={styles.info}>
            {mode === 'DAYS' && liveDates.length ? (
              // A multi-day event: its days, one line each.
              <InfoRow icon="calendar" title={`${rangeLine(liveDates)}${liveDates.length > 1 ? ` · ${liveDates.length} days` : ''}`} lines={liveDates.map((x) => `${dateLine(x)}${x.doorsAt ? ` · Doors ${when(x.doorsAt).time}` : ''}`)} />
            ) : byDate && pickedWhen && picked ? (
              <InfoRow
                icon="calendar"
                title={pickedWhen.date}
                lines={[`${pickedWhen.time}${zoneAbbr(tz, picked.startsAt) ? ` ${zoneAbbr(tz, picked.startsAt)}` : ''}${picked.doorsAt ? ` · Doors ${when(picked.doorsAt).time}` : ''}${picked.label ? ` · ${picked.label}` : ''}`, localTimeText(picked.startsAt, tz), pickable.length > 1 ? `${pickable.length} dates · ${rangeLine(pickable)}` : null]}
              />
            ) : byDate && liveDates.length ? (
              <InfoRow icon="calendar" title={`${pickable.length || liveDates.length} ${(pickable.length || liveDates.length) === 1 ? 'date' : 'dates'}`} lines={[rangeLine(pickable.length ? pickable : liveDates), onSale ? 'Pick a date below' : null]} />
            ) : (
              <InfoRow icon="calendar" title={d.date} lines={[`${d.time}${abbr ? ` ${abbr}` : ''}${e.doorsAt ? ` · Doors ${when(e.doorsAt).time}` : ''}`, yours]} />
            )}
            <View style={styles.infoDivider} />
            {e.online ? (
              <InfoRow icon="stream" title="Online event" lines={['The stream link appears on your ticket.']} />
            ) : e.venue ? (
              <InfoRow
                icon="pin"
                title={e.venue.name}
                lines={[[e.venue.address, e.venue.address?.includes(e.venue.city ?? '') ? null : e.venue.city].filter(Boolean).join(', ')]}
                action={{ label: 'Open in Maps', onPress: () => e.venue && openMaps(e.venue) }}
                onTitle={() => router.push({ pathname: '/venue/[slug]', params: { slug: e.venue!.slug } })}
              />
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {e.venue ? <LinkChip icon="building" label={e.venue.name} onPress={() => router.push({ pathname: '/venue/[slug]', params: { slug: e.venue!.slug } })} /> : null}
            {city ? <LinkChip icon="pin" label={`What’s on in ${cityOnly(city)}`} onPress={() => router.push({ pathname: '/city/[city]', params: { city, ...(e.venue?.country ? { country: e.venue.country } : {}) } })} /> : null}
            <LinkChip icon="sparkle" label={`More ${(CATEGORY_NAME[e.category] ?? e.category).toLowerCase()}`} onPress={() => router.push({ pathname: '/category/[category]', params: { category: e.category } })} />
          </ScrollView>

          {e.description ? (
            <View style={{ gap: space.sm, marginTop: space.lg }}>
              <Txt variant="h3" accessibilityRole="header">
                About
              </Txt>
              <Txt color={colors.muted} numberOfLines={aboutOpen ? undefined : 5}>
                {e.description}
              </Txt>
              {e.description.length > 280 ? (
                <Pressable accessibilityRole="button" onPress={() => setAboutOpen((o) => !o)} hitSlop={8}>
                  <Txt variant="smallStrong" color={colors.accent}>
                    {aboutOpen ? 'Show less' : 'Read more'}
                  </Txt>
                </Pressable>
              ) : null}
              <Txt variant="small" color={colors.dim}>
                Presented by {e.presentedBy}
              </Txt>
            </View>
          ) : null}
        </View>

        {e.media.length ? (
          <View style={{ marginTop: space.xl }}>
            <Gallery media={e.media} title={e.title} />
          </View>
        ) : null}

        {e.schedule?.length ? <EventSchedule e={e} dateId={picked?.id ?? null} /> : null}

        {!cancelled && !ended && allTypes.length ? (
          <View style={{ paddingHorizontal: gutter, marginTop: space.xxl, gap: space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Txt variant="h2" accessibilityRole="header">
                Tickets
              </Txt>
              <Txt variant="small" color={colors.muted}>
                From <Txt variant="smallStrong">{money(lowest, e.currency)}</Txt> all-in
              </Txt>
            </View>
            {byDate ? (
              <View
                style={{ gap: space.sm }}
                onLayout={(ev) => {
                  pickerY.current = ev.nativeEvent.layout.y;
                }}>
                <Txt variant="bodyStrong">Pick a date</Txt>
                <DateCards dates={pickable} value={dateId} onChange={pickDate} stock />
                {!pickable.length ? (
                  <Txt variant="small" color={colors.muted}>
                    No dates are on sale right now.
                  </Txt>
                ) : null}
              </View>
            ) : null}
            {types.map((t) => (
              <TierCard key={t.id} t={t} currency={e.currency} on={t.id === tier?.id} disabled={e.salesPaused} onPress={() => setTierId(t.id)} days={mode === 'DAYS' ? coverLine(t.validDateIds ?? [], e.dates ?? []) : undefined} />
            ))}
            {onSale && tier && pw && tier.available > 0 ? (
              <View style={styles.pwyw}>
                <View style={{ gap: 2 }}>
                  <Txt variant="bodyStrong">Choose your price</Txt>
                  <Txt variant="small" color={colors.muted}>
                    {`Pay what you want for ${tier.name}${pw.minCents > 0 ? `, from ${money(pw.minCents, e.currency, { decimals: pw.minCents % 100 !== 0 })}` : ''}${pw.maxSet ? ` up to ${money(pw.maxCents, e.currency)}` : ''}. Every ticket in this order is at the same price.`}
                  </Txt>
                </View>
                <AmountPicker
                  key={tier.id}
                  label="Your price per ticket"
                  chips={pickChips(pw)}
                  value={amount}
                  onChange={(c) => {
                    setError('');
                    setAmounts((m) => ({ ...m, [amountKey]: c }));
                  }}
                  currency={e.currency}
                  error={amountErr ?? undefined}
                />
                {amount !== null && !amountErr ? (
                  <Txt variant="smallStrong" accessibilityLiveRegion="polite">
                    {allInLine(amount, pw, e.currency)}
                  </Txt>
                ) : null}
                <Txt variant="tiny" color={colors.dim}>
                  {`${PROMO_PWYW_NOTE}${amount === 0 ? ' A ticket taken for free isn’t covered by the Omoshow Guarantee.' : ''}`}
                </Txt>
              </View>
            ) : null}
            {onSale && tier && tier.available > 0 ? (
              <View style={styles.qtyRow}>
                <View>
                  <Txt variant="bodyStrong">How many?</Txt>
                  <Txt variant="small" color={colors.dim}>
                    Up to {max} per order
                  </Txt>
                </View>
                <Stepper value={qty} max={max} onChange={setQty} label="Number of tickets" />
              </View>
            ) : null}
            {onSale && seatMap && tier ? (
              <Pressable accessibilityRole="button" onPress={getTickets} disabled={busy} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
                <Txt variant="smallStrong" color={colors.accent}>
                  {busy ? 'Holding…' : 'Skip the map: hold the best seats together'}
                </Txt>
              </Pressable>
            ) : null}
            {!cancelled && !ended ? <PriceAlert slug={e.slug} /> : null}
            <View style={styles.trust}>
              {[
                // The Omoshow Guarantee covers paid tickets only: free ones have nothing to refund.
                // A pay-what-you-want ticket that can be free is only covered when it's paid for ("from" is 0 then).
                allTypes.every((t) => t.priceCents <= 0 && !isPwyw(t)) ? null : allTypes.some((t) => t.priceCents <= 0) ? 'Paid tickets covered by the Omoshow Guarantee' : 'Covered by the Omoshow Guarantee',
                'Instant mobile delivery',
                seatMap ? 'Pick your exact seats, or let us find the best together' : 'Prices include all fees',
                e.donations ? `Add an optional donation to ${e.donations.cause} at checkout` : null,
              ]
                .filter((s): s is string => !!s)
                .map((s) => (
                <View key={s} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Icon name="check" size={15} color={colors.success} />
                  <Txt variant="small" color={colors.muted}>
                    {s}
                  </Txt>
                </View>
              ))}
            </View>
          </View>
        ) : !cancelled && !ended ? (
          <View style={{ paddingHorizontal: gutter, marginTop: space.xl }}>
            <Notice tone="plain">Tickets for this event aren’t on sale yet.</Notice>
          </View>
        ) : null}

        {!cancelled && !ended ? (
          <View onLayout={onResaleLayout} style={{ paddingHorizontal: gutter, marginTop: space.xl }}>
            <FanResale slug={e.slug} listings={listings} refetch={() => void resaleQ.refetch()} />
          </View>
        ) : null}
      </ScrollView>

      {resaleBar ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
            <Txt variant="small" color={colors.dim} numberOfLines={1} style={{ flexShrink: 1 }}>
              {listings.length === 1 ? '1 ticket from a fan' : `${listings.length} tickets from fans`}
            </Txt>
            <Txt variant="smallStrong" numberOfLines={1}>
              from {money(listings[0].priceCents, listings[0].currency)}
            </Txt>
          </View>
          <Button label={allSoldOut ? 'Sold out · Get resale tickets' : 'Get resale tickets'} iconRight="arrowRight" onPress={toResale} block feedback="firm" />
        </View>
      ) : null}

      {onSale && byDate && !tier ? (
        // Multiple dates, none picked yet: the bar points at the dates.
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <View style={{ flex: 1 }}>
              <Txt variant="small" color={colors.dim} numberOfLines={1}>
                {`${pickable.length} ${pickable.length === 1 ? 'date' : 'dates'} · ${rangeLine(pickable)}`}
              </Txt>
              <Txt variant="priceLg" style={{ fontSize: 26, lineHeight: 30 }} numberOfLines={1}>
                <Txt variant="small" color={colors.dim}>
                  {'from '}
                </Txt>
                {money(lowest, e.currency)}
              </Txt>
            </View>
            <Button label="Pick a date" icon="calendar" onPress={toPicker} style={{ minWidth: 140 }} feedback="firm" />
          </View>
        </View>
      ) : null}

      {onSale && tier ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {error ? <Notice tone="accent">{error}</Notice> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <View style={{ flex: 1 }}>
              <Txt variant="small" color={colors.dim} numberOfLines={1}>
                {qty} × {tier.name}
                {pickedWhen ? ` · ${pickedWhen.short}` : ''}
                {pw && !amountErr ? ` at ${money(unit, e.currency)}` : ''}
              </Txt>
              <Txt variant="priceLg" style={{ fontSize: 26, lineHeight: 30 }} accessibilityLabel={amountErr ? 'Choose your price first' : `Total ${money(total, e.currency)}, fees included`} numberOfLines={1}>
                {amountErr ? '—' : money(total, e.currency)}
                <Txt variant="small" color={colors.dim}>
                  {'  '}all-in
                </Txt>
              </Txt>
            </View>
            {seatMap ? (
              <Button
                label={tier.available === 0 ? 'Sold out' : 'Choose seats'}
                icon="seat"
                disabled={tier.available === 0 || busy}
                onPress={() => {
                  if (amountErr) {
                    haptic.warning();
                    setError(amountErr);
                    return;
                  }
                  router.push({ pathname: '/seats/[slug]', params: { slug: e.slug, tier: tier.id, qty: String(qty), ...(pw && amount !== null ? { amount: String(amount) } : {}), ...(picked ? { date: picked.id } : {}) } });
                }}
                style={{ minWidth: 140 }}
                feedback="firm"
              />
            ) : (
              <Button label={busy ? 'Holding…' : tier.available === 0 ? 'Sold out' : 'Get tickets'} loading={busy} disabled={tier.available === 0} onPress={getTickets} style={{ minWidth: 140 }} feedback="firm" />
            )}
          </View>
        </View>
      ) : null}
      {solid ? (
        <View style={[styles.topFill, { height: insets.top + 60 }]}>
          <Txt variant="title" numberOfLines={1} style={{ alignSelf: 'stretch', textAlign: 'center', marginLeft: 64, marginRight: 116 }}>
            {e.title}
          </Txt>
        </View>
      ) : null}
      {topBar}
    </View>
  );
}

/**
 * The event's schedule. Bookable sessions: a fan's tickets for this event say what each can book (GET
 * /tickets/:id/sessions); "Book a place" books with the first ticket that can, "Booked" opens the ticket that has it,
 * and otherwise the quiet line says why not (full, a clash, not for this ticket). Without tickets: places left only.
 */
function EventSchedule({ e, dateId }: { e: EventDetail; dateId: string | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const items = e.schedule ?? [];
  const bookable = items.some((i) => i.bookable) && e.status !== 'CANCELLED';
  const wallet = useMyTickets(bookable ? user?.id : undefined);
  const mine = bookable && !wallet.offline ? (wallet.data?.tickets ?? []).filter((t) => t.event.slug === e.slug && (t.status === 'ACTIVE' || t.status === 'CHECKED_IN')) : [];
  const answers = useQueries({
    queries: mine.map((t) => ({
      queryKey: ['me', 'sessions', t.id],
      queryFn: () => api<TicketSessions>(`/tickets/${encodeURIComponent(t.id)}/sessions`),
      staleTime: 15_000,
      retry: 0,
    })),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** Every answer about this item, from each of the fan's tickets. */
  const about = (item: ScheduleItem) => answers.flatMap((a) => (a.data ? a.data.items.filter((x) => x.id === item.id).map((x) => ({ ...x, ticketId: a.data!.ticketId })) : []));

  const book = async (item: ScheduleItem, ticketId: string) => {
    setBusy(item.id);
    setError('');
    try {
      await bookSession(ticketId, item.id);
      haptic.success();
    } catch (err) {
      haptic.error();
      setError(`${item.title}: ${errorText(err)}`);
    } finally {
      setBusy(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['me', 'sessions'] }), qc.invalidateQueries({ queryKey: ['me', 'tickets'] }), qc.invalidateQueries({ queryKey: ['event', e.slug] })]);
    }
  };

  return (
    <View style={{ paddingHorizontal: gutter, marginTop: space.xxl, gap: space.md }}>
      <Txt variant="h2" accessibilityRole="header">
        Schedule
      </Txt>
      {bookable && !mine.length ? (
        <Txt variant="small" color={colors.muted}>
          Sessions with places can be booked for free once you have a ticket.
        </Txt>
      ) : null}
      {error ? <Notice tone="accent">{error}</Notice> : null}
      <ScheduleList
        items={items}
        stages={e.stages ?? []}
        dates={e.dates ?? []}
        dateId={dateId}
        status={(item) => {
          const all = about(item);
          if (!all.length || all.some((x) => x.status === 'BOOKED' || x.status === 'OPEN')) return null;
          // Can't be booked with any of their tickets: the most useful reason.
          const why = ['CLOSED', 'FULL', 'CLASH', 'NOT_ELIGIBLE'].map((k) => all.find((x) => x.status === k)).find(Boolean);
          return why ? statusText(why) : null;
        }}
        action={(item) => {
          const all = about(item);
          const booked = all.find((x) => x.status === 'BOOKED');
          const open = all.find((x) => x.status === 'OPEN');
          if (booked) return <Button label="Booked" icon="check" variant="subtle" size="sm" onPress={() => router.push({ pathname: '/ticket/[id]', params: { id: booked.ticketId } })} />;
          if (open) return <Button label="Book a place" variant="danger" size="sm" loading={busy === item.id} disabled={!!busy} onPress={() => void book(item, open.ticketId)} />;
          return null;
        }}
      />
    </View>
  );
}

function LinkChip({ icon, label, onPress }: { icon: 'building' | 'pin' | 'sparkle'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.linkChip, pressed && { backgroundColor: colors.surface2 }]}>
      <Icon name={icon} size={14} color={colors.accent} />
      <Txt variant="smallStrong" numberOfLines={1} style={{ maxWidth: 200 }}>
        {label}
      </Txt>
      <Icon name="chevronRight" size={13} color={colors.dim} />
    </Pressable>
  );
}

function InfoRow({ icon, title, lines, action, onTitle }: { icon: 'calendar' | 'pin' | 'stream'; title: string; lines: (string | null)[]; action?: { label: string; onPress: () => void }; onTitle?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View style={styles.infoIcon}>
        <Icon name={icon} size={19} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {onTitle ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`${title}, venue page`} onPress={onTitle} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt variant="bodyStrong" style={{ flexShrink: 1 }}>
              {title}
            </Txt>
            <Icon name="chevronRight" size={15} color={colors.muted} />
          </Pressable>
        ) : (
          <Txt variant="bodyStrong">{title}</Txt>
        )}
        {lines.filter(Boolean).map((l) => (
          <Txt key={l} variant="small" color={colors.muted}>
            {l}
          </Txt>
        ))}
        {action ? (
          <Pressable accessibilityRole="link" onPress={action.onPress} hitSlop={8} style={({ pressed }) => [styles.mapLink, pressed && { opacity: 0.7 }]}>
            <Icon name="map" size={15} color={colors.accent} />
            <Txt variant="smallStrong" color={colors.accent}>
              {action.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A tier in its look: the gradient head (glyph, name, badge, price), then what's included. Premium looks glow. */
function TierCard({ t, currency, on, disabled, onPress, days }: { t: TicketType; currency: string; on: boolean; disabled?: boolean; onPress: () => void; days?: string }) {
  const [open, setOpen] = useState(false);
  const out = t.available === 0;
  const look = lookOf(t);
  const perks = open ? t.perks : t.perks.slice(0, 3);
  const glow = look.colors[look.colors.length - 1];
  const pw = isPwyw(t) ? t.pwyw : null;
  const price = pw ? fromLabel(pw, currency) : money(t.priceCents, currency);
  const hasBody = !!t.description || perks.length > 0 || out || t.available < 50 || !!pw || !!days;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: out || !!disabled }}
      accessibilityLabel={`${t.name}${t.badge ? `, ${t.badge}` : ''}${days ? `, valid ${days}` : ''}, ${pw ? `pay what you want, ${price.toLowerCase()}` : `${price} each`}${out ? ', sold out' : t.available < 50 ? `, only ${t.available} left` : ''}`}
      disabled={out || disabled}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tier,
        look.premium && !out && { borderColor: `${glow}66`, shadowColor: glow, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
        on && !out && styles.tierOn,
        out && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.99 }] },
      ]}>
      <View style={styles.tierClip}>
        <TierSurface look={look} edge="top" style={styles.tierHead}>
          <View style={styles.tierHeadRow}>
            <View style={[styles.radio, { borderColor: look.inkSoft }]}>{on && !out ? <View style={[styles.radioDot, { backgroundColor: look.ink }]} /> : null}</View>
            <TierGlyph look={look} size={18} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="title" color={look.ink}>
                {t.name}
              </Txt>
              {t.badge ? <TierBadge label={t.badge} look={look} /> : null}
            </View>
            <Txt variant={pw ? 'smallStrong' : 'price'} color={look.ink}>
              {price}
            </Txt>
          </View>
        </TierSurface>
        {hasBody ? (
          <View style={styles.tierBody}>
            {days ? (
              // A multi-day event: the days this ticket gets you in.
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Icon name="calendar" size={14} color={colors.accent} />
                <Txt variant="smallStrong" style={{ flex: 1 }}>
                  {days}
                </Txt>
              </View>
            ) : null}
            {pw ? (
              <Txt variant="smallStrong" color={colors.text}>
                Pay what you want
                {pw.suggestedCents !== null ? <Txt variant="small" color={colors.muted}>{` · suggested ${money(allInOf(pw.suggestedCents, pw.feePermille), currency)} all-in`}</Txt> : null}
              </Txt>
            ) : null}
            {t.description ? (
              <Txt variant="small" color={colors.muted}>
                {t.description}
              </Txt>
            ) : null}
            {perks.length ? (
              <View style={{ gap: 3 }}>
                {perks.map((p) => (
                  <View key={p} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                    <View style={{ marginTop: 2 }}>
                      <Icon name="check" size={14} color={look.premium ? look.colors[0] : colors.accent} />
                    </View>
                    <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
                      {p}
                    </Txt>
                  </View>
                ))}
                {t.perks.length > 3 ? (
                  <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} hitSlop={8}>
                    <Txt variant="smallStrong" color={colors.accent}>
                      {open ? 'Show less' : `+${t.perks.length - 3} more`}
                    </Txt>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {out ? (
              <Txt variant="smallStrong" color={colors.accent}>
                Sold out
              </Txt>
            ) : t.available < 50 ? (
              <Txt variant="smallStrong" color={colors.accent}>
                Only {t.available} left
              </Txt>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: gutter - 4, right: gutter - 4, flexDirection: 'row', justifyContent: 'space-between' },
  topFill: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 18, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.line },
  info: { gap: space.lg, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  infoDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line2, marginLeft: 52 },
  infoIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, minHeight: 28, alignSelf: 'flex-start' },
  linkChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  tier: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  tierOn: { borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  tierClip: { borderRadius: radius.card - 1, overflow: 'hidden' },
  tierHead: { borderWidth: 0 },
  tierHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, paddingHorizontal: space.lg },
  tierBody: { gap: 6, paddingVertical: space.md, paddingHorizontal: space.lg },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
  pwyw: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.surface },
  trust: { gap: 6, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.md,
    paddingTop: space.md,
    paddingHorizontal: gutter,
    backgroundColor: colors.bg2,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
});
