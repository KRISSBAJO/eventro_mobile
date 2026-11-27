/**
 * Five stars. Read-only it shows a rating (rounded to the nearest whole star); with `onChange` it's the picker in the
 * review form (each star is a button).
 */
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { haptic } from '@/lib/haptics';
import { colors } from '@/theme';

const STAR = 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8Z';
const GOLD = '#f5b93d';

function Star({ on, size }: { on: boolean; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={STAR} fill={on ? GOLD : 'none'} stroke={on ? GOLD : colors.dim} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

export function Stars({ value, size = 16, onChange }: { value: number; size?: number; onChange?: (n: number) => void }) {
  const full = Math.round(value);
  if (!onChange) {
    return (
      <View style={{ flexDirection: 'row', gap: 2 }} accessible accessibilityRole="image" accessibilityLabel={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} on={n <= full} size={size} />
        ))}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityState={{ checked: full === n }}
          accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`}
          hitSlop={6}
          onPress={() => {
            haptic.select();
            onChange(n);
          }}>
          <Star on={n <= full} size={size} />
        </Pressable>
      ))}
    </View>
  );
}
