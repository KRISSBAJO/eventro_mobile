/**
 * Choose a new password from a reset link (eventro://reset-password?token=…, the same token the website's
 * /reset-password page takes). Checks the link first (POST /auth/reset/check), then resets and signs this phone in
 * with a device session (POST /auth/reset with `device`). Every other sign-in ends.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deviceInfo } from '@/lib/device';
import { haptic } from '@/lib/haptics';
import type { Session } from '@/lib/types';
import { space } from '@/theme';

export default function ResetPassword() {
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const { adopt } = useAuth();
  const [checked, setCheck] = useState<{ email: string } | { error: string } | null>(null);
  const tooShort = token.length < 20;
  const check = tooShort ? { error: 'This reset link isn’t valid. Ask for a new one.' } : checked;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    if (tooShort) return;
    api<{ valid: boolean; email: string }>('/auth/reset/check', { auth: false, body: { token } })
      .then((r) => live && setCheck({ email: r.email }))
      .catch((e) => live && setCheck({ error: errorText(e) }));
    return () => {
      live = false;
    };
  }, [token, tooShort]);

  const errors = { password: password.length >= 8 ? '' : 'Use at least 8 characters for your password.', confirm: confirm === password ? '' : 'The passwords don’t match.' };

  const submit = async () => {
    setSubmitted(true);
    if (errors.password || errors.confirm) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await adopt(await api<Session>('/auth/reset', { auth: false, body: { token, password, device: deviceInfo() } }));
      haptic.success();
      router.replace('/tickets');
    } catch (e) {
      haptic.error();
      if (e instanceof ApiError && e.code?.startsWith('RESET_')) setCheck({ error: e.message });
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!check) return <AuthShell title="Reset your password" subtitle="Checking your link…">{null}</AuthShell>;
  if ('error' in check) {
    return (
      <AuthShell title="This link can’t be used" subtitle={check.error}>
        <Button label="Ask for a new link" onPress={() => router.replace('/forgot-password')} style={{ marginTop: space.sm }} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle={`For ${check.email}. You’ll be signed out everywhere else.`}>
      {error ? <Notice icon="alert">{error}</Notice> : null}
      <Field label="New password" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" hint="At least 8 characters." error={submitted ? errors.password : ''} />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={submitted ? errors.confirm : ''}
      />
      <Button label="Save and sign in" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
    </AuthShell>
  );
}
