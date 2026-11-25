/**
 * The look of the app's longer forms (Create event, the venue manager's screens): titled cards with an icon tile,
 * choice tiles, on/off cards and the warm gradient primary button. Fields themselves are ui.tsx's Field and TextArea
 * (near-black wells with the orange focus glow).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { currencySymbol, money } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { parseMoney } from '@/lib/organizer';
import { colors, radius, space } from '@/theme';
import { Icon, type IconName } from './icons';
import { Field, Txt } from './ui';

/** A titled card that groups the fields of one part of a form. */
export function Section({ icon, title, sub, right, children }: { icon: IconName; title: string; sub?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Icon name={icon} size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title" accessibilityRole="header">
            {title}
          </Txt>
          {sub ? (
            <Txt variant="small" color={colors.muted}>
              {sub}
            </Txt>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** One of a few choices, side by side (where the event is, how a venue is priced). */
export function ChoiceTile({ icon, label, sub, on, onPress }: { icon: IconName; label: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}: ${sub}`}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.format, on && styles.formatOn, pressed && { transform: [{ scale: 0.97 }] }]}>
      <View style={[styles.formatIcon, on && { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.3)' }]}>
        <Icon name={icon} size={18} color={on ? colors.accentInk : colors.accent} />
      </View>
      <Txt variant="smallStrong" color={on ? colors.accentInk : colors.text} numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="tiny" color={on ? 'rgba(255,255,255,0.85)' : colors.muted} numberOfLines={1}>
        {sub}
      </Txt>
    </Pressable>
  );
}

/** A row of choice tiles. */
export const ChoiceRow = ({ children }: { children: ReactNode }) => (
  <View style={styles.formats} accessibilityRole="radiogroup">
    {children}
  </View>
);

/** The screen's main action: a warm gradient pill naming what it does. */
export function GradientButton({ label, onPress, icon = 'arrowRight', loading, disabled }: { label: string; onPress: () => void; icon?: IconName; loading?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.next, (disabled || loading) && { opacity: 0.7 }, pressed && { transform: [{ scale: 0.98 }] }]}>
      <LinearGradient colors={[colors.accent, '#ff7a45']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {loading ? <ActivityIndicator color={colors.accentInk} /> : null}
      <Txt variant="bodyStrong" color={colors.accentInk} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      {/* In a View so it paints above the gradient on web */}
      {loading ? null : (
        <View>
          <Icon name={icon} size={18} color={colors.accentInk} />
        </View>
      )}
    </Pressable>
  );
}

/** An on/off setting as a card: what it is, what it does now, and a switch. */
export function ToggleCard({ label, sub, value, onChange, disabled }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={sub}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.select();
        onChange(!value);
      }}
      style={({ pressed }) => [styles.toggle, value && styles.toggleOn, disabled && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        <Txt variant="small" color={colors.muted}>
          {sub}
        </Txt>
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

/** A small removable pill (amenities). */
export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.pill}>
      <Txt variant="smallStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        hitSlop={8}
        onPress={() => {
          haptic.select();
          onRemove();
        }}
        style={({ pressed }) => [styles.pillX, pressed && { backgroundColor: colors.surface2 }]}>
        <Icon name="close" size={13} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/**
 * A short list of money amounts (quick picks, suggested donations): removable chips, smallest first, and a field to
 * add one. `min`/`max` (cents) are checked as each amount is added; the form checks them again on save.
 */
export function AmountList({
  label,
  values,
  onChange,
  currency,
  limit,
  min = 0,
  max,
  placeholder = 'e.g. 20',
  hint,
  error,
}: {
  label: string;
  values: number[];
  onChange: (v: number[]) => void;
  currency: string;
  limit: number;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  const [text, setText] = useState('');
  const [own, setOwn] = useState('');
  const full = values.length >= limit;
  const add = () => {
    const c = parseMoney(text);
    if (c === null || c <= 0) return setOwn('Enter an amount, like 20 or 12.50.');
    if (c < min) return setOwn(`At least ${money(min, currency, { decimals: min % 100 !== 0 })}.`);
    if (max !== undefined && c > max) return setOwn(`At most ${money(max, currency)}.`);
    if (values.includes(c)) return setOwn('That one is already on the list.');
    haptic.select();
    onChange([...values, c].sort((a, b) => a - b));
    setText('');
    setOwn('');
  };
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Txt variant="smallStrong" color={colors.muted}>
          {label} <Txt variant="small" color={colors.dim}>optional</Txt>
        </Txt>
        <Txt variant="tiny" color={colors.dim}>
          {values.length}/{limit}
        </Txt>
      </View>
      {values.length ? (
        <View style={formStyles.wrap} accessibilityLabel={label}>
          {values.map((c) => (
            <RemovableChip key={c} label={money(c, currency, { decimals: c % 100 !== 0 })} onRemove={() => onChange(values.filter((x) => x !== c))} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <Field
          style={{ flex: 1 }}
          label={`Add an amount (${currencySymbol(currency)})`}
          value={text}
          editable={!full}
          keyboardType="decimal-pad"
          placeholder={full ? `That’s the most (${limit})` : placeholder}
          returnKeyType="done"
          submitBehavior="submit"
          onChangeText={(v) => {
            setText(v.replace(/[^\d.]/g, ''));
            if (own) setOwn('');
          }}
          onSubmitEditing={() => {
            if (text.trim()) add();
          }}
          error={own || error || undefined}
          hint={hint}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add to ${label.toLowerCase()}`}
          accessibilityState={{ disabled: full || !text.trim() }}
          disabled={full || !text.trim()}
          onPress={add}
          style={({ pressed }) => [styles.addBtn, (full || !text.trim()) && { opacity: 0.4 }, pressed && { backgroundColor: colors.surface2 }, own || error || hint ? { marginBottom: 24 } : null]}>
          <Icon name="plus" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

/** Two options side by side in one pill (Fixed price / Pay what you want). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => {
              if (on) return;
              haptic.select();
              onChange(o.id);
            }}
            style={({ pressed }) => [styles.segment, on && styles.segmentOn, pressed && !on && { backgroundColor: colors.surface2 }]}>
            <Txt variant="smallStrong" color={on ? colors.accentInk : colors.muted} numberOfLines={1}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Two fields side by side, and a wrapping row of chips. */
export const formStyles = StyleSheet.create({
  row2: { flexDirection: 'row', gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

const styles = StyleSheet.create({
  section: { gap: space.lg, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  sectionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  formats: { flexDirection: 'row', gap: space.sm },
  format: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md, paddingHorizontal: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  formatOn: { backgroundColor: colors.accent, borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  formatIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  next: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 54,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    overflow: 'hidden',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md + 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  toggleOn: { borderColor: colors.accentLine, backgroundColor: 'rgba(255,77,61,0.06)' },
  track: { width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldLine },
  trackOn: { backgroundColor: colors.accent, borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.muted },
  knobOn: { transform: [{ translateX: 18 }], backgroundColor: colors.accentInk },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 34, paddingLeft: 12, paddingRight: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface2 },
  pillX: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  segments: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field },
  segment: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  segmentOn: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
});
