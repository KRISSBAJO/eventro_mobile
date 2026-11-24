/**
 * Client for the Eventro API (the eventro-be repo).
 *
 * EXPO_PUBLIC_API_URL sets the base URL (see .env.example). On a phone it must be the computer's LAN address,
 * e.g. http://192.168.1.20:4000/api/v1, because 127.0.0.1 on the phone is the phone itself.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');

/** The website, for help pages, legal pages and the browser checkout fallback. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'http://127.0.0.1:3500').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the API couldn't be reached at all */
    readonly status: number,
    /** a machine-readable reason some endpoints add, e.g. RESET_EXPIRED */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;

/* The session token lives in memory here; auth.tsx loads and saves it. */
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setApiToken = (t: string | null) => {
  token = t;
};
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

type Opts = { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number };

/** Calls the API. Throws ApiError with the API's own (human-readable) message on failure. */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const sent = token;
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
        ...(sent ? { authorization: `Bearer ${sent}` } : {}),
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
  if (!res.ok) {
    if (res.status === 401 && sent) onUnauthorized?.();
    throw toError(res.status, data);
  }
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
  const base = Array.isArray(m) ? m.map(sentence).join(' ') : m ? sentence(m) : fallback;
  const message = details?.length ? `${base} ${details.slice(0, 3).join(' ')}` : base;
  return new ApiError(message, status, typeof body?.code === 'string' ? body.code : undefined);
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
