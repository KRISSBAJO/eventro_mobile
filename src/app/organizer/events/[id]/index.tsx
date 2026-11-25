/**
 * One event's dashboard: live numbers (GET /organizer/events/:id/stats: sales by ticket type, revenue, check-ins and
 * 30 days of sales), quick actions (scan, pause / resume sales, share the link, edit), attendees, comps, the guest
 * list, promo codes, price drops, the seat map (on the web) and, for org admins, cancelling. Drafts are submitted for
 * review here. Ticket sales, donations, comps and guest-list arrivals are reported separately: sales and revenue
 * never include comps or donations.
 *
 * An event held at a venue booked on Eventro (`venueBooking`) shows the booking's status; it can't be submitted
 * until the venue confirms (the API answers 409 VENUE_BOOKING_PENDING), and a booking that fell through
 * (VENUE_BOOKING_UNAVAILABLE) needs another venue, or the venue kept without the booking. Drafts held in person can
 * use one of the organization's venue bookings (organizer/events/[id]/booking.tsx), switch to another, or drop it
 * (DELETE /organizer/events/:id/venue-booking; the booking itself stays).
 *
 * Multiple dates: "By date" lists each date's sales, capacity and check-ins (stats `byDate`; a multi-day pass counts on
 * each of its days) and opens the attendees for that date; a run's ticket types are added up across dates.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { BookingBadge } from '@/components/booking-ui';
import { Icon } from '@/components/icons';
import { ActionTile, Group, Label, OrgScreen, Progress, SalesBars, StatTile, StatusBadge, TileRow, WebButton } from '@/components/org-ui';
import { Button, Divider, EmptyState, ErrorState, Notice, Row, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localMoment, rangeLabel } from '@/lib/bookings';
import { donationLabel } from '@/lib/donations';
import { dateLine, rangeLine } from '@/lib/dates';
import { money, num, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  canEdit,
  isAdmin,
  membershipOf,
  openWeb,
  publicLink,
  statusOf,
  useEventStats,
  useGuaranteeRefunds,
  useOrgEvent,
  usePriceDrops,
  webPaths,
  type GuaranteeRefunds,
} from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

export default function EventDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  const stats = useEventStats(id);
  const role = membershipOf(orgs.data, ev.data?.orgId)?.role;
  const editor = canEdit(role);
  const drops = usePriceDrops(id, editor);
  // Admins and managers only; door staff get 403, and any error just hides the section.
  const refunds = useGuaranteeRefunds(id, editor);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'' | 'pause' | 'submit' | 'detach'>('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const refresh = () => Promise.all([ev.refetch(), stats.refetch(), editor ? drops.refetch() : null, editor ? refunds.refetch() : null]);
  const changed = () => Promise.all([qc.invalidateQueries({ queryKey: ['organizer', 'event', id] }), qc.invalidateQueries({ queryKey: ['organizer', 'events'] })]);

  if (ev.isPending || (ev.data && stats.isPending)) {
    return (
      <OrgScreen title="Event">
        <Skeleton height={90} radius={radius.card} />
        <Skeleton height={110} radius={radius.card} />
        <Skeleton height={180} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (ev.error || !ev.data) {
    return (
      <OrgScreen title="Event">
        <ErrorState message={ev.error ? errorText(ev.error) : 'Event not found.'} onRetry={() => void ev.refetch()} />
      </OrgScreen>
    );
  }

  const e = ev.data;
  const s = stats.data;
  const sold = s?.sold ?? e.ticketTypes.reduce((n, t) => n + t.sold, 0);
  const capacity = s?.capacity ?? e.ticketTypes.reduce((n, t) => n + t.capacity, 0);
  const st = statusOf({ ...e, sold, capacity });
  const d = when(e.startsAt);
  // Multiple dates: the run's dates, and the tiers added up across them.
  const liveDates = (e.dates ?? []).filter((x) => x.status !== 'CANCELLED');
  const multi = !!e.dateMode && e.dateMode !== 'SINGLE' && liveDates.length > 0;
  const whenText = multi ? `${rangeLine(liveDates)} · ${liveDates.length} ${e.dateMode === 'DAYS' ? (liveDates.length === 1 ? 'day' : 'days') : liveDates.length === 1 ? 'date' : 'dates'}` : null;
  const byType = (() => {
    const rows = s?.byTicketType ?? [];
    if (e.dateMode !== 'DATES') return rows;
    const by = new Map<string, (typeof rows)[number]>();
    // a cancelled date's copies don't count any more
    const gone = new Set((e.dates ?? []).filter((x) => x.status === 'CANCELLED').map((x) => x.id));
    for (const t of rows.filter((x) => !gone.has(x.eventDateId ?? ''))) {
      const k = t.tierKey ?? t.id;
      const was = by.get(k);
      by.set(k, was ? { ...was, sold: was.sold + t.sold, capacity: was.capacity + t.capacity, comps: (was.comps ?? 0) + (t.comps ?? 0) } : { ...t });
    }
    return [...by.values()];
  })();
  const cancelled = e.status === 'CANCELLED';
  const draft = e.status === 'DRAFT' || e.status === 'REJECTED';
  const canPause = editor && e.status === 'PUBLISHED' && st !== 'Ended';
  const recentDays = (s?.daily ?? []).slice(-30);
  const anySales = recentDays.some((x) => x.tickets > 0);
  const vb = e.venueBooking ?? null;
  /** Held at a booked venue that hasn't confirmed (or fell through): submitting is refused. */
  const held = !!vb && vb.status !== 'CONFIRMED';
  const venueName = e.venue?.name ?? 'The venue';
  const openBooking = () => vb && router.push({ pathname: '/organizer/bookings/[id]', params: { id: vb.id } });
  const pickBooking = () => router.push({ pathname: '/organizer/events/[id]/booking', params: { id: e.id } });

  const detach = async () => {
    // A booking that fell through: keep the venue without it. A live one: take it off the event (it stays booked).
    const yes = await confirm(
      held && vb?.status !== 'PENDING'
        ? {
            title: 'Keep the venue without the booking?',
            message: `The event stays at ${venueName}, no longer tied to booking ${vb?.code ?? ''} on Eventro. Only do this if you’ve arranged the venue another way.`,
            confirmLabel: 'Keep the venue',
          }
        : {
            title: 'Remove the booking from this event?',
            message: `The event stays at ${venueName}, no longer tied to booking ${vb?.code ?? ''}. The booking itself stays: cancel it from the booking if you don’t need it.`,
            confirmLabel: 'Remove from event',
            destructive: true,
          },
    );
    if (!yes) return;
    setError('');
    setBusy('detach');
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}/venue-booking`, { method: 'DELETE' });
      haptic.success();
      setNote(`The event is no longer tied to booking ${vb?.code ?? ''}. The booking itself stays.`);
      await changed();
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  const pause = async () => {
    setError('');
    setNote('');
    const resume = e.salesPaused;
    if (!resume) {
      const yes = await confirm({ title: 'Pause sales?', message: 'Fans can’t buy tickets until you resume. Tickets already sold still work at the door.', confirmLabel: 'Pause sales', destructive: true });
      if (!yes) return;
    }
    setBusy('pause');
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}/${resume ? 'resume' : 'pause'}`, { method: 'POST' });
      haptic.success();
      setNote(resume ? 'Sales are back on.' : 'Sales are paused.');
      await changed();
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    setError('');
    const yes = await confirm({
      title: 'Submit for review?',
      message: 'Eventro checks every event before it goes on sale, usually within a day. You can keep editing while it’s in review.',
      confirmLabel: 'Submit for review',
    });
    if (!yes) return;
    setBusy('submit');
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}/submit`, { method: 'POST' });
      haptic.success();
      setNote('Submitted. We’ll let you know when it’s approved.');
      await changed();
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  const share = () => {
    const url = publicLink(e);
    const text = e.status === 'PUBLISHED' ? `${e.title} on Eventro` : `Preview of ${e.title} on Eventro (not on sale yet)`;
    Share.share(Platform.OS === 'ios' ? { message: text, url } : { message: `${text}: ${url}` }).catch(() => undefined);
  };

  return (
    <OrgScreen
      title={e.title}
      eyebrow={whenText ?? `${d.short} · ${d.time}`}
      onRefresh={refresh}
      footer={
        draft && editor ? (
          held ? (
            <Button label={vb!.status === 'PENDING' ? 'Waiting for the venue to confirm' : 'Pick another venue to submit'} icon="building" variant="ghost" onPress={vb!.status === 'PENDING' ? openBooking : () => router.push({ pathname: '/organizer/events/[id]/venue', params: { id: e.id } })} />
          ) : (
            <Button label={e.status === 'REJECTED' ? 'Submit again for review' : 'Submit for review'} icon="send" loading={busy === 'submit'} onPress={() => void submit()} />
          )
        ) : undefined
      }>
      <View style={styles.head}>
        <View style={styles.cover}>{e.imageUrl ? <Image source={{ uri: e.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
        <View style={{ flex: 1, gap: 6 }}>
          <StatusBadge status={st} />
          <Txt variant="small" color={colors.muted} numberOfLines={2}>
            {whenText ?? d.date}
            {'\n'}
            {e.online ? 'Online event' : e.venue ? `${e.venue.name}, ${e.venue.city}` : ''}
          </Txt>
        </View>
      </View>

      {e.status === 'REJECTED' ? (
        <Notice tone="warning" icon="alert" title="Changes needed">
          {e.reviewNote || 'Eventro couldn’t approve this event yet. Edit it and submit it again.'}
        </Notice>
      ) : e.status === 'IN_REVIEW' ? (
        <Notice tone="plain" icon="clock" title="In review">
          Eventro is checking this event. It goes on sale once it’s approved.
        </Notice>
      ) : e.status === 'DRAFT' ? (
        <Notice tone="plain" icon="file" title="Draft">
          Only your team can see it. Submit it for review when it’s ready.
        </Notice>
      ) : cancelled ? (
        <Notice tone="accent" icon="alert" title="Cancelled">
          This event is no longer on sale. Buyers were refunded and emailed.
        </Notice>
      ) : null}
      {vb && !cancelled ? (
        <View style={[styles.card, held && { borderColor: vb.status === 'PENDING' ? 'rgba(245,165,36,0.35)' : colors.accentLine }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Label>Venue booked on Eventro</Label>
            <View style={{ flex: 1 }} />
            <BookingBadge status={vb.status} />
          </View>
          <View style={{ gap: 2 }}>
            <Txt variant="bodyStrong">{venueName}</Txt>
            <Txt variant="small" color={colors.muted}>
              {rangeLabel(vb.startsAt, vb.endsAt)} · {vb.code}
            </Txt>
          </View>
          <Txt variant="small" color={colors.muted}>
            {vb.status === 'PENDING'
              ? `Waiting for ${venueName} to confirm (they have until ${localMoment(vb.holdUntil)}). The event stays on hold: you can submit it for review once they confirm.`
              : vb.status === 'CONFIRMED'
                ? `Confirmed${vb.quotedCents !== null && vb.currency ? ` at ${money(vb.quotedCents, vb.currency)}` : ''}. You pay the venue directly; Eventro doesn’t take this payment.`
                : vb.status === 'CANCELLED'
                  ? `${venueName} booking ${vb.code} was cancelled${vb.cancelReason ? `: “${vb.cancelReason}”` : '.'} ${e.status === 'PUBLISHED' ? 'The event is still on sale here: move it to another venue, or talk to the venue, and tell your ticket holders.' : 'Pick another venue or time before you submit.'}`
                  : `Booking ${vb.code} ${vb.status === 'DECLINED' ? `was declined${vb.declineReason ? `: “${vb.declineReason}”` : '.'}` : 'expired: the venue didn’t answer in time.'} Pick another venue or time before you submit.`}
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Button label="Open booking" variant="subtle" size="sm" iconRight="chevronRight" onPress={openBooking} />
            {editor && held && vb.status !== 'PENDING' ? (
              <>
                <Button label="Change venue" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/organizer/events/[id]/venue', params: { id: e.id } })} />
                <Button label="Keep this venue" variant="ghost" size="sm" loading={busy === 'detach'} onPress={() => void detach()} />
              </>
            ) : null}
            {editor && draft && !e.online ? <Button label="Use another booking" variant="ghost" size="sm" onPress={pickBooking} /> : null}
            {editor && draft && !(held && vb.status !== 'PENDING') ? <Button label="Remove from event" variant="ghost" size="sm" loading={busy === 'detach'} onPress={() => void detach()} /> : null}
          </View>
        </View>
      ) : editor && draft && !e.online && (!e.dateMode || e.dateMode === 'SINGLE') ? (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.useIcon}>
              <Icon name="building" size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Booked a venue on Eventro?</Txt>
              <Txt variant="small" color={colors.muted}>
                Use one of your venue bookings for this event. Its times, doors included, have to fit inside the booking.
              </Txt>
            </View>
          </View>
          <Button label="Use a venue booking" icon="calendar" variant="ghost" size="md" onPress={pickBooking} />
        </View>
      ) : null}
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      <View style={styles.actions}>
        <ActionTile icon="scan" label="Scan tickets" tone="accent" disabled={cancelled} onPress={() => router.push({ pathname: '/door/[eventId]', params: { eventId: e.id } })} />
        <ActionTile icon={e.salesPaused ? 'play' : 'clock'} label={busy === 'pause' ? 'Saving…' : e.salesPaused ? 'Resume sales' : 'Pause sales'} disabled={!canPause || !!busy} onPress={() => void pause()} />
      </View>
      <View style={styles.actions}>
        <ActionTile icon="share" label={e.status === 'PUBLISHED' ? 'Share link' : 'Share preview'} disabled={cancelled} onPress={share} />
        <ActionTile icon="sliders" label="Edit" disabled={!editor || cancelled} onPress={() => router.push({ pathname: '/organizer/events/[id]/edit', params: { id: e.id } })} />
      </View>

      {stats.error ? (
        <Notice tone="plain" icon="alert" action="Try again" onAction={() => void stats.refetch()}>
          {errorText(stats.error)}
        </Notice>
      ) : s ? (
        <>
          <TileRow>
            <StatTile label="Sold" value={num(s.sold)} sub={`of ${num(s.capacity)}`} />
            <StatTile label="Checked in" value={num(s.checkedIn)} sub={s.sold ? `${Math.round((s.checkedIn / s.sold) * 100)}% of sold` : 'No tickets yet'} tone={s.checkedIn ? 'success' : undefined} />
          </TileRow>
          <StatTile label="Revenue" value={money(s.grossCents, e.currency)} sub={`Ticket sales. You get ${money(s.netCents, e.currency)} after Eventro’s fee`} />
          {s.donations && (s.donations.orders > 0 || e.donationsEnabled) ? (
            <StatTile
              label="Donations"
              value={money(s.donations.cents, e.currency)}
              sub={`${donationLabel(s.donations.cause ?? e.donationCause)}: ${num(s.donations.orders)} ${s.donations.orders === 1 ? 'order' : 'orders'}, no fee taken.${s.donations.refundedCents ? ` ${money(s.donations.refundedCents, e.currency)} refunded.` : ''} Separate from ticket sales; you pass it on to the cause.`}
            />
          ) : null}
          {s.comps || s.guestList ? (
            <TileRow>
              {s.comps ? (
                <StatTile label="Comps" value={num(s.comps.issued)} sub={`${s.comps.limit !== null ? `of ${num(s.comps.limit)} · ` : ''}${num(s.comps.claimed)} claimed · ${num(s.comps.checkedIn)} in`} />
              ) : null}
              {s.guestList ? (
                <StatTile label="Guest list" value={`${num(s.guestList.arrived)} of ${num(s.guestList.expected)}`} sub={`here · ${num(s.guestList.entries)} ${s.guestList.entries === 1 ? 'entry' : 'entries'}`} tone={s.guestList.arrived ? 'success' : undefined} />
              ) : null}
            </TileRow>
          ) : null}

          {anySales ? (
            <View style={styles.card}>
              <Label>Tickets sold, last 30 days</Label>
              <SalesBars days={recentDays} label="Tickets sold per day, last 30 days" />
            </View>
          ) : null}

          {s.byDate?.length ? (
            <View style={styles.card}>
              <Label>By date</Label>
              {s.byDate.map((x) => {
                const off = x.status === 'CANCELLED';
                return (
                  <Pressable
                    key={x.dateId}
                    accessibilityRole="button"
                    accessibilityLabel={`${dateLine(x)}${off ? ', cancelled' : ''}: ${num(x.sold)} of ${num(x.capacity)} sold, ${num(x.checkedIn)} checked in. See attendees`}
                    onPress={() => router.push({ pathname: '/organizer/events/[id]/attendees', params: { id: e.id, date: x.dateId } })}
                    style={({ pressed }) => [{ gap: 6 }, off && { opacity: 0.55 }, pressed && { opacity: 0.7 }]}>
                    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'baseline' }}>
                      <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                        {dateLine(x)}
                      </Txt>
                      <Txt variant="small" color={off ? colors.accentHi : colors.muted}>
                        {off ? 'Cancelled' : `${num(x.sold)} / ${num(x.capacity)}${x.comps ? ` + ${num(x.comps)}` : ''} · ${num(x.checkedIn)} in`}
                      </Txt>
                    </View>
                    {!off ? <Progress value={x.sold + (x.comps ?? 0)} max={x.capacity} /> : null}
                    {!off && x.grossCents ? (
                      <Txt variant="tiny" color={colors.dim}>
                        {money(x.grossCents, e.currency)}
                        {e.dateMode === 'DAYS' ? ' · passes split evenly over their days' : ''}
                      </Txt>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.card}>
            <Label>By ticket type</Label>
            {e.dateMode === 'DATES' ? (
              <Txt variant="small" color={colors.dim}>
                All dates together.
              </Txt>
            ) : null}
            {byType.map((t) => (
              <View key={t.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {t.name}
                  </Txt>
                  <Txt variant="small" color={colors.muted}>
                    {num(t.sold)} / {num(t.capacity)}
                    {t.comps ? ` + ${num(t.comps)} comp${t.comps === 1 ? '' : 's'}` : ''} · {e.ticketTypes.find((x) => x.id === t.id)?.pricing === 'PWYW' ? 'Pay what you want' : t.priceCents ? money(t.priceCents, e.currency) : 'Free'}
                  </Txt>
                </View>
                <Progress value={t.sold + (t.comps ?? 0)} max={t.capacity} />
              </View>
            ))}
          </View>
        </>
      ) : null}

      {editor && drops.data && (drops.data.drops.length || drops.data.total) ? (
        <View style={styles.card}>
          <Label>Price drops</Label>
          <Txt variant="small" color={colors.muted}>
            {drops.data.total
              ? `${num(drops.data.watchers)} ${drops.data.watchers === 1 ? 'fan is' : 'fans are'} watching this event${drops.data.subscribers ? ` and ${num(drops.data.subscribers)} matching ${drops.data.subscribers === 1 ? 'subscriber' : 'subscribers'}` : ''}. Lowering a price in Edit alerts them (once per 12 hours).`
              : 'Nobody is watching this event yet, so a lower price sends no alert. The event page still shows “Price dropped”.'}
          </Txt>
          {drops.data.drops.slice(0, 3).map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', gap: space.sm }}>
              <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
                {p.ticketName}: {money(p.fromCents, p.currency)} → {money(p.toCents, p.currency)}
              </Txt>
              <Txt variant="small" color={colors.dim}>
                {p.notified ? `${num(p.notified)} alerted` : 'No alert'}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      {editor && refunds.data ? <GuaranteeRefundsCard r={refunds.data} /> : null}

      <Group>
        <Row icon="users" label="Attendees" detail={s ? `${num(s.sold)}` : undefined} onPress={() => router.push({ pathname: '/organizer/events/[id]/attendees', params: { id: e.id } })} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="gift" label="Comps" detail={s?.comps ? `${num(s.comps.issued)}` : undefined} onPress={() => router.push({ pathname: '/organizer/events/[id]/comps', params: { id: e.id } })} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="file" label="Guest list" detail={s?.guestList ? `${num(s.guestList.arrived)} of ${num(s.guestList.expected)}` : undefined} onPress={() => router.push({ pathname: '/organizer/events/[id]/guest-list', params: { id: e.id } })} />
        {editor ? (
          <>
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="tag" label="Promo codes" onPress={() => router.push({ pathname: '/organizer/events/[id]/promos', params: { id: e.id } })} />
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="seat" label={e.seatMap ? 'Seat map' : 'Add a seat map'} detail="Website" onPress={() => openWeb(webPaths.seating(e.id))} />
          </>
        ) : null}
      </Group>

      {isAdmin(role) && !cancelled ? (
        <View style={[styles.card, { borderColor: colors.accentLine }]}>
          <Label>Danger zone</Label>
          <Txt variant="small" color={colors.muted}>
            Cancelling stops sales, refunds every paid order and emails every buyer. It can’t be undone.
          </Txt>
          <Button label="Cancel event…" variant="danger" size="md" onPress={() => router.push({ pathname: '/organizer/events/[id]/cancel', params: { id: e.id } })} />
        </View>
      ) : null}

      <WebButton label="Open on the web" path={webPaths.event(e.id)} />
      {!editor && role ? (
        <EmptyState compact icon="lock" title="Door staff view" body="You can scan tickets, check guests in and see comps. Ask an admin to make you a manager to edit this event, issue comps or see its promo codes." />
      ) : null}
    </OrgScreen>
  );
}

/** The event's scan guarantee refunds: what went back to fans and what it took off the payout. Read-only. */
function GuaranteeRefundsCard({ r }: { r: GuaranteeRefunds }) {
  const m = (cents: number, currency = r.currency) => money(cents, currency);
  return (
    <View style={styles.card}>
      <Label>Scan guarantee refunds</Label>
      {!r.count && !r.items.length ? (
        <Txt variant="small" color={colors.muted}>
          No scan guarantee refunds on this event.
        </Txt>
      ) : (
        <>
          <Txt variant="small" color={colors.muted}>
            {`${num(r.count)} ${r.count === 1 ? 'ticket' : 'tickets'} refunded to fans: ${m(r.refundedCents)}. Payout reduced by ${m(r.payoutReductionCents)}.`}
          </Txt>
          {r.owedCents > 0 ? (
            <Txt variant="small" color={colors.warning}>
              {`${m(r.owedCents)} owed to Eventro: you’d already been paid for these orders.`}
            </Txt>
          ) : null}
          {r.items.map((x) => {
            const at = x.refundedAt ?? x.decidedAt;
            const seat = [x.section ? `Section ${x.section}` : null, x.row ? `Row ${x.row}` : null, x.seat !== null ? `Seat ${x.seat}` : null].filter(Boolean).join(' · ');
            return (
              <View key={x.id} style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="small" numberOfLines={1}>
                    {seat ? `${x.ticketType} · ${seat}` : x.ticketType}
                  </Txt>
                  <Txt variant="tiny" color={colors.dim}>
                    {`${at ? localMoment(at) : ''}${x.refundStatus === 'REFUNDED' ? '' : `${at ? ' · ' : ''}${x.refundStatus === 'FAILED' ? 'Refund failed; Eventro is on it' : 'Refund in progress'}`}`}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Txt variant="smallStrong">{m(x.amountCents, x.currency)}</Txt>
                  <Txt variant="tiny" color={colors.dim}>
                    {`payout −${m(x.organizerCents, x.currency)}`}
                  </Txt>
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cover: { width: 92, height: 92, borderRadius: radius.lg, backgroundColor: colors.surface2, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: space.md },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  useIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
});
