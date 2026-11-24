/**
 * Push notifications (expo-notifications + Expo's push service).
 *
 * - Permission is asked only when it helps: after a first purchase ("remind me before doors open") and from
 *   Account → Notifications. Never at launch.
 * - The Expo push token needs the EAS project id (app.json → extra.eas.projectId, set by `eas init`). Without
 *   it, or in Expo Go on Android (remote push was removed from Expo Go in SDK 53: use a development build), or on
 *   a simulator, `enablePush` explains why instead of failing.
 * - The token is registered with POST /me/push-devices after every sign-in and app start, and dropped on sign-out
 *   (POST /auth/logout carries it).
 * - Tapping a notification opens `data.path` in the app (see links.ts). push.web.ts: browsers get none of this.
 *
 * expo-notifications is imported lazily, so nothing loads (or warns) until it's needed.
 */
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';
import { deviceName, devicePlatform } from './device';
import { appPath } from './links';
import { readJson, writeJson } from './storage';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const lib = () => import('expo-notifications');

const TOKEN_KEY = 'push-token';
const OFFERED_KEY = 'push-offered';

export const projectId = (): string | null =>
  ((Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId ?? null) || null;

/** Why this build can't get push notifications, if it can't. */
export function pushBlocker(): string | null {
  if (Platform.OS === 'web') return 'Notifications work in the Eventro phone app.';
  if (Platform.OS === 'android' && isRunningInExpoGo()) return 'Expo Go on Android can’t receive push notifications. Install a development build of Eventro to get them.';
  if (!Device.isDevice) return 'Push notifications need a real phone, not a simulator.';
  if (!projectId()) return 'This build isn’t linked to an Expo (EAS) project yet, so it can’t get a push token. Run `eas init` to add the project id.';
  return null;
}

export async function pushPermission(): Promise<PushPermission> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const N = await lib();
    const p = await N.getPermissionsAsync();
    if (p.granted || p.ios?.status === N.IosAuthorizationStatus.PROVISIONAL) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export const savedPushToken = () => readJson<string>(TOKEN_KEY);

/**
 * Turns notifications on for this phone: (optionally) asks for permission, gets the Expo push token and registers
 * it. Returns why not when it can't.
 */
export async function enablePush(ask: boolean): Promise<{ ok: true; token: string } | { ok: false; reason: string; permission?: PushPermission }> {
  if (Platform.OS === 'web') return { ok: false, reason: 'Notifications work in the Eventro phone app.', permission: 'unsupported' };
  try {
    const N = await lib();
    // Android 13+ only shows the permission prompt once a channel exists.
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', { name: 'Tickets and reminders', importance: N.AndroidImportance.HIGH, lightColor: '#ff4d3d' });
    }
    let perm = await pushPermission();
    if (perm === 'undetermined' && ask) {
      const r = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
      perm = r.granted || r.ios?.status === N.IosAuthorizationStatus.PROVISIONAL ? 'granted' : r.canAskAgain ? 'undetermined' : 'denied';
    }
    if (perm !== 'granted') {
      return { ok: false, permission: perm, reason: perm === 'denied' ? 'Notifications are off for Eventro. Turn them on in your phone’s Settings.' : 'Allow notifications to get reminders and ticket updates.' };
    }
    const blocker = pushBlocker();
    if (blocker) return { ok: false, reason: blocker, permission: perm };
    const { data: token } = await N.getExpoPushTokenAsync({ projectId: projectId()! });
    await api('/me/push-devices', { body: { token, platform: devicePlatform(), deviceName: deviceName() } });
    await writeJson(TOKEN_KEY, token);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.message ? e.message : 'Couldn’t turn on notifications. Please try again.' };
  }
}

/** After sign-in and at start-up: registers again if notifications are already allowed (no prompt). */
export async function registerPushIfAllowed() {
  if (pushBlocker()) return;
  if ((await pushPermission()) !== 'granted') return;
  await enablePush(false);
}

/** Sign-out: forget the token (POST /auth/logout already told the API to stop sending to it). */
export const forgetPushToken = () => writeJson(TOKEN_KEY, null);

/** Whether to offer notifications after a purchase: only once, and only when the phone could say yes. */
export async function shouldOfferPush() {
  if (Platform.OS === 'web' || (Platform.OS === 'android' && isRunningInExpoGo())) return false;
  if (await readJson<boolean>(OFFERED_KEY)) return false;
  return (await pushPermission()) === 'undetermined';
}
export const markPushOffered = () => writeJson(OFFERED_KEY, true);

const handled = new Set<string>();

function open(data: Record<string, unknown> | undefined, id: string) {
  if (handled.has(id)) return;
  handled.add(id);
  const href = appPath(typeof data?.path === 'string' ? data.path : typeof data?.url === 'string' ? data.url : null);
  if (href) router.push(href);
}

/** Root layout: show notifications while the app is open, and open the right screen when one is tapped. */
export function usePushLinks() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    let sub: { remove: () => void } | null = null;
    void (async () => {
      try {
        const N = await lib();
        if (!live) return;
        N.setNotificationHandler({
          handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
        });
        sub = N.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data, r.notification.request.identifier));
        // Opened from a notification while the app was closed.
        const last = await N.getLastNotificationResponseAsync();
        if (live && last) {
          open(last.notification.request.content.data, last.notification.request.identifier);
          await N.clearLastNotificationResponseAsync();
        }
      } catch {
        // No notifications on this build: nothing to listen to.
      }
    })();
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
}

/** Renders nothing; listens for notification taps (see usePushLinks). */
export function PushLinks() {
  usePushLinks();
  return null;
}
