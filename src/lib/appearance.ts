/**
 * Changing the appearance (Account → Appearance): the choice is saved, then the app reloads so every screen builds
 * its styles from the new palette (theme.ts reads the choice at start-up). The reload takes about a second and keeps
 * the person signed in; in the web build it's a page reload.
 *
 * With "Match my phone", a change of the phone's own light/dark setting while the app is open reloads it too.
 */
import { useEffect } from 'react';
import { Appearance, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { appearance, scheme, type AppearanceChoice } from '@/theme';
import { writeAppearance } from './theme-store';

async function reload() {
  if (Platform.OS === 'web') {
    globalThis.location?.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // Development builds without the updates runtime: the dev client's reload.
    const { DevSettings } = await import('react-native');
    DevSettings.reload();
  }
}

export async function setAppearance(choice: AppearanceChoice) {
  if (choice === appearance) return;
  writeAppearance(choice);
  const next = choice === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : choice;
  // Same palette (e.g. "Match my phone" while the phone is dark and the app is dark): saved, no reload needed.
  if (next === scheme) return;
  await reload();
}

/** Mounted once at the root: with "Match my phone", follows the phone switching light/dark while the app is open. */
export function AppearanceSync() {
  useEffect(() => {
    if (appearance !== 'system') return;
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      const next = colorScheme === 'light' ? 'light' : 'dark';
      if (next !== scheme) void reload();
    });
    return () => sub.remove();
  }, []);
  return null;
}
