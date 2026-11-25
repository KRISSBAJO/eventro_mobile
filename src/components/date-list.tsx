/**
 * The organizer's dates for an event with more than one (lib/dates.ts): "One date / Multiple dates / Multi-day" and,
 * for the last two, a list of dates (add, duplicate, remove; an optional label). Used by Create event and Edit event.
 *
 * Each date is a short row ("Sat, Dec 13 · 8:00 PM · Matinee") that opens to its fields. Values are wall-clock
 * strings like the rest of the event form ("2026-12-13", "20:00"); `datesBody` turns them into the API's `dates`.
 * Multi-day events need one date per calendar day; multiple dates can share a day at different times.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dateLabel, DateField, TimeField, timeLabel } from '@/components/date-time';
import { Segmented } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { Button, Chip, Field, Txt } from '@/components/ui';
import { shortDay, type DateMode, type EventDate } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { wallIso, wallParts } from '@/lib/organizer';
import { colors, radius, space, touch } from '@/theme';

export type DateDraft = {
  key: string;
  /** an existing date (Edit) */
  id: string | null;
  date: string;
  start: string;
  doors: string;
  end: string;
  label: string;
  /** a cancelled date (Edit): shown, not editable, left out of the update */
  cancelled?: boolean;
};

export const MODES: { id: DateMode; label: string }[] = [
  { id: 'SINGLE', label: 'One date' },
  { id: 'DATES', label: 'Multiple dates' },
  { id: 'DAYS', label: 'Multi-day' },
];
export const MAX_DATES: Record<'DATES' | 'DAYS', number> = { DATES: 60, DAYS: 14 };

const newKey = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nextDay = (ymd: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** A blank date, or the day after `after` at the same times (a new day of a festival, the next night of a run). */
export const newDate = (after?: Partial<DateDraft>): DateDraft => ({
  key: newKey(),
  id: null,
  date: after?.date ? nextDay(after.date) : '',
  start: after?.start ?? '',
  doors: after?.doors ?? '',
  end: after?.end ?? '',
  label: '',
});

/** The event's dates as editable rows (Edit). */
export const draftsOf = (dates: EventDate[] = []): DateDraft[] =>
  dates.map((d) => ({
    key: d.id,
    id: d.id,
    date: d.startsAt.slice(0, 10),
    start: wallParts(d.startsAt)!.time,
    doors: wallParts(d.doorsAt)?.time ?? '',
    end: d.endsAt ? wallParts(d.endsAt)!.time : '',
    label: d.label ?? '',
    cancelled: d.status === 'CANCELLED',
  }));

/** "Sat, Dec 13 · 8:00 PM · Matinee" for a row. */
export const draftLine = (d: DateDraft) => [d.date ? dateLabel(d.date).replace(/, \d{4}$/, '') : 'Pick a date', d.start ? timeLabel(d.start) : '', d.label.trim()].filter(Boolean).join(' · ');

/**
 * The rows' problems, keyed `<key>-date` etc. (and `dates` for the list). New dates, and dates whose start moved, have
 * to be today or later (`original`: an existing date's stored start).
 */
export function dateListErrors(mode: DateMode, list: DateDraft[], today: string, original: Map<string, string> = new Map()) {
  const e: Record<string, string> = {};
  if (mode === 'SINGLE') return e;
  const live = list.filter((d) => !d.cancelled);
  if (!live.length) e.dates = mode === 'DAYS' ? 'Add the days of the event.' : 'Add at least one date.';
  if (live.length > MAX_DATES[mode]) e.dates = mode === 'DAYS' ? 'A multi-day event can have up to 14 days.' : 'An event can have up to 60 dates.';
  const seen = new Map<string, string>();
  for (const d of live) {
    const moved = !d.id || !d.date || !d.start || original.get(d.id) !== wallIso(d.date, d.start);
    if (!d.date) e[`${d.key}-date`] = 'Choose a date.';
    else if (moved && d.date < today) e[`${d.key}-date`] = 'This date is in the past.';
    if (!d.start) e[`${d.key}-start`] = 'Add a start time.';
    if (d.end && d.start && d.end <= d.start) e[`${d.key}-end`] = 'The end has to be after the start.';
    if (d.doors && d.start && d.doors > d.start) e[`${d.key}-doors`] = 'Doors can’t open after the start.';
    if (d.date && d.start) {
      const k = mode === 'DAYS' ? d.date : `${d.date} ${d.start}`;
      if (seen.has(k) && !e[`${d.key}-date`]) e[`${d.key}-date`] = mode === 'DAYS' ? 'Another day is on this date. Each day is a different calendar day.' : 'Another date starts at this time.';
      seen.set(k, d.key);
    }
  }
  return e;
}

/** The API's `dates` (cancelled ones left out: they can't change). */
export const datesBody = (list: DateDraft[]) =>
  list
    .filter((d) => !d.cancelled)
    .map((d) => ({
      ...(d.id ? { id: d.id } : {}),
      startsAt: wallIso(d.date, d.start),
      ...(d.doors ? { doorsAt: wallIso(d.date, d.doors) } : {}),
      ...(d.end ? { endsAt: wallIso(d.date, d.end) } : {}),
      ...(d.label.trim() ? { label: d.label.trim().slice(0, 60) } : {}),
    }));

/** One date / Multiple dates / Multi-day. */
export function ModePicker({ value, onChange }: { value: DateMode; onChange: (m: DateMode) => void }) {
  return <Segmented value={value} options={MODES} onChange={onChange} label="How many dates" />;
}

export function DateList({
  mode,
  list,
  onChange,
  errors,
  today,
  extra,
  keep,
}: {
  mode: 'DATES' | 'DAYS';
  list: DateDraft[];
  onChange: (list: DateDraft[]) => void;
  errors: Record<string, string>;
  today: string;
  /** more under an existing date's fields (Edit: "Cancel this date") */
  extra?: (d: DateDraft) => ReactNode;
  /** why a date can't be removed (Edit: it has sales), which hides Remove */
  keep?: (d: DateDraft) => string | null;
}) {
  // Rows open to edit; a new one opens, and any with a problem.
  const [open, setOpen] = useState<string | null>(() => (list.length === 1 && !list[0].date ? list[0].key : null));
  const live = list.filter((d) => !d.cancelled);
  const full = live.length >= MAX_DATES[mode];
  const patch = (key: string, p: Partial<DateDraft>) => onChange(list.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const add = (after?: DateDraft) => {
    if (full) return;
    haptic.select();
    const last = after ?? [...live].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)).pop();
    const d = { ...newDate(last), ...(after ? { label: '' } : {}) };
    onChange([...list, d]);
    setOpen(d.key);
  };
  const remove = (key: string) => {
    haptic.select();
    onChange(list.filter((d) => d.key !== key));
  };
  const word = mode === 'DAYS' ? 'day' : 'date';

  return (
    <View style={{ gap: space.sm }}>
      {list.map((d, i) => {
        const has = (f: string) => errors[`${d.key}-${f}`];
        const bad = ['date', 'start', 'end', 'doors'].some(has);
        const isOpen = !d.cancelled && (open === d.key || bad);
        return (
          <View key={d.key} style={[styles.row, isOpen && styles.rowOpen, d.cancelled && { opacity: 0.6 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen, disabled: !!d.cancelled }}
              accessibilityLabel={`${mode === 'DAYS' ? `Day ${i + 1}` : `Date ${i + 1}`}: ${draftLine(d)}${d.cancelled ? ', cancelled' : ''}`}
              disabled={d.cancelled}
              onPress={() => {
                haptic.select();
                setOpen(isOpen ? null : d.key);
              }}
              style={styles.head}>
              <View style={[styles.num, bad && { borderColor: colors.accent }]}>
                <Txt variant="smallStrong" color={bad ? colors.accentHi : colors.muted}>
                  {i + 1}
                </Txt>
              </View>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }} color={d.date ? colors.text : colors.dim}>
                {draftLine(d)}
              </Txt>
              {d.cancelled ? (
                <Txt variant="tiny" color={colors.accentHi}>
                  Cancelled
                </Txt>
              ) : (
                <View style={isOpen ? { transform: [{ rotate: '180deg' }] } : undefined}>
                  <Icon name="chevronDown" size={18} color={colors.muted} />
                </View>
              )}
            </Pressable>
            {isOpen ? (
              <View style={{ gap: space.md }}>
                <DateField label="Date" value={d.date} onChange={(v) => patch(d.key, { date: v })} min={d.id ? undefined : today} error={has('date')} />
                <View style={styles.row2}>
                  <TimeField label="Starts" value={d.start} onChange={(v) => patch(d.key, { start: v })} error={has('start')} />
                  <TimeField label="Doors open" value={d.doors} onChange={(v) => patch(d.key, { doors: v })} optional error={has('doors')} />
                </View>
                <View style={styles.row2}>
                  <TimeField label="Ends" value={d.end} onChange={(v) => patch(d.key, { end: v })} optional error={has('end')} />
                  <View style={{ flex: 1 }} />
                </View>
                <Field label="Label (optional)" placeholder={mode === 'DAYS' ? `e.g. Day ${i + 1}: Afrobeats` : 'e.g. Matinee'} value={d.label} onChangeText={(v) => patch(d.key, { label: v })} maxLength={60} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {!full ? <Button label="Duplicate" variant="ghost" size="sm" icon="plus" onPress={() => add(d)} /> : null}
                  {live.length > 1 && !keep?.(d) ? <Button label={`Remove this ${word}`} variant="ghost" size="sm" icon="trash" onPress={() => remove(d.key)} /> : null}
                </View>
                {keep?.(d) ? (
                  <Txt variant="tiny" color={colors.dim}>
                    {keep(d)}
                  </Txt>
                ) : null}
                {extra?.(d)}
              </View>
            ) : null}
          </View>
        );
      })}
      {errors.dates ? (
        <Txt variant="small" color={colors.accentHi}>
          {errors.dates}
        </Txt>
      ) : null}
      {!full ? (
        <Pressable accessibilityRole="button" onPress={() => add()} style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.surface2 }]}>
          <Icon name="plus" size={16} color={colors.accent} />
          <Txt variant="smallStrong" color={colors.accent}>
            {`Add a ${word}`}
          </Txt>
        </Pressable>
      ) : (
        <Txt variant="small" color={colors.dim}>
          {mode === 'DAYS' ? 'That’s 14 days, the most a multi-day event can have.' : 'That’s 60 dates, the most one event can have.'}
        </Txt>
      )}
    </View>
  );
}

/** "Sat 13 · 8:00 PM" for a field label. */
const shortLine = (d: DateDraft) => (d.date ? `${shortDay(`${d.date}T12:00:00.000Z`)}${d.start ? ` · ${timeLabel(d.start)}` : ''}` : 'New date');

/**
 * Multiple dates: a ticket type's quantity is the same on every date, or set per date (an empty field keeps `base`).
 * `sold` (Edit): what each date has sold, keyed like `values`.
 */
export function PerDateFields({
  on,
  onToggle,
  dates,
  base,
  values,
  onChange,
  errors,
  errorKey,
  sold,
  disabled,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  dates: DateDraft[];
  base: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors: Record<string, string>;
  errorKey: string;
  sold?: Record<string, number>;
  disabled?: boolean;
}) {
  const live = dates.filter((x) => !x.cancelled);
  if (!on) {
    return (
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onToggle(true)} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
        <Txt variant="smallStrong" color={disabled ? colors.dim : colors.accent}>
          {`${base ? `${Number(base).toLocaleString('en-US')} on each date` : 'The same on each date'}${disabled ? '' : ' · Set per date'}`}
        </Txt>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt variant="smallStrong" color={colors.muted}>
          By date
        </Txt>
        <Pressable accessibilityRole="button" onPress={() => onToggle(false)} hitSlop={8}>
          <Txt variant="smallStrong" color={colors.accent}>
            Same on every date
          </Txt>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {live.map((x) => (
          <Field
            key={x.key}
            style={{ flexBasis: '46%', flexGrow: 1 }}
            label={shortLine(x)}
            placeholder={base || '100'}
            keyboardType="number-pad"
            value={values[x.key] ?? ''}
            onChangeText={(v) => onChange({ ...values, [x.key]: v.replace(/\D/g, '') })}
            error={errors[`${errorKey}-qty-${x.key}`]}
            hint={sold?.[x.key] ? `${sold[x.key].toLocaleString('en-US')} sold` : undefined}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Multi-day: the days a ticket type is valid on ("Weekend pass": both). `value` holds date keys; null is every day.
 * `locked` days can't be taken away (Edit: the type has sold, so its days can only be added to).
 */
export function DayChips({ name, dates, value, onChange, error, locked = [] }: { name: string; dates: DateDraft[]; value: string[] | null; onChange: (days: string[] | null) => void; error?: string; locked?: string[] }) {
  const live = dates.filter((x) => x.date && !x.cancelled).sort((a, b) => a.date.localeCompare(b.date));
  const all = !value || live.every((x) => value.includes(x.key));
  const toggle = (key: string) => {
    const now = value ?? live.map((x) => x.key);
    if (now.includes(key) && locked.includes(key)) return;
    const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    onChange(live.every((x) => next.includes(x.key)) ? null : next);
  };
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="smallStrong" color={colors.muted}>
        Valid on
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityLabel={`${name || 'This ticket'} is valid on`}>
        <Chip label={live.length > 1 ? `All ${live.length} days` : 'Every day'} active={all} onPress={() => onChange(null)} />
        {live.map((x) => (
          <Chip key={x.key} label={shortDay(`${x.date}T12:00:00.000Z`)} active={!all && !!value?.includes(x.key)} onPress={() => toggle(x.key)} accessibilityLabel={draftLine(x)} />
        ))}
      </View>
      {locked.length ? (
        <Txt variant="tiny" color={colors.dim}>
          Tickets of this type have been sold, so its days can only be added to.
        </Txt>
      ) : null}
      {error ? (
        <Txt variant="small" color={colors.accentHi}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  rowOpen: { paddingBottom: space.md, borderColor: colors.accentLine },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  row2: { flexDirection: 'row', gap: space.md },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: touch, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 },
});
