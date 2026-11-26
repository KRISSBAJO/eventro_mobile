/**
 * Discover, kept clean: where you are and one search field first, a few "when" chips, then the same pattern repeated
 * (a title, "See all", a row of event cards): near you, this weekend, popular, plus categories and cities as chips.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Logo, type IconName } from '@/components/icons';
import { WideCardSkeleton, WideEventCard } from '@/components/event-card';
import { Rail } from '@/components/rail';
import { Chip, ErrorState, FadeIn, focusRing, SectionHeader, Skeleton, Txt } from '@/components/ui';
import { errorText, isOffline } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFollowing } from '@/lib/following';
import { BROWSE_CATEGORIES, CATEGORY_NAME, cityOnly, countryName } from '@/lib/format';
import { openGuaranteeTerms } from '@/lib/guarantee';
import { availableSamples, SampleEvents } from '@/components/sample-events';
import { placeLabel, placeOptions, rankNear, usePlace } from '@/lib/place';
import { useAllEvents, useEventsBetween, useEventsNear, useJustAnnounced, useLastMinute, useTrendingEvents } from '@/lib/queries';
import { colors, gutter, radius, space } from '@/theme';

const SHOW = 8;

/** Quick "when" chips under the search: each opens Search with that date range. */
const WHEN_PILLS = [
  { id: 'today', label: 'Tonight' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
] as const;

/** Each browse category's icon (drawn in the text colour). */
const CATEGORY_ICON: Partial<Record<string, IconName>> = {
  CONCERTS: 'music',
  SPORTS: 'trophy',
  COMEDY: 'smile',
  THEATER: 'mask',
  FESTIVALS: 'flag',
  FAMILY: 'users',
  FAITH: 'sun',
  NIGHTLIFE: 'moon',
  FOOD: 'food',
  CONFERENCE: 'mic',
};

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
  const { place, ready } = usePlace();
  const all = useAllEvents();
  const near = useEventsNear(place?.lat, place?.lng);
  const weekend = useEventsBetween('weekend');
  const popular = useTrendingEvents();
  const lastMinute = useLastMinute();
  const announced = useJustAnnounced();
  const following = useFollowing(user?.id);
  const followed = following.data?.events ?? [];
  const [refreshing, setRefreshing] = useState(false);
  const events = all.data?.items ?? [];
  const samples = rankNear(availableSamples(events), place).map(r => r.event);
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
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([all.refetch(), weekend.refetch(), popular.refetch(), lastMinute.refetch(), announced.refetch(), place?.lat !== undefined ? near.refetch() : null]);
    setRefreshing(false);
  };

  const soonItems = lastMinute.data?.items ?? [];
  const soonSlugs = new Set(soonItems.map((e) => e.slug));
  const weekendItems = (weekend.data?.items ?? []).filter((e) => !soonSlugs.has(e.slug));

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
      {/* The logo and you, then where you are */}
      <View style={styles.header}>
        <Logo size={28} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={user ? 'Your account' : 'Sign in'}
          onPress={() => router.navigate(user ? '/account' : '/sign-in')}
          hitSlop={6}
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}>
          {user ? <Txt variant="smallStrong">{initialsOf(user.name)}</Txt> : <Icon name="user" size={18} color={colors.text} />}
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Location: ${placeLabel(place)}. Change location`}
        onPress={() => router.push('/place')}
        hitSlop={8}
        style={({ pressed }) => [styles.place, pressed && { opacity: 0.6 }]}>
        <Icon name={place?.source === 'precise' ? 'locate' : 'pin'} size={18} color={colors.text} />
        <Txt variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>
          {!ready ? '…' : !place ? 'Choose a city' : place.city ? cityOnly(place.city) : place.source === 'precise' ? 'Near you' : countryName(place.country)}
        </Txt>
        <Icon name="chevronDown" size={16} color={colors.text} />
      </Pressable>

      {/* One search field, filters inside it */}
      <View style={styles.search}>
        <Pressable accessibilityRole="search" accessibilityLabel="Search events" onPress={() => router.push('/search')} style={styles.searchTap}>
          <Icon name="search" size={20} color={colors.text} />
          <Txt color={colors.dim} numberOfLines={1} style={{ flex: 1 }}>
            Find things to do
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={() => browse({ filters: '1' })}
          hitSlop={4}
          style={({ pressed }) => [styles.filterBtn, pressed && focusRing]}>
          <Icon name="sliders" size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* When: straight to results */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.whenRow}>
        {WHEN_PILLS.map((w) => (
          <Chip
            key={w.id}
            label={w.label}
            onPress={() => browse({ date: w.id, ...(place?.city && place.source !== 'precise' ? { country: place.country, city: place.city } : place ? { country: place.country } : {}) })}
          />
        ))}
      </ScrollView>

      {/* Near you */}
      <View style={!ready || all.isPending || all.error || (place && local.length) ? styles.section : undefined}>
        {!ready || all.isPending ? (
          <>
            <View style={{ paddingHorizontal: gutter, marginBottom: space.md }}>
              <Skeleton height={22} width="55%" />
            </View>
            <Rail events={[]} loading />
          </>
        ) : all.error && !events.length ? (
          <ErrorState message={isOffline(all.error) ? 'You’re offline. Pull down to try again when you’re back online.' : errorText(all.error)} onRetry={() => all.refetch()} />
        ) : !place || !local.length ? null : (
          <>
            <View style={{ paddingHorizontal: gutter }}>
              <SectionHeader
                title={`Near you in ${whereName}`}
                action={local.length > 1 ? 'See all' : undefined}
                onAction={() => browse(place.city && inCity.length && place.source !== 'precise' ? { country: place.country, city: place.city } : { country: place.country })}
              />
            </View>
            <Rail events={shown.map((r) => r.event)} distances={distances} />
          </>
        )}
      </View>

      <SampleEvents events={samples} />

      {/* Last minute: on in the next three days. The three soonest as big cards, the rest behind See all. */}
      {lastMinute.isPending || soonItems.length ? (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader title="Last minute" action="See all" onAction={() => browse({ date: 'soon' })} />
          </View>
          <View style={{ paddingHorizontal: gutter, gap: space.xl }}>
            {lastMinute.isPending ? (
              <WideCardSkeleton />
            ) : (
              soonItems.slice(0, 3).map((e, i) => (
                <FadeIn key={e.slug} delay={i * 60}>
                  <WideEventCard e={e} />
                </FadeIn>
              ))
            )}
            {soonItems.length > 3 ? (
              <Pressable accessibilityRole="link" onPress={() => browse({ date: 'soon' })} style={({ pressed }) => [styles.more, pressed && { opacity: 0.7 }]}>
                <Txt variant="bodyStrong">See all {soonItems.length} last-minute events</Txt>
                <Icon name="arrowRight" size={18} color={colors.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* From organizers and venues the fan follows */}
      {followed.length ? (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader title="From who you follow" action="See all" onAction={() => router.push('/following')} />
          </View>
          <Rail events={followed.slice(0, 12)} />
        </View>
      ) : null}

      {/* Just announced: on sale in the last two weeks */}
      {announced.items.length ? (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader title="Just announced" action="See all" onAction={() => browse({ sort: 'new' })} />
          </View>
          <Rail events={announced.items} />
        </View>
      ) : null}

      {/* This weekend (what Last minute doesn't already show) */}
      {weekend.isPending || weekendItems.length ? (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader title="This weekend" action="See all" onAction={() => browse({ date: 'weekend' })} />
          </View>
          <Rail events={weekendItems} loading={weekend.isPending} />
        </View>
      ) : null}

      {/* Categories */}
      <View style={styles.section}>
        <View style={{ paddingHorizontal: gutter }}>
          <SectionHeader title="Browse by category" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {BROWSE_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={CATEGORY_NAME[c]}
              icon={CATEGORY_ICON[c] ?? 'tag'}
              onPress={() => router.push({ pathname: '/category/[category]', params: { category: c } })}
            />
          ))}
        </ScrollView>
      </View>

      {/* Popular / on sale */}
      {railLoading || comingUp.length ? (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: gutter }}>
            {trending ? (
              <SectionHeader title="Popular right now" action="See all" onAction={() => browse({ sort: 'popular' })} />
            ) : (
              <SectionHeader title="On sale now" action="See all" onAction={() => browse({})} />
            )}
          </View>
          <Rail events={comingUp} loading={railLoading} />
        </View>
      ) : null}

      {/* Cities */}
      {cities.length > 1 ? (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: gutter }}>
            <SectionHeader title="Cities" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {cities.map((c) => (
              <Chip
                key={`${c.country}-${c.city}`}
                label={cityOnly(c.city)}
                accessibilityLabel={`${cityOnly(c.city)}, ${c.n} events`}
                onPress={() => router.push({ pathname: '/city/[city]', params: { city: c.city, country: c.country } })}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={[styles.section, { paddingHorizontal: gutter }]}>
        <GuaranteeRow />
      </View>
    </ScrollView>
  );
}

/** The Omoshow Guarantee as one quiet row; the tap opens the full terms (comps, donations, timing). */
function GuaranteeRow() {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Omoshow Guarantee: ticket doesn’t scan? Money back, fees included. Full refund if the event is cancelled. Opens the full terms."
      onPress={openGuaranteeTerms}
      style={({ pressed }) => [styles.promise, pressed && { opacity: 0.7 }]}>
      <Icon name="shield" size={22} color={colors.text} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="title">Doesn’t scan? Money back.</Txt>
        <Txt variant="small" color={colors.muted}>
          The Omoshow Guarantee, fees included
        </Txt>
      </View>
      <Icon name="chevronRight" size={18} color={colors.dim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, height: 50, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, gap: space.md, minHeight: 48 },
  place: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: space.md, marginHorizontal: gutter },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 56,
    marginHorizontal: gutter,
    marginTop: space.lg,
    paddingLeft: space.lg,
    paddingRight: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.field,
  },
  searchTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'stretch' },
  filterBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  whenRow: { gap: space.sm, paddingHorizontal: gutter, paddingTop: space.md },
  chipRow: { gap: space.sm, paddingHorizontal: gutter },
  section: { marginTop: space.xxxl + space.sm },
  promise: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line2 },
});
