/**
 * Cancel an event (org admins). GET …/cancel-preview shows exactly what happens: paid orders refunded and how
 * much per currency, tickets voided, resale listings closed. The organizer gives a reason (sent to buyers) and
 * types the event's name; a last confirm sheet repeats the numbers before POST …/cancel. Calling it again on a
 * cancelled event only retries refunds that failed.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Label, OrgScreen } from '@/components/org-ui';
import { Button, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { money, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { CancelPreview, CancelSummary } from '@/lib/organizer';
import { colors, radius, space } from '@/theme';

export default function CancelEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const preview = useQuery({ queryKey: ['organizer', 'cancel-preview', id], queryFn: () => api<CancelPreview>(`/organizer/events/${encodeURIComponent(id!)}/cancel-preview`), enabled: !!id, staleTime: 0 });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<CancelSummary | null>(null);

  if (preview.isPending) {
    return (
      <OrgScreen title="Cancel event">
        <Skeleton height={180} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (preview.error || !preview.data) {
    return (
      <OrgScreen title="Cancel event">
        <ErrorState message={preview.error ? errorText(preview.error) : 'Event not found.'} onRetry={() => void preview.refetch()} />
      </OrgScreen>
    );
  }

  const p = preview.data;
  const already = p.status === 'CANCELLED';
  const refunds = p.refundCents.filter((r) => r.cents > 0);
  const refundText = refunds.length ? refunds.map((r) => money(r.cents, r.currency)).join(' + ') : money(0, 'USD');
  const nameOk = typed.trim() === p.title.trim();
  const reasonOk = reason.trim().length >= 10;

  const go = async () => {
    setError('');
    const what = [
      p.paidOrders ? `${num(p.paidOrders)} paid ${p.paidOrders === 1 ? 'order' : 'orders'} refunded in full (${refundText}) to the original payment method.` : 'No paid orders to refund.',
      p.tickets ? `${num(p.tickets)} ${p.tickets === 1 ? 'ticket' : 'tickets'} stop working.` : null,
      p.resaleListings ? `${num(p.resaleListings)} resale ${p.resaleListings === 1 ? 'listing' : 'listings'} closed.` : null,
      'Every buyer gets an email with your reason. This can’t be undone.',
    ]
      .filter(Boolean)
      .join(' ');
    const yes = await confirm({ title: already ? 'Retry the refunds?' : `Cancel ${p.title}?`, message: what, confirmLabel: already ? 'Retry refunds' : 'Cancel the event and refund', cancelLabel: 'Keep the event', destructive: true });
    if (!yes) return;
    haptic.firm();
    setBusy(true);
    try {
      const r = await api<CancelSummary>(`/organizer/events/${encodeURIComponent(p.id)}/cancel`, {
        // A retry keeps the reason buyers were already given (the API ignores a new one), but still needs one.
        body: { reason: already ? (p.cancelReason ?? 'Retrying refunds that failed.') : reason.trim(), confirmTitle: typed.trim() },
        timeoutMs: 90_000,
      });
      haptic.success();
      setDone(r);
      await Promise.all([qc.invalidateQueries({ queryKey: ['organizer'] }), preview.refetch()]);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const refunded = Object.entries(done.totalRefundedCents).filter(([, c]) => c > 0);
    return (
      <OrgScreen title="Event cancelled" eyebrow={p.title} footer={<Button label="Back to the event" onPress={() => router.back()} />}>
        <Notice tone={done.failed.length ? 'warning' : 'success'} icon={done.failed.length ? 'alert' : 'check'} title={done.failed.length ? 'Some refunds didn’t go through' : 'Cancelled and refunded'}>
          {`${num(done.refunded)} ${done.refunded === 1 ? 'order' : 'orders'} refunded${refunded.length ? ` (${refunded.map(([c, v]) => money(v, c)).join(' + ')})` : ''}. ${num(done.ticketsVoided)} tickets voided${done.listingsCancelled ? `, ${num(done.listingsCancelled)} resale listings closed` : ''}.${done.failed.length ? ` ${num(done.failed.length)} refunds failed: open this screen again to retry them.` : ''}`}
        </Notice>
      </OrgScreen>
    );
  }

  return (
    <OrgScreen
      title={already ? 'Retry refunds' : 'Cancel event'}
      eyebrow={p.title}
      footer={
        already && !p.paidOrders ? undefined : (
          <Button label={already ? 'Retry refunds…' : 'Cancel event…'} variant="danger" loading={busy} disabled={!nameOk || (!already && !reasonOk)} onPress={() => void go()} />
        )
      }>
      {already ? (
        <Notice tone="plain" icon="alert" title="Already cancelled">
          {`${p.cancelReason ? `“${p.cancelReason}”. ` : ''}${p.paidOrders ? `${num(p.paidOrders)} paid ${p.paidOrders === 1 ? 'order is' : 'orders are'} still waiting for a refund. Retrying only refunds those.` : 'Every paid order has been refunded. There’s nothing left to do.'}`}
        </Notice>
      ) : null}

      <View style={styles.card}>
        <Label>What happens</Label>
        <Line big={num(p.paidOrders)} text={`paid ${p.paidOrders === 1 ? 'order' : 'orders'} refunded in full`} />
        <Line big={refundText} text="back to buyers’ original payment method" />
        <Line big={num(p.tickets)} text={`${p.tickets === 1 ? 'ticket stops' : 'tickets stop'} working at the door`} />
        {p.resaleListings ? <Line big={num(p.resaleListings)} text={`resale ${p.resaleListings === 1 ? 'listing' : 'listings'} closed`} /> : null}
        <Txt variant="small" color={colors.muted}>
          Sales stop straight away. Every buyer is emailed with your reason, and the event page says it was cancelled. This can’t be undone.
        </Txt>
      </View>

      {!already ? (
        <Field
          label="Reason (sent to buyers)"
          placeholder="e.g. The headliner is ill and the venue couldn’t offer another date."
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={500}
          style={{ minHeight: 0 }}
          hint={reasonOk ? `${reason.trim().length} / 500` : 'At least 10 characters.'}
        />
      ) : null}
      {p.paidOrders || !already ? (
        <Field
          label={`Type the event name to confirm: ${p.title}`}
          placeholder={p.title}
          value={typed}
          onChangeText={setTyped}
          autoCorrect={false}
          autoCapitalize="none"
          error={typed && !nameOk ? 'That doesn’t match the event name yet.' : undefined}
        />
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}
    </OrgScreen>
  );
}

function Line({ big, text }: { big: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
      <Txt variant="price">{big}</Txt>
      <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.surface },
});
