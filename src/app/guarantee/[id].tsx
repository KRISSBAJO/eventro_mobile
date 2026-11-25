/**
 * "Didn't scan? Get your money back": an Eventro Guarantee claim for one ticket (POST /tickets/:id/guarantee-claims).
 * It refunds that ticket only, all-in (its share of the order, fees included; for pay what you want, what was paid for
 * it); other tickets on the order keep working, and a donation on the order isn't part of it. Free tickets ($0 pay what
 * you want too) and comps aren't covered.
 *
 * Opened from the wallet ticket. The ticket comes from the saved wallet, so the screen works with no signal at the
 * door: a claim that can't reach the API is saved on this phone and sent when it can (guarantee.ts), and the server
 * still makes every check when it arrives. After sending, the same screen shows the decision: the server declines
 * scanned-in tickets at once; anything else is reviewed by the Eventro team within 24 hours.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { GradientButton, Section, formStyles } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { Button, Chip, Notice, TextArea, Txt } from '@/components/ui';
import { ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DateCards } from '@/components/date-cards';
import { activeOnly, ticketWhen } from '@/lib/dates';
import { money, when } from '@/lib/format';
import {
  claimBlocker,
  claimView,
  clearOutcome,
  DETAILS_MAX,
  DONATION_NOT_COVERED,
  dropQueued,
  flushClaims,
  HOW_DECIDED,
  isComp,
  isFree,
  openGuaranteeTerms,
  queueClaim,
  REASONS,
  reasonLabel,
  REFUND_TIMING,
  stamp,
  submitClaim,
  useClaimQueue,
  windowOf,
} from '@/lib/guarantee';
import { haptic } from '@/lib/haptics';
import { useMyTickets, useRefreshWallet } from '@/lib/queries';
import { seatLine } from '@/lib/tickets';
import type { GuaranteeClaim, GuaranteeReason } from '@/lib/types';
import { colors, radius, space } from '@/theme';

const TITLE = 'Didn’t scan? Get your money back';

export default function GuaranteeClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const wallet = useMyTickets(user?.id);
  const refresh = useRefreshWallet();
  const t = wallet.data?.tickets.find((x) => x.id === id);
  const { queued, outcome } = useClaimQueue(user?.id, id);
  const [reason, setReason] = useState<GuaranteeReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GuaranteeClaim | null>(null);
  // A multi-day pass: the day the claim is about
  const [dayId, setDayId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!user || !t) {
    return (
      <AuthShell title={TITLE} icon="shield">
        <Notice tone="plain">{!user ? 'Sign in to claim on a ticket.' : wallet.loading ? 'Loading your ticket…' : 'This ticket isn’t in your wallet any more.'}</Notice>
      </AuthShell>
    );
  }

  const multi = !!t.date || !!t.validDates?.length;
  const subtitle = `${t.ticketType.name} · ${seatLine(t)} · ${t.event.title}${multi ? ` · ${ticketWhen(t, t.event.startsAt, { time: false }).line}` : ''}`;
  // DAYS: each day's window (from the API), its date, and the one picked (the only open day to start with)
  const dayWindows = t.guarantee?.days ?? [];
  const passDays = activeOnly(t.validDates).filter((d) => dayWindows.some((w) => w.eventDateId === d.id));
  const openDays = dayWindows.filter((w) => windowOf(w, now) === 'open');
  const day = dayWindows.find((w) => w.eventDateId === (dayId ?? (openDays.length === 1 ? openDays[0].eventDateId : null))) ?? null;
  const dayName = (id: string | null | undefined) => {
    const d = (t.validDates ?? []).find((x) => x.id === id);
    return d ? when(d.startsAt).short : '';
  };
  const claim = result ?? t.guarantee?.claim ?? (outcome?.kind === 'sent' ? outcome.claim : null);
  const done = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/ticket/[id]', params: { id: t.id } }));

  /* ---------- a claim already exists: its status ---------- */
  if (claim) {
    const c = claimView(claim);
    return (
      <AuthShell title={claim.status === 'APPROVED' ? 'You’re getting your money back' : claim.status === 'DECLINED' ? 'Your claim was declined' : 'We’ve got your claim'} icon="shield" subtitle={subtitle}>
        <Section icon={c.icon} title={c.title} sub={claim.auto ? 'Decided automatically when you sent it.' : claim.decidedAt ? `Decided ${stamp(claim.decidedAt)}.` : `Sent ${stamp(claim.createdAt)}.`}>
          <Txt color={colors.text}>{claim.message}</Txt>
          {claim.decisionNote && claim.decisionNote !== claim.message ? (
            <Txt variant="small" color={colors.muted}>
              {claim.decisionNote}
            </Txt>
          ) : null}
          {c.extra ? (
            <Txt variant="small" color={colors.muted}>
              {c.extra}
            </Txt>
          ) : null}
        </Section>
        <Section icon="file" title="What you told us">
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong">{reasonLabel(claim.reason)}</Txt>
            {claim.eventDateId && dayName(claim.eventDateId) ? (
              <Txt variant="small" color={colors.muted}>
                {`About ${dayName(claim.eventDateId)}`}
              </Txt>
            ) : null}
            {claim.details ? (
              <Txt variant="small" color={colors.muted}>
                {claim.details}
              </Txt>
            ) : null}
          </View>
        </Section>
        {claim.status === 'APPROVED' ? (
          <Txt variant="small" color={colors.dim}>
            {passDays.length > 1
              ? `That day’s share of this pass, fees included, goes back to the payment method that paid for the order. The pass keeps working on its other days.`
              : `This ticket’s full share of what was paid, fees included, goes back to the payment method that paid for the order. This ticket no longer works${t.order.quantity > 1 ? '; your other tickets on this order aren’t affected' : ''}.`}
          </Txt>
        ) : null}
        <TermsLink />
        <Button label="Done" onPress={done} />
      </AuthShell>
    );
  }

  /* ---------- saved on this phone, waiting for a connection ---------- */
  if (queued) {
    const sendNow = async () => {
      setBusy(true);
      setError('');
      try {
        const r = await flushClaims(user.id, () => void refresh());
        if (r.waiting) {
          haptic.warning();
          setError('Still no connection. We’ll keep trying in the background.');
        } else haptic.success();
      } finally {
        setBusy(false);
      }
    };
    return (
      <AuthShell title="Claim saved" icon="shield" subtitle={subtitle}>
        <Notice tone="warning" icon="offline" title="Saved — we’ll send it as soon as you’re back online">
          {`Saved on this phone ${stamp(queued.queuedAt)}. Stay signed in: it goes up by itself when there’s a connection. Eventro checks the claim when it arrives${t.guarantee ? `, so it has to reach us before the window closes on ${stamp(t.guarantee.closesAt)}` : ''}.`}
        </Notice>
        <Section icon="file" title="Your claim">
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong">{reasonLabel(queued.reason)}</Txt>
            {queued.details ? (
              <Txt variant="small" color={colors.muted}>
                {queued.details}
              </Txt>
            ) : null}
          </View>
        </Section>
        {error ? <Notice icon="alert">{error}</Notice> : null}
        <View style={{ flexDirection: 'row' }}>
          <GradientButton label="Try sending now" icon="sync" loading={busy} onPress={sendNow} />
        </View>
        <Button
          label="Don’t send it"
          variant="ghost"
          disabled={busy}
          onPress={() => {
            haptic.select();
            dropQueued(user.id, t.id);
          }}
        />
      </AuthShell>
    );
  }

  /* ---------- can't claim on this ticket ---------- */
  const blocker = claimBlocker(t, now);
  if (blocker) {
    return (
      <AuthShell title={TITLE} icon="shield" subtitle={subtitle}>
        {outcome?.kind === 'refused' ? (
          <Notice icon="alert" title="Your claim wasn’t accepted">
            {outcome.message}
          </Notice>
        ) : null}
        <View style={styles.blocked}>
          <View style={styles.blockedIcon}>
            <Icon name="close" size={20} color={colors.muted} />
          </View>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            {isFree(t) ? 'Free tickets aren’t covered' : isComp(t) ? 'Complimentary tickets aren’t covered' : 'You can’t claim on this ticket right now'}
          </Txt>
          <Txt variant="small" color={colors.muted} style={{ textAlign: 'center' }}>
            {blocker}
          </Txt>
        </View>
        <TermsLink />
        <Button label="Back to your ticket" variant="ghost" onPress={done} />
      </AuthShell>
    );
  }

  /* ---------- the claim form ---------- */
  const refundCents = day ? day.refundCents : (t.guarantee?.refundCents ?? 0);
  const refund = refundCents > 0 ? money(refundCents, t.order.currency, { decimals: true }) : '';
  const submit = async () => {
    if (passDays.length && !day) {
      haptic.warning();
      setError('Pick the day your ticket didn’t work.');
      return;
    }
    if (!reason) {
      haptic.warning();
      setError('Choose what happened.');
      return;
    }
    const text = details.trim();
    setBusy(true);
    setError('');
    clearOutcome(user.id, t.id);
    try {
      const r = await submitClaim(t.id, { reason, ...(text ? { details: text } : {}), ...(day ? { eventDateId: day.eventDateId } : {}) });
      if (r.status === 'DECLINED') haptic.warning();
      else haptic.success();
      setResult(r);
      void refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // No signal at the door: keep it on this phone and send it when the API can be reached.
        await queueClaim(user.id, { ticketId: t.id, reason, details: text || null, eventDateId: day?.eventDateId ?? null });
        haptic.success();
      } else if (e instanceof ApiError && e.status === 409) {
        haptic.warning();
        setError(e.message || 'There’s already a claim for this ticket.');
        void refresh();
      } else {
        haptic.error();
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={TITLE} icon="shield" subtitle={subtitle}>
      <Txt color={colors.muted}>
        {passDays.length > 1
          ? `This pass is covered by the Eventro Guarantee. If it didn’t scan on one of its days, you can claim that day’s share${refund ? `: ${refund}` : ''}, fees included. It goes back to the payment method that paid for the order, and the pass keeps working on its other days. One claim per pass.`
          : `This ticket is covered by the Eventro Guarantee. If it didn’t scan at the door, you can claim a refund for this ticket only${refund ? `: ${refund}, its full share of what was paid, fees included` : ', its full share of what was paid, fees included'}. It goes back to the payment method that paid for the order.${t.order.quantity > 1 ? ' Your other tickets on this order aren’t affected.' : ''}`}
      </Txt>
      <Txt variant="small" color={colors.dim}>
        {DONATION_NOT_COVERED}
      </Txt>
      {outcome?.kind === 'refused' ? (
        <Notice icon="alert" title="Your last claim wasn’t accepted">
          {outcome.message}
        </Notice>
      ) : null}
      {wallet.offline ? (
        <Notice tone="warning" icon="offline" title="You’re offline">
          You can still send your claim: we’ll save it on this phone and send it as soon as you’re back online.
        </Notice>
      ) : null}

      {passDays.length ? (
        <Section icon="calendar" title="Which day?" sub="The day your pass didn’t get you in. Claims for a day open 3 hours before it starts.">
          <DateCards
            dates={passDays.map((d) => ({ id: d.id, startsAt: d.startsAt, doorsAt: null, endsAt: null, label: d.label, status: 'ACTIVE' }))}
            off={(d) => {
              const w = dayWindows.find((x) => x.eventDateId === d.id);
              const state = w ? windowOf(w, now) : 'closed';
              return state === 'open' ? null : state === 'before' ? 'Not open yet' : 'Closed';
            }}
            value={day?.eventDateId ?? null}
            onChange={(id) => {
              setDayId(id);
              if (error === 'Pick the day your ticket didn’t work.') setError('');
            }}
            label="Which day"
          />
        </Section>
      ) : null}

      <Section icon="alert" title="What happened?">
        <View style={formStyles.wrap} accessibilityRole="radiogroup">
          {REASONS.map((r) => (
            <Chip
              key={r.id}
              label={r.label}
              active={reason === r.id}
              onPress={() => {
                setReason(r.id);
                if (error === 'Choose what happened.') setError('');
              }}
            />
          ))}
        </View>
      </Section>

      <Section icon="file" title="Anything else?" sub="Optional. What the door staff said, or anything that helps us check.">
        <TextArea label="Details" value={details} onChangeText={setDetails} maxLength={DETAILS_MAX} minHeight={120} placeholder="e.g. The scanner showed “Not valid” at the main entrance." />
      </Section>

      <Section icon="cash" title="What happens next">
        <View style={{ gap: space.sm }}>
          {t.status === 'CHECKED_IN' && passDays.length ? (
            <Step text="If your pass was scanned in on the day you pick, the claim is declined automatically. Entries on other days don’t count." />
          ) : t.status === 'CHECKED_IN' ? (
            <Step text={`This ticket was scanned in${t.checkedInAt ? ` at ${stamp(t.checkedInAt)}` : ''}, so the claim will be declined automatically. If you were turned away anyway, say so above; Eventro can overturn the decision.`} />
          ) : null}
          <Step text={HOW_DECIDED} />
          <Step text={`Refunds: ${REFUND_TIMING.charAt(0).toLowerCase()}${REFUND_TIMING.slice(1)}`} />
          <Step text={day ? `You can claim for ${dayName(day.eventDateId)} until ${stamp(day.closesAt)} (48 hours after that day ends).` : `You can claim until ${stamp(t.guarantee?.closesAt)} (48 hours after ${t.date ? 'your date' : 'the event'} ends).`} />
        </View>
      </Section>

      {error ? <Notice icon="alert">{error}</Notice> : null}
      <View style={{ flexDirection: 'row' }}>
        <GradientButton label="Send claim" icon="send" loading={busy} onPress={submit} />
      </View>
      <TermsLink />
    </AuthShell>
  );
}

function Step({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <Icon name="check" size={15} color={colors.success} />
      <Txt variant="small" color={colors.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

function TermsLink() {
  return (
    <Txt variant="small" color={colors.dim} style={{ textAlign: 'center' }}>
      Read the{' '}
      <Txt variant="smallStrong" color={colors.accent} accessibilityRole="link" onPress={openGuaranteeTerms}>
        Eventro Guarantee terms
      </Txt>
      .
    </Txt>
  );
}

const styles = StyleSheet.create({
  blocked: { alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  blockedIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, marginBottom: space.xs },
});
