/**
 * An organizer's page (GET /organizers/:slug): who they are, Follow, and what they have on sale. Opened from
 * "Presented by" on an event and from Following.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactEventCard } from '@/components/event-card';
import { FollowButton } from '@/components/follow-button';
import { Badge, Button, EmptyState, ErrorState, FadeIn, IconButton, Skeleton, Txt } from '@/components/ui';
import { ApiError, errorText } from '@/lib/api';
import { initials, useOrganizer } from '@/lib/following';
import { num } from '@/lib/format';
import { colors, gutter, space } from '@/theme';

const HERO = 220;

export default function OrganizerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const q = useOrganizer(slug);
  const o = q.data;
  const back = <IconButton icon="back" label="Back" glass onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ position: 'absolute', top: insets.top + space.sm, left: gutter - 4 }} />;

  if (q.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Skeleton height={HERO} radius={0} />
        <View style={{ padding: gutter, gap: space.md }}>
          <Skeleton height={30} width="70%" />
          <Skeleton height={16} width="40%" />
          <Skeleton height={120} />
        </View>
        {back}
      </View>
    );
  }
  if (q.error || !o) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {q.error instanceof ApiError && q.error.status === 404 ? <EmptyState icon="users" title="Organizer not found" body="They may not have anything on Omoshow right now." /> : <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />}
        {back}
      </View>
    );
  }

  // Their banner when they set one (sharp); else their next event's cover, blurred behind the page.
  const banner = o.coverUrl && o.coverUrl !== o.events.find((e) => e.imageUrl)?.imageUrl ? o.coverUrl : null;
  const cover = banner ?? o.events.find((e) => e.imageUrl)?.imageUrl;
  const stats = [`${num(o.followers)} ${o.followers === 1 ? 'follower' : 'followers'}`, `${num(o.eventsHosted)} ${o.eventsHosted === 1 ? 'event' : 'events'} on Omoshow`].join(' · ');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}>
        <View style={{ height: HERO, backgroundColor: colors.surface }}>
          {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} blurRadius={banner ? 0 : 18} /> : <LinearGradient colors={['rgba(255,77,61,0.28)', colors.bg]} style={StyleSheet.absoluteFill} />}
          <LinearGradient colors={['rgba(0,0,0,0.45)', colors.fade0, colors.bg]} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
        </View>
        <FadeIn style={{ paddingHorizontal: gutter, marginTop: -64, gap: space.sm }}>
          <View style={styles.mark}>
            {o.logoUrl ? (
              <Image source={{ uri: o.logoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : (
              <Txt variant="h2" style={{ letterSpacing: -0.5 }}>
                {initials(o.name)}
              </Txt>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Badge label="Organizer" tone="glass" />
            {o.verified ? <Badge label="Verified" tone="success" /> : null}
          </View>
          <Txt variant="h1" accessibilityRole="header">
            {o.name}
          </Txt>
          <Txt color={colors.muted}>{stats}</Txt>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <FollowButton kind="organizers" slug={o.slug} name={o.name} size="md" />
            {o.website ? (
              <Button label="Website" icon="external" variant="ghost" size="md" onPress={() => void WebBrowser.openBrowserAsync(o.website!, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined)} />
            ) : null}
          </View>
        </FadeIn>

        <View style={{ paddingHorizontal: gutter, marginTop: space.xl, gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Txt variant="h3" accessibilityRole="header">
              Coming up
            </Txt>
            {o.events.length ? (
              <View style={{ marginHorizontal: -space.sm }}>
                {o.events.map((e) => (
                  <CompactEventCard key={e.slug} e={e} />
                ))}
              </View>
            ) : (
              <EmptyState compact icon="bell" title="Nothing on sale right now" body={`Follow ${o.name} and we’ll tell you when something is.`} />
            )}
          </View>
          {o.about ? (
            <View style={{ gap: space.sm }}>
              <Txt variant="h3" accessibilityRole="header">
                About
              </Txt>
              <Txt color={colors.muted}>{o.about}</Txt>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {back}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 72, height: 72, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2 },
});
