/** Account → Signed-in devices (GET /me/sessions; DELETE /me/sessions/:id signs one out at once). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { Badge, Button, EmptyState, ErrorState, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText, getApiTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localStamp } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { DeviceSession } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const PLATFORM: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web' };

/** "2 minutes ago", "3 days ago". */
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export default function Devices() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'sessions', user?.id], queryFn: () => api<{ sessions: DeviceSession[] }>('/me/sessions'), enabled: !!user });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pulling, setPulling] = useState(false);
  const mine = getApiTokens()?.sessionId ?? null;
  const ask = useConfirm();

  const revoke = async (s: DeviceSession) => {
    const isMe = s.current || s.id === mine;
    if (isMe) {
      await signOut();
      router.replace('/account');
      return;
    }
    setBusy(s.id);
    setError('');
    try {
      await api(`/me/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      haptic.success();
      await qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const confirm = (s: DeviceSession) => {
    const name = s.deviceName || 'this device';
    const isMe = s.current || s.id === mine;
    const text = isMe ? 'Sign out of Eventro on this phone?' : `Sign out ${name}? It will need the password to sign in again.`;
    void ask({ title: isMe ? 'Sign out?' : 'Sign out that device?', message: text, confirmLabel: 'Sign out', destructive: true }).then((yes) => {
      if (yes) void revoke(s);
    });
  };

  // This phone first, then the rest by when they were last used (the API's order).
  const rows = [...(q.data?.sessions ?? [])].sort((a, b) => Number(b.current || b.id === mine) - Number(a.current || a.id === mine));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={async () => {
            setPulling(true);
            await q.refetch();
            setPulling(false);
          }}
          tintColor={colors.accent}
        />
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Txt variant="h2" accessibilityRole="header">
          Signed-in devices
        </Txt>
      </View>
      <Txt color={colors.muted}>Phones signed in to your account with the Eventro app. Don’t recognise one? Sign it out, then change your password.</Txt>

      {!user ? (
        <EmptyState icon="lock" title="Sign in to see your devices" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : q.isPending ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={84} radius={radius.card} />
          <Skeleton height={84} radius={radius.card} />
        </View>
      ) : q.error && !q.data ? (
        <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          {error ? <Notice icon="alert">{error}</Notice> : null}
          {!mine ? (
            <Notice tone="plain" icon="phone" title="This phone uses an older sign-in">
              Sign out and in again to see it here and stay signed in for longer.
            </Notice>
          ) : null}
          {!rows.length ? <EmptyState compact icon="phone" title="No app sign-ins" body="Sign-ins from the website don’t show here." /> : null}
          <View style={{ gap: space.md }}>
            {rows.map((s) => {
              const isMe = s.current || s.id === mine;
              return (
                <View key={s.id} style={[styles.card, isMe && { borderColor: colors.accentLine }]}>
                  <View style={styles.icon}>
                    <Icon name="phone" size={20} color={isMe ? colors.accent : colors.muted} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {s.deviceName || 'Unnamed device'}
                      </Txt>
                      {isMe ? <Badge label="This device" tone="accent" /> : null}
                    </View>
                    <Txt variant="small" color={colors.muted}>
                      {[s.platform ? (PLATFORM[s.platform] ?? s.platform) : null, isMe ? 'Active now' : `Last used ${ago(s.lastUsedAt).toLowerCase()}`].filter(Boolean).join(' · ')}
                    </Txt>
                    <Txt variant="tiny" color={colors.dim}>
                      Signed in {localStamp(new Date(s.createdAt).getTime())}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </Txt>
                  </View>
                  <Button label={busy === s.id ? 'Signing out…' : 'Sign out'} size="sm" variant={isMe ? 'ghost' : 'danger'} loading={busy === s.id} onPress={() => confirm(s)} />
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
