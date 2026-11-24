/** Browser fallback for secure.ts: localStorage. Fine for checking the app in a browser; phones use the keychain. */
const PREFIX = 'eventro-app:secure:';

export async function readSecret(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export async function writeSecret(key: string, value: string | null) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    // ignore
  }
}
