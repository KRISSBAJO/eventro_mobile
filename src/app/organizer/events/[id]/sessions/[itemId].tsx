/**
 * One bookable session's bookings (door staff and up): who booked, and checking them in by tapping (with undo).
 * GET /organizer/events/:id/schedule/:itemId/reservations; POST/DELETE …/reservations/:reservationId/check-in.
 * "Scan for this session" opens the door in Session check-in mode (online only). The CSV is on the website.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { OrgScreen, Progress, StatTile, TileRow } from '@/components/org-ui';
import { Badge, Button, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { errorText, isOffline } from '@/lib/api';
import { clock } from '@/lib/door';
import { dateLine } from '@/lib/dates';
import { num, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { checkInBooking, timeRange, undoBooking, useReservations, type Reservation } from '@/lib/schedule';
import { colors, radius, space } from '@/theme';

export default function SessionBookings() {
  const { id = '', itemId = '' } = useLocalSearchParams<{ id: string; itemId: string }>();
  const q = useReservations(id, itemId);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'success' | 'accent' | 'plain'; text: string } | null>(null);

  const reload = () => Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['organizer', 'stats', id] }), qc.invalidateQueries({ queryKey: ['organizer', 'schedule', id] })]);

  if (q.isPending) {
    return (
      <OrgScreen title="Session">
        <Skeleton height={90} radius={radius.card} />
        <Skeleton height={220} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !q.data) {
    return (
      <OrgScreen title="Session">
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }

  const { item, items } = q.data;
  const inCount = items.filter((r) => r.checkedInAt).length;
  const s = search.trim().toLowerCase();
  const shown = s ? items.filter((r) => r.holderName.toLowerCase().includes(s) || r.holderEmail.toLowerCase().includes(s) || r.ticketId.toLowerCase().includes(s)) : items;

  const toggle = async (r: Reservation) => {
    setBusy(r.reservationId);
    setNote(null);
    try {
      if (r.checkedInAt) {
        await undoBooking(id, itemId, r.reservationId);
        haptic.select();
        setNote({ tone: 'plain', text: `Undone: ${r.holderName} is no longer checked in to this session.` });
      } else {
        const a = await checkInBooking(id, itemId, r.reservationId);
        if (a.result === 'ADMIT') haptic.success();
        else haptic.warning();
        setNote({ tone: a.result === 'ADMIT' ? 'success' : 'plain', text: a.result === 'ADMIT' ? `Checked in: ${r.holderName}.` : `${r.holderName}: ${a.message}` });
      }
      await reload();
    } catch (e) {
      haptic.error();
      setNote({ tone: 'accent', text: isOffline(e) ? 'No connection. Session check-in needs signal.' : errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <OrgScreen title={item.title} eyebrow={`${dateLine({ startsAt: item.startsAt }, { time: false })} · ${timeRange(item.startsAt, item.endsAt)}`} onRefresh={reload}>
      {item.stage || item.eligibleTierNames.length ? (
        <Txt variant="small" color={colors.muted}>
          {[item.stage, item.eligibleTierNames.length ? `${item.eligibleTierNames.join(', ')} only` : null].filter(Boolean).join(' · ')}
        </Txt>
      ) : null}
      <TileRow>
        <StatTile label="Booked" value={`${num(item.reserved)}`} sub={`of ${num(item.capacity ?? 0)} places`} />
        <StatTile label="Checked in" value={num(inCount)} sub={items.length ? `of ${num(items.length)} booked` : 'No bookings yet'} tone={inCount ? 'success' : undefined} />
      </TileRow>
      <Progress value={item.reserved} max={item.capacity ?? 0} />
      <Button label="Scan for this session" icon="scan" onPress={() => router.push({ pathname: '/door/[eventId]', params: { eventId: id, session: itemId } })} />
      {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
      {items.length > 8 ? <Field label="Find a booking" value={search} onChangeText={setSearch} placeholder="Name, email or ticket number" autoCorrect={false} autoCapitalize="none" /> : null}
      {!items.length ? (
        <EmptyState compact icon="users" title="No bookings yet" body={`Ticket holders book from the event page or their ticket. Booking closes at ${when(item.startsAt).time}.`} />
      ) : (
        <View style={styles.list}>
          {shown.map((r, n) => (
            <View key={r.reservationId} style={[styles.row, n > 0 && styles.line]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {r.holderName}
                </Txt>
                <Txt variant="small" color={colors.muted} numberOfLines={1}>
                  {r.ticketType} · {r.holderEmail}
                </Txt>
                <Txt variant="mono" color={colors.dim}>
                  {r.ticketId}
                </Txt>
              </View>
              {r.checkedInAt ? (
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={`In · ${clock(r.checkedInAt)}`} tone="success" />
                  <Button label="Undo" variant="ghost" size="sm" loading={busy === r.reservationId} disabled={!!busy} onPress={() => void toggle(r)} />
                </View>
              ) : (
                <Button label="Check in" size="sm" loading={busy === r.reservationId} disabled={!!busy} onPress={() => void toggle(r)} />
              )}
            </View>
          ))}
          {!shown.length ? (
            <Txt variant="small" color={colors.dim} style={{ padding: space.lg }}>
              No bookings match “{search.trim()}”.
            </Txt>
          ) : null}
        </View>
      )}
      <Txt variant="small" color={colors.dim}>
        Checking in to a session doesn’t check anyone in at the event door. The list of bookings as a spreadsheet is on the website.
      </Txt>
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingHorizontal: space.lg },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2 },
});
