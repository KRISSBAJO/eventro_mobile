/**
 * The Eventro Guarantee (the scan guarantee): if a ticket doesn't scan at the door, its holder gets that ticket's
 * money back, all-in (its share of what was paid for the order, fees included), to the original payment method.
 *
 * It covers every ticket from a paid order, fan resale tickets and tickets transferred or gifted on included. A
 * pay-what-you-want ticket bought for more than $0 is covered too, and a claim refunds what was paid for it. Free
 * tickets ($0 pay what you want included: notCovered FREE), comps (COMP) and $0 orders aren't covered: there's
 * nothing to refund. A donation added at checkout is never part of a claim. Cancelled events are refunded in full with
 * the event instead, donations included.
 *
 * Claims go to POST /tickets/:id/guarantee-claims, one per ticket by its current holder, from 3 hours before the event
 * starts until 48 hours after it ends. The server declines a claim at once when the door's scan log shows the ticket
 * was scanned in; everything else is reviewed by the Eventro team within 24 hours. Nothing is approved automatically.
 *
 * No signal at the door: a claim that can't reach the API is saved on this phone (the encrypted vault, per account)
 * and <GuaranteeSync /> sends it when the app comes back to the foreground, when the wallet reaches the API again,
 * every 30 seconds while something is waiting, and (web) when the browser goes back online. It still goes through
 * every server check: the window is checked when the server receives it, and a refusal is kept so the claim screen
 * can show the server's own message.
 */
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { colors } from '@/theme';
import { api, ApiError, WEB_URL } from './api';
import { useAuth } from './auth';
import { localStamp, money } from './format';
import { haptic } from './haptics';
import type { GuaranteeAnswer, GuaranteeClaim, GuaranteeReason, Ticket, TicketGuarantee } from './types';
import { readVault, writeVault } from './vault';

export const REASONS: { id: GuaranteeReason; label: string }[] = [
  { id: 'DID_NOT_SCAN', label: 'It didn’t scan' },
  { id: 'TURNED_AWAY', label: 'I was turned away' },
  { id: 'OTHER', label: 'Something else' },
];
export const reasonLabel = (r: GuaranteeReason) => REASONS.find((x) => x.id === r)?.label ?? 'Something else';

/** The API's limit for a claim's details. */
export const DETAILS_MAX = 1000;

/* ---------- copy ---------- */

/** The guarantee's one name, everywhere (resale tickets too). */
export const GUARANTEE_NAME = 'Eventro Guarantee';
/** The badge on a covered ticket. */
export const COVERED_LABEL = `Covered by the ${GUARANTEE_NAME}`;
/** The muted note on a free ticket ($0 pay what you want too), where the guarantee would otherwise show. */
export const FREE_NOTE = `Free ticket: not covered by the ${GUARANTEE_NAME}, as there’s nothing to refund.`;
/** The same for a comp. */
export const COMP_NOTE = `Complimentary ticket: not covered by the ${GUARANTEE_NAME}, as nothing was paid for it.`;
/** On the claim screen: a donation isn't part of a claim. */
export const DONATION_NOT_COVERED = 'A donation added at checkout isn’t part of a claim: donations go to the cause and aren’t refunded if a ticket doesn’t scan.';
/** How long a refund takes to arrive. Never promise automatic or instant refunds. */
export const REFUND_TIMING = 'Usually 5–10 business days to your card; bank transfer and USSD refunds through Paystack can take longer.';
/** How a claim is decided (the server: declined on arrival if scanned in, otherwise reviewed). */
export const HOW_DECIDED =
  'If the door’s scan log shows this ticket was scanned in, the claim is declined automatically. Otherwise our team reviews what the door recorded and gets back to you within 24 hours.';

/** The guarantee's terms on the website. */
export const GUARANTEE_TERMS_URL = `${WEB_URL}/guarantee#terms`;

export function openGuaranteeTerms() {
  haptic.select();
  void WebBrowser.openBrowserAsync(GUARANTEE_TERMS_URL, { toolbarColor: colors.bg, controlsColor: colors.accent }).catch(() => undefined);
}

/** Covered by the guarantee (a saved copy from an older app version without the block counts as unknown: no). */
export const isCovered = (t: Pick<Ticket, 'guarantee'>) => t.guarantee?.covered === true;
/** A free ticket (or $0 order, $0 pay what you want included): not covered, as there's nothing to refund. */
export const isFree = (t: Pick<Ticket, 'guarantee'>) => t.guarantee?.covered === false && t.guarantee.notCovered === 'FREE';
/** A complimentary ticket from the organizer (the order says so even in a saved copy without the guarantee block). */
export const isComp = (t: Pick<Ticket, 'guarantee' | 'order'>) => t.guarantee?.notCovered === 'COMP' || t.order.kind === 'COMP';

/* ---------- the API ---------- */

const path = (ticketId: string) => `/tickets/${encodeURIComponent(ticketId)}/guarantee-claims`;

/** Sends a claim; the answer may already be DECLINED (scanned in), otherwise PENDING. Throws ApiError (status 0 offline). */
export const submitClaim = (ticketId: string, body: { reason: GuaranteeReason; details?: string }) => api<GuaranteeClaim>(path(ticketId), { body, timeoutMs: 15_000 });

/** The ticket's guarantee and claim (holder only). */
export const fetchClaim = (ticketId: string) => api<GuaranteeAnswer>(path(ticketId));

/* ---------- the claim window ---------- */

export type WindowState = 'before' | 'open' | 'closed';

/**
 * Where the ticket is in its claim window on this phone's clock (the window's times are real instants). This is the
 * API's `open` worked out now, so a wallet saved before the window opened still works at the door with no signal.
 */
export function windowOf(g: Pick<TicketGuarantee, 'opensAt' | 'closesAt'>, now: number): WindowState {
  const opens = Date.parse(g.opensAt);
  const closes = Date.parse(g.closesAt);
  if (Number.isFinite(opens) && now < opens) return 'before';
  if (Number.isFinite(closes) && now > closes) return 'closed';
  return 'open';
}

/** "Sat, Nov 28, 9:41 PM" on this phone's clock. */
export const stamp = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? localStamp(Date.parse(iso)) : '');

/**
 * Why this ticket can't be claimed on right now, or null when it can (the server checks all of this again): it has to
 * be covered, inside its window and without a claim. Mirrors the API's refusals: free tickets, cancelled or refunded
 * orders, cancelled events, tickets being transferred or listed, and VOID tickets. A scanned-in ticket can still
 * claim (e.g. turned away after the scan); the server declines it and the claim screen says so up front.
 */
export function claimBlocker(t: Ticket, now: number): string | null {
  const g = t.guarantee;
  if (!g) return 'We couldn’t check this ticket’s cover. Refresh your tickets and try again.';
  if (g.claim) return 'There’s already a claim for this ticket.';
  if (t.event.status === 'CANCELLED') return 'This event was cancelled, so the ticket is refunded in full with the event.';
  if (!g.covered && g.notCovered === 'FREE') return 'This ticket was free, so there’s nothing to refund. The Eventro Guarantee covers paid tickets.';
  if (!g.covered && g.notCovered === 'COMP') return 'This is a complimentary ticket from the organizer, so there’s nothing to refund. The Eventro Guarantee covers paid tickets.';
  if (!g.covered || t.order.status === 'REFUNDED' || t.order.status === 'CANCELLED') return 'This order was cancelled or refunded.';
  if (t.status === 'VOID') return 'This ticket no longer works.';
  if (t.status === 'LISTED') return 'This ticket is listed for resale. Remove the listing to claim on it.';
  if (t.status === 'TRANSFER_PENDING') return 'This ticket is being transferred. Cancel the transfer to claim on it.';
  const w = windowOf(g, now);
  if (w === 'before') return `Claims open 3 hours before the event starts: from ${stamp(g.opensAt)}.`;
  if (w === 'closed') return `The claim window closed ${stamp(g.closesAt)}.`;
  return null;
}

/** A short status for the wallet list. */
export function claimShort(c: GuaranteeClaim) {
  if (c.status === 'APPROVED') return c.refundStatus === 'REFUNDED' ? `Refunded · ${GUARANTEE_NAME}` : `Refund approved · ${GUARANTEE_NAME}`;
  if (c.status === 'DECLINED') return 'Guarantee claim declined';
  return 'Guarantee claim in review';
}

/** How a claim reads: tone, icon, title (the amount for approvals) and a line about the refund. */
export function claimView(c: GuaranteeClaim): { tone: 'success' | 'warning' | 'plain' | 'accent'; icon: 'check' | 'clock' | 'close' | 'alert'; title: string; extra: string } {
  if (c.status === 'APPROVED') {
    const amount = money(c.amountCents, c.currency, { decimals: true });
    if (c.refundStatus === 'REFUNDED') return { tone: 'success', icon: 'check', title: `Refunded · ${amount}`, extra: c.refundedAt ? `Sent ${stamp(c.refundedAt)}. ${REFUND_TIMING}` : REFUND_TIMING };
    if (c.refundStatus === 'FAILED') return { tone: 'accent', icon: 'alert', title: `Refund approved · ${amount}`, extra: 'The refund didn’t go through yet. We’re on it and will email you.' };
    return { tone: 'success', icon: 'check', title: `Refund approved · ${amount}`, extra: REFUND_TIMING };
  }
  if (c.status === 'DECLINED') return { tone: 'plain', icon: 'close', title: 'Claim declined', extra: '' };
  return { tone: 'warning', icon: 'clock', title: 'Claim received', extra: '' };
}

/* ---------- claims waiting on this phone ---------- */

export type QueuedClaim = { ticketId: string; reason: GuaranteeReason; details: string | null; queuedAt: string };

/** What happened to a claim sent from the queue: the server's claim, or its refusal. */
export type ClaimOutcome = { ticketId: string; at: string } & ({ kind: 'sent'; claim: GuaranteeClaim } | { kind: 'refused'; message: string; status: number });

type Saved = { queue: QueuedClaim[]; outcomes: ClaimOutcome[] };
type Store = Saved & { userId: string | null };

const vaultName = (userId: string) => `guarantee-${userId.replace(/[^\w-]/g, '_')}`;

let store: Store = { userId: null, queue: [], outcomes: [] };
let loading: { userId: string; done: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Reads this account's waiting claims once (a different account starts empty). */
function ensure(userId: string): Promise<void> {
  if (loading?.userId === userId) return loading.done;
  store = { userId, queue: [], outcomes: [] };
  emit();
  const done = readVault<Saved>(vaultName(userId)).then((s) => {
    if (store.userId !== userId) return;
    // Anything queued while the file was being read stays, after the saved ones.
    const saved = s?.queue ?? [];
    const ids = new Set(saved.map((q) => q.ticketId));
    store = { userId, queue: [...saved, ...store.queue.filter((q) => !ids.has(q.ticketId))], outcomes: [...store.outcomes, ...(s?.outcomes ?? [])].slice(0, 50) };
    emit();
  });
  loading = { userId, done };
  return done;
}

function update(userId: string, next: (s: Saved) => Saved) {
  if (store.userId !== userId) return;
  const s = next(store);
  store = { userId, queue: s.queue, outcomes: s.outcomes.slice(0, 50) };
  void writeVault(vaultName(userId), store.queue.length || store.outcomes.length ? { queue: store.queue, outcomes: store.outcomes } : null);
  emit();
}

/** Saves a claim to send when the API can be reached (one per ticket: a newer one replaces it). */
export async function queueClaim(userId: string, c: Omit<QueuedClaim, 'queuedAt'>) {
  await ensure(userId);
  update(userId, (s) => ({ queue: [...s.queue.filter((q) => q.ticketId !== c.ticketId), { ...c, queuedAt: new Date().toISOString() }], outcomes: s.outcomes.filter((o) => o.ticketId !== c.ticketId) }));
}

/** Takes a waiting claim back before it's sent. */
export const dropQueued = (userId: string, ticketId: string) => update(userId, (s) => ({ queue: s.queue.filter((q) => q.ticketId !== ticketId), outcomes: s.outcomes }));

/** Forgets what happened to an earlier claim (before trying again). */
export const clearOutcome = (userId: string, ticketId: string) => update(userId, (s) => ({ queue: s.queue, outcomes: s.outcomes.filter((o) => o.ticketId !== ticketId) }));

/** Claims waiting to be sent (sign-out warns before deleting them). */
export const pendingClaims = () => store.queue.length;

let flushing: Promise<{ sent: number; refused: number; waiting: number }> | null = null;

/**
 * Sends waiting claims, oldest first. A claim leaves the queue once the server has answered it: with a claim (201),
 * or a refusal (400/403/404/409/422, kept with its message). Unreachable, 401, 429 or a server error: it stays, and
 * the rest wait too.
 */
export function flushClaims(userId: string, changed?: () => void) {
  if (flushing) return flushing;
  flushing = (async () => {
    await ensure(userId);
    let sent = 0;
    let refused = 0;
    for (const q of [...store.queue]) {
      if (store.userId !== userId) break;
      try {
        const claim = await submitClaim(q.ticketId, { reason: q.reason, ...(q.details ? { details: q.details } : {}) });
        sent++;
        update(userId, (s) => ({ queue: s.queue.filter((x) => x.ticketId !== q.ticketId), outcomes: [{ ticketId: q.ticketId, at: new Date().toISOString(), kind: 'sent', claim }, ...s.outcomes.filter((o) => o.ticketId !== q.ticketId)] }));
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 0 || status === 401 || status === 429 || status >= 500) break;
        refused++;
        const message = e instanceof Error && e.message ? e.message : 'Eventro couldn’t accept this claim.';
        update(userId, (s) => ({ queue: s.queue.filter((x) => x.ticketId !== q.ticketId), outcomes: [{ ticketId: q.ticketId, at: new Date().toISOString(), kind: 'refused', message, status }, ...s.outcomes.filter((o) => o.ticketId !== q.ticketId)] }));
      }
    }
    if (sent || refused) changed?.();
    return { sent, refused, waiting: store.userId === userId ? store.queue.length : 0 };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** This account's waiting claim and last outcome for one ticket (re-renders when they change). */
export function useClaimQueue(userId: string | undefined, ticketId: string | undefined) {
  const s = useSyncExternalStore(subscribe, () => store, () => store);
  useEffect(() => {
    if (userId) void ensure(userId);
  }, [userId]);
  const mine = !!userId && s.userId === userId;
  return {
    queued: mine && ticketId ? (s.queue.find((q) => q.ticketId === ticketId) ?? null) : null,
    outcome: mine && ticketId ? (s.outcomes.find((o) => o.ticketId === ticketId) ?? null) : null,
  };
}

/** Mounted once at the root: sends waiting claims whenever there's a chance the API can be reached. */
export function GuaranteeSync() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    let live = true;
    const changed = () => void qc.invalidateQueries({ queryKey: ['me', 'tickets'] });
    const run = () => {
      if (live && store.userId === uid && store.queue.length) void flushClaims(uid, changed);
    };
    void ensure(uid).then(run);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const timer = setInterval(run, 30_000);
    // The wallet just reached the API: so can a claim.
    const cache = qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'success' && e.query.queryKey[0] === 'me' && e.query.queryKey[1] === 'tickets') run();
    });
    const online = Platform.OS === 'web' && typeof window !== 'undefined' ? run : null;
    if (online) window.addEventListener('online', online);
    return () => {
      live = false;
      app.remove();
      clearInterval(timer);
      cache();
      if (online) window.removeEventListener('online', online);
    };
  }, [uid, qc]);
  return null;
}
