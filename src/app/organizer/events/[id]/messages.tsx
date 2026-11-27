/**
 * Message ticket holders (org admins and managers): a short plain-text message ("Doors now 7 PM, bring ID") to
 * everyone holding a ticket, or to some ticket types. It goes by email and push and shows on their tickets.
 * GET …/messages says who a message would reach, how many more can go today (3 per event in 24 hours) and what was
 * sent; POST …/messages sends one. Event information only: no promotions. One date of a multi-date event can be
 * picked on the website.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Label, OrgScreen } from '@/components/org-ui';
import { Button, Chip, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { num, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme';

type Sent = { id: string; subject: string; body: string; sentAt: string; sentBy: string; ticketTypes: string[]; recipients: number; emailFailed: number; pushed: number; delivered: boolean };
type Messages = {
  messages: Sent[];
  ticketTypes: { id: string; name: string }[];
  audience: { people: number; tickets: number; stopped: number };
  limits: { perDay: number; leftToday: number; nextAt: string | null };
  canSend: boolean;
  closedWhy: string | null;
};
const people = (n: number) => `${num(n)} ${n === 1 ? 'person' : 'people'}`;

export default function MessageHolders() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = `/organizer/events/${encodeURIComponent(id ?? '')}/messages`;
  const { user } = useAuth();
  /** the ticket types picked (ids; none = everyone) */
  const [typeIds, setTypeIds] = useState<string[]>([]);
  // Waits for the session (a deep link or reload restores it first).
  const q = useQuery({
    queryKey: ['organizer', 'messages', id, user?.id, typeIds.join(',')],
    queryFn: () => api<Messages>(`${path}${typeIds.length ? `?ticketTypeIds=${typeIds.join(',')}` : ''}`),
    enabled: !!id && !!user,
    staleTime: 0,
    placeholderData: (prev) => prev,
    // While a message is going out, look again until its delivery numbers are in.
    refetchInterval: (query) => (query.state.data?.messages.some((m) => !m.delivered) ? 2500 : false),
  });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  if (q.isPending) {
    return (
      <OrgScreen title="Messages">
        <Skeleton height={220} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !q.data) {
    return (
      <OrgScreen title="Messages">
        <ErrorState message={q.error ? errorText(q.error) : 'Event not found.'} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }

  const m = q.data;
  const names = [...new Set(m.ticketTypes.map((t) => t.name))];
  // A type's copies (one per date) are picked together, by name.
  const idsOf = (name: string) => m.ticketTypes.filter((t) => t.name === name).map((t) => t.id);
  const types = names.filter((n) => idsOf(n).some((x) => typeIds.includes(x)));
  const toggle = (name: string) => setTypeIds((ids) => (types.includes(name) ? ids.filter((x) => !idsOf(name).includes(x)) : [...ids, ...idsOf(name)]));
  const reach = m.audience.people;
  const ready = subject.trim().length >= 3 && body.trim().length >= 10 && reach > 0 && m.limits.leftToday > 0;

  const send = async () => {
    setError('');
    setNote('');
    const yes = await confirm({
      title: `Send to ${people(reach)}?`,
      message: `“${subject.trim()}” goes to ${types.length ? `holders of ${types.join(', ')}` : 'everyone holding a ticket'} by email and push, and shows on their tickets. It can’t be unsent.`,
      confirmLabel: 'Send',
      cancelLabel: 'Keep editing',
    });
    if (!yes) return;
    setBusy(true);
    try {
      const r = await api<{ recipients: number }>(path, { body: { subject: subject.trim(), body: body.trim(), ...(typeIds.length ? { ticketTypeIds: typeIds } : {}) } });
      haptic.success();
      setSubject('');
      setBody('');
      setNote(`On its way to ${people(r.recipients)}.`);
      await qc.invalidateQueries({ queryKey: ['organizer', 'messages', id] });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgScreen
      title="Messages"
      eyebrow="To ticket holders"
      footer={m.canSend ? <Button label={m.limits.leftToday ? 'Review and send' : 'Limit reached for today'} icon="send" loading={busy} disabled={!ready} onPress={() => void send()} /> : undefined}
    >
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      {m.canSend ? (
        <>
          <View style={styles.card}>
            <Label>Who gets it</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip label="Everyone" active={!types.length} onPress={() => setTypeIds([])} />
              {names.length > 1 ? names.map((n) => <Chip key={n} label={n} active={types.includes(n)} onPress={() => toggle(n)} />) : null}
            </View>
            <Txt variant="small" color={colors.muted}>
              {reach ? `Reaches ${people(reach)} holding ${num(m.audience.tickets)} ${m.audience.tickets === 1 ? 'ticket' : 'tickets'}.` : m.audience.stopped ? 'Everyone holding these tickets has stopped these emails.' : 'Nobody holds these tickets yet.'}
              {reach && m.audience.stopped ? ` ${people(m.audience.stopped)} stopped these emails.` : ''}
            </Txt>
          </View>
          <Field label="Subject" placeholder="e.g. Doors now open at 7 PM" value={subject} onChangeText={setSubject} maxLength={120} />
          <Field
            label="Message"
            placeholder="What do ticket holders need to know? Times, entry, parking, what to bring."
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={1500}
            style={{ minHeight: 0 }}
            hint={`${body.length} / 1500 · For event information only, not promotions. ${m.limits.leftToday ? `${m.limits.leftToday} of ${m.limits.perDay} left in 24 hours.` : m.limits.nextAt ? `You can send again ${when(m.limits.nextAt).short}, ${when(m.limits.nextAt).time}.` : ''}`}
          />
        </>
      ) : (
        <Notice tone="plain" icon="alert">
          {m.closedWhy ?? 'Messages can’t be sent for this event.'}
        </Notice>
      )}

      {m.messages.length ? (
        <View style={styles.card}>
          <Label>Sent</Label>
          {m.messages.map((x) => (
            <View key={x.id} style={styles.sent}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {x.subject}
                </Txt>
                <Txt variant="small" color={colors.dim}>
                  {when(x.sentAt).short}
                </Txt>
              </View>
              <Txt variant="small" color={colors.muted} numberOfLines={4}>
                {x.body}
              </Txt>
              <Txt variant="small" color={x.emailFailed ? colors.accent : colors.dim}>
                {`${x.ticketTypes.length ? x.ticketTypes.join(', ') : 'Everyone'} · ${x.sentBy} · ${x.delivered ? `${people(x.recipients)}${x.emailFailed ? ` · ${num(x.emailFailed)} failed` : ''}${x.pushed ? ` · ${num(x.pushed)} by push` : ''}` : `Sending to ${people(x.recipients)}…`}`}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  sent: { gap: 4, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
});
