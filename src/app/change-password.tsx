import { router } from 'expo-router';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import type { Session } from '@/lib/types';
import { space } from '@/theme';

export default function ChangePassword() {
  const { adopt, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const errors = {
    current: current ? '' : 'Enter your current password.',
    next: next.length < 8 ? 'Use at least 8 characters.' : next === current ? 'Choose a password that’s different from your current one.' : '',
    confirm: confirm === next ? '' : 'The passwords don’t match.',
  };

  const submit = async () => {
    setSubmitted(true);
    if (errors.current || errors.next || errors.confirm) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Other sign-ins end; the answer is a fresh session for this device.
      await adopt(await api<Session>('/auth/password', { body: { currentPassword: current, newPassword: next } }));
      haptic.success();
      setDone(true);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <AuthShell title="Change password">
        <Notice tone="plain">Sign in first to change your password.</Notice>
        <Button label="Sign in" onPress={() => router.replace('/sign-in')} />
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password changed" subtitle="You’re still signed in here. Other phones and browsers were signed out, so sign in there with the new password.">
        <Button label="Done" onPress={() => router.back()} style={{ marginTop: space.sm }} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Change password" subtitle={`For ${user.email}`}>
      {error ? <Notice icon="alert">{error}</Notice> : null}
      <Field label="Current password" value={current} onChangeText={setCurrent} secure autoComplete="current-password" textContentType="password" autoCapitalize="none" error={submitted ? errors.current : ''} />
      <Field label="New password" value={next} onChangeText={setNext} secure autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" hint="At least 8 characters." error={submitted ? errors.next : ''} />
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
      <Button label="Change password" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
    </AuthShell>
  );
}
