/**
 * The tab bar: a rounded bar lifted off the bottom edge. The open tab sits in a ticket stub (notched on both sides,
 * like the stubs on Omoshow tickets) that slides from tab to tab. Create is a round red button raised out of the
 * middle of the bar; it opens the organizer flow on top instead of being a tab.
 */
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/icons';
import { Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { useMyOrgs } from '@/lib/queries';
import { colors, font } from '@/theme';

const ICONS: Record<string, IconName> = { index: 'discover', search: 'search', tickets: 'ticket', account: 'user' };
const LABELS: Record<string, string> = { index: 'Discover', search: 'Search', tickets: 'Tickets', account: 'Account' };

const BAR_H = 64;
const STUB_H = 50;
const STUB_INSET = 5;
const NOTCH = 10;
const SPRING = { damping: 18, stiffness: 220, mass: 0.7 };

export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const [slot, setSlot] = useState(0);
  const x = useSharedValue(0);
  const shown = useSharedValue(0);
  const index = state.index;
  const onCreate = state.routes[index]?.name === 'create';

  useEffect(() => {
    if (!slot) return;
    x.value = shown.value ? withSpring(index * slot, SPRING) : index * slot;
    shown.value = 1;
  }, [index, slot, x, shown]);

  const stub = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: shown.value }));
  const onLayout = (e: LayoutChangeEvent) => setSlot((e.nativeEvent.layout.width - 8) / state.routes.length);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 10 : 8) }]}>
      <View style={styles.bar} onLayout={onLayout} role="tablist">
        {slot && !onCreate ? (
          <Animated.View pointerEvents="none" style={[styles.stub, { width: slot - STUB_INSET * 2 }, stub]}>
            <View style={[styles.notch, { left: -NOTCH / 2 }]} />
            <View style={[styles.notch, { right: -NOTCH / 2 }]} />
          </Animated.View>
        ) : null}
        {state.routes.map((route, i) => {
          if (route.name === 'create') return <CreateButton key={route.key} />;
          const focused = i === index;
          const { options } = descriptors[route.key];
          const label = LABELS[route.name] ?? options.title ?? route.name;
          const press = () => {
            const ev = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !ev.defaultPrevented) navigateToTab(route.key);
          };
          return (
            <Pressable
              key={route.key}
              role="tab"
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label} tab`}
              onPress={press}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              style={({ pressed }) => [styles.slot, pressed && !focused && { opacity: 0.6 }]}
            >
              <Icon name={ICONS[route.name] ?? 'discover'} size={22} color={focused ? colors.bg : colors.dim} strokeWidth={focused ? 2.4 : 1.9} />
              <Txt numberOfLines={1} style={[styles.label, focused && styles.labelOn]} color={focused ? colors.bg : colors.dim}>
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Organizers go straight to "Create an event"; fans with no organizer profile go to "Sell tickets" to make one;
 * signed-out visitors sign in first.
 */
function CreateButton() {
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const open = () => {
    haptic.firm();
    if (!user) return router.push('/sign-in');
    if (orgs.data && orgs.data.length === 0) return router.push('/organizer/start');
    // Door-only members land on the create screen, which explains why they can't and offers their own profile.
    router.push('/organizer/create');
  };
  return (
    <View style={styles.slot}>
      <Pressable accessibilityRole="button" accessibilityLabel="Create an event" onPress={open} hitSlop={6} style={({ pressed }) => [styles.create, pressed && { transform: [{ scale: 0.93 }] }]}>
        <Icon name="plus" size={24} color={colors.accentInk} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 8, backgroundColor: colors.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_H,
    paddingHorizontal: 4,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line2,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  slot: { flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontFamily: font.body.medium, fontSize: 10.5, lineHeight: 13 },
  labelOn: { fontFamily: font.body.semibold },
  stub: { position: 'absolute', left: 4 + STUB_INSET, top: (BAR_H - 2 - STUB_H) / 2, height: STUB_H, borderRadius: 16, backgroundColor: colors.text },
  notch: { position: 'absolute', top: (STUB_H - NOTCH) / 2, width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: colors.surface },
  create: {
    width: 54,
    height: 54,
    marginTop: -26,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 4,
    borderColor: colors.bg,
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
