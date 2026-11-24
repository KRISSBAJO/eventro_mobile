/** Haptic feedback on key actions. No-ops on web and never throws (devices without a motor). */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const on = Platform.OS === 'ios' || Platform.OS === 'android';
const safe = (p: () => Promise<void>) => {
  if (!on) return;
  p().catch(() => undefined);
};

export const haptic = {
  /** chips, steppers, tab switches */
  select: () => safe(() => Haptics.selectionAsync()),
  /** primary buttons */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  firm: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
