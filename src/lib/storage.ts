/**
 * Small JSON cache for things that aren't secret: the chosen place, the last tickets list and QR codes,
 * so the wallet opens offline. Files in the app's document folder (expo-file-system); storage.web.ts uses
 * localStorage instead. Every call swallows errors: a cache must never break a screen.
 */
import { File, Paths } from 'expo-file-system';

const fileFor = (key: string) => new File(Paths.document, `eventro-${key.replace(/[^\w.-]/g, '_')}.json`);

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const f = fileFor(key);
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown) {
  try {
    const f = fileFor(key);
    if (value === null || value === undefined) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create();
    await f.write(JSON.stringify(value));
  } catch {
    // ignore: the cache is best effort
  }
}

/** Forgets every saved key starting with `prefix` (e.g. all QR codes when signing out). */
export async function clearJson(prefix: string) {
  try {
    const start = `eventro-${prefix.replace(/[^\w.-]/g, '_')}`;
    for (const item of Paths.document.list()) {
      if (item instanceof File && item.name.startsWith(start)) item.delete();
    }
  } catch {
    // ignore
  }
}
