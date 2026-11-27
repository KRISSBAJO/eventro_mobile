/**
 * Sales and checkout (org admins and managers): when each ticket type goes on sale and stops, the presale code, the
 * age limit, and the questions asked at checkout. Saved together: PATCH /organizer/events/:id (presale, age,
 * questions) and PATCH …/ticket-types/:id for each ticket type whose times changed. Times are picked in the phone's
 * own time and sent as instants.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { DateField, TimeField } from '@/components/date-time';
import { Label, OrgScreen } from '@/components/org-ui';
import { Button, Chip, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useOrgEvent, type OrgEventDetail } from '@/lib/organizer';
import type { CheckoutQuestion } from '@/lib/types';
import { colors, radius, space } from '@/theme';

const MAX_QUESTIONS = 8;
const AGES = [
  ['', 'All ages'],
  ['12', '12+'],
  ['16', '16+'],
  ['18', '18+'],
  ['21', '21+'],
] as const;

type When = { date: string; time: string };
const pad = (n: number) => String(n).padStart(2, '0');
/** An instant as the phone's local date and time ("" for none), and back (null without a date). */
const toLocal = (iso: string | null | undefined): When => {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};
const toIso = (w: When) => (w.date ? new Date(`${w.date}T${w.time || '00:00'}:00`).toISOString() : null);
const same = (a: When, b: When) => toIso(a) === toIso(b);

type Draft = { key: string; id?: string; label: string; type: 'TEXT' | 'CHOICE'; options: string; required: boolean; per: 'ORDER' | 'TICKET' };
const draftOf = (q: CheckoutQuestion): Draft => ({ key: q.id, id: q.id, label: q.label, type: q.type, options: q.options.join(', '), required: q.required, per: q.per });

export default function SalesSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useOrgEvent(id);
  // The form starts over from what the server has only after a save (a background refresh never resets what's typed).
  const [version, setVersion] = useState(0);
  if (q.isPending) {
    return (
      <OrgScreen title="Sales and checkout">
        <Skeleton height={240} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !q.data) {
    return (
      <OrgScreen title="Sales and checkout">
        <ErrorState message={q.error ? errorText(q.error) : 'Event not found.'} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }
  return <Form key={version} e={q.data} justSaved={version > 0} onSaved={() => setVersion((v) => v + 1)} />;
}

function Form({ e, justSaved, onSaved }: { e: OrgEventDetail; justSaved: boolean; onSaved: () => void }) {
  const qc = useQueryClient();
  // One row per ticket type (an event with several dates has a copy per date; they share their times).
  const tiers = e.ticketTypes.filter((t, i, all) => all.findIndex((x) => (x.tierKey ?? x.id) === (t.tierKey ?? t.id)) === i);
  const [times, setTimes] = useState<Record<string, { start: When; end: When }>>(() => Object.fromEntries(tiers.map((t) => [t.id, { start: toLocal(t.salesStart), end: toLocal(t.salesEnd) }])));
  const [code, setCode] = useState(e.presaleCode ?? '');
  const [opens, setOpens] = useState<When>(toLocal(e.presaleStartsAt));
  const [age, setAge] = useState(e.minAge ? String(e.minAge) : '');
  const [qs, setQs] = useState<Draft[]>(() => (e.questions ?? []).map(draftOf));
  const [seq, setSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState(justSaved ? 'Saved.' : '');

  const setTime = (tid: string, side: 'start' | 'end', p: Partial<When>) => {
    setTimes((m) => ({ ...m, [tid]: { ...m[tid], [side]: { ...m[tid][side], ...p } } }));
    setError('');
    setNote('');
  };
  const patchQ = (key: string, p: Partial<Draft>) => {
    setQs((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)));
    setError('');
    setNote('');
  };

  const save = async () => {
    setError('');
    setNote('');
    const c = code.trim().toUpperCase();
    if (c && !/^[A-Z0-9-]{3,30}$/.test(c)) return setError('A presale code is 3 to 30 letters, numbers or dashes.');
    for (const t of tiers) {
      const s = toIso(times[t.id].start);
      const en = toIso(times[t.id].end);
      if (s && en && en <= s) return setError(`${t.name}: sales must end after they start.`);
    }
    const questions = [];
    for (const x of qs) {
      const label = x.label.trim();
      if (label.length < 2) return setError('Every question needs its wording.');
      const options = x.options.split(',').map((o) => o.trim()).filter(Boolean);
      if (x.type === 'CHOICE' && options.length < 2) return setError(`“${label}” needs at least two choices, separated by commas.`);
      questions.push({ ...(x.id ? { id: x.id } : {}), label, type: x.type, ...(x.type === 'CHOICE' ? { options } : {}), required: x.required, per: x.per });
    }
    setBusy(true);
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}`, { method: 'PATCH', body: { presaleCode: c, presaleStartsAt: c ? toIso(opens) : null, minAge: age ? Number(age) : null, questions } });
      for (const t of tiers) {
        const x = times[t.id];
        if (!same(x.start, toLocal(t.salesStart)) || !same(x.end, toLocal(t.salesEnd))) {
          await api(`/organizer/events/${encodeURIComponent(e.id)}/ticket-types/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { salesStart: toIso(x.start), salesEnd: toIso(x.end) } });
        }
      }
      haptic.success();
      // Fresh from the server first, then the form starts over from it.
      await qc.invalidateQueries({ queryKey: ['organizer'] });
      onSaved();
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const when = (tid: string, side: 'start' | 'end', label: string) => {
    const v = times[tid][side];
    return (
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <DateField label={label} value={v.date} onChange={(d) => setTime(tid, side, { date: d, time: v.time || (side === 'start' ? '10:00' : '18:00') })} />
          <TimeField label="Time" value={v.date ? v.time : ''} onChange={(t) => setTime(tid, side, { time: t })} />
        </View>
        {v.date ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setTime(tid, side, { date: '', time: '' })} style={{ alignSelf: 'flex-start' }}>
            <Txt variant="small" color={colors.accent}>
              Clear
            </Txt>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <OrgScreen title="Sales and checkout" eyebrow={e.title} footer={<Button label="Save" loading={busy} onPress={() => void save()} />}>
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      <View style={styles.card}>
        <Label>On-sale times</Label>
        <Txt variant="small" color={colors.muted}>
          Leave a time empty to sell from the moment the event is on sale, until it starts. Times are in this phone’s time zone.
        </Txt>
        {tiers.map((t) => (
          <View key={t.id} style={styles.block}>
            <Txt variant="bodyStrong">{t.name}</Txt>
            {when(t.id, 'start', 'On sale from')}
            {when(t.id, 'end', 'Sales end')}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Label>Presale</Label>
        <Txt variant="small" color={colors.muted}>
          Give fans a code to buy before a ticket type’s on-sale time.
        </Txt>
        <Field label="Presale code (optional)" value={code} onChangeText={(t) => (setCode(t.replace(/\s/g, '')), setError(''), setNote(''))} autoCapitalize="characters" autoCorrect={false} maxLength={30} placeholder="e.g. FANS-FIRST" />
        {code.trim() ? (
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <DateField label="Presale opens (optional)" value={opens.date} onChange={(d) => setOpens((o) => ({ date: d, time: o.time || '10:00' }))} />
            <TimeField label="Time" value={opens.date ? opens.time : ''} onChange={(t) => setOpens((o) => ({ ...o, time: t }))} />
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Label>Age limit</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {AGES.map(([v, label]) => (
            <Chip key={v || 'all'} label={label} active={age === v} onPress={() => (setAge(v), setNote(''))} />
          ))}
        </View>
        <Txt variant="small" color={colors.dim}>
          Shown on the event, at checkout and on the ticket. Door staff still check ID.
        </Txt>
      </View>

      <View style={styles.card}>
        <Label>Questions at checkout</Label>
        <Txt variant="small" color={colors.muted}>
          Ask buyers what you need to know: a T-shirt size, dietary needs, each attendee’s name. Answers show with your attendees.
        </Txt>
        {qs.map((x, i) => (
          <View key={x.key} style={styles.block}>
            <Field label={`Question ${i + 1}`} value={x.label} onChangeText={(t) => patchQ(x.key, { label: t })} maxLength={120} placeholder="e.g. T-shirt size" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip label="Short text" active={x.type === 'TEXT'} onPress={() => patchQ(x.key, { type: 'TEXT' })} />
              <Chip label="Pick from a list" active={x.type === 'CHOICE'} onPress={() => patchQ(x.key, { type: 'CHOICE' })} />
            </View>
            {x.type === 'CHOICE' ? <Field label="Choices, separated by commas" value={x.options} onChangeText={(t) => patchQ(x.key, { options: t })} placeholder="S, M, L, XL" /> : null}
            <View style={styles.toggle}>
              <Txt style={{ flex: 1 }}>Required</Txt>
              <Switch value={x.required} onValueChange={(v) => patchQ(x.key, { required: v })} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Required" />
            </View>
            <View style={styles.toggle}>
              <Txt style={{ flex: 1 }}>Ask for each ticket</Txt>
              <Switch value={x.per === 'TICKET'} onValueChange={(v) => patchQ(x.key, { per: v ? 'TICKET' : 'ORDER' })} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Ask for each ticket" />
            </View>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => (setQs((list) => list.filter((y) => y.key !== x.key)), setNote(''))} style={{ alignSelf: 'flex-start' }}>
              <Txt variant="smallStrong" color={colors.accent}>
                Remove question
              </Txt>
            </Pressable>
          </View>
        ))}
        {qs.length < MAX_QUESTIONS ? (
          <Button
            label="Add a question"
            icon="plus"
            variant="ghost"
            size="md"
            onPress={() => {
              setSeq((n) => n + 1);
              setQs((list) => [...list, { key: `new-${seq}`, label: '', type: 'TEXT', options: '', required: false, per: 'ORDER' }]);
              setNote('');
            }}
          />
        ) : (
          <Txt variant="small" color={colors.dim}>{`That’s the most an event can ask (${MAX_QUESTIONS}).`}</Txt>
        )}
      </View>
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  block: { gap: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
