/** The signed-in session, kept in the device keychain / keystore (expo-secure-store). secure.web.ts is the browser fallback. */
import * as SecureStore from 'expo-secure-store';

export async function readSecret(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writeSecret(key: string, value: string | null) {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // A keystore that refuses (rare, e.g. after a restore) just means signing in again next launch.
  }
}
