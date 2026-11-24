/** Web preview stand-in for door-camera.tsx: there's no camera here, so codes are typed in instead. */
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Txt } from './ui';

export const HAS_CAMERA = false;

export function DoorCamera({ height }: { paused: boolean; torch: boolean; onCode: (data: string) => void; height: number }) {
  return (
    <View style={[styles.box, { height }]}>
      <Icon name="scan" size={30} color={colors.muted} />
      <Txt variant="title" style={{ textAlign: 'center' }}>
        The camera scanner is in the phone app
      </Txt>
      <Txt variant="small" color={colors.muted} style={{ textAlign: 'center' }}>
        In this preview, paste or type a ticket’s code below.
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.panel, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2, borderStyle: 'dashed' },
});
