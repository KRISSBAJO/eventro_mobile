/**
 * One venue booking, from either side: the organizer (GET /organizer/venue-bookings/:id: cancel, messages) or the
 * venue's managers (GET /me/venue-bookings/:id: confirm with an optional price and note, decline or cancel with a
 * reason, messages). Used by app/organizer/bookings/[id].tsx and app/venue-bookings/[id].tsx.
 *
 * Organizers can also use a pending or confirmed booking that no event uses yet for a new event ("Use for an
 * event" opens the create flow with ?booking=<id>).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BookingBadge, MessageThread } from './booking-ui';
import { Group, Label, OrgScreen } from './org-ui';
import { Button, Divider, ErrorState, Field, Notice, Row, Skeleton, Txt } from './ui';
import { api, errorText } from '@/lib/api';
import { bookingPath, localMoment, minutesLabel, rangeLabel, timesLabel, useBooking, zoneCity, type BookingDetail, type Side } from '@/lib/bookings';
import { cityOnly, money, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { moneyInput, parseMoney } from '@/lib/organizer';
import { colors, radius, space } from '@/theme';

export function BookingDetailScreen({ side, id }: { side: Side; id: string | undefined }) {
  const q = useBooking(side, id);
  const fallback = side === 'ORGANIZER' ? '/organizer/bookings' : '/venue-bookings';
  if (q.isPending) {
    return (
      <OrgScreen title="Booking" fallback={fallback}>
        <Skeleton height={120} radius={radius.card} />
        <Skeleton height={180} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !q.data) {
    return (
      <OrgScreen title="Booking" fallback={fallback}>
        <ErrorState message={q.error ? errorText(q.error) : 'Booking not found.'} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }
  return <Detail key={q.data.id} b={q.data} side={side} refresh={() => q.refetch()} fallback={fallback} />;
}

function Detail({ b, side, refresh, fallback }: { b: BookingDetail; side: Side; refresh: () => Promise<unknown>; fallback: '/organizer/bookings' | '/venue-bookings' }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'' | 'confirm' | 'decline' | 'cancel'>('');
  const [price, setPrice] = useState(b.quotedCents !== null ? moneyInput(b.quotedCents) : '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const cur = b.currency ?? b.terms?.currency ?? 'USD';
  const venueSide = side === 'VENUE';

  const act = async (what: 'confirm' | 'decline' | 'cancel') => {
    setError('');
    if (what !== 'confirm' && text.trim().length < 3) {
      haptic.warning();
      setError('Add a short reason. The other side sees it.');
      return;
    }
    const cents = price.trim() ? parseMoney(price) : null;
    if (what === 'confirm' && price.trim() && cents === null) {
      haptic.warning();
      setError('Enter the price as a number, like 250000.');
      return;
    }
    setBusy(true);
    try {
      const body =
        what === 'confirm' ? { ...(price.trim() ? { quotedCents: cents } : {}), ...(text.trim() ? { note: text.trim().slice(0, 2000) } : {}) } : { reason: text.trim().slice(0, 500) };
      const r = await api<{ autoDeclined?: number }>(`${bookingPath(side, b.id)}/${what}`, { body });
      haptic.success();
      setDone(
        what === 'confirm'
          ? `Confirmed. ${b.org.name} has been told${r.autoDeclined ? `, and ${r.autoDeclined} overlapping ${r.autoDeclined === 1 ? 'request was' : 'requests were'} declined` : ''}.`
          : what === 'decline'
            ? `Declined. ${b.org.name} has been told.`
            : `Cancelled. ${venueSide ? b.org.name : b.venue.name} has been told.`,
      );
      setMode('');
      setText('');
      await Promise.all([qc.invalidateQueries({ queryKey: ['bookings'] }), qc.invalidateQueries({ queryKey: ['organizer'] }), qc.invalidateQueries({ queryKey: ['me', 'venues'] })]);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const ev = b.event;
  const title = venueSide ? b.org.name : b.venue.name;
  return (
    <OrgScreen title={title} eyebrow={`Booking ${b.code}`} fallback={fallback} onRefresh={refresh}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <BookingBadge status={b.status} side={side} />
        {venueSide ? <Txt variant="small" color={colors.muted}>{b.venue.name}</Txt> : null}
      </View>
      <StatusNotice b={b} side={side} />
      {done ? (
        <Notice tone="success" icon="check">
          {done}
        </Notice>
      ) : null}

      <View style={styles.card}>
        <Line label="When" value={rangeLabel(b.startsAt, b.endsAt)} sub={`${zoneCity(b.timezone)}, at the venue`} />
        <Divider />
        <Line label="Kept free" value={timesLabel(b.blockFrom, b.blockTo)} sub={b.terms ? `Including ${minutesLabel(b.terms.bufferMinutes)} setup and cleanup either side` : undefined} />
        {b.guests ? (
          <>
            <Divider />
            <Line label="Guests" value={num(b.guests)} />
          </>
        ) : null}
        <Divider />
        <Line
          label="Price"
          value={b.quotedCents !== null ? money(b.quotedCents, cur) : 'Quoted by the venue'}
          sub="Shown only: paid directly to the venue, outside Eventro."
        />
        {venueSide ? (
          <>
            <Divider />
            <Line label="Organizer" value={b.org.name} sub={[b.requestedBy ? `Requested by ${b.requestedBy}` : null, b.org.supportEmail].filter(Boolean).join(' · ') || undefined} />
            {ev ? (
              <>
                <Divider />
                <Line label="For the event" value={ev.title} />
              </>
            ) : null}
          </>
        ) : (
          <>
            <Divider />
            <Line label="Venue" value={b.venue.name} sub={[b.venue.address, cityOnly(b.venue.city)].filter(Boolean).join(', ')} />
          </>
        )}
      </View>

      {b.message ? (
        <View style={styles.card}>
          <Label>{venueSide ? 'Their request' : 'Your request'}</Label>
          <Txt color={colors.muted}>“{b.message}”</Txt>
        </View>
      ) : null}

      {!venueSide && !ev && (b.status === 'PENDING' || b.status === 'CONFIRMED') ? (
        <View style={styles.card}>
          <Label>No event yet</Label>
          <Txt variant="small" color={colors.muted}>
            Create the event that happens here. It’s held at {b.venue.name} within this booking{b.status === 'PENDING' ? ', and can be submitted for review once the venue confirms' : ''}.
          </Txt>
          <Button label="Use for an event" icon="plus" size="md" onPress={() => router.push({ pathname: '/organizer/create', params: { booking: b.id } })} />
        </View>
      ) : null}

      {!venueSide ? (
        <Group>
          {ev ? (
            <>
              <Row icon="calendar" label={ev.title} detail="Open event" onPress={() => router.push({ pathname: '/organizer/events/[id]', params: { id: ev.id } })} />
              <Divider style={{ marginLeft: 62 }} />
            </>
          ) : null}
          <Row icon="building" label="Venue page" onPress={() => router.push({ pathname: '/venue/[slug]', params: { slug: b.venue.slug } })} />
        </Group>
      ) : null}

      {!venueSide && b.terms?.rules ? (
        <View style={styles.card}>
          <Label>House rules</Label>
          <Txt variant="small" color={colors.muted}>
            {b.terms.rules}
          </Txt>
        </View>
      ) : null}

      {/* Actions */}
      {b.can.confirm || b.can.decline || b.can.cancel ? (
        <View style={styles.card}>
          {mode === 'confirm' ? (
            <>
              <Label>Confirm this booking</Label>
              <Field
                label={`Agreed price (${cur}, optional)`}
                placeholder="Leave as is"
                keyboardType="decimal-pad"
                value={price}
                onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))}
                hint="Shown to the organizer. They pay you directly; Eventro doesn’t take this payment."
              />
              <Field label="Note to the organizer (optional)" placeholder="Load-in, contacts, deposit details…" value={text} onChangeText={setText} multiline maxLength={2000} inputStyle={styles.multi} />
              <Txt variant="small" color={colors.dim}>
                Other requests waiting for an overlapping time are declined for you, and their organizers told.
              </Txt>
              <Actions>
                <Button label="Back" variant="ghost" size="md" style={{ width: 96 }} onPress={() => setMode('')} disabled={busy} />
                <Button label="Confirm booking" size="md" style={{ flex: 1 }} loading={busy} onPress={() => void act('confirm')} />
              </Actions>
            </>
          ) : mode === 'decline' || mode === 'cancel' ? (
            <>
              <Label>{mode === 'decline' ? 'Decline this request' : 'Cancel this booking'}</Label>
              <Field
                label="Reason"
                placeholder={mode === 'decline' ? 'e.g. We have a private event that day' : 'e.g. Our plans changed'}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={500}
                inputStyle={styles.multi}
                hint={`${venueSide ? b.org.name : b.venue.name} sees this.`}
              />
              {mode === 'cancel' && !venueSide && ev && ev.status && ev.status !== 'DRAFT' ? (
                <Notice tone="warning" icon="alert">
                  {`${ev.title} stays at this venue until you move it. Change its venue after cancelling.`}
                </Notice>
              ) : null}
              <Actions>
                <Button label="Back" variant="ghost" size="md" style={{ width: 96 }} onPress={() => setMode('')} disabled={busy} />
                <Button label={mode === 'decline' ? 'Decline request' : 'Cancel booking'} variant="danger" size="md" style={{ flex: 1 }} loading={busy} onPress={() => void act(mode)} />
              </Actions>
            </>
          ) : (
            <>
              {b.can.confirm ? <Button label="Confirm booking" icon="check" onPress={() => setMode('confirm')} /> : null}
              {b.can.decline ? <Button label="Decline…" variant="ghost" size="md" onPress={() => setMode('decline')} /> : null}
              {b.can.cancel ? <Button label={b.status === 'PENDING' ? 'Withdraw request…' : 'Cancel booking…'} variant="danger" size="md" onPress={() => setMode('cancel')} /> : null}
            </>
          )}
          {error ? <Notice icon="alert">{error}</Notice> : null}
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>Messages</Label>
        <MessageThread side={side} id={b.id} messages={b.messages} canWrite={b.can.message} />
      </View>
    </OrgScreen>
  );
}

function StatusNotice({ b, side }: { b: BookingDetail; side: Side }) {
  const venueSide = side === 'VENUE';
  if (b.status === 'PENDING') {
    return venueSide ? (
      <Notice tone="warning" icon="clock" title="Waiting for your answer">
        {`The time is held for ${b.org.name} until ${localMoment(b.holdUntil)}. Confirm or decline before then, or it expires.`}
      </Notice>
    ) : (
      <Notice tone="warning" icon="clock" title="Waiting for the venue to confirm">
        {`${b.venue.name} has until ${localMoment(b.holdUntil)} to answer; the time is held for you until then.${b.event ? ` ${b.event.title} can be submitted for review once they confirm.` : ''}`}
      </Notice>
    );
  }
  if (b.status === 'CONFIRMED') {
    return (
      <Notice tone="success" icon="check" title="Confirmed">
        {venueSide ? 'This time is booked. Talk to the organizer here about load-in and payment.' : `${b.venue.name} confirmed. Pay them directly, the way you agree; Eventro doesn’t take this payment.`}
      </Notice>
    );
  }
  if (b.status === 'DECLINED') {
    return (
      <Notice tone="accent" icon="alert" title="Declined">
        {`${b.declineReason ? `“${b.declineReason}”` : 'The venue can’t host this booking.'}${venueSide ? '' : ' Pick another time or venue.'}`}
      </Notice>
    );
  }
  if (b.status === 'EXPIRED') {
    return (
      <Notice tone="plain" icon="clock" title="Expired">
        {venueSide ? 'Nobody answered in time, so the time is free again.' : 'The venue didn’t answer in time, so the time is no longer held. Ask again, or pick another venue.'}
      </Notice>
    );
  }
  const by = b.cancelledBy === 'VENUE' ? (venueSide ? 'You' : b.venue.name) : b.cancelledBy === 'ORGANIZER' ? (venueSide ? b.org.name : 'You') : 'Someone';
  return (
    <Notice tone="accent" icon="alert" title={`Cancelled by ${by === 'You' ? 'you' : by}`}>
      {b.cancelReason ? `“${b.cancelReason}”` : 'This booking was cancelled.'}
    </Notice>
  );
}

const Actions = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', gap: space.md }}>{children}</View>;

function Line({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt variant="eyebrow" color={colors.dim}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" selectable>
        {value}
      </Txt>
      {sub ? (
        <Txt variant="small" color={colors.muted}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  multi: { minHeight: 80, paddingTop: 14, textAlignVertical: 'top' },
});
