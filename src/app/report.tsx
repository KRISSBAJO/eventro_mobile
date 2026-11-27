/**
 * "Report this event" (from the foot of an event screen): a reason, a few words, and (signed out) an optional email.
 * POST /events/:slug/report. Omoshow's team reads every report; the organizer isn't told who sent it.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { ScreenHeader } from '@/components/screen-header';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme';

const REASONS = [
  ['SCAM', 'It looks like a scam or fake event'],
  ['WRONG_INFO', 'The details are wrong (date, place, price)'],
  ['OFFENSIVE', 'It’s offensive or illegal'],
  ['DUPLICATE', 'It’s a copy of another event'],
  ['OTHER', 'Something else'],
] as const;

export default function ReportEvent() {
  const { slug, title } = useLocalSearchParams<{ slug: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!reason) return setError('Pick what’s wrong.');
    if (reason === 'OTHER' && details.trim().length < 10) return setError('Tell us what looks wrong, in a sentence or two.');
    if (!user && email.trim() && !emailOk(email)) return setError('Enter an email address like name@example.com, or leave it empty.');
    setBusy(true);
    setError('');
    try {
      await api(`/events/${encodeURIComponent(slug ?? '')}/report`, { body: { reason, ...(details.trim() ? { details: details.trim() } : {}), ...(!user && email.trim() ? { email: email.trim() } : {}) } });
      haptic.success();
      setDone(true);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter - 4, paddingBottom: space.sm }}>
        <ScreenHeader title="Report this event" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + space.xxxl, gap: space.lg }}>
        {done ? (
          <>
            <Notice tone="success" icon="check" title="Thanks. We’ll take a look.">
              Our team reads every report. If the event breaks our rules we’ll pause or remove it, and ticket buyers are refunded.
            </Notice>
            <Button label="Done" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Txt color={colors.muted}>{`${title ? `${title}. ` : ''}The organizer won’t know who reported it.`}</Txt>
            <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
              {REASONS.map(([value, label]) => {
                const on = reason === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      haptic.select();
                      setReason(value);
                      setError('');
                    }}
                    style={[styles.reason, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
                    <Icon name={on ? 'check' : 'chevronRight'} size={16} color={on ? colors.accent : colors.dim} />
                    <Txt style={{ flex: 1 }}>{label}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <Field label={`What should we know?${reason === 'OTHER' ? '' : ' (optional)'}`} value={details} onChangeText={setDetails} multiline maxLength={1000} style={{ minHeight: 0 }} />
            {user ? null : <Field label="Your email (optional)" placeholder="In case we need to ask you something" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />}
            {error ? <Notice icon="alert">{error}</Notice> : null}
            <Button label="Send report" loading={busy} onPress={() => void send()} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  reason: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
});
