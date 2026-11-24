/**
 * A venue's weekly opening hours (the listing's `hours`, saved with PUT /me/venues/:id/listing { hours }): any time,
 * or windows per day (Sunday = 0 in the API, Monday first here), several a day. A window closing at midnight is
 * "24:00"; a late night past midnight is a window from 12:00 AM on the next day. Times are the venue's local time.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { TimeField } from '@/components/date-time';
import { ChoiceRow, ChoiceTile, formStyles, GradientButton, Section } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { OrgScreen } from '@/components/org-ui';
import { managerGate } from '@/components/venue-owner';
import { Button, Chip, Notice, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hoursLines, zoneCity, type ManagedVenue, type OpeningHours } from '@/lib/bookings';
import { haptic } from '@/lib/haptics';
import { DAY_NAMES, hoursProblems, listingKey, minutesOf, MONDAY_FIRST, sortHours, useManagedVenue, useOwnerListing, type OwnerListing } from '@/lib/my-venues';
import { colors, radius, space, touch } from '@/theme';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export default function HoursScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { q, m } = useManagedVenue(id);
  const listing = useOwnerListing(m ? id : undefined);
  const gate = managerGate('Opening hours', !!user, m ? listing : q, !!m && !!listing.data, { pathname: '/my-venues/[id]', params: { id } });
  if (gate || !m || !listing.data) return gate;
  return <HoursForm key={m.venue.id} venue={m.venue} saved={listing.data} />;
}

function HoursForm({ venue, saved }: { venue: ManagedVenue; saved: OwnerListing }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'any' | 'set'>(saved.hours?.length ? 'set' : 'any');
  const [list, setList] = useState<OpeningHours[]>(() => sortHours(saved.hours ?? []));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const edit = (next: OpeningHours[]) => {
    setNote('');
    setList(next);
  };
  const body = mode === 'any' || !list.length ? null : sortHours(list);
  const problems = mode === 'set' ? (list.length ? hoursProblems(list) : ['Add hours for at least one day, or choose “Any time”.']) : [];
  const dirty = JSON.stringify(body) !== JSON.stringify(saved.hours?.length ? sortHours(saved.hours) : null);

  const everyDay = (open: string, close: string, days = [0, 1, 2, 3, 4, 5, 6]) => edit(days.map((day) => ({ day, open, close })));
  const addTo = (day: number) => {
    const mine = list.filter((h) => h.day === day).sort((a, b) => minutesOf(a.open) - minutesOf(b.open));
    const last = mine[mine.length - 1];
    if (!last) return edit([...list, { day, open: '09:00', close: '17:00' }]);
    const from = minutesOf(last.close);
    if (from >= 23 * 60) return;
    edit([...list, { day, open: hhmm(from), close: from + 180 >= 24 * 60 ? '24:00' : hhmm(from + 180) }]);
  };
  const copyToAll = (day: number) => {
    const mine = list.filter((h) => h.day === day);
    edit(sortHours([0, 1, 2, 3, 4, 5, 6].flatMap((d) => mine.map((h) => ({ ...h, day: d })))));
  };

  const save = async () => {
    setTried(true);
    setError('');
    setNote('');
    if (problems.length) {
      haptic.warning();
      return;
    }
    setBusy(true);
    try {
      const out = await api<OwnerListing>(`/me/venues/${encodeURIComponent(venue.id)}/listing`, { method: 'PUT', body: { hours: body } });
      haptic.success();
      qc.setQueryData(listingKey(venue.id), out);
      await qc.invalidateQueries({ queryKey: ['venue', venue.slug] });
      setNote(out.hours?.length ? 'Saved. Organizers can only request times inside these hours.' : 'Saved. Organizers can request any time of day.');
      setTried(false);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = hoursLines(body);

  return (
    <OrgScreen
      title="Opening hours"
      eyebrow={venue.name}
      fallback={{ pathname: '/my-venues/[id]', params: { id: venue.id } }}
      footer={
        <View style={{ flexDirection: 'row' }}>
          <GradientButton label={dirty ? 'Save hours' : 'Saved'} icon="check" loading={busy} disabled={!dirty} onPress={() => void save()} />
        </View>
      }>
      <Section icon="clock" title="When organizers can book" sub={`Times at the venue (${zoneCity(saved.timezone)}).`}>
        <ChoiceRow>
          <ChoiceTile icon="globe" label="Any time" sub="Day or night" on={mode === 'any'} onPress={() => setMode('any')} />
          <ChoiceTile
            icon="clock"
            label="Set hours"
            sub="By weekday"
            on={mode === 'set'}
            onPress={() => {
              setMode('set');
              if (!list.length) everyDay('09:00', '24:00');
            }}
          />
        </ChoiceRow>
        {mode === 'any' ? (
          <Txt variant="small" color={colors.muted}>
            Organizers can request any time of day, as long as it’s free.
          </Txt>
        ) : (
          <View style={formStyles.wrap}>
            <Chip label="Every day 9 AM – midnight" onPress={() => everyDay('09:00', '24:00')} />
            <Chip label="Weekdays 8 AM – 6 PM" onPress={() => everyDay('08:00', '18:00', [1, 2, 3, 4, 5])} />
            <Chip label="Evenings 5 PM – midnight" onPress={() => everyDay('17:00', '24:00')} />
          </View>
        )}
      </Section>

      {mode === 'set'
        ? MONDAY_FIRST.map((day) => {
            const mine = list.map((h, i) => ({ h, i })).filter((x) => x.h.day === day);
            const dayProblems = tried ? hoursProblems(mine.map((x) => x.h)) : [];
            const last = mine.length ? mine.map((x) => x.h).sort((a, b) => minutesOf(a.open) - minutesOf(b.open))[mine.length - 1] : null;
            return (
              <View key={day} style={[styles.day, !mine.length && { backgroundColor: colors.bg }]}>
                <View style={styles.dayHead}>
                  <Txt variant="title" style={{ flex: 1 }}>
                    {DAY_NAMES[day]}
                  </Txt>
                  {!mine.length ? (
                    <Txt variant="small" color={colors.dim}>
                      Closed
                    </Txt>
                  ) : (
                    <Pressable accessibilityRole="button" onPress={() => copyToAll(day)} hitSlop={8}>
                      <Txt variant="smallStrong" color={colors.muted}>
                        Copy to every day
                      </Txt>
                    </Pressable>
                  )}
                </View>
                {mine.map(({ h, i }) => (
                  <View key={i} style={styles.window}>
                    <TimeField label="Opens" value={h.open} onChange={(open) => edit(list.map((x, j) => (j === i ? { ...x, open } : x)))} />
                    <TimeField label="Closes" value={h.close} midnight onChange={(close) => edit(list.map((x, j) => (j === i ? { ...x, close } : x)))} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${DAY_NAMES[day]} ${h.open} to ${h.close}`}
                      onPress={() => {
                        haptic.select();
                        edit(list.filter((_, j) => j !== i));
                      }}
                      style={({ pressed }) => [styles.remove, pressed && { backgroundColor: colors.surface2 }]}>
                      <Icon name="trash" size={17} color={colors.muted} />
                    </Pressable>
                  </View>
                ))}
                {dayProblems.length ? (
                  <Txt variant="small" color={colors.accentHi}>
                    {dayProblems[0]}
                  </Txt>
                ) : null}
                <Button
                  label={mine.length ? 'Add more hours' : 'Open this day'}
                  icon="plus"
                  variant="subtle"
                  size="sm"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={!!last && minutesOf(last.close) >= 23 * 60}
                  onPress={() => addTo(day)}
                />
              </View>
            );
          })
        : null}

      {mode === 'set' && summary ? (
        <Txt variant="small" color={colors.dim}>
          Closing at midnight ends the day. For late nights, also open the next day from 12:00 AM: a booking can run across midnight when the hours join up.
        </Txt>
      ) : null}
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : tried && problems.length ? <Notice icon="alert">{problems[0]}</Notice> : null}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  day: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  window: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  remove: { width: touch, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
});
