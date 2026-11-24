/**
 * The signed-in session. The token is kept in secure storage (keychain / keystore; localStorage on web) and
 * checked against GET /auth/me at start-up. A 401 from any call ends the session, like the website.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setApiToken, setUnauthorizedHandler } from './api';
import { readSecret, writeSecret } from './secure';
import { clearJson, writeJson } from './storage';
import type { Session, User } from './types';

const TOKEN = 'eventro.token';
const USER = 'eventro.user';

type Auth = {
  /** false until the saved session has been read */
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, email: string, password: string) => Promise<User>;
  /** Store a session the API returned (sign-in, sign-up, password change). */
  adopt: (s: Session) => Promise<User>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);

  const clear = useCallback(async () => {
    const was = user?.id;
    setApiToken(null);
    setUserState(null);
    await Promise.all([writeSecret(TOKEN, null), writeSecret(USER, null)]);
    if (was) await writeJson(`tickets-${was}`, null);
    await clearJson('qr-');
    qc.removeQueries({ queryKey: ['me'] });
  }, [qc, user?.id]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  // Load the saved session, then make sure it still works (suspended accounts and password changes end it).
  useEffect(() => {
    let live = true;
    (async () => {
      const [token, saved] = await Promise.all([readSecret(TOKEN), readSecret(USER)]);
      if (!live) return;
      if (token) {
        setApiToken(token);
        try {
          setUserState(saved ? (JSON.parse(saved) as User) : null);
        } catch {
          setUserState(null);
        }
      }
      setReady(true);
      if (!token) return;
      try {
        const me = await api<User>('/auth/me');
        if (!live) return;
        setUserState(me);
        await writeSecret(USER, JSON.stringify(me));
      } catch {
        // Offline: keep the saved session so the wallet still opens. A 401 is handled by the API client.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const adopt = useCallback(
    async (s: Session) => {
      setApiToken(s.token);
      setUserState(s.user);
      await Promise.all([writeSecret(TOKEN, s.token), writeSecret(USER, JSON.stringify(s.user))]);
      qc.invalidateQueries({ queryKey: ['me'] });
      return s.user;
    },
    [qc],
  );

  const value = useMemo<Auth>(
    () => ({
      ready,
      user,
      adopt,
      signIn: async (email, password) => adopt(await api<Session>('/auth/login', { body: { email: email.trim().toLowerCase(), password } })),
      signUp: async (name, email, password) => adopt(await api<Session>('/auth/signup', { body: { name: name.trim(), email: email.trim().toLowerCase(), password } })),
      signOut: clear,
      setUser: (u) => {
        setUserState(u);
        void writeSecret(USER, JSON.stringify(u));
      },
    }),
    [ready, user, adopt, clear],
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
