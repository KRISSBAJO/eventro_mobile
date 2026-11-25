/**
 * Pieces of hiring a venue that several screens share: the status badge, a venue's terms, a booking row, the
 * request form (date and times in the venue's zone, with its busy times), bookable-venue search and the message
 * thread between the organizer and the venue. Shapes and labels are in lib/bookings.ts.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, ApiError, errorText, qs } from '@/lib/api';
import {
  bookingPath,
  BOOKING_TONE,
  freeSlot,
  hoursLines,
  hoursOn,
  minutesLabel,
  plural,
  priceLabel,
  rangeLabel,
  statusLabel,
  timesLabel,
  useAvailability,
  zoneCity,
  type Booking,
  type BookingMessage,
  type BookingStatus,
  type ListingResult,
  type Side,
  type VenueListing,
} from '@/lib/bookings';
import { cityOnly, money, num, todayYmd } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { wallIso } from '@/lib/organizer';
import type { MyOrg } from '@/lib/types';
import { colors, radius, space } from '@/theme';
import { DateField, dateLabel, TimeField } from './date-time';
import { Icon } from './icons';
import { Badge, Button, Chip, EmptyState, Field, Notice, Skeleton, Txt } from './ui';

/* ---------- status ---------- */

export const BookingBadge = ({ status, side = 'ORGANIZER' }: { status: BookingStatus; side?: Side }) => <Badge label={statusLabel(status, side)} tone={BOOKING_TONE[status]} />;

/* ---------- terms ---------- */

/** A venue's terms for hire: price, rules of booking, amenities, weekly hours and house rules. */
export function TermsCard({ listing, compact }: { listing: VenueListing; compact?: boolean }) {
  const cap = listing.capacity;
  const lines = hoursLines(listing.hours);
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="eyebrow" color={colors.accent}>
            Hire this venue
          </Txt>
          <Txt variant="priceLg">{priceLabel(listing)}</Txt>
        </View>
        {listing.instantBook ? <Badge label="Instant booking" tone="success" /> : null}
      </View>
      <View style={styles.facts}>
        <Fact icon="clock" text={`At least ${plural(listing.minHours, 'hour')}`} />
        <Fact icon="calendar" text={listing.noticeDays ? `Book ${plural(listing.noticeDays, 'day')} ahead` : 'Book any time ahead'} />
        {cap ? <Fact icon="users" text={`Up to ${num(cap)} guests`} /> : null}
        {listing.bufferMinutes ? <Fact icon="sliders" text={`${minutesLabel(listing.bufferMinutes)} setup and cleanup kept free`} /> : null}
      </View>
      {listing.amenities.length ? (
        <View style={styles.wrap}>
          {listing.amenities.map((a) => (
            <Badge key={a} label={a} />
          ))}
        </View>
      ) : null}
      {!compact && lines ? (
        <View style={{ gap: 4 }}>
          <Txt variant="smallStrong" color={colors.muted}>
            Opening hours ({zoneCity(listing.timezone)})
          </Txt>
          {lines.map((l) => (
            <View key={l.day} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt variant="small" color={colors.dim} style={{ width: 38 }}>
                {l.day}
              </Txt>
              <Txt variant="small" color={l.text === 'Closed' ? colors.dim : colors.text} style={{ flex: 1 }}>
                {l.text}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
      {!compact && listing.rules ? (
        <View style={{ gap: 4 }}>
          <Txt variant="smallStrong" color={colors.muted}>
            House rules
          </Txt>
          <Txt variant="small" color={colors.muted}>
            {listing.rules}
          </Txt>
        </View>
      ) : null}
      <Txt variant="tiny" color={colors.dim}>
        {listing.instantBook ? 'Free times are confirmed at once.' : 'The venue confirms or declines within 48 hours; the time is held for you meanwhile.'} Payment is arranged directly with the venue, outside Omoshow.
      </Txt>
    </View>
  );
}

function Fact({ icon, text }: { icon: 'clock' | 'calendar' | 'users' | 'sliders'; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={15} color={colors.muted} />
      <Txt variant="small" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

/* ---------- a booking in a list ---------- */

export function BookingRow({ b, side, onPress, code }: { b: Booking; side: Side; onPress: () => void; /** show the booking code */ code?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${side === 'VENUE' ? b.org.name : b.venue.name}, ${rangeLabel(b.startsAt, b.endsAt)}, ${statusLabel(b.status, side)}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.thumb}>
        {side === 'ORGANIZER' && b.venue.imageUrl ? (
          <Image source={{ uri: b.venue.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={b.id} />
        ) : (
          <Icon name="building" size={22} color={colors.accent} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {side === 'VENUE' ? b.org.name : b.venue.name}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {rangeLabel(b.startsAt, b.endsAt)}
          {code ? ` · ${b.code}` : ''}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <BookingBadge status={b.status} side={side} />
          {side === 'VENUE' ? <Badge label={b.venue.name} /> : b.event ? <Badge label={b.event.title} /> : null}
          {b.guests ? <Badge label={`${num(b.guests)} guests`} /> : null}
        </View>
      </View>
      <Icon name="chevronRight" size={18} color={colors.dim} />
    </Pressable>
  );
}

/* ---------- the request form ---------- */

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const BUSY: Record<'booked' | 'held' | 'closed', string> = { booked: 'Booked', held: 'On hold', closed: 'Closed' };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Whether start–end ("18:00", "23:00") on that day sits inside one of its opening windows (no hours: any time). */
function fitsHours(hours: VenueListing['hours'], ymd: string, start: string, end: string) {
  if (!hours?.length) return true;
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return hours.some((h) => h.day === dow && h.open <= start && end <= h.close);
}

/**
 * The first day the venue can take these times: the start at or after the earliest start its notice allows
 * (`earliestStart`, venue wall-clock) and, when it has opening hours, inside them. Null when nothing fits within
 * 120 days (for example the times are outside every opening window).
 */
export function firstBookableDay(earliestStart: string, hours: VenueListing['hours'], start: string, end: string) {
  let day = earliestStart.slice(0, 10);
  for (let i = 0; i < 120; i++, day = addDays(day, 1)) {
    if (wallIso(day, start) >= earliestStart && fitsHours(hours, day, start, end)) return day;
  }
  return null;
}

/** Default times for a request: an evening (long enough for the venue's minimum), unless the caller gave some. */
function defaultTimes(minHours: number) {
  if (minHours <= 5) return { start: '18:00', end: '23:00' };
  const h = Math.min(9 + minHours, 23);
  return { start: '09:00', end: `${pad2(h)}:00` };
}

/** What the listing price comes to for these times (null with a quote). */
function estimate(l: VenueListing, from: string, to: string) {
  if (l.priceMode === 'QUOTE' || l.priceCents === null) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!(ms > 0)) return null;
  if (l.priceMode === 'HOUR') return { cents: Math.round((l.priceCents * ms) / 3_600_000), unit: `${Math.round((ms / 3_600_000) * 10) / 10} h` };
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return { cents: l.priceCents * days, unit: plural(days, 'day') };
}

/**
 * Ask a venue for a time: which organization, the date and times (the venue's local time), guests and a message.
 * The venue's busy times that day are shown; the API decides (notice, hours, blocked time, overlaps).
 */
export function BookingRequestForm({
  venue,
  listing,
  orgs,
  fixedOrgId,
  defaults,
  submitLabel = 'Request this time',
  onBooked,
}: {
  venue: { id: string; slug: string; name: string };
  listing: VenueListing;
  /** organizations this person can book for (admins and managers) */
  orgs: MyOrg[];
  fixedOrgId?: string;
  defaults?: { date?: string; start?: string; end?: string; guests?: number };
  submitLabel?: string;
  onBooked: (b: Booking) => void;
}) {
  const qc = useQueryClient();
  const [orgId, setOrgId] = useState(fixedOrgId ?? orgs[0]?.org.id ?? '');
  // Null until the organizer picks one: until then the date (and times) are suggested below.
  const [dateIn, setDate] = useState<string | null>(null);
  const [startIn, setStart] = useState<string | null>(null);
  const [endDate, setEndDate] = useState('');
  const [endIn, setEnd] = useState<string | null>(null);
  const [guests, setGuests] = useState(defaults?.guests ? String(defaults.guests) : '');
  const [message, setMessage] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The venue's earliest start (its notice, in venue wall-clock time) and its busy times for the next 120 days (from
  // yesterday here, in case the venue's day is behind this phone's).
  const today = todayYmd();
  const base = useAvailability(venue.slug, addDays(today, -1), addDays(today, 118));
  const earliestStart = base.data?.earliestStart ?? null;
  const preset = defaultTimes(listing.minHours);
  const wantStart = startIn ?? defaults?.start ?? preset.start;
  const wantEnd = endIn ?? defaults?.end ?? preset.end;
  // Until the organizer picks a date or times: the first free time (on the caller's date, the event's, when it's
  // free), skipping busy times. What they picked themselves is never changed.
  const timePicked = startIn !== null || endIn !== null;
  const pinned = dateIn ?? defaults?.date;
  const slot =
    base.data && (dateIn === null || !timePicked)
      ? ((pinned ? freeSlot(base.data, { start: wantStart, end: wantEnd, date: pinned, fixedTime: timePicked }) : null) ??
        (dateIn === null ? freeSlot(base.data, { start: wantStart, end: wantEnd, fixedTime: timePicked }) : null))
      : null;
  const start = startIn ?? slot?.start ?? wantStart;
  const end = endIn ?? slot?.end ?? wantEnd;
  // No free time found: the caller's day when the venue can take it, else the first day it can (busy or not).
  const usable = (d: string) => !earliestStart || (wallIso(d, start) >= earliestStart && fitsHours(listing.hours, d, start, end));
  const fallback = defaults?.date && usable(defaults.date) ? defaults.date : earliestStart ? (firstBookableDay(earliestStart, listing.hours, start, end) ?? defaults?.date ?? '') : (defaults?.date ?? '');
  const date = dateIn ?? slot?.date ?? fallback;

  const lastDay = endDate || date;
  const av = useAvailability(venue.slug, date || undefined, lastDay || undefined);
  const earliest = earliestStart?.slice(0, 10) ?? todayYmd();
  const from = date && start ? wallIso(date, start) : '';
  const to = lastDay && end ? wallIso(lastDay, end) : '';
  const cap = listing.capacity;

  // Busy times on the chosen day(s), or coming up when no day is chosen yet.
  const busyShown = (av.data?.busy ?? []).filter((x) => !date || (x.from < `${addDays(lastDay, 1)}T00:00` && x.to > `${date}T00:00`));
  const clash = from && to ? busyShown.find((x) => x.from < to && x.to > from) : undefined;

  function earliestText() {
    if (!earliestStart) return 'That time has passed.';
    const t = Number(earliestStart.slice(11, 13));
    const clock = `${((t + 11) % 12) + 1}:${earliestStart.slice(14, 16)} ${t < 12 ? 'AM' : 'PM'}`;
    return listing.noticeDays
      ? `${venue.name} needs ${plural(listing.noticeDays, 'day')}’ notice: the earliest start is ${dateLabel(earliestStart.slice(0, 10))}, ${clock}.`
      : `The earliest start is ${dateLabel(earliestStart.slice(0, 10))}, ${clock}.`;
  }
  const tooSoon = earliestText();
  const errors: Record<string, string> = {};
  if (show) {
    if (!orgId) errors.org = 'Pick who the booking is for.';
    if (!date) errors.date = 'Choose a date.';
    else if (date < earliest || (earliestStart && from && from < earliestStart)) errors.date = tooSoon;
    if (!start) errors.start = 'Add a start time.';
    if (!end) errors.end = 'Add an end time.';
    if (endDate && date && endDate < date) errors.endDate = 'The end date can’t be before the start date.';
    if (from && to && to <= from) errors.end = endDate ? 'The end has to be after the start.' : 'The end has to be after the start. Ending after midnight? Set the end date to the next day.';
    else if (from && to && new Date(to).getTime() - new Date(from).getTime() < listing.minHours * 3_600_000) errors.end = `Book at least ${plural(listing.minHours, 'hour')}.`;
    const g = Number(guests);
    if (guests && (!Number.isInteger(g) || g < 1)) errors.guests = 'Enter a number of guests.';
    else if (guests && cap && g > cap) errors.guests = `${venue.name} takes up to ${num(cap)} guests.`;
    if (clash) errors.end = errors.end ?? `That overlaps a busy time (${timesLabel(clash.from, clash.to)}). Pick another time.`;
  }

  const est = from && to && to > from ? estimate(listing, from, to) : null;

  const submit = async () => {
    setError('');
    setShow(true);
    // The same checks as above, without waiting for a render.
    const g = Number(guests);
    const bad =
      !orgId ||
      !date ||
      date < earliest ||
      (!!earliestStart && from < earliestStart) ||
      !start ||
      !end ||
      !from ||
      !to ||
      to <= from ||
      new Date(to).getTime() - new Date(from).getTime() < listing.minHours * 3_600_000 ||
      (!!guests && (!Number.isInteger(g) || g < 1 || (!!cap && g > cap))) ||
      !!clash;
    if (bad) {
      haptic.warning();
      return;
    }
    setBusy(true);
    try {
      const b = await api<Booking>(`/organizer/orgs/${encodeURIComponent(orgId)}/venue-bookings`, {
        body: { venueId: venue.id, startsAt: from, endsAt: to, ...(guests ? { guests: g } : {}), ...(message.trim() ? { message: message.trim().slice(0, 1000) } : {}) },
      });
      haptic.success();
      await qc.invalidateQueries({ queryKey: ['bookings'] });
      await qc.invalidateQueries({ queryKey: ['venue', 'availability', venue.slug] });
      onBooked(b);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
      // Someone else got there first: show the venue's busy times as they are now.
      if (e instanceof ApiError && (e.code === 'VENUE_TIME_TAKEN' || e.code === 'VENUE_CLOSED')) void av.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.lg }}>
      {!fixedOrgId && orgs.length > 1 ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="smallStrong" color={colors.muted}>
            Booking for
          </Txt>
          <View style={styles.wrap}>
            {orgs.map((o) => (
              <Chip key={o.org.id} label={o.org.name} active={o.org.id === orgId} onPress={() => setOrgId(o.org.id)} />
            ))}
          </View>
          {errors.org ? (
            <Txt variant="small" color={colors.accentHi}>
              {errors.org}
            </Txt>
          ) : null}
        </View>
      ) : null}

      <DateField label="Date" value={date} onChange={setDate} min={earliest} error={errors.date} hint={listing.noticeDays ? `Book at least ${plural(listing.noticeDays, 'day')} ahead.` : undefined} />
      <View style={styles.row2}>
        <TimeField label="From" value={start} onChange={setStart} error={errors.start} />
        <TimeField label="Until" value={end} onChange={setEnd} error={errors.end} />
      </View>
      <View style={styles.row2}>
        <DateField label="Ends on (optional)" value={endDate} onChange={setEndDate} min={date || earliest} error={errors.endDate} hint={endDate ? undefined : 'Same day'} />
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>{endDate ? <Button label="Same day" variant="subtle" size="sm" onPress={() => setEndDate('')} /> : null}</View>
      </View>
      <Txt variant="small" color={colors.dim}>
        Times are {zoneCity(listing.timezone)}, at the venue. Include your setup; the venue keeps {minutesLabel(listing.bufferMinutes)} free around each booking.
      </Txt>

      <View style={styles.busy}>
        <Txt variant="smallStrong">{date ? `${dateLabel(date)}${endDate && endDate !== date ? ` to ${dateLabel(endDate)}` : ''}` : 'Busy times coming up'}</Txt>
        {date && hoursOn(listing.hours, date) ? (
          <Txt variant="small" color={hoursOn(listing.hours, date) === 'Closed' ? colors.accentHi : colors.muted}>
            Open {hoursOn(listing.hours, date)}
          </Txt>
        ) : null}
        {av.isPending ? (
          <Skeleton height={36} />
        ) : av.error ? (
          <Txt variant="small" color={colors.dim}>
            {errorText(av.error)}
          </Txt>
        ) : busyShown.length ? (
          busyShown.slice(0, date ? 12 : 6).map((x) => (
            <View key={`${x.from}-${x.to}-${x.kind}`} style={styles.busyLine}>
              <View style={[styles.dot, { backgroundColor: x.kind === 'booked' ? colors.accent : x.kind === 'held' ? colors.warning : colors.dim }]} />
              <Txt variant="small" style={{ flex: 1 }}>
                {date ? timesLabel(x.from, x.to) : rangeLabel(x.from, x.to)}
              </Txt>
              <Txt variant="tiny" color={colors.dim}>
                {BUSY[x.kind]}
              </Txt>
            </View>
          ))
        ) : (
          <Txt variant="small" color={colors.success}>
            {date ? 'Nothing booked that day.' : 'Nothing booked yet.'}
          </Txt>
        )}
      </View>

      <Field
        label="Guests (optional)"
        placeholder={cap ? `Up to ${num(cap)}` : 'How many people'}
        keyboardType="number-pad"
        value={guests}
        onChangeText={(v) => setGuests(v.replace(/\D/g, ''))}
        error={errors.guests}
      />
      <Field label="Message to the venue (optional)" placeholder="What’s the event? Anything they should know?" value={message} onChangeText={setMessage} multiline maxLength={1000} inputStyle={{ minHeight: 88, paddingTop: 14, textAlignVertical: 'top' }} />

      {est ? (
        <Notice tone="plain" icon="cash" title={`About ${money(est.cents, listing.currency)} for ${est.unit}`}>
          The listing price, shown only. You pay the venue directly, the way you agree with them; Omoshow doesn’t take this payment.
        </Notice>
      ) : listing.priceMode === 'QUOTE' ? (
        <Notice tone="plain" icon="cash" title="The venue quotes the price">
          You pay them directly, outside Omoshow.
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}
      <Button label={listing.instantBook ? 'Book this time' : submitLabel} icon="send" loading={busy} onPress={() => void submit()} />
    </View>
  );
}

/* ---------- finding a venue ---------- */

/** Search the venues taking bookings on Omoshow; tap one to pick it. */
export function VenueSearch({ date, guests, onPick }: { date?: string; guests?: number; onPick: (r: ListingResult) => void }) {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [term, setTerm] = useState({ q: '', city: '' });
  useEffect(() => {
    const t = setTimeout(() => setTerm({ q: q.trim(), city: city.trim() }), 350);
    return () => clearTimeout(t);
  }, [q, city]);
  const res = useQuery({
    queryKey: ['venue-listings', term.q, term.city, date ?? '', guests ?? 0],
    queryFn: () => api<ListingResult[]>(`/venue-listings${qs({ q: term.q || undefined, city: term.city || undefined, date: date || undefined, guests: guests || undefined })}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.row2}>
        <Field style={{ flex: 1 }} label="Venue" placeholder="Name" value={q} onChangeText={setQ} autoCorrect={false} />
        <Field style={{ flex: 1 }} label="City" placeholder="Any city" value={city} onChangeText={setCity} autoCorrect={false} />
      </View>
      {date ? (
        <Txt variant="small" color={colors.dim}>
          Showing venues open on {dateLabel(date)}
          {guests ? ` for ${num(guests)} guests` : ''}.
        </Txt>
      ) : null}
      {res.isPending ? (
        <>
          <Skeleton height={76} radius={radius.card} />
          <Skeleton height={76} radius={radius.card} />
        </>
      ) : res.error ? (
        <Notice tone="plain" icon="alert" action="Try again" onAction={() => void res.refetch()}>
          {errorText(res.error)}
        </Notice>
      ) : !res.data?.length ? (
        <EmptyState compact icon="building" title="No venues found" body={date ? 'None of the venues on Omoshow are free that day with this search. Try another date or city.' : 'Try another name or city.'} />
      ) : (
        res.data.map((r) => (
          <Pressable
            key={r.venue.id}
            accessibilityRole="button"
            accessibilityLabel={`${r.venue.name}, ${cityOnly(r.venue.city)}, ${priceLabel(r.listing)}`}
            onPress={() => {
              haptic.tap();
              onPick(r);
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
            <View style={styles.thumb}>{r.venue.imageUrl ? <Image source={{ uri: r.venue.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={r.venue.id} /> : <Icon name="building" size={22} color={colors.accent} />}</View>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {r.venue.name}
              </Txt>
              <Txt variant="small" color={colors.muted} numberOfLines={1}>
                {cityOnly(r.venue.city)} · {priceLabel(r.listing)}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {r.listing.capacity ? <Badge label={`Up to ${num(r.listing.capacity)}`} /> : null}
                {r.listing.instantBook ? <Badge label="Instant" tone="success" /> : null}
                {r.venue.verified ? <Badge label="Verified" tone="accent" /> : null}
              </View>
            </View>
            <Icon name="chevronRight" size={18} color={colors.dim} />
          </Pressable>
        ))
      )}
    </View>
  );
}

/* ---------- messages ---------- */

/** The conversation on one booking, between the organizer's team and the venue's managers only. */
export function MessageThread({ side, id, messages, canWrite }: { side: Side; id: string; messages: BookingMessage[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      await api(`${bookingPath(side, id)}/messages`, { body: { body: body.slice(0, 2000) } });
      haptic.success();
      setText('');
      await qc.invalidateQueries({ queryKey: ['bookings', side, id] });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      {!messages.length ? (
        <Txt variant="small" color={colors.dim}>
          No messages yet. Only {side === 'ORGANIZER' ? 'the venue’s managers' : 'the organizer’s team'} and your side can read them.
        </Txt>
      ) : (
        messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
            <Txt variant="tiny" color={m.mine ? colors.accentHi : colors.dim}>
              {m.mine ? 'You' : (m.author ?? (m.side === 'VENUE' ? 'The venue' : 'The organizer'))} · {stamp(m.createdAt)}
            </Txt>
            <Txt selectable>{m.body}</Txt>
          </View>
        ))
      )}
      {canWrite ? (
        <>
          <Field label="Write a message" placeholder="Ask a question or share details" value={text} onChangeText={setText} multiline maxLength={2000} inputStyle={{ minHeight: 72, paddingTop: 14, textAlignVertical: 'top' }} />
          {error ? <Notice icon="alert">{error}</Notice> : null}
          <Button label="Send" icon="send" variant="ghost" size="md" loading={busy} disabled={!text.trim()} onPress={() => void send()} />
        </>
      ) : null}
    </View>
  );
}

/** "Just now", "5m ago", "3h ago", else the date on this phone. */
function stamp(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const d = new Date(iso);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  facts: { gap: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  row2: { flexDirection: 'row', gap: space.md },
  busy: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.bg2 },
  busyLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bubble: { gap: 4, maxWidth: '88%', padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.line2 },
});
