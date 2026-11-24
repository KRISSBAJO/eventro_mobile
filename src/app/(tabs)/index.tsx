/** Discover: where you are, what's on near you, categories, this weekend and what's coming up. */
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LogoMark } from '@/components/icons';
import { Rail } from '@/components/rail';
import { Button, Chip, ErrorState, FadeIn, Notice, SectionHeader, Skeleton, Txt } from '@/components/ui';
import { errorText, isOffline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BROWSE_CATEGORIES, CATEGORY_NAME, cityOnly, countryName, distanceLabel, firstName, flag, greeting } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { nearestCountry, placeLabel, placeOptions, placeShort, preciseLocation, rankNear, shortCity, usePlace } from '@/lib/place';
import { useAllEvents, useEventsBetween, useEventsNear, useTrendingEvents } from '@/lib/queries';
import { colors, gutter, radius, space } from '@/theme';

const SHOW = 8;

/** Quick "when" pills under the search: each opens Search with that date range. */
const WHEN_PILLS = [
  { id: 'today', label: 'Tonight', icon: 'sparkle' },
  { id: 'weekend', label: 'This weekend', icon: 'calendar' },
  { id: 'week', label: 'This week', icon: 'clock' },
  { id: 'month', label: 'This month', icon: 'calendar' },
] as const;

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export default function Discover() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { place, ready, save } = usePlace();
  const all = useAllEvents();
  const near = useEventsNear(place?.lat, place?.lng);
  const weekend = useEventsBetween('weekend');
  const popular = useTrendingEvents();
  const [refreshing, setRefreshing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  // When the screen opened (for "this week"); read once so rendering stays pure.
  const [openedAt] = useState(() => Date.now());

  const events = all.data?.items ?? [];
  const ranked = rankNear(place?.lat !== undefined && near.data ? near.data.items : events, place);
  const local = ranked.filter((r) => r.tier === 'city' || r.tier === 'country');
  const inCity = ranked.filter((r) => r.tier === 'city');
  const online = ranked.filter((r) => r.tier === 'online');
  const shown = [...local, ...(local.length < 4 ? online : [])].slice(0, SHOW);
  const shownSlugs = new Set(shown.map((r) => r.event.slug));
  const distances = Object.fromEntries(shown.map((r) => [r.event.slug, r.distanceKm]));
  // Most tickets sold in the last two weeks (soonest first when nothing has sold lately, or the API can't rank).
  const railSource = popular.data?.items ?? (popular.isPending ? [] : events);
  const comingUp = railSource.filter((e) => !shownSlugs.has(e.slug)).slice(0, 10);
  const trending = popular.trending;
  const railLoading = popular.isPending || (!!popular.error && all.isPending);
  const whereName = place ? (inCity.length && place.city ? place.city : place.source === 'precise' && !inCity.length ? countryName(place.country) : place.city && inCity.length ? place.city : countryName(place.country)) : '';
  const nearest = inCity[0]?.distanceKm ?? null;
  // "What's on in NY?" when we know the city (a short name keeps the headline to two lines).
  const headlineCity = place && place.source !== 'precise' && place.city ? shortCity(place.city) : place?.source === 'precise' && inCity.length ? 'your area' : '';
  const weekCount = local.filter((r) => {
    const t = new Date(r.event.startsAt).getTime();
    return t - openedAt < 7 * 86_400_000;
  }).length;

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([all.refetch(), weekend.refetch(), popular.refetch(), place?.lat !== undefined ? near.refetch() : null]);
    setRefreshing(false);
  };

  const usePrecise = async () => {
    setLocating(true);
    setLocError('');
    try {
      const { lat, lng } = await preciseLocation();
      save({ country: nearestCountry(events, lat, lng) ?? place?.country ?? 'US', lat, lng, source: 'precise' });
      haptic.success();
    } catch (e) {
      setLocError(errorText(e));
      haptic.warning();
    } finally {
      setLocating(false);
    }
  };

  const browse = (params: Record<string, string>) => router.navigate({ pathname: '/search', params: { ...params, at: String(Date.now()) } });
  // Cities with the most events on sale (the visitor's country first), for the city pages.
  const cities = placeOptions(events)
    .flatMap((c) => c.cities.map(([city, n]) => ({ city, country: c.code, n, home: c.code === place?.country })))
    .sort((a, b) => Number(b.home) - Number(a.home) || b.n - a.n)
    .slice(0, 10);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: space.huge }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface} />}>
      {/* Warm glow behind the top of the screen, fading into the page */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,77,61,0.20)', 'rgba(255,120,80,0.06)', 'rgba(15,10,11,0)']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={[styles.glow, { height: insets.top + 360 }]}
      />

      {/* Header: logo, a short location pill, and you */}
      <View style={styles.header}>
        <LogoMark size={28} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Location: ${placeLabel(place)}. Change location`}
            onPress={() => router.push('/place')}
            hitSlop={6}
            style={({ pressed }) => [styles.locChip, pressed && { borderColor: colors.text }]}>
            <Icon name={place?.source === 'precise' ? 'locate' : 'pin'} size={14} color={colors.accent} />
            <Txt variant="smallStrong" numberOfLines={1} style={{ maxWidth: 96 }}>
              {ready ? placeShort(place) : '…'}
            </Txt>
            <Icon name="chevronDown" size={13} color={colors.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={user ? 'Your account' : 'Sign in'}
            onPress={() => router.navigate(user ? '/account' : '/sign-in')}
            hitSlop={6}
            style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.8 }]}>
            {user ? (
              <Txt variant="smallStrong" color={colors.accentInk}>
                {initialsOf(user.name)}
              </Txt>
            ) : (
              <Icon name="user" size={17} color={colors.text} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Greeting and a headline about where you are */}
      <FadeIn style={{ paddingHorizontal: gutter, marginTop: space.xxl, gap: space.sm }}>
        <Txt variant="small" color={colors.muted}>
          {greeting()}
          {user ? `, ${firstName(user.name)}` : ''}
        </Txt>
        <Txt variant="hero" accessibilityRole="header">
          {headlineCity ? (
            <>
              What’s on in{'\n'}
              <Txt variant="hero" color={colors.accent}>
                {headlineCity}?
              </Txt>
            </>
          ) : (
            <>
              Find your next{'\n'}
              <Txt variant="hero" color={colors.accent}>
                night out.
              </Txt>
            </>
          )}
        </Txt>
        {weekCount > 0 ? (
          <Txt variant="small" color={colors.muted}>
            {weekCount} {weekCount === 1 ? 'event' : 'events'} this week{headlineCity ? ' near you' : ''}
          </Txt>
        ) : null}
      </FadeIn>

      {/* Search, with filters one tap away */}
      <View style={styles.searchRow}>
        <Pressable accessibilityRole="search" accessibilityLabel="Search events" onPress={() => router.push('/search')} style={({ pressed }) => [styles.fakeSearch, pressed && { borderColor: colors.text }]}>
          <Icon name="search" size={19} color={colors.muted} />
          <Txt color={colors.dim} numberOfLines={1} style={{ flex: 1 }}>
            Artists, events, venues
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={() => browse({ filters: '1' })}
          style={({ pressed }) => [styles.filterBtn, pressed && { borderColor: colors.text }]}>
          <Icon name="sliders" size={19} color={colors.text} />
        </Pressable>
      </View>

      {/* When: straight to results */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.whenRow}>
        {WHEN_PILLS.map((w) => (
          <Pressable
            key={w.id}
            accessibilityRole="button"
            onPress={() => {
              haptic.tap();
              browse({ date: w.id, ...(place?.city && place.source !== 'precise' ? { country: place.country, city: place.city } : place ? { country: place.country } : {}) });
            }}
            style={({ pressed }) => [styles.whenPill, pressed && { backgroundColor: colors.surface2, borderColor: colors.text }]}>
            <Icon name={w.icon} size={14} color={colors.accent} />
            <Txt variant="smallStrong">{w.label}</Txt>
          </Pressable>
        ))}
      </ScrollView>

      {/* Near you */}
      <View style={{ marginTop: space.xxxl }}>
        {!ready || all.isPending ? (
          <View style={{ paddingHorizontal: gutter, gap: space.md, marginBottom: space.lg }}>
            <Skeleton height={12} width={90} />
            <Skeleton height={24} width="60%" />
          </View>
        ) : null}
        {!ready || all.isPending ? (
          <Rail events={[]} loading />
        ) : all.error && !events.length ? (
          <ErrorState message={isOffline(all.error) ? 'You’re offline. Pull down to try again when you’re back online.' : errorText(all.error)} onRetry={() => all.refetch()} />
        ) : !place || !local.length ? (
          <View style={{ paddingHorizontal: gutter }}>
            <View style={styles.invite}>
              <View style={styles.inviteIcon}>
                <Icon name="pin" size={20} color={colors.accentInk} />
              </View>
              <Txt variant="h3">{place ? `Nothing on in ${countryName(place.country)} yet` : 'See what’s happening near you'}</Txt>
              <Txt variant="small" color={colors.muted}>
                {place ? 'Try another city, or browse what’s popular below.' : 'Share your location or pick a city, and we’ll put the closest events first.'}
              </Txt>
              <View style={{ gap: space.sm, marginTop: space.sm }}>
                <Button label={locating ? 'Finding you…' : 'Use my precise location'} icon="locate" loading={locating} size="md" onPress={usePrecise} />
                <Button label="Pick a city" variant="ghost" size="md" onPress={() => router.push('/place')} />
              </View>
              {locError ? <Notice tone="warning">{locError}</Notice> : null}
            </View>
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: gutter }}>
              <SectionHeader
                eyebrow="Near you"
                title={`Happening in ${whereName}`}
                action={local.length > SHOW || local.length > 1 ? 'See all' : undefined}
                onAction={() => browse(place.city && inCity.length && place.source !== 'precise' ? { country: place.country, city: place.city } : { country: place.country })}
              />
              <Txt variant="small" color={colors.muted} style={{ marginTop: -space.sm, marginBottom: space.lg }}>
                {`${local.length} upcoming event${local.length === 1 ? '' : 's'}`}
                {inCity.length && place.city && local.length > inCity.length ? ` in ${place.city} and around ${countryName(place.country)}` : ''}
                {nearest !== null ? ` · nearest ${distanceLabel(nearest).replace(' away', '')} from you` : ''}
                {place.source === 'guess' ? ' · based on your connection' : ''}
              </Txt>
            </View>
            <Rail events={shown.map((r) => r.event)} distances={distances} />
            {locError ? (
              <View style={{ paddingHorizontal: gutter, marginTop: space.md }}>
                <Notice tone="warning">{locError}</Notice>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Categories */}
      <View style={{ marginTop: space.xxxl, paddingHorizontal: gutter }}>
        <SectionHeader eyebrow="Browse" title="What are you into?" />
        <View style={styles.cats}>
          {BROWSE_CATEGORIES.map((c) => (
            <Chip key={c} label={CATEGORY_NAME[c]} onPress={() => router.push({ pathname: '/category/[category]', params: { category: c } })} />
          ))}
        </View>
      </View>

      {/* Cities */}
      {cities.length > 1 ? (
        <View style={{ marginTop: space.xxxl }}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader eyebrow="Places" title="Browse by city" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: gutter }}>
            {cities.map((c) => (
              <Chip
                key={`${c.country}-${c.city}`}
                label={`${flag(c.country)} ${cityOnly(c.city)} · ${c.n}`}
                accessibilityLabel={`${cityOnly(c.city)}, ${c.n} events`}
                onPress={() => router.push({ pathname: '/city/[city]', params: { city: c.city, country: c.country } })}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* This weekend */}
      {weekend.isPending || (weekend.data?.items.length ?? 0) > 0 ? (
        <View style={{ marginTop: space.xxxl }}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader eyebrow="Plans sorted" title="This weekend" action="See all" onAction={() => browse({ date: 'weekend' })} />
          </View>
          <Rail events={weekend.data?.items ?? []} loading={weekend.isPending} />
        </View>
      ) : null}

      {/* Coming up */}
      {railLoading || comingUp.length ? (
        <View style={{ marginTop: space.xxxl }}>
          <View style={{ paddingHorizontal: gutter }}>
            {trending ? (
              <SectionHeader eyebrow="Trending" title="Popular right now" action="See all" onAction={() => browse({ sort: 'popular' })} />
            ) : (
              <SectionHeader eyebrow="Coming up" title="On sale now" action="See all" onAction={() => browse({})} />
            )}
          </View>
          <Rail events={comingUp} loading={railLoading} />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: gutter, marginTop: space.xxxl }}>
        <Notice tone="plain" icon="shield" title="Covered by the Eventro Guarantee">
          If an event is cancelled, you get your money back. Prices include fees, always.
        </Notice>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, gap: space.md, minHeight: 44 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  locChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 38,
    paddingLeft: 11,
    paddingRight: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.surface,
    flexShrink: 1,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: gutter, marginTop: space.xl },
  filterBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  whenRow: { gap: space.sm, paddingHorizontal: gutter, paddingTop: space.md },
  whenPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, backgroundColor: 'rgba(26,18,20,0.7)' },
  fakeSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.surface,
  },
  invite: { gap: space.sm, padding: space.xl, borderRadius: radius.panel, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  inviteIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
