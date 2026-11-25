/**
 * Account: who you are, notifications, sales, signed-in devices, organizer tools, venues (My venues and booking
 * requests for venue managers, "Own or run a venue?" for everyone else, and requests waiting for Eventro's
 * approval), sign out, help and legal pages.
 */
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { RequestCard } from '@/components/venue-owner';
import { LogoMark } from '@/components/icons';
import { Badge, Button, Divider, Notice, Row, Txt } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { placeLabel, usePlace } from '@/lib/place';
import { useMyVenues } from '@/lib/bookings';
import { useHealth, useMyOrgs } from '@/lib/queries';
import { pendingDoorScans } from '@/lib/door';
import { pendingClaims } from '@/lib/guarantee';
import { colors, gutter, radius, space } from '@/theme';

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
  // Waiting for Eventro, or declined (with Eventro's note) and not since approved.
  const managedIds = new Set(managed.map((m) => m.venue.id));
  const requests = (venues.data?.requests ?? []).filter((r) => (r.status === 'PENDING' || r.status === 'REJECTED') && !managedIds.has(r.venue.id));
  const { place } = usePlace();
  const health = useHealth();
  const ask = useConfirm();
  const [signingOut, setSigningOut] = useState(false);

  // An in-app sheet, not Alert/window.confirm: the web build's confirm can be blocked (it then returns false at
  // once, and Sign out did nothing).
  const confirmSignOut = async () => {
    // Door scans made offline and not synced yet are deleted with everything else this phone kept.
    const pending = await pendingDoorScans().catch(() => 0);
    const claims = pendingClaims();
    const warn =
      (pending ? ` ${pending} door scan${pending === 1 ? '' : 's'} on this phone haven’t synced yet and will be lost.` : '') +
      (claims ? ` ${claims === 1 ? 'An Eventro Guarantee claim' : `${claims} Eventro Guarantee claims`} saved on this phone ${claims === 1 ? 'hasn’t' : 'haven’t'} been sent yet and will be lost.` : '');
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.xl }}>
      {/* Warm glow behind the top of the screen, like Discover (absolute offsets start at the padding edge, so this spans the full width) */}
      <View style={styles.glowAnchor} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,77,61,0.16)', 'rgba(255,120,80,0.04)', 'rgba(15,10,11,0)']}
          locations={[0, 0.5, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={{ width: '100%', height: insets.top + 280 }}
        />
      </View>
      <View style={styles.headRow}>
        <LogoMark size={30} />
        <Txt variant="h1" accessibilityRole="header">
          Account
        </Txt>
      </View>

      {!user && endedNotice ? (
        <Notice tone="warning" icon="lock" title="You’ve been signed out">
          {endedNotice}
        </Notice>
      ) : null}

      {user ? (
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Txt variant="h2" color={colors.accentInk}>
              {initials || '?'}
            </Txt>
            {/* Signed in */}
            <View style={styles.avatarDot} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title" numberOfLines={1}>
              {user.name}
            </Txt>
            <Txt variant="small" color={colors.muted} numberOfLines={1}>
              {user.email}
            </Txt>
            {user.roles.includes('ORGANIZER') || user.roles.includes('ADMIN') ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                {user.roles.includes('ORGANIZER') ? <Badge label="Organizer" /> : null}
                {user.roles.includes('ADMIN') ? <Badge label="Admin" tone="accent" /> : null}
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.signedOut}>
          <LogoMark size={40} />
          <Txt variant="h2">Your tickets, in your pocket</Txt>
          <Txt color={colors.muted}>Sign in to see your tickets, show the QR code at the door and check out faster.</Txt>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Button label="Sign in" onPress={() => router.push('/sign-in')} />
            <Button label="Create an account" variant="ghost" onPress={() => router.push('/sign-up')} />
          </View>
        </View>
      )}

      <View style={styles.group}>
        {user ? (
          <>
            <Row icon="ticket" label="My tickets" onPress={() => router.navigate('/tickets')} />
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="receipt" label="Orders & receipts" onPress={() => router.push('/orders')} />
            <Divider style={{ marginLeft: 62 }} />
          </>
        ) : null}
        <Row icon="heart" label="Saved events" onPress={() => router.push('/saved')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="pin" label="Location" detail={placeLabel(place)} onPress={() => router.push('/place')} />
        {user ? (
          <>
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="cash" label="Sales & payouts" onPress={() => router.push('/resale')} />
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="bell" label="Notifications" onPress={() => router.push('/notifications')} />
          </>
        ) : null}
      </View>

      {user ? (
        <View style={styles.group}>
          <Row icon="key" label="Change password" onPress={() => router.push('/change-password')} />
          <Divider style={{ marginLeft: 62 }} />
          <Row icon="phone" label="Signed-in devices" onPress={() => router.push('/devices')} />
        </View>
      ) : null}

      {user && orgs.data?.length ? (
        <View style={styles.group}>
          <Row icon="scan" label="Organizer tools" detail={orgs.data.every((o) => o.role === 'DOOR') ? 'Door scanner' : 'Events and sales'} onPress={() => router.push('/organizer')} />
        </View>
      ) : user && orgs.data ? (
        <View style={styles.group}>
          <Row icon="ticket" label="Sell tickets" detail="Become an organizer" onPress={() => router.push('/organizer/start')} />
        </View>
      ) : null}

      {user && managed.length ? (
        <View style={styles.group}>
          <Row icon="building" label="My venues" detail={managed.length === 1 ? managed[0].venue.name : `${managed.length} venues`} onPress={() => router.push('/my-venues')} />
          <Divider style={{ marginLeft: 62 }} />
          <Row icon="calendar" label="Venue bookings" detail={waiting ? `${waiting} waiting` : 'Requests'} tone={waiting ? 'accent' : undefined} onPress={() => router.push('/venue-bookings')} />
        </View>
      ) : user && venues.data ? (
        <View style={styles.group}>
          <Row icon="building" label="Own or run a venue?" detail="List it" onPress={() => router.push('/my-venues/add')} />
        </View>
      ) : null}

      {/* Requests to manage a venue that Eventro hasn't approved (yet), or declined. */}
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

      <View style={styles.group}>
        <Row icon="help" label="Help centre" onPress={() => openWeb('/help')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="shield" label="Eventro Guarantee" onPress={() => openWeb('/guarantee')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="file" label="Terms of use" onPress={() => openWeb('/legal/terms')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="lock" label="Privacy policy" onPress={() => openWeb('/legal/privacy')} />
      </View>

      {user ? (
        <View style={styles.group}>
          <Row icon="logout" label={signingOut ? 'Signing out…' : 'Sign out'} tone="accent" onPress={() => void (signingOut ? undefined : confirmSignOut())} />
        </View>
      ) : null}

      <View style={{ alignItems: 'center', gap: 4 }}>
        <Txt variant="mono" color={colors.dim}>
          Eventro {Constants.expoConfig?.version ?? '1.0.0'}
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

const styles = StyleSheet.create({
  glowAnchor: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  avatarDot: { position: 'absolute', right: 1, bottom: 1, width: 15, height: 15, borderRadius: 8, backgroundColor: colors.success, borderWidth: 3, borderColor: colors.surface },
  signedOut: { gap: space.sm, padding: space.xl, borderRadius: radius.panel, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
});
