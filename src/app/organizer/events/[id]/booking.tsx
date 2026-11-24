/**
 * Use a venue booking for a draft (or rejected) in-person event: the organization's bookings that are waiting or
 * confirmed and not used by an event yet (GET /organizer/orgs/:orgId/venue-bookings?status=PENDING and CONFIRMED,
 * the API leaving out holds that ran out; those without an event are kept here), attached with
 * PUT /organizer/events/:id/venue-booking { bookingId }. The event moves to the booked venue; its times, doors
 * included, have to sit inside the booking (400 OUTSIDE_VENUE_BOOKING otherwise). A pending booking holds the event:
 * it can be submitted for review once the venue confirms. No booking yet: find a venue taking bookings.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { BookingRow, VenueSearch } from '@/components/booking-ui';
import { Section } from '@/components/form-ui';
import { Label, OrgScreen } from '@/components/org-ui';
import { Badge, Button, EmptyState, ErrorState, Notice, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rangeLabel, useOrgBookings, type Booking } from '@/lib/bookings';
import { when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { canEdit, membershipOf, useOrgEvent } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

export default function UseBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  const e = ev.data;
  // The API's PENDING filter leaves out requests whose hold ran out.
  const pending = useOrgBookings(e?.orgId, 'PENDING');
  const confirmed = useOrgBookings(e?.orgId, 'CONFIRMED');
  const bookings = { isPending: pending.isPending || confirmed.isPending, error: pending.error ?? confirmed.error, refetch: () => Promise.all([pending.refetch(), confirmed.refetch()]) };
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<{ text: string; outside: boolean } | null>(null);
  const [find, setFind] = useState(false);
  const back = id ? ({ pathname: '/organizer/events/[id]', params: { id } } as const) : '/organizer';

  if (ev.isPending || orgs.isPending) {
    return (
      <OrgScreen title="Use a venue booking" fallback={back}>
        <Skeleton height={90} radius={radius.card} />
        <Skeleton height={80} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (ev.error || !e) {
    return (
      <OrgScreen title="Use a venue booking" fallback={back}>
        <ErrorState message={ev.error ? errorText(ev.error) : 'Event not found.'} onRetry={() => void ev.refetch()} />
      </OrgScreen>
    );
  }
  const editor = canEdit(membershipOf(orgs.data, e.orgId)?.role);
  const draft = e.status === 'DRAFT' || e.status === 'REJECTED';
  if (!editor || !draft || e.online) {
    return (
      <OrgScreen title="Use a venue booking" eyebrow={e.title} fallback={back}>
        <EmptyState
          icon="lock"
          title={!editor ? 'Admins and managers only' : e.online ? 'This is an online event' : 'Only for drafts'}
          body={!editor ? 'Ask an admin of your team to make you a manager.' : e.online ? 'Venue bookings are for events held at a venue.' : 'A venue booking can be added while the event is a draft, or after Eventro asked for changes.'}
        />
      </OrgScreen>
    );
  }

  const current = e.venueBooking?.id ?? null;
  // Waiting (and still held) or confirmed, and not used by an event yet; soonest first.
  const free = [...(confirmed.data ?? []), ...(pending.data ?? [])]
    .filter((b) => (b.status === 'CONFIRMED' || b.status === 'PENDING') && !b.event && b.id !== current)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const eventFrom = e.doorsAt ?? e.startsAt;
  const eventTo = e.endsAt ?? e.startsAt;
  const fits = (b: Booking) => b.startsAt <= eventFrom && eventTo <= b.endsAt;

  const attach = async (b: Booking) => {
    const yes = await confirm({
      title: `Use booking ${b.code}?`,
      message: `${e.title} moves to ${b.venue.name}, ${rangeLabel(b.startsAt, b.endsAt)}.${b.status === 'PENDING' ? ' It stays on hold until the venue confirms; you can submit it for review then.' : ''}${current ? ' It replaces the booking it has now (that booking itself stays).' : ''}`,
      confirmLabel: 'Use this booking',
    });
    if (!yes) return;
    setError(null);
    setBusy(b.id);
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}/venue-booking`, { method: 'PUT', body: { bookingId: b.id } });
      haptic.success();
      await Promise.all([qc.invalidateQueries({ queryKey: ['organizer', 'event', e.id] }), qc.invalidateQueries({ queryKey: ['organizer', 'events'] }), qc.invalidateQueries({ queryKey: ['bookings'] })]);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/organizer/events/[id]', params: { id: e.id } });
    } catch (err) {
      haptic.error();
      setError({ text: errorText(err), outside: err instanceof ApiError && err.code === 'OUTSIDE_VENUE_BOOKING' });
    } finally {
      setBusy('');
    }
  };

  return (
    <OrgScreen title="Use a venue booking" eyebrow={e.title} fallback={back} onRefresh={() => Promise.all([ev.refetch(), bookings.refetch()])}>
      <Section icon="clock" title="Your event’s times" sub="They have to fit inside the booking, doors included. Change them in Edit if they don’t.">
        <View style={{ gap: 4 }}>
          <Txt variant="bodyStrong">{rangeLabel(eventFrom, eventTo)}</Txt>
          {e.doorsAt ? (
            <Txt variant="small" color={colors.muted}>
              Doors {when(e.doorsAt).time} · starts {when(e.startsAt).time}
            </Txt>
          ) : null}
        </View>
        <Button label="Edit times" icon="sliders" variant="subtle" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => router.push({ pathname: '/organizer/events/[id]/edit', params: { id: e.id } })} />
      </Section>

      {error ? (
        <Notice icon="alert" title={error.outside ? 'The times don’t fit that booking' : undefined} action={error.outside ? 'Edit the event’s times' : undefined} onAction={error.outside ? () => router.push({ pathname: '/organizer/events/[id]/edit', params: { id: e.id } }) : undefined}>
          {error.text}
        </Notice>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>Your free bookings</Label>
        {bookings.isPending ? (
          <>
            <Skeleton height={86} radius={radius.card} />
            <Skeleton height={86} radius={radius.card} />
          </>
        ) : bookings.error ? (
          <ErrorState compact message={errorText(bookings.error)} onRetry={() => void bookings.refetch()} />
        ) : !free.length ? (
          <EmptyState compact icon="building" title="No free bookings" body="Venue bookings your team made, waiting or confirmed and not used by another event, show up here." />
        ) : (
          free.map((b) => (
            <View key={b.id} style={{ gap: 6, opacity: busy && busy !== b.id ? 0.5 : 1 }}>
              <BookingRow b={b} side="ORGANIZER" code onPress={() => (busy ? undefined : void attach(b))} />
              <View style={{ flexDirection: 'row', gap: 6, paddingLeft: space.sm }}>
                {fits(b) ? <Badge label="Fits your times" tone="success" /> : <Badge label="Your times are outside it" tone="warning" />}
                {busy === b.id ? <Badge label="Saving…" /> : null}
              </View>
            </View>
          ))
        )}
      </View>

      {find ? (
        <Section icon="search" title="Book a venue" sub="Venues taking bookings on Eventro. Request a time, then come back and use the booking here.">
          <VenueSearch date={e.startsAt.slice(0, 10)} onPick={(r) => router.push({ pathname: '/book-venue/[slug]', params: { slug: r.venue.slug } })} />
        </Section>
      ) : (
        <Button label="Find a venue to book" icon="search" variant="ghost" size="md" onPress={() => setFind(true)} />
      )}
      <Txt variant="small" color={colors.dim}>
        Payment for the venue is arranged directly with them, outside Eventro. Removing a booking from the event keeps the booking itself.
      </Txt>
    </OrgScreen>
  );
}
