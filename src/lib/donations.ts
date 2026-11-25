/**
 * Charity donations at checkout. An organizer turns them on per event and names the cause; fans can add a donation to
 * any order (free tickets too). No Eventro fee is taken on a donation and ticket protection doesn't cover it. Eventro
 * collects it with the order and pays it out to the organizer, separately from ticket sales; the organizer passes it
 * to the cause. The Eventro Guarantee never refunds a donation (a claim refunds the ticket only); a cancelled event
 * refunds the whole order, the donation included.
 */
import { money } from './format';
import { moneyInput, parseMoney, type DonationSettings } from './organizer';

export const DONATION_MAX = 10_000_000;
export const CAUSE_MIN = 2;
export const CAUSE_MAX = 80;
export const DONATION_DESCRIPTION_MAX = 280;
export const DONATION_SUGGESTIONS_MAX = 4;

/** Near the donation picker at checkout (the API's required wording). */
export const DONATION_NO_REFUND = 'Donations go to the cause and aren’t refunded if a ticket doesn’t scan.';
/** At checkout, in the organizer's settings and on payouts. */
export const DONATION_ON_BEHALF = 'Eventro collects donations on the organizer’s behalf; the organizer is responsible for passing them to the cause.';

export const donationLabel = (cause: string | null | undefined) => (cause ? `Donation to ${cause}` : 'Donation');

/** Why a donation amount can't be used (null when it can; 0 is "no donation"). */
export function donationProblem(cents: number | null, d: { minCents: number | null; maxCents: number }, currency: string): string | null {
  if (cents === null) return 'Enter an amount, like 5 or 7.50.';
  if (cents === 0) return null;
  if (d.minCents !== null && cents < d.minCents) return `The smallest donation is ${money(d.minCents, currency, { decimals: d.minCents % 100 !== 0 })}.`;
  if (cents > d.maxCents) return `The most you can donate is ${money(d.maxCents, currency)}.`;
  return null;
}

/* ---------- the organizer's settings ---------- */

export type DonationDraft = { on: boolean; cause: string; description: string; suggested: number[]; min: string };
export const NO_DONATIONS: DonationDraft = { on: false, cause: '', description: '', suggested: [], min: '' };

export function donationDraftOf(e: DonationSettings): DonationDraft {
  return {
    on: !!e.donationsEnabled,
    cause: e.donationCause ?? '',
    description: e.donationDescription ?? '',
    suggested: [...(e.donationSuggestedCents ?? [])],
    min: e.donationMinCents ? moneyInput(e.donationMinCents) : '',
  };
}

/** The same checks as the API: a cause of 2–80 characters when on, up to 4 suggestions, each at least the minimum. */
export function donationErrors(d: DonationDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.on) return e;
  const cause = d.cause.trim();
  if (cause.length < CAUSE_MIN) e.cause = 'Name the cause the donations go to.';
  else if (cause.length > CAUSE_MAX) e.cause = `Keep it to ${CAUSE_MAX} characters.`;
  if (d.description.trim().length > DONATION_DESCRIPTION_MAX) e.description = `Keep it to ${DONATION_DESCRIPTION_MAX} characters.`;
  const min = d.min.trim() ? parseMoney(d.min) : null;
  if (d.min.trim() && (min === null || min < 1)) e.min = 'Enter an amount, or leave it empty for no minimum.';
  if (d.suggested.length > DONATION_SUGGESTIONS_MAX) e.suggested = `Up to ${DONATION_SUGGESTIONS_MAX} suggested amounts.`;
  else if (min !== null && d.suggested.some((c) => c < min)) e.suggested = 'Each suggested amount has to be at least the minimum.';
  return e;
}

/** The API's fields (off: just `donationsEnabled: false`, so the cause is kept for next time). */
export function donationBody(d: DonationDraft): DonationSettings {
  if (!d.on) return { donationsEnabled: false };
  const min = d.min.trim() ? parseMoney(d.min) : null;
  return {
    donationsEnabled: true,
    donationCause: d.cause.trim(),
    donationDescription: d.description.trim() || null,
    donationSuggestedCents: [...new Set(d.suggested)].sort((a, b) => a - b),
    donationMinCents: min,
  };
}

/** The fields that changed against what's saved (empty when nothing did). */
export function donationChanges(d: DonationDraft, saved: DonationSettings): DonationSettings {
  const was = donationBody(donationDraftOf(saved));
  const now = donationBody(d);
  if (!now.donationsEnabled) return was.donationsEnabled ? { donationsEnabled: false } : {};
  return JSON.stringify(now) === JSON.stringify(was) ? {} : now;
}
