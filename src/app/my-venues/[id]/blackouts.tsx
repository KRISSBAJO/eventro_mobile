/**
 * Blocked-out time at a venue (GET/POST/DELETE /me/venues/:id/blackouts): private use, maintenance, holidays.
 * Organizers can't request it. Confirmed bookings inside a new block stay booked; the API names them (`conflicts`)
 * so the manager can sort them out. Times are the venue's wall-clock time written as UTC.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { DateField, TimeField } from '@/components/date-time';
import { formStyles, Section } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { Label, OrgScreen } from '@/components/org-ui';
import { managerGate } from '@/components/venue-owner';
import { Button, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rangeLabel, zoneCity, type ManagedVenue } from '@/lib/bookings';
import { todayYmd } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { blackoutsKey, useBlackouts, useManagedVenue, useOwnerListing, type Blackout } from '@/lib/my-venues';
import { wallIso } from '@/lib/organizer';
import { colors, radius, space, touch } from '@/theme';

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A wall-clock moment; "24:00" is the start of the next day. */
const moment = (date: string, time: string) => (time === '24:00' ? wallIso(addDays(date, 1), '00:00') : wallIso(date, time));

export default function BlackoutsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { q, m } = useManagedVenue(id);
  const gate = managerGate('Blocked-out time', !!user, q, !!m, { pathname: '/my-venues/[id]', params: { id } });
  if (gate || !m) return gate;
  return <Blackouts venue={m.venue} />;
}

function Blackouts({ venue }: { venue: ManagedVenue }) {
  const qc = useQueryClient();
  const ask = useConfirm();
  const today = todayYmd();
  const from = addDays(today, -1);
  const list = useBlackouts(venue.id, from, addDays(today, 364));
  const listing = useOwnerListing(venue.id);
  const [f, setF] = useState({ startDate: '', startTime: '00:00', endDate: '', endTime: '24:00', note: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ range: string; conflicts: string[] } | null>(null);

  const startsAt = f.startDate ? moment(f.startDate, f.startTime) : '';
  const endsAt = f.endDate ? moment(f.endDate, f.endTime) : '';
  const errors: Record<string, string> = {};
  if (tried) {
    if (!f.startDate) errors.startDate = 'Pick the first day.';
    if (!f.endDate) errors.endDate = 'Pick the last day.';
    else if (f.endDate < today) errors.endDate = 'That time is already over.';
    if (startsAt && endsAt && endsAt <= startsAt) errors.endTime = 'The end has to be after the start.';
    else if (startsAt && endsAt && Date.parse(endsAt) - Date.parse(startsAt) > 366 * 86_400_000) errors.endDate = 'Block out at most a year at a time.';
    if (f.note.trim().length > 200) errors.note = 'Keep the note to 200 characters.';
  }

  const add = async () => {
    setTried(true);
    setError('');
    setAdded(null);
    const bad =
      !f.startDate ||
      !f.endDate ||
      f.endDate < today ||
      endsAt <= startsAt ||
      Date.parse(endsAt) - Date.parse(startsAt) > 366 * 86_400_000 ||
      f.note.trim().length > 200;
    if (bad) {
      haptic.warning();
      return;
    }
    setBusy(true);
    try {
      const b = await api<Blackout & { conflicts: string[] }>(`/me/venues/${encodeURIComponent(venue.id)}/blackouts`, {
        body: { startsAt, endsAt, ...(f.note.trim() ? { note: f.note.trim() } : {}) },
      });
      haptic.success();
      setAdded({ range: rangeLabel(b.startsAt, b.endsAt), conflicts: b.conflicts ?? [] });
      setF({ startDate: '', startTime: '00:00', endDate: '', endTime: '24:00', note: '' });
      setTried(false);
      await Promise.all([qc.invalidateQueries({ queryKey: blackoutsKey(venue.id) }), qc.invalidateQueries({ queryKey: ['venue', 'availability', venue.slug] })]);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: Blackout) => {
    const yes = await ask({
      title: 'Remove this blocked time?',
      message: `${rangeLabel(b.startsAt, b.endsAt)}${b.note ? ` (“${b.note}”)` : ''}. Organizers can request it again.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!yes) return;
    setRemoving(b.id);
    setError('');
    setAdded(null);
    try {
      await api(`/me/venues/${encodeURIComponent(venue.id)}/blackouts/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      haptic.success();
      await Promise.all([qc.invalidateQueries({ queryKey: blackoutsKey(venue.id) }), qc.invalidateQueries({ queryKey: ['venue', 'availability', venue.slug] })]);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setRemoving('');
    }
  };

  const items = (list.data ?? []).filter((b) => b.endsAt.slice(0, 10) >= from);

  return (
    <OrgScreen title="Blocked-out time" eyebrow={venue.name} fallback={{ pathname: '/my-venues/[id]', params: { id: venue.id } }} onRefresh={() => list.refetch()}>
      <Section icon="calendar" title="Block out time" sub={`Private use, maintenance or holidays: nobody can request it. Times at the venue (${zoneCity(listing.data?.timezone)}).`}>
        <View style={formStyles.row2}>
          <DateField
            label="From"
            value={f.startDate}
            min={today}
            error={errors.startDate}
            onChange={(startDate) => setF((p) => ({ ...p, startDate, endDate: p.endDate && p.endDate >= startDate ? p.endDate : startDate }))}
          />
          <TimeField label="At" value={f.startTime} onChange={(startTime) => setF((p) => ({ ...p, startTime }))} />
        </View>
        <View style={formStyles.row2}>
          <DateField label="Until" value={f.endDate} min={f.startDate || today} error={errors.endDate} onChange={(endDate) => setF((p) => ({ ...p, endDate }))} />
          <TimeField label="At" value={f.endTime} midnight error={errors.endTime} onChange={(endTime) => setF((p) => ({ ...p, endTime }))} />
        </View>
        <Field label="Note (only your team sees it)" placeholder="e.g. Floor repairs" value={f.note} onChangeText={(note) => setF((p) => ({ ...p, note }))} maxLength={200} error={errors.note} />
        {error ? <Notice icon="alert">{error}</Notice> : null}
        <Button label="Block out this time" icon="plus" loading={busy} onPress={() => void add()} />
      </Section>

      {added ? (
        added.conflicts.length ? (
          <Notice tone="warning" icon="alert" title={`Blocked out ${added.range}`} action="Open booking requests" onAction={() => router.push('/venue-bookings')}>
            {`Confirmed bookings in that time stay booked: ${added.conflicts.join(', ')}. Talk to the organizer, or cancel them from your bookings if you must.`}
          </Notice>
        ) : (
          <Notice tone="success" icon="check" title={`Blocked out ${added.range}`}>
            Organizers can’t request it now.
          </Notice>
        )
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>Coming up</Label>
        {list.isPending ? (
          <>
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={64} radius={radius.md} />
          </>
        ) : list.error ? (
          <ErrorState compact message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : !items.length ? (
          <EmptyState compact icon="calendar" title="Nothing blocked out" body="Block out private use, maintenance or holidays so nobody can request them." />
        ) : (
          items.map((b) => (
            <View key={b.id} style={styles.item}>
              <View style={styles.itemIcon}>
                <Icon name="lock" size={16} color={colors.muted} />
              </View>
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Txt variant="bodyStrong">{rangeLabel(b.startsAt, b.endsAt)}</Txt>
                {b.note ? (
                  <Txt variant="small" color={colors.muted}>
                    {b.note}
                  </Txt>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove blocked time ${rangeLabel(b.startsAt, b.endsAt)}`}
                disabled={!!removing}
                onPress={() => void remove(b)}
                style={({ pressed }) => [styles.remove, removing === b.id && { opacity: 0.4 }, pressed && { backgroundColor: colors.surface2 }]}>
                <Icon name="trash" size={17} color={colors.muted} />
              </Pressable>
            </View>
          ))
        )}
      </View>
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  itemIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  remove: { width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
});
