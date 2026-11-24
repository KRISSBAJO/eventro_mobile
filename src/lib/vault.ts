/**
 * Encrypted storage for things too big for the keychain that must not sit on disk in the clear: saved tickets
 * (they carry QR seeds) and a door scanner's offline pack (every seed for an event).
 *
 * Each value is JSON, sealed with AES-256-GCM (expo-crypto) under one random key that lives in the keychain /
 * keystore (expo-secure-store), and written to a file in the app's document folder. Wiping the key makes every
 * file unreadable. vault.web.ts is the browser fallback (localStorage, for checking the app only).
 */
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { fromUtf8, utf8 } from './hmac';
import { readSecret, writeSecret } from './secure';

const KEY = 'eventro.vaultKey';
let key: Promise<AESEncryptionKey | null> | null = null;

function vaultKey(create: boolean): Promise<AESEncryptionKey | null> {
  if (key) return key;
  const p = (async () => {
    const saved = await readSecret(KEY);
    if (saved) return AESEncryptionKey.import(saved, 'hex');
    if (!create) return null;
    const k = await AESEncryptionKey.generate();
    await writeSecret(KEY, await k.encoded('hex'));
    return k;
  })().catch(() => null);
  // Only remember a key that exists, so a later write can still create one.
  key = p.then((k) => {
    if (!k) key = null;
    return k;
  });
  return key;
}

const fileFor = (name: string) => new File(Paths.document, `eventro-vault-${name.replace(/[^\w.-]/g, '_')}.bin`);

export async function readVault<T>(name: string): Promise<T | null> {
  try {
    const f = fileFor(name);
    if (!f.exists) return null;
    const k = await vaultKey(false);
    if (!k) return null;
    const sealed = AESSealedData.fromCombined(await f.text());
    const bytes = await aesDecryptAsync(sealed, k, { output: 'bytes' });
    return JSON.parse(fromUtf8(bytes)) as T;
  } catch {
    return null;
  }
}

/** Saves (or with null, deletes) a value. Never throws: it's a cache. */
export async function writeVault(name: string, value: unknown) {
  try {
    const f = fileFor(name);
    if (value === null || value === undefined) {
      if (f.exists) f.delete();
      return;
    }
    const k = await vaultKey(true);
    if (!k) return;
    const sealed = await aesEncryptAsync(utf8(JSON.stringify(value)), k);
    if (!f.exists) f.create();
    f.write(await sealed.combined('base64'));
  } catch {
    // ignore: best effort
  }
}

/** Deletes every vault file whose name starts with `prefix` ('' = all of them). */
export async function clearVault(prefix = '') {
  try {
    const start = `eventro-vault-${prefix.replace(/[^\w.-]/g, '_')}`;
    for (const item of Paths.document.list()) {
      if (item instanceof File && item.name.startsWith(start)) item.delete();
    }
  } catch {
    // ignore
  }
}

/** Sign-out: every file and the key go (a new key is made next time something is saved). */
export async function resetVault() {
  await clearVault('');
  key = null;
  await writeSecret(KEY, null);
}

/** Names of saved values starting with `prefix`. */
export function listVault(prefix: string): string[] {
  try {
    const start = `eventro-vault-${prefix}`;
    return Paths.document
      .list()
      .filter((i): i is File => i instanceof File && i.name.startsWith(start) && i.name.endsWith('.bin'))
      .map((f) => f.name.slice('eventro-vault-'.length, -'.bin'.length));
  } catch {
    return [];
  }
}
