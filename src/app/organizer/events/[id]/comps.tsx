/**
 * Comps for an event: complimentary tickets the team gives away (press, artists, sponsors, crew).
 *
 *   GET  /organizer/events/:id/comps                    the list and its summary (admins, managers, door staff)
 *   POST /organizer/events/:id/comps                    issue: a ticket type, recipients (name + email, added one by
 *                                                       one) or pasted lines, an optional group and note (up to 200)
 *   POST /organizer/events/:id/comps/:orderId/revoke    an unused comp: its QR stops working and the holder is emailed
 *   POST /organizer/events/:id/comps/:orderId/resend    the claim email again, while it hasn't been claimed
 *
 * Each comp is a real ticket on a $0 order; the recipient gets an email with a link to claim it (the gift flow). Comps
 * count against the ticket type's capacity and the event's comp limit (Edit event). Door staff can see the list but
 * not issue, revoke or resend (the API answers 403; the screen doesn't offer it).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Segmented } from '@/components/form-ui';
import { GroupPicker, LineErrors } from '@/components/guest-ui';
import { Icon } from '@/components/icons';
import { Label, OrgScreen, StatTile, TileRow } from '@/components/org-ui';
import { Badge, Button, Chip, EmptyState, ErrorState, Field, Notice, Skeleton, TextArea, Txt } from '@/components/ui';
import { api, errorText, lineErrors } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { localStamp, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { canEdit, COMP_MAX, COMP_STATUS, membershipOf, useComps, useOrgEvent, type Comp, type CompStatus } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space, touch } from '@/theme';

const NOTE_MAX = 300;
const FILTERS: { id: '' | CompStatus; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'SENT', label: 'Sent' },
  { id: 'CLAIMED', label: 'Claimed' },
  { id: 'CHECKED_IN', label: 'Checked in' },
  { id: 'REVOKED', label: 'Revoked' },
];

export default function Comps() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  const list = useComps(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const role = membershipOf(orgs.data, ev.data?.orgId)?.role;
  const editor = canEdit(role);
  const [filter, setFilter] = useState<'' | CompStatus>('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const path = `/organizer/events/${encodeURIComponent(id!)}/comps`;
  const reload = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['organizer', 'comps', id] }),
      qc.invalidateQueries({ queryKey: ['organizer', 'stats', id] }),
      qc.invalidateQueries({ queryKey: ['organizer', 'attendees', id] }),
    ]);

  const revoke = async (c: Comp) => {
    const yes = await confirm({
      title: `Revoke ${c.name}’s comp?`,
      message: `Their QR code stops working and ${c.email} gets an email saying the complimentary ticket was cancelled. The place is freed up. This can’t be undone.`,
      confirmLabel: 'Revoke comp',
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    setBusy(c.orderId);
    try {
      await api(`${path}/${encodeURIComponent(c.orderId)}/revoke`, { body: {} });
      haptic.success();
      setMessage({ ok: true, text: `${c.name}’s comp is revoked. We’ve emailed them.` });
      await reload();
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const resend = async (c: Comp) => {
    setMessage(null);
    setBusy(c.orderId);
    try {
      await api(`${path}/${encodeURIComponent(c.orderId)}/resend`, { method: 'POST' });
      haptic.success();
      setMessage({ ok: true, text: `Sent the claim email to ${c.email} again.` });
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const data = list.data;
  const q = search.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((c) => (!filter || c.status === filter) && (!q || [c.name, c.email, c.group ?? ''].some((s) => s.toLowerCase().includes(q))));

  return (
    <OrgScreen title="Comps" eyebrow={ev.data?.title} onRefresh={() => Promise.all([list.refetch(), ev.refetch()])}>
      <Txt variant="small" color={colors.muted}>
        Complimentary tickets for press, artists, sponsors and crew. Each one is a real ticket: the person gets an email to claim it, then shows its QR code at the door. Comps aren’t sales and aren’t covered by the Omoshow Guarantee.
      </Txt>
      {message ? (
        <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
          {message.text}
        </Notice>
      ) : null}

      {list.isPending ? (
        <Skeleton height={110} radius={radius.card} />
      ) : list.error ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : data ? (
        <>
          <TileRow>
            <StatTile label="Issued" value={num(data.summary.issued)} sub={data.limit !== null ? `of ${num(data.limit)} allowed · ${num(data.summary.remaining ?? 0)} left` : 'No limit set'} />
            <StatTile label="Checked in" value={num(data.summary.checkedIn)} sub={`${num(data.summary.claimed)} claimed${data.summary.revoked ? ` · ${num(data.summary.revoked)} revoked` : ''}`} tone={data.summary.checkedIn ? 'success' : undefined} />
          </TileRow>
        </>
      ) : null}

      {editor && ev.data ? (
        <IssueForm
          ticketTypes={ev.data.ticketTypes.map((t) => ({ id: t.id, name: t.name }))}
          remaining={data?.summary.remaining ?? null}
          path={path}
          onIssued={async (n) => {
            setMessage({ ok: true, text: `Issued ${num(n)} ${n === 1 ? 'comp' : 'comps'}. We’ve emailed each person a link to claim theirs.` });
            await reload();
          }}
        />
      ) : role ? (
        <Notice tone="plain" icon="lock">
          Door staff can see comps but not issue, resend or revoke them.
        </Notice>
      ) : null}

      {data?.items.length ? (
        <View style={{ gap: space.md }}>
          <Label>Issued comps</Label>
          <Field label="Search" placeholder="Name, email or group" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Chip key={f.id || 'all'} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
            ))}
          </View>
          {!rows.length ? <EmptyState compact icon="users" title="Nobody matches" body="Try another name or filter." /> : null}
          {rows.map((c) => (
            <CompRow key={c.orderId} c={c} editor={editor} busy={busy === c.orderId} disabled={busy !== null} onRevoke={() => void revoke(c)} onResend={() => void resend(c)} />
          ))}
        </View>
      ) : data ? (
        <EmptyState compact icon="gift" title="No comps yet" body={editor ? 'Issue the first one above.' : 'Comps the team issues show up here.'} />
      ) : null}
    </OrgScreen>
  );
}

function CompRow({ c, editor, busy, disabled, onRevoke, onResend }: { c: Comp; editor: boolean; busy: boolean; disabled: boolean; onRevoke: () => void; onResend: () => void }) {
  const s = COMP_STATUS[c.status] ?? { label: c.status, tone: 'plain' as const };
  const seat = [c.section, c.row ? `Row ${c.row}` : null, c.seat !== null ? `Seat ${c.seat}` : null].filter(Boolean).join(' · ');
  const when =
    c.status === 'REVOKED' && c.revokedAt
      ? `Revoked ${localStamp(new Date(c.revokedAt).getTime())}`
      : c.status === 'CHECKED_IN' && c.checkedInAt
        ? `In · ${localStamp(new Date(c.checkedInAt).getTime())}`
        : c.claimedAt
          ? `Claimed ${localStamp(new Date(c.claimedAt).getTime())}`
          : `Sent ${localStamp(new Date(c.issuedAt).getTime())}${c.issuedBy?.name ? ` by ${c.issuedBy.name.split(' ')[0]}` : ''}`;
  const canRevoke = editor && (c.status === 'SENT' || c.status === 'CLAIMED');
  const canResend = editor && c.status === 'SENT';
  return (
    <View style={[styles.card, c.status === 'REVOKED' && { opacity: 0.65 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {c.name}
        </Txt>
        <Badge label={s.label} tone={s.tone} />
      </View>
      <Txt variant="small" color={colors.muted} numberOfLines={1}>
        {c.email}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Txt variant="small" color={colors.muted}>
          {c.ticketType.name}
          {seat ? ` · ${seat}` : ''}
        </Txt>
        {c.group ? <Badge label={c.group} /> : null}
      </View>
      <Txt variant="tiny" color={colors.dim}>
        {when}
      </Txt>
      {c.note ? (
        <Txt variant="small" color={colors.muted} style={{ fontStyle: 'italic' }}>
          “{c.note}”
        </Txt>
      ) : null}
      {canRevoke || canResend ? (
        <View style={styles.btns}>
          {canResend ? <Button label="Resend email" icon="mail" variant="subtle" size="sm" disabled={disabled} loading={busy} onPress={onResend} /> : null}
          {canRevoke ? <Button label="Revoke" variant="danger" size="sm" disabled={disabled} onPress={onRevoke} /> : null}
        </View>
      ) : null}
    </View>
  );
}

type Recipient = { name: string; email: string };

/** Issue comps: a ticket type, the people (one by one or pasted), and an optional group and note. */
function IssueForm({ ticketTypes, remaining, path, onIssued }: { ticketTypes: { id: string; name: string }[]; remaining: number | null; path: string; onIssued: (n: number) => Promise<void> }) {
  const [tt, setTt] = useState(ticketTypes[0]?.id ?? '');
  const [mode, setMode] = useState<'one' | 'paste'>('one');
  const [people, setPeople] = useState<Recipient[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<{ line: number; error: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pasted = text.split('\n').filter((l) => l.trim()).length;
  const count = mode === 'one' ? people.length + (name.trim() && emailOk(email) ? 1 : 0) : pasted;

  const addPerson = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter their name.';
    if (!emailOk(email)) e.email = 'Enter a valid email: the ticket goes there.';
    else if (people.some((p) => p.email.toLowerCase() === email.trim().toLowerCase())) e.email = 'They’re already on the list.';
    if (people.length >= COMP_MAX) e.name = `Up to ${COMP_MAX} at a time.`;
    setErrors(e);
    if (Object.keys(e).length) return false;
    haptic.select();
    setPeople((p) => [...p, { name: name.trim(), email: email.trim().toLowerCase() }]);
    setName('');
    setEmail('');
    return true;
  };

  const issue = async () => {
    setError('');
    setLines([]);
    let recipients = people;
    if (mode === 'one' && (name.trim() || email.trim())) {
      // What's typed but not added yet goes too.
      const e: Record<string, string> = {};
      if (name.trim().length < 2) e.name = 'Enter their name.';
      if (!emailOk(email)) e.email = 'Enter a valid email: the ticket goes there.';
      setErrors(e);
      if (Object.keys(e).length) return haptic.warning();
      recipients = [...people, { name: name.trim(), email: email.trim().toLowerCase() }];
    }
    if (!tt) return setError('Pick a ticket type.');
    if (mode === 'one' && !recipients.length) return setError('Add at least one person.');
    if (mode === 'paste' && !pasted) return setError('Paste at least one line: a name and an email.');
    if ((mode === 'one' ? recipients.length : pasted) > COMP_MAX) return setError(`Up to ${COMP_MAX} comps at a time.`);
    setBusy(true);
    try {
      const r = await api<{ issued: number }>(path, {
        body: {
          ticketTypeId: tt,
          ...(mode === 'one' ? { recipients } : { text: text.trim() }),
          ...(group.trim() ? { group: group.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        timeoutMs: 45_000,
      });
      haptic.success();
      setPeople([]);
      setName('');
      setEmail('');
      setText('');
      setNote('');
      await onIssued(r.issued);
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
      <Label>Issue comps</Label>
      {!ticketTypes.length ? (
        <Txt variant="small" color={colors.muted}>
          Add a ticket type in Edit first.
        </Txt>
      ) : (
        <>
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" color={colors.muted}>
              Ticket type
            </Txt>
            <View style={styles.chips}>
              {ticketTypes.map((t) => (
                <Chip key={t.id} label={t.name} active={tt === t.id} onPress={() => setTt(t.id)} />
              ))}
            </View>
          </View>
          <Segmented
            label="How to add people"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'one', label: 'One by one' },
              { id: 'paste', label: 'Paste a list' },
            ]}
          />
          {mode === 'one' ? (
            <View style={{ gap: space.sm }}>
              {people.map((p) => (
                <View key={p.email} style={styles.person}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="smallStrong" numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt variant="tiny" color={colors.muted} numberOfLines={1}>
                      {p.email}
                    </Txt>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={8} onPress={() => setPeople((list) => list.filter((x) => x.email !== p.email))} style={styles.x}>
                    <Icon name="close" size={14} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
              <Field label="Name" placeholder="Ada Obi" value={name} onChangeText={setName} autoCapitalize="words" error={errors.name} />
              <Field label="Email" placeholder="ada@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={errors.email} returnKeyType="done" onSubmitEditing={() => void addPerson()} />
              <Button label="Add another person" icon="plus" variant="ghost" size="sm" onPress={() => void addPerson()} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : (
            <TextArea
              label="Names and emails, one per line"
              placeholder={'Ada Obi, ada@example.com\nSam Lee <sam@example.com>'}
              value={text}
              onChangeText={setText}
              minHeight={140}
              hint={`“Name, email”, “Name <email>” or a tab between them. Up to ${COMP_MAX} lines.`}
            />
          )}
          <GroupPicker value={group} onChange={setGroup} />
          <Field label="Note (optional)" placeholder="e.g. Plus one at the box office" value={note} onChangeText={setNote} maxLength={NOTE_MAX} />
          <LineErrors errors={lines} />
          {error && !lines.length ? <Notice icon="alert">{error}</Notice> : null}
          {remaining !== null ? (
            <Txt variant="small" color={remaining <= 0 ? colors.accentHi : colors.dim}>
              {remaining <= 0 ? 'The comp limit is reached: raise it in Edit, or revoke an unused comp.' : `${num(remaining)} more can be issued under the event’s comp limit.`}
            </Txt>
          ) : null}
          <Button label={count > 1 ? `Issue ${num(count)} comps` : 'Issue comp'} icon="send" loading={busy} onPress={() => void issue()} />
          <Txt variant="tiny" color={colors.dim}>
            Comps count against the ticket type’s quantity. Each person gets an email to claim theirs.
          </Txt>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch, paddingLeft: space.md, paddingRight: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface2 },
  x: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
