/**
 * Account → Notifications: turn push on for this phone (asks for permission here, never at launch), and choose
 * what Omoshow sends (GET/PATCH /me/notify-prefs; they apply to every phone on the account).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Button, Divider, EmptyState, ErrorState, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canEdit } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { haptic } from '@/lib/haptics';
import { enablePush, pushBlocker, pushPermission } from '@/lib/push';
import type { NotifyPrefs } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const CHOICES: { key: keyof NotifyPrefs; title: string; body: string }[] = [
  { key: 'orders', title: 'Orders', body: 'Order confirmations, refunds, resale sales and cancelled events.' },
  { key: 'tickets', title: 'Tickets', body: 'Tickets and gifts friends send you, and when they accept yours.' },
  { key: 'reminders', title: 'Reminders', body: 'The day before, and when doors are about to open.' },
  { key: 'priceDrops', title: 'Price drops', body: 'When events you’re watching get cheaper.' },
  { key: 'following', title: 'New from who you follow', body: 'When an organizer or venue you follow puts a new event on sale.' },
  { key: 'marketing', title: 'News and offers', body: 'Now and then: events we think you’ll like. Off unless you turn it on.' },
];
/** Organizers (admins and managers) only. */
const SALES = { key: 'sales' as const, title: 'Sales', body: 'A notification for each new sale on your events.' };

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['me', 'notify-prefs', user?.id];
  const prefs = useQuery({ queryKey: key, queryFn: () => api<NotifyPrefs>('/me/notify-prefs'), enabled: !!user });
  const perm = useQuery({ queryKey: ['push-permission'], queryFn: pushPermission, staleTime: 0 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveError, setSaveError] = useState('');
  const blocker = pushBlocker();
  // "Sales" is for people who run events (admins and managers of an organization).
  const orgs = useMyOrgs(user?.id);
  const choices = orgs.data?.some((o) => canEdit(o.role)) ? [...CHOICES, SALES] : CHOICES;

  const turnOn = async () => {
    setBusy(true);
    setResult(null);
    const r = await enablePush(true);
    setBusy(false);
    await perm.refetch();
    if (r.ok) {
      haptic.success();
      setResult({ ok: true, text: 'Notifications are on for this phone.' });
    } else {
      haptic.warning();
      setResult({ ok: false, text: r.reason });
    }
  };

  const toggle = async (k: keyof NotifyPrefs, v: boolean) => {
    haptic.select();
    setSaveError('');
    const before = qc.getQueryData<NotifyPrefs>(key);
    if (before) qc.setQueryData<NotifyPrefs>(key, { ...before, [k]: v });
    try {
      const next = await api<NotifyPrefs>('/me/notify-prefs', { method: 'PATCH', body: { [k]: v } });
      qc.setQueryData(key, next);
    } catch (e) {
      if (before) qc.setQueryData(key, before);
      setSaveError(`Couldn’t save that. ${errorText(e)}`);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Txt variant="h2" accessibilityRole="header">
          Notifications
        </Txt>
      </View>

      {!user ? (
        <EmptyState icon="bell" title="Sign in to choose notifications" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : (
        <>
          <View style={styles.phone}>
            <View style={styles.phoneIcon}>
              <Icon name="bell" size={20} color={perm.data === 'granted' ? colors.success : colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">This phone</Txt>
              <Txt variant="small" color={colors.muted}>
                {perm.data === 'granted'
                  ? blocker
                    ? 'Allowed, but this build can’t receive push notifications.'
                    : 'Notifications are on.'
                  : perm.data === 'denied'
                    ? 'Notifications are off in your phone’s Settings.'
                    : perm.data === 'unsupported'
                      ? 'Not available here.'
                      : 'Get reminders before doors open and know when a ticket arrives.'}
              </Txt>
            </View>
          </View>
          {perm.data === 'undetermined' || (perm.data === 'granted' && !blocker && !result?.ok) ? (
            <Button label={perm.data === 'granted' ? 'Check notifications' : 'Turn on notifications'} icon="bell" loading={busy} onPress={turnOn} />
          ) : perm.data === 'denied' && Platform.OS !== 'web' ? (
            <Button label="Open Settings" variant="ghost" iconRight="external" onPress={() => Linking.openSettings().catch(() => undefined)} />
          ) : null}
          {result ? (
            <Notice tone={result.ok ? 'success' : 'warning'} icon={result.ok ? 'check' : 'alert'}>
              {result.text}
            </Notice>
          ) : blocker && perm.data !== 'undetermined' ? (
            <Notice tone="plain" icon="alert">
              {blocker}
            </Notice>
          ) : null}

          <Txt variant="eyebrow" color={colors.dim} style={{ marginTop: space.md }}>
            What we send
          </Txt>
          {prefs.isPending ? (
            <Skeleton height={320} radius={radius.card} />
          ) : prefs.error && !prefs.data ? (
            <ErrorState compact message={errorText(prefs.error)} onRetry={() => prefs.refetch()} />
          ) : prefs.data ? (
            <View style={styles.group}>
              {choices.map((c, i) => (
                <View key={c.key}>
                  {i > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodyStrong">{c.title}</Txt>
                      <Txt variant="small" color={colors.muted}>
                        {c.body}
                      </Txt>
                    </View>
                    <Switch
                      accessibilityLabel={c.title}
                      value={prefs.data[c.key] ?? true}
                      onValueChange={(v) => void toggle(c.key, v)}
                      trackColor={{ false: colors.surface2, true: colors.accent }}
                      thumbColor="#ffffff"
                      // react-native-web colours the "on" thumb separately
                      {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as object) : {})}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {saveError ? <Notice icon="alert">{saveError}</Notice> : null}
          <Txt variant="small" color={colors.dim}>
            These choices apply to every phone signed in to your account. Receipts and important account emails still arrive by email.
          </Txt>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  phone: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  phoneIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
});
