/**
 * A venue's photos, picked from the phone and uploaded to mediaEX (lib/media-upload.ts, like event covers): up to
 * VENUE_PHOTOS_MAX, the first is the cover. Tiles show each photo with Cover on the first; tap a photo to make it the
 * cover or remove it. Used when adding a venue (app/my-venues/add.tsx) and in its details (my-venues/[id]/details.tsx).
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/icons';
import { Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { PickError, pickPhoto, uploadPhoto, useMediaConfig } from '@/lib/media-upload';
import { colors, radius, space } from '@/theme';

export const VENUE_PHOTOS_MAX = 10;

export function VenuePhotos({ photos, onChange, error }: { photos: string[]; onChange: (fn: (p: string[]) => string[]) => void; error?: string }) {
  const cfg = useMediaConfig();
  const [busy, setBusy] = useState<{ progress: number } | null>(null);
  const [problem, setProblem] = useState('');

  const add = async () => {
    if (busy || !cfg.data) return;
    setProblem('');
    try {
      const picked = await pickPhoto(cfg.data);
      setBusy({ progress: 0 });
      const up = await uploadPhoto(picked, (progress) => setBusy({ progress }));
      haptic.success();
      onChange((p) => [...p.filter((x) => x !== up.url), up.url].slice(0, VENUE_PHOTOS_MAX));
    } catch (e) {
      if (e instanceof PickError && e.kind === 'cancelled') return;
      const msg = e instanceof Error ? e.message : 'The upload didn’t go through. Try again.';
      setProblem(/unavailable|reachable/i.test(msg) ? 'Photo uploads aren’t working right now. Try again in a few minutes.' : msg);
    } finally {
      setBusy(null);
    }
  };

  const options = (url: string, i: number) => {
    haptic.select();
    Alert.alert(i === 0 ? 'Cover photo' : `Photo ${i + 1}`, undefined, [
      ...(i > 0 ? [{ text: 'Make it the cover', onPress: () => onChange((p) => [url, ...p.filter((x) => x !== url)]) }] : []),
      { text: 'Remove', style: 'destructive' as const, onPress: () => onChange((p) => p.filter((x) => x !== url)) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const full = photos.length >= VENUE_PHOTOS_MAX;
  const shown = error || problem;
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.grid}>
        {photos.map((url, i) => (
          <Pressable key={url} accessibilityRole="button" accessibilityLabel={i === 0 ? 'Cover photo, options' : `Photo ${i + 1}, options`} onPress={() => options(url, i)} style={styles.tile}>
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            {i === 0 ? (
              <View style={styles.cover}>
                <Txt variant="tiny" color="#fff" style={{ fontWeight: '700' }}>
                  Cover
                </Txt>
              </View>
            ) : null}
          </Pressable>
        ))}
        {busy ? (
          <View style={[styles.tile, styles.add]}>
            <ActivityIndicator color={colors.accent} />
            <Txt variant="tiny" color={colors.muted}>
              {busy.progress < 100 ? `${busy.progress}%` : 'Finishing…'}
            </Txt>
          </View>
        ) : full ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Add a photo" onPress={() => void add()} style={({ pressed }) => [styles.tile, styles.add, shown && !photos.length && { borderColor: colors.accentLine }, pressed && { opacity: 0.7 }]}>
            <Icon name="plus" size={22} color={colors.accent} />
            <Txt variant="tiny" color={colors.muted}>
              {photos.length ? 'Add photo' : 'Add a photo'}
            </Txt>
          </Pressable>
        )}
      </View>
      {shown ? (
        <Txt variant="small" color={colors.accent}>
          {shown}
        </Txt>
      ) : (
        <Txt variant="small" color={colors.dim}>
          {photos.length ? `${photos.length} of ${VENUE_PHOTOS_MAX}. The first is the cover; tap a photo to change it.` : `At least one photo, up to ${VENUE_PHOTOS_MAX}. The first is the cover.`}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '31.5%', aspectRatio: 4 / 3, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
  add: { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line2, backgroundColor: 'transparent' },
  cover: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(15,10,11,0.66)' },
});
