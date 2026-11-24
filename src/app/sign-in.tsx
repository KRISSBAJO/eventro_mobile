import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { colors, space } from '@/theme';

export default function SignIn() {
  const params = useLocalSearchParams<{ email?: string; then?: string }>();
  const { signIn } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const errors = { email: emailOk(email) ? '' : 'Enter the email you signed up with.', password: password ? '' : 'Enter your password.' };

  const submit = async () => {
    setSubmitted(true);
    if (errors.email || errors.password) {
      haptic.warning();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      haptic.success();
      if (params.then === 'tickets') router.replace('/tickets');
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
    <AuthShell title="Welcome back" subtitle="Sign in to see your tickets and check out faster.">
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
        returnKeyType="next"
        error={submitted ? errors.email : ''}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={submitted ? errors.password : ''}
      />
      <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push({ pathname: '/forgot-password', params: { email } })} style={{ alignSelf: 'flex-start' }}>
        <Txt variant="smallStrong" color={colors.accent}>
          Forgot your password?
        </Txt>
      </Pressable>
      <Button label="Sign in" loading={busy} onPress={submit} style={{ marginTop: space.sm }} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm }}>
        <Txt variant="small" color={colors.muted}>
          New to Eventro?
        </Txt>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.replace({ pathname: '/sign-up', params: { email, then: params.then } })}>
          <Txt variant="smallStrong" color={colors.accent}>
            Create an account
          </Txt>
        </Pressable>
      </View>
    </AuthShell>
  );
}
