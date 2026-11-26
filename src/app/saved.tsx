/**
 * Account → Saved events: the hearts, newest first (the account's when signed in, this phone's otherwise), as a
 * two-column grid of the same photo cards Discover uses.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LargeCardSkeleton, LargeEventCard } from '@/components/event-card';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyState, ErrorState, Notice } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useSaved } from '@/lib/saved';
import { colors, gutter, space } from '@/theme';

export default function Saved() {
  const insets = useSafeAreaInsets();
  const saved = useSaved();
  const [pulling, setPulling] = useState(false);
  const { width } = useWindowDimensions();
  // Two cards a row, the page's side padding outside and one gap between them.
  const cardW = Math.floor((Math.min(width, 720) - gutter * 2 - space.md) / 2);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
      <FlatList
        data={saved.loading ? [] : saved.items}
        keyExtractor={(e) => e.slug}
        numColumns={2}
        columnWrapperStyle={{ gap: space.md }}
        renderItem={({ item }) => (
          <View style={{ marginBottom: space.xl }}>
            <LargeEventCard e={item} width={cardW} />
          </View>
        )}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge }}
        refreshControl={
          saved.signedIn ? (
            <RefreshControl
              refreshing={pulling}
              onRefresh={async () => {
                setPulling(true);
                await saved.refetch();
                setPulling(false);
              }}
              tintColor={colors.accent}
            />
          ) : undefined
        }
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingBottom: space.lg }}>
            <ScreenHeader title="Saved events" fallback="/account" />
            {!saved.signedIn ? (
              <Notice tone="plain" icon="heart" title="Saved on this phone only" action="Sign in to keep them everywhere" onAction={() => router.push('/sign-in')}>
                Sign in to see them on the website and your other devices too.
              </Notice>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          saved.loading ? (
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <LargeCardSkeleton width={cardW} />
              <LargeCardSkeleton width={cardW} />
            </View>
          ) : saved.error ? (
            <ErrorState message={errorText(saved.error)} onRetry={() => void saved.refetch()} />
          ) : (
            <EmptyState
              icon="heart"
              title="Nothing saved yet"
              body="Tap the heart on any event to keep it here."
              action="Find events"
              onAction={() => router.navigate('/search')}
            />
          )
        }
      />
    </View>
  );
}
