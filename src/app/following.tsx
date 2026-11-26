/**
 * Account → Following: the organizers and venues a fan follows (a row of marks to open their pages), then their
 * events on sale, soonest first (GET /me/following).
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactEventCard } from '@/components/event-card';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyState, ErrorState, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { initials, useFollowing, type Followed } from '@/lib/following';
import { colors, gutter, space } from '@/theme';

export default function FollowingScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useFollowing(user?.id);
  const [pulling, setPulling] = useState(false);
  const who: (Followed & { href: () => void; sub: string })[] = [
    ...(q.data?.organizers ?? []).map((o) => ({ ...o, sub: 'Organizer', href: () => router.push({ pathname: '/organizers/[slug]', params: { slug: o.slug } }) })),
    ...(q.data?.venues ?? []).map((v) => ({ ...v, sub: v.city ?? 'Venue', href: () => router.push({ pathname: '/venue/[slug]', params: { slug: v.slug } }) })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
      <FlatList
        data={q.data?.events ?? []}
        keyExtractor={(e) => e.slug}
        renderItem={({ item }) => (
          <View style={{ marginHorizontal: -space.sm }}>
            <CompactEventCard e={item} />
          </View>
        )}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge }}
        refreshControl={
          user ? (
            <RefreshControl
              refreshing={pulling}
              onRefresh={async () => {
                setPulling(true);
                await q.refetch();
                setPulling(false);
              }}
              tintColor={colors.accent}
            />
          ) : undefined
        }
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingBottom: space.md }}>
            <ScreenHeader title="Following" fallback="/account" />
            {who.length ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.lg }}>
                  {who.map((w) => (
                    <Pressable key={`${w.sub}:${w.slug}`} accessibilityRole="link" accessibilityLabel={w.name} onPress={w.href} style={({ pressed }) => [styles.who, pressed && { opacity: 0.7 }]}>
                      <View style={styles.mark}>
                        {w.imageUrl ? <Image source={{ uri: w.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Txt variant="title">{initials(w.name)}</Txt>}
                        {w.upcoming ? (
                          <View style={styles.count}>
                            <Txt variant="tiny" color={colors.accentInk} style={{ fontWeight: '700' }}>
                              {w.upcoming}
                            </Txt>
                          </View>
                        ) : null}
                      </View>
                      <Txt variant="small" numberOfLines={1} style={{ textAlign: 'center' }}>
                        {w.name}
                      </Txt>
                    </Pressable>
                  ))}
                </ScrollView>
                {q.data?.events.length ? <Txt variant="h3">On sale now</Txt> : null}
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !user ? (
            <EmptyState icon="users" title="Sign in to follow" body="Follow organizers and venues. Their new events show up here, and we’ll tell you when one goes on sale." action="Sign in" onAction={() => router.push('/sign-in')} />
          ) : q.isPending ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={88} />
              <Skeleton height={88} />
            </View>
          ) : q.error ? (
            <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
          ) : who.length ? (
            <EmptyState compact icon="bell" title="Nothing on sale from them right now" body="We’ll tell you as soon as something is." />
          ) : (
            <EmptyState icon="users" title="Not following anyone yet" body="Tap Follow on an organizer or a venue. Their new events show up here." action="Find events" onAction={() => router.navigate('/search')} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  who: { width: 76, alignItems: 'center', gap: 6 },
  mark: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'visible', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2 },
  count: { position: 'absolute', top: -2, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.bg },
});
