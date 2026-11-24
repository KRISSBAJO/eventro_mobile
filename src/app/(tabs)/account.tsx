/** Account: who you are, notifications, sales, signed-in devices, organizer tools, sign out, help and legal pages. */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from '@/components/icons';
import { Badge, Button, Divider, Notice, Row, Txt } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { placeLabel, usePlace } from '@/lib/place';
import { useHealth, useMyOrgs } from '@/lib/queries';
import { pendingDoorScans } from '@/lib/door';
import { colors, gutter, radius, space } from '@/theme';

const openWeb = (path: string) => {
  haptic.select();
  void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined);
};

export default function Account() {
  const insets = useSafeAreaInsets();
  const { user, signOut, endedNotice } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const { place } = usePlace();
  const health = useHealth();

  const confirmSignOut = async () => {
    const go = () => {
      haptic.firm();
      void signOut();
    };
    // Door scans made offline and not synced yet are deleted with everything else this phone kept.
    const pending = await pendingDoorScans();
    const warn = pending ? ` ${pending} door scan${pending === 1 ? '' : 's'} on this phone haven’t synced yet and will be lost.` : '';
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(`Sign out of Eventro on this device?${warn}`) ?? true) go();
      return;
    }
    Alert.alert('Sign out?', `Your tickets stay in your account. Sign in again to see them here.${warn}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: go },
    ]);
  };

  const initials = (user?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.xl }}>
      <Txt variant="h1" accessibilityRole="header">
        Account
      </Txt>

      {!user && endedNotice ? (
        <Notice tone="warning" icon="lock" title="You’ve been signed out">
          {endedNotice}
        </Notice>
      ) : null}

      {user ? (
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Txt variant="h3" color={colors.accentInk}>
              {initials || '?'}
            </Txt>
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
          </>
        ) : null}
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
          <Row icon="scan" label="Organizer tools" detail="Door scanner" onPress={() => router.push('/organizer')} />
        </View>
      ) : null}

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
          <Row icon="logout" label="Sign out" tone="accent" onPress={() => void confirmSignOut()} />
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
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  signedOut: { gap: space.sm, padding: space.xl, borderRadius: radius.panel, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
});
