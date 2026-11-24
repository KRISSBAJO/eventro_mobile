/**
 * A listing of events with a fixed base filter (a category or a city), using Search's query and filters:
 * date chips, sort, paging and pull to refresh, with "More filters" handing over to the Search tab.
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactCardSkeleton, CompactEventCard } from './event-card';
import { Icon } from './icons';
import { OptionSheet, type SheetOption } from './option-sheet';
import { ScreenHeader } from './screen-header';
import { Chip, EmptyState, ErrorState, Txt } from './ui';
import { errorText, isOffline } from '@/lib/api';
import { DATE_RANGES } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { NO_FILTERS, useEventSearch, type SearchFilters } from '@/lib/queries';
import { colors, gutter, radius, space } from '@/theme';

const SORTS: SheetOption<SearchFilters['sort']>[] = [
  { value: 'date', label: 'Soonest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'popular', label: 'Trending' },
];

export function EventListScreen({ title, eyebrow, base, intro, emptyBody }: { title: string; eyebrow?: string; base: Partial<SearchFilters>; intro?: ReactNode; emptyBody: string }) {
  const insets = useSafeAreaInsets();
  const [extra, setExtra] = useState<Pick<SearchFilters, 'date' | 'sort'>>({ date: 'any', sort: 'date' });
  const [sortOpen, setSortOpen] = useState(false);
  const f: SearchFilters = { ...NO_FILTERS, ...base, ...extra };
  const search = useEventSearch(f);
  const items = search.data?.pages.flatMap((p) => p.items) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;

  const moreFilters = () => {
    haptic.select();
    router.navigate({
      pathname: '/search',
      params: { ...(f.category ? { category: f.category } : {}), ...(f.country ? { country: f.country } : {}), ...(f.city ? { city: f.city } : {}), date: f.date, sort: f.sort, at: String(Date.now()) },
    });
  };

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <View style={{ paddingHorizontal: space.sm }}>
        <ScreenHeader title={title} eyebrow={eyebrow} />
      </View>
      {intro ? <View style={{ paddingHorizontal: space.sm }}>{intro}</View> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.sm }}>
        {DATE_RANGES.map((d) => (
          <Chip key={d.id} label={d.label} active={extra.date === d.id} onPress={() => setExtra((x) => ({ ...x, date: d.id }))} />
        ))}
      </ScrollView>
      <View style={styles.countRow}>
        <Txt variant="smallStrong" color={colors.muted} accessibilityLiveRegion="polite" style={{ flex: 1 }}>
          {search.isPending ? 'Loading…' : `${total} event${total === 1 ? '' : 's'}`}
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={`Sort: ${SORTS.find((s) => s.value === f.sort)!.label}. Change`} onPress={() => setSortOpen(true)} hitSlop={8} style={styles.link}>
          <Icon name="sliders" size={14} color={colors.muted} />
          <Txt variant="smallStrong" color={colors.muted}>
            {SORTS.find((s) => s.value === f.sort)!.label}
          </Txt>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={moreFilters} hitSlop={8} style={styles.link}>
          <Txt variant="smallStrong" color={colors.accent}>
            More filters
          </Txt>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
      <FlatList
        data={search.isPending ? [] : items}
        keyExtractor={(e) => e.slug}
        renderItem={({ item }) => <CompactEventCard e={item} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: gutter - space.sm, paddingBottom: insets.bottom + space.huge }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={search.isRefetching && !search.isFetchingNextPage} onRefresh={() => void search.refetch()} tintColor={colors.accent} />}
        ListEmptyComponent={
          search.isPending ? (
            <View style={{ gap: space.xs }}>
              {[0, 1, 2, 3].map((i) => (
                <CompactCardSkeleton key={i} />
              ))}
            </View>
          ) : search.error ? (
            <ErrorState message={isOffline(search.error) ? 'You’re offline. Try again when you’re back online.' : errorText(search.error)} onRetry={() => search.refetch()} />
          ) : (
            <EmptyState
              icon="calendar"
              title="Nothing on yet"
              body={extra.date !== 'any' ? 'Nothing on in those dates. Try any date.' : emptyBody}
              action={extra.date !== 'any' ? 'Any date' : 'Browse all events'}
              onAction={() => (extra.date !== 'any' ? setExtra((x) => ({ ...x, date: 'any' })) : router.navigate('/search'))}
            />
          )
        }
        ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={{ marginVertical: space.xl }} /> : undefined}
      />
      <OptionSheet visible={sortOpen} title="Sort by" value={f.sort} options={SORTS} onPick={(v) => setExtra((x) => ({ ...x, sort: v }))} onClose={() => setSortOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  countRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.sm, minHeight: 28 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, borderRadius: radius.pill },
});
