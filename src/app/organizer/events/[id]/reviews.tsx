/**
 * Reviews of an event, for its organizer: what ticket holders said, the event's rating and the organizer's across all
 * events. Admins and managers can reply in public (PUT …/reviews/:rid/reply; "" removes the reply) and flag a review
 * for Omoshow to check (POST /reviews/:id/flag). Organizers can't remove reviews: honest criticism stays up.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Label, OrgScreen } from '@/components/org-ui';
import { Stars } from '@/components/stars';
import { Button, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { canEdit, membershipOf, useOrgEvent } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

type Review = { id: string; rating: number; body: string; name: string; createdAt: string; reply: string | null; repliedAt: string | null; hidden: boolean; flagged: boolean };
type Data = { summary: { average: number | null; count: number }; organizer: { average: number | null; count: number }; reviews: Review[] };
const count = (n: number) => `${n} ${n === 1 ? 'review' : 'reviews'}`;

export default function OrganizerReviews() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const path = `/organizer/events/${encodeURIComponent(id ?? '')}/reviews`;
  // Waits for the session (a deep link or reload restores it first).
  const q = useQuery({ queryKey: ['organizer', 'reviews', id, user?.id], queryFn: () => api<Data>(path), enabled: !!id && !!user, staleTime: 0 });
  // Replying is for admins and managers of the event's organization.
  const ev = useOrgEvent(id);
  const orgs = useMyOrgs(user?.id);
  const editor = canEdit(membershipOf(orgs.data, ev.data?.orgId)?.role);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  if (q.isPending) {
    return (
      <OrgScreen title="Reviews">
        <Skeleton height={220} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (q.error || !q.data) {
    return (
      <OrgScreen title="Reviews">
        <ErrorState message={q.error ? errorText(q.error) : 'Event not found.'} onRetry={() => void q.refetch()} />
      </OrgScreen>
    );
  }
  const d = q.data;

  const send = async (rid: string, reply: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`${path}/${encodeURIComponent(rid)}/reply`, { method: 'PUT', body: { reply } });
      haptic.success();
      setOpen(null);
      setText('');
      setNote(reply ? 'Reply posted.' : 'Reply removed.');
      await qc.invalidateQueries({ queryKey: ['organizer', 'reviews', id] });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const flag = async (r: Review) => {
    const yes = await confirm({ title: 'Flag this review?', message: 'Omoshow’s team checks flagged reviews against the rules. Honest criticism stays up; spam, abuse and reviews that aren’t about the event are hidden.', confirmLabel: 'Flag', cancelLabel: 'Cancel' });
    if (!yes) return;
    try {
      await api(`/reviews/${encodeURIComponent(r.id)}/flag`, { body: { reason: 'OTHER', note: 'Flagged by the organizer' } });
      haptic.success();
      setNote('Sent to Omoshow to check.');
      await qc.invalidateQueries({ queryKey: ['organizer', 'reviews', id] });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <OrgScreen title="Reviews" eyebrow={ev.data?.title} onRefresh={() => q.refetch()}>
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      <View style={styles.card}>
        <Label>Rating</Label>
        {d.summary.count ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Txt variant="h1">{d.summary.average?.toFixed(1)}</Txt>
            <View style={{ gap: 2, flex: 1 }}>
              <Stars value={d.summary.average ?? 0} size={20} />
              <Txt variant="small" color={colors.muted}>{`${count(d.summary.count)} for this event`}</Txt>
            </View>
          </View>
        ) : (
          <Txt color={colors.muted}>No reviews yet. Ticket holders can rate the event for 60 days after it ends; we ask them the day after.</Txt>
        )}
        {d.organizer.count ? <Txt variant="small" color={colors.dim}>{`${d.organizer.average?.toFixed(1)} across all your events (${count(d.organizer.count)}).`}</Txt> : null}
        <Txt variant="small" color={colors.dim}>
          You can reply in public. Reviews can’t be removed by organizers; flag one that breaks the rules and Omoshow will check it.
        </Txt>
      </View>

      {d.reviews.map((r) => (
        <View key={r.id} style={[styles.card, r.hidden && { opacity: 0.6 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Stars value={r.rating} size={15} />
            <Txt variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>
              {r.name}
            </Txt>
            <Txt variant="small" color={colors.dim}>
              {when(r.createdAt).short}
            </Txt>
          </View>
          {r.hidden ? (
            <Txt variant="small" color={colors.accent}>
              Hidden by Omoshow
            </Txt>
          ) : r.flagged ? (
            <Txt variant="small" color={colors.dim}>
              Flagged, waiting for Omoshow
            </Txt>
          ) : null}
          {r.body ? <Txt>{r.body}</Txt> : <Txt color={colors.dim}>No words, just the rating.</Txt>}
          {r.reply && open !== r.id ? (
            <View style={styles.reply}>
              <Txt variant="small" color={colors.dim}>
                Your reply
              </Txt>
              <Txt variant="small">{r.reply}</Txt>
            </View>
          ) : null}
          {editor && !r.hidden ? (
            open === r.id ? (
              <View style={{ gap: space.sm }}>
                <Field label="Your public reply" value={text} onChangeText={setText} multiline maxLength={1000} placeholder="Short and friendly. Everyone can read it." style={{ minHeight: 0 }} />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Post reply" size="md" loading={busy} disabled={!text.trim()} style={{ flex: 1 }} onPress={() => void send(r.id, text.trim())} />
                  <Button label="Cancel" size="md" variant="ghost" onPress={() => setOpen(null)} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    setOpen(r.id);
                    setText(r.reply ?? '');
                    setNote('');
                  }}>
                  <Txt variant="smallStrong" color={colors.accent}>
                    {r.reply ? 'Edit reply' : 'Reply'}
                  </Txt>
                </Pressable>
                {r.reply ? (
                  <Pressable accessibilityRole="button" hitSlop={8} disabled={busy} onPress={() => void send(r.id, '')}>
                    <Txt variant="smallStrong" color={colors.muted}>
                      Remove reply
                    </Txt>
                  </Pressable>
                ) : null}
                {r.flagged ? null : (
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void flag(r)}>
                    <Txt variant="smallStrong" color={colors.dim}>
                      Flag for Omoshow
                    </Txt>
                  </Pressable>
                )}
              </View>
            )
          ) : null}
        </View>
      ))}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  reply: { gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
});
