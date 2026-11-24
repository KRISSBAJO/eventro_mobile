/**
 * Rotating door codes made on the phone from a ticket's QR seed, exactly like the API (eventro-be src/domain/qr.ts):
 *
 *   window    = floor(unixTimeMs / 15000)
 *   signature = first 22 characters of base64url(HMAC-SHA256(key = base64url-decoded seed, message = "<ticketId>.<window>"))
 *   code      = "<ticketId>.<window>.<signature>"
 *
 * The fan's ticket screen uses `codeAt` (works with no signal); the door scanner uses `checkCode` against the seeds
 * in its offline door pack, accepting the current window and one either side like the API does.
 */
import { base64url, fromBase64url, hmacSha256, utf8 } from './hmac';

export const WINDOW_MS = 15_000;
const SIG_LENGTH = 22;

/** Seeds are decoded once and kept (a door pack can hold thousands). */
const keys = new Map<string, Uint8Array>();
function keyOf(seed: string) {
  let k = keys.get(seed);
  if (!k) {
    k = fromBase64url(seed);
    if (keys.size > 20_000) keys.clear();
    keys.set(seed, k);
  }
  return k;
}

export const signature = (seed: string, ticketId: string, window: number) => base64url(hmacSha256(keyOf(seed), utf8(`${ticketId}.${window}`))).slice(0, SIG_LENGTH);

/** The code to show at `now`, and how long until it changes. */
export function codeAt(seed: string, ticketId: string, now = Date.now()) {
  const window = Math.floor(now / WINDOW_MS);
  return { token: `${ticketId}.${window}.${signature(seed, ticketId, window)}`, window, expiresInMs: WINDOW_MS - (now % WINDOW_MS) };
}

export type ParsedCode = { ticketId: string; window: number; sig: string };

/** Splits a scanned code (or returns null if it isn't shaped like one). A bare ticket id is not a code. */
export function parseCode(raw: string): ParsedCode | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 3) return null;
  const [ticketId, w, sig] = parts;
  const window = Number(w);
  if (!ticketId || !w || !Number.isInteger(window) || !sig) return null;
  return { ticketId, window, sig };
}

/** Constant-time string compare (the scanner is the only one timing it, but it costs nothing). */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Checks a parsed code against a ticket's seed: the signature, then the window (±1, i.e. about 15–45 s). */
export function checkCode(p: ParsedCode, seed: string, now = Date.now()): 'ok' | 'bad-signature' | 'expired' {
  if (!same(signature(seed, p.ticketId, p.window), p.sig)) return 'bad-signature';
  return Math.abs(Math.floor(now / WINDOW_MS) - p.window) > 1 ? 'expired' : 'ok';
}
