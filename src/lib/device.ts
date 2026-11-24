/** This phone: a readable name for "Signed-in devices", the platform, and a stable random id for door scanning. */
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { readSecret, writeSecret } from './secure';

/** "Ada’s iPhone", "Pixel 9", "Chrome on Windows" (the web preview; its platform is "web"). */
export function deviceName(): string {
  if (Platform.OS === 'web') {
    const ua = globalThis.navigator?.userAgent ?? '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return `${browser}${os ? ` on ${os}` : ''}`.slice(0, 80);
  }
  return (Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone')).slice(0, 80);
}

export const devicePlatform = (): string => Platform.OS;

/** What sign-in, sign-up and reset send so the API starts a long-lived device session. */
export const deviceInfo = () => ({ name: deviceName(), platform: devicePlatform() });

const ID_KEY = 'eventro.deviceId';
let id: Promise<string> | null = null;

/**
 * A random id for this install (kept across sign-ins), sent with door scans so the API can tell scanners apart
 * ("already scanned on another device").
 */
export function deviceId(): Promise<string> {
  id ??= (async () => {
    const saved = await readSecret(ID_KEY);
    if (saved) return saved;
    const fresh = `app-${Crypto.randomUUID()}`;
    await writeSecret(ID_KEY, fresh);
    return fresh;
  })();
  return id;
}
