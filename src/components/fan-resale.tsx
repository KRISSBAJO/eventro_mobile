/**
 * "Fan resale" on the event screen, as on the website (eventro components/fan-resale.tsx): tickets other fans are
 * selling through Eventro (GET /events/:slug/resale, cheapest first). Buy holds the listing for 10 minutes
 * (POST /resale/:id/hold, with the token when signed in; guests can buy too) and opens the resale checkout with the
 * hold in memory (lib/resale-hold.ts), never in the route. The event screen hides it when nothing is listed.
 *
 * Card payments in the browser build have no in-app card sheet, so there Buy opens the website's fan resale instead
 * (a hold made here would hide the ticket from the website for 10 minutes).
 */
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorText, WEB_URL } from '@/lib/api';
import { providerFor } from '@/lib/checkout';
import { money } from '@/lib/format';
import { openGuaranteeTerms } from '@/lib/guarantee';
import { haptic } from '@/lib/haptics';
import { useHealth } from '@/lib/queries';
import { vsFace } from '@/lib/resale';
import { holdErrorText, holdFrom, liveHoldFor, saveResaleHold, seatText, type ResaleHold } from '@/lib/resale-hold';
import { stripeSheetAvailable } from '@/lib/stripe-sheet';
import type { ResaleHoldCreated, ResaleListing } from '@/lib/types';
import { colors, radius, space } from '@/theme';
import { Section } from './form-ui';
import { Icon } from './icons';
import { TierChip } from './tier-look';
import { Button, Notice, Txt } from './ui';

/**
 * The fan resale promise. A sale voids the seller's ticket and gives the buyer a new one (checkout.service fulfil);
 * like every paid ticket it's covered by the Eventro Guarantee, which refunds it in full if it doesn't scan
 * (guarantee.ts).
 */
export const RESALE_PROMISE = 'Sold by fans through Eventro. You get a new ticket with its own QR code, covered by the Eventro Guarantee: if it doesn’t scan at the door, you get your money back, fees included.';

/** " Guarantee terms" as a link inside the promise's text (the website's /guarantee#terms). */
export function GuaranteeTermsLink() {
  return (
    <>
      {' '}
      <Txt variant="smallStrong" color={colors.accent} accessibilityRole="link" onPress={openGuaranteeTerms}>
        Guarantee terms
      </Txt>
    </>
  );
}

/** Listings shown before "Show all". */
const SHOWN = 4;

/** "12% above face value" as a small pill: amber above, green below, plain at face value. */
export function FacePill({ priceCents, faceCents }: { priceCents: number; faceCents: number }) {
  const v = vsFace(priceCents, faceCents);
  const tone = v.pct > 0 ? styles.faceUp : v.pct < 0 ? styles.faceDown : styles.faceEven;
  const fg = v.pct > 0 ? '#f5d08a' : v.pct < 0 ? '#8be9bd' : colors.muted;
  return (
    <View style={[styles.face, tone]}>
      <Txt variant="tiny" color={fg} numberOfLines={1}>
        {v.text}
      </Txt>
    </View>
  );
}

export function FanResale({ slug, listings, refetch }: { slug: string; listings: ResaleListing[]; refetch: () => void }) {
  const health = useHealth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  // A ticket this buyer is still holding (they left checkout): its listing is hidden from everyone, them included.
  const [held, setHeld] = useState<ResaleHold | null>(null);
  useFocusEffect(
    useCallback(() => {
      setHeld(liveHoldFor(slug, Date.now()));
    }, [slug]),
  );

  if (!listings.length && !held) return null;
  const shown = all ? listings : listings.slice(0, SHOWN);
  const cheapest = listings[0];
  // Stripe without the in-app card sheet (the browser build): the website takes the card.
  const onWebsite = (currency: string) => providerFor(currency, health.data) === 'stripe' && !stripeSheetAvailable;

  const buy = async (l: ResaleListing) => {
    setError('');
    if (onWebsite(l.currency)) {
      haptic.tap();
      void WebBrowser.openBrowserAsync(`${WEB_URL}/events/${encodeURIComponent(slug)}#resale`, { toolbarColor: colors.bg, controlsColor: colors.accent });
      return;
    }
    setBusy(l.id);
    try {
      const h = await api<ResaleHoldCreated>(`/resale/${encodeURIComponent(l.id)}/hold`, { method: 'POST' });
      saveResaleHold(holdFrom(h, l, slug));
      haptic.success();
      // The held listing drops out of the list for everyone else.
      refetch();
      router.push({ pathname: '/checkout/resale/[listingId]', params: { listingId: h.listingId } });
    } catch (e) {
      haptic.error();
      setError(holdErrorText(errorText(e)));
      refetch();
    } finally {
      setBusy('');
    }
  };

  return (
    <Section
      icon="shield"
      title="Fan resale"
      sub="Tickets from fans who can’t make it, at prices the organizer allows."
      right={
        cheapest ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Txt variant="tiny" color={colors.dim}>
              {listings.length === 1 ? '1 ticket' : `${listings.length} tickets`}
            </Txt>
            <Txt variant="smallStrong">from {money(cheapest.priceCents, cheapest.currency)}</Txt>
          </View>
        ) : undefined
      }>
      {held ? (
        <Notice tone="accent" icon="clock" title="You’re holding a ticket" action="Continue checkout" onAction={() => router.push({ pathname: '/checkout/resale/[listingId]', params: { listingId: held.listingId } })}>
          {`${held.ticketType.name} · ${seatText(held, 'No reserved seat')}. It’s yours until the timer runs out.`}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="warning" icon="alert">
          {error}
        </Notice>
      ) : null}

      <View style={{ gap: space.sm }}>
        {shown.map((l) => (
          <View key={l.id} style={styles.row}>
            <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
              <TierChip tier={l.ticketType} />
              <Txt variant="bodyStrong" numberOfLines={2}>
                {seatText(l, 'No reserved seat')}
              </Txt>
              <FacePill priceCents={l.priceCents} faceCents={l.faceCents} />
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt variant="price">{money(l.priceCents, l.currency)}</Txt>
                <Txt variant="tiny" color={colors.dim}>
                  {l.faceCents !== l.priceCents ? `face ${money(l.faceCents, l.currency)}` : 'all-in'}
                </Txt>
              </View>
              <Button
                label="Buy"
                size="sm"
                loading={busy === l.id}
                disabled={!!busy}
                onPress={() => void buy(l)}
                accessibilityLabel={`Buy ${l.ticketType.name}, ${seatText(l, 'no reserved seat')}, for ${money(l.priceCents, l.currency)}`}
                style={{ minWidth: 72 }}
              />
            </View>
          </View>
        ))}
      </View>

      {listings.length > SHOWN ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: all }} onPress={() => setAll((v) => !v)} hitSlop={8} style={{ alignSelf: 'center' }}>
          <Txt variant="smallStrong" color={colors.accent}>
            {all ? 'Show fewer' : `Show all ${listings.length} resale tickets`}
          </Txt>
        </Pressable>
      ) : null}

      <View style={styles.promise}>
        <Icon name="shield" size={16} color={colors.accent} />
        <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
          {RESALE_PROMISE}
          {cheapest && onWebsite(cheapest.currency) ? ' Card payments for resale finish on the Eventro website.' : ''}
          <GuaranteeTermsLink />
        </Txt>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, padding: space.md + 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  face: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  faceUp: { backgroundColor: 'rgba(245,185,61,0.08)', borderColor: 'rgba(245,185,61,0.3)' },
  faceDown: { backgroundColor: 'rgba(62,207,142,0.08)', borderColor: 'rgba(62,207,142,0.3)' },
  faceEven: { backgroundColor: colors.surface2, borderColor: colors.line2 },
  promise: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
});
