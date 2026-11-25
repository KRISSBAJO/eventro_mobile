/**
 * Picking an amount as a fan: one-tap chips (a pay-what-you-want ticket's quick picks, a cause's suggested donations)
 * and "Other amount" for typing one. `none` adds a first chip worth 0 ("No donation").
 */
import { useState } from 'react';
import { View } from 'react-native';
import { currencySymbol, money } from '@/lib/format';
import { moneyInput, parseMoney } from '@/lib/organizer';
import { space } from '@/theme';
import { formStyles } from './form-ui';
import { Chip, Field } from './ui';

export function AmountPicker({
  label,
  chips,
  value,
  onChange,
  currency,
  none,
  error,
  hint,
  disabled,
}: {
  label: string;
  chips: number[];
  /** cents; null while the typed amount isn't one */
  value: number | null;
  onChange: (cents: number | null) => void;
  currency: string;
  none?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const known = (v: number | null) => v !== null && (chips.includes(v) || (!!none && v === 0));
  const [custom, setCustom] = useState(() => !known(value));
  const [text, setText] = useState(() => (!known(value) && value !== null ? moneyInput(value) : ''));
  const label$ = (c: number) => money(c, currency, { decimals: c % 100 !== 0 });
  return (
    <View style={{ gap: space.sm }} accessibilityLabel={label}>
      <View style={formStyles.wrap}>
        {none ? (
          <Chip
            label={none}
            active={!custom && value === 0}
            onPress={() => {
              if (disabled) return;
              setCustom(false);
              setText('');
              onChange(0);
            }}
          />
        ) : null}
        {chips.map((c) => (
          <Chip
            key={c}
            label={label$(c)}
            active={!custom && value === c}
            onPress={() => {
              if (disabled) return;
              setCustom(false);
              setText('');
              onChange(c);
            }}
          />
        ))}
        <Chip
          label="Other amount"
          icon="plus"
          active={custom}
          onPress={() => {
            if (disabled) return;
            setCustom(true);
            onChange(text ? parseMoney(text) : null);
          }}
        />
      </View>
      {custom ? (
        <Field
          label={`${label} (${currencySymbol(currency)})`}
          value={text}
          autoFocus
          keyboardType="decimal-pad"
          placeholder="e.g. 12.50"
          editable={!disabled}
          onChangeText={(v) => {
            const t = v.replace(/[^\d.]/g, '');
            setText(t);
            onChange(t ? parseMoney(t) : null);
          }}
          error={error}
          hint={hint}
        />
      ) : null}
    </View>
  );
}
