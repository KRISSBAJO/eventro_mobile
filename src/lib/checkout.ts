/** What both checkouts (a seat hold and a fan-resale hold) share for taking the payment. */
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { colors } from '@/theme';
import { PAYSTACK } from './format';
import type { Health, OrderCreated } from './types';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The website's return page sends app buyers here once their payment is confirmed (eventro://tickets). */
export const APP_RETURN = 'eventro://';
export const NATIVE = Platform.OS !== 'web';

/**
 * Paystack's payment page. On a phone it's an auth session that closes by itself when the website hands back to
 * eventro://; the web build (no app to return to) just opens it.
 */
export const openPaystack = (url: string) =>
  NATIVE
    ? WebBrowser.openAuthSessionAsync(url, APP_RETURN, { toolbarColor: colors.bg, controlsColor: colors.accent, dismissButtonStyle: 'close' })
    : WebBrowser.openBrowserAsync(url, { toolbarColor: colors.bg, controlsColor: colors.accent, dismissButtonStyle: 'close' });

/** Naira, cedi, shilling and rand go through Paystack; other currencies through Stripe. Without keys: test mode. */
export const providerFor = (currency: string, health: Health | undefined): OrderCreated['provider'] =>
  PAYSTACK.has(currency) ? (health?.paystack ? 'paystack' : 'mock') : health?.stripe ? 'stripe' : 'mock';
