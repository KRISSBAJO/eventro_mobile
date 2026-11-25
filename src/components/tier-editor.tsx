/**
 * Editing a ticket tier's extras, as on the website (components/tier-perks.tsx): preset tiles that add a tier with
 * suggested perks and badge, slotted by rank; the perks checklist (up to 8, the API's limits); an optional badge;
 * and the look picker with a live mini ticket. Used by Create event and Edit event.
 *
 * PricingMode and PwywFields set how a tier is priced: a fixed price, or pay what you want (a minimum, an optional
 * suggested price that fans start on, up to four quick picks and an optional maximum, all in the organizer's base
 * amounts like a fixed price).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { currencySymbol } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { FEE_PERMILLE, parseMoney } from '@/lib/organizer';
import { PROMO_PWYW_NOTE, pwywSummary, PWYW_CEILING, QUICK_PICKS_MAX, type PwywDraft } from '@/lib/pwyw';
import type { FeeMode } from '@/lib/types';
import {
  autoLook,
  BADGE_MAX,
  BADGE_SUGGESTIONS,
  hasPerk,
  PERK_LIMIT,
  PERK_MAX,
  PERK_MIN,
  perkSuggestions,
  resolveLook,
  TIER_LOOKS,
  TIER_PRESETS,
  tidy,
  type TierLook,
  type TierPreset,
} from '@/lib/tiers';
import { colors, radius, space } from '@/theme';
import { AmountList, formStyles, Segmented } from './form-ui';
import { Icon } from './icons';
import { LookPicker, MiniTicket, TierGlyph, TierSurface } from './tier-look';
import { Field, Txt } from './ui';

export type Pricing = 'FIXED' | 'PWYW';

/** Fixed price / Pay what you want, for one tier. */
export function PricingMode({ value, onChange }: { value: Pricing; onChange: (v: Pricing) => void }) {
  return (
    <Segmented
      label="How this ticket is priced"
      value={value}
      onChange={onChange}
      options={[
        { id: 'FIXED', label: 'Fixed price' },
        { id: 'PWYW', label: 'Pay what you want' },
      ]}
    />
  );
}

/**
 * A pay-what-you-want tier's amounts. `errors` uses the keys of lib/pwyw.ts pwywErrors (`${errorKey}-min` and so on).
 * Amounts are base amounts in the event's currency; with "Fans pay it" Omoshow's fee is added on top of what fans pick.
 */
export function PwywFields({
  value,
  onChange,
  currency,
  feeMode,
  errors,
  errorKey,
}: {
  value: PwywDraft;
  onChange: (patch: Partial<PwywDraft>) => void;
  currency: string;
  feeMode: FeeMode;
  errors: Record<string, string>;
  errorKey: string;
}) {
  const sym = currencySymbol(currency);
  const min = parseMoney(value.min);
  const max = value.max.trim() ? parseMoney(value.max) : null;
  const summary = pwywSummary(value, feeMode, FEE_PERMILLE, currency);
  const money = (v: string) => v.replace(/[^\d.]/g, '');
  return (
    <View style={{ gap: space.md }}>
      <View style={formStyles.row2}>
        <Field style={{ flex: 1 }} label={`Minimum (${sym})`} placeholder="0 = can be free" keyboardType="decimal-pad" value={value.min} onChangeText={(v) => onChange({ min: money(v) })} error={errors[`${errorKey}-min`]} />
        <Field style={{ flex: 1 }} label={`Suggested (${sym})`} placeholder="Optional" keyboardType="decimal-pad" value={value.suggested} onChangeText={(v) => onChange({ suggested: money(v) })} error={errors[`${errorKey}-suggested`]} />
      </View>
      <Field
        label={`Maximum (${sym})`}
        placeholder="No maximum"
        keyboardType="decimal-pad"
        value={value.max}
        onChangeText={(v) => onChange({ max: money(v) })}
        error={errors[`${errorKey}-max`]}
        hint={errors[`${errorKey}-max`] ? undefined : 'Optional. Fans start on the suggested price, or the minimum.'}
      />
      <AmountList
        label="Quick picks"
        values={value.picks}
        onChange={(picks) => onChange({ picks })}
        currency={currency}
        limit={QUICK_PICKS_MAX}
        min={min ?? 0}
        max={max ?? PWYW_CEILING}
        placeholder="e.g. 15"
        error={errors[`${errorKey}-picks`]}
        hint={value.picks.length ? undefined : 'One-tap amounts fans see next to “Other amount”.'}
      />
      {summary ? (
        <Txt variant="small" color={colors.muted}>
          {summary}
        </Txt>
      ) : null}
      <Txt variant="tiny" color={colors.dim}>
        {`${PROMO_PWYW_NOTE} A ticket bought for more than ${currencySymbol(currency)}0 is covered by the Omoshow Guarantee; one taken for free isn’t.`}
      </Txt>
    </View>
  );
}

/** The six presets as tappable tiles, each in the look it gets. One already in the list (by name) shows "Added". */
export function TierPresets({ names, onPick, disabled }: { names: string[]; onPick: (p: TierPreset) => void; disabled?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="smallStrong" color={colors.muted}>
        Add a tier
      </Txt>
      <Txt variant="small" color={colors.dim}>
        Presets come with suggested perks, slotted in by rank. Change anything.
      </Txt>
      <View style={styles.presets}>
        {TIER_PRESETS.map((p) => {
          const look = TIER_LOOKS[autoLook(p.name)];
          const added = names.some((n) => n.trim().toLowerCase() === p.name.toLowerCase());
          const off = disabled || added;
          return (
            <Pressable
              key={p.key}
              accessibilityRole="button"
              accessibilityLabel={added ? `${p.name}, added` : `Add ${p.name}: ${p.hint}`}
              accessibilityState={{ disabled: off }}
              disabled={off}
              onPress={() => {
                haptic.select();
                onPick(p);
              }}
              style={({ pressed }) => [styles.preset, off && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }], borderColor: colors.accentLine }]}>
              <TierSurface look={look} edge="top" style={styles.presetSwatch}>
                <View style={styles.center}>
                  <TierGlyph look={look} size={16} />
                </View>
              </TierSurface>
              <View style={{ flex: 1, gap: 1 }}>
                <Txt variant="smallStrong" numberOfLines={1}>
                  {p.name}
                </Txt>
                <Txt variant="tiny" color={colors.muted} numberOfLines={1}>
                  {added ? 'Added' : p.hint}
                </Txt>
              </View>
              <Icon name={added ? 'check' : 'plus'} size={15} color={added ? colors.muted : colors.accent} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type TierExtrasValue = { perks: string[]; badge: string; style: TierLook | null };

/** Perks, badge and look of one tier, with its live mini ticket. */
export function TierExtras({ name, price, value, onChange }: { name: string; price?: string; value: TierExtrasValue; onChange: (patch: Partial<TierExtrasValue>) => void }) {
  const { perks, badge, style } = value;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const full = perks.length >= PERK_LIMIT;
  const suggestions = full ? [] : perkSuggestions(name, perks, 5);
  const customBadge = !!badge && !BADGE_SUGGESTIONS.includes(badge);

  const add = (raw: string) => {
    const v = tidy(raw);
    if (full) return setError(`A ticket can list up to ${PERK_LIMIT} perks.`);
    if (v.length < PERK_MIN) return setError(`A perk needs at least ${PERK_MIN} characters.`);
    if (hasPerk(perks, v)) return setError('That one is already on the list.');
    haptic.select();
    onChange({ perks: [...perks, v.slice(0, PERK_MAX)] });
    setText('');
    setError('');
  };

  return (
    <View style={{ gap: space.lg }}>
      <MiniTicket name={name} look={resolveLook(name, style)} badge={badge.trim() || undefined} price={price} perks={perks.length} />

      <LookPicker value={style} auto={autoLook(name)} onChange={(s) => onChange({ style: s })} />

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Txt variant="smallStrong" color={colors.muted}>
            What’s included <Txt variant="small" color={colors.dim}>optional</Txt>
          </Txt>
          <Txt variant="tiny" color={colors.dim}>
            {perks.length}/{PERK_LIMIT}
          </Txt>
        </View>
        {perks.length ? (
          <View style={styles.checklist} accessibilityLabel="Perks">
            {perks.map((p, i) => (
              <View key={p} style={[styles.perk, i > 0 && styles.perkLine]}>
                <View style={styles.perkCheck}>
                  <Icon name="check" size={11} color={colors.accentInk} strokeWidth={3} />
                </View>
                <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>
                  {p}
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p}`}
                  hitSlop={8}
                  onPress={() => {
                    haptic.select();
                    onChange({ perks: perks.filter((x) => x !== p) });
                  }}
                  style={({ pressed }) => [styles.perkX, pressed && { backgroundColor: colors.surface2 }]}>
                  <Icon name="close" size={13} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Txt variant="small" color={colors.dim}>
            List what this ticket gets. Fans see it as a checklist next to the price.
          </Txt>
        )}
        {suggestions.length ? (
          <View style={styles.wrap} accessibilityLabel="Suggested perks">
            {suggestions.map((s) => (
              <Pressable key={s} accessibilityRole="button" accessibilityLabel={`Add ${s}`} onPress={() => add(s)} style={({ pressed }) => [styles.suggest, pressed && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
                <Icon name="plus" size={12} color={colors.accent} />
                <Txt variant="small" color={colors.muted} numberOfLines={1}>
                  {s}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <Field
            style={{ flex: 1 }}
            label="Add your own"
            value={text}
            maxLength={PERK_MAX}
            editable={!full}
            placeholder={full ? `That’s the most (${PERK_LIMIT})` : 'e.g. Free coat check'}
            returnKeyType="done"
            submitBehavior="submit"
            onChangeText={(v) => {
              setText(v);
              if (error) setError('');
            }}
            onSubmitEditing={() => {
              if (text.trim()) add(text);
            }}
            error={error || undefined}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add perk"
            accessibilityState={{ disabled: full || !text.trim() }}
            disabled={full || !text.trim()}
            onPress={() => add(text)}
            style={({ pressed }) => [styles.addBtn, (full || !text.trim()) && { opacity: 0.4 }, pressed && { backgroundColor: colors.surface2 }, error ? { marginBottom: 24 } : null]}>
            <Icon name="plus" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="smallStrong" color={colors.muted}>
          Badge <Txt variant="small" color={colors.dim}>optional</Txt>
        </Txt>
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Badge">
          {BADGE_SUGGESTIONS.map((b) => {
            const on = badge === b;
            return (
              <Pressable
                key={b}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={b}
                onPress={() => {
                  haptic.select();
                  onChange({ badge: on ? '' : b });
                }}
                style={({ pressed }) => [styles.badgeOpt, on && styles.badgeOn, pressed && { opacity: 0.8 }]}>
                <Txt variant="smallStrong" color={on ? colors.accentHi : colors.muted} numberOfLines={1}>
                  {b}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        <Field
          label="Or write your own"
          value={customBadge ? badge : ''}
          maxLength={BADGE_MAX}
          placeholder="e.g. Front row"
          onChangeText={(v) => onChange({ badge: v })}
          hint={badge ? undefined : 'A short label on the ticket, up to 24 characters.'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preset: {
    flexGrow: 1,
    flexBasis: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.surface,
  },
  presetSwatch: { width: 34, height: 34, borderRadius: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  checklist: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field, paddingHorizontal: space.md },
  perk: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  perkLine: { borderTopWidth: 1, borderTopColor: colors.line },
  perkCheck: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  perkX: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 },
  addBtn: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  badgeOpt: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, justifyContent: 'center' },
  badgeOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
});
