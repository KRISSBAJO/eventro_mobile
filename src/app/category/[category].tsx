/** A category's events (Discover's "What are you into?" and the event page's category link). */
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyState } from '@/components/ui';
import { EventListScreen } from '@/components/event-list-screen';
import { CATEGORY_NAME } from '@/lib/format';
import type { Category } from '@/lib/types';
import { colors, gutter, space } from '@/theme';

export default function CategoryScreen() {
  const { category = '' } = useLocalSearchParams<{ category: string }>();
  const insets = useSafeAreaInsets();
  const c = category.toUpperCase() as Category;
  if (!(c in CATEGORY_NAME)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm, paddingHorizontal: gutter }}>
        <ScreenHeader title="Category not found" />
        <EmptyState icon="search" title="We don’t have that category" action="Browse all events" onAction={() => router.navigate('/search')} />
      </View>
    );
  }
  return <EventListScreen key={c} title={CATEGORY_NAME[c]} eyebrow="Category" base={{ category: c }} emptyBody={`No ${CATEGORY_NAME[c].toLowerCase()} events are on sale right now. Check back soon.`} />;
}
