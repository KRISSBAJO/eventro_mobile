/**
 * Payouts, read-only (org admins): what's coming next, today's sales so far, the payout account and the last
 * 30 days (GET /organizer/orgs/:orgId/payouts). Setting up or changing the bank account happens only on the website
 * (Stripe Connect or Paystack): the app never asks for bank details.
 */
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Group, Label, OrgScreen, StatTile, TileRow } from '@/components/org-ui';
import { Badge, Button, Divider, EmptyState, ErrorState, Notice, Skeleton, Txt } from '@/components/ui';
import { errorText } from '@/lib/api';
import { countryName, money } from '@/lib/format';
import { isAdmin, membershipOf, openWeb, usePayouts, webPaths } from '@/lib/organizer';
import { useAuth } from '@/lib/auth';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

export default function PayoutsScreen() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const m = membershipOf(orgs.data, orgId) ?? (orgs.data?.length === 1 ? orgs.data[0] : undefined);
  const id = m?.org.id;
  const admin = isAdmin(m?.role);
  const p = usePayouts(id, admin);

  const body = () => {
    if (orgs.isPending || (admin && p.isPending)) return <Skeleton height={220} radius={radius.card} />;
    if (!m) return <EmptyState icon="cash" title="No organization" body="Payouts belong to an organizer profile." />;
    if (!admin) return <EmptyState icon="lock" title="Admins only" body="Ask an admin of your team to see payouts." />;
    if (p.error || !p.data) return <ErrorState message={p.error ? errorText(p.error) : 'Couldn’t load payouts.'} onRetry={() => void p.refetch()} />;
    const d = p.data;
    const acct = d.payoutMethod;
    const next = d.holdUntil ? 'After the 24-hour pause for a bank change' : acct ? (d.schedule === 'DAILY' ? 'Tomorrow, 9:00 AM' : 'Next Monday, 9:00 AM') : 'Once a payout account is connected';
    return (
      <>
        {!acct ? (
          <Notice tone="warning" icon="cash" title="Payouts aren’t set up">
            {`Connect a bank account on the Eventro website to get paid in ${d.currency}. It goes through Stripe or Paystack; the app never asks for bank details.`}
          </Notice>
        ) : d.holdUntil ? (
          <Notice tone="warning" icon="lock" title="Payouts are paused for 24 hours">
            The payout account changed recently. Payouts start again after the pause.
          </Notice>
        ) : null}
        <TileRow>
          <StatTile label="Next payout" value={money(d.nextPayoutCents, d.currency, { decimals: true })} sub={next} tone="success" />
          <StatTile label="Today so far" value={money(d.pendingCents, d.currency, { decimals: true })} sub={`Today’s sales after the 3.5% fee${d.converted ? `, in ${d.currency}` : ''}`} />
        </TileRow>
        <View style={styles.card}>
          <Label>Payout account</Label>
          {acct ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="title" style={{ flex: 1 }}>
                  {acct.bankName ?? (acct.provider === 'stripe' ? 'Connected through Stripe' : 'Bank account')}
                  {acct.bankLast4 ? ` ···· ${acct.bankLast4}` : ''}
                </Txt>
                <Badge label="Connected" tone="success" />
              </View>
              <Txt variant="small" color={colors.muted}>
                {[acct.accountName, acct.country ? countryName(acct.country) : null, acct.provider === 'paystack' ? 'Paystack' : 'Stripe', d.schedule === 'DAILY' ? 'Paid daily' : 'Paid weekly'].filter(Boolean).join(' · ')}
              </Txt>
            </>
          ) : (
            <Txt color={colors.muted}>Not set up</Txt>
          )}
        </View>
        <View style={{ gap: space.sm }}>
          <Label>Last 30 days</Label>
          {d.history.length ? (
            <Group>
              {d.history.map((h, i) => (
                <View key={h.salesDate}>
                  {i ? <Divider style={{ marginLeft: space.lg }} /> : null}
                  <View style={styles.row}>
                    <Txt style={{ flex: 1 }}>Sales on {day(h.salesDate)}</Txt>
                    <Txt variant="bodyStrong">{money(h.amountCents, d.currency, { decimals: true })}</Txt>
                    <Badge label={acct ? 'Paid' : 'Owed'} tone={acct ? 'success' : 'warning'} />
                  </View>
                </View>
              ))}
            </Group>
          ) : (
            <Txt variant="small" color={colors.dim}>
              {d.pendingCents ? 'Nothing before today yet. Today’s sales are paid out with the next payout.' : 'No sales in the last 30 days.'}
            </Txt>
          )}
        </View>
        {d.converted ? (
          <Txt variant="small" color={colors.dim}>
            Sales in other currencies are converted to {d.currency} at today’s rate, so those amounts are approximate.
          </Txt>
        ) : null}
      </>
    );
  };

  return (
    <OrgScreen
      title="Payouts"
      eyebrow={m?.org.name}
      onRefresh={() => p.refetch()}
      footer={admin && p.data ? <Button label={p.data.payoutMethod ? 'Change payout account on the web' : 'Set up payouts on the web'} iconRight="external" onPress={() => openWeb(webPaths.payouts)} /> : undefined}>
      {body()}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52 },
});
