import { Tabs } from 'expo-router/js-tabs';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/icons';
import { haptic } from '@/lib/haptics';
import { colors, font } from '@/theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Discover', icon: 'discover' },
  { name: 'search', title: 'Search', icon: 'search' },
  { name: 'tickets', title: 'Tickets', icon: 'ticket' },
  { name: 'account', title: 'Account', icon: 'user' },
];

/** Height of the floating bar itself (without the gap under it). */
const BAR = 72;

/**
 * A floating tab bar: a rounded panel lifted off the bottom edge, in the card colour with a border and shadow,
 * so it reads as its own surface instead of melting into the page. Screens stop above it (sceneStyle padding).
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const gap = Math.max(insets.bottom, Platform.OS === 'web' ? 12 : 10);
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        sceneStyle: { backgroundColor: colors.bg, paddingBottom: BAR + gap + 6 },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontFamily: font.body.semibold, fontSize: 11, marginTop: 2, lineHeight: 14 },
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
          // lift it off the page
          shadowColor: '#000',
          shadowOpacity: 0.55,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          elevation: 16,
        },
        tabBarItemStyle: { minHeight: 48 },
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: `${t.title} tab`,
            tabBarIcon: ({ focused }) => (
              <View style={[styles.icon, focused && styles.iconOn]}>
                <Icon name={t.icon} size={21} color={focused ? colors.accentInk : colors.muted} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { width: 52, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});
