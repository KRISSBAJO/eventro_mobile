/**
 * A venue's terms for hire (GET/PUT /me/venues/:id/listing): bookings on or off, the price (per hour, per day or a
 * quote) in a currency (a new listing starts in the venue country's), the shortest booking, notice, setup and
 * cleanup time kept free around each booking, most guests, what's included, house rules and instant booking.
 * Prices are typed in major units and sent in minor units. Opening hours have their own screen (hours.tsx).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ChoiceRow, ChoiceTile, formStyles, GradientButton, RemovableChip, Section, ToggleCard } from '@/components/form-ui';
import { OptionSheet } from '@/components/option-sheet';
import { OrgScreen } from '@/components/org-ui';
import { Pick } from '@/components/venue-fields';
import { managerGate } from '@/components/venue-owner';
import { Button, Field, Notice, TextArea, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { minutesLabel, type ManagedVenue, type PriceMode } from '@/lib/bookings';
import { currencySymbol, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { listingKey, useManagedVenue, useOwnerListing, wholeIn, type OwnerListing } from '@/lib/my-venues';
import { CURRENCIES, moneyInput, parseMoney } from '@/lib/organizer';
import { colors, space } from '@/theme';

type Form = {
  active: boolean;
  priceMode: PriceMode;
  price: string;
  currency: string;
  minHours: string;
  noticeDays: string;
  bufferMinutes: string;
  capacity: string;
  amenities: string[];
  rules: string;
  instantBook: boolean;
};

const formOf = (l: OwnerListing): Form => ({
  active: l.active,
  priceMode: l.priceMode,
  price: l.priceCents !== null ? moneyInput(l.priceCents) : '',
  // The API answers a new listing in the venue country's currency.
  currency: l.currency,
  minHours: String(l.minHours),
  noticeDays: String(l.noticeDays),
  bufferMinutes: String(l.bufferMinutes),
  capacity: l.capacity ? String(l.capacity) : '',
  amenities: l.amenities,
  rules: l.rules ?? '',
  instantBook: l.instantBook,
});

const MODES: { id: PriceMode; label: string; sub: string; icon: 'clock' | 'calendar' | 'send' }[] = [
  { id: 'HOUR', label: 'Per hour', sub: 'By the hour', icon: 'clock' },
  { id: 'DAY', label: 'Per day', sub: 'Or part of one', icon: 'calendar' },
  { id: 'QUOTE', label: 'Quote', sub: 'Price each one', icon: 'send' },
];

/** The API's checks, and the body for PUT (keys of `errors` match the fields). */
function check(f: Form, venueCapacity: number | null) {
  const errors: Record<string, string> = {};
  const cents = parseMoney(f.price);
  if (f.priceMode !== 'QUOTE' && (cents === null || cents > 500_000_000)) errors.price = `Set a price per ${f.priceMode === 'HOUR' ? 'hour' : 'day'}, or choose “Ask for a quote”.`;
  const minHours = wholeIn(f.minHours, 1, 72, 'Shortest booking (hours)');
  if (minHours.error) errors.minHours = minHours.error;
  const notice = wholeIn(f.noticeDays, 0, 365, 'Notice (days)');
  if (notice.error) errors.noticeDays = notice.error;
  const buffer = wholeIn(f.bufferMinutes, 0, 720, 'Setup and cleanup (minutes)');
  if (buffer.error) errors.bufferMinutes = buffer.error;
  const cap = f.capacity.trim() ? wholeIn(f.capacity, 1, 500_000, 'Most guests') : { n: 0, error: '' };
  if (cap.error) errors.capacity = cap.error;
  else if (f.capacity.trim() && venueCapacity !== null && cap.n > venueCapacity) errors.capacity = `Guests can’t be more than the venue holds (${num(venueCapacity)}).`;
  if (f.rules.length > 3000) errors.rules = 'Keep the house rules to 3,000 characters.';
  return {
    errors,
    body: {
      active: f.active,
      priceMode: f.priceMode,
      priceCents: f.priceMode === 'QUOTE' ? null : cents,
      currency: f.currency,
      minHours: minHours.n,
      noticeDays: notice.n,
      bufferMinutes: buffer.n,
      capacity: f.capacity.trim() ? cap.n : null,
      amenities: f.amenities,
      rules: f.rules.trim() || null,
      instantBook: f.instantBook,
    },
  };
}

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { q, m } = useManagedVenue(id);
  const listing = useOwnerListing(m ? id : undefined);
  const back = { pathname: '/my-venues/[id]', params: { id } } as const;
  const gate = managerGate('Listing and price', !!user, m ? listing : q, !!m && !!listing.data, back);
  if (gate || !m || !listing.data) return gate;
  // Keyed by venue: the form starts from the saved listing once, and keeps what's typed across refreshes.
  return <ListingForm key={m.venue.id} venue={m.venue} saved={listing.data} />;
}

function ListingForm({ venue, saved }: { venue: ManagedVenue; saved: OwnerListing }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => formOf(saved));
  const [amenity, setAmenity] = useState('');
  const [sheet, setSheet] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const set = (patch: Partial<Form>) => {
    setNote('');
    setF((p) => ({ ...p, ...patch }));
  };
  const { errors: problems, body } = check(f, saved.venueCapacity);
  const errors = tried ? problems : {};
  const first = Object.values(problems)[0];
  const dirty = !saved.exists || JSON.stringify(body) !== JSON.stringify(check(formOf(saved), saved.venueCapacity).body);
  const unit = f.priceMode === 'HOUR' ? 'hour' : 'day';

  const addAmenity = () => {
    const v = amenity.trim().replace(/\s+/g, ' ').slice(0, 40);
    setAmenity('');
    if (v.length < 2) return;
    if (f.amenities.length >= 30) {
      setError('Up to 30 things can be listed.');
      return;
    }
    if (!f.amenities.some((a) => a.toLowerCase() === v.toLowerCase())) set({ amenities: [...f.amenities, v] });
  };

  const save = async () => {
    setTried(true);
    setError('');
    setNote('');
    if (first) {
      haptic.warning();
      return;
    }
    setBusy(true);
    try {
      const out = await api<OwnerListing>(`/me/venues/${encodeURIComponent(venue.id)}/listing`, { method: 'PUT', body });
      haptic.success();
      qc.setQueryData(listingKey(venue.id), out);
      await Promise.all([qc.invalidateQueries({ queryKey: ['me', 'venues'] }), qc.invalidateQueries({ queryKey: ['venue', venue.slug] })]);
      setNote(out.active ? `Saved. ${venue.name} is taking bookings: organizers can find it and request times.` : 'Saved. It isn’t shown to organizers until you switch bookings on.');
      setTried(false);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgScreen
      title="Listing and price"
      eyebrow={venue.name}
      fallback={{ pathname: '/my-venues/[id]', params: { id: venue.id } }}
      footer={
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {saved.exists && dirty ? (
            <Button
              label="Discard"
              variant="ghost"
              style={{ width: 110 }}
              disabled={busy} 
              onPress={() => {
                setF(formOf(saved));
                setTried(false);
                setError('');
              }}
            />
          ) : null}
          <GradientButton label={saved.exists ? (dirty ? 'Save listing' : 'Saved') : 'Create listing'} icon="check" loading={busy} disabled={!dirty} onPress={() => void save()} />
        </View>
      }>
      <ToggleCard
        label={f.active ? 'Taking bookings on Omoshow' : 'Not taking bookings'}
        sub={f.active ? 'Organizers can find it under “Book a venue” and request times.' : 'Switch on to show your price and “Book this venue” on its page.'}
        value={f.active}
        disabled={saved.hidden && !f.active}
        onChange={(active) => set({ active })}
      />
      {saved.hidden ? (
        <Notice tone="warning" icon="lock">
          This venue is hidden on Omoshow, so it can’t take bookings. Contact Omoshow support.
        </Notice>
      ) : null}

      <Section icon="cash" title="Price" sub="Shown on the venue’s page. Omoshow doesn’t take this payment: you agree on it with the organizer.">
        <ChoiceRow>
          {MODES.map((x) => (
            <ChoiceTile key={x.id} icon={x.icon} label={x.label} sub={x.sub} on={f.priceMode === x.id} onPress={() => set({ priceMode: x.id })} />
          ))}
        </ChoiceRow>
        {f.priceMode === 'QUOTE' ? (
          <Txt variant="small" color={colors.muted}>
            Organizers see “Price on request”. You can give a price when you confirm each booking.
          </Txt>
        ) : (
          <View style={formStyles.row2}>
            <Field
              style={{ flex: 1.3 }}
              label={`Price per ${unit} (${currencySymbol(f.currency)})`}
              placeholder="e.g. 50000"
              keyboardType="decimal-pad"
              value={f.price}
              onChangeText={(price) => set({ price: price.replace(/[^\d.,]/g, '') })}
              error={errors.price}
            />
            <View style={{ flex: 1 }}>
              <Pick label="Currency" value={f.currency} placeholder="Currency" onPress={() => setSheet(true)} active={sheet} />
            </View>
          </View>
        )}
      </Section>

      <Section icon="sliders" title="Terms" sub="The rules every request has to follow.">
        <View style={formStyles.row2}>
          <Field style={{ flex: 1 }} label="Shortest booking (hours)" keyboardType="number-pad" value={f.minHours} onChangeText={(v) => set({ minHours: v.replace(/\D/g, '') })} maxLength={2} error={errors.minHours} />
          <Field style={{ flex: 1 }} label="Notice (days)" keyboardType="number-pad" value={f.noticeDays} onChangeText={(v) => set({ noticeDays: v.replace(/\D/g, '') })} maxLength={3} error={errors.noticeDays} />
        </View>
        <View style={formStyles.row2}>
          <Field
            style={{ flex: 1 }}
            label="Setup and cleanup (min)"
            keyboardType="number-pad"
            value={f.bufferMinutes}
            onChangeText={(v) => set({ bufferMinutes: v.replace(/\D/g, '') })}
            maxLength={3}
            error={errors.bufferMinutes}
            hint={!errors.bufferMinutes && /^\d+$/.test(f.bufferMinutes) && Number(f.bufferMinutes) >= 60 ? minutesLabel(Number(f.bufferMinutes)) : undefined}
          />
          <Field
            style={{ flex: 1 }}
            label="Most guests (optional)"
            placeholder={saved.venueCapacity ? `Up to ${num(saved.venueCapacity)}` : 'e.g. 400'}
            keyboardType="number-pad"
            value={f.capacity}
            onChangeText={(v) => set({ capacity: v.replace(/[^\d,]/g, '') })}
            error={errors.capacity}
          />
        </View>
        <Txt variant="small" color={colors.dim}>
          Setup and cleanup time is kept free before and after every booking, so two events never run into each other. Notice is how far ahead organizers have to book.
        </Txt>
      </Section>

      <Section icon="sparkle" title="What’s included" sub="Equipment, rooms and services organizers get. Up to 30.">
        {f.amenities.length ? (
          <View style={formStyles.wrap}>
            {f.amenities.map((a) => (
              <RemovableChip key={a} label={a} onRemove={() => set({ amenities: f.amenities.filter((x) => x !== a) })} />
            ))}
          </View>
        ) : null}
        <View style={[formStyles.row2, { alignItems: 'flex-end' }]}>
          <Field style={{ flex: 1 }} label="Add one" placeholder="e.g. PA system" value={amenity} onChangeText={setAmenity} maxLength={40} returnKeyType="done" onSubmitEditing={addAmenity} blurOnSubmit={false} />
          <Button label="Add" icon="plus" variant="ghost" size="md" style={{ marginBottom: 3 }} disabled={amenity.trim().length < 2} onPress={addAmenity} />
        </View>
      </Section>

      <Section icon="file" title="House rules" sub="Optional. Shown with the price, before anyone requests a time.">
        <TextArea label="House rules" value={f.rules} onChangeText={(rules) => set({ rules })} maxLength={3000} minHeight={120} placeholder="Curfew, noise limits, outside catering, deposits, how payment works…" error={errors.rules} />
      </Section>

      <ToggleCard
        label="Instant booking"
        sub={f.instantBook ? 'Requests for free times are confirmed at once.' : 'You confirm or decline each request within 48 hours.'}
        value={f.instantBook}
        onChange={(instantBook) => set({ instantBook })}
      />

      <Button label="Opening hours" icon="clock" iconRight="chevronRight" variant="subtle" size="md" onPress={() => router.push({ pathname: '/my-venues/[id]/hours', params: { id: venue.id } })} />

      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : tried && first ? <Notice icon="alert">{first}</Notice> : null}

      <OptionSheet<string>
        visible={sheet}
        title="Currency"
        options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
        value={f.currency}
        onPick={(currency) => set({ currency })}
        onClose={() => setSheet(false)}
      />
    </OrgScreen>
  );
}
