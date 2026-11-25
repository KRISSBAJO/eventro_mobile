/**
 * Change venue (admins and managers): PUT /organizer/events/:id/venue with the create flow's where-step fields
 * (components/venue-fields.tsx, including the state-based time-zone guess).
 *
 * Times keep their wall-clock value and take the new venue's zone, so the zone the times will be in is shown before
 * saving ("Times stay 8:00 PM, now in Central time"). On a published event with tickets sold, the confirm sheet says
 * every ticket holder will be emailed. Online, cancelled and ended events can't move; the API also refuses events
 * with seats already sold on their seat map, and that message is shown as it comes.
 *
 * An event held at a venue booked on Omoshow (a pending or confirmed booking) can't move until the booking is
 * cancelled or let go of (DELETE /organizer/events/:id/venue-booking); the API answers 409 VENUE_BOOKED otherwise.
 * A booking that fell through is let go of by the move itself.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { timeLabel } from '@/components/date-time';
import { OrgScreen, WebButton } from '@/components/org-ui';
import { Button, ErrorState, Notice, Skeleton, Txt } from '@/components/ui';
import { countryPatch, EMPTY_PLACE, placeBody, placeErrors, VenueFields, type VenuePlace } from '@/components/venue-fields';
import { api, ApiError, errorText } from '@/lib/api';
import { isLiveBooking } from '@/lib/bookings';
import { useAuth } from '@/lib/auth';
import { num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { canEdit, COUNTRY_ZONES, membershipOf, useOrgEvent, wallParts, webPaths, type OrgEventDetail } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

/** PUT /organizer/events/:id/venue */
type Moved = {
  venue: { name: string; address: string; city: string; region: string | null };
  zone: { from: string; to: string; changed: boolean; toName: string };
  notice: string | null;
  seatMapNote: string | null;
  notified: { emails: number; pushes: number; reason?: string };
};

/** "Central time": the app's own zone names in the US, Canada and Australia, else the runtime's, else the city. */
function zoneName(tz: string) {
  for (const list of Object.values(COUNTRY_ZONES)) {
    const z = list.find((x) => x.id === tz);
    if (z) return `${z.label} time`;
  }
  try {
    const v = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    if (v && !/^GMT[+-]/.test(v)) return v.replace(/ Time$/, ' time');
  } catch {
    /* older Intl */
  }
  return `${tz.split('/').pop()!.replace(/_/g, ' ')} time`;
}

export default function ChangeVenue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  if (ev.isPending || orgs.isPending) {
    return (
      <OrgScreen title="Change venue">
        <Skeleton height={300} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (ev.error || !ev.data) {
    return (
      <OrgScreen title="Change venue">
        <ErrorState message={ev.error ? errorText(ev.error) : 'Event not found.'} onRetry={() => void ev.refetch()} />
      </OrgScreen>
    );
  }
  if (!canEdit(membershipOf(orgs.data, ev.data.orgId)?.role)) {
    return (
      <OrgScreen title="Change venue">
        <ErrorState message="Your role can’t change the venue. Ask an admin to make you a manager." />
      </OrgScreen>
    );
  }
  return <Mover key={ev.data.id} e={ev.data} />;
}

function Mover({ e }: { e: OrgEventDetail }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [v, setV] = useState<VenuePlace>(() => ({ ...EMPTY_PLACE, ...(e.venue?.country ? countryPatch(EMPTY_PLACE, e.venue.country) : {}) }));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [moved, setMoved] = useState<Moved | null>(null);
  /** Held at a venue booked on Omoshow (until let go of here). */
  const [booked, setBooked] = useState(() => isLiveBooking(e.venueBooking?.status));
  const [letting, setLetting] = useState(false);
  const [now] = useState(() => Date.now());
  const sold = e.ticketTypes.reduce((s, t) => s + t.sold, 0);
  const published = e.status === 'PUBLISHED';
  const time = timeLabel(wallParts(e.startsAt)!.time);
  const typed = !!(v.venue.trim() || v.city.trim());

  // The zone the times will be in: the picked or guessed zone in countries with several, else the country's (or
  // the state's) zone from the API, as it will decide.
  const single = !!v.country && !COUNTRY_ZONES[v.country];
  const region = v.region.trim();
  const countryZone = useQuery({
    queryKey: ['geo', 'timezone', v.country, region],
    queryFn: () => api<{ timezone: string | null }>(`/geo/timezone?country=${v.country}${region ? `&region=${encodeURIComponent(region)}` : ''}`),
    enabled: single,
    staleTime: Infinity,
  });
  const target = single ? countryZone.data?.timezone : v.zone;
  const shift = typed && !!target && target !== e.timezone ? `Times stay ${time}, now in ${zoneName(target)}.` : null;

  const ended = new Date(e.startsAt).getTime() < now;
  const blocked = e.online
    ? 'This is an online event, so it has no venue. To hold it in person, create a new event.'
    : e.status === 'CANCELLED'
      ? 'This event was cancelled.'
      : ended
        ? 'This event has ended.'
        : '';

  const errors: Record<string, string> = show ? placeErrors(v) : {};
  if (show && e.venue && v.venue.trim().toLowerCase() === e.venue.name.trim().toLowerCase() && v.city.trim().toLowerCase() === e.venue.city.trim().toLowerCase()) {
    errors.venue = `The event is already at ${e.venue.name}.`;
  }

  const save = async () => {
    setError('');
    setShow(true);
    const ers = placeErrors(v);
    const same = e.venue && v.venue.trim().toLowerCase() === e.venue.name.trim().toLowerCase() && v.city.trim().toLowerCase() === e.venue.city.trim().toLowerCase();
    if (Object.keys(ers).length || same) {
      haptic.warning();
      setError('Check the highlighted fields.');
      return;
    }
    if (published && sold > 0) {
      const yes = await confirm({
        title: 'Email everyone with a ticket?',
        message: `${num(sold)} ${sold === 1 ? 'ticket is' : 'tickets are'} sold. Every holder gets one email with the new venue, its address and a map link, and fans with the app get a notification. Their tickets keep working.${shift ? ` ${shift}` : ''}`,
        confirmLabel: 'Move and email buyers',
      });
      if (!yes) return;
    }
    setBusy(true);
    try {
      const r = await api<Moved>(`/organizer/events/${encodeURIComponent(e.id)}/venue`, { method: 'PUT', body: { venue: placeBody(v), ...(v.zone ? { timezone: v.zone } : {}) } });
      haptic.success();
      setMoved(r);
      await Promise.all([qc.invalidateQueries({ queryKey: ['organizer'] }), qc.invalidateQueries({ queryKey: ['event', e.slug] })]);
    } catch (err) {
      haptic.error();
      if (err instanceof ApiError && err.code === 'VENUE_BOOKED') setBooked(true);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const letGo = async () => {
    const yes = await confirm({
      title: 'Let go of the venue booking?',
      message: `The event will no longer be tied to booking ${e.venueBooking?.code ?? ''}. The booking itself stays: cancel it from its page if you won’t use the venue, so the venue can offer the time to others.`,
      confirmLabel: 'Let go of it',
    });
    if (!yes) return;
    setLetting(true);
    setError('');
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}/venue-booking`, { method: 'DELETE' });
      haptic.success();
      setBooked(false);
      await qc.invalidateQueries({ queryKey: ['organizer'] });
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    } finally {
      setLetting(false);
    }
  };

  const done = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/organizer/events/[id]', params: { id: e.id } }));

  if (moved) {
    return (
      <OrgScreen title="Venue changed" eyebrow={e.title} footer={<Button label="Done" onPress={done} />}>
        <Notice tone="success" icon="check" title={`Moved to ${moved.venue.name}`}>
          {[moved.venue.address, moved.venue.city, moved.venue.region].filter(Boolean).join(', ')}
        </Notice>
        {moved.notice ? (
          <Notice tone="warning" icon="clock">
            {moved.notice}
          </Notice>
        ) : null}
        <Txt color={colors.muted}>
          {moved.notified.emails
            ? `Emailing ${num(moved.notified.emails)} ticket ${moved.notified.emails === 1 ? 'holder' : 'holders'} the new address and a map link${moved.notified.pushes ? `, and notifying ${num(moved.notified.pushes)} in the app` : ''}.`
            : (moved.notified.reason ?? 'Nobody has a ticket yet, so nobody was emailed.')}
        </Txt>
        {moved.seatMapNote ? (
          <>
            <Notice tone="plain" icon="seat">
              {moved.seatMapNote}
            </Notice>
            <WebButton label="Check the seat map on the web" path={webPaths.seating(e.id)} />
          </>
        ) : null}
      </OrgScreen>
    );
  }

  return (
    <OrgScreen title="Change venue" eyebrow={e.title} footer={blocked || booked ? undefined : <Button label={published && sold > 0 ? 'Move and tell buyers' : 'Move event'} loading={busy} onPress={() => void save()} />}>
      {e.venue ? (
        <View style={{ gap: 2 }}>
          <Txt variant="small" color={colors.dim}>
            Now at
          </Txt>
          <Txt variant="bodyStrong">{e.venue.name}</Txt>
          <Txt variant="small" color={colors.muted}>
            {[e.venue.address, e.venue.city, e.venue.region].filter(Boolean).join(', ')}
          </Txt>
        </View>
      ) : null}
      {blocked ? (
        <Notice tone="plain" icon="alert">
          {blocked}
        </Notice>
      ) : booked ? (
        <>
          <Notice tone="warning" icon="building" title="Booked on Omoshow">
            {`This event is held at ${e.venue?.name ?? 'its venue'} through booking ${e.venueBooking?.code ?? ''}. To move it, cancel the booking, or let go of it here if you’re not using it.`}
          </Notice>
          {e.venueBooking ? <Button label="Open the booking" variant="ghost" size="md" onPress={() => router.push({ pathname: '/organizer/bookings/[id]', params: { id: e.venueBooking!.id } })} /> : null}
          <Button label="Let go of the booking" variant="subtle" size="md" loading={letting} onPress={() => void letGo()} />
          {error ? <Notice icon="alert">{error}</Notice> : null}
        </>
      ) : (
        <>
          <Txt variant="small" color={colors.dim}>
            The date and times stay as they are{published && sold > 0 ? `. Everyone with a ticket (${num(sold)} sold) is emailed about the new venue` : ''}.
          </Txt>
          <View style={{ gap: space.lg }}>
            <VenueFields value={v} onChange={(patch) => setV((p) => ({ ...p, ...patch }))} errors={errors} />
          </View>
          {shift ? (
            <Notice tone="warning" icon="clock">
              {shift}
            </Notice>
          ) : null}
          {error ? <Notice icon="alert">{error}</Notice> : null}
        </>
      )}
    </OrgScreen>
  );
}
