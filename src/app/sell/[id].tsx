/**
 * Sell a ticket on fan resale (POST /tickets/:id/listing): price with presets, the organizer's cap, and a live
 * breakdown (Eventro's fee, the organizer's share, what you receive). Copy and rules match the website's sell sheet.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Icon } from '@/components/icons';
import { Button, Chip, Field, Notice, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { currencySymbol, money } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useEventResale, useMyTickets, useRefreshWallet } from '@/lib/queries';
import { blockers, breakdown, capCentsOf, fmt, pct, presets, RESALE_FEE_PERMILLE, rulesOf, vsFace } from '@/lib/resale';
import { seatLine, ticketCurrency } from '@/lib/tickets';
import type { Listed } from '@/lib/types';
import { colors, font, radius, space, scheme } from '@/theme';

export default function Sell() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const wallet = useMyTickets(user?.id);
  const refresh = useRefreshWallet();
  const t = wallet.data?.tickets.find((x) => x.id === id);
  const market = useEventResale(t?.event.slug);
  const [price, setPrice] = useState<string | null>(null);
  const [learnedCap, setLearnedCap] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Listed | null>(null);
  const [now] = useState(() => Date.now());

  if (!user || !t) {
    return (
      <AuthShell title="Sell ticket" icon="tag">
        <Notice tone="plain">{!user ? 'Sign in to sell a ticket.' : wallet.loading ? 'Loading your ticket…' : 'This ticket isn’t in your wallet any more.'}</Notice>
      </AuthShell>
    );
  }

  const currency = ticketCurrency(t);
  const faceCents = t.ticketType.priceCents;
  const feePermille = wallet.data?.resaleFeePermille ?? RESALE_FEE_PERMILLE;
  const rules = rulesOf(t.event, learnedCap);
  const all = blockers(t, rules, now);
  const blocked = t.status === 'ACTIVE' ? all.sell : 'Only active tickets can be listed.';
  const capCents = capCentsOf(faceCents, rules.capPercent);
  const value = price ?? String(faceCents / 100);
  const cents = Math.round((Number(value) || 0) * 100);
  const { fee, royalty, payout } = breakdown(cents, feePermille, rules.royaltyPermille);
  const overCap = capCents !== null && cents > capCents;
  const tooLow = cents < 100;
  const others = (market.data?.listings ?? []).filter((l) => l.ticketType.name === t.ticketType.name);
  const lowest = others.length ? Math.min(...others.map((l) => l.priceCents)) : null;

  if (done) {
    return (
      <AuthShell title={`Listed for ${fmt(done.listCents ?? cents, currency)}`} icon="check" subtitle="Fans can buy it from the event page now.">
        <Breakdown price={done.listCents ?? cents} fee={done.feeCents} royalty={done.royaltyCents} payout={done.payoutCents} currency={currency} feePermille={feePermille} exact />
        <Txt variant="small" color={colors.dim}>
          Your payout becomes available a day after the event starts, so buyers are protected, and then the Eventro team sends it. Track it in Sales & payouts. You can remove the listing any time before it sells.
        </Txt>
        <Button label="Done" onPress={() => router.back()} />
        <Button label="Sales & payouts" variant="ghost" onPress={() => router.replace('/resale')} />
      </AuthShell>
    );
  }

  if (blocked) {
    return (
      <AuthShell title="Sell ticket" icon="tag" subtitle={`${t.ticketType.name} · ${t.event.title}`}>
        <View style={styles.blocked}>
          <View style={styles.blockedIcon}>
            <Icon name="close" size={20} color={colors.muted} />
          </View>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            You can’t sell this ticket right now
          </Txt>
          <Txt variant="small" color={colors.muted} style={{ textAlign: 'center' }}>
            {blocked}
          </Txt>
        </View>
        {!all.transfer && t.status === 'ACTIVE' ? <Button label="Send it to a friend instead" variant="ghost" onPress={() => router.replace({ pathname: '/transfer/[id]', params: { id: t.id } })} /> : null}
      </AuthShell>
    );
  }

  const submit = async () => {
    if (tooLow || overCap) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<Listed>(`/tickets/${encodeURIComponent(t.id)}/listing`, { body: { priceCents: cents } });
      haptic.success();
      setDone({ ...r, listCents: r.listCents ?? cents });
      await refresh();
    } catch (e) {
      haptic.error();
      const msg = errorText(e);
      // "The organizer caps resale at 150% of face value: at most 75.00 USD."
      const cap = /caps resale at (\d+)%/i.exec(msg);
      if (cap) setLearnedCap(Number(cap[1]));
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const face = vsFace(cents, faceCents);
  return (
    <AuthShell title="Sell ticket" icon="tag">
      <Txt color={colors.muted}>
        <Txt variant="bodyStrong">{seatLine(t)}</Txt> · face value {fmt(faceCents, currency)}. Listing is free, and buyers pay exactly your price.
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyboardShouldPersistTaps="handled">
        {presets(faceCents, capCents).map(([label, c]) => (
          <Chip key={label} label={`${label} · ${money(c, currency)}`} active={cents === c} onPress={() => setPrice(String(c / 100))} />
        ))}
      </ScrollView>
      <Field
        label={`Your price (${currencySymbol(currency)})`}
        value={value}
        onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={overCap ? `That’s over the organizer’s cap. You can ask at most ${fmt(capCents!, currency)} (${rules.capPercent}% of face value).` : tooLow ? `Enter a price of at least ${money(100, currency)}.` : ''}
        hint={`${face.text}${lowest !== null ? ` · other fans from ${money(lowest, currency)}` : ''}`}
      />
      {capCents !== null ? <CapMeter cents={cents} face={faceCents} cap={capCents} percent={rules.capPercent!} currency={currency} /> : null}
      <Breakdown price={cents} fee={fee} royalty={royalty} payout={payout} currency={currency} feePermille={feePermille} royaltyPermille={rules.royaltyPermille} />
      <Txt variant="small" color={colors.dim}>
        {rules.capPercent === undefined ? 'The organizer may cap resale prices; if yours is over, we’ll tell you the most you can ask. ' : ''}
        Your payout becomes available a day after the event starts; then the Eventro team sends it.
      </Txt>
      {error ? <Notice icon="alert">{error}</Notice> : null}
      <Button label={busy ? 'Listing…' : `List for ${fmt(cents, currency)}`} loading={busy} disabled={overCap || tooLow} onPress={submit} />
    </AuthShell>
  );
}

/** Price → fee → organizer's share → what the seller receives. */
function Breakdown({ price, fee, royalty, payout, currency, feePermille, royaltyPermille, exact }: { price: number; fee: number; royalty: number | null; payout: number; currency: string; feePermille: number; royaltyPermille?: number; exact?: boolean }) {
  return (
    <View style={styles.breakdown} accessibilityLiveRegion="polite">
      <Line label="Buyer pays" value={fmt(price, currency)} />
      <Line label={`Eventro fee (${pct(feePermille)})`} value={`−${fmt(fee, currency)}`} muted />
      <Line
        label={`Organizer’s share${royaltyPermille !== undefined && !exact ? ` (${pct(royaltyPermille)})` : ''}`}
        sub={royalty === null ? 'Set by the organizer (up to 20%), confirmed when you list' : undefined}
        value={royalty === null ? '—' : royalty ? `−${fmt(royalty, currency)}` : 'None'}
        muted
      />
      <View style={styles.total}>
        <Txt variant="bodyStrong" style={{ flex: 1 }}>
          {royalty === null ? 'You receive, before any organizer share' : 'You receive'}
        </Txt>
        <Txt variant="priceLg">{fmt(payout, currency)}</Txt>
      </View>
    </View>
  );
}

function Line({ label, value, sub, muted }: { label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <View style={styles.line}>
      <View style={{ flex: 1 }}>
        <Txt variant="small" color={muted ? colors.muted : colors.text}>
          {label}
        </Txt>
        {sub ? (
          <Txt variant="tiny" color={colors.dim}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Txt variant="small" color={muted ? colors.muted : colors.text} style={{ fontFamily: font.body.semibold }}>
        {value}
      </Txt>
    </View>
  );
}

/** Where the price sits between face value and the cap. */
function CapMeter({ cents, face, cap, percent, currency }: { cents: number; face: number; cap: number; percent: number; currency: string }) {
  const over = cents > cap;
  const fill = Math.max(0, Math.min(100, (cents / cap) * 100));
  const facePos = Math.min(100, (face / cap) * 100);
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.meter}>
        <View style={[styles.meterFill, { width: `${fill}%`, backgroundColor: over ? colors.accent : colors.success }]} />
        {facePos < 100 ? <View style={[styles.faceTick, { left: `${facePos}%` }]} /> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="tiny" color={colors.dim}>
          Face {money(face, currency)}
        </Txt>
        <Txt variant="tiny" color={over ? colors.accentHi : colors.dim}>
          Cap {money(cap, currency)} · {percent}% of face
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blocked: { alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 },
  blockedIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  breakdown: { paddingHorizontal: space.lg, paddingVertical: space.xs, borderRadius: radius.card, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: 9 },
  total: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.line2 },
  meter: { height: 8, borderRadius: 99, backgroundColor: colors.surface2, overflow: 'hidden' },
  meterFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 99 },
  faceTick: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: scheme === 'light' ? 'rgba(28,20,22,0.5)' : 'rgba(255,255,255,0.5)' },
});
