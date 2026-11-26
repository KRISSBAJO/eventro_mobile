/**
 * Account → Following: the organizers and venues a fan follows (a row of photo cards to open their pages: a venue's photo, or an organizer's next event cover), then their
 * events on sale, soonest first (GET /me/following).
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactEventCard } from '@/components/event-card';
import { Icon } from '@/components/icons';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyState, ErrorState, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFollowing, type Followed } from '@/lib/following';
import { colors, gutter, radius, space } from '@/theme';

export default function FollowingScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useFollowing(user?.id);
  const [pulling, setPulling] = useState(false);
  const who: (Followed & { kind: 'organizer' | 'venue'; href: () => void; sub: string })[] = [
    ...(q.data?.organizers ?? []).map((o) => ({ ...o, kind: 'organizer' as const, sub: 'Organizer', href: () => router.push({ pathname: '/organizers/[slug]', params: { slug: o.slug } }) })),
    ...(q.data?.venues ?? []).map((v) => ({ ...v, kind: 'venue' as const, sub: v.city ?? 'Venue', href: () => router.push({ pathname: '/venue/[slug]', params: { slug: v.slug } }) })),
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}>
                  {who.map((w) => (
                    <Pressable
                      key={`${w.kind}:${w.slug}`}
                      accessibilityRole="link"
                      accessibilityLabel={`${w.name}, ${w.sub}${w.upcoming ? `, ${w.upcoming} on sale` : ''}`}
                      onPress={w.href}
                      style={({ pressed }) => [styles.who, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
                    >
                      <View style={styles.pic}>
                        {w.imageUrl ? (
                          <Image source={{ uri: w.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={w.imageUrl} />
                        ) : (
                          <Icon name={w.kind === 'venue' ? 'building' : 'mic'} size={26} color={colors.dim} />
                        )}
                      </View>
                      <View style={{ gap: 2 }}>
                        <View style={styles.nameRow}>
                          {w.logoUrl ? <Image source={{ uri: w.logoUrl }} style={styles.logo} contentFit="cover" /> : null}
                          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                            {w.name}
                          </Txt>
                          {w.verified ? <Icon name="check" size={13} color={colors.success} /> : null}
                        </View>
                        <Txt variant="small" color={colors.muted} numberOfLines={1}>
                          {w.upcoming ? `${w.sub} · ${w.upcoming} on sale` : w.sub}
                        </Txt>
                      </View>
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
  who: { width: 150, gap: space.sm },
  pic: { width: 150, height: 112, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logo: { width: 20, height: 20, borderRadius: 6, backgroundColor: colors.surface2 },
});
