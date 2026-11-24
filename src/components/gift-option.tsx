/**
 * Checkout's "This is a gift" option, like the website's: their name and email, an optional note, when it arrives
 * (right away, or a day and time before the event) and whether to hide the price. POST /orders takes it as
 * `gift: { name, email, message?, sendAt?, hidePrice? }`; the tickets stay held until they open the gift link.
 *
 * Phones have no date picker without a native library, so the delivery time is picked from day and time chips
 * (in the buyer's own time zone).
 */
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { emailOk } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Field, Txt } from './ui';

export const GIFT_MESSAGE_MAX = 300;

export type GiftDraft = { on: boolean; name: string; email: string; message: string; later: boolean; at: number | null; hidePrice: boolean };
export const NO_GIFT: GiftDraft = { on: false, name: '', email: '', message: '', later: false, at: null, hidePrice: true };

/** What's wrong with the gift, field by field ('' = fine). `eventStart` is the real start instant. */
export function giftErrors(g: GiftDraft, buyerEmail: string, eventStart: number, now: number) {
  if (!g.on) return { name: '', email: '', at: '' };
  const to = g.email.trim().toLowerCase();
  return {
    name: g.name.trim().length < 2 ? 'Enter their name.' : '',
    email: !emailOk(to) ? 'Enter their email. The gift link goes here.' : to === buyerEmail.trim().toLowerCase() ? 'That’s your own email. A gift needs to go to someone else.' : '',
    at: !g.later ? '' : g.at === null ? 'Pick when it should arrive.' : g.at <= now ? 'Pick a time in the future.' : g.at >= eventStart ? 'It has to arrive before the event starts.' : '',
  };
}

/** The API's gift field. */
export const giftBody = (g: GiftDraft) =>
  g.on
    ? {
        gift: {
          name: g.name.trim(),
          email: g.email.trim().toLowerCase(),
          ...(g.message.trim() ? { message: g.message.trim() } : {}),
          ...(g.later && g.at ? { sendAt: new Date(g.at).toISOString() } : {}),
          hidePrice: g.hidePrice,
        },
      }
    : {};

const TIMES = [9, 12, 15, 18, 21];
const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayLabel = (t: number, today: number) => {
  const diff = Math.round((dayStart(t) - today) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** `now` comes from the screen's ticking clock, so rendering stays pure. */
export function GiftOption({ gift, patch, errors, show, eventStart, now }: { gift: GiftDraft; patch: (p: Partial<GiftDraft>) => void; errors: ReturnType<typeof giftErrors>; show: boolean; eventStart: number; now: number }) {
  const today = dayStart(now);
  // Days from today until the event (at most three weeks of chips).
  const days: number[] = [];
  for (let d = today; d < eventStart && days.length < 21; d += 86_400_000) days.push(dayStart(d + 3_600_000));
  const day = gift.at !== null ? dayStart(gift.at) : null;
  const hour = gift.at !== null ? new Date(gift.at).getHours() : null;
  const at = (d: number, h: number) => {
    const t = new Date(d);
    t.setHours(h, 0, 0, 0);
    return t.getTime();
  };
  const okTime = (d: number, h: number) => at(d, h) > now + 5 * 60_000 && at(d, h) < eventStart;
  /** The earliest day and time that works, to start "On a day" from. */
  const firstSlot = () => {
    const d = days.find((x) => TIMES.some((h) => okTime(x, h)));
    const h = d !== undefined ? TIMES.find((x) => okTime(d, x)) : undefined;
    return d !== undefined && h !== undefined ? at(d, h) : null;
  };
  const pickDay = (d: number) => {
    haptic.select();
    // Keep the time if it still works that day, else the first one that does.
    const h = hour !== null && okTime(d, hour) ? hour : TIMES.find((x) => okTime(d, x));
    patch({ at: h === undefined ? null : at(d, h) });
  };

  return (
    <View style={[styles.box, gift.on && { borderColor: colors.accentLine, backgroundColor: 'rgba(255,77,61,0.04)' }]}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: gift.on }}
        accessibilityLabel="This is a gift"
        onPress={() => {
          haptic.select();
          patch({ on: !gift.on });
        }}
        style={styles.head}>
        <View style={[styles.icon, gift.on && { backgroundColor: colors.accent, transform: [{ rotate: '-8deg' }] }]}>
          <Icon name="gift" size={20} color={gift.on ? colors.accentInk : colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="bodyStrong">This is a gift</Txt>
          <Txt variant="small" color={colors.muted}>
            Send the tickets to someone else with a note, now or on a day you pick.
          </Txt>
        </View>
        <Switch
          value={gift.on}
          onValueChange={(v) => {
            haptic.select();
            patch({ on: v });
          }}
          trackColor={{ true: colors.accent, false: colors.line2 }}
          thumbColor="#ffffff"
          accessibilityLabel="This is a gift"
        />
      </Pressable>

      {gift.on ? (
        <View style={{ gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          <Field label="Their name" value={gift.name} onChangeText={(t) => patch({ name: t })} autoCapitalize="words" autoComplete="off" maxLength={80} placeholder="Ada Lovelace" error={show ? errors.name : ''} />
          <Field
            label="Their email"
            value={gift.email}
            onChangeText={(t) => patch({ email: t })}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            placeholder="them@example.com"
            hint="We send the gift link here."
            error={show ? errors.email : ''}
          />
          <Field
            label="Personal message (optional)"
            value={gift.message}
            onChangeText={(t) => patch({ message: t.slice(0, GIFT_MESSAGE_MAX) })}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={GIFT_MESSAGE_MAX}
            placeholder="Happy birthday! Front row, as promised."
            hint={`${gift.message.length}/${GIFT_MESSAGE_MAX}`}
          />

          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" color={colors.muted}>
              When should it arrive?
            </Txt>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {(
                [
                  [false, 'Right away', 'As soon as you pay'],
                  [true, 'On a day', 'Any time before the event'],
                ] as const
              ).map(([later, label, sub]) => {
                const on = gift.later === later;
                return (
                  <Pressable
                    key={label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      haptic.select();
                      patch(later && gift.at === null ? { later, at: firstSlot() } : { later });
                    }}
                    style={[styles.when, on && styles.whenOn]}>
                    <Txt variant="smallStrong">{label}</Txt>
                    <Txt variant="tiny" color={colors.muted}>
                      {sub}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            {gift.later ? (
              <View style={{ gap: space.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                  {days.map((d) => {
                    const usable = TIMES.some((h) => okTime(d, h));
                    return <ChoiceChip key={d} label={dayLabel(d, today)} on={day === d} disabled={!usable} onPress={() => pickDay(d)} />;
                  })}
                </ScrollView>
                {day !== null ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {TIMES.map((h) => (
                      <ChoiceChip
                        key={h}
                        label={timeLabel(h)}
                        on={hour === h}
                        disabled={!okTime(day, h)}
                        onPress={() => {
                          haptic.select();
                          patch({ at: at(day, h) });
                        }}
                      />
                    ))}
                  </View>
                ) : null}
                <Txt variant="small" color={show && errors.at ? colors.accentHi : colors.dim}>
                  {show && errors.at ? errors.at : 'Your local time. It has to be before the event starts.'}
                </Txt>
              </View>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: gift.hidePrice }}
            onPress={() => {
              haptic.select();
              patch({ hidePrice: !gift.hidePrice });
            }}
            style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <View style={[styles.check, gift.hidePrice && { backgroundColor: colors.accent, borderColor: colors.accent }]}>{gift.hidePrice ? <Icon name="check" size={14} color="#ffffff" strokeWidth={3} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Txt variant="smallStrong">Hide the price from them</Txt>
              <Txt variant="small" color={colors.muted}>
                They see the event and the seats, not what you paid.
              </Txt>
            </View>
          </Pressable>

          <View style={styles.note}>
            <Icon name="shield" size={16} color={colors.accent} />
            <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
              We’ll email them a gift link. The tickets go into their account when they open it, so nobody can use them before.
            </Txt>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ChoiceChip({ label, on, disabled, onPress }: { label: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, on && { backgroundColor: colors.accent, borderColor: colors.accent }, disabled && { opacity: 0.35 }]}>
      <Txt variant="smallStrong" color={on ? colors.accentInk : colors.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  when: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2 },
  whenOn: { borderColor: colors.accent, backgroundColor: 'rgba(255,77,61,0.06)' },
  chip: { height: 38, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  note: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
});
