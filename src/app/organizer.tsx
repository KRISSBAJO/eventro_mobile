/**
 * Account → Organizer tools: the events of every organization this account is on the team of
 * (GET /organizer/orgs, then the light …/orgs/:id/door-events: 2 days back to 60 days ahead, with check-in counts).
 * Pick one to open its door scanner.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { Badge, EmptyState, ErrorState, IconButton, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { savedDoorEvents, sweepEndedDoors } from '@/lib/door';
import { isPast, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useMyOrgs } from '@/lib/queries';
import type { DoorEvent } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

const ROLE: Record<string, string> = { ADMIN: 'Admin', MANAGER: 'Manager', EDITOR: 'Editor', FINANCE: 'Finance', DOOR: 'Door staff' };

export default function OrganizerTools() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const events = useQuery({
    queryKey: ['organizer', 'door-events', user?.id, (orgs.data ?? []).map((o) => o.org.id).join(',')],
    queryFn: async () => {
      const lists = await Promise.all((orgs.data ?? []).map(async (o) => ({ org: o, events: await api<DoorEvent[]>(`/organizer/orgs/${encodeURIComponent(o.org.id)}/door-events`) })));
      return lists;
    },
    enabled: !!orgs.data?.length,
  });
  const [saved, setSaved] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);

  // Door packs for events that are over are deleted (they hold every ticket's seed).
  useEffect(() => {
    let live = true;
    void sweepEndedDoors().then(() => live && setSaved(savedDoorEvents()));
    return () => {
      live = false;
    };
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={async () => {
            setPulling(true);
            await Promise.all([orgs.refetch(), events.refetch()]);
            setSaved(savedDoorEvents());
            setPulling(false);
          }}
          tintColor={colors.accent}
        />
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Txt variant="h2" accessibilityRole="header">
          Organizer tools
        </Txt>
      </View>
      <Txt color={colors.muted}>Scan tickets at the door. Pick an event to open its scanner. It works offline once you download the guest list.</Txt>

      {!user ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : orgs.isPending || (orgs.data?.length && events.isPending) ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={86} radius={radius.card} />
          <Skeleton height={86} radius={radius.card} />
        </View>
      ) : orgs.error || events.error ? (
        <ErrorState message={errorText(orgs.error ?? events.error)} onRetry={() => (orgs.error ? orgs.refetch() : events.refetch())} />
      ) : !orgs.data?.length ? (
        <EmptyState icon="users" title="You’re not on an organizer team" body="When an organizer adds you to their team, their events show up here." />
      ) : (
        (events.data ?? []).map(({ org, events: list }) => {
          // The API sends 2 days back to 60 days ahead, soonest first; the scanner is for events not over yet.
          const live = list.filter((e) => !isPast(e.startsAt, 12));
          return (
            <View key={org.org.id} style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="eyebrow" color={colors.dim} style={{ flex: 1 }}>
                  {org.org.name}
                </Txt>
                <Badge label={ROLE[org.role] ?? org.role} />
              </View>
              {!live.length ? (
                <Txt variant="small" color={colors.dim}>
                  No upcoming events.
                </Txt>
              ) : (
                live.map((e) => {
                  const d = when(e.startsAt);
                  return (
                    <Pressable
                      key={e.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${e.title}, ${d.date}. Open the door scanner`}
                      onPress={() => {
                        haptic.tap();
                        router.push({ pathname: '/door/[eventId]', params: { eventId: e.id } });
                      }}
                      style={({ pressed }) => [styles.event, pressed && { backgroundColor: colors.surface2 }]}>
                      <View style={styles.thumb}>
                        <Txt variant="eyebrow" color={colors.accent} style={{ fontSize: 10, lineHeight: 12 }}>
                          {d.month}
                        </Txt>
                        <Txt variant="h3" style={{ lineHeight: 22 }}>
                          {d.day}
                        </Txt>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {e.title}
                        </Txt>
                        <Txt variant="small" color={colors.muted} numberOfLines={1}>
                          {d.short} · {d.time}
                          {e.venue ? ` · ${e.venue.name}` : e.online ? ' · Online' : ''}
                        </Txt>
                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                          <Badge label={e.checkedIn ? `${e.checkedIn} of ${e.ticketsIssued} in` : `${e.ticketsIssued} ticket${e.ticketsIssued === 1 ? '' : 's'}`} />
                          {e.status !== 'PUBLISHED' ? <Badge label={e.status === 'CANCELLED' ? 'Cancelled' : e.status.toLowerCase()} tone="warning" /> : null}
                          {saved.includes(e.id) ? <Badge label="Offline list saved" tone="success" /> : null}
                        </View>
                      </View>
                      <Icon name="scan" size={20} color={colors.accent} />
                    </Pressable>
                  );
                })
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  event: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
