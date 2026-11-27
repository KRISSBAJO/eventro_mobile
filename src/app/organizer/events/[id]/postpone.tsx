/**
 * Postpone an event (org admins): new date to be announced. GET …/impact says who it reaches first (paid orders,
 * tickets, guest list, tickets held by someone other than the buyer, people checking out right now). Postponing
 * (POST …/postpone, with a reason sent to ticket holders) pauses sales, keeps tickets valid and lets buyers get a
 * refund; after 90 days without a new date the event is cancelled and everyone refunded. A postponed event ends it
 * here with "It's back on, same date" (DELETE …/postpone), or with a new date in Edit. Below: the changes ticket holders
 * have been told about, with how many emails went out.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Label, OrgScreen } from '@/components/org-ui';
import { Button, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, num, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { EventImpact } from '@/lib/organizer';
import { colors, radius, space } from '@/theme';

const KIND = { TIME: 'New time', POSTPONED: 'Postponed', PERKS: 'Tier changed' } as const;

export default function PostponeEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = `/organizer/events/${encodeURIComponent(id ?? '')}`;
  const { user } = useAuth();
  // Waits for the session (a deep link or reload restores it first).
  const q = useQuery({ queryKey: ['organizer', 'impact', id, user?.id], queryFn: () => api<EventImpact>(`${path}/impact`), enabled: !!id && !!user, staleTime: 0 });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  if (q.isPending) {
    return (
      <OrgScreen title="Postpone">
        <Skeleton height={200} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !q.data) {
    return (
      <OrgScreen title="Postpone">
        <ErrorState message={q.error ? errorText(q.error) : 'Event not found.'} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }

  const i = q.data;
  const postponed = !!i.postponedAt;
  const reasonOk = reason.trim().length >= 10;
  const paid = i.paidCents.filter((p) => p.cents > 0).map((p) => money(p.cents, p.currency)).join(' + ');
  const refresh = () => Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['organizer'] })]);

  const postpone = async () => {
    setError('');
    const yes = await confirm({
      title: 'Postpone this event?',
      message: `Sales pause and ${i.paidOrders ? `${num(i.paidOrders)} ${i.paidOrders === 1 ? 'buyer is' : 'buyers are'}` : 'ticket holders are'} told, with your reason. Tickets stay valid, and buyers can get a refund. Set the new date within 90 days, or the event is cancelled and everyone refunded.`,
      confirmLabel: 'Postpone',
      cancelLabel: 'Keep the date',
    });
    if (!yes) return;
    setBusy(true);
    try {
      await api(`${path}/postpone`, { body: { reason: reason.trim() } });
      haptic.success();
      setReason('');
      setNote('Postponed. Sales are paused and ticket holders are being told. Set the new date in Edit when you have it.');
      await refresh();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const backOn = async () => {
    setError('');
    setBusy(true);
    try {
      await api(`${path}/postpone`, { method: 'DELETE' });
      haptic.success();
      setNote('Back on. Sales are open again and ticket holders are being told it goes ahead as planned.');
      await refresh();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgScreen
      title={postponed ? 'Postponed' : 'Postpone'}
      eyebrow="New date to be announced"
      footer={
        postponed ? (
          <View style={{ gap: space.sm }}>
            <Button label="Set the new date" icon="calendar" onPress={() => router.push({ pathname: '/organizer/events/[id]/edit', params: { id: id! } })} />
            <Button label="It’s back on, same date" variant="ghost" loading={busy} onPress={() => void backOn()} />
          </View>
        ) : (
          <Button label="Postpone and tell ticket holders" loading={busy} disabled={!reasonOk} onPress={() => void postpone()} />
        )
      }
    >
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      {postponed ? (
        <Notice tone="warning" icon="clock" title={`Postponed since ${when(i.postponedAt!).short}`}>
          {`${i.postponeReason ? `“${i.postponeReason}”. ` : ''}Sales are paused and buyers can get a refund. After 90 days without a new date, the event is cancelled and every buyer refunded.`}
        </Notice>
      ) : (
        <>
          <View style={styles.card}>
            <Label>Who it reaches</Label>
            <Line big={num(i.paidOrders)} text={`paid ${i.paidOrders === 1 ? 'order' : 'orders'}${paid ? ` (${paid})` : ''}`} />
            <Line big={num(i.tickets)} text={`${i.tickets === 1 ? 'ticket' : 'tickets'} out${i.comps ? `, ${num(i.comps)} on the guest list` : ''}`} />
            {i.transferred ? <Line big={num(i.transferred)} text="held by someone other than the buyer (both are told)" /> : null}
            {i.activeHolds ? <Line big={num(i.activeHolds)} text={`${i.activeHolds === 1 ? 'person' : 'people'} checking out right now`} /> : null}
          </View>
          <View style={styles.card}>
            <Label>What happens</Label>
            <Txt variant="small" color={colors.muted}>
              Sales pause and tickets stay valid for the new date. Ticket holders get an email and a notification with your reason, and buyers can get a full refund. Set the new date within 90 days, or the event is cancelled and everyone refunded.
            </Txt>
          </View>
          <Field
            label="Reason (sent to ticket holders)"
            placeholder="e.g. The venue needs repairs, so we’re finding a new date."
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            style={{ minHeight: 0 }}
            hint={reasonOk ? `${reason.trim().length} / 500` : 'At least 10 characters.'}
          />
        </>
      )}

      {i.changes?.length ? (
        <View style={styles.card}>
          <Label>Told to ticket holders</Label>
          {i.changes.map((c) => (
            <View key={c.id} style={styles.change}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">{KIND[c.kind] ?? c.kind}</Txt>
                <Txt variant="small" color={colors.muted}>
                  {c.kind === 'TIME' && c.fromStartsAt !== c.toStartsAt
                    ? `${when(c.fromStartsAt).short} → ${when(c.toStartsAt).short}, ${when(c.toStartsAt).time}`
                    : c.kind === 'PERKS' && c.detail
                      ? `${c.detail.tier}: no longer ${(c.detail.removed ?? []).join(', ')}`
                      : when(c.createdAt).short}
                </Txt>
              </View>
              <Txt variant="small" color={c.failed ? colors.accent : colors.dim}>
                {`${num(c.emailed)} sent${c.failed ? ` · ${num(c.failed)} failed` : ''}`}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </OrgScreen>
  );
}

function Line({ big, text }: { big: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
      <Txt variant="h3">{big}</Txt>
      <Txt color={colors.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  change: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
});
