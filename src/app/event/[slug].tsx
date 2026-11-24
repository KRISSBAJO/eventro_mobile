/** An event: hero, when and where, about, ticket types with perks, quantity and a sticky "Get tickets" bar. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Badge, Button, EmptyState, ErrorState, FadeIn, IconButton, Notice, Skeleton, Stepper, Txt } from '@/components/ui';
import { api, ApiError, errorText, WEB_URL } from '@/lib/api';
import { CATEGORY_NAME, isPast, localTimeText, money, when, zoneAbbr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useEvent } from '@/lib/queries';
import type { EventDetail, HoldCreated, TicketType } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const HERO = 360;

export default function EventScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const q = useEvent(slug);
  const e = q.data;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const topBar = (
    <View style={[styles.topBar, { top: insets.top + space.sm }]} pointerEvents="box-none">
      <IconButton icon="back" label="Back" glass onPress={back} />
      {e ? <IconButton icon="share" label="Share this event" glass onPress={() => share(e)} /> : null}
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
  return <EventBody e={e} topBar={topBar} refetch={() => q.refetch()} />;
}

function share(e: EventDetail) {
  haptic.tap();
  const url = `${WEB_URL}/events/${e.slug}`;
  Share.share(Platform.OS === 'ios' ? { message: `${e.title} on Eventro`, url } : { message: `${e.title} on Eventro: ${url}` }).catch(() => undefined);
}

function openMaps(e: EventDetail) {
  const v = e.venue;
  if (!v) return;
  haptic.tap();
  const label = [v.name, v.address, v.city].filter(Boolean).join(', ');
  const hasPoint = v.lat !== null && v.lng !== null;
  const google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasPoint ? `${v.lat},${v.lng}` : label)}`;
  const url =
    Platform.OS === 'ios'
      ? `https://maps.apple.com/?q=${encodeURIComponent(v.name)}${hasPoint ? `&ll=${v.lat},${v.lng}` : `&address=${encodeURIComponent(label)}`}`
      : Platform.OS === 'android'
        ? hasPoint
          ? `geo:${v.lat},${v.lng}?q=${v.lat},${v.lng}(${encodeURIComponent(v.name)})`
          : `geo:0,0?q=${encodeURIComponent(label)}`
        : google;
  Linking.openURL(url).catch(() => Linking.openURL(google).catch(() => undefined));
}

function EventBody({ e, topBar, refetch }: { e: EventDetail; topBar: ReactNode; refetch: () => void }) {
  const insets = useSafeAreaInsets();
  const d = when(e.startsAt);
  const tz = e.timezone || e.venue?.timezone || null;
  const abbr = zoneAbbr(tz, e.startsAt);
  const yours = localTimeText(e.startsAt, tz);
  const cancelled = e.status === 'CANCELLED';
  const ended = isPast(e.startsAt, 3);
  const types = [...e.ticketTypes].sort((a, b) => a.sortOrder - b.sortOrder);
  const onSale = !cancelled && !ended && !e.salesPaused && types.some((t) => t.available > 0);

  const [tierId, setTierId] = useState<string | null>(null);
  const tier = types.find((t) => t.id === tierId) ?? types.find((t) => t.available > 0) ?? types[0];
  const max = Math.max(1, Math.min(8, tier?.maxPerOrder ?? 8, tier?.available || 1));
  const [qtyRaw, setQty] = useState(2);
  const qty = Math.min(qtyRaw, max);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  const total = (tier?.priceCents ?? 0) * qty;
  const lowest = types.length ? Math.min(...types.map((t) => t.priceCents)) : e.fromCents;
  const images = e.media.filter((m) => m.kind === 'image' && m.url);

  const getTickets = async () => {
    if (!tier) return;
    setBusy(true);
    setError('');
    try {
      const h = await api<HoldCreated>('/holds', { body: { ticketTypeId: tier.id, quantity: qty } });
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
        contentContainerStyle={{ paddingBottom: (onSale ? 120 : space.huge) + insets.bottom }}
        scrollEventThrottle={32}
        onScroll={(ev) => setSolid(ev.nativeEvent.contentOffset.y > HERO - 140)}>
        <View style={{ height: HERO }}>
          <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={[StyleSheet.absoluteFill, cancelled && { opacity: 0.5 }]} contentFit="cover" transition={250} accessibilityIgnoresInvertColors />
          <LinearGradient colors={['rgba(15,10,11,0.5)', colors.fade0, colors.fade0, colors.bg]} locations={[0, 0.28, 0.55, 1]} style={StyleSheet.absoluteFill} />
        </View>

        <FadeIn style={{ paddingHorizontal: gutter, marginTop: -72, gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Badge label={CATEGORY_NAME[e.category] ?? e.category} tone="glass" />
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
            <InfoRow icon="calendar" title={d.date} lines={[`${d.time}${abbr ? ` ${abbr}` : ''}${e.doorsAt ? ` · Doors ${when(e.doorsAt).time}` : ''}`, yours]} />
            <View style={styles.infoDivider} />
            {e.online ? (
              <InfoRow icon="stream" title="Online event" lines={['The stream link appears on your ticket.']} />
            ) : e.venue ? (
              <InfoRow
                icon="pin"
                title={e.venue.name}
                lines={[[e.venue.address, e.venue.address?.includes(e.venue.city ?? '') ? null : e.venue.city].filter(Boolean).join(', ')]}
                action={{ label: 'Open in Maps', onPress: () => openMaps(e) }}
              />
            ) : null}
          </View>

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

        {images.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md, marginTop: space.xl }}>
            {images.map((m) => (
              <Image key={m.id} source={{ uri: m.thumbUrl ?? m.url }} style={styles.thumb} contentFit="cover" accessibilityLabel={m.alt || 'Event photo'} />
            ))}
          </ScrollView>
        ) : null}

        {!cancelled && !ended && types.length ? (
          <View style={{ paddingHorizontal: gutter, marginTop: space.xxl, gap: space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Txt variant="h2" accessibilityRole="header">
                Tickets
              </Txt>
              <Txt variant="small" color={colors.muted}>
                From <Txt variant="smallStrong">{money(lowest, e.currency)}</Txt> all-in
              </Txt>
            </View>
            {types.map((t) => (
              <TierCard key={t.id} t={t} currency={e.currency} on={t.id === tier?.id} disabled={e.salesPaused} onPress={() => setTierId(t.id)} />
            ))}
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
            <View style={styles.trust}>
              {['Covered by the Eventro Guarantee', 'Instant mobile delivery', e.seatMap ? 'Seats side by side, picked for you' : 'Prices include all fees'].map((s) => (
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
      </ScrollView>

      {onSale && tier ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {error ? <Notice tone="accent">{error}</Notice> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <View style={{ flex: 1 }}>
              <Txt variant="small" color={colors.dim} numberOfLines={1}>
                {qty} × {tier.name}
              </Txt>
              <Txt variant="priceLg" style={{ fontSize: 26, lineHeight: 30 }} accessibilityLabel={`Total ${money(total, e.currency)}, fees included`} numberOfLines={1}>
                {money(total, e.currency)}
                <Txt variant="small" color={colors.dim}>
                  {'  '}all-in
                </Txt>
              </Txt>
            </View>
            <Button label={busy ? 'Holding…' : tier.available === 0 ? 'Sold out' : 'Get tickets'} loading={busy} disabled={tier.available === 0} onPress={getTickets} style={{ minWidth: 140 }} feedback="firm" />
          </View>
        </View>
      ) : null}
      {solid ? (
        <View style={[styles.topFill, { height: insets.top + 60 }]}>
          <Txt variant="title" numberOfLines={1} style={{ maxWidth: '60%' }}>
            {e.title}
          </Txt>
        </View>
      ) : null}
      {topBar}
    </View>
  );
}

function InfoRow({ icon, title, lines, action }: { icon: 'calendar' | 'pin' | 'stream'; title: string; lines: (string | null)[]; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View style={styles.infoIcon}>
        <Icon name={icon} size={19} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{title}</Txt>
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

function TierCard({ t, currency, on, disabled, onPress }: { t: TicketType; currency: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  const [open, setOpen] = useState(false);
  const out = t.available === 0;
  const perks = open ? t.perks : t.perks.slice(0, 3);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: out || !!disabled }}
      accessibilityLabel={`${t.name}, ${money(t.priceCents, currency)} each${out ? ', sold out' : t.available < 50 ? `, only ${t.available} left` : ''}`}
      disabled={out || disabled}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.tier, on && !out && styles.tierOn, out && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={[styles.radio, on && !out && styles.radioOn]}>{on && !out ? <View style={styles.radioDot} /> : null}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Txt variant="title">{t.name}</Txt>
          {t.badge ? <Badge label={t.badge} tone="accent" /> : null}
        </View>
        {t.description ? (
          <Txt variant="small" color={colors.muted}>
            {t.description}
          </Txt>
        ) : null}
        {perks.length ? (
          <View style={{ gap: 3, marginTop: 2 }}>
            {perks.map((p) => (
              <View key={p} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                <View style={{ marginTop: 2 }}>
                  <Icon name="check" size={14} color={colors.accent} />
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
      <Txt variant="price">{money(t.priceCents, currency)}</Txt>
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
  thumb: { width: 160, height: 110, borderRadius: radius.md, backgroundColor: colors.surface2 },
  tier: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  tierOn: { borderColor: colors.accent, backgroundColor: 'rgba(255,77,61,0.06)' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
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
