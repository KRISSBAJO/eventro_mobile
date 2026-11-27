/**
 * Account → Sell tickets, for accounts without an organization: set up an organizer profile with the name fans see
 * on event pages and receipts (POST /organizer/orgs, the field the website asks for). The account becomes an
 * organizer and the organizer tools open, ready to create a first event.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LiveStats } from '@/components/live-stats';
import { OrgScreen } from '@/components/org-ui';
import { Button, EmptyState, Field, Notice, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { colors, space } from '@/theme';

export default function StartSelling() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (name.trim().length < 2) {
      setError('Enter the name fans will see on your events.');
      return haptic.warning();
    }
    setError('');
    setBusy(true);
    try {
      const org = await api<{ id: string }>('/organizer/orgs', { body: { name: name.trim() } });
      haptic.success();
      if (user && !user.roles.includes('ORGANIZER')) setUser({ ...user, roles: [...user.roles, 'ORGANIZER'] });
      await qc.invalidateQueries({ queryKey: ['organizer', 'orgs'] });
      router.replace({ pathname: '/organizer/create', params: { orgId: org.id, first: '1' } });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <OrgScreen title="Sell tickets" fallback="/account" footer={user ? <Button label="Create profile" loading={busy} onPress={() => void create()} /> : undefined}>
      {!user ? (
        <EmptyState icon="lock" title="Sign in first" body="Your organizer profile belongs to your Omoshow account." action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : (
        <View style={{ gap: space.lg }}>
          <LiveStats show={['tickets', 'events', 'cities']} />
          <Txt color={colors.muted}>
            Set up your organizer profile. This is the name on your event pages and receipts. You can change it later, and add your logo and payout account on the website.
          </Txt>
          <Field label="Organizer name" placeholder="e.g. Lagos Live" value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => void create()} error={error} />
          <Notice tone="plain" icon="ticket" title="What happens next">
            You create your first event here: details, date and place, tickets and a cover photo. Save it as a draft, then submit it for review. Omoshow checks every event before it goes on sale.
          </Notice>
        </View>
      )}
    </OrgScreen>
  );
}
