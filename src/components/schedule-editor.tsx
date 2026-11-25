/**
 * The organizer's schedule editor (lib/schedule.ts), used by Create event and Edit event. Everything is optional.
 *
 * Each item is a short row ("10:30 AM · Keynote") that opens to its fields: the date or day (DATES/DAYS), start and an
 * optional end, title, stage, people, a short note, the kind, and "Let ticket holders book a place" with the number of
 * places and, optionally, the ticket types that can book. Times are wall-clock strings like the rest of the event
 * form; an item belongs to its date (or the event's date), and "After midnight" puts it on the next calendar day (a
 * late set at 1 AM). Items are kept in time order, numbered as they're sent, so the API's "Item 3: …" messages match.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { TimeField, timeLabel } from '@/components/date-time';
import { ToggleCard } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { Button, Chip, Field, Txt } from '@/components/ui';
import { shortDay, type DateMode } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { wallIso, wallParts } from '@/lib/organizer';
import { KINDS, type OrganizerItem, type ScheduleKind } from '@/lib/schedule';
import { colors, radius, space, touch } from '@/theme';

export type ItemDraft = {
  key: string;
  /** an existing item (Edit) */
  id: string | null;
  /** DATES/DAYS: the date row's key */
  dateKey: string | null;
  start: string;
  end: string;
  /** days after its date (1: after midnight) */
  offset: number;
  title: string;
  stage: string;
  /** names, separated by commas */
  people: string;
  note: string;
  kind: ScheduleKind;
  bookable: boolean;
  places: string;
  /** the ticket types (the form's tier keys) that can book; null: any ticket */
  tiers: string[] | null;
  /** Edit: places booked now */
  reserved: number;
};

/** A date the items can be on: the form's date rows (DATES/DAYS), or the event's own date (SINGLE, key "event"). */
export type ScheduleDate = { key: string; date: string; start: string; label?: string; cancelled?: boolean };

export const MAX_ITEMS = 200;
export const MAX_BOOKABLE = 60;
const MAX_PEOPLE = 12;

const newKey = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newItem = (after?: Partial<ItemDraft>): ItemDraft => ({
  key: newKey(),
  id: null,
  dateKey: after?.dateKey ?? null,
  start: after?.end || '',
  end: '',
  offset: after?.end ? (after.offset ?? 0) : 0,
  title: '',
  stage: after?.stage ?? '',
  people: '',
  note: '',
  kind: 'OTHER',
  bookable: false,
  places: '',
  tiers: null,
  reserved: 0,
});

const addDays = (ymd: string, n: number) => {
  if (!n) return ymd;
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** The item's date: its own (DATES/DAYS) or the event's, moved on by `offset` days. */
function anchorOf(i: ItemDraft, mode: DateMode, dates: ScheduleDate[]) {
  return mode === 'SINGLE' ? dates[0] : dates.find((d) => d.key === i.dateKey && !d.cancelled);
}

/** Its wall-clock start and end (an end before the start is the next day); null until it has a date and a time. */
export function itemTimes(i: ItemDraft, mode: DateMode, dates: ScheduleDate[]) {
  const a = anchorOf(i, mode, dates);
  if (!a?.date || !i.start) return null;
  const day = addDays(a.date, i.offset);
  const startsAt = wallIso(day, i.start);
  const endsAt = i.end ? wallIso(i.end <= i.start ? addDays(day, 1) : day, i.end) : null;
  return { startsAt, endsAt };
}

/** Time order (date, then start), keeping the organizer's order for ties and putting unfinished items last. */
export function sortItems(list: ItemDraft[], mode: DateMode, dates: ScheduleDate[]) {
  const at = (i: ItemDraft) => itemTimes(i, mode, dates)?.startsAt ?? '~';
  return list.map((i, n) => ({ i, n })).sort((a, b) => at(a.i).localeCompare(at(b.i)) || a.n - b.n).map((x) => x.i);
}

const peopleOf = (s: string) => {
  const seen = new Set<string>();
  return s
    .split(',')
    .map((p) => p.trim().slice(0, 80))
    .filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
};

/** The editor's problems, keyed `<key>-title` etc. (and `schedule` for the list). The API checks the times fit the event. */
export function scheduleErrors(list: ItemDraft[], mode: DateMode, dates: ScheduleDate[]) {
  const e: Record<string, string> = {};
  if (list.length > MAX_ITEMS) e.schedule = `A schedule can have up to ${MAX_ITEMS} items.`;
  if (list.filter((i) => i.bookable).length > MAX_BOOKABLE) e.schedule = `Up to ${MAX_BOOKABLE} items can be bookable.`;
  for (const i of list) {
    if (!i.title.trim()) e[`${i.key}-title`] = 'Add a title.';
    if (mode !== 'SINGLE' && !anchorOf(i, mode, dates)) e[`${i.key}-date`] = mode === 'DAYS' ? 'Pick the day it’s on.' : 'Pick the date it’s on.';
    if (!i.start) e[`${i.key}-start`] = 'Add a start time.';
    else if (i.end && i.end === i.start) e[`${i.key}-end`] = 'The end has to be after the start.';
    if (peopleOf(i.people).length > MAX_PEOPLE) e[`${i.key}-people`] = `Up to ${MAX_PEOPLE} people per item.`;
    if (i.bookable) {
      const n = Number(i.places);
      if (!i.places || !Number.isInteger(n) || n < 1) e[`${i.key}-places`] = 'How many places?';
      else if (n > 100_000) e[`${i.key}-places`] = 'Up to 100,000 places.';
      else if (n < i.reserved) e[`${i.key}-places`] = `${i.reserved} ${i.reserved === 1 ? 'place is' : 'places are'} booked, so at least ${i.reserved}.`;
    }
  }
  return e;
}

/**
 * The API's items, in time order. `dateRef` names an item's date (create: `{ dateRef }`, an index into `dates` as sent;
 * edit: `{ eventDateId }`); `tierRef` a ticket type (create: an index into `ticketTypes`; edit: its id).
 */
export function scheduleBody(list: ItemDraft[], mode: DateMode, dates: ScheduleDate[], refs: { dateRef: (key: string) => Record<string, unknown>; tierRef: (key: string) => string | null }) {
  return sortItems(list, mode, dates).map((i) => {
    const t = itemTimes(i, mode, dates)!;
    const people = peopleOf(i.people);
    return {
      ...(i.id ? { id: i.id } : {}),
      ...(mode !== 'SINGLE' && i.dateKey ? refs.dateRef(i.dateKey) : {}),
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      title: i.title.trim().slice(0, 120),
      note: i.note.trim().slice(0, 600),
      stage: i.stage.trim().slice(0, 60) || null,
      people,
      kind: i.kind,
      bookable: i.bookable,
      capacity: i.bookable ? Number(i.places) : null,
      eligibleTiers: i.bookable && i.tiers ? i.tiers.map(refs.tierRef).filter((x): x is string => !!x) : [],
    };
  });
}

/** The API's items as editable rows (Edit). `dateKeyOf`/`tierKeyOf` map the API's ids to the form's keys. */
export function draftsOfSchedule(items: OrganizerItem[], mode: DateMode, dates: ScheduleDate[], tierKeyOf: (raw: string) => string | null): ItemDraft[] {
  return items.map((x) => {
    const s = wallParts(x.startsAt)!;
    const e = wallParts(x.endsAt);
    const dateKey = mode === 'SINGLE' ? null : x.eventDateId;
    const anchor = mode === 'SINGLE' ? dates[0] : dates.find((d) => d.key === dateKey);
    const tiers = x.eligibleTiers.map(tierKeyOf).filter((k): k is string => !!k);
    return {
      key: x.id,
      id: x.id,
      dateKey,
      start: s.time,
      end: e?.time ?? '',
      offset: anchor?.date ? dayDiff(s.date, anchor.date) : 0,
      title: x.title,
      stage: x.stage ?? '',
      people: x.people.join(', '),
      note: x.note ?? '',
      kind: x.kind,
      bookable: x.bookable,
      places: x.capacity ? String(x.capacity) : '',
      tiers: tiers.length ? tiers : null,
      reserved: x.reserved,
    };
  });
}

/** "10:30 AM · Keynote", for a row and the review step. */
export const itemLine = (i: ItemDraft) => [i.start ? `${timeLabel(i.start)}${i.offset === 1 ? ' (next day)' : ''}` : 'No time yet', i.title.trim() || 'Untitled'].join(' · ');

export function ScheduleEditor({
  mode,
  list,
  onChange,
  dates,
  tiers,
  errors,
}: {
  mode: DateMode;
  list: ItemDraft[];
  onChange: (list: ItemDraft[]) => void;
  /** SINGLE: the event's date and start (one entry); DATES/DAYS: the date rows */
  dates: ScheduleDate[];
  /** the ticket types, for "Who can book" */
  tiers: { key: string; name: string }[];
  errors: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const live = dates.filter((d) => !d.cancelled && d.date);
  const sorted = sortItems(list, mode, dates);
  const stages = [...new Set(list.map((i) => i.stage.trim()).filter(Boolean))].slice(0, 8);
  const patch = (key: string, p: Partial<ItemDraft>) => onChange(list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const add = (after?: ItemDraft) => {
    if (list.length >= MAX_ITEMS) return;
    haptic.select();
    const last = after ?? sorted[sorted.length - 1];
    const i = { ...newItem(last), ...(mode !== 'SINGLE' && !last && live.length === 1 ? { dateKey: live[0].key } : {}) };
    onChange([...list, i]);
    setOpen(i.key);
  };
  /** The same item again (a second workshop slot), as a new one. */
  const duplicate = (i: ItemDraft) => {
    if (list.length >= MAX_ITEMS) return;
    haptic.select();
    const copy = { ...i, key: newKey(), id: null, reserved: 0 };
    onChange([...list, copy]);
    setOpen(copy.key);
  };
  const remove = (key: string) => {
    haptic.select();
    onChange(list.filter((i) => i.key !== key));
  };
  const word = mode === 'DAYS' ? 'day' : 'date';
  /** A morning time on an evening event is most likely after midnight. */
  const guessOffset = (i: ItemDraft, start: string) => {
    const a = anchorOf(i, mode, dates);
    return a?.start && a.start >= '12:00' && start < '12:00' && start < a.start ? 1 : 0;
  };

  return (
    <View style={{ gap: space.sm }}>
      {sorted.map((i, n) => {
        const has = (f: string) => errors[`${i.key}-${f}`];
        const bad = ['title', 'date', 'start', 'end', 'places', 'people'].some(has);
        const isOpen = open === i.key || bad;
        const a = anchorOf(i, mode, dates);
        const meta = [mode !== 'SINGLE' && a?.date ? shortDay(`${a.date}T12:00:00.000Z`) : '', i.stage.trim(), i.bookable ? `Bookable${i.places ? `, ${i.places} places` : ''}` : ''].filter(Boolean).join(' · ');
        return (
          <View key={i.key} style={[styles.row, isOpen && styles.rowOpen]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`Item ${n + 1}: ${itemLine(i)}${meta ? `, ${meta}` : ''}`}
              onPress={() => {
                haptic.select();
                setOpen(isOpen ? null : i.key);
              }}
              style={styles.head}>
              <View style={[styles.num, bad && { borderColor: colors.accent }]}>
                <Txt variant="smallStrong" color={bad ? colors.accentHi : colors.muted}>
                  {n + 1}
                </Txt>
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1} color={i.title.trim() ? colors.text : colors.dim}>
                  {itemLine(i)}
                </Txt>
                {meta ? (
                  <Txt variant="tiny" color={colors.dim} numberOfLines={1}>
                    {meta}
                  </Txt>
                ) : null}
              </View>
              <View style={isOpen ? { transform: [{ rotate: '180deg' }] } : undefined}>
                <Icon name="chevronDown" size={18} color={colors.muted} />
              </View>
            </Pressable>
            {isOpen ? (
              <View style={{ gap: space.md }}>
                {mode !== 'SINGLE' ? (
                  <View style={{ gap: 6 }}>
                    <Txt variant="smallStrong" color={colors.muted}>
                      {mode === 'DAYS' ? 'Day' : 'Date'}
                    </Txt>
                    {live.length ? (
                      <View style={styles.wrap}>
                        {[...live]
                          .sort((x, y) => `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`))
                          .map((d) => (
                            <Chip key={d.key} label={`${shortDay(`${d.date}T12:00:00.000Z`)}${mode === 'DATES' && d.start ? ` · ${timeLabel(d.start)}` : ''}`} active={i.dateKey === d.key} onPress={() => patch(i.key, { dateKey: d.key })} />
                          ))}
                      </View>
                    ) : (
                      <Txt variant="small" color={colors.dim}>
                        {`Add the event’s ${word}s first.`}
                      </Txt>
                    )}
                    {has('date') ? (
                      <Txt variant="small" color={colors.accentHi}>
                        {has('date')}
                      </Txt>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.row2}>
                  <TimeField label="Starts" value={i.start} onChange={(v) => patch(i.key, { start: v, offset: guessOffset(i, v) })} error={has('start')} />
                  <TimeField label="Ends" value={i.end} onChange={(v) => patch(i.key, { end: v })} optional error={has('end')} />
                </View>
                {i.start && i.start < '12:00' ? (
                  <Pressable accessibilityRole="switch" accessibilityState={{ checked: i.offset === 1 }} onPress={() => patch(i.key, { offset: i.offset === 1 ? 0 : 1 })} hitSlop={8} style={styles.midnight}>
                    <View style={[styles.box, i.offset === 1 && styles.boxOn]}>{i.offset === 1 ? <Icon name="check" size={12} color={colors.accentInk} /> : null}</View>
                    <Txt variant="small" color={colors.muted}>
                      {`After midnight${a?.date ? ` (${shortDay(`${addDays(a.date, 1)}T12:00:00.000Z`)})` : ''}`}
                    </Txt>
                  </Pressable>
                ) : null}
                <Field label="Title" placeholder="e.g. Keynote, Opening set, Lunch" value={i.title} onChangeText={(v) => patch(i.key, { title: v })} maxLength={120} error={has('title')} />
                <View style={{ gap: 6 }}>
                  <Field label="Stage or room (optional)" placeholder="e.g. Main Stage" value={i.stage} onChangeText={(v) => patch(i.key, { stage: v })} maxLength={60} />
                  {stages.filter((s) => s !== i.stage.trim()).length ? (
                    <View style={styles.wrap}>
                      {stages
                        .filter((s) => s !== i.stage.trim())
                        .map((s) => (
                          <Pressable key={s} accessibilityRole="button" accessibilityLabel={`Use ${s}`} onPress={() => patch(i.key, { stage: s })} hitSlop={6} style={({ pressed }) => [styles.suggest, pressed && { backgroundColor: colors.surface2 }]}>
                            <Txt variant="tiny" color={colors.muted}>
                              {s}
                            </Txt>
                          </Pressable>
                        ))}
                    </View>
                  ) : null}
                </View>
                <Field label="People (optional)" placeholder="Names, separated by commas" value={i.people} onChangeText={(v) => patch(i.key, { people: v })} error={has('people')} autoCapitalize="words" />
                <Field label="Note (optional)" placeholder="One line fans should know" value={i.note} onChangeText={(v) => patch(i.key, { note: v })} maxLength={600} />
                <View style={{ gap: 6 }}>
                  <Txt variant="smallStrong" color={colors.muted}>
                    Kind
                  </Txt>
                  <View style={styles.wrap}>
                    {KINDS.map((k) => (
                      <Chip key={k.id} label={k.label} active={i.kind === k.id} onPress={() => patch(i.key, { kind: k.id })} />
                    ))}
                  </View>
                </View>
                <ToggleCard
                  label="Let ticket holders book a place"
                  sub={i.bookable ? `Free, with a ticket for the ${mode === 'SINGLE' ? 'event' : word}. Booking closes when it starts.` : 'For workshops, meet-and-greets, tastings: limited places.'}
                  value={i.bookable}
                  onChange={(v) => patch(i.key, { bookable: v })}
                />
                {i.bookable ? (
                  <View style={{ gap: space.md }}>
                    <Field
                      label="Places"
                      placeholder="e.g. 30"
                      keyboardType="number-pad"
                      value={i.places}
                      onChangeText={(v) => patch(i.key, { places: v.replace(/\D/g, '') })}
                      error={has('places')}
                      hint={i.reserved ? `${i.reserved} booked so far.` : undefined}
                    />
                    {tiers.length > 1 ? (
                      <View style={{ gap: 6 }}>
                        <Txt variant="smallStrong" color={colors.muted}>
                          Who can book
                        </Txt>
                        <View style={styles.wrap}>
                          <Chip label="Any ticket" active={!i.tiers?.length} onPress={() => patch(i.key, { tiers: null })} />
                          {tiers.map((t) => {
                            const on = !!i.tiers?.includes(t.key);
                            return (
                              <Chip
                                key={t.key}
                                label={t.name.trim() || 'Untitled ticket'}
                                active={on}
                                onPress={() => {
                                  const next = on ? (i.tiers ?? []).filter((k) => k !== t.key) : [...(i.tiers ?? []), t.key];
                                  patch(i.key, { tiers: next.length && next.length < tiers.length ? next : null });
                                }}
                              />
                            );
                          })}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : i.reserved ? (
                  <Txt variant="small" color={colors.warning}>
                    {`${i.reserved} ${i.reserved === 1 ? 'person has' : 'people have'} booked. Saving cancels their places and tells them.`}
                  </Txt>
                ) : null}
                <View style={styles.wrap}>
                  {list.length < MAX_ITEMS ? <Button label="Duplicate" variant="ghost" size="sm" icon="plus" onPress={() => duplicate(i)} /> : null}
                  <Button label="Remove" variant="ghost" size="sm" icon="trash" onPress={() => remove(i.key)} />
                </View>
                {i.reserved ? (
                  <Txt variant="tiny" color={colors.dim}>
                    {`Removing it, or changing its time, tells the ${i.reserved} ${i.reserved === 1 ? 'person' : 'people'} who booked.`}
                  </Txt>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {errors.schedule ? (
        <Txt variant="small" color={colors.accentHi}>
          {errors.schedule}
        </Txt>
      ) : null}
      {list.length < MAX_ITEMS ? (
        <Pressable accessibilityRole="button" onPress={() => add()} style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.surface2 }]}>
          <Icon name="plus" size={16} color={colors.accent} />
          <Txt variant="smallStrong" color={colors.accent}>
            {list.length ? 'Add another item' : 'Add the first item'}
          </Txt>
        </Pressable>
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  suggest: { paddingHorizontal: 10, height: 26, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, justifyContent: 'center' },
  midnight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', minHeight: 32 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: touch, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 },
});
