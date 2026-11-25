import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/icons';
import { Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { useMyOrgs } from '@/lib/queries';
import { colors, font } from '@/theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Discover', icon: 'discover' },
  { name: 'search', title: 'Search', icon: 'search' },
  { name: 'tickets', title: 'Tickets', icon: 'ticket' },
  { name: 'account', title: 'Account', icon: 'user' },
];

/** Height of the floating bar itself (without the gap under it). */
const BAR = 72;
/** The raised Create button: a circle that sits above the bar's top edge. */
const FAB = 56;
/** Each tab's capsule (icon over label); the active one is tinted. */
const TAB_W = 64;
const TAB_H = 50;

/**
 * The raised "Create" button in the middle of the tab bar. It isn't a tab: it opens the organizer flow on top.
 * Organizers go straight to "Create an event"; fans with no organizer profile go to "Sell tickets" to make one;
 * signed-out visitors sign in first.
 */
function CreateButton() {
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const open = () => {
    haptic.firm();
    if (!user) return router.push('/sign-in');
    const list = orgs.data ?? [];
    if (orgs.data && list.length === 0) return router.push('/organizer/start');
    // Door-only members land on the create screen, which explains why they can't and offers their own profile.
    router.push('/organizer/create');
  };
  return (
    <View style={styles.fabSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create an event"
        onPress={open}
        hitSlop={8}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}>
        <Icon name="plus" size={26} color={colors.accentInk} />
      </Pressable>
      <Txt variant="smallStrong" color={colors.text} style={styles.fabLabel}>
        Create
      </Txt>
    </View>
  );
}

/**
 * A floating tab bar: a rounded panel lifted off the bottom edge, in the card colour with a border and shadow,
 * so it reads as its own surface instead of melting into the page. Screens stop above it (sceneStyle padding).
 * In the middle, a raised red Create button that breaks out of the bar.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const gap = Math.max(insets.bottom, Platform.OS === 'web' ? 12 : 10);
  const tab = (t: (typeof TABS)[number]) => (
    <Tabs.Screen
      key={t.name}
      name={t.name}
      options={{
        title: t.title,
        tabBarAccessibilityLabel: `${t.title} tab`,
        // Each tab draws its own capsule (icon and label together), so the active state has one clean, even shape.
        tabBarIcon: ({ focused }) => (
          <View style={[styles.tab, focused && styles.tabOn]}>
            <Icon name={t.icon} size={21} color={focused ? colors.accent : colors.muted} strokeWidth={focused ? 2.3 : 2} />
            <Txt numberOfLines={1} style={styles.tabLabel} color={focused ? colors.text : colors.muted}>
              {t.title}
            </Txt>
          </View>
        ),
      }}
    />
  );
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        sceneStyle: { backgroundColor: colors.bg, paddingBottom: BAR + gap + 6 },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        // Labels are drawn inside each tab's capsule (tabBarIcon), not by the bar.
        tabBarShowLabel: false,
        tabBarIconStyle: { width: TAB_W, height: TAB_H },
        tabBarStyle: {
          position: 'absolute',
          bottom: gap,
          height: BAR,
          paddingTop: 7,
          paddingBottom: 9,
          marginHorizontal: 14,
          borderRadius: 26,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: colors.line2,
          borderTopColor: colors.line2,
          // The raised button pokes out above the bar.
          overflow: 'visible',
          // lift it off the page
          shadowColor: '#000',
          shadowOpacity: 0.55,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          elevation: 16,
        },
        tabBarItemStyle: { minHeight: 48 },
      }}>
      {TABS.slice(0, 2).map(tab)}
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarAccessibilityLabel: 'Create an event',
          tabBarButton: () => <CreateButton />,
        }}
      />
      {TABS.slice(2).map(tab)}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tab: { width: TAB_W, height: TAB_H, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1, borderColor: 'transparent' },
  tabOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  tabLabel: { fontFamily: font.body.semibold, fontSize: 11, lineHeight: 14 },
  fabSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 },
  fab: {
    position: 'absolute',
    top: -30,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    // A ring in the page colour cuts the circle out of the bar, so it reads as raised.
    borderWidth: 5,
    borderColor: colors.bg,
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  fabLabel: { fontSize: 11, lineHeight: 14 },
});
