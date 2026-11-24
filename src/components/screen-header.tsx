/** The back button and title at the top of a pushed screen (saved, orders, venue, category and city pages). */
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { colors, space } from '@/theme';
import { IconButton, Txt } from './ui';

export function ScreenHeader({ title, eyebrow, fallback = '/', right }: { title: string; eyebrow?: string; fallback?: Href; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))} />
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow ? (
          <Txt variant="eyebrow" color={colors.accent} numberOfLines={1}>
            {eyebrow}
          </Txt>
        ) : null}
        <Txt variant="h2" accessibilityRole="header" numberOfLines={2}>
          {title}
        </Txt>
      </View>
      {right}
    </View>
  );
}
