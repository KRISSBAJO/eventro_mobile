/** Browser fallback for vault.ts: plain localStorage (the web build is for checking the app, not for fans or door staff). */
const PREFIX = 'eventro-app:vault:';

export async function readVault<T>(name: string): Promise<T | null> {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + name);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeVault(name: string, value: unknown) {
  try {
    if (value === null || value === undefined) globalThis.localStorage?.removeItem(PREFIX + name);
    else globalThis.localStorage?.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // ignore (quota)
  }
}

export async function clearVault(prefix = '') {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    for (const k of Object.keys(ls)) if (k.startsWith(PREFIX + prefix)) ls.removeItem(k);
  } catch {
    // ignore
  }
}

export const resetVault = () => clearVault('');

export function listVault(prefix: string): string[] {
  try {
    const ls = globalThis.localStorage;
    return ls ? Object.keys(ls).filter((k) => k.startsWith(PREFIX + prefix)).map((k) => k.slice(PREFIX.length)) : [];
  } catch {
    return [];
  }
}
