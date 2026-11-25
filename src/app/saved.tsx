/** Account → Saved events: the hearts, newest first (the account's when signed in, this phone's otherwise). */
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactCardSkeleton, CompactEventCard } from '@/components/event-card';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyState, ErrorState, Notice, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useSaved } from '@/lib/saved';
import { colors, gutter, space } from '@/theme';

export default function Saved() {
  const insets = useSafeAreaInsets();
  const saved = useSaved();
  const [pulling, setPulling] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
      <FlatList
        data={saved.loading ? [] : saved.items}
        keyExtractor={(e) => e.slug}
        renderItem={({ item }) => <CompactEventCard e={item} />}
        contentContainerStyle={{ paddingHorizontal: gutter - space.sm, paddingBottom: insets.bottom + space.huge }}
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
          <View style={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.md }}>
            <ScreenHeader title="Saved events" fallback="/account" />
            {!saved.signedIn ? (
              <Notice tone="plain" icon="heart" title="Saved on this phone only" action="Sign in to keep them everywhere" onAction={() => router.push('/sign-in')}>
                Sign in and your hearts move into your account, so they show up on the website and your other devices too.
              </Notice>
            ) : saved.items.length ? (
              <Txt variant="small" color={colors.muted}>
                {saved.items.length} saved · the same list as on the Omoshow website
              </Txt>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          saved.loading ? (
            <View style={{ gap: space.xs }}>
              {[0, 1, 2].map((i) => (
                <CompactCardSkeleton key={i} />
              ))}
            </View>
          ) : saved.error ? (
            <ErrorState message={errorText(saved.error)} onRetry={() => void saved.refetch()} />
          ) : (
            <EmptyState
              icon="heart"
              title="Nothing saved yet"
              body="Tap the heart on any event to keep it here. Events that have happened, or are no longer on sale, drop off."
              action="Find events"
              onAction={() => router.navigate('/search')}
            />
          )
        }
      />
    </View>
  );
}
