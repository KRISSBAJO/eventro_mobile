/** A horizontal row of large event cards, with skeletons while loading. */
import { FlatList, useWindowDimensions, View } from 'react-native';
import type { EventCard } from '@/lib/types';
import { gutter, space } from '@/theme';
import { LargeCardSkeleton, LargeEventCard } from './event-card';

export const useCardWidth = () => {
  const { width } = useWindowDimensions();
  return Math.round(Math.min(300, Math.max(230, width * 0.76)));
};

export function Rail({ events, loading, distances }: { events: EventCard[]; loading?: boolean; distances?: Record<string, number | null> }) {
  const w = useCardWidth();
  const data = loading ? [] : events;
  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={(e) => e.slug}
      showsHorizontalScrollIndicator={false}
      snapToInterval={w + space.lg}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: gutter, gap: space.lg }}
      renderItem={({ item }) => <LargeEventCard e={item} width={w} distanceKm={distances?.[item.slug] ?? null} />}
      ListEmptyComponent={loading ? <SkeletonRow width={w} /> : undefined}
    />
  );
}

function SkeletonRow({ width }: { width: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.lg }}>
      <LargeCardSkeleton width={width} />
      <LargeCardSkeleton width={width} />
    </View>
  );
}
