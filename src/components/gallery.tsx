/**
 * The event's photos and videos (GET /events/:slug `media`) as a swipeable gallery. The app has no video player
 * library, so a video shows its poster with a play button and opens mediaEX's player in the in-app browser.
 */
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import type { MediaItem } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';
import { Icon } from './icons';
import { Txt } from './ui';

export function Gallery({ media, title }: { media: MediaItem[]; title: string }) {
  const { width } = useWindowDimensions();
  const items = media.filter((m) => (m.kind === 'image' ? m.url : m.posterUrl || m.thumbUrl));
  const w = Math.min(width, 640) - gutter * 2;
  const h = Math.round(w * 0.62);
  const step = w + space.md;
  const [index, setIndex] = useState(0);
  if (!items.length) return null;

  const play = (m: MediaItem) => {
    const url = m.embedUrl ?? m.playbackUrl;
    if (!url) return;
    haptic.tap();
    void WebBrowser.openBrowserAsync(url, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined);
  };

  return (
    <View style={{ gap: space.sm }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}
        scrollEventThrottle={32}
        onScroll={(e) => setIndex(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))))}
        accessibilityLabel={`Photos and videos of ${title}, ${items.length}`}>
        {items.map((m, i) => {
          const video = m.kind === 'video';
          const body = (
            <>
              <Image source={{ uri: video ? (m.posterUrl ?? m.thumbUrl) : m.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityLabel={m.alt || (video ? 'Event video' : 'Event photo')} />
              {video ? (
                <View style={styles.playWrap} pointerEvents="none">
                  <View style={styles.play}>
                    <Icon name="play" size={26} color="#ffffff" fill="#ffffff" />
                  </View>
                </View>
              ) : null}
              <View style={styles.count} pointerEvents="none">
                <Txt variant="tiny">
                  {i + 1} / {items.length}
                </Txt>
              </View>
            </>
          );
          return video ? (
            <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Play video${m.alt ? `: ${m.alt}` : ''}`} onPress={() => play(m)} style={[styles.item, { width: w, height: h }]}>
              {body}
            </Pressable>
          ) : (
            <View key={m.id} style={[styles.item, { width: w, height: h }]}>
              {body}
            </View>
          );
        })}
      </ScrollView>
      {items.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {items.map((m, i) => (
            <View key={m.id} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  playWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,10,11,0.25)' },
  play: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  count: { position: 'absolute', right: 10, bottom: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.glass },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line2 },
  dotOn: { width: 18, backgroundColor: colors.accent },
});
