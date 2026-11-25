/**
 * "Book this venue" from a venue's page: its terms, then the request form (organization, date and times in the
 * venue's zone, guests, message) with the venue's busy times. POST /organizer/orgs/:orgId/venue-bookings; on success
 * the booking's own screen opens. Organizer admins and managers only; others are pointed to setting up a profile.
 */
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { BookingRequestForm, TermsCard } from '@/components/booking-ui';
import { OrgScreen } from '@/components/org-ui';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canEdit } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import type { VenuePage } from '@/lib/types';
import { radius } from '@/theme';

export default function BookVenue() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const q = useQuery({ queryKey: ['venue', slug], queryFn: () => api<VenuePage>(`/venues/${encodeURIComponent(slug!)}`), enabled: !!slug, staleTime: 60_000 });
  const v = q.data;
  const editable = (orgs.data ?? []).filter((o) => canEdit(o.role));
  const back = slug ? ({ pathname: '/venue/[slug]', params: { slug } } as const) : '/';

  if (!user) {
    return (
      <OrgScreen title="Book this venue" fallback={back}>
        <EmptyState icon="lock" title="Sign in to book" body="Venue bookings are made by an organizer profile." action="Sign in" onAction={() => router.push('/sign-in')} />
      </OrgScreen>
    );
  }
  if (q.isPending || orgs.isPending) {
    return (
      <OrgScreen title="Book this venue" fallback={back}>
        <Skeleton height={160} radius={radius.card} />
        <Skeleton height={260} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !v) {
    return (
      <OrgScreen title="Book this venue" fallback={back}>
        <ErrorState message={q.error ? errorText(q.error) : 'Venue not found.'} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }
  if (!v.listing) {
    return (
      <OrgScreen title={v.name} eyebrow="Book this venue" fallback={back}>
        <EmptyState icon="building" title="Not taking bookings" body={`${v.name} isn’t taking bookings on Omoshow right now.`} />
      </OrgScreen>
    );
  }
  if (!editable.length) {
    return (
      <OrgScreen title={v.name} eyebrow="Book this venue" fallback={back}>
        <TermsCard listing={v.listing} compact />
        <EmptyState
          compact
          icon="ticket"
          title={orgs.data?.length ? 'Ask a manager to book' : 'Set up an organizer profile'}
          body={orgs.data?.length ? 'Door staff can’t book venues. Ask an admin of your team to make you a manager.' : 'Venues are booked by organizers. It takes a minute, and you can sell tickets to the event too.'}
          action={orgs.data?.length ? undefined : 'Set up a profile'}
          onAction={orgs.data?.length ? undefined : () => router.push('/organizer/start')}
        />
      </OrgScreen>
    );
  }
  return (
    <OrgScreen title={v.name} eyebrow="Book this venue" fallback={back}>
      <TermsCard listing={v.listing} compact />
      <BookingRequestForm
        venue={{ id: v.id, slug: v.slug, name: v.name }}
        listing={v.listing}
        orgs={editable}
        onBooked={(b) => router.replace({ pathname: '/organizer/bookings/[id]', params: { id: b.id } })}
      />
    </OrgScreen>
  );
}
