/** Browser version of push.ts: the web preview gets no push notifications (the API only sends to Expo tokens). */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const WHY = 'Notifications work in the Eventro phone app.';

export const projectId = (): string | null => null;
export const pushBlocker = (): string | null => WHY;
export const pushPermission = async (): Promise<PushPermission> => 'unsupported';
export const savedPushToken = async (): Promise<string | null> => null;
export const enablePush = async (_ask: boolean): Promise<{ ok: true; token: string } | { ok: false; reason: string; permission?: PushPermission }> => ({ ok: false, reason: WHY, permission: 'unsupported' });
export const registerPushIfAllowed = async () => undefined;
export const forgetPushToken = async () => undefined;
export const shouldOfferPush = async () => false;
export const markPushOffered = async () => undefined;
export const usePushLinks = () => undefined;
export const PushLinks = () => null;
