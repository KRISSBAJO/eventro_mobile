/**
 * A venue's details as its managers keep them (PATCH /me/venues/:id): about, address and postcode, phone, capacity,
 * website and photo link. Only changed fields are sent. Links are cleared with null and text with ''; the API can't
 * clear a phone number or capacity, so those can be changed but not emptied.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formStyles, GradientButton, Section } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { OrgScreen } from '@/components/org-ui';
import { managerGate } from '@/components/venue-owner';
import { Button, Field, Notice, TextArea, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ManagedVenue } from '@/lib/bookings';
import { haptic } from '@/lib/haptics';
import { linkError, PHONE_RE, URL_RE, useManagedVenue, wholeIn } from '@/lib/my-venues';
import { colors, radius, space } from '@/theme';

type Key = 'about' | 'address' | 'postalCode' | 'phone' | 'capacity' | 'website' | 'imageUrl';

const formOf = (v: ManagedVenue): Record<Key, string> => ({
  about: v.about ?? '',
  address: v.address,
  postalCode: v.postalCode ?? '',
  phone: v.phone ?? '',
  capacity: v.capacity ? String(v.capacity) : '',
  website: v.website ?? '',
  imageUrl: v.imageUrl ?? '',
});

/** The changed fields in the API's shape, and each field's problem. */
function changes(v: ManagedVenue, f: Record<Key, string>) {
  const was = formOf(v);
  const body: Record<string, unknown> = {};
  const errors: Partial<Record<Key, string>> = {};
  const val = (k: Key) => f[k].trim();
  const changed = (k: Key) => val(k) !== was[k].trim();
  if (changed('about')) {
    if (val('about').length > 2000) errors.about = 'Keep it to 2,000 characters.';
    body.about = val('about');
  }
  if (changed('address')) {
    if (val('address').length < 3) errors.address = 'Add the street address.';
    body.address = val('address');
  }
  if (changed('postalCode')) body.postalCode = val('postalCode');
  if (changed('phone')) {
    if (!val('phone')) errors.phone = 'The phone number can be changed but not removed.';
    else if (!PHONE_RE.test(val('phone'))) errors.phone = 'Enter the phone number with its country code, e.g. +234 803 000 0000.';
    body.phone = val('phone');
  }
  if (changed('capacity')) {
    const c = wholeIn(f.capacity, 1, 500_000, 'Capacity');
    if (!val('capacity') || c.error) errors.capacity = val('capacity') ? 'Capacity is a whole number of people, from 1 to 500,000.' : 'The capacity can be changed but not removed.';
    body.capacity = c.n;
  }
  if (changed('website')) {
    const e = linkError(f.website, 'The website', 200);
    if (e) errors.website = e;
    body.website = val('website') || null;
  }
  if (changed('imageUrl')) {
    const e = linkError(f.imageUrl, 'The photo link', 500);
    if (e) errors.imageUrl = e;
    body.imageUrl = val('imageUrl') || null;
  }
  return { body, errors };
}

export default function DetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { q, m } = useManagedVenue(id);
  const gate = managerGate('Venue details', !!user, q, !!m, { pathname: '/my-venues/[id]', params: { id } });
  if (gate || !m) return gate;
  return <DetailsForm key={m.venue.id} venue={m.venue} />;
}

function DetailsForm({ venue }: { venue: ManagedVenue }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => formOf(venue));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { body, errors: problems } = changes(venue, f);
  const errors = tried ? problems : {};
  const first = Object.values(problems)[0];
  const dirty = Object.keys(body).length > 0;
  const input = (k: Key) => ({
    value: f[k],
    error: errors[k],
    onChangeText: (v: string) => {
      setNote('');
      setF((p) => ({ ...p, [k]: v }));
    },
  });
  const photo = URL_RE.test(f.imageUrl.trim()) ? f.imageUrl.trim() : null;

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
      await api(`/me/venues/${encodeURIComponent(venue.id)}`, { method: 'PATCH', body });
      haptic.success();
      await Promise.all([qc.invalidateQueries({ queryKey: ['me', 'venues'] }), qc.invalidateQueries({ queryKey: ['venue', venue.slug] })]);
      setNote('Saved. The venue’s page updates within a minute.');
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
      title="Venue details"
      eyebrow={venue.name}
      fallback={{ pathname: '/my-venues/[id]', params: { id: venue.id } }}
      footer={
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {dirty ? (
            <Button
              label="Discard"
              variant="ghost"
              style={{ width: 110 }}
              disabled={busy}
              onPress={() => {
                setF(formOf(venue));
                setTried(false);
                setError('');
              }}
            />
          ) : null}
          <GradientButton label={dirty ? 'Save changes' : 'Saved'} icon="check" loading={busy} disabled={!dirty} onPress={() => void save()} />
        </View>
      }>
      <Section icon="file" title="About" sub="What it’s like, getting there, accessibility, food and drink.">
        <TextArea label="About the venue" placeholder="Leave a blank line between paragraphs." maxLength={2000} minHeight={130} {...input('about')} />
      </Section>

      <Section icon="pin" title="Address">
        <Field label="Street address" maxLength={200} {...input('address')} />
        <Field label="Postal code (optional)" maxLength={20} autoCapitalize="characters" {...input('postalCode')} />
        <Txt variant="small" color={colors.dim}>
          The name, city and country are checked by Omoshow: contact support to change them.
        </Txt>
      </Section>

      <Section icon="phone" title="Contact and size">
        <View style={formStyles.row2}>
          <Field style={{ flex: 1.4 }} label="Phone" placeholder="+234 803 000 0000" keyboardType="phone-pad" maxLength={25} {...input('phone')} />
          <Field style={{ flex: 1 }} label="Capacity" placeholder="e.g. 4000" keyboardType="number-pad" {...input('capacity')} />
        </View>
        <Field label="Website (optional)" placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={200} {...input('website')} />
      </Section>

      <Section icon="sparkle" title="Photo" sub="A link to a photo of the venue, shown at the top of its page.">
        <View style={styles.photo}>
          {photo ? (
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          ) : (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Icon name="building" size={24} color={colors.dim} />
              <Txt variant="small" color={colors.dim}>
                No photo yet
              </Txt>
            </View>
          )}
        </View>
        <Field label="Photo link (optional)" placeholder="https://…/photo.jpg" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={500} {...input('imageUrl')} />
      </Section>

      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : tried && first ? <Notice icon="alert">{first}</Notice> : null}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
