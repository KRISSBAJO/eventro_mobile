/**
 * An event's donation settings, for Create event and Edit event: on or off, the cause (required when on), a short
 * description, up to four suggested amounts and an optional minimum, with who's responsible for the money.
 */
import { View } from 'react-native';
import { currencySymbol } from '@/lib/format';
import { parseMoney } from '@/lib/organizer';
import { CAUSE_MAX, DONATION_DESCRIPTION_MAX, DONATION_MAX, DONATION_ON_BEHALF, DONATION_SUGGESTIONS_MAX, type DonationDraft } from '@/lib/donations';
import { colors, space } from '@/theme';
import { AmountList, ToggleCard } from './form-ui';
import { Icon } from './icons';
import { Field, TextArea, Txt } from './ui';

export function DonationFields({ value, onChange, currency, errors }: { value: DonationDraft; onChange: (patch: Partial<DonationDraft>) => void; currency: string; errors: Record<string, string> }) {
  const min = value.min.trim() ? parseMoney(value.min) : null;
  return (
    <View style={{ gap: space.md }}>
      <ToggleCard
        label="Accept donations"
        sub={value.on ? 'Fans can add a donation to their order at checkout, free tickets included.' : 'Off: checkout has no donation option.'}
        value={value.on}
        onChange={(on) => onChange({ on })}
      />
      {value.on ? (
        <>
          <Field label="Cause" placeholder="e.g. Lagos Food Bank" value={value.cause} onChangeText={(cause) => onChange({ cause })} maxLength={CAUSE_MAX} error={errors.cause} hint={errors.cause ? undefined : 'Who the donations are for. Fans see “Add a donation to …”.'} />
          <TextArea
            label="Short description (optional)"
            placeholder="What the money does"
            value={value.description}
            onChangeText={(description) => onChange({ description })}
            maxLength={DONATION_DESCRIPTION_MAX}
            minHeight={96}
            error={errors.description}
          />
          <AmountList
            label="Suggested amounts"
            values={value.suggested}
            onChange={(suggested) => onChange({ suggested })}
            currency={currency}
            limit={DONATION_SUGGESTIONS_MAX}
            min={min ?? 1}
            max={DONATION_MAX}
            placeholder="e.g. 5"
            error={errors.suggested}
          />
          <Field
            label={`Minimum donation (${currencySymbol(currency)}, optional)`}
            placeholder="No minimum"
            keyboardType="decimal-pad"
            value={value.min}
            onChangeText={(v) => onChange({ min: v.replace(/[^\d.]/g, '') })}
            error={errors.min}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <Icon name="shield" size={14} color={colors.dim} />
            <Txt variant="small" color={colors.dim} style={{ flex: 1 }}>
              {`${DONATION_ON_BEHALF} No Omoshow fee is taken on donations, and they’re paid out to you separately from ticket sales. They aren’t refunded if a ticket doesn’t scan; if the event is cancelled, they’re refunded with the order.`}
            </Txt>
          </View>
        </>
      ) : null}
    </View>
  );
}
