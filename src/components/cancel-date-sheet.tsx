/**
 * "Cancel this date" for an event with multiple dates (org admins): a sheet with what happens (GET …/dates/:dateId/
 * cancel-preview: paid orders refunded in full and how much, tickets that stop working, resale listings closed), a
 * reason for buyers (10–500 characters) and the button (POST …/dates/:dateId/cancel). Cancelling the last active
 * date cancels the whole event, and the sheet says so first. Calling it again only retries refunds that failed.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorText } from '@/lib/api';
import { dateLine } from '@/lib/dates';
import { money, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { CancelDatePreview, CancelDateSummary } from '@/lib/organizer';
import { colors, gutter, radius, space } from '@/theme';
import { Button, Field, Notice, Skeleton, Txt } from './ui';

export function CancelDateSheet({ eventId, dateId, onClose, onDone }: { eventId: string; dateId: string | null; onClose: () => void; onDone: (r: CancelDateSummary) => void }) {
  const insets = useSafeAreaInsets();
  const path = `/organizer/events/${encodeURIComponent(eventId)}/dates/${encodeURIComponent(dateId ?? '')}`;
  const preview = useQuery({ queryKey: ['organizer', 'cancel-date-preview', eventId, dateId], queryFn: () => api<CancelDatePreview>(`${path}/cancel-preview`), enabled: !!dateId, staleTime: 0, retry: 0 });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const p = preview.data;
  /** a day of a multi-day event */
  const day = p?.partial !== undefined;
  const reasonOk = reason.trim().length >= 10;
  const refunds = (p?.refundCents ?? []).filter((r) => r.cents > 0);
  const refundText = refunds.length ? refunds.map((r) => money(r.cents, r.currency)).join(' + ') : '';

  const go = async () => {
    if (!reasonOk || !p) return;
    haptic.firm();
    setBusy(true);
    setError('');
    try {
      const r = await api<CancelDateSummary>(`${path}/cancel`, { body: { reason: reason.trim() }, timeoutMs: 90_000 });
      haptic.success();
      setReason('');
      onDone(r);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!dateId} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
        <View style={styles.grip} />
        <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
          <Txt variant="h3" accessibilityRole="header">
            {p ? `Cancel ${dateLine(p.date)}?` : 'Cancel this date?'}
          </Txt>
          {preview.isPending ? (
            <Skeleton height={120} />
          ) : preview.error || !p ? (
            <Notice icon="alert">{preview.error ? errorText(preview.error) : 'Couldn’t load this date.'}</Notice>
          ) : (
            <>
              {p.cancelsEvent ? (
                <Notice tone="warning" icon="alert" title="This is the last date">
                  Cancelling it cancels the whole event.
                </Notice>
              ) : null}
              <View style={styles.lines}>
                {day && p.partial ? (
                  <>
                    <Line big={num(p.paidOrders)} text={`paid ${p.paidOrders === 1 ? 'order' : 'orders'} refunded${refundText ? ` (${refundText})` : ''}: tickets for this day only in full, passes this day’s share`} />
                    <Line big={num(p.partial)} text={`${p.partial === 1 ? 'pass keeps' : 'passes keep'} working on the other days`} />
                  </>
                ) : (
                  <>
                    <Line big={num(p.paidOrders)} text={`paid ${p.paidOrders === 1 ? 'order' : 'orders'} for this ${day ? 'day' : 'date'} refunded in full${refundText ? ` (${refundText})` : ''}`} />
                    <Line big={num(p.tickets)} text={`${p.tickets === 1 ? 'ticket stops' : 'tickets stop'} working`} />
                  </>
                )}
                {p.resaleListings ? <Line big={num(p.resaleListings)} text={`resale ${p.resaleListings === 1 ? 'listing' : 'listings'} closed`} /> : null}
              </View>
              <Txt variant="small" color={colors.muted}>
                {day
                  ? 'Nobody can check in on this day, and buyers are emailed with your reason. Other days aren’t affected. This can’t be undone.'
                  : 'Sales for this date stop straight away and buyers are emailed with your reason. Other dates aren’t affected. This can’t be undone.'}
              </Txt>
              <Field
                label="Reason (sent to buyers)"
                placeholder="e.g. The lead is ill, so Saturday’s show can’t go ahead."
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={500}
                hint={reasonOk ? `${reason.trim().length} / 500` : 'At least 10 characters.'}
              />
            </>
          )}
          {error ? <Notice icon="alert">{error}</Notice> : null}
          <View style={{ gap: space.sm, marginTop: space.xs }}>
            <Button label={p?.cancelsEvent ? 'Cancel the event and refund' : 'Cancel this date and refund'} variant="danger" loading={busy} disabled={!p || !reasonOk} feedback="firm" onPress={() => void go()} />
            <Button label="Keep this date" variant="ghost" onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </Modal>
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
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', gap: space.md, paddingTop: space.sm, paddingHorizontal: gutter, borderTopLeftRadius: radius.panel, borderTopRightRadius: radius.panel, backgroundColor: colors.bg2, borderTopWidth: 1, borderColor: colors.line2 },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line2, marginBottom: space.sm },
  lines: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.surface },
});
