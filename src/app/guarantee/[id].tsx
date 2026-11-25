/**
 * "Didn't scan? Get your money back": a resale guarantee claim for one ticket (POST /tickets/:id/guarantee-claims).
 *
 * Opened from the wallet ticket. The ticket comes from the saved wallet, so the screen works with no signal at the
 * door: a claim that can't reach the API is saved on this phone and sent when it can (guarantee.ts), and the server
 * still makes every check when it arrives. After sending, the same screen shows the decision: the server declines
 * scanned-in tickets and approves (and refunds) ones the door refused at once; anything else is reviewed within a day.
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
import {
  claimBlocker,
  claimView,
  clearOutcome,
  DETAILS_MAX,
  dropQueued,
  flushClaims,
  openGuaranteeTerms,
  queueClaim,
  REASONS,
  reasonLabel,
  REFUND_TIMING,
  stamp,
  submitClaim,
  useClaimQueue,
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

  const subtitle = `${t.ticketType.name} · ${seatLine(t)} · ${t.event.title}`;
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
            {claim.details ? (
              <Txt variant="small" color={colors.muted}>
                {claim.details}
              </Txt>
            ) : null}
          </View>
        </Section>
        {claim.status === 'APPROVED' ? (
          <Txt variant="small" color={colors.dim}>
            The full amount paid for the resale ticket, fees included, goes back to the original payment method. The ticket no longer works.
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
            You can’t claim on this ticket right now
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
  const submit = async () => {
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
      const r = await submitClaim(t.id, { reason, ...(text ? { details: text } : {}) });
      if (r.status === 'DECLINED') haptic.warning();
      else haptic.success();
      setResult(r);
      void refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // No signal at the door: keep it on this phone and send it when the API can be reached.
        await queueClaim(user.id, { ticketId: t.id, reason, details: text || null });
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
        This ticket came from Eventro fan resale. If it doesn’t scan at the door, Eventro refunds what was paid for it in full, fees included, to the original payment method.
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
          {t.status === 'CHECKED_IN' ? (
            <Step text={`This ticket was scanned in${t.checkedInAt ? ` at ${stamp(t.checkedInAt)}` : ''}, so the claim will be declined automatically. If you were turned away anyway, say so below; Eventro can overturn the decision.`} />
          ) : null}
          <Step text="If the door scanner refused this ticket, your refund is approved straight away." />
          <Step text="Otherwise we’ll get back to you within 24 hours." />
          <Step text={`Refunds: ${REFUND_TIMING.charAt(0).toLowerCase()}${REFUND_TIMING.slice(1)}`} />
          <Step text={`You can claim until ${stamp(t.guarantee?.closesAt)} (48 hours after the event ends).`} />
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
        resale guarantee terms
      </Txt>
      .
    </Txt>
  );
}

const styles = StyleSheet.create({
  blocked: { alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  blockedIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, marginBottom: space.xs },
});
