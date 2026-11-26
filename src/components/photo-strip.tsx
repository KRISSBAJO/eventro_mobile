/**
 * A venue's photos on its screen: a row of tiles that scrolls sideways, and a full-screen viewer that swipes between
 * them (tap a tile to open it, the close button or Back to leave).
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme';

export function PhotoStrip({ photos, title }: { photos: { url: string; alt?: string }[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (photos.length < 2) return null;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Txt variant="h3" accessibilityRole="header">
          Photos
        </Txt>
        <Txt variant="small" color={colors.dim}>
          {photos.length}
        </Txt>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.sm }}>
        {photos.map((p, i) => (
          <Pressable
            key={p.url}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${title}, photo ${i + 1} of ${photos.length}`}
            onPress={() => {
              haptic.select();
              setAt(i);
              setOpen(i);
            }}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
          >
            <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={p.url} />
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={open !== null} animationType="fade" transparent statusBarTranslucent onRequestClose={() => setOpen(null)}>
        <View style={styles.viewer}>
          <FlatList
            data={photos}
            keyExtractor={(p) => p.url}
            horizontal
            pagingEnabled
            initialScrollIndex={open ?? 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <Image source={{ uri: item.url }} style={{ width, height: height * 0.75 }} contentFit="contain" />
              </View>
            )}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Close photos" onPress={() => setOpen(null)} hitSlop={10} style={[styles.close, { top: insets.top + space.md }]}>
            <Icon name="close" size={20} color="#fff" />
          </Pressable>
          <Txt variant="small" color="rgba(255,255,255,0.75)" style={[styles.count, { bottom: insets.bottom + space.xl }]}>
            {at + 1} / {photos.length}
          </Txt>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: 200, height: 140, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
  viewer: { flex: 1, backgroundColor: 'rgba(5,5,6,0.96)' },
  close: { position: 'absolute', right: gutter, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  count: { position: 'absolute', alignSelf: 'center' },
});
