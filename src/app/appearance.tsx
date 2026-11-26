/**
 * Account → Appearance, in the style of a phone's own display settings: two live miniatures of Discover (Light and
 * Dark) to pick from, and a "Match my phone" switch (the default) that follows the phone's setting. Picking a look
 * saves it and, when the palette changes, reloads the app in about a second (lib/appearance.ts); you stay signed in.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { ScreenHeader } from '@/components/screen-header';
import { Txt } from '@/components/ui';
import { setAppearance } from '@/lib/appearance';
import { haptic } from '@/lib/haptics';
import { appearance, colors, gutter, radius, scheme, space, type AppearanceChoice } from '@/theme';

/** The two palettes as the miniatures draw them (fixed, so each preview shows its own theme whatever is active). */
const MINI = {
  light: { page: '#ffffff', card: '#ffffff', line: 'rgba(17,17,19,0.14)', text: '#111113', muted: '#7c7c83', red: '#d63a2b', bar: '#ffffff' },
  dark: { page: '#0b0b0c', card: '#1a1a1b', line: 'rgba(255,255,255,0.13)', text: '#f5f5f5', muted: '#77777c', red: '#ff4d3d', bar: '#0b0b0c' },
} as const;
type Look = keyof typeof MINI;

const PHOTO = 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=400&q=60';

/** A miniature of Discover in one theme. */
function MiniPhone({ look }: { look: Look }) {
  const c = MINI[look];
  return (
    <View style={[styles.phone, { backgroundColor: c.page, borderColor: look === 'dark' ? '#2a2a2c' : '#e4e4e7' }]}>
      <View style={styles.notch} />
      <View style={{ gap: 3, marginTop: 10 }}>
        <View style={[styles.bar, { width: '38%', backgroundColor: c.muted, opacity: 0.6 }]} />
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <View style={[styles.head, { width: '46%', backgroundColor: c.text }]} />
          <View style={[styles.head, { width: '26%', backgroundColor: c.red }]} />
        </View>
      </View>
      <View style={[styles.search, { backgroundColor: c.card, borderColor: c.line }]} />
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={[styles.chip, { backgroundColor: c.red, borderColor: c.red }]} />
        <View style={[styles.chip, { backgroundColor: c.card, borderColor: c.line }]} />
        <View style={[styles.chip, { backgroundColor: c.card, borderColor: c.line }]} />
      </View>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.line }]}>
        <View style={styles.cardPhoto}>
          <Image source={{ uri: PHOTO }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']} style={StyleSheet.absoluteFill} />
          <View style={[styles.bar, { position: 'absolute', left: 6, bottom: 6, width: '55%', backgroundColor: '#f7f2f2' }]} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 6 }}>
          <View style={[styles.bar, { width: '45%', backgroundColor: c.muted }]} />
          <View style={[styles.bar, { width: '18%', height: 5, backgroundColor: c.red }]} />
        </View>
      </View>
      <View style={[styles.tabs, { backgroundColor: c.bar, borderColor: c.line }]}>
        <View style={[styles.tabOn, { backgroundColor: look === 'dark' ? 'rgba(255,77,61,0.16)' : 'rgba(214,58,43,0.12)' }]} />
        <View style={[styles.dot, { backgroundColor: c.muted }]} />
        <View style={[styles.fab, { backgroundColor: c.red }]} />
        <View style={[styles.dot, { backgroundColor: c.muted }]} />
        <View style={[styles.dot, { backgroundColor: c.muted }]} />
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<AppearanceChoice | null>(null);
  const auto = appearance === 'system';

  const choose = async (choice: AppearanceChoice) => {
    if (busy || choice === appearance) return;
    haptic.select();
    setBusy(choice);
    try {
      await setAppearance(choice);
    } finally {
      // When the palette stays the same (e.g. turning "Match my phone" off), nothing reloads.
      setBusy(null);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.xl }}>
      <ScreenHeader title="Appearance" fallback="/account" />

      <View style={styles.panel}>
        <View style={styles.pair} accessibilityRole="radiogroup">
          {(['light', 'dark'] as const).map((look) => {
            const on = scheme === look;
            return (
              <Pressable
                key={look}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, busy: busy === look }}
                accessibilityLabel={look === 'light' ? 'Light' : 'Dark'}
                onPress={() => void choose(look)}
                style={({ pressed }) => [styles.option, pressed && { transform: [{ scale: 0.97 }] }]}>
                <View style={[styles.ring, on && styles.ringOn]}>
                  <MiniPhone look={look} />
                </View>
                <Txt variant="smallStrong" style={{ marginTop: space.md }}>
                  {look === 'light' ? 'Light' : 'Dark'}
                </Txt>
                {busy === look ? (
                  <ActivityIndicator color={colors.accent} style={styles.pick} />
                ) : (
                  <View style={[styles.pick, styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={13} color={colors.accentInk} strokeWidth={3} /> : null}</View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        <View style={styles.autoRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodyStrong">Match my phone</Txt>
            <Txt variant="small" color={colors.muted}>
              {auto ? `On · ${scheme === 'light' ? 'Light' : 'Dark'} right now, following your phone` : 'Follow your phone’s light and dark setting'}
            </Txt>
          </View>
          {busy === 'system' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Switch
              accessibilityLabel="Match my phone"
              value={auto}
              onValueChange={(v) => void choose(v ? 'system' : scheme)}
              trackColor={{ false: colors.line2, true: colors.accent }}
              thumbColor="#ffffff"
              ios_backgroundColor={colors.line2}
              // the web build ignores thumbColor when on (it draws a green knob); Notifications does the same
              {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as object) : {})}
            />
          )}
        </View>
      </View>

      <View style={styles.note}>
        <Icon name="sparkle" size={15} color={colors.accent} />
        <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
          Event photos, ticket colours and your QR codes look the same in both. Switching takes a second, and you stay signed in.
        </Txt>
      </View>
    </ScrollView>
  );
}

const PHONE_H = 196;
const styles = StyleSheet.create({
  panel: { padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, gap: space.lg },
  pair: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: space.xs },
  option: { alignItems: 'center' },
  ring: { padding: 4, borderRadius: 26, borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: colors.accent },
  phone: { width: 104, height: PHONE_H, borderRadius: 20, borderWidth: 3, padding: 8, gap: 7, overflow: 'hidden' },
  notch: { alignSelf: 'center', width: 30, height: 5, borderRadius: 3, backgroundColor: 'rgba(128,128,128,0.35)' },
  bar: { height: 4, borderRadius: 2 },
  head: { height: 8, borderRadius: 3 },
  search: { height: 13, borderRadius: 7, borderWidth: 1 },
  chip: { width: 20, height: 8, borderRadius: 4, borderWidth: 1 },
  card: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  cardPhoto: { height: 46, backgroundColor: '#3a2226' },
  tabs: { position: 'absolute', left: 6, right: 6, bottom: 6, height: 20, borderRadius: 8, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  tabOn: { width: 14, height: 12, borderRadius: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, opacity: 0.6 },
  fab: { width: 12, height: 12, borderRadius: 6, marginTop: -6 },
  pick: { marginTop: space.sm },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  divider: { height: 1, backgroundColor: colors.line },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingHorizontal: space.xs },
});
