import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmProvider } from '@/components/confirm';
import { AuthProvider } from '@/lib/auth';
import { PlaceProvider } from '@/lib/place';
import { PushLinks } from '@/lib/push';
import { queryClient } from '@/lib/query';
import { SavedSync } from '@/lib/saved';
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
              {/* Tapping a notification opens its screen (data.path); mounted with the navigator so it can navigate. */}
              <PushLinks />
              {/* Hearts saved while signed out move into the account at sign-in. */}
              <SavedSync />
              <ConfirmProvider>
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
                  <Stack.Screen name="reset-password" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="transfer/[id]" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="sell/[id]" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="gift/[token]" />
                  <Stack.Screen name="resale" />
                  <Stack.Screen name="devices" />
                  <Stack.Screen name="notifications" />
                  <Stack.Screen name="organizer/index" />
                  <Stack.Screen name="organizer/create" options={{ gestureEnabled: false }} />
                  <Stack.Screen name="organizer/start" />
                  <Stack.Screen name="organizer/events/[id]/index" />
                  <Stack.Screen name="organizer/events/[id]/edit" />
                  <Stack.Screen name="organizer/events/[id]/cancel" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="door/[eventId]" options={{ gestureEnabled: false }} />
                  <Stack.Screen name="seats/[slug]" />
                  <Stack.Screen name="saved" />
                  <Stack.Screen name="orders" />
                  <Stack.Screen name="order/[id]" />
                  <Stack.Screen name="venue/[slug]" />
                  <Stack.Screen name="category/[category]" />
                  <Stack.Screen name="city/[city]" />
                </Stack>
              </ConfirmProvider>
            </ThemeProvider>
          </PlaceProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
