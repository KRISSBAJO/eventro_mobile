/**
 * Follow an organizer or a venue. Signed out, it opens sign-in. Following, it reads "Following" with a check; a tap
 * unfollows.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button } from '@/components/ui';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFollowing, useFollowToggle, type FollowKind } from '@/lib/following';

export function FollowButton({ kind, slug, name, size = 'sm' }: { kind: FollowKind; slug: string; name: string; size?: 'sm' | 'md' }) {
  const { user } = useAuth();
  const list = useFollowing(user?.id);
  const toggle = useFollowToggle();
  const [busy, setBusy] = useState(false);
  const on = !!list.data?.[kind].some((f) => f.slug === slug);

  if (!user) return <Button label="Follow" icon="plus" size={size} onPress={() => router.push('/sign-in')} />;
  return (
    <Button
      label={on ? 'Following' : 'Follow'}
      icon={on ? 'check' : 'plus'}
      variant={on ? 'ghost' : 'primary'}
      size={size}
      disabled={busy || list.isPending}
      onPress={async () => {
        setBusy(true);
        try {
          await toggle(kind, slug, !on, name);
        } catch (e) {
          Alert.alert(on ? 'Couldn’t unfollow' : 'Couldn’t follow', errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
