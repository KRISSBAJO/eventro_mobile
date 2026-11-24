/**
 * An event's attendees (GET /organizer/events/:id/attendees?q=&status=): search by name, email or ticket number,
 * filter by checked in or not, and check someone in by hand (POST …/check-in with the ticket id) or undo it
 * (DELETE …/check-in/:ticketId), as on the website.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { OrgScreen } from '@/components/org-ui';
import { Badge, Chip, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { deviceId } from '@/lib/device';
import { localStamp, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useAttendees, useOrgEvent } from '@/lib/organizer';
import type { Attendee, CheckInAnswer } from '@/lib/types';
import { colors, radius, space, touch } from '@/theme';

type Filter = '' | 'checked-in' | 'not-checked-in';
const FILTERS: { id: Filter; label: string }[] = [
  { id: '', label: 'Everyone' },
  { id: 'not-checked-in', label: 'Not in yet' },
  { id: 'checked-in', label: 'Checked in' },
];

export default function Attendees() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ev = useOrgEvent(id);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('');
  const list = useAttendees(id, q, filter);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Search as they type, a moment after they stop.
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(t);
  }, [text]);

  const toggle = async (a: Attendee) => {
    setMessage(null);
    const undo = a.status === 'CHECKED_IN';
    if (undo) {
      const yes = await confirm({ title: `Undo ${a.holderName}’s check-in?`, message: 'Their ticket works at the door again.', confirmLabel: 'Undo check-in', destructive: true });
      if (!yes) return;
    }
    setBusy(a.id);
    try {
      if (undo) {
        await api(`/organizer/events/${encodeURIComponent(id!)}/check-in/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
        haptic.success();
        setMessage({ ok: true, text: `${a.holderName} is no longer checked in.` });
      } else {
        const r = await api<CheckInAnswer>(`/organizer/events/${encodeURIComponent(id!)}/check-in`, { body: { code: a.id, deviceId: await deviceId() } });
        if (r.result === 'ok') haptic.success();
        else haptic.warning();
        setMessage({ ok: r.result === 'ok', text: r.result === 'ok' ? `${a.holderName} is checked in.` : r.message });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['organizer', 'attendees', id] }), qc.invalidateQueries({ queryKey: ['organizer', 'stats', id] })]);
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const rows = list.data ?? [];
  return (
    <OrgScreen title="Attendees" eyebrow={ev.data?.title} onRefresh={() => list.refetch()}>
      <Field label="Search" placeholder="Name, email or ticket number" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip key={f.id || 'all'} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </View>
      {message ? (
        <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
          {message.text}
        </Notice>
      ) : null}
      {list.isPending ? (
        <View style={{ gap: space.sm }}>
          <Skeleton height={72} radius={radius.card} />
          <Skeleton height={72} radius={radius.card} />
          <Skeleton height={72} radius={radius.card} />
        </View>
      ) : list.error ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : !rows.length ? (
        <EmptyState compact icon="users" title={q || filter ? 'Nobody matches' : 'No attendees yet'} body={q || filter ? 'Try another name or filter.' : 'Tickets show up here as soon as they’re sold.'} />
      ) : (
        <>
          <Txt variant="small" color={colors.dim}>
            {num(rows.length)} {rows.length === 1 ? 'ticket' : 'tickets'}
            {rows.length >= 5000 ? ' (the first 5,000: search to narrow it down)' : ''}
          </Txt>
          {rows.slice(0, 300).map((a) => {
            const inside = a.status === 'CHECKED_IN';
            const seat = [a.section, a.row ? `Row ${a.row}` : null, a.seat !== null ? `Seat ${a.seat}` : null].filter(Boolean).join(' · ');
            return (
              <View key={a.id} style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {a.holderName}
                  </Txt>
                  <Txt variant="small" color={colors.muted} numberOfLines={1}>
                    {a.ticketType.name}
                    {seat ? ` · ${seat}` : ''}
                  </Txt>
                  <Txt variant="mono" color={colors.dim} numberOfLines={1}>
                    {a.id}
                  </Txt>
                  {inside && a.checkedInAt ? <Badge label={`In · ${localStamp(new Date(a.checkedInAt).getTime())}`} tone="success" style={{ marginTop: 4 }} /> : a.status === 'TRANSFER_PENDING' ? <Badge label="Transfer pending" tone="warning" style={{ marginTop: 4 }} /> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={inside ? `Undo check-in for ${a.holderName}` : `Check in ${a.holderName}`}
                  disabled={busy !== null || a.status === 'TRANSFER_PENDING'}
                  onPress={() => void toggle(a)}
                  style={({ pressed }) => [styles.btn, inside ? styles.btnUndo : styles.btnIn, (busy !== null || a.status === 'TRANSFER_PENDING') && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
                  {busy === a.id ? (
                    <ActivityIndicator color={inside ? colors.text : colors.accentInk} />
                  ) : (
                    <>
                      <Icon name={inside ? 'undo' : 'check'} size={16} color={inside ? colors.text : colors.accentInk} />
                      <Txt variant="smallStrong" color={inside ? colors.text : colors.accentInk}>
                        {inside ? 'Undo' : 'Check in'}
                      </Txt>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}
          {rows.length > 300 ? (
            <Txt variant="small" color={colors.dim}>
              Showing 300 of {num(rows.length)}. Search to find someone.
            </Txt>
          ) : null}
        </>
      )}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 104, height: touch, paddingHorizontal: space.md, borderRadius: radius.pill },
  btnIn: { backgroundColor: colors.accent },
  btnUndo: { borderWidth: 1, borderColor: colors.line2 },
});
