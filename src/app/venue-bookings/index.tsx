/**
 * Venue managers: booking requests and bookings for the venues they manage (GET /me/venue-bookings?status), as an
 * agenda by day, soonest first. Requests waiting for an answer are on top. Tap one to confirm, decline or reply.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BookingRow } from '@/components/booking-ui';
import { Group, Label, OrgScreen, StatTile, TileRow } from '@/components/org-ui';
import { Chip, EmptyState, ErrorState, Row, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { STATUS_FILTERS, useVenueInbox, type Booking, type BookingStatus } from '@/lib/bookings';
import { isPast, num, when } from '@/lib/format';
import { colors, radius, space } from '@/theme';

export default function VenueInboxScreen() {
  const { user } = useAuth();
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const q = useVenueInbox(status);
  const items = q.data?.items ?? [];
  const waiting = items.filter((b) => b.status === 'PENDING');
  const rest = items.filter((b) => b.status !== 'PENDING' && (status || !isPast(b.endsAt, 0)));
  // An agenda: one group per day (venue wall-clock).
  const days = new Map<string, Booking[]>();
  for (const b of rest) days.set(when(b.startsAt).ymd, [...(days.get(when(b.startsAt).ymd) ?? []), b]);
  const open = (b: Booking) => router.push({ pathname: '/venue-bookings/[id]', params: { id: b.id } });

  return (
    <OrgScreen title="Venue bookings" eyebrow="Your venues" fallback="/account" onRefresh={() => q.refetch()}>
      {!user ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : q.isPending ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={90} radius={radius.card} />
          <Skeleton height={86} radius={radius.card} />
        </View>
      ) : q.error ? (
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data?.venues.length ? (
        <EmptyState icon="building" title="You don’t manage a venue" body="Own or run a venue? List it on Eventro. Once Eventro approves you, booking requests show up here." action="List your venue" onAction={() => router.push('/my-venues/add')} />
      ) : (
        <>
          <TileRow>
            <StatTile label="Waiting" value={num(q.data.pending)} sub={q.data.pending ? 'Need your answer' : 'All answered'} tone={q.data.pending ? 'accent' : undefined} />
            <StatTile label="Venues" value={num(q.data.venues.length)} sub="You manage" />
          </TileRow>
          <View style={styles.chips}>
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.id || 'all'} label={f.id === 'PENDING' ? 'Needs answer' : f.label} active={status === f.id} onPress={() => setStatus(f.id)} />
            ))}
          </View>
          {waiting.length ? (
            <View style={{ gap: space.sm }}>
              <Label>{`Needs your answer · ${waiting.length}`}</Label>
              {waiting.map((b) => (
                <BookingRow key={b.id} b={b} side="VENUE" onPress={() => open(b)} />
              ))}
            </View>
          ) : null}
          {[...days.entries()].map(([day, list]) => (
            <View key={day} style={{ gap: space.sm }}>
              <Label>{when(list[0].startsAt).date}</Label>
              {list.map((b) => (
                <BookingRow key={b.id} b={b} side="VENUE" onPress={() => open(b)} />
              ))}
            </View>
          ))}
          {!waiting.length && !days.size ? <EmptyState compact icon="calendar" title={status ? 'Nothing here' : 'Nothing coming up'} body="Requests from organizers show up here, and you’re emailed about each one." /> : null}
          <Group>
            <Row icon="sliders" label="Listing, hours and blocked time" detail="My venues" onPress={() => router.push('/my-venues')} />
          </Group>
          <Txt variant="small" color={colors.dim}>
            Times are each venue’s local time. Payment is arranged directly with the organizer, outside Eventro.
          </Txt>
        </>
      )}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
