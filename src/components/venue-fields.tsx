/**
 * Where an in-person event happens: country, venue name, street, city, state, postal code and, in countries with
 * several time zones (US, CA, AU), the zone. Shared by Create (its "When and where" step) and Change venue.
 *
 * The zone fills itself in from the state ("Texas" → Central, GET /geo/timezone?country&region) or, with no state,
 * this phone's zone when it's one of the country's; a zone the organizer picked themselves is never changed.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { countryName } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { COUNTRY_ZONES, deviceZone, VENUE_COUNTRIES } from '@/lib/organizer';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { OptionSheet } from './option-sheet';
import { Field, Txt } from './ui';

export type VenuePlace = {
  country: string;
  venue: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  zone: string;
  /** The organizer chose the zone themselves, so the state-based guess leaves it alone. */
  zonePicked: boolean;
};

export const EMPTY_PLACE: VenuePlace = { country: '', venue: '', address: '', city: '', region: '', postalCode: '', zone: '', zonePicked: false };

/** The checks for these fields (keys match the fields' errors). */
export function placeErrors(v: VenuePlace) {
  const e: Record<string, string> = {};
  if (!/^[A-Z]{2}$/.test(v.country)) e.country = 'Choose the country.';
  if (v.venue.trim().length < 2) e.venue = 'Add the venue name.';
  if (v.address.trim().length < 3) e.address = 'Add the street address.';
  if (v.city.trim().length < 2) e.city = 'Add the city.';
  if (COUNTRY_ZONES[v.country] && !v.zone) e.zone = 'Choose the time zone the times are in.';
  return e;
}

/** The venue for POST …/events and PUT …/events/:id/venue. */
export const placeBody = (v: VenuePlace) => ({
  name: v.venue.trim(),
  address: v.address.trim(),
  city: v.city.trim(),
  country: v.country,
  ...(v.region.trim() ? { region: v.region.trim() } : {}),
  ...(v.postalCode.trim() ? { postalCode: v.postalCode.trim() } : {}),
});

/** A new country: keep the zone when it belongs to it, else this phone's zone if it's one of the country's. */
export function countryPatch(v: VenuePlace, c: string): Partial<VenuePlace> {
  const keep = !!COUNTRY_ZONES[c]?.some((z) => z.id === v.zone);
  return { country: c, zone: keep ? v.zone : (COUNTRY_ZONES[c]?.find((z) => z.id === deviceZone())?.id ?? ''), zonePicked: keep ? v.zonePicked : false };
}

export function VenueFields({ value: v, onChange, errors }: { value: VenuePlace; onChange: (patch: Partial<VenuePlace>) => void; errors: Record<string, string | undefined> }) {
  const [sheet, setSheet] = useState<'' | 'country' | 'zone'>('');

  // In countries with several zones, fill the zone in from the state or, with no state and no matching phone zone,
  // the country's main zone. A zone the organizer picked themselves is never changed.
  const zoneCountry = COUNTRY_ZONES[v.country] && !v.zonePicked ? v.country : '';
  const zoneRegion = v.region.trim();
  const zoneNow = v.zone;
  useEffect(() => {
    if (!zoneCountry || (!zoneRegion && zoneNow)) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ timezone: string | null }>(`/geo/timezone?country=${zoneCountry}${zoneRegion ? `&region=${encodeURIComponent(zoneRegion)}` : ''}`)
        .then((r) => {
          if (!live || !r.timezone || r.timezone === zoneNow || !COUNTRY_ZONES[zoneCountry]?.some((z) => z.id === r.timezone)) return;
          onChange({ zone: r.timezone });
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // onChange is a new function each render; the guess depends only on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneCountry, zoneRegion, zoneNow]);

  return (
    <>
      <Pick label="Country" value={v.country ? countryName(v.country) : ''} placeholder="Choose the country" error={errors.country} onPress={() => setSheet('country')} />
      <Field label="Venue name" placeholder="e.g. Eko Convention Centre" value={v.venue} onChangeText={(x) => onChange({ venue: x })} maxLength={120} error={errors.venue} />
      <Field label="Street address" value={v.address} onChangeText={(x) => onChange({ address: x })} maxLength={200} error={errors.address} />
      <View style={styles.row2}>
        <Field style={{ flex: 1 }} label="City" value={v.city} onChangeText={(x) => onChange({ city: x })} maxLength={80} error={errors.city} />
        <Field style={{ flex: 1 }} label="State (optional)" value={v.region} onChangeText={(x) => onChange({ region: x })} maxLength={80} />
      </View>
      <Field label="Postal code (optional)" value={v.postalCode} onChangeText={(x) => onChange({ postalCode: x })} maxLength={20} autoCapitalize="characters" />
      {COUNTRY_ZONES[v.country] ? (
        <Pick
          label="Time zone"
          value={COUNTRY_ZONES[v.country].find((z) => z.id === v.zone)?.label ?? ''}
          placeholder="Choose the venue’s time zone"
          error={errors.zone}
          hint="Times are local to the venue."
          onPress={() => setSheet('zone')}
        />
      ) : (
        <Txt variant="small" color={colors.dim}>
          Times are local to the venue.
        </Txt>
      )}
      <OptionSheet<string>
        visible={sheet === 'country'}
        title="Country"
        options={VENUE_COUNTRIES.map((c) => ({ value: c, label: countryName(c) }))}
        value={v.country}
        onPick={(c) => onChange(countryPatch(v, c))}
        onClose={() => setSheet('')}
      />
      <OptionSheet<string>
        visible={sheet === 'zone'}
        title="Time zone"
        options={(COUNTRY_ZONES[v.country] ?? []).map((z) => ({ value: z.id, label: z.label, detail: z.id.split('/')[1]?.replace(/_/g, ' ') }))}
        value={v.zone}
        onPick={(z) => onChange({ zone: z, zonePicked: true })}
        onClose={() => setSheet('')}
      />
    </>
  );
}

export function Pick({ label, value, placeholder, error, hint, onPress }: { label: string; value: string; placeholder: string; error?: string; hint?: string; onPress: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="smallStrong" color={colors.muted}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}`}
        onPress={() => {
          haptic.select();
          onPress();
        }}
        style={({ pressed }) => [styles.pick, !!error && { borderColor: colors.accent }, pressed && { backgroundColor: colors.surface2 }]}>
        <Txt color={value ? colors.text : colors.dim} style={{ flex: 1 }} numberOfLines={1}>
          {value || placeholder}
        </Txt>
        <Icon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
      {error ? (
        <Txt variant="small" color={colors.accentHi}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" color={colors.dim}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row2: { flexDirection: 'row', gap: space.md },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
});
