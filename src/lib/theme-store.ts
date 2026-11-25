/**
 * The saved appearance choice, read synchronously when the app starts (theme.ts picks its palette from it before any
 * screen's styles are built). Phones keep it in the keychain/keystore through expo-secure-store's synchronous API;
 * the web build uses localStorage (theme-store.web.ts).
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'eventro.appearance';

export function readAppearance(): string | null {
  try {
    return SecureStore.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeAppearance(value: string) {
  try {
    SecureStore.setItem(KEY, value);
  } catch {
    /* not saved: the choice still applies until the app restarts */
  }
}
