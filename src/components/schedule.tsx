/**
 * The schedule as fans see it (lib/schedule.ts): a clean timetable (time, title, stage and people, a short note),
 * by date or day when the event has more than one, with stage filters when there is more than one stage. Bookable
 * sessions show their places left quietly and, when the screen gives one, a single action ("Book a place",
 * "Booked", …) on the right. Used by the event screen; the ticket screen uses SessionRow for its sessions.
 */
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { dateLine, shortDay, type EventDate } from '@/lib/dates';
import { when } from '@/lib/format';
import { groupSchedule, placesText, type ScheduleItem } from '@/lib/schedule';
import { colors, space } from '@/theme';
import { Chip, Txt } from './ui';

export function ScheduleList({
  items,
  stages = [],
  dates = [],
  dateId,
  action,
  status,
}: {
  items: ScheduleItem[];
  stages?: string[];
  /** DATES/DAYS: the event's dates (items are grouped by them) */
  dates?: EventDate[];
  /** the date to open on (DATES: the one the fan picked for tickets) */
  dateId?: string | null;
  /** a bookable item's action (Book a place, Booked…), on the right of its row */
  action?: (item: ScheduleItem) => ReactNode;
  /** a bookable item's quiet line, instead of its places left (why it can't be booked) */
  status?: (item: ScheduleItem) => string | null;
}) {
  const groups = groupSchedule(items, dates);
  const [picked, setPicked] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  // The date shown: the fan's pick here, else the one passed in (DATES tickets), else the first.
  const current = groups.find((g) => g.dateId === picked) ?? groups.find((g) => g.dateId === dateId) ?? groups[0];
  if (!current) return null;
  // The stages on the date shown (a festival's tent may only be up on one day).
  const here = stages.filter((s) => current.items.some((i) => i.stage === s));
  const on = stage && here.includes(stage) ? stage : null;
  const shown = on ? current.items.filter((i) => i.stage === on) : current.items;
  const date = dates.find((d) => d.id === current.dateId);
  return (
    <View style={{ gap: space.md }}>
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityLabel="Schedule date">
          {groups.map((g) => {
            const d = dates.find((x) => x.id === g.dateId);
            if (!d) return null;
            return <Chip key={g.dateId} label={d.label ? `${shortDay(d.startsAt)} · ${d.label}` : shortDay(d.startsAt)} active={g === current} onPress={() => setPicked(g.dateId)} accessibilityLabel={dateLine(d, { time: false })} />;
          })}
        </ScrollView>
      ) : date ? (
        <Txt variant="smallStrong" color={colors.muted}>
          {dateLine(date, { time: false })}
        </Txt>
      ) : null}
      {here.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityLabel="Stage">
          <Chip label="All stages" active={!on} onPress={() => setStage(null)} />
          {here.map((s) => (
            <Chip key={s} label={s} active={on === s} onPress={() => setStage(on === s ? null : s)} />
          ))}
        </ScrollView>
      ) : null}
      <View>
        {shown.map((i, n) => (
          <TimetableRow key={i.id} item={i} first={n === 0} action={i.bookable ? action?.(i) : null} line={i.bookable ? (status?.(i) ?? quietLine(i)) : null} />
        ))}
        {!shown.length ? (
          <Txt variant="small" color={colors.muted} style={{ paddingVertical: space.md }}>
            Nothing on this stage.
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/** "12 places left · VIP only" */
function quietLine(i: ScheduleItem) {
  const only = i.eligibleTierNames.length ? `${i.eligibleTierNames.join(', ')} only` : '';
  return [placesText(i.placesLeft), only].filter(Boolean).join(' · ');
}

/** One timetable line: time on the left; title, stage and people, note, and for bookable items a quiet line and an action. */
function TimetableRow({ item: i, first, action, line }: { item: ScheduleItem; first: boolean; action?: ReactNode; line: string | null }) {
  const start = when(i.startsAt).time;
  const end = i.endsAt ? when(i.endsAt).time : null;
  const meta = [i.stage, i.people.join(', ')].filter(Boolean).join(' · ');
  const quiet = i.kind === 'BREAK';
  return (
    <View
      style={[styles.row, !first && styles.rowLine]}
      accessible={!action}
      accessibilityLabel={`${start}${end ? ` to ${end}` : ''}: ${i.title}${meta ? `, ${meta}` : ''}${line ? `. ${line}` : ''}`}>
      <View style={styles.time}>
        <Txt variant="smallStrong" color={quiet ? colors.muted : colors.text}>
          {start}
        </Txt>
        {end ? (
          <Txt variant="tiny" color={colors.dim}>
            {end}
          </Txt>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant={quiet ? 'body' : 'bodyStrong'} color={quiet ? colors.muted : colors.text}>
          {i.title}
        </Txt>
        {meta ? (
          <Txt variant="small" color={colors.muted}>
            {meta}
          </Txt>
        ) : null}
        {i.note ? (
          <Txt variant="small" color={colors.dim}>
            {i.note}
          </Txt>
        ) : null}
        {line || action ? (
          <View style={styles.bookRow}>
            <Txt variant="tiny" color={colors.dim} style={{ flex: 1 }}>
              {line ?? ''}
            </Txt>
            {action}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A session on the ticket screen: when, what and where, and on the right its action. `sub` is its status line. */
export function SessionRow({ title, startsAt, endsAt, stage, sub, subTone, showDay, action, first }: { title: string; startsAt: string; endsAt: string | null; stage: string | null; sub?: string | null; subTone?: 'success' | 'muted'; showDay?: boolean; action?: ReactNode; first?: boolean }) {
  const w = when(startsAt);
  const end = endsAt ? when(endsAt).time : null;
  return (
    <View style={[styles.session, !first && styles.rowLine]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="tiny" color={colors.dim}>
          {`${showDay ? `${shortDay(startsAt)} · ` : ''}${w.time}${end ? ` – ${end}` : ''}${stage ? ` · ${stage}` : ''}`}
        </Txt>
        <Txt variant="bodyStrong">{title}</Txt>
        {sub ? (
          <Txt variant="small" color={subTone === 'success' ? colors.success : colors.muted}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2 },
  time: { width: 68, gap: 1, paddingTop: 2 },
  bookRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4, minHeight: 30 },
  session: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
