/** Web version of storage.ts: localStorage (the browser build is for checking the app, not for fans). */
const PREFIX = 'eventro-app:';

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** Forgets every saved key starting with `prefix`. */
export async function clearJson(prefix: string) {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    for (const k of Object.keys(ls)) if (k.startsWith(PREFIX + prefix)) ls.removeItem(k);
  } catch {
    // ignore
  }
}
