/**
 * On the event screen: a "Price dropped" note when the organizer recently cut a price (GET /events/:slug/price-drop),
 * and "Tell me if the price drops" (POST /events/:slug/price-watch), which emails the fan when it happens. Signed in
 * it's one tap with the account's email; signed out it asks for an email. The phone remembers which events it
 * asked about, like the website does.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { useWatching } from '@/lib/queries';
import { haptic } from '@/lib/haptics';
import { readJson, writeJson } from '@/lib/storage';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Button, Field, Notice, Txt } from './ui';

type Drop = { ticketName: string; fromCents: number; toCents: number; currency: string; percentOff: number; at: string };
const KEY = 'price-watch';

export function PriceAlert({ slug }: { slug: string }) {
  const { user } = useAuth();
  const drop = useQuery({
    queryKey: ['event', slug, 'price-drop'],
    queryFn: () => api<{ drop: Drop | null }>(`/events/${encodeURIComponent(slug)}/price-drop`),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const qc = useQueryClient();
  const list = useWatching(user?.id);
  const [local, setWatching] = useState<string | null>(null);
  // Signed in, the account's Watching list is the truth (stopping from the list or an email link turns this off).
  const watching = user && list.data ? (list.data.slugs.includes(slug) ? (local ?? user.email) : null) : local;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void readJson<Record<string, string>>(KEY).then((m) => {
      if (live && m?.[slug]) setWatching(m[slug]);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  // Not on sale through the API (404): nothing to watch.
  if (drop.isError) return null;

  const watch = async () => {
    const address = user ? undefined : email.trim();
    if (!user && !emailOk(email)) {
      setError('Enter an email address like name@example.com.');
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ email: string }>(`/events/${encodeURIComponent(slug)}/price-watch`, { body: address ? { email: address } : {} });
      haptic.success();
      setWatching(r.email);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['me', 'watching'] });
      const m = (await readJson<Record<string, string>>(KEY)) ?? {};
      const keep = Object.entries({ ...m, [slug]: r.email }).slice(-50);
      void writeJson(KEY, Object.fromEntries(keep));
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const d = drop.data?.drop;
  return (
    <View style={{ gap: space.sm }}>
      {d ? (
        <Notice tone="success" icon="tag" title={`Price dropped ${d.percentOff}%`}>
          {`${d.ticketName}: now ${money(d.toCents, d.currency)}, was ${money(d.fromCents, d.currency)}.`}
        </Notice>
      ) : null}
      {watching ? (
        <View style={styles.box}>
          <Icon name="bell" size={18} color={colors.success} fill={colors.successSoft} />
          <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
            Price alert on. We’ll email <Txt variant="smallStrong">{watching}</Txt> if it gets cheaper.
          </Txt>
          {user ? (
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.navigate({ pathname: '/tickets', params: { tab: 'watching' } })}>
              <Txt variant="smallStrong" style={{ textDecorationLine: 'underline' }}>
                Watching
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ) : open && !user ? (
        <View style={[styles.box, { flexDirection: 'column', alignItems: 'stretch' }]}>
          <Field
            label="Email me if the price drops"
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
            onSubmitEditing={watch}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Alert me" size="md" icon="bell" loading={busy} onPress={watch} style={{ flex: 1 }} />
            <Button label="Cancel" size="md" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tell me if the price drops"
          disabled={busy}
          onPress={() => {
            haptic.select();
            if (user) void watch();
            else setOpen(true);
          }}
          style={({ pressed }) => [styles.box, pressed && { backgroundColor: colors.surface2 }]}>
          <Icon name="bell" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{busy ? 'Turning on…' : 'Tell me if the price drops'}</Txt>
            <Txt variant="small" color={colors.dim}>
              One email if the organizer lowers a price. Stop any time.
            </Txt>
          </View>
          <Icon name="chevronRight" size={17} color={colors.dim} />
        </Pressable>
      )}
      {error && (user || !open) ? <Notice icon="alert">{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
});
