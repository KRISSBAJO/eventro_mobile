import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { errorText, WEB_URL } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { colors, space } from '@/theme';

export default function SignUp() {
  const params = useLocalSearchParams<{ email?: string; name?: string; then?: string }>();
  const { signUp } = useAuth();
  const [name, setName] = useState(params.name ?? '');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const errors = {
    name: name.trim().length >= 2 ? '' : 'Enter your name (at least 2 letters).',
    email: emailOk(email) ? '' : 'Enter a valid email address.',
    password: password.length >= 8 ? '' : 'Use at least 8 characters for your password.',
  };
  const strength = password.length === 0 ? '' : password.length < 8 ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'}` : password.length < 12 ? 'Good' : 'Strong';

  const submit = async () => {
    setSubmitted(true);
    if (errors.name || errors.email || errors.password) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signUp(name, email, password);
      haptic.success();
      // Tickets bought earlier with this email move into the new account (the API links them).
      if (params.then === 'tickets' || params.email) router.replace('/tickets');
      else if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Your tickets, in your pocket. Tickets you bought with this email come with you.">
      {error ? (
        <Notice icon="alert" action={/already exists/i.test(error) ? 'Sign in instead' : undefined} onAction={() => router.replace({ pathname: '/sign-in', params: { email, then: params.then } })}>
          {error}
        </Notice>
      ) : null}
      <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoCapitalize="words" error={submitted ? errors.name : ''} />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={submitted ? errors.email : ''}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={submitted ? errors.password : ''}
        hint={strength ? `At least 8 characters · ${strength}` : 'At least 8 characters.'}
      />
      <Button label="Create account" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
      <Txt variant="small" color={colors.dim} style={{ textAlign: 'center' }}>
        By creating an account you agree to Eventro’s{' '}
        <Txt variant="small" color={colors.muted} onPress={() => Linking.openURL(`${WEB_URL}/legal/terms`)} accessibilityRole="link">
          Terms
        </Txt>{' '}
        and{' '}
        <Txt variant="small" color={colors.muted} onPress={() => Linking.openURL(`${WEB_URL}/legal/privacy`)} accessibilityRole="link">
          Privacy Policy
        </Txt>
        .
      </Txt>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <Txt variant="small" color={colors.muted}>
          Already have an account?
        </Txt>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.replace({ pathname: '/sign-in', params: { email, then: params.then } })}>
          <Txt variant="smallStrong" color={colors.accent}>
            Sign in
          </Txt>
        </Pressable>
      </View>
    </AuthShell>
  );
}
