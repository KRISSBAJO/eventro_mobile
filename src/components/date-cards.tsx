/**
 * Picking one date of a multi-date event (lib/dates.ts): a sideways row of small date cards (day, date, time, label,
 * "Few left" / "Sold out"). Used by the event screen ("Pick a date"), the door and the organizer's per-date views.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { dateStock, type EventDate } from '@/lib/dates';
import { when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme';
import { Txt } from './ui';

export function DateCards({
  dates,
  value,
  onChange,
  stock = false,
  note,
  off: offWhy,
  label = 'Pick a date',
}: {
  dates: EventDate[];
  value: string | null;
  onChange: (id: string) => void;
  /** show "Few left" / "Sold out" and disable sold out dates (fans) */
  stock?: boolean;
  /** a small line under a date instead of the stock (the door: "12 in") */
  note?: (d: EventDate) => string | null;
  /** why a date can't be picked right now ("Not open yet"), which disables it */
  off?: (d: EventDate) => string | null;
  label?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {dates.map((d) => {
        const w = when(d.startsAt);
        const on = d.id === value;
        const why = offWhy?.(d) ?? null;
        const s = why ?? (stock ? dateStock(d) : d.status === 'CANCELLED' ? 'Cancelled' : null);
        const off = !!why || s === 'Sold out' || s === 'Cancelled';
        const disabled = !!why || (stock && off);
        const extra = note?.(d) ?? null;
        return (
          <Pressable
            key={d.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={`${w.date}, ${w.time}${d.label ? `, ${d.label}` : ''}${s ? `, ${s.toLowerCase()}` : ''}${extra ? `, ${extra}` : ''}`}
            disabled={disabled}
            onPress={() => {
              haptic.select();
              onChange(d.id);
            }}
            style={({ pressed }) => [styles.card, on && styles.cardOn, off && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.97 }] }]}>
            <Txt variant="eyebrow" color={on ? colors.accent : colors.muted} style={{ fontSize: 10, lineHeight: 12 }}>
              {w.dow}
            </Txt>
            <Txt variant="h2" style={{ lineHeight: 26 }}>
              {w.day}
            </Txt>
            <Txt variant="smallStrong" color={colors.muted} style={{ marginTop: -2 }}>
              {w.month}
            </Txt>
            <View style={[styles.rule, on && { backgroundColor: colors.accentLine }]} />
            <Txt variant="smallStrong" numberOfLines={1}>
              {w.time}
            </Txt>
            {d.label ? (
              <Txt variant="tiny" color={colors.muted} numberOfLines={1} style={{ maxWidth: 96 }}>
                {d.label}
              </Txt>
            ) : null}
            {s || extra ? (
              <Txt variant="tiny" color={why ? colors.dim : s === 'Few left' ? colors.warning : s ? colors.accentHi : colors.dim} numberOfLines={1}>
                {s ?? extra}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { minWidth: 84, alignItems: 'center', gap: 1, paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  cardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rule: { alignSelf: 'stretch', height: StyleSheet.hairlineWidth, backgroundColor: colors.line2, marginVertical: 5 },
});
