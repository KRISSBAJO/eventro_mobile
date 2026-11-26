import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '@/components/tab-bar';
import { haptic } from '@/lib/haptics';
import { colors } from '@/theme';

/** Discover, Search, Create (a button, not a tab), Tickets and Account, in the bar drawn by components/tab-bar.tsx. */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={{ headerShown: false, animation: 'fade', sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarAccessibilityLabel: 'Discover tab' }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarAccessibilityLabel: 'Search tab' }} />
      <Tabs.Screen name="create" options={{ title: 'Create' }} />
      <Tabs.Screen name="tickets" options={{ title: 'Tickets', tabBarAccessibilityLabel: 'Tickets tab' }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarAccessibilityLabel: 'Account tab' }} />
    </Tabs>
  );
}
