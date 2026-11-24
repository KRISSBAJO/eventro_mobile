/** Search: text with debounce, categories, place, dates, price and sort, with paged results. */
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactCardSkeleton, CompactEventCard } from '@/components/event-card';
import { Icon } from '@/components/icons';
import { OptionSheet, type SheetOption } from '@/components/option-sheet';
import { Chip, EmptyState, ErrorState, focusRing, NO_OUTLINE, Txt } from '@/components/ui';
import { errorText, isOffline } from '@/lib/api';
import { BROWSE_CATEGORIES, CATEGORY_NAME, DATE_RANGES, currencyForCountry, currencySymbol, flag, num, type DateRange } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { placeOptions, usePlace } from '@/lib/place';
import { NO_FILTERS, useAllEvents, useEventSearch, type SearchFilters } from '@/lib/queries';
import type { Category } from '@/lib/types';
import { colors, gutter, radius, space, type } from '@/theme';

type Sheet = 'country' | 'city' | 'date' | 'price' | 'sort' | null;

const SORTS: SheetOption<SearchFilters['sort']>[] = [
  { value: 'date', label: 'Soonest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'popular', label: 'Trending' },
];

/**
 * Price steps in whole units of the visitor's currency. The API converts every event's price into that currency
 * (approximately) before comparing, so a naira show and a dollar show can be filtered together.
 */
const PRICE_STEPS: Record<string, number[]> = {
  NGN: [5000, 10000, 25000, 50000],
  KES: [1000, 2500, 5000, 10000],
  GHS: [100, 250, 500, 1000],
  ZAR: [200, 500, 1000, 2000],
};
const SORT_VALUES = SORTS.map((s) => s.value);

export default function Search() {
  const insets = useSafeAreaInsets();
  // `at` makes each visit from Discover distinct, so tapping the same chip twice still resets the filters.
  const p = useLocalSearchParams<{ category?: string; country?: string; city?: string; date?: string; q?: string; sort?: string; at?: string }>();
  const { place } = usePlace();
  const visitorCurrency = currencyForCountry(place?.country);
  const [f, setF] = useState<SearchFilters>(NO_FILTERS);
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [typing, setTyping] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  // Arriving from Discover (a category chip, "See all"): start from those filters (adjusting state while rendering).
  const paramKey = JSON.stringify(p);
  const [seenParams, setSeenParams] = useState('{}');
  if (paramKey !== seenParams) {
    setSeenParams(paramKey);
    if (p.at || p.category || p.country || p.date || p.q) {
      setF({
        ...NO_FILTERS,
        category: BROWSE_CATEGORIES.includes(p.category as Category) || p.category === 'OTHER' ? (p.category as Category) : '',
        country: p.country ?? '',
        city: p.city ?? '',
        date: DATE_RANGES.some((d) => d.id === p.date) ? (p.date as DateRange) : 'any',
        q: p.q ?? '',
        sort: SORT_VALUES.includes(p.sort as SearchFilters['sort']) ? (p.sort as SearchFilters['sort']) : 'date',
      });
      setText(p.q ?? '');
    }
  }

  // Debounce typing.
  useEffect(() => {
    const t = setTimeout(() => setF((cur) => (cur.q === text ? cur : { ...cur, q: text })), 300);
    return () => clearTimeout(t);
  }, [text]);

  const search = useEventSearch(f);
  const all = useAllEvents();
  const places = placeOptions(all.data?.items ?? []);
  const country = places.find((c) => c.code === f.country);
  // Prices are picked in the visitor's currency; a chosen limit keeps the currency it was picked in.
  const steps = PRICE_STEPS[visitorCurrency] ?? [25, 50, 100, 200];
  const sym = currencySymbol(visitorCurrency);
  const limitLabel = f.maxPrice !== null ? `Under ${currencySymbol(f.currency)}${num(f.maxPrice)}` : 'Any price';

  const items = search.data?.pages.flatMap((p) => p.items) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;
  const set = (patch: Partial<SearchFilters>) => setF((cur) => ({ ...cur, ...patch }));
  const active = !!(f.q || f.category || f.country || f.date !== 'any' || f.maxPrice !== null || f.sort !== 'date');
  const clearAll = () => {
    haptic.select();
    setF(NO_FILTERS);
    setText('');
  };

  const dateLabel = DATE_RANGES.find((d) => d.id === f.date)?.label ?? 'Any date';
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" active={!f.category} onPress={() => set({ category: '' })} />
        {BROWSE_CATEGORIES.map((c) => (
          <Chip key={c} label={CATEGORY_NAME[c]} active={f.category === c} onPress={() => set({ category: f.category === c ? '' : c })} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Filter label={country ? `${flag(country.code)} ${country.name}` : 'Anywhere'} on={!!f.country} onPress={() => setSheet('country')} />
        {country ? <Filter label={f.city || 'Any city'} on={!!f.city} onPress={() => setSheet('city')} /> : null}
        <Filter label={dateLabel} on={f.date !== 'any'} onPress={() => setSheet('date')} />
        <Filter label={limitLabel} on={f.maxPrice !== null} onPress={() => setSheet('price')} />
        <Filter label={SORTS.find((s) => s.value === f.sort)!.label} on={f.sort !== 'date'} onPress={() => setSheet('sort')} icon="sliders" />
      </ScrollView>
      <View style={styles.countRow}>
        <Txt variant="smallStrong" accessibilityLiveRegion="polite" numberOfLines={1} style={{ flexShrink: 1 }}>
          {search.isPending ? 'Searching…' : `${total} event${total === 1 ? '' : 's'}`}
          {search.isPending ? null : (
            <Txt variant="small" color={colors.muted}>
              {' · '}
              {f.city ? `in ${f.city}` : f.country ? `in ${country?.name ?? f.country}` : 'everywhere'}
            </Txt>
          )}
        </Txt>
        {active ? (
          <Pressable accessibilityRole="button" onPress={clearAll} hitSlop={10}>
            <Txt variant="smallStrong" color={colors.accent}>
              Clear all
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.md }}>
      {/* Warm glow behind the top of the screen, like Discover */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,77,61,0.16)', 'rgba(255,120,80,0.04)', 'rgba(15,10,11,0)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={[styles.glow, { height: insets.top + 260 }]}
      />
      <View style={{ paddingHorizontal: gutter, gap: space.lg, paddingBottom: space.md }}>
        <Txt variant="h1" accessibilityRole="header">
          Search
        </Txt>
        <View style={[styles.searchBox, typing && focusRing]}>
          <Icon name="search" size={19} color={colors.muted} />
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            placeholder="Artists, events, venues, cities"
            placeholderTextColor={colors.dim}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search events"
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            style={styles.searchInput}
          />
          {text ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={() => {
                setText('');
                input.current?.focus();
              }}>
              <Icon name="close" size={18} color={colors.muted} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sort results"
              hitSlop={10}
              onPress={() => {
                haptic.select();
                setSheet('sort');
              }}>
              <Icon name="sliders" size={18} color={f.sort !== 'date' ? colors.accent : colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={search.isPending ? [] : items}
        keyExtractor={(e) => e.slug}
        renderItem={({ item }) => <CompactEventCard e={item} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: gutter - space.sm, paddingBottom: space.huge }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={search.isRefetching && !search.isFetchingNextPage} onRefresh={() => void search.refetch()} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface} />}
        ListEmptyComponent={
          search.isPending ? (
            <View style={{ gap: space.xs }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <CompactCardSkeleton key={i} />
              ))}
            </View>
          ) : search.error ? (
            <ErrorState message={isOffline(search.error) ? 'You’re offline. Try again when you’re back online.' : errorText(search.error)} onRetry={() => search.refetch()} />
          ) : (
            <EmptyState
              icon="search"
              title="No results"
              body={active ? 'Nothing matches those filters. Try a wider date range, another city or fewer filters.' : 'No events are on sale right now. Check back soon.'}
              action={active ? 'Clear filters' : undefined}
              onAction={clearAll}
            />
          )
        }
        ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={{ marginVertical: space.xl }} /> : undefined}
      />

      <OptionSheet
        visible={sheet === 'country'}
        title="Where"
        value={f.country}
        options={[{ value: '', label: 'Anywhere' }, ...places.map((c) => ({ value: c.code, label: `${flag(c.code)}  ${c.name}`, detail: String(c.total) }))]}
        onPick={(v) => set({ country: v, city: '' })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'city'}
        title={country ? `Cities in ${country.name}` : 'City'}
        value={f.city}
        options={[{ value: '', label: 'Any city' }, ...(country?.cities ?? []).map(([c, n]) => ({ value: c, label: c, detail: String(n) }))]}
        onPick={(v) => set({ city: v })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet visible={sheet === 'date'} title="When" value={f.date} options={DATE_RANGES.map((d) => ({ value: d.id, label: d.label }))} onPick={(v) => set({ date: v })} onClose={() => setSheet(null)} />
      <OptionSheet
        visible={sheet === 'price'}
        title={`Price (lowest ticket, all-in, in ${visitorCurrency})`}
        value={f.currency === visitorCurrency ? f.maxPrice : null}
        options={[{ value: null, label: 'Any price' }, ...steps.map((n) => ({ value: n, label: `Under ${sym}${num(n)}` }))]}
        onPick={(v) => set({ maxPrice: v, currency: visitorCurrency })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet visible={sheet === 'sort'} title="Sort by" value={f.sort} options={SORTS} onPick={(v) => set({ sort: v })} onClose={() => setSheet(null)} />
    </View>
  );
}

function Filter({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: 'sliders' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change`}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.filter, on && styles.filterOn, pressed && { opacity: 0.8 }]}>
      {icon ? <Icon name={icon} size={15} color={on ? colors.accent : colors.muted} /> : null}
      <Txt variant="smallStrong" color={on ? colors.accentHi : colors.text} numberOfLines={1}>
        {label}
      </Txt>
      <Icon name="chevronDown" size={14} color={on ? colors.accent : colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', top: 0, left: 0, right: 0 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.fieldLine,
    backgroundColor: colors.field,
  },
  searchInput: { flex: 1, height: 50, color: colors.text, ...type.body, lineHeight: undefined, outlineWidth: 0, ...NO_OUTLINE },
  chips: { gap: space.sm, paddingHorizontal: space.sm },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  filterOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 24 },
});
