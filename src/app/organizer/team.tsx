/**
 * The team (GET /organizer/orgs/:orgId/team): everyone can see it; admins invite by email with a role
 * (POST …/team; the person accepts after signing in), change roles (PATCH …/team/:memberId) and remove people
 * (DELETE, after the confirm sheet). Roles are the API's: Admin, Manager, Door staff. Nobody changes or removes
 * themselves (the API refuses).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { OptionSheet } from '@/components/option-sheet';
import { Label, OrgScreen } from '@/components/org-ui';
import { Badge, Button, Chip, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { emailOk, useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { isAdmin, membershipOf, ROLE_INFO, ROLE_NAME, useTeam, type OrgRole, type TeamMember } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

const ROLES: OrgRole[] = ['ADMIN', 'MANAGER', 'DOOR'];

export default function Team() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const m = membershipOf(orgs.data, orgId) ?? (orgs.data?.length === 1 ? orgs.data[0] : undefined);
  const id = m?.org.id;
  const admin = isAdmin(m?.role);
  const team = useTeam(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('DOOR');
  const [emailError, setEmailError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [changing, setChanging] = useState<TeamMember | null>(null);

  const base = `/organizer/orgs/${encodeURIComponent(id ?? '')}/team`;
  const reload = () => qc.invalidateQueries({ queryKey: ['organizer', 'team', id] });
  const me = (t: TeamMember) => t.email.toLowerCase() === user?.email.toLowerCase();

  const invite = async () => {
    setMessage(null);
    const e = email.trim().toLowerCase();
    if (!emailOk(e)) {
      setEmailError('Enter their email address.');
      return haptic.warning();
    }
    setEmailError('');
    setBusy('invite');
    try {
      await api(base, { body: { email: e, role } });
      haptic.success();
      setEmail('');
      setMessage({ ok: true, text: `Invited ${e} as ${ROLE_NAME[role].toLowerCase()}. They join when they sign in to Eventro with that email.` });
      await reload();
    } catch (err) {
      haptic.error();
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const setMemberRole = async (t: TeamMember, next: OrgRole) => {
    if (next === t.role) return;
    setMessage(null);
    setBusy(t.id);
    try {
      await api(`${base}/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { role: next } });
      haptic.success();
      setMessage({ ok: true, text: `${t.user?.name ?? t.email} is now ${ROLE_NAME[next].toLowerCase()}.` });
      await reload();
    } catch (err) {
      haptic.error();
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: TeamMember) => {
    const who = t.user?.name ?? t.email;
    const yes = await confirm({
      title: t.status === 'INVITED' ? `Cancel ${t.email}’s invite?` : `Remove ${who}?`,
      message: t.status === 'INVITED' ? 'They won’t join the team when they sign in.' : 'They lose access to this organization’s events, sales and door scanner straight away.',
      confirmLabel: t.status === 'INVITED' ? 'Cancel invite' : 'Remove from team',
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    setBusy(t.id);
    try {
      await api(`${base}/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      haptic.success();
      setMessage({ ok: true, text: `${who} ${t.status === 'INVITED' ? 'won’t be joining' : 'was removed'}.` });
      await reload();
    } catch (err) {
      haptic.error();
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <OrgScreen title="Team" eyebrow={m?.org.name} onRefresh={() => team.refetch()}>
      {message ? (
        <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
          {message.text}
        </Notice>
      ) : null}
      {orgs.isPending || team.isPending ? (
        <Skeleton height={180} radius={radius.card} />
      ) : !m ? (
        <EmptyState icon="users" title="No organization" />
      ) : team.error ? (
        <ErrorState message={errorText(team.error)} onRetry={() => void team.refetch()} />
      ) : (
        <>
          {!admin ? (
            <Txt variant="small" color={colors.muted}>
              Only admins can invite people or change roles.
            </Txt>
          ) : null}
          {(team.data ?? []).map((t) => (
            <View key={t.id} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {t.user?.name ?? t.email}
                    {me(t) ? ' (you)' : ''}
                  </Txt>
                  {t.user?.name ? (
                    <Txt variant="small" color={colors.muted} numberOfLines={1}>
                      {t.email}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={ROLE_NAME[t.role] ?? t.role} tone={t.role === 'ADMIN' ? 'accent' : 'plain'} />
                  {t.status === 'INVITED' ? <Badge label="Invited" tone="warning" /> : null}
                </View>
              </View>
              {admin && !me(t) ? (
                <View style={styles.btns}>
                  <Button label="Change role" variant="subtle" size="sm" disabled={busy !== null} loading={busy === t.id} onPress={() => setChanging(t)} />
                  <Button label={t.status === 'INVITED' ? 'Cancel invite' : 'Remove'} variant="danger" size="sm" disabled={busy !== null} onPress={() => void remove(t)} />
                </View>
              ) : null}
            </View>
          ))}

          {admin ? (
            <View style={[styles.card, { gap: space.md }]}>
              <Label>Invite someone</Label>
              <Field label="Email" placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="off" value={email} onChangeText={setEmail} error={emailError} />
              <View style={{ gap: space.sm }}>
                <Txt variant="smallStrong" color={colors.muted}>
                  Role
                </Txt>
                <View style={styles.btns}>
                  {ROLES.map((r) => (
                    <Chip key={r} label={ROLE_NAME[r]} active={role === r} onPress={() => setRole(r)} />
                  ))}
                </View>
                <Txt variant="small" color={colors.dim}>
                  {ROLE_INFO[role]}
                </Txt>
              </View>
              <Button label="Send invite" icon="send" loading={busy === 'invite'} disabled={busy !== null && busy !== 'invite'} onPress={() => void invite()} />
            </View>
          ) : null}
        </>
      )}
      <OptionSheet<OrgRole>
        visible={!!changing}
        title={changing ? `Role for ${changing.user?.name ?? changing.email}` : 'Role'}
        options={ROLES.map((r) => ({ value: r, label: ROLE_NAME[r], detail: undefined }))}
        value={changing?.role ?? 'DOOR'}
        onPick={(r) => changing && void setMemberRole(changing, r)}
        onClose={() => setChanging(null)}
      />
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
