/**
 * My venues: the venues this person manages (GET /me/venues → `managed`), each opening its own page for the listing,
 * hours, blocked-out time and details; booking requests across them (the inbox, app/venue-bookings); requests to
 * manage a venue still with Omoshow, or declined; and adding or claiming another venue. Approved-claim
 * notifications (/venues/manage) open this screen.
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { Group, Label, OrgScreen, StatTile, TileRow } from '@/components/org-ui';
import { placeLine, RequestCard, VenueRow } from '@/components/venue-owner';
import { Badge, Button, EmptyState, ErrorState, Row, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMyVenues } from '@/lib/bookings';
import { num } from '@/lib/format';
import { CLAIM_ROLE_NAME } from '@/lib/my-venues';
import { colors, radius, space } from '@/theme';

export default function MyVenues() {
  const { user } = useAuth();
  const q = useMyVenues(user?.id);
  const managed = q.data?.managed ?? [];
  const requests = (q.data?.requests ?? []).filter((r) => r.status === 'PENDING' || r.status === 'REJECTED');
  const waiting = managed.reduce((n, m) => n + m.pendingBookings, 0);
  const listed = managed.filter((m) => m.listing?.active).length;

  return (
    <OrgScreen title="My venues" eyebrow="For venues" fallback="/account" onRefresh={() => q.refetch()}>
      {!user ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : q.isPending ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={90} radius={radius.card} />
          <Skeleton height={80} radius={radius.card} />
          <Skeleton height={80} radius={radius.card} />
        </View>
      ) : q.error ? (
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          {managed.length ? (
            <>
              <TileRow>
                <StatTile label="Requests" value={num(waiting)} sub={waiting ? 'Need your answer' : 'All answered'} tone={waiting ? 'accent' : undefined} />
                <StatTile label="Taking bookings" value={`${listed}/${managed.length}`} sub={managed.length === 1 ? 'Your venue' : 'Your venues'} tone={listed ? 'success' : undefined} />
              </TileRow>
              <Group>
                <Row icon="calendar" label="Booking requests" detail={waiting ? `${waiting} waiting` : 'Inbox'} tone={waiting ? 'accent' : undefined} onPress={() => router.push('/venue-bookings')} />
              </Group>
              <View style={{ gap: space.sm }}>
                <Label>{managed.length === 1 ? 'Your venue' : `Your venues · ${managed.length}`}</Label>
                {managed.map((m) => (
                  <VenueRow
                    key={m.venue.id}
                    name={m.venue.name}
                    sub={placeLine(m.venue)}
                    imageUrl={m.venue.imageUrl}
                    onPress={() => router.push({ pathname: '/my-venues/[id]', params: { id: m.venue.id } })}
                    badges={
                      <>
                        {m.listing?.active ? <Badge label="Taking bookings" tone="success" /> : <Badge label={m.listing ? 'Bookings off' : 'Not listed yet'} tone="warning" />}
                        {m.listing?.active && m.listing.instantBook ? <Badge label="Instant" /> : null}
                        {m.pendingBookings ? <Badge label={`${m.pendingBookings} waiting`} tone="accent" /> : null}
                        <Badge label={CLAIM_ROLE_NAME[m.role] ?? m.role} />
                      </>
                    }
                  />
                ))}
              </View>
            </>
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

          {managed.length || requests.length ? <Button label="Add or claim another venue" icon="plus" variant="ghost" size="md" onPress={() => router.push('/my-venues/add')} /> : null}
          <Txt variant="small" color={colors.dim}>
            Payment for a booking is arranged directly between you and the organizer, outside Omoshow.
          </Txt>
        </>
      )}
    </OrgScreen>
  );
}
