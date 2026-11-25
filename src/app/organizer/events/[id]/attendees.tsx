/**
 * An event's attendees (GET /organizer/events/:id/attendees?q=&status=): search by name, email or ticket number,
 * filter by checked in or not, and by paid or comp (`type`), and check someone in by hand (POST …/check-in with the
 * ticket id) or undo it (DELETE …/check-in/:ticketId), as on the website. Each row says Paid or Comp (with the comp's
 * group); the totals at the top keep sales, comps and guest-list arrivals apart (the guest list has its own screen).
 *
 * Donations: when orders on the event carry one (GET /organizer/events/:id/donations, sales and resale orders), a
 * "Tickets | Donations" switch shows them: buyer, amount, what's been refunded, the cause they gave to and a resale
 * badge. Org admins (`canRefund`) can refund what's left of a donation (POST …/orders/:orderId/refund-donation, with
 * an optional reason): it goes back to the buyer's card and the tickets are kept. When the organizer had already been
 * paid for that order, the amount is recorded as owed to Eventro (`donationOwedCents`), and the screen says so.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { Segmented } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { OrgScreen } from '@/components/org-ui';
import { Badge, Button, Chip, EmptyState, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { deviceId } from '@/lib/device';
import { localStamp, money, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useAttendees, useEventDonations, useEventStats, useOrgEvent, type DonationOrder, type DonationRefund, type EventDonations } from '@/lib/organizer';
import type { Attendee, CheckInAnswer } from '@/lib/types';
import { colors, radius, space, touch } from '@/theme';

type Filter = '' | 'checked-in' | 'not-checked-in';
const FILTERS: { id: Filter; label: string }[] = [
  { id: '', label: 'Everyone' },
  { id: 'not-checked-in', label: 'Not in yet' },
  { id: 'checked-in', label: 'Checked in' },
];
type Kind = '' | 'paid' | 'comp';
const KINDS: { id: Kind; label: string }[] = [
  { id: '', label: 'Paid and comps' },
  { id: 'paid', label: 'Paid' },
  { id: 'comp', label: 'Comps' },
];
type Show = 'tickets' | 'donations';
const REASON_MAX = 300;

export default function Attendees() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ev = useOrgEvent(id);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('');
  const [kind, setKind] = useState<Kind>('');
  const list = useAttendees(id, q, filter, kind);
  const stats = useEventStats(id);
  const s = stats.data;
  const donations = useEventDonations(id);
  const hasDonations = !!donations.data?.items.length;
  const [show, setShow] = useState<Show>('tickets');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Search as they type, a moment after they stop.
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(t);
  }, [text]);

  const toggle = async (a: Attendee) => {
    setMessage(null);
    const undo = a.status === 'CHECKED_IN';
    if (undo) {
      const yes = await confirm({ title: `Undo ${a.holderName}’s check-in?`, message: 'Their ticket works at the door again.', confirmLabel: 'Undo check-in', destructive: true });
      if (!yes) return;
    }
    setBusy(a.id);
    try {
      if (undo) {
        await api(`/organizer/events/${encodeURIComponent(id!)}/check-in/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
        haptic.success();
        setMessage({ ok: true, text: `${a.holderName} is no longer checked in.` });
      } else {
        const r = await api<CheckInAnswer>(`/organizer/events/${encodeURIComponent(id!)}/check-in`, { body: { code: a.id, deviceId: await deviceId() } });
        if (r.result === 'ok') haptic.success();
        else haptic.warning();
        setMessage({ ok: r.result === 'ok', text: r.result === 'ok' ? `${a.holderName} is checked in.` : r.message });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['organizer', 'attendees', id] }), qc.invalidateQueries({ queryKey: ['organizer', 'stats', id] })]);
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const rows = list.data ?? [];
  return (
    <OrgScreen title="Attendees" eyebrow={ev.data?.title} onRefresh={() => Promise.all([list.refetch(), stats.refetch(), donations.refetch()])}>
      {s ? (
        <View style={styles.totals} accessible accessibilityLabel={`Sold ${s.sold}${s.comps ? `, comps ${s.comps.issued}` : ''}${s.guestList ? `, guest list ${s.guestList.arrived} of ${s.guestList.expected} here` : ''}`}>
          <Total label="Sold" value={num(s.sold)} />
          {s.comps ? <Total label="Comps" value={num(s.comps.issued)} sub={`${num(s.comps.checkedIn)} in`} /> : null}
          {s.guestList ? <Total label="Guest list" value={`${num(s.guestList.arrived)}/${num(s.guestList.expected)}`} sub="here" onPress={() => router.push({ pathname: '/organizer/events/[id]/guest-list', params: { id: id! } })} /> : null}
        </View>
      ) : null}
      {hasDonations ? (
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { id: 'tickets', label: 'Tickets' },
            { id: 'donations', label: `Donations · ${num(donations.data!.items.length)}` },
          ]}
        />
      ) : null}
      {hasDonations && show === 'donations' ? (
        <Donations eventId={id!} data={donations.data!} currency={ev.data?.currency ?? donations.data!.items[0]?.currency ?? 'USD'} />
      ) : (
        <>
          <Field label="Search" placeholder="Name, email or ticket number" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Chip key={f.id || 'all'} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
            ))}
          </View>
          <View style={styles.chips}>
            {KINDS.map((k) => (
              <Chip key={k.id || 'both'} label={k.label} active={kind === k.id} onPress={() => setKind(k.id)} />
            ))}
          </View>
          {message ? (
            <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
              {message.text}
            </Notice>
          ) : null}
          {list.isPending ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={72} radius={radius.card} />
              <Skeleton height={72} radius={radius.card} />
              <Skeleton height={72} radius={radius.card} />
            </View>
          ) : list.error ? (
            <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
          ) : !rows.length ? (
            <EmptyState compact icon="users" title={q || filter || kind ? 'Nobody matches' : 'No attendees yet'} body={q || filter || kind ? 'Try another name or filter.' : 'Tickets show up here as soon as they’re sold or comped.'} />
          ) : (
            <>
              <Txt variant="small" color={colors.dim}>
                {num(rows.length)} {rows.length === 1 ? 'ticket' : 'tickets'}
                {rows.length >= 5000 ? ' (the first 5,000: search to narrow it down)' : ''}
              </Txt>
              {rows.slice(0, 300).map((a) => {
                const inside = a.status === 'CHECKED_IN';
                const seat = [a.section, a.row ? `Row ${a.row}` : null, a.seat !== null ? `Seat ${a.seat}` : null].filter(Boolean).join(' · ');
                return (
                  <View key={a.id} style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {a.holderName}
                      </Txt>
                      <Txt variant="small" color={colors.muted} numberOfLines={1}>
                        {a.ticketType.name}
                        {seat ? ` · ${seat}` : ''}
                      </Txt>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        <Badge label={a.type === 'COMP' ? (a.compGroup ? `Comp · ${a.compGroup}` : 'Comp') : 'Paid'} tone={a.type === 'COMP' ? 'accent' : 'plain'} />
                      </View>
                      <Txt variant="mono" color={colors.dim} numberOfLines={1}>
                        {a.id}
                      </Txt>
                      {inside && a.checkedInAt ? <Badge label={`In · ${localStamp(new Date(a.checkedInAt).getTime())}`} tone="success" style={{ marginTop: 4 }} /> : a.status === 'TRANSFER_PENDING' ? <Badge label="Transfer pending" tone="warning" style={{ marginTop: 4 }} /> : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={inside ? `Undo check-in for ${a.holderName}` : `Check in ${a.holderName}`}
                      disabled={busy !== null || a.status === 'TRANSFER_PENDING'}
                      onPress={() => void toggle(a)}
                      style={({ pressed }) => [styles.btn, inside ? styles.btnUndo : styles.btnIn, (busy !== null || a.status === 'TRANSFER_PENDING') && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
                      {busy === a.id ? (
                        <ActivityIndicator color={inside ? colors.text : colors.accentInk} />
                      ) : (
                        <>
                          <Icon name={inside ? 'undo' : 'check'} size={16} color={inside ? colors.text : colors.accentInk} />
                          <Txt variant="smallStrong" color={inside ? colors.text : colors.accentInk}>
                            {inside ? 'Undo' : 'Check in'}
                          </Txt>
                        </>
                      )}
                    </Pressable>
                  </View>
                );
              })}
              {rows.length > 300 ? (
                <Txt variant="small" color={colors.dim}>
                  Showing 300 of {num(rows.length)}. Search to find someone.
                </Txt>
              ) : null}
            </>
          )}
        </>
      )}
    </OrgScreen>
  );
}

const cash = (cents: number, currency: string) => money(cents, currency, { decimals: true });

/** The orders with a donation, and (org admins) refunding what's left of one. */
function Donations({ eventId, data, currency }: { eventId: string; data: EventDonations; currency: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  /** the row whose refund form is open, its reason, and the one being refunded */
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refund = async (d: DonationOrder) => {
    const cause = d.cause ?? data.cause;
    const amount = cash(d.leftCents, d.currency || currency);
    const yes = await confirm({
      title: cause ? `Refund ${amount} donated to ${cause} by ${d.buyerName}?` : `Refund ${d.buyerName}’s ${amount} donation?`,
      message: 'It goes back to their card; the tickets are kept. This can’t be undone.',
      confirmLabel: 'Refund donation',
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    setBusy(d.orderId);
    try {
      const r = await api<DonationRefund>(`/organizer/events/${encodeURIComponent(eventId)}/orders/${encodeURIComponent(d.orderId)}/refund-donation`, {
        body: reason.trim() ? { reason: reason.trim().slice(0, REASON_MAX) } : {},
      });
      haptic.success();
      const cur = r.currency || d.currency || currency;
      const owed = r.donationOwedCents > 0 ? ` You’d already been paid for this order, so ${cash(r.donationOwedCents, cur)} is recorded as owed to Eventro.` : '';
      setMessage({ ok: true, text: `Refunded ${cash(r.refundedNowCents, cur)} to ${d.buyerName}. We’ve emailed them.${owed}` });
      setOpen(null);
      setReason('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['organizer', 'donations', eventId] }),
        qc.invalidateQueries({ queryKey: ['organizer', 'stats', eventId] }),
        qc.invalidateQueries({ queryKey: ['organizer', 'payouts'] }),
        qc.invalidateQueries({ queryKey: ['organizer', 'events'] }),
      ]);
    } catch (e) {
      haptic.error();
      setMessage({ ok: false, text: errorText(e) });
      // Someone may have refunded it meanwhile (400) or the order changed (409): show what's there now.
      void qc.invalidateQueries({ queryKey: ['organizer', 'donations', eventId] });
    } finally {
      setBusy(null);
    }
  };

  const { summary } = data;
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.totals} accessible accessibilityLabel={`Donations ${cash(summary.cents, currency)} from ${summary.orders} orders${summary.refundedCents ? `, ${cash(summary.refundedCents, currency)} refunded` : ''}`}>
        <Total label="Donated" value={cash(summary.cents, currency)} sub={summary.refundedCents ? `· ${cash(summary.refundedCents, currency)} refunded` : undefined} />
        <Total label="Orders" value={num(summary.orders)} />
      </View>
      {data.cause ? (
        <Txt variant="small" color={colors.muted}>
          {`Donations to ${data.cause}, net of refunds and separate from ticket sales.`}
        </Txt>
      ) : null}
      {!data.canRefund ? (
        <Notice tone="plain" icon="lock">
          Only admins of the team can refund donations.
        </Notice>
      ) : null}
      {message ? (
        <Notice tone={message.ok ? 'success' : 'warning'} icon={message.ok ? 'check' : 'alert'}>
          {message.text}
        </Notice>
      ) : null}
      {data.items.slice(0, 300).map((d) => {
        const cur = d.currency || currency;
        const cause = d.cause ?? data.cause;
        const refundable = data.canRefund && d.leftCents > 0;
        return (
          <View key={d.orderId} style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {d.buyerName}
              </Txt>
              <Txt variant="bodyStrong">{cash(d.donationCents, cur)}</Txt>
            </View>
            <Txt variant="small" color={colors.muted} numberOfLines={1}>
              {d.email}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              {cause ? <Badge label={`To ${cause}`} /> : null}
              {d.resale ? <Badge label="Resale" tone="accent" /> : null}
              {d.donationRefundedCents > 0 ? <Badge label={d.leftCents > 0 ? `${cash(d.donationRefundedCents, cur)} refunded` : 'Refunded'} tone="warning" /> : null}
            </View>
            {d.paidAt ? (
              <Txt variant="tiny" color={colors.dim}>
                {`Paid ${localStamp(new Date(d.paidAt).getTime())}`}
              </Txt>
            ) : null}
            {refundable && open === d.orderId ? (
              <View style={{ gap: space.sm, marginTop: space.xs }}>
                <Field label="Reason (optional)" placeholder="e.g. They asked for it back" value={reason} onChangeText={setReason} maxLength={REASON_MAX} />
                <View style={styles.btns}>
                  <Button label={`Refund ${cash(d.leftCents, cur)}`} variant="danger" size="sm" loading={busy === d.orderId} disabled={busy !== null} onPress={() => void refund(d)} />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onPress={() => {
                      setOpen(null);
                      setReason('');
                    }}
                  />
                </View>
              </View>
            ) : refundable ? (
              <View style={styles.btns}>
                <Button
                  label="Refund donation"
                  icon="undo"
                  variant="subtle"
                  size="sm"
                  disabled={busy !== null}
                  onPress={() => {
                    setMessage(null);
                    setReason('');
                    setOpen(d.orderId);
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {data.items.length > 300 ? (
        <Txt variant="small" color={colors.dim}>
          Showing the newest 300 of {num(data.items.length)}.
        </Txt>
      ) : null}
    </View>
  );
}

/** One of the totals at the top. */
function Total({ label, value, sub, onPress }: { label: string; value: string; sub?: string; onPress?: () => void }) {
  const body = (
    <>
      <Txt variant="eyebrow" color={colors.dim} numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="title" numberOfLines={1}>
        {value}
        {sub ? (
          <Txt variant="small" color={colors.muted}>
            {` ${sub}`}
          </Txt>
        ) : null}
      </Txt>
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}${sub ? ` ${sub}` : ''}. Open`} onPress={onPress} style={({ pressed }) => [styles.total, pressed && { opacity: 0.7 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.total}>{body}</View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  total: { flex: 1, gap: 2, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 104, height: touch, paddingHorizontal: space.md, borderRadius: radius.pill },
  btnIn: { backgroundColor: colors.accent },
  btnUndo: { borderWidth: 1, borderColor: colors.line2 },
});
