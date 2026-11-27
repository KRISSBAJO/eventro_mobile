/**
 * On the event screen, when ticket types are sold out: "Tell me if tickets come back" (POST /events/:slug/waitlist).
 * One row per sold-out ticket type, or "Any ticket" when the whole event is sold out. Signed in it's one tap with the
 * account's email, and the fan can leave; signed out it asks for an email, and the phone remembers what it joined
 * (leaving is the link in the email). One email when tickets are back: the first to check out gets them.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { readJson, writeJson } from '@/lib/storage';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Button, Field, Notice, Txt } from './ui';

const KEY = 'waitlist';
/** "" stands for any ticket to the event. */
const ANY = '';

export function Waitlist({ slug, soldOut, all }: { slug: string; soldOut: { id: string; name: string }[]; all: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['event', slug, 'waitlist', user?.id];
  const mine = useQuery({ queryKey: key, queryFn: () => api<{ ticketTypeIds: string[] }>(`/events/${encodeURIComponent(slug)}/waitlist`), enabled: !!user && soldOut.length > 0, staleTime: 60_000, retry: 0 });
  const [local, setLocal] = useState<string[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void readJson<Record<string, string[]>>(KEY).then((m) => {
      if (live) setLocal(m?.[slug] ?? []);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  if (!soldOut.length) return null;
  // Signed in, the account's entries are the truth; signed out, what this phone joined.
  const ids = user ? (mine.data?.ticketTypeIds ?? []) : local;
  const rows = all ? [{ id: ANY, name: 'Any ticket' }, ...(soldOut.length > 1 ? soldOut : [])] : soldOut;

  const join = async (id: string) => {
    if (!user && !emailOk(email)) {
      setError('Enter an email address like name@example.com.');
      haptic.warning();
      return;
    }
    setBusy(id);
    setError('');
    try {
      await api(`/events/${encodeURIComponent(slug)}/waitlist`, { body: { ...(id ? { ticketTypeId: id } : {}), ...(user ? {} : { email: email.trim() }) } });
      haptic.success();
      setAsking(null);
      if (user) await qc.invalidateQueries({ queryKey: key });
      else {
        const next = [...new Set([...local, id])];
        setLocal(next);
        const m = (await readJson<Record<string, string[]>>(KEY)) ?? {};
        void writeJson(KEY, Object.fromEntries(Object.entries({ ...m, [slug]: next }).slice(-40)));
      }
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const leave = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await api(`/events/${encodeURIComponent(slug)}/waitlist?ticketTypeId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.box}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Icon name="bell" size={18} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{all ? 'Sold out. Join the waitlist' : 'Tell me if tickets come back'}</Txt>
          <Txt variant="small" color={colors.dim}>
            One email when they do. First to check out gets them.
          </Txt>
        </View>
      </View>
      {rows.map((r) => {
        const on = ids.includes(r.id);
        return (
          <View key={r.id || 'any'} style={{ gap: space.sm }}>
            <View style={styles.row}>
              <Txt variant="smallStrong" style={{ flex: 1 }} numberOfLines={2}>
                {r.name}
              </Txt>
              {on ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="check" size={15} color={colors.success} />
                    <Txt variant="small" color={colors.muted}>
                      On the waitlist
                    </Txt>
                  </View>
                  {user ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Leave the waitlist for ${r.name}`} hitSlop={8} disabled={busy === r.id} onPress={() => void leave(r.id)}>
                      <Txt variant="smallStrong" style={{ textDecorationLine: 'underline' }}>
                        Leave
                      </Txt>
                    </Pressable>
                  ) : null}
                </View>
              ) : asking === r.id ? null : (
                <Button
                  label="Notify me"
                  size="md"
                  variant="ghost"
                  icon="bell"
                  loading={busy === r.id}
                  accessibilityLabel={`Tell me if ${r.name === 'Any ticket' ? 'tickets' : `${r.name} tickets`} come back`}
                  onPress={() => {
                    haptic.select();
                    setError('');
                    if (user) void join(r.id);
                    else setAsking(r.id);
                  }}
                />
              )}
            </View>
            {asking === r.id && !on ? (
              <View style={{ gap: space.sm }}>
                <Field
                  label="Email me when they’re back"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setError('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  placeholder="you@example.com"
                  error={error}
                  returnKeyType="send"
                  onSubmitEditing={() => void join(r.id)}
                />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Join the waitlist" size="md" icon="bell" loading={busy === r.id} onPress={() => void join(r.id)} style={{ flex: 1 }} />
                  <Button label="Cancel" size="md" variant="ghost" onPress={() => setAsking(null)} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      {error && (user || asking === null) ? <Notice icon="alert">{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
});
