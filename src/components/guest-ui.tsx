/** Pieces the comps, guest-list and door screens share: the group picker, a pasted list's refused lines, a counter. */
import { Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { GROUP_MAX, GROUPS } from '@/lib/organizer';
import { colors, radius, space } from '@/theme';
import { formStyles } from './form-ui';
import { Icon } from './icons';
import { Chip, Field, Txt } from './ui';

/** − n + with its own labels (ui.tsx's Stepper speaks of tickets). */
export function CountStepper({ value, min = 0, max, onChange, label, less, more }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string; less: string; more: string }) {
  const btn = (icon: 'minus' | 'plus', next: number, off: boolean, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => {
        haptic.select();
        onChange(next);
      }}
      style={({ pressed }) => [styles.stepBtn, off && { opacity: 0.35 }, pressed && { backgroundColor: colors.surface2 }]}>
      <Icon name={icon} size={18} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
      <Txt variant="smallStrong" color={colors.muted} style={{ flex: 1 }}>
        {label}
      </Txt>
      <View style={styles.stepper} accessibilityLabel={`${label}: ${value}`}>
        {btn('minus', value - 1, value <= min, less)}
        <Txt variant="title" accessibilityLiveRegion="polite" style={{ minWidth: 30, textAlign: 'center' }}>
          {value}
        </Txt>
        {btn('plus', value + 1, value >= max, more)}
      </View>
    </View>
  );
}

/** An optional group: one of the usual ones as chips, or typed. Tapping the chosen chip clears it. */
export function GroupPicker({ value, onChange, label = 'Group (optional)' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const own = !!value && !GROUPS.includes(value);
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="smallStrong" color={colors.muted}>
        {label}
      </Txt>
      <View style={formStyles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {GROUPS.map((g) => (
          <Chip key={g} label={g} active={value === g} onPress={() => onChange(value === g ? '' : g)} />
        ))}
      </View>
      <Field label="Or your own" placeholder="e.g. Family" value={own ? value : ''} onChangeText={(v) => onChange(v.slice(0, GROUP_MAX))} maxLength={GROUP_MAX} />
    </View>
  );
}

/** "Line 3: …" for each line of a pasted list the API refused. */
export function LineErrors({ errors }: { errors: { line: number; error: string }[] }) {
  if (!errors.length) return null;
  return (
    <View style={{ gap: 4, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft }} accessibilityRole="alert">
      {errors.slice(0, 12).map((x) => (
        <Txt key={`${x.line}-${x.error}`} variant="small" color={colors.text}>
          <Txt variant="smallStrong">Line {x.line}:</Txt> {x.error}
        </Txt>
      ))}
      {errors.length > 12 ? (
        <Txt variant="small" color={colors.muted}>
          And {errors.length - 12} more.
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.line2, borderRadius: radius.pill, padding: 3 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
