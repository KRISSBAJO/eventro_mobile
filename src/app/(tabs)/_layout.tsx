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

/** Height of the bar above the phone's home indicator. */
const BAR = 58;

/**
 * "Create" in the middle of the tab bar. It isn't a tab: it opens the organizer flow on top. Organizers go straight to
 * "Create an event"; fans with no organizer profile go to "Sell tickets" to make one; signed-out visitors sign in first.
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
    <Pressable accessibilityRole="button" accessibilityLabel="Create an event" onPress={open} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
      <View style={styles.tab}>
        <View style={styles.plus}>
          <Icon name="plus" size={16} color={colors.bg} strokeWidth={2.6} />
        </View>
        <Txt numberOfLines={1} style={styles.tabLabel} color={colors.muted}>
          Create
        </Txt>
      </View>
    </Pressable>
  );
}

/** The tab bar: flat and quiet, in the page colour with a hairline on top; the active tab is drawn in the text colour. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, Platform.OS === 'web' ? 6 : 4);
  const tab = (t: (typeof TABS)[number]) => (
    <Tabs.Screen
      key={t.name}
      name={t.name}
      options={{
        title: t.title,
        tabBarAccessibilityLabel: `${t.title} tab`,
        tabBarIcon: ({ focused }) => (
          <View style={styles.tab}>
            <Icon name={t.icon} size={23} color={focused ? colors.text : colors.dim} strokeWidth={focused ? 2.4 : 1.9} />
            <Txt numberOfLines={1} style={[styles.tabLabel, focused && styles.tabLabelOn]} color={focused ? colors.text : colors.dim}>
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
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.dim,
        // Labels are drawn under each icon (tabBarIcon), not by the bar.
        tabBarShowLabel: false,
        tabBarIconStyle: { width: 72, height: 44 },
        tabBarStyle: {
          height: BAR + bottom,
          paddingTop: 6,
          paddingBottom: bottom,
          backgroundColor: colors.bg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.line2,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: { minHeight: 44 },
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
  item: { flex: 1, alignItems: 'center', paddingTop: 4 },
  tab: { width: 72, height: 44, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabLabel: { fontFamily: font.body.medium, fontSize: 11, lineHeight: 14 },
  tabLabelOn: { fontFamily: font.body.semibold },
  plus: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
});
