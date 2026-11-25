/**
 * Promo codes for an event (admins and managers): list, create (code, % off, optional use limit), pause / resume,
 * change the limit, delete. GET/POST /organizer/events/:id/promos, PATCH/DELETE …/promos/:code. Codes don't apply to
 * pay-what-you-want tickets (fans choose their own price), which the screen says when the event has any.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Label, OrgScreen } from '@/components/org-ui';
import { Badge, Button, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useOrgEvent, usePromos, type Promo } from '@/lib/organizer';
import { PROMO_PWYW_NOTE } from '@/lib/pwyw';
import { colors, radius, space } from '@/theme';

export default function Promos() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ev = useOrgEvent(id);
  const promos = usePromos(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('');
  const [limit, setLimit] = useState('');
  const [errors, setErrors] = useState<{ code?: string; percent?: string; limit?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ code: string; limit: string } | null>(null);

  const path = (c?: string) => `/organizer/events/${encodeURIComponent(id!)}/promos${c ? `/${encodeURIComponent(c)}` : ''}`;
  const reload = () => qc.invalidateQueries({ queryKey: ['organizer', 'promos', id] });

  const create = async () => {
    setMessage(null);
    const c = code.trim().toUpperCase();
    const p = Number(percent);
    const l = limit.trim() ? Number(limit) : null;
    const e: typeof errors = {};
    if (!/^[A-Z0-9]{3,15}$/.test(c)) e.code = '3 to 15 letters or numbers, no spaces.';
    if (!Number.isInteger(p) || p < 1 || p > 100) e.percent = 'A whole number from 1 to 100.';
    if (l !== null && (!Number.isInteger(l) || l < 1)) e.limit = 'A whole number, or leave it empty for no limit.';
    setErrors(e);
    if (Object.keys(e).length) return haptic.warning();
    setBusy('new');
    try {
      await api(path(), { body: { code: c, percent: p, ...(l !== null ? { limit: l } : {}) } });
      haptic.success();
      setCode('');
      setPercent('');
      setLimit('');
      setMessage({ ok: true, text: `${c} is live: ${p}% off at checkout.` });
      await reload();
    } catch (err) {
      haptic.error();
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const patch = async (p: Promo, body: { active?: boolean; limit?: number }, done: string) => {
    setMessage(null);
    setBusy(p.code);
    try {
      await api(path(p.code), { method: 'PATCH', body });
      haptic.success();
      setMessage({ ok: true, text: done });
      setEditing(null);
      await reload();
    } catch (err) {
      haptic.error();
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: Promo) => {
    const yes = await confirm({
      title: `Delete ${p.code}?`,
      message: p.used ? `It was used ${num(p.used)} ${p.used === 1 ? 'time' : 'times'}. Those orders keep their discount; nobody can use the code again.` : 'Nobody can use it after this.',
      confirmLabel: 'Delete code',
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    setBusy(p.code);
    try {
      await api(path(p.code), { method: 'DELETE' });
      haptic.success();
      setMessage({ ok: true, text: `${p.code} deleted.` });
      await reload();
    } catch (err) {
      haptic.error();
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <OrgScreen title="Promo codes" eyebrow={ev.data?.title} onRefresh={() => promos.refetch()}>
      {ev.data?.ticketTypes.some((t) => t.pricing === 'PWYW') ? (
        <Notice tone="plain" icon="tag">
          {`${PROMO_PWYW_NOTE} Codes here only take money off ${ev.data.ticketTypes.filter((t) => t.pricing !== 'PWYW').map((t) => t.name).join(', ') || 'fixed-price tickets'}.`}
        </Notice>
      ) : null}
      {message ? (
        <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
          {message.text}
        </Notice>
      ) : null}

      {promos.isPending ? (
        <Skeleton height={140} radius={radius.card} />
      ) : promos.error ? (
        <ErrorState message={errorText(promos.error)} onRetry={() => void promos.refetch()} />
      ) : !promos.data?.length ? (
        <EmptyState compact icon="tag" title="No promo codes yet" body="Codes take a percentage off at checkout. Share them with your fans, partners or team." />
      ) : (
        promos.data.map((p) => {
          const full = p.limit !== null && p.used >= p.limit;
          return (
            <View key={p.code} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="h3" style={{ flex: 1 }} selectable>
                  {p.code}
                </Txt>
                <Badge label={!p.active ? 'Paused' : full ? 'Used up' : 'Active'} tone={!p.active ? 'warning' : full ? 'plain' : 'success'} />
              </View>
              <Txt color={colors.muted}>
                {p.percent}% off · used {num(p.used)}
                {p.limit !== null ? ` of ${num(p.limit)}` : ' (no limit)'}
              </Txt>
              {editing?.code === p.code ? (
                <View style={{ gap: space.sm }}>
                  <Field label="Use limit" keyboardType="number-pad" value={editing.limit} onChangeText={(v) => setEditing({ code: p.code, limit: v.replace(/\D/g, '') })} hint={`At least ${Math.max(1, p.used)}.`} />
                  <View style={styles.btns}>
                    <Button
                      label="Save limit"
                      size="sm"
                      loading={busy === p.code}
                      onPress={() => {
                        const n = Number(editing.limit);
                        if (!Number.isInteger(n) || n < 1) return setMessage({ ok: false, text: 'Enter a whole number for the limit.' });
                        void patch(p, { limit: n }, `${p.code} can be used ${num(n)} times.`);
                      }}
                    />
                    <Button label="Cancel" variant="ghost" size="sm" onPress={() => setEditing(null)} />
                  </View>
                </View>
              ) : (
                <View style={styles.btns}>
                  <Button label={p.active ? 'Pause' : 'Resume'} variant="subtle" size="sm" disabled={busy !== null} onPress={() => void patch(p, { active: !p.active }, p.active ? `${p.code} is paused.` : `${p.code} works again.`)} />
                  <Button label="Change limit" variant="subtle" size="sm" disabled={busy !== null} onPress={() => setEditing({ code: p.code, limit: p.limit !== null ? String(p.limit) : '' })} />
                  <Button label="Delete" variant="danger" size="sm" disabled={busy !== null} onPress={() => void remove(p)} />
                </View>
              )}
            </View>
          );
        })
      )}

      <View style={[styles.card, { gap: space.md }]}>
        <Label>New code</Label>
        <Field label="Code" placeholder="EARLYBIRD" autoCapitalize="characters" autoCorrect={false} maxLength={15} value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} error={errors.code} />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Field style={{ flex: 1 }} label="% off" placeholder="20" keyboardType="number-pad" maxLength={3} value={percent} onChangeText={(v) => setPercent(v.replace(/\D/g, ''))} error={errors.percent} />
          <Field style={{ flex: 1 }} label="Use limit" placeholder="No limit" keyboardType="number-pad" value={limit} onChangeText={(v) => setLimit(v.replace(/\D/g, ''))} error={errors.limit} />
        </View>
        <Button label="Create code" icon="plus" loading={busy === 'new'} disabled={busy !== null && busy !== 'new'} onPress={() => void create()} />
      </View>
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
