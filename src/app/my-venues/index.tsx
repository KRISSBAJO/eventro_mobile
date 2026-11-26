/**
 * My venues: the venues this person manages (GET /me/venues → `managed`) as photo cards with one status line, each
 * opening its own page (listing, hours, blocked-out time, details); booking requests waiting for an answer (the
 * inbox, app/venue-bookings) at the top when there are any; requests to manage a venue still with Omoshow, or
 * declined; and adding or claiming another venue. Approved-claim notifications (/venues/manage) open this screen.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/icons';
import { Label, OrgScreen } from '@/components/org-ui';
import { placeLine, RequestCard } from '@/components/venue-owner';
import { Button, EmptyState, ErrorState, FadeIn, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMyVenues } from '@/lib/bookings';
import { CLAIM_ROLE_NAME } from '@/lib/my-venues';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme';

export default function MyVenues() {
  const { user } = useAuth();
  const q = useMyVenues(user?.id);
  const managed = q.data?.managed ?? [];
  const requests = (q.data?.requests ?? []).filter((r) => r.status === 'PENDING' || r.status === 'REJECTED');
  const waiting = managed.reduce((n, m) => n + m.pendingBookings, 0);

  return (
    <OrgScreen title="My venues" eyebrow="For venues" fallback="/account" onRefresh={() => q.refetch()}>
      {!user ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : q.isPending ? (
        <View style={{ gap: space.lg }}>
          <Skeleton height={230} radius={radius.card} />
          <Skeleton height={230} radius={radius.card} />
        </View>
      ) : q.error ? (
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          {waiting ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/venue-bookings')} style={({ pressed }) => [styles.inbox, pressed && { opacity: 0.85 }]}>
              <View style={styles.inboxIcon}>
                <Icon name="bell" size={18} color={colors.accentInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">
                  {waiting} booking {waiting === 1 ? 'request needs' : 'requests need'} your answer
                </Txt>
                <Txt variant="small" color={colors.muted}>
                  Confirm or decline within 48 hours.
                </Txt>
              </View>
              <Icon name="chevronRight" size={18} color={colors.dim} />
            </Pressable>
          ) : null}

          {managed.length ? (
            <View style={{ gap: space.lg }}>
              {managed.map((m, i) => {
                const on = !!m.listing?.active;
                const status = on ? (m.listing!.instantBook ? 'Taking bookings · Instant' : 'Taking bookings') : m.listing ? 'Bookings are off' : 'Not taking bookings yet';
                return (
                  <FadeIn key={m.venue.id} delay={i * 50}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${m.venue.name}, ${status}`}
                      onPress={() => {
                        haptic.tap();
                        router.push({ pathname: '/my-venues/[id]', params: { id: m.venue.id } });
                      }}
                      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
                    >
                      <View style={styles.photo}>
                        {m.venue.imageUrl ? <Image source={{ uri: m.venue.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <Icon name="building" size={30} color={colors.dim} />}
                      </View>
                      <View style={styles.body}>
                        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                          <Txt variant="h3" numberOfLines={1}>
                            {m.venue.name}
                          </Txt>
                          <Txt variant="small" color={colors.muted} numberOfLines={1}>
                            {placeLine(m.venue)}
                          </Txt>
                          <View style={styles.status}>
                            <View style={[styles.dot, { backgroundColor: on ? colors.success : colors.warning }]} />
                            <Txt variant="smallStrong" color={on ? colors.success : colors.warning}>
                              {status}
                            </Txt>
                            <Txt variant="small" color={colors.dim}>
                              · {CLAIM_ROLE_NAME[m.role] ?? m.role}
                            </Txt>
                          </View>
                        </View>
                        {m.pendingBookings ? (
                          <View style={styles.count}>
                            <Txt variant="smallStrong" color={colors.accentInk}>
                              {m.pendingBookings}
                            </Txt>
                          </View>
                        ) : (
                          <Icon name="chevronRight" size={18} color={colors.dim} />
                        )}
                      </View>
                    </Pressable>
                  </FadeIn>
                );
              })}
            </View>
          ) : !requests.length ? (
            <EmptyState icon="building" title="No venues yet" body="Own or run a venue? List it on Omoshow and organizers can request it for their events." action="List your venue" onAction={() => router.push('/my-venues/add')} />
          ) : null}

          {requests.length ? (
            <View style={{ gap: space.sm }}>
              <Label>{requests.some((r) => r.status === 'PENDING') ? 'Waiting for approval' : 'Requests'}</Label>
              {requests.map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  onOpen={() => router.push({ pathname: '/venue/[slug]', params: { slug: r.venue.slug } })}
                  onRetry={r.newVenue || r.venue.hidden ? () => router.push('/my-venues/add') : () => router.push({ pathname: '/my-venues/add', params: { slug: r.venue.slug } })}
                />
              ))}
            </View>
          ) : null}

          {managed.length || requests.length ? (
            <View style={{ gap: space.sm }}>
              {managed.length && !waiting ? <Button label="Booking requests" icon="calendar" variant="ghost" size="md" onPress={() => router.push('/venue-bookings')} /> : null}
              <Button label="Add or claim another venue" icon="plus" variant="ghost" size="md" onPress={() => router.push('/my-venues/add')} />
            </View>
          ) : null}
          <Txt variant="small" color={colors.dim}>
            Payment for a booking is arranged directly between you and the organizer, outside Omoshow.
          </Txt>
        </>
      )}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  inbox: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  inboxIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  card: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  photo: { height: 160, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  body: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  count: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
});
