/** A bottom sheet with a list of choices (filters). */
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space, touch } from '@/theme';
import { Icon } from './icons';
import { Txt } from './ui';

export type SheetOption<T> = { value: T; label: string; detail?: string };

export function OptionSheet<T extends string | number | null>({
  visible,
  title,
  options,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SheetOption<T>[];
  value: T;
  onPick: (v: T) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.grip} />
        <Txt variant="h3" accessibilityRole="header" style={{ paddingHorizontal: gutter, marginBottom: space.sm }}>
          {title}
        </Txt>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingHorizontal: space.md }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={String(o.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  haptic.select();
                  onPick(o.value);
                  onClose();
                }}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surface2 }]}>
                <Txt variant={on ? 'bodyStrong' : 'body'} color={on ? colors.accent : colors.text} style={{ flex: 1 }}>
                  {o.label}
                </Txt>
                {o.detail ? (
                  <Txt variant="small" color={colors.dim}>
                    {o.detail}
                  </Txt>
                ) : null}
                {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.line2,
    paddingTop: space.md,
    maxWidth: 640,
    alignSelf: 'center',
    width: '100%',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line2, marginBottom: space.lg },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch + 6, paddingHorizontal: space.md, borderRadius: radius.md },
});
