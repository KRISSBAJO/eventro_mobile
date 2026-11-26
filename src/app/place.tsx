/** Choose where you are: your precise position, a country or a city, or back to the automatic guess. */
import * as Location from 'expo-location';
import { sampleCatalog, availableSamples } from '@/components/sample-events';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Divider, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { flag } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { nearestCountry, placeOptions, preciseLocation, usePlace, type Place } from '@/lib/place';
import { useAllEvents } from '@/lib/queries';
import { colors, gutter, radius, space, touch } from '@/theme';

export default function PlacePicker() {
  const insets = useSafeAreaInsets();
  const { place, save } = usePlace();
  const all = useAllEvents();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const live = all.data?.items ?? [];
  const options = placeOptions([...live, ...availableSamples(live)]);
  const close = () => router.canGoBack() ? router.back() : router.replace('/');

  const pick = (p: Place | null) => {
    haptic.select();
    save(p);
    close();
  };

  const usePrecise = async () => {
    setLocating(true);
    setError('');
    try {
      const { lat, lng } = await preciseLocation();
      haptic.success();
      const address = Platform.OS === 'web' ? undefined : (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).catch(() => []))[0];
      pick({ country: address?.isoCountryCode ?? nearestCountry([...live, ...sampleCatalog], lat, lng) ?? place?.country ?? '', city: address?.city ?? undefined, lat, lng, source: 'precise' });
    } catch (e) {
      haptic.warning();
      setError(errorText(e));
    } finally {
      setLocating(false);
    }
  };

  const isOn = (code: string, city?: string) => place?.source === 'picked' && place.country === code && (city ? place.city === city : !place.city);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.top, { paddingTop: Math.max(insets.top, space.lg) }]}>
        <Txt variant="h2" accessibilityRole="header">
          Your location
        </Txt>
        <IconButton icon="close" label="Close" onPress={close} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.xxxl, gap: space.md }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Use my precise location" disabled={locating} onPress={usePrecise} style={({ pressed }) => [styles.precise, pressed && { backgroundColor: colors.surface2 }]}>
          <View style={styles.preciseIcon}>
            <Icon name="locate" size={19} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{locating ? 'Finding you…' : 'Use my precise location'}</Txt>
            <Txt variant="small" color={colors.muted}>
              Sort events by distance. Your phone will ask first.
            </Txt>
          </View>
          {place?.source === 'precise' ? <Icon name="check" size={18} color={colors.accent} /> : null}
        </Pressable>
        {error ? <Notice tone="warning">{error}</Notice> : null}

        <Txt variant="eyebrow" color={colors.dim} style={{ marginTop: space.lg }}>
          Pick a city or country
        </Txt>
        {all.isPending && !options.length ? (
          <View style={{ gap: space.md }}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : all.error && !options.length ? (
          <Notice tone="warning" action="Try again" onAction={() => all.refetch()}>
            {errorText(all.error)}
          </Notice>
        ) : (
          options.map((c) => (
            <View key={c.code} style={styles.country}>
              <Option label={`${flag(c.code)}  All of ${c.name}`} count={c.total} strong on={isOn(c.code)} onPress={() => pick({ country: c.code, source: 'picked' })} />
              {c.cities.map(([city, n]) => (
                <Option key={city} label={city} count={n} indent on={isOn(c.code, city)} onPress={() => pick({ country: c.code, city, source: 'picked' })} />
              ))}
            </View>
          ))
        )}

        {place && place.source !== 'guess' ? (
          <>
            <Divider style={{ marginVertical: space.sm }} />
            <Pressable accessibilityRole="button" onPress={() => pick(null)} style={({ pressed }) => [styles.reset, pressed && { opacity: 0.7 }]}>
              <Icon name="refresh" size={17} color={colors.muted} />
              <Txt variant="smallStrong" color={colors.muted}>
                Reset to automatic
              </Txt>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Option({ label, count, on, strong, indent, onPress }: { label: string; count: number; on: boolean; strong?: boolean; indent?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label.trim()}, ${count} event${count === 1 ? '' : 's'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.option, indent && { paddingLeft: space.xxxl }, pressed && { backgroundColor: colors.surface2 }]}>
      <Txt variant={strong ? 'bodyStrong' : 'body'} color={on ? colors.accent : strong ? colors.text : colors.muted} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="small" color={colors.dim}>
        {count}
      </Txt>
      {on ? <Icon name="check" size={17} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, paddingBottom: space.lg },
  precise: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  preciseIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  country: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden', paddingVertical: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch + 4, paddingHorizontal: space.lg },
  reset: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
});
