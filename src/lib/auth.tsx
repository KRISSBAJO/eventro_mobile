/**
 * The signed-in session.
 *
 * Sign-in, sign-up and password resets send `device` (name and platform), so the API starts a long-lived device
 * session: a 1-hour access token and a refresh token (rotated on every refresh; see api.ts). Both live in secure
 * storage (keychain / keystore; localStorage on web) and are checked against GET /auth/me at start-up.
 *
 * The session ends when a refresh is refused (signed out elsewhere, password reset, suspended, or a reused refresh
 * token) or when the person signs out here. Signing out tells the API (POST /auth/logout with this phone's push
 * token) and wipes what this phone kept: tokens, saved tickets and their QR seeds, door packs.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getApiTokens, setApiTokens, setSessionHandlers, settleRefresh, tokensFrom, type Tokens } from './api';
import { deviceInfo } from './device';
import { forgetPushToken, registerPushIfAllowed, savedPushToken } from './push';
import { readSecret, writeSecret } from './secure';
import { clearJson } from './storage';
import type { Session, User } from './types';
import { resetVault } from './vault';

const SESSION = 'eventro.session';
/** phase-1 sign-ins (a 7-day token, no refresh token) */
const LEGACY_TOKEN = 'eventro.token';
const USER = 'eventro.user';

type Auth = {
  /** false until the saved session has been read */
  ready: boolean;
  user: User | null;
  /** why the last session ended on its own ("You were signed out on this device…"), until the next sign-in */
  endedNotice: string | null;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, email: string, password: string) => Promise<User>;
  /** Store a session the API returned (sign-in, sign-up, password reset or change). */
  adopt: (s: Session) => Promise<User>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<Auth | null>(null);

const saveTokens = (t: Tokens | null) => writeSecret(SESSION, t ? JSON.stringify(t) : null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);
  const [endedNotice, setEndedNotice] = useState<string | null>(null);

  /** Forgets everything this phone kept for the account. */
  const wipe = useCallback(async () => {
    setApiTokens(null);
    setUserState(null);
    await Promise.all([writeSecret(SESSION, null), writeSecret(LEGACY_TOKEN, null), writeSecret(USER, null), forgetPushToken()]);
    // Saved tickets (with QR seeds), door packs and queued scans, then the older plain caches.
    await resetVault();
    await Promise.all([clearJson('qr-'), clearJson('tickets-')]);
    qc.removeQueries({ queryKey: ['me'] });
    qc.removeQueries({ queryKey: ['organizer'] });
  }, [qc]);

  useEffect(() => {
    setSessionHandlers({
      persist: saveTokens,
      // The API refused to renew the session: it's over here too (it already is on the server).
      refused: (message) => {
        setEndedNotice(message || 'Your session has expired. Please sign in again.');
        void wipe();
      },
    });
    return () => setSessionHandlers(null);
  }, [wipe]);

  // Load the saved session, then make sure it still works (suspended accounts and password changes end it).
  useEffect(() => {
    let live = true;
    (async () => {
      const [rawSession, legacy, saved] = await Promise.all([readSecret(SESSION), readSecret(LEGACY_TOKEN), readSecret(USER)]);
      if (!live) return;
      let tokens: Tokens | null = null;
      try {
        tokens = rawSession ? (JSON.parse(rawSession) as Tokens) : legacy ? { token: legacy, refreshToken: null, sessionId: null, expiresAt: null } : null;
      } catch {
        tokens = null;
      }
      if (tokens) {
        setApiTokens(tokens);
        try {
          setUserState(saved ? (JSON.parse(saved) as User) : null);
        } catch {
          setUserState(null);
        }
      }
      setReady(true);
      // Plain-text ticket caches from before seeds were kept encrypted.
      void clearJson('tickets-');
      if (!tokens) return;
      try {
        const me = await api<User>('/auth/me');
        if (!live) return;
        setUserState(me);
        await writeSecret(USER, JSON.stringify(me));
        void registerPushIfAllowed();
      } catch {
        // Offline: keep the saved session so the wallet still opens. A refused session is handled by the API client.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const adopt = useCallback(
    async (s: Session) => {
      const t = tokensFrom(s, getApiTokens());
      setApiTokens(t);
      setUserState(s.user);
      setEndedNotice(null);
      await Promise.all([saveTokens(t), writeSecret(LEGACY_TOKEN, null), writeSecret(USER, JSON.stringify(s.user))]);
      qc.invalidateQueries({ queryKey: ['me'] });
      void registerPushIfAllowed();
      return s.user;
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    // A refresh in flight would hand back a newer refresh token: wait, then log out with that one.
    await settleRefresh();
    const t = getApiTokens();
    const pushToken = await savedPushToken();
    if (t?.refreshToken) {
      await api('/auth/logout', { auth: false, timeoutMs: 6000, body: { refreshToken: t.refreshToken, ...(pushToken ? { pushToken } : {}) } }).catch(() => undefined);
    } else if (t && pushToken) {
      await api(`/me/push-devices/${encodeURIComponent(pushToken)}`, { method: 'DELETE', timeoutMs: 6000 }).catch(() => undefined);
    }
    setEndedNotice(null);
    await wipe();
  }, [wipe]);

  const value = useMemo<Auth>(
    () => ({
      ready,
      user,
      endedNotice,
      adopt,
      signIn: async (email, password) => adopt(await api<Session>('/auth/login', { auth: false, body: { email: email.trim().toLowerCase(), password, device: deviceInfo() } })),
      signUp: async (name, email, password) =>
        adopt(await api<Session>('/auth/signup', { auth: false, body: { name: name.trim(), email: email.trim().toLowerCase(), password, device: deviceInfo() } })),
      signOut,
      setUser: (u) => {
        setUserState(u);
        void writeSecret(USER, JSON.stringify(u));
      },
    }),
    [ready, user, endedNotice, adopt, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth needs <AuthProvider>');
  return v;
}

/** Basic email check for forms (the API validates properly). */
export const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
