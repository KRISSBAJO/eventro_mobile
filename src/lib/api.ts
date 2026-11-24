/**
 * Client for the Eventro API (the eventro-be repo).
 *
 * EXPO_PUBLIC_API_URL sets the base URL (see .env.example). On a phone it must be the computer's LAN address,
 * e.g. http://192.168.1.20:4000/api/v1, because 127.0.0.1 on the phone is the phone itself.
 */
import { fromBase64url, fromUtf8 } from './hmac';

export const API_URL =(process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');

/** The website, for help pages, legal pages and the browser checkout fallback. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'http://127.0.0.1:3500').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the API couldn't be reached at all */
    readonly status: number,
    /** a machine-readable reason some endpoints add, e.g. RESET_EXPIRED */
    readonly code?: string,
    /** the error's whole body, for the few answers that carry more (409 VENUE_EXISTS names the venue) */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;

/* ---------- the session's tokens ----------
 *
 * Phone sign-ins are device sessions: a 1-hour access token plus a refresh token (POST /auth/refresh swaps it for
 * a new pair; the old refresh token stops working, and presenting it again revokes the whole session). So:
 *   - refresh proactively a couple of minutes before the access token runs out, and again after a 401;
 *   - only one refresh at a time: every request that needs one waits for the same promise;
 *   - save the new pair before anything uses it, so a crash can't leave the phone holding a spent token.
 * auth.tsx loads the tokens at start-up, saves them when they change, and signs out when a refresh is refused.
 */

export type Tokens = {
  token: string;
  /** device sessions only */
  refreshToken: string | null;
  sessionId: string | null;
  /** when the access token runs out, on this phone's clock (from the token's own lifetime, so clock skew doesn't matter) */
  expiresAt: number | null;
};

/** What the API answers on login, signup, reset and refresh (device sessions add the refresh fields). */
export type TokenAnswer = { token: string; refreshToken?: string; sessionId?: string; accessTokenExpiresAt?: string | null };

let tokens: Tokens | null = null;
let persist: ((t: Tokens | null) => Promise<void>) | null = null;
let onRefused: ((message: string) => void) | null = null;
let refreshing: Promise<'ok' | 'offline' | 'refused'> | null = null;

export const getApiTokens = () => tokens;
export const setApiTokens = (t: Tokens | null) => {
  tokens = t;
};
/** auth.tsx: where to save rotated tokens, and what to do when the session can't be renewed. */
export function setSessionHandlers(h: { persist: (t: Tokens | null) => Promise<void>; refused: (message: string) => void } | null) {
  persist = h?.persist ?? null;
  onRefused = h?.refused ?? null;
}

/** Seconds a JWT is valid for (exp − iat), read from its payload. */
function lifetimeOf(jwt: string): number | null {
  try {
    const part = jwt.split('.')[1];
    const json = JSON.parse(fromUtf8(fromBase64url(part))) as { iat?: number; exp?: number };
    return json.exp && json.iat ? json.exp - json.iat : null;
  } catch {
    return null;
  }
}

/** Tokens from an API answer; a password change answers without a refresh token, so the current one is kept. */
export function tokensFrom(a: TokenAnswer, keep: Tokens | null = null): Tokens {
  const life = lifetimeOf(a.token);
  return {
    token: a.token,
    refreshToken: a.refreshToken ?? (a.sessionId && keep?.sessionId === a.sessionId ? keep.refreshToken : null),
    sessionId: a.sessionId ?? null,
    expiresAt: life ? Date.now() + life * 1000 : null,
  };
}

/** Lets an in-flight refresh finish (sign-out waits for it, so it logs out with the newest refresh token). */
export const settleRefresh = async () => {
  if (refreshing) await refreshing.catch(() => undefined);
};

/** Swaps the refresh token for new tokens. One at a time: a second caller gets the same promise. */
export function refreshSession(): Promise<'ok' | 'offline' | 'refused'> {
  if (refreshing) return refreshing;
  const rt = tokens?.refreshToken;
  if (!rt) return Promise.resolve('refused');
  refreshing = (async () => {
    let answer: TokenAnswer;
    try {
      answer = await send<TokenAnswer>('/auth/refresh', { body: { refreshToken: rt } }, null);
    } catch (e) {
      // A 401 (REFRESH_INVALID, _EXPIRED, _REVOKED, _REUSED, ACCOUNT_SUSPENDED) ends the session; anything else
      // (offline, rate limit, a server error) is temporary: keep the session and try again later.
      if (e instanceof ApiError && e.status === 401) {
        if (tokens?.refreshToken === rt) {
          tokens = null;
          onRefused?.(e.message);
        }
        return 'refused';
      }
      return 'offline';
    }
    // Signed out (or signed in again) while this was in flight: don't bring the old session back.
    if (tokens?.refreshToken !== rt) return 'ok';
    tokens = tokensFrom(answer, tokens);
    await persist?.(tokens);
    return 'ok';
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Refresh this long before the access token runs out. */
const MARGIN_MS = 2 * 60_000;

type Opts = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** false: send no token and never refresh (sign-in, refresh, logout) */
  auth?: boolean;
};

/** Calls the API. Throws ApiError with the API's own (human-readable) message on failure. */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  if (opts.auth === false) return send<T>(path, opts, null);
  // Running out soon (or a refresh is already happening): wait for fresh tokens first.
  if (refreshing || (tokens?.refreshToken && tokens.expiresAt !== null && tokens.expiresAt - Date.now() < MARGIN_MS)) await refreshSession();
  const sent = tokens?.token ?? null;
  try {
    return await send<T>(path, opts, sent);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !sent) throw e;
    if (!tokens?.refreshToken) {
      // A website-style token (or none left): the session is over.
      if (tokens?.token === sent) {
        tokens = null;
        onRefused?.(e.message);
      }
      throw e;
    }
    // Another request may already have refreshed; otherwise refresh now. Then try once more.
    if (tokens.token === sent) {
      const r = await refreshSession();
      if (r !== 'ok') throw e;
    }
    const next = tokens?.token;
    if (!next || next === sent) throw e;
    return send<T>(path, opts, next);
  }
}

async function send<T>(path: string, opts: Opts, bearer: string | null): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  const abort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', abort);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ApiError('We can’t reach Eventro right now. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw toError(res.status, data);
  return data as T;
}

/** Nest wraps object errors as { message: { message, errors } }; validation errors come as an array. */
function toError(status: number, data: unknown) {
  const body = data as { message?: string | string[] | { message?: string; errors?: string[] }; errors?: string[]; code?: string } | null;
  const raw = body?.message;
  const nested = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const m = nested ? nested.message : (raw as string | string[] | undefined);
  const details = nested?.errors ?? body?.errors;
  const fallback =
    status === 429 ? 'Too many tries. Wait a minute and try again.' : status >= 500 ? 'Eventro had a problem. Please try again in a moment.' : `Something went wrong (${status}).`;
  // Validation errors list every problem: the first one reads best (fix it, and the next shows up).
  const base = Array.isArray(m) ? (m[0] ? sentence(m[0]) : fallback) : m ? sentence(m) : fallback;
  // Some answers repeat the message as the first of their `errors`.
  const extra = (details ?? []).filter((d) => sentence(d) !== base).slice(0, 3);
  const message = extra.length ? `${base} ${extra.join(' ')}` : base;
  return new ApiError(message, status, typeof body?.code === 'string' ? body.code : undefined, data);
}

/** class-validator messages ("email must be an email") read better capitalised with a full stop. */
const sentence = (s: string) => {
  const t = s.trim();
  if (!t) return t;
  const c = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
};

/** Text for an error shown to people. */
export const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null | false>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
