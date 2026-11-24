/**
 * Account → Organizer tools. For admins and managers: the organization's headline numbers (tickets sold, revenue in
 * the org's currency, upcoming events), recent orders and every event with its status; tap one for its dashboard.
 * Door staff see just the door list (GET …/door-events), as before. Several organizations: a switcher on top.
 *
 *   GET /organizer/orgs/:orgId/events         events with ticket types and 60 days of daily sales (all roles)
 *   GET /organizer/orgs/:orgId/orders/recent  the last 8 paid orders (admins and managers)
 *   GET /organizer/orgs/:orgId/payouts        payout balance and account (admins)
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/icons';
import { Group, Label, OrgScreen, StatTile, StatusBadge, TileRow } from '@/components/org-ui';
import { Badge, Button, Chip, Divider, EmptyState, ErrorState, Notice, Row, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { savedDoorEvents, sweepEndedDoors } from '@/lib/door';
import { isPast, money, num, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { canEdit, convert, isAdmin, openWeb, ROLE_NAME, statusOf, useOrgEvents, usePayouts, useRates, useRecentOrders, webPaths, type OrgEvent } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { readJson, writeJson } from '@/lib/storage';
import type { DoorEvent, MyOrg } from '@/lib/types';
import { colors, radius, space } from '@/theme';

const ORG_KEY = 'organizer-org';

export default function OrganizerHome() {
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  // The organization picked last time (when there are several).
  useEffect(() => {
    let live = true;
    void readJson<string>(ORG_KEY).then((id) => live && id && setPicked((p) => p ?? id));
    return () => {
      live = false;
    };
  }, []);

  const list = orgs.data ?? [];
  const current: MyOrg | undefined = list.find((o) => o.org.id === picked) ?? list[0];
  const role = current?.role;

  const refresh = () => Promise.all([orgs.refetch(), qc.invalidateQueries({ queryKey: ['organizer'] })]);

  return (
    <OrgScreen
      title="Organizer tools"
      eyebrow={current ? `${current.org.name} · ${ROLE_NAME[current.role] ?? current.role}` : undefined}
      fallback="/account"
      onRefresh={refresh}
      footer={current && canEdit(role) ? <Button label="Create event" icon="plus" onPress={() => router.push({ pathname: '/organizer/create', params: { orgId: current.org.id } })} /> : undefined}>
      {!user ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : orgs.isPending ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={96} radius={radius.card} />
          <Skeleton height={86} radius={radius.card} />
          <Skeleton height={86} radius={radius.card} />
        </View>
      ) : orgs.error ? (
        <ErrorState message={errorText(orgs.error)} onRetry={() => void orgs.refetch()} />
      ) : !current ? (
        <EmptyState
          icon="ticket"
          title="Sell tickets on Eventro"
          body="Set up an organizer profile to create events, sell tickets and scan them at the door. If an organizer added you to their team, sign in with the email they invited."
          action="Set up a profile"
          onAction={() => router.replace('/organizer/start')}
        />
      ) : (
        <>
          {list.length > 1 ? (
            <View style={styles.chips} accessibilityLabel="Organization">
              {list.map((o) => (
                <Chip
                  key={o.org.id}
                  label={o.org.name}
                  active={o.org.id === current.org.id}
                  onPress={() => {
                    setPicked(o.org.id);
                    void writeJson(ORG_KEY, o.org.id);
                  }}
                />
              ))}
            </View>
          ) : null}
          {canEdit(role) ? <Dashboard key={current.org.id} org={current} /> : <DoorList key={current.org.id} org={current} />}
        </>
      )}
    </OrgScreen>
  );
}

/* ---------- admins and managers ---------- */

function Dashboard({ org }: { org: MyOrg }) {
  const orgId = org.org.id;
  const admin = isAdmin(org.role);
  const events = useOrgEvents(orgId);
  const recent = useRecentOrders(orgId);
  const payouts = usePayouts(orgId, admin);
  const [showPast, setShowPast] = useState(false);

  const list = useMemo(() => events.data ?? [], [events.data]);
  // Totals in the org's currency: the payouts currency (admins), else the one most events use; others converted.
  const counts = new Map<string, number>();
  list.forEach((e) => counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1));
  const display = payouts.data?.currency ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
  const mixed = list.some((e) => e.currency !== display);
  const rates = useRates(mixed);

  if (events.isPending) {
    return (
      <View style={{ gap: space.md }}>
        <Skeleton height={110} radius={radius.card} />
        <Skeleton height={86} radius={radius.card} />
        <Skeleton height={86} radius={radius.card} />
      </View>
    );
  }
  if (events.error) return <ErrorState message={errorText(events.error)} onRetry={() => void events.refetch()} />;

  const sold = list.reduce((s, e) => s + e.sold, 0);
  const week = list.reduce((s, e) => s + e.daily.tickets.slice(-7).reduce((a, b) => a + b, 0), 0);
  const revenue = list.reduce((s, e) => s + (convert(e.grossCents, e.currency, display, rates.data) ?? 0), 0);
  const approx = list.some((e) => e.currency !== display && e.grossCents > 0);
  const upcoming = list.filter((e) => e.status !== 'CANCELLED' && !isPast(e.startsAt));
  const past = list.filter((e) => e.status === 'CANCELLED' || isPast(e.startsAt)).reverse();
  const onSale = upcoming.filter((e) => statusOf(e) === 'On sale').length;

  return (
    <>
      <TileRow>
        <StatTile label="Tickets sold" value={num(sold)} sub={week ? `${num(week)} in the last 7 days` : 'None in the last 7 days'} />
        <StatTile label="Revenue" value={`${approx ? '≈ ' : ''}${money(revenue, display)}`} sub={approx ? `All events, in ${display}` : 'All events, before fees'} />
      </TileRow>
      <TileRow>
        <StatTile label="Upcoming" value={num(upcoming.length)} sub={`${num(onSale)} on sale`} />
        {admin ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Payouts" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/organizer/payouts', params: { orgId } })}>
            <StatTile
              label="Next payout"
              value={payouts.data ? money(payouts.data.nextPayoutCents, payouts.data.currency) : '—'}
              sub={payouts.isPending ? 'Loading…' : payouts.data?.payoutMethod ? 'Tap for payouts' : 'Not set up yet'}
              tone={payouts.data && !payouts.data.payoutMethod ? 'accent' : undefined}
            />
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </TileRow>
      {admin && payouts.data && !payouts.data.payoutMethod ? (
        <Notice tone="warning" icon="cash" title="Payouts aren’t set up" action="Set up payouts on the web" onAction={() => openWeb(webPaths.payouts)}>
          Connect a bank account on the Eventro website to get paid. The app never asks for bank details.
        </Notice>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>Recent orders</Label>
        {recent.isPending ? (
          <Skeleton height={120} radius={radius.card} />
        ) : recent.error ? (
          <Notice tone="plain" icon="alert">
            {errorText(recent.error)}
          </Notice>
        ) : !recent.data?.length ? (
          <Txt variant="small" color={colors.dim}>
            No orders yet. They show up here as soon as someone buys.
          </Txt>
        ) : (
          <Group>
            {recent.data.map((o, i) => (
              <View key={o.id}>
                {i ? <Divider style={{ marginLeft: space.lg }} /> : null}
                <View style={styles.order}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {o.buyerName}
                    </Txt>
                    <Txt variant="small" color={colors.muted} numberOfLines={1}>
                      {o.quantity} × {o.ticketType.name} · {o.event.title}
                    </Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Txt variant="bodyStrong">{o.totalCents ? money(o.totalCents, o.currency) : 'Free'}</Txt>
                    <Txt variant="tiny" color={colors.dim}>
                      {ago(o.paidAt)}
                    </Txt>
                  </View>
                </View>
              </View>
            ))}
          </Group>
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <Label>{`Upcoming events · ${upcoming.length}`}</Label>
        {!upcoming.length ? (
          <EmptyState compact icon="calendar" title="No upcoming events" body="Create one here, save it as a draft and submit it for review when it’s ready." />
        ) : (
          upcoming.map((e) => <EventRow key={e.id} e={e} />)
        )}
      </View>

      {past.length ? (
        <View style={{ gap: space.sm }}>
          <Label>{`Past and cancelled · ${past.length}`}</Label>
          {(showPast ? past : past.slice(0, 3)).map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
          {past.length > 3 && !showPast ? <Button label={`Show all ${past.length}`} variant="ghost" size="md" onPress={() => setShowPast(true)} /> : null}
        </View>
      ) : null}

      <Group>
        <Row icon="users" label="Team" detail={admin ? 'Invite and roles' : 'View'} onPress={() => router.push({ pathname: '/organizer/team', params: { orgId } })} />
        {admin ? (
          <>
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="cash" label="Payouts" onPress={() => router.push({ pathname: '/organizer/payouts', params: { orgId } })} />
            <Divider style={{ marginLeft: 62 }} />
            <Row icon="external" label="Branding and settings" detail="Website" onPress={() => openWeb(webPaths.settings)} />
          </>
        ) : null}
      </Group>
    </>
  );
}

function EventRow({ e }: { e: OrgEvent }) {
  const d = when(e.startsAt);
  const st = statusOf(e);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${d.date}, ${st}. Open the dashboard`}
      onPress={() => {
        haptic.tap();
        router.push({ pathname: '/organizer/events/[id]', params: { id: e.id } });
      }}
      style={({ pressed }) => [styles.event, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.thumb}>{e.imageUrl ? <Image source={{ uri: e.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={e.id} /> : null}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {e.title}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {d.short} · {d.time}
          {e.online ? ' · Online' : e.venue ? ` · ${e.venue.name}` : ''}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={st} />
          <Badge label={`${num(e.sold)} / ${num(e.capacity)} sold`} />
        </View>
      </View>
      <Icon name="chevronRight" size={18} color={colors.dim} />
    </Pressable>
  );
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5m ago", "3h ago", "Nov 21" */
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const d = new Date(iso);
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/* ---------- door staff ---------- */

/** The light list for the door scanner (2 days back to 60 days ahead, with check-in counts). Tap to scan. */
function DoorList({ org }: { org: MyOrg }) {
  const events = useQuery({
    queryKey: ['organizer', 'door-events', org.org.id],
    queryFn: () => api<DoorEvent[]>(`/organizer/orgs/${encodeURIComponent(org.org.id)}/door-events`),
  });
  const [saved, setSaved] = useState<string[]>([]);

  // Door packs for events that are over are deleted (they hold every ticket's seed).
  useEffect(() => {
    let live = true;
    void sweepEndedDoors().then(() => live && setSaved(savedDoorEvents()));
    return () => {
      live = false;
    };
  }, [events.dataUpdatedAt]);

  if (events.isPending) return <Skeleton height={86} radius={radius.card} />;
  if (events.error) return <ErrorState message={errorText(events.error)} onRetry={() => void events.refetch()} />;
  // The scanner is for events not over yet.
  const live = (events.data ?? []).filter((e) => !isPast(e.startsAt, 12));
  return (
    <View style={{ gap: space.sm }}>
      <Txt color={colors.muted}>Scan tickets at the door. Pick an event to open its scanner. It works offline once you download the guest list.</Txt>
      {!live.length ? (
        <EmptyState compact icon="scan" title="No upcoming events" body="Events show up here two months before they start." />
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
              <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
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
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
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
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface2, overflow: 'hidden' },
  order: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 60 },
});
