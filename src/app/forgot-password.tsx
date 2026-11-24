import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { emailOk } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { space } from '@/theme';

export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const bad = emailOk(email) ? '' : 'Enter the email you signed up with.';

  const submit = async () => {
    setSubmitted(true);
    if (bad) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ ok: boolean; message: string }>('/auth/forgot', { body: { email: email.trim().toLowerCase() } });
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
          Open the link on this phone or any computer to choose a new password, then sign in here with it.
        </Notice>
        <Button label="Back to sign in" onPress={() => router.replace({ pathname: '/sign-in', params: { email } })} style={{ marginTop: space.sm }} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we’ll send you a link to choose a new password.">
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
      <Button label="Send reset link" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
    </AuthShell>
  );
}
