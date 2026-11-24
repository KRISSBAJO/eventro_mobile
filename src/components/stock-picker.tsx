/**
 * "No photos yet? Pick one of ours": the website's free cover photos (lib/stock-covers.ts), grouped by category
 * with the event's own category first. Categories are wrapping chips so none hide off the edge; 6 photos show at a
 * time with "Show more"; the chosen one gets a check. Credit to Unsplash underneath.
 */
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { STOCK_CATEGORIES, stockCovers, stockThumb } from '@/lib/stock-covers';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Button, Chip, Txt } from './ui';

const PAGE = 6;

/** `category` is a display name ("Concerts"), as the stock sets are keyed. */
export function StockPicker({ category, value, onPick }: { category: string; value: string; onPick: (url: string) => void }) {
  const first = STOCK_CATEGORIES.includes(category) ? category : 'Concerts';
  const [tab, setTab] = useState(first);
  const [shown, setShown] = useState(PAGE);
  const covers = useMemo(() => stockCovers(tab), [tab]);
  const tabs = [first, ...STOCK_CATEGORIES.filter((c) => c !== first)];

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.chips} accessibilityRole="tablist">
        {tabs.map((c) => (
          <Chip
            key={c}
            label={c === first && c === category ? `${c} · yours` : c}
            active={tab === c}
            onPress={() => {
              setTab(c);
              setShown(PAGE);
            }}
          />
        ))}
      </View>
      <Txt variant="small" color={colors.dim}>
        {covers.length} free photos for {tab.toLowerCase()}
      </Txt>
      <View style={styles.grid}>
        {covers.slice(0, shown).map((c, i) => {
          const on = value === c;
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`${tab} photo ${i + 1}`}
              accessibilityState={{ selected: on }}
              onPress={() => {
                haptic.select();
                onPick(c);
              }}
              style={({ pressed }) => [styles.photo, on && styles.photoOn, pressed && { opacity: 0.85 }]}>
              <Image source={{ uri: stockThumb(c) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={c} />
              {on ? (
                <View style={styles.check}>
                  <Icon name="check" size={14} color={colors.accentInk} strokeWidth={3} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {shown < covers.length ? <Button label={`Show ${covers.length - shown} more`} variant="ghost" size="md" onPress={() => setShown(covers.length)} /> : null}
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://unsplash.com/license').catch(() => undefined)}>
        <Txt variant="small" color={colors.dim}>
          Photos from Unsplash, free to use. Your own photos always look best.
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: '48.5%', aspectRatio: 4 / 3, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: colors.surface2 },
  photoOn: { borderColor: colors.accent },
  check: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
