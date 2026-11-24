/** The save heart on event cards and the event screen (see lib/saved.ts). */
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useSaved } from '@/lib/saved';
import type { EventCard } from '@/lib/types';
import { colors, touch } from '@/theme';
import { Icon } from './icons';

export function HeartButton({
  card,
  glass,
  size = 36,
  onError,
  style,
}: {
  card: EventCard;
  /** on top of a photo */
  glass?: boolean;
  size?: number;
  onError?: (message: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const saved = useSaved();
  const on = saved.isSaved(card.slug);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? `Remove ${card.title} from Saved` : `Save ${card.title}`}
      accessibilityState={{ selected: on }}
      // Small hearts still get a full-size touch area.
      hitSlop={Math.max(4, (touch - size) / 2)}
      onPress={async () => {
        const err = await saved.toggle(card);
        if (err) onError?.(err);
      }}
      style={({ pressed }) => [
        styles.btn,
        { width: size, height: size, borderRadius: size / 2 },
        glass ? styles.glass : styles.plain,
        pressed && { transform: [{ scale: 0.9 }] },
        style,
      ]}>
      <Icon name="heart" size={Math.round(size * 0.5)} color={on ? colors.accent : colors.text} fill={on ? colors.accent : undefined} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  glass: { backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  plain: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2 },
});
