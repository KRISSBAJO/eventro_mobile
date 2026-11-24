import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth';
import { PlaceProvider } from '@/lib/place';
import { queryClient } from '@/lib/query';
import { colors, fontAssets } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: colors.accent, background: colors.bg, card: colors.bg, text: colors.text, border: colors.line, notification: colors.accent },
};

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  const ready = loaded || !!error;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PlaceProvider>
            <ThemeProvider value={theme}>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'default' }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="event/[slug]" />
                <Stack.Screen name="checkout/[holdId]" options={{ gestureEnabled: false }} />
                <Stack.Screen name="ticket/[id]" />
                <Stack.Screen name="place" options={{ presentation: 'modal' }} />
                <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
                <Stack.Screen name="sign-up" options={{ presentation: 'modal' }} />
                <Stack.Screen name="forgot-password" options={{ presentation: 'modal' }} />
                <Stack.Screen name="change-password" options={{ presentation: 'modal' }} />
              </Stack>
            </ThemeProvider>
          </PlaceProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
