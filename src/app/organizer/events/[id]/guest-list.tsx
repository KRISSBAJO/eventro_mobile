/**
 * An event's guest list: people let in by name, with no ticket (plus-ones 0–10, a group, a note).
 *
 *   GET    /organizer/events/:id/guest-list?q=           entries and the summary (admins, managers, door staff)
 *   POST   /organizer/events/:id/guest-list              add one, or paste lines `name[, email][, +N][, group]`
 *   PATCH  /organizer/events/:id/guest-list/:entryId     edit (plus-ones can't drop below who's already in, less one)
 *   DELETE /organizer/events/:id/guest-list/:entryId     remove
 *
 * Guests are checked in at the door (Scan tickets → Guest list), online or offline. Door staff can see the list here
 * but not change it. Guest-list entries aren't tickets: they aren't sales and aren't covered by the Eventro Guarantee.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Segmented } from '@/components/form-ui';
import { CountStepper, GroupPicker, LineErrors } from '@/components/guest-ui';
import { Label, OrgScreen, StatTile, TileRow } from '@/components/org-ui';
import { Badge, Button, EmptyState, ErrorState, Field, Notice, Skeleton, TextArea, Txt } from '@/components/ui';
import { api, errorText, lineErrors } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { hereText } from '@/lib/door';
import { localStamp, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { canEdit, membershipOf, useGuestList, useOrgEvent } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import type { GuestEntry } from '@/lib/types';
import { colors, radius, space } from '@/theme';

const NAME_MAX = 120;
const NOTE_MAX = 300;
const PLUS_MAX = 10;
const PASTE_MAX = 500;

type Draft = { name: string; email: string; plusOnes: number; group: string; note: string };
const EMPTY: Draft = { name: '', email: '', plusOnes: 0, group: '', note: '' };

function draftErrors(d: Draft) {
  const e: Record<string, string> = {};
  if (d.name.trim().length < 2) e.name = 'Enter their name.';
  if (d.email.trim() && !emailOk(d.email)) e.email = 'Enter a valid email, or leave it empty.';
  return e;
}

export default function GuestListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const list = useGuestList(id, q);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const role = membershipOf(orgs.data, ev.data?.orgId)?.role;
  const editor = canEdit(role);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(t);
  }, [text]);

  const path = `/organizer/events/${encodeURIComponent(id!)}/guest-list`;
  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: ['organizer', 'guest-list', id] }), qc.invalidateQueries({ queryKey: ['organizer', 'stats', id] })]);

  const remove = async (g: GuestEntry) => {
    const yes = await confirm({
      title: `Remove ${g.name}?`,
      message: g.arrived ? `${hereText(g)}. They come off the guest list.` : 'They come off the guest list, so the door won’t find them.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    setBusy(g.id);
    try {
      await api(`${path}/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
      haptic.success();
      setMessage({ ok: true, text: `${g.name} is off the guest list.` });
      await reload();
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (g: GuestEntry, d: Draft) => {
    setMessage(null);
    setBusy(g.id);
    try {
      await api(`${path}/${encodeURIComponent(g.id)}`, {
        method: 'PATCH',
        body: { name: d.name.trim(), email: d.email.trim() ? d.email.trim().toLowerCase() : null, plusOnes: d.plusOnes, group: d.group.trim() || null, note: d.note.trim() || null },
      });
      haptic.success();
      setEditing(null);
      setMessage({ ok: true, text: `Saved ${d.name.trim()}.` });
      await reload();
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const data = list.data;
  const items = data?.items ?? [];

  return (
    <OrgScreen title="Guest list" eyebrow={ev.data?.title} onRefresh={() => list.refetch()}>
      <Txt variant="small" color={colors.muted}>
        People you let in by name, no ticket needed. The door finds them under Scan tickets → Guest list, even offline. Guest-list entries aren’t sales and aren’t covered by the Eventro Guarantee.
      </Txt>
      {message ? (
        <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
          {message.text}
        </Notice>
      ) : null}

      {data && !q ? (
        <TileRow>
          <StatTile label="Here" value={`${num(data.summary.arrived)} of ${num(data.summary.expected)}`} sub="guests and plus-ones" tone={data.summary.arrived ? 'success' : undefined} />
          <StatTile label="On the list" value={num(data.summary.entries)} sub={data.summary.entries === 1 ? 'entry' : 'entries'} />
        </TileRow>
      ) : null}

      {editor ? (
        <AddForm path={path} onAdded={async (n) => {
          setMessage({ ok: true, text: `Added ${num(n)} ${n === 1 ? 'guest' : 'guests'} to the list.` });
          await reload();
        }} />
      ) : role ? (
        <Notice tone="plain" icon="lock">
          Door staff can see the guest list and check guests in at the door, but not change the list.
        </Notice>
      ) : null}

      <View style={{ gap: space.md }}>
        <Label>On the list</Label>
        <Field label="Search" placeholder="Name, email or group" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        {list.isPending ? (
          <View style={{ gap: space.sm }}>
            <Skeleton height={72} radius={radius.card} />
            <Skeleton height={72} radius={radius.card} />
          </View>
        ) : list.error ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : !items.length ? (
          <EmptyState compact icon="users" title={q ? 'Nobody matches' : 'Nobody on the list yet'} body={q ? 'Try another name, email or group.' : editor ? 'Add the first guest above.' : 'Guests the team adds show up here.'} />
        ) : (
          items.slice(0, 300).map((g) =>
            editing === g.id ? (
              <EditEntry key={g.id} g={g} busy={busy === g.id} onCancel={() => setEditing(null)} onSave={(d) => void save(g, d)} />
            ) : (
              <View key={g.id} style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                    {g.name}
                  </Txt>
                  <Badge label={hereText(g)} tone={g.arrived >= g.partySize ? 'success' : g.arrived ? 'warning' : 'plain'} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <Txt variant="small" color={colors.muted}>
                    {g.plusOnes ? `+${g.plusOnes} ${g.plusOnes === 1 ? 'guest' : 'guests'}` : 'No plus-ones'}
                    {g.email ? ` · ${g.email}` : ''}
                  </Txt>
                  {g.group ? <Badge label={g.group} /> : null}
                </View>
                {g.note ? (
                  <Txt variant="small" color={colors.muted} style={{ fontStyle: 'italic' }}>
                    “{g.note}”
                  </Txt>
                ) : null}
                {g.firstArrivedAt ? (
                  <Txt variant="tiny" color={colors.dim}>
                    First in {localStamp(new Date(g.firstArrivedAt).getTime())}
                  </Txt>
                ) : null}
                {editor ? (
                  <View style={styles.btns}>
                    <Button label="Edit" variant="subtle" size="sm" disabled={busy !== null} onPress={() => setEditing(g.id)} />
                    <Button label="Remove" variant="danger" size="sm" loading={busy === g.id} disabled={busy !== null} onPress={() => void remove(g)} />
                  </View>
                ) : null}
              </View>
            ),
          )
        )}
        {items.length > 300 ? (
          <Txt variant="small" color={colors.dim}>
            Showing 300 of {num(items.length)}. Search to find someone.
          </Txt>
        ) : null}
      </View>

      <Button label="Check guests in at the door" icon="scan" variant="ghost" onPress={() => router.push({ pathname: '/door/[eventId]', params: { eventId: id! } })} />
    </OrgScreen>
  );
}

/** The person's details, used to add one and to edit one. */
function EntryFields({ d, set, errors, minPlus = 0 }: { d: Draft; set: (p: Partial<Draft>) => void; errors: Record<string, string>; minPlus?: number }) {
  return (
    <>
      <Field label="Name" placeholder="Ada Obi" value={d.name} onChangeText={(name) => set({ name })} autoCapitalize="words" maxLength={NAME_MAX} error={errors.name} />
      <Field label="Email (optional)" placeholder="ada@example.com" value={d.email} onChangeText={(email) => set({ email })} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={errors.email} />
      <CountStepper label="Plus-ones" value={d.plusOnes} min={minPlus} max={PLUS_MAX} onChange={(plusOnes) => set({ plusOnes })} less="One fewer plus-one" more="One more plus-one" />
      <GroupPicker value={d.group} onChange={(group) => set({ group })} />
      <Field label="Note (optional)" placeholder="e.g. Ask for the manager" value={d.note} onChangeText={(note) => set({ note })} maxLength={NOTE_MAX} />
    </>
  );
}

function EditEntry({ g, busy, onCancel, onSave }: { g: GuestEntry; busy: boolean; onCancel: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>({ name: g.name, email: g.email ?? '', plusOnes: g.plusOnes, group: g.group ?? '', note: g.note ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <View style={[styles.card, { gap: space.md, borderColor: colors.accentLine }]}>
      <Label>{`Edit ${g.name}`}</Label>
      <EntryFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} minPlus={Math.max(0, g.arrived - 1)} />
      {g.arrived > 1 ? (
        <Txt variant="tiny" color={colors.dim}>
          {`${hereText(g)}, so plus-ones can’t go below ${g.arrived - 1}.`}
        </Txt>
      ) : null}
      <View style={styles.btns}>
        <Button
          label="Save"
          size="sm"
          loading={busy}
          onPress={() => {
            const e = draftErrors(d);
            setErrors(e);
            if (Object.keys(e).length) return haptic.warning();
            onSave(d);
          }}
        />
        <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
      </View>
    </View>
  );
}

function AddForm({ path, onAdded }: { path: string; onAdded: (n: number) => Promise<void> }) {
  const [mode, setMode] = useState<'one' | 'paste'>('one');
  const [d, setD] = useState<Draft>(EMPTY);
  const [paste, setPaste] = useState('');
  const [defaultGroup, setDefaultGroup] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<{ line: number; error: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const count = paste.split('\n').filter((l) => l.trim()).length;

  const add = async () => {
    setError('');
    setLines([]);
    if (mode === 'one') {
      const e = draftErrors(d);
      setErrors(e);
      if (Object.keys(e).length) return haptic.warning();
    } else {
      if (!count) return setError('Paste at least one line with a name.');
      if (count > PASTE_MAX) return setError(`Up to ${PASTE_MAX} lines at a time.`);
    }
    setBusy(true);
    try {
      const r = await api<{ added: number }>(path, {
        body:
          mode === 'one'
            ? { entries: [{ name: d.name.trim(), ...(d.email.trim() ? { email: d.email.trim().toLowerCase() } : {}), plusOnes: d.plusOnes, ...(d.group.trim() ? { group: d.group.trim() } : {}), ...(d.note.trim() ? { note: d.note.trim() } : {}) }] }
            : { text: paste.trim(), ...(defaultGroup.trim() ? { group: defaultGroup.trim() } : {}) },
        timeoutMs: 45_000,
      });
      haptic.success();
      setD(EMPTY);
      setPaste('');
      await onAdded(r.added);
    } catch (e) {
      haptic.error();
      setLines(lineErrors(e));
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { gap: space.md }]}>
      <Label>Add to the list</Label>
      <Segmented
        label="How to add guests"
        value={mode}
        onChange={setMode}
        options={[
          { id: 'one', label: 'One guest' },
          { id: 'paste', label: 'Paste a list' },
        ]}
      />
      {mode === 'one' ? (
        <EntryFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} />
      ) : (
        <>
          <TextArea
            label="One guest per line"
            placeholder={'Ada Obi, ada@example.com, +2, Press\nSam Lee, +1\nTobi Bello'}
            value={paste}
            onChangeText={setPaste}
            minHeight={140}
            hint={`name, then optional email, +N plus-ones and group, separated by commas or tabs. Up to ${PASTE_MAX} lines.`}
          />
          <GroupPicker label="Group for lines without one (optional)" value={defaultGroup} onChange={setDefaultGroup} />
        </>
      )}
      <LineErrors errors={lines} />
      {error && !lines.length ? <Notice icon="alert">{error}</Notice> : null}
      <Button label={mode === 'paste' && count > 1 ? `Add ${num(count)} guests` : 'Add guest'} icon="plus" loading={busy} onPress={() => void add()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
});
