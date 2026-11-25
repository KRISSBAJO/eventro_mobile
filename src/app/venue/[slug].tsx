/**
 * A venue (GET /venues/:slug): where it is, Open in Maps, what it's like, what's on there next and, when it's listed
 * for hire on Omoshow (`listing`), its terms and "Book this venue" (app/book-venue/[slug].tsx). At the bottom, for
 * the people who run it: "Work here? Claim this page" (app/my-venues/add.tsx), or where their request stands.
 */
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TermsCard } from '@/components/booking-ui';
import { CompactEventCard } from '@/components/event-card';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, EmptyState, ErrorState, FadeIn, IconButton, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMyVenues, type VenueRequest } from '@/lib/bookings';
import { cityOnly, countryName, flag, num } from '@/lib/format';
import { openMaps } from '@/lib/maps';
import type { EventCard, VenuePage } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const HERO = 220;

export default function VenueScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mine = useMyVenues(user?.id);
  const q = useQuery({ queryKey: ['venue', slug], queryFn: () => api<VenuePage>(`/venues/${encodeURIComponent(slug!)}`), enabled: !!slug, staleTime: 60_000 });
  const v = q.data;
  const back = <IconButton icon="back" label="Back" glass onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ position: 'absolute', top: insets.top + space.sm, left: gutter - 4 }} />;

  if (q.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Skeleton height={HERO} radius={0} />
        <View style={{ padding: gutter, gap: space.md }}>
          <Skeleton height={30} width="70%" />
          <Skeleton height={16} width="50%" />
          <Skeleton height={120} />
        </View>
        {back}
      </View>
    );
  }
  if (q.error || !v) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {q.error instanceof ApiError && q.error.status === 404 ? <EmptyState icon="building" title="Venue not found" body="It may have been removed or merged with another." /> : <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />}
        {back}
      </View>
    );
  }

  // Venue events as cards (the venue is the same for all of them).
  const events: EventCard[] = v.events.map((e) => ({ ...e, venue: v.name, city: v.city, country: v.country, lat: v.lat, lng: v.lng }));
  const where = [v.address, v.address.includes(cityOnly(v.city)) ? null : v.city, v.region, v.postalCode].filter(Boolean).join(', ');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}>
        <View style={{ height: HERO, backgroundColor: colors.surface }}>
          {v.imageUrl ? <Image source={{ uri: v.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={['rgba(255,77,61,0.28)', colors.bg]} style={StyleSheet.absoluteFill} />}
          <LinearGradient colors={['rgba(15,10,11,0.45)', colors.fade0, colors.bg]} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
        </View>
        <FadeIn style={{ paddingHorizontal: gutter, marginTop: -48, gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Badge label="Venue" tone="glass" />
            {v.verified ? <Badge label="Verified" tone="success" /> : null}
          </View>
          <Txt variant="h1" accessibilityRole="header">
            {v.name}
          </Txt>
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/city/[city]', params: { city: v.city, ...(v.country ? { country: v.country } : {}) } })} hitSlop={6}>
            <Txt color={colors.muted}>
              {v.country ? `${flag(v.country)} ` : ''}
              {[cityOnly(v.city), v.country ? countryName(v.country) : null].filter(Boolean).join(', ')}
            </Txt>
          </Pressable>
        </FadeIn>

        <View style={{ paddingHorizontal: gutter, marginTop: space.xl, gap: space.lg }}>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={styles.icon}>
                <Icon name="pin" size={19} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">Address</Txt>
                <Txt variant="small" color={colors.muted} selectable>
                  {where}
                </Txt>
              </View>
            </View>
            <Button label="Open in Maps" icon="map" variant="ghost" size="md" onPress={() => openMaps(v)} />
            {v.website ? (
              <Button
                label="Venue website"
                icon="external"
                variant="subtle"
                size="md"
                onPress={() => void WebBrowser.openBrowserAsync(v.website!, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined)}
              />
            ) : null}
          </Card>

          {v.capacity || v.layout || v.eventsHosted ? (
            <View style={styles.stats}>
              {v.capacity ? <Stat label="Capacity" value={num(v.capacity)} /> : null}
              {v.layout ? <Stat label="Sections" value={String(v.layout.sections)} /> : null}
              {v.eventsHosted ? <Stat label="Events on Omoshow" value={num(v.eventsHosted)} /> : null}
            </View>
          ) : null}

          {v.listing ? (
            <View style={{ gap: space.md }}>
              <TermsCard listing={v.listing} />
              <Button label="Book this venue" icon="calendar" onPress={() => router.push({ pathname: '/book-venue/[slug]', params: { slug: v.slug } })} />
            </View>
          ) : null}

          {v.about ? (
            <View style={{ gap: space.sm }}>
              <Txt variant="h3" accessibilityRole="header">
                About
              </Txt>
              <Txt color={colors.muted}>{v.about}</Txt>
            </View>
          ) : null}

          <View style={{ gap: space.sm }}>
            <Txt variant="h3" accessibilityRole="header">
              Coming up here
            </Txt>
            {events.length ? (
              <View style={{ marginHorizontal: -space.sm }}>
                {events.map((e) => (
                  <CompactEventCard key={e.slug} e={e} />
                ))}
              </View>
            ) : (
              <EmptyState compact icon="calendar" title="Nothing on sale here yet" body="Save events you like elsewhere, and check back soon." />
            )}
          </View>

          <ClaimCard
            venue={v}
            signedIn={!!user}
            loaded={!user || !!mine.data}
            manages={mine.data?.managed.find((m) => m.venue.slug === v.slug)?.venue.id ?? null}
            request={mine.data?.requests.find((r) => r.venue.slug === v.slug && r.status === 'PENDING') ?? mine.data?.requests.find((r) => r.venue.slug === v.slug) ?? null}
          />
        </View>
      </ScrollView>
      {back}
    </View>
  );
}

/** For the people who run the venue: claim its page, or where that stands. */
function ClaimCard({ venue: v, signedIn, loaded, manages, request }: { venue: VenuePage; signedIn: boolean; loaded: boolean; manages: string | null; request: VenueRequest | null }) {
  if (!loaded) return null;
  const pending = request?.status === 'PENDING';
  const declined = request && !pending && !manages;
  const claim = () => (signedIn ? router.push({ pathname: '/my-venues/add', params: { slug: v.slug } }) : router.push({ pathname: '/sign-in', params: { then: `/venues/${v.slug}` } }));
  return (
    <View style={styles.claim}>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={styles.icon}>
          <Icon name={manages ? 'check' : pending ? 'clock' : 'building'} size={19} color={manages ? colors.success : pending ? colors.warning : colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="eyebrow" color={colors.accent}>
            For venues
          </Txt>
          <Txt variant="title">{manages ? `You manage ${v.name}` : pending ? 'Your request is with Omoshow' : v.managed ? `Part of the team at ${v.name}?` : 'Work here? Claim this page'}</Txt>
          <Txt variant="small" color={colors.muted}>
            {manages
              ? 'Its listing, price, opening hours, blocked-out time and details are in My venues.'
              : pending
                ? 'Omoshow checks every request by hand, usually within a day. We’ll email you and send a notification.'
                : declined
                  ? `Your last request wasn’t approved${request?.note ? `: “${request.note}”` : '.'} You can ask again with something we can check.`
                  : 'Keep its details and photo up to date, and let organizers book it on Omoshow.'}
          </Txt>
        </View>
      </View>
      {manages ? (
        <Button label="Manage venue" icon="sliders" variant="ghost" size="md" onPress={() => router.push({ pathname: '/my-venues/[id]', params: { id: manages } })} />
      ) : pending ? null : (
        <Button label={declined ? 'Ask again' : 'Claim this page'} icon="key" variant="ghost" size="md" onPress={claim} />
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Txt variant="price">{value}</Txt>
      <Txt variant="tiny" color={colors.dim}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: space.md },
  claim: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  stat: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
});
