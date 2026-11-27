/**
 * An event's reviews, and (for someone who had a ticket, once it's over) the form to rate it: 1 to 5 stars and a few
 * words. GET /events/:slug/reviews says whether this account can write one, and why not. Reviews show the first name
 * and last initial; the organizer can reply; anyone signed in can report one for Omoshow to look at.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConfirm } from '@/components/confirm';
import { ScreenHeader } from '@/components/screen-header';
import { Stars } from '@/components/stars';
import { Button, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme';

type Review = { id: string; rating: number; body: string; name: string; createdAt: string; edited?: boolean; reply: string | null; repliedAt: string | null; mine?: boolean };
type Data = {
  summary: { average: number | null; count: number };
  organizer: { name: string; average: number | null; count: number };
  reviews: Review[];
  mine: (Review & { hidden: boolean; hideReason: string | null }) | null;
  canReview: boolean;
  reason: string | null;
};
const count = (n: number) => `${n} ${n === 1 ? 'review' : 'reviews'}`;

export default function EventReviews() {
  const { slug, title } = useLocalSearchParams<{ slug: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['event', slug, 'reviews', user?.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Data>(`/events/${encodeURIComponent(slug ?? '')}/reviews`), enabled: !!slug, staleTime: 30_000 });
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const d = q.data;
  const writing = !!d && d.canReview && (!d.mine || editing) && !d.mine?.hidden;

  const save = async () => {
    if (!rating) {
      haptic.warning();
      return setError('Pick a star rating.');
    }
    setBusy(true);
    setError('');
    try {
      await api(`/events/${encodeURIComponent(slug ?? '')}/reviews`, { method: 'PUT', body: { rating, body: body.trim() } });
      haptic.success();
      setEditing(false);
      setNote('Thanks. Your review is up.');
      await qc.invalidateQueries({ queryKey: ['event', slug] });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const yes = await confirm({ title: 'Remove your review?', message: 'You can write a new one while reviews are open.', confirmLabel: 'Remove', cancelLabel: 'Keep it', destructive: true });
    if (!yes) return;
    setBusy(true);
    try {
      await api(`/events/${encodeURIComponent(slug ?? '')}/reviews`, { method: 'DELETE' });
      setRating(0);
      setBody('');
      setNote('');
      await qc.invalidateQueries({ queryKey: ['event', slug] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const report = async (r: Review) => {
    const yes = await confirm({ title: 'Report this review?', message: 'Omoshow’s team will check it against the rules. Honest criticism stays up.', confirmLabel: 'Report', cancelLabel: 'Cancel' });
    if (!yes) return;
    try {
      await api(`/reviews/${encodeURIComponent(r.id)}/flag`, { body: { reason: 'OTHER' } });
      haptic.success();
      setNote('Reported. Our team will take a look.');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter - 4, paddingBottom: space.sm }}>
        <ScreenHeader title="Reviews" eyebrow={title} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + space.xxxl, gap: space.lg }}>
        {q.isPending ? (
          <Skeleton height={220} radius={radius.card} />
        ) : q.error || !d ? (
          <ErrorState message={q.error ? errorText(q.error) : 'Event not found.'} onRetry={() => void q.refetch()} />
        ) : (
          <>
            {note ? (
              <Notice tone="success" icon="check">
                {note}
              </Notice>
            ) : null}
            {error ? <Notice icon="alert">{error}</Notice> : null}

            <View style={styles.card}>
              {d.summary.count ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Txt variant="h1">{d.summary.average?.toFixed(1)}</Txt>
                  <View style={{ gap: 2 }}>
                    <Stars value={d.summary.average ?? 0} size={20} />
                    <Txt variant="small" color={colors.muted}>{`${count(d.summary.count)} from people who had a ticket`}</Txt>
                  </View>
                </View>
              ) : (
                <Txt color={colors.muted}>No reviews yet for this event.</Txt>
              )}
              {d.organizer.count ? <Txt variant="small" color={colors.dim}>{`${d.organizer.name}: ${d.organizer.average?.toFixed(1)} across ${count(d.organizer.count)} for all their events.`}</Txt> : null}
            </View>

            {d.mine?.hidden ? (
              <Notice icon="alert" title="Your review was hidden by Omoshow">
                {d.mine.hideReason ? `Reason: ${d.mine.hideReason}` : 'It broke the review rules.'}
              </Notice>
            ) : d.mine && !editing ? (
              <View style={styles.card}>
                <Txt variant="smallStrong">Your review</Txt>
                <Stars value={d.mine.rating} size={20} />
                {d.mine.body ? <Txt color={colors.muted}>{d.mine.body}</Txt> : null}
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button
                    label="Edit"
                    size="md"
                    variant="ghost"
                    style={{ flex: 1 }}
                    onPress={() => {
                      setRating(d.mine!.rating);
                      setBody(d.mine!.body);
                      setEditing(true);
                      setNote('');
                    }}
                  />
                  <Button label="Remove" size="md" variant="ghost" loading={busy} style={{ flex: 1 }} onPress={() => void remove()} />
                </View>
              </View>
            ) : writing ? (
              <View style={styles.card}>
                <Txt variant="title">{d.mine ? 'Edit your review' : 'How was it?'}</Txt>
                <Stars value={rating} size={36} onChange={(n) => (setRating(n), setError(''))} />
                <Field label="Your review (optional)" value={body} onChangeText={setBody} multiline maxLength={1000} placeholder="What stood out? The sound, the crowd, the door, the venue." style={{ minHeight: 0 }} />
                <Button label={d.mine ? 'Save changes' : 'Post review'} loading={busy} onPress={() => void save()} />
                {editing ? <Button label="Cancel" variant="ghost" size="md" onPress={() => setEditing(false)} /> : null}
                <Txt variant="small" color={colors.dim}>
                  Shown with your first name and last initial.
                </Txt>
              </View>
            ) : d.reason ? (
              <Notice tone="plain" icon="alert" action={user ? undefined : 'Sign in'} onAction={user ? undefined : () => router.push({ pathname: '/sign-in', params: { next: 'back' } })}>
                {d.reason}
              </Notice>
            ) : null}

            {d.reviews.map((r) => (
              <View key={r.id} style={styles.review}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Stars value={r.rating} size={15} />
                  <Txt variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {r.name}
                  </Txt>
                  <Txt variant="small" color={colors.dim}>
                    {when(r.createdAt).short}
                  </Txt>
                </View>
                {r.body ? <Txt>{r.body}</Txt> : null}
                {r.reply ? (
                  <View style={styles.reply}>
                    <Txt variant="small" color={colors.dim}>
                      Reply from the organizer
                    </Txt>
                    <Txt variant="small">{r.reply}</Txt>
                  </View>
                ) : null}
                {user && !r.mine ? (
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void report(r)} style={{ alignSelf: 'flex-start' }}>
                    <Txt variant="small" color={colors.dim} style={{ textDecorationLine: 'underline' }}>
                      Report
                    </Txt>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  review: { gap: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  reply: { gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
});
