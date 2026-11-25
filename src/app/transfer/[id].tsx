/** Send a ticket to a friend by email (POST /tickets/:id/transfer). Wording as on the website's My tickets. */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { useMyTickets, useRefreshWallet } from '@/lib/queries';
import { blockers, rulesOf, transferTerms } from '@/lib/resale';
import { ticketWhen } from '@/lib/dates';
import { seatLine } from '@/lib/tickets';
import { colors, radius, space } from '@/theme';

export default function Transfer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const wallet = useMyTickets(user?.id);
  const refresh = useRefreshWallet();
  const t = wallet.data?.tickets.find((x) => x.id === id);
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [now] = useState(() => Date.now());

  if (!user || !t) {
    return (
      <AuthShell title="Transfer ticket" icon="send">
        <Notice tone="plain">{!user ? 'Sign in to send a ticket.' : wallet.loading ? 'Loading your ticket…' : 'This ticket isn’t in your wallet any more.'}</Notice>
      </AuthShell>
    );
  }

  const rules = rulesOf(t.event);
  const blocked = t.status === 'ACTIVE' ? blockers(t, rules, now).transfer : 'Only active tickets can be transferred.';

  if (sent) {
    return (
      <AuthShell title="Ticket sent" icon="check" subtitle={`We emailed ${sent}. It’s theirs once they accept it.`}>
        <Notice tone="plain" icon="clock">
          {transferTerms(rules.cutoffMinutes)}
        </Notice>
        <Button label="Done" onPress={() => router.back()} style={{ marginTop: space.sm }} />
      </AuthShell>
    );
  }

  if (blocked) {
    return (
      <AuthShell title="Transfer ticket" icon="send" subtitle={`${t.ticketType.name} · ${t.event.title}`}>
        <View style={{ alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 }}>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            You can’t transfer this ticket right now
          </Txt>
          <Txt variant="small" color={colors.muted} style={{ textAlign: 'center' }}>
            {blocked}
          </Txt>
        </View>
      </AuthShell>
    );
  }

  const submit = async () => {
    const v = to.trim().toLowerCase();
    if (!emailOk(v)) return setError('Enter your friend’s email.');
    if (v === user.email.toLowerCase()) return setError('That’s your own email.');
    setBusy(true);
    setError('');
    try {
      await api(`/tickets/${encodeURIComponent(t.id)}/transfer`, { body: { email: v } });
      haptic.success();
      setSent(v);
      await refresh();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Transfer ticket" icon="send" subtitle={`${t.ticketType.name} · ${seatLine(t)} · ${t.event.title}${t.date || t.validDates?.length ? ` · ${ticketWhen(t, t.event.startsAt, { time: false }).line}` : ''}`}>
      <Txt color={colors.muted}>They accept it from My tickets when they sign in with this email. Then it moves to their account and your code stops working.</Txt>
      <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line }}>
        <Txt variant="small" color={colors.muted}>
          {transferTerms(rules.cutoffMinutes)}
        </Txt>
      </View>
      <Field
        label="Friend’s email"
        value={to}
        onChangeText={(v) => {
          setTo(v);
          setError('');
        }}
        autoFocus
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={submit}
        error={error}
      />
      <Button label={busy ? 'Sending…' : 'Send ticket'} icon="send" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
    </AuthShell>
  );
}
