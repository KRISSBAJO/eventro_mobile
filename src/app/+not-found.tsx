import { router } from 'expo-router';
import { View } from 'react-native';
import { EmptyState } from '@/components/ui';
import { colors } from '@/theme';

export default function NotFound() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
      <EmptyState icon="discover" title="This page doesn’t exist" body="The link may be old or mistyped." action="Go to Discover" onAction={() => router.replace('/')} />
    </View>
  );
}
