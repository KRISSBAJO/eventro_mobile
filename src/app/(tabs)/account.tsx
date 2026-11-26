/**
 * Account: who you are, notifications, sales, signed-in devices, organizer tools, venues (My venues and booking
 * requests for venue managers, "Own or run a venue?" for everyone else, and requests waiting for Omoshow's
 * approval), sign out, help and legal pages.
 */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/confirm';
import { RequestCard } from '@/components/venue-owner';
import { Button, Divider, Notice, Row, Txt } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { placeLabel, usePlace } from '@/lib/place';
import { useMyVenues } from '@/lib/bookings';
import { useHealth, useMyOrgs } from '@/lib/queries';
import { pendingDoorScans } from '@/lib/door';
import { pendingClaims } from '@/lib/guarantee';
import { appearance, colors, gutter, radius, space } from '@/theme';

const openWeb = (path: string) => {
  haptic.select();
  void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined);
};

export default function Account() {
  const insets = useSafeAreaInsets();
  const { user, signOut, endedNotice } = useAuth();
  const orgs = useMyOrgs(user?.id);
  // Venue managers (an approved claim on a venue's page) answer booking requests here.
  const venues = useMyVenues(user?.id);
  const managed = venues.data?.managed ?? [];
  const waiting = managed.reduce((n, m) => n + m.pendingBookings, 0);
  // Waiting for Omoshow, or declined (with Omoshow's note) and not since approved.
  const managedIds = new Set(managed.map((m) => m.venue.id));
  const requests = (venues.data?.requests ?? []).filter((r) => (r.status === 'PENDING' || r.status === 'REJECTED') && !managedIds.has(r.venue.id));
  const { place } = usePlace();
  const health = useHealth();
  const ask = useConfirm();
  const [signingOut, setSigningOut] = useState(false);

  // An in-app sheet, not Alert/window.confirm: the web build's confirm can be blocked (it then returns false at
  // once, and Sign out did nothing).
  const confirmSignOut = async () => {
    // Door scans and guest-list check-ins made offline and not synced yet are deleted with everything else this phone kept.
    const pending = await pendingDoorScans().catch(() => 0);
    const claims = pendingClaims();
    const warn =
      (pending ? ` ${pending} door check-in${pending === 1 ? '' : 's'} on this phone ${pending === 1 ? 'hasn’t' : 'haven’t'} synced yet and will be lost.` : '') +
      (claims ? ` ${claims === 1 ? 'An Omoshow Guarantee claim' : `${claims} Omoshow Guarantee claims`} saved on this phone ${claims === 1 ? 'hasn’t' : 'haven’t'} been sent yet and will be lost.` : '');
    const yes = await ask({ title: 'Sign out?', message: `Your tickets stay in your account. Sign in again to see them here.${warn}`, confirmLabel: 'Sign out', destructive: true });
    if (!yes) return;
    haptic.firm();
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const initials = (user?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  const roles = [user?.roles.includes('ORGANIZER') ? 'Organizer' : '', user?.roles.includes('ADMIN') ? 'Admin' : ''].filter(Boolean).join(' · ');
  const line = <Divider style={{ marginLeft: 56 }} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.xxl }}>
      {!user && endedNotice ? (
        <Notice tone="warning" icon="lock" title="You’ve been signed out">
          {endedNotice}
        </Notice>
      ) : null}

      {user ? (
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Txt variant="h2">{initials || '?'}</Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h2" numberOfLines={1} accessibilityRole="header">
              {user.name}
            </Txt>
            <Txt variant="small" color={colors.muted} numberOfLines={1}>
              {user.email}
            </Txt>
            {roles ? (
              <Txt variant="small" color={colors.dim} numberOfLines={1}>
                {roles}
              </Txt>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Txt variant="h1" accessibilityRole="header">
            Account
          </Txt>
          <Txt color={colors.muted}>Sign in to see your tickets and check out faster.</Txt>
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Button label="Sign in" onPress={() => router.push('/sign-in')} />
            <Button label="Create an account" variant="ghost" onPress={() => router.push('/sign-up')} />
          </View>
        </View>
      )}

      <Group title={user ? 'Your tickets' : 'Browse'}>
        {user ? (
          <>
            <Row icon="ticket" label="My tickets" onPress={() => router.navigate('/tickets')} />
            {line}
            <Row icon="receipt" label="Orders & receipts" onPress={() => router.push('/orders')} />
            {line}
          </>
        ) : null}
        <Row icon="heart" label="Saved events" onPress={() => router.push('/saved')} />
      </Group>

      <Group title="Settings">
        <Row icon="pin" label="Location" detail={placeLabel(place)} onPress={() => router.push('/place')} />
        {line}
        <Row icon="sun" label="Appearance" detail={appearance === 'system' ? 'Match my phone' : appearance === 'light' ? 'Light' : 'Dark'} onPress={() => router.push('/appearance')} />
        {user ? (
          <>
            {line}
            <Row icon="bell" label="Notifications" onPress={() => router.push('/notifications')} />
          </>
        ) : null}
      </Group>

      {user ? (
        <Group title="Selling">
          <Row icon="cash" label="Sales & payouts" onPress={() => router.push('/resale')} />
          {orgs.data?.length ? (
            <>
              {line}
              <Row icon="scan" label="Organizer tools" detail={orgs.data.every((o) => o.role === 'DOOR') ? 'Door scanner' : 'Events and sales'} onPress={() => router.push('/organizer')} />
            </>
          ) : orgs.data ? (
            <>
              {line}
              <Row icon="ticket" label="Sell tickets" detail="Become an organizer" onPress={() => router.push('/organizer/start')} />
            </>
          ) : null}
          {managed.length ? (
            <>
              {line}
              <Row icon="building" label="My venues" detail={managed.length === 1 ? managed[0].venue.name : `${managed.length} venues`} onPress={() => router.push('/my-venues')} />
              {line}
              <Row icon="calendar" label="Venue bookings" detail={waiting ? `${waiting} waiting` : 'Requests'} tone={waiting ? 'accent' : undefined} onPress={() => router.push('/venue-bookings')} />
            </>
          ) : venues.data ? (
            <>
              {line}
              <Row icon="building" label="Own or run a venue?" detail="List it" onPress={() => router.push('/my-venues/add')} />
            </>
          ) : null}
        </Group>
      ) : null}

      {/* Requests to manage a venue that Omoshow hasn't approved (yet), or declined. */}
      {user
        ? requests.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              onOpen={() => router.push({ pathname: '/venue/[slug]', params: { slug: r.venue.slug } })}
              onRetry={r.newVenue || r.venue.hidden ? () => router.push('/my-venues/add') : () => router.push({ pathname: '/my-venues/add', params: { slug: r.venue.slug } })}
            />
          ))
        : null}

      {user ? (
        <Group title="Security">
          <Row icon="key" label="Change password" onPress={() => router.push('/change-password')} />
          {line}
          <Row icon="phone" label="Signed-in devices" onPress={() => router.push('/devices')} />
        </Group>
      ) : null}

      <Group title="Help">
        <Row icon="help" label="Help centre" onPress={() => openWeb('/help')} />
        {line}
        <Row icon="shield" label="Omoshow Guarantee" onPress={() => openWeb('/guarantee')} />
        {line}
        <Row icon="file" label="Terms of use" onPress={() => openWeb('/legal/terms')} />
        {line}
        <Row icon="lock" label="Privacy policy" onPress={() => openWeb('/legal/privacy')} />
      </Group>

      {user ? (
        <View style={styles.group}>
          <Row icon="logout" label={signingOut ? 'Signing out…' : 'Sign out'} tone="accent" onPress={() => void (signingOut ? undefined : confirmSignOut())} />
        </View>
      ) : null}

      <View style={{ alignItems: 'center', gap: 4 }}>
        <Txt variant="mono" color={colors.dim}>
          Omoshow {Constants.expoConfig?.version ?? '1.0.0'}
        </Txt>
        {health.data?.payments === 'mock' ? (
          <Txt variant="tiny" color={colors.dim}>
            Test mode: payments are simulated
          </Txt>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** A small section title over a group of rows. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
});
