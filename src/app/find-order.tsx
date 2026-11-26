/**
 * "Can't find my order?": for people who bought as a guest, or lost the email. They enter the email used at checkout
 * and Omoshow sends the list of orders there, with a link to sign in (or sign up with that same email, which brings
 * the tickets into the new account). The answer is the same whether or not the email has orders (POST /orders/find).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { emailOk } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { space } from '@/theme';

export default function FindOrder() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const bad = emailOk(email) ? '' : 'Enter the email you used at checkout.';

  const submit = async () => {
    setSubmitted(true);
    if (bad) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ message: string }>('/orders/find', { body: { email: email.trim().toLowerCase() } });
      setSent(r.message);
      haptic.success();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle={sent}>
        <Notice tone="plain" icon="mail">
          Then sign in, or create an account, with that same email: your tickets come with you.
        </Notice>
        <Button label="Sign in" onPress={() => router.replace({ pathname: '/sign-in', params: { email, then: 'tickets' } })} style={{ marginTop: space.sm }} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Find your order" subtitle="Enter the email you used at checkout and we’ll send your orders there.">
      {error ? <Notice icon="alert">{error}</Notice> : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={submit}
        error={submitted ? bad : ''}
      />
      <Button label="Send my orders" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
    </AuthShell>
  );
}
