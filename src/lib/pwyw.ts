/**
 * Pay what you want (PWYW): the fan picks the price of each ticket, between the organizer's minimum and maximum.
 *
 * Every amount here is a BASE amount, like an organizer's fixed price: in BUYER fee mode the fan pays Omoshow's fee on
 * top (all-in = amount + fee), in ORGANIZER mode the fan pays just the amount and the fee comes out of it. The fan's
 * amount goes on POST /holds as `amountCents` (everyone in the order pays the same amount per ticket), and can be
 * changed at checkout (`amountCents` on /quote and /orders); the API checks it again each time.
 *
 * Promo codes don't apply to PWYW tickets (the fan already chose the price). A PWYW ticket bought for more than $0 is
 * covered by the Omoshow Guarantee like any paid ticket; a $0 one is a free ticket and isn't.
 */
import { money } from './format';
import { moneyInput, parseMoney, type OrgTicketType } from './organizer';
import type { FeeMode, Pwyw } from './types';

/** The API's ceiling when the organizer sets no maximum (PWYW_CEILING). */
export const PWYW_CEILING = 10_000_000;
/** Quick-pick amounts an organizer can offer (the API's limit). */
export const QUICK_PICKS_MAX = 4;

export const PROMO_PWYW_NOTE = 'Promo codes don’t apply to pay-what-you-want tickets.';

/** A ticket type the fan prices (with what the API sent to price it). */
export const isPwyw = <T extends { pricing?: string; pwyw?: Pwyw | null }>(t: T | null | undefined): t is T & { pwyw: Pwyw } => !!t && t.pricing === 'PWYW' && !!t.pwyw;

/** What the fan pays per ticket for a base amount: the API's buyerPrice with the fee the fan pays (0 when absorbed). */
export const allInOf = (base: number, feePermille: number) => (base <= 0 ? 0 : Math.round((base * (1000 + feePermille)) / 1000));

/** The amount picked to start with: the organizer's suggestion, else the minimum. */
export const startAmount = (p: Pwyw) => Math.min(p.maxCents, Math.max(p.minCents, p.suggestedCents ?? p.minCents));

/** The amounts to offer as chips: the quick picks, with the suggestion among them, smallest first. */
export function pickChips(p: Pwyw) {
  const set = new Set(p.quickPicks.filter((c) => c >= p.minCents && c <= p.maxCents));
  if (p.suggestedCents !== null) set.add(p.suggestedCents);
  if (!set.size) set.add(p.minCents);
  return [...set].sort((a, b) => a - b);
}

/** Why the fan's amount can't be used (null when it can), worded like the API's own refusals. */
export function amountProblem(cents: number | null, p: Pwyw, currency: string): string | null {
  if (cents === null) return 'Enter an amount, like 10 or 12.50.';
  if (cents < p.minCents) return `The minimum is ${money(p.minCents, currency, { decimals: p.minCents % 100 !== 0 })}.`;
  if (cents > p.maxCents) return `The most you can pay is ${money(p.maxCents, currency)}.`;
  return null;
}

/** "From $5.18" for a PWYW tier's price slot, or "Any amount" when it can be free. */
export const fromLabel = (p: Pwyw, currency: string) => (p.minCents > 0 ? `From ${money(allInOf(p.minCents, p.feePermille), currency)}` : 'Any amount');

/** The all-in line under the fan's amount: "$10 + $0.35 Omoshow fee = $10.35 per ticket", or just the amount. */
export function allInLine(base: number, p: Pwyw, currency: string) {
  const all = allInOf(base, p.feePermille);
  if (base <= 0) return 'Free: nothing to pay for this ticket.';
  if (all === base) return `${money(base, currency, { decimals: base % 100 !== 0 })} per ticket, all-in.`;
  return `${money(base, currency, { decimals: base % 100 !== 0 })} + ${money(all - base, currency, { decimals: true })} Omoshow fee = ${money(all, currency, { decimals: true })} per ticket, all-in.`;
}

/* ---------- the organizer's side ---------- */

/** A PWYW tier as typed in Create and Edit: amounts as text (base amounts), quick picks as cents. */
export type PwywDraft = { min: string; suggested: string; max: string; picks: number[] };
export const NO_PWYW: PwywDraft = { min: '', suggested: '', max: '', picks: [] };

/** The draft for a saved ticket type (empty fields where nothing is set). */
export function pwywDraftOf(t: Pick<OrgTicketType, 'pwywMinCents' | 'pwywSuggestedCents' | 'pwywMaxCents' | 'pwywQuickPicks'>): PwywDraft {
  const max = t.pwywMaxCents ?? null;
  return {
    min: t.pwywMinCents !== null && t.pwywMinCents !== undefined ? moneyInput(t.pwywMinCents) : '',
    suggested: t.pwywSuggestedCents !== null && t.pwywSuggestedCents !== undefined ? moneyInput(t.pwywSuggestedCents) : '',
    max: max !== null && max < PWYW_CEILING ? moneyInput(max) : '',
    picks: [...(t.pwywQuickPicks ?? [])],
  };
}

/** The API's fields for a draft that passed pwywErrors. */
export function pwywBody(d: PwywDraft) {
  const min = parseMoney(d.min) ?? 0;
  const suggested = d.suggested.trim() ? parseMoney(d.suggested) : null;
  const max = d.max.trim() ? parseMoney(d.max) : null;
  return { pricing: 'PWYW' as const, pwywMinCents: min, pwywSuggestedCents: suggested, pwywMaxCents: max, pwywQuickPicks: [...new Set(d.picks)].sort((a, b) => a - b) };
}

/** The same checks as the API (min ≥ 0, min ≤ suggested ≤ max, picks within them), keyed `${key}-min` and so on. */
export function pwywErrors(d: PwywDraft, key: string, currency: string): Record<string, string> {
  const e: Record<string, string> = {};
  const min = parseMoney(d.min);
  const suggested = d.suggested.trim() ? parseMoney(d.suggested) : null;
  const max = d.max.trim() ? parseMoney(d.max) : null;
  if (min === null) e[`${key}-min`] = 'Enter a minimum (0 lets fans pay nothing).';
  if (d.suggested.trim() && suggested === null) e[`${key}-suggested`] = 'Enter an amount, or leave it empty.';
  if (d.max.trim() && max === null) e[`${key}-max`] = 'Enter an amount, or leave it empty for no maximum.';
  const lo = min ?? 0;
  const hi = max ?? PWYW_CEILING;
  if (max !== null && max > PWYW_CEILING) e[`${key}-max`] = `At most ${money(PWYW_CEILING, currency)}.`;
  else if (max !== null && min !== null && max < min) e[`${key}-max`] = 'The maximum can’t be below the minimum.';
  if (suggested !== null && (suggested < lo || suggested > hi)) e[`${key}-suggested`] = 'The suggested price has to be between the minimum and the maximum.';
  if (d.picks.length > QUICK_PICKS_MAX) e[`${key}-picks`] = `Up to ${QUICK_PICKS_MAX} quick picks.`;
  else if (d.picks.some((c) => c < lo || c > hi)) e[`${key}-picks`] = 'Each quick pick has to be between the minimum and the maximum.';
  return e;
}

/** What fans see for the organizer's draft: "Fans pick from $5 (all-in $5.18)". */
export function pwywSummary(d: PwywDraft, feeMode: FeeMode, feePermille: number, currency: string) {
  const min = parseMoney(d.min);
  if (min === null) return '';
  const max = d.max.trim() ? parseMoney(d.max) : null;
  const suggested = d.suggested.trim() ? parseMoney(d.suggested) : null;
  const fee = feeMode === 'BUYER' ? feePermille : 0;
  const range = max !== null ? `${money(min, currency)} to ${money(max, currency)}` : min > 0 ? `${money(min, currency)} or more` : 'any amount, free included';
  const start = suggested !== null ? ` Suggested: ${money(suggested, currency)}${fee ? ` (fans pay ${money(allInOf(suggested, fee), currency)} all-in)` : ''}.` : '';
  const who = fee ? ' Omoshow’s fee is added on top of what they pick.' : ' The fee comes out of what they pick.';
  return `Fans choose ${range}.${start}${who}`;
}
