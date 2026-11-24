/**
 * Card payments with Stripe's PaymentSheet (@stripe/stripe-react-native, included in Expo Go).
 * Needs EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (a pk_test_… key in development). stripe-sheet.ts is the web stand-in.
 */
import { initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import { colors } from '@/theme';

const KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** Whether the in-app card sheet can be used here (a publishable key is set). */
export const stripeSheetAvailable = KEY.startsWith('pk_');

let ready: Promise<void> | null = null;

/** Shows Stripe's card sheet for the order's PaymentIntent. Resolves 'paid' or 'cancelled'; throws with Stripe's message on failure. */
export async function payWithStripeSheet(clientSecret: string): Promise<'paid' | 'cancelled'> {
  // Expo's Stripe guide: in Expo Go the redirect scheme needs the "/--/" form of the dev URL.
  const urlScheme = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? Linking.createURL('/--/') : Linking.createURL('');
  ready ??= initStripe({ publishableKey: KEY, urlScheme }).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  const init = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'Eventro',
    returnURL: Linking.createURL('stripe-redirect'),
    style: 'alwaysDark',
    appearance: {
      colors: { primary: colors.accent, background: colors.bg, componentBackground: colors.surface, componentBorder: colors.surface2, primaryText: colors.text, secondaryText: colors.muted, placeholderText: colors.dim, icon: colors.muted },
      shapes: { borderRadius: 14 },
      primaryButton: { colors: { background: colors.accent, text: '#ffffff' }, shapes: { borderRadius: 999 } },
    },
  });
  if (init.error) throw new Error(init.error.message);
  const res = await presentPaymentSheet();
  if (res.error) {
    if (res.error.code === 'Canceled') return 'cancelled';
    throw new Error(res.error.message);
  }
  return 'paid';
}
