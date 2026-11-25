/**
 * The organization's venue bookings (GET /organizer/orgs/:orgId/venue-bookings?status), soonest first, filtered by
 * status. Tap one for its details, cancelling and messages. Several organizations: a switcher on top.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BookingRow } from '@/components/booking-ui';
import { OrgScreen } from '@/components/org-ui';
import { Chip, EmptyState, ErrorState, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { STATUS_FILTERS, useOrgBookings, type BookingStatus } from '@/lib/bookings';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

export default function OrgBookings() {
  const params = useLocalSearchParams<{ orgId?: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const list = orgs.data ?? [];
  const current = list.find((o) => o.org.id === (picked ?? params.orgId)) ?? list[0];
  const q = useOrgBookings(current?.org.id, status);

  return (
    <OrgScreen title="Venue bookings" eyebrow={current?.org.name} onRefresh={() => q.refetch()}>
      {!user ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : orgs.isPending ? (
        <Skeleton height={86} radius={radius.card} />
      ) : !current ? (
        <EmptyState icon="building" title="No organizer profile" body="Set up an organizer profile to book venues on Omoshow." action="Set up a profile" onAction={() => router.replace('/organizer/start')} />
      ) : (
        <>
          {list.length > 1 ? (
            <View style={styles.chips}>
              {list.map((o) => (
                <Chip key={o.org.id} label={o.org.name} active={o.org.id === current.org.id} onPress={() => setPicked(o.org.id)} />
              ))}
            </View>
          ) : null}
          <View style={styles.chips}>
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.id || 'all'} label={f.label} active={status === f.id} onPress={() => setStatus(f.id)} />
            ))}
          </View>
          {q.isPending ? (
            <View style={{ gap: space.md }}>
              <Skeleton height={86} radius={radius.card} />
              <Skeleton height={86} radius={radius.card} />
            </View>
          ) : q.error ? (
            <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
          ) : !q.data?.length ? (
            <EmptyState
              compact
              icon="building"
              title={status ? 'Nothing here' : 'No venue bookings yet'}
              body="Book a venue from its page on Omoshow, or choose “Book a venue on Omoshow” when you create an event."
            />
          ) : (
            q.data.map((b) => <BookingRow key={b.id} b={b} side="ORGANIZER" onPress={() => router.push({ pathname: '/organizer/bookings/[id]', params: { id: b.id } })} />)
          )}
          <Txt variant="small" color={colors.dim}>
            Venue prices are shown only. You pay the venue directly; Omoshow doesn’t take this payment.
          </Txt>
        </>
      )}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
