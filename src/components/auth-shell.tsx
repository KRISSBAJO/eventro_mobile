/** The frame for sign-in, sign-up and password screens: close button, mark, title, keyboard-aware scroll. */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gutter, space } from '@/theme';
import { LogoMark } from './icons';
import { IconButton, Txt } from './ui';

export function AuthShell({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  const close = onClose ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: Math.max(insets.top, space.lg), paddingHorizontal: gutter - 4 }}>
        <IconButton icon="close" label="Close" onPress={close} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.xxxl, gap: space.lg, maxWidth: 520, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
          <LogoMark size={36} />
          <Txt variant="h1" accessibilityRole="header" style={{ marginTop: space.md }}>
            {title}
          </Txt>
          {subtitle ? <Txt color={colors.muted}>{subtitle}</Txt> : null}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
