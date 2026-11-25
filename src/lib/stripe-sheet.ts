/**
 * Web stand-in for stripe-sheet.native.ts: Stripe's React Native SDK has no web version, so the browser build
 * finishes card payments on the website's checkout instead (see checkout/[holdId].tsx).
 */
export const stripeSheetAvailable = false;

export async function payWithStripeSheet(clientSecret: string): Promise<'paid' | 'cancelled'> {
  void clientSecret;
  throw new Error('Card payments open on the Omoshow website from the browser version of the app.');
}
