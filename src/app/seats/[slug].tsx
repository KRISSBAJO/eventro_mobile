/**
 * Choose seats for an event with a seat map: how many, then a section (GET /events/:slug/availability for places
 * left and the best seats together), then, in reserved sections, the exact seats on a tappable row-by-row grid
 * (sold and held ones from GET /events/:slug/sections/:id/seats). The best seats together are picked to start
 * with; tap others to change them. "Hold" reserves exactly those (POST /holds with sectionId and seats) for
 * 10 minutes and opens checkout.
 *
 * A phone screen is too small for the whole venue drawing, so sections are a list and seats a grid of
 * finger-sized buttons that scrolls sideways in wide sections.
 *
 * A pay-what-you-want tier is held at the amount picked on the event page (`?amount=`, base cents), or its suggested
 * price when it comes from somewhere else; the fan can still change it at checkout.
 */
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { ScreenHeader } from '@/components/screen-header';
import { Badge, Button, EmptyState, ErrorState, Notice, Skeleton, Stepper, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { money } from '@/lib/format';
import { allInOf, amountProblem, isPwyw, startAmount } from '@/lib/pwyw';
import { haptic } from '@/lib/haptics';
import { useEvent } from '@/lib/queries';
import type { Availability, EventDetail, HoldCreated, MapSection, SectionSeats, TicketType } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

/** Seat buttons: big enough to tap (with the gap, about a fingertip). */
const SEAT = 34;
const GAP = 6;

/** Row labels as the API makes them: A … Z, AA, AB … */
function rowLabel(index: number) {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const sectionTitle = (s: Pick<MapSection, 'label' | 'level'>) => {
  const numeric = /^[A-Z]{0,2}\d{1,4}[A-Z]?$/i.test(s.label);
  if (s.level) return numeric ? `${s.level} ${s.label}` : s.label;
  return numeric ? `Section ${s.label}` : s.label;
};

type SeatChoice = { row: string; seat: number };
const key = (p: SeatChoice) => `${p.row}:${p.seat}`;

export default function Seats() {
  const { slug, tier: tierParam, qty: qtyParam, amount: amountParam } = useLocalSearchParams<{ slug: string; tier?: string; qty?: string; amount?: string }>();
  const insets = useSafeAreaInsets();
  const ev = useEvent(slug);
  const e = ev.data;

  if (ev.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm, paddingHorizontal: gutter, gap: space.md }}>
        <ScreenHeader title="Choose seats" />
        <Skeleton height={60} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </View>
    );
  }
  if (ev.error || !e) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm, paddingHorizontal: gutter }}>
        <ScreenHeader title="Choose seats" />
        {ev.error instanceof ApiError && ev.error.status === 404 ? <EmptyState icon="ticket" title="Event not found" /> : <ErrorState message={errorText(ev.error)} onRetry={() => ev.refetch()} />}
      </View>
    );
  }
  return <Picker e={e} tierParam={tierParam} qtyParam={Number(qtyParam) || 2} amountParam={amountParam} />;
}

function Picker({ e, tierParam, qtyParam, amountParam }: { e: EventDetail; tierParam?: string; qtyParam: number; amountParam?: string }) {
  const insets = useSafeAreaInsets();
  const types = new Map(e.ticketTypes.map((t) => [t.id, t]));
  const sections = (e.seatMap?.sections ?? []).filter((s) => types.has(s.ticketTypeId));
  const [qty, setQty] = useState(Math.max(1, Math.min(8, qtyParam)));
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyTier, setOnlyTier] = useState<string | null>(tierParam && types.has(tierParam) ? tierParam : null);

  const avail = useQuery({
    queryKey: ['event', e.slug, 'availability', qty],
    queryFn: () => api<Availability>(`/events/${encodeURIComponent(e.slug)}/availability?qty=${qty}`),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
  const byId = new Map((avail.data?.sections ?? []).map((a) => [a.id, a]));
  const shown = sections
    .filter((s) => !onlyTier || s.ticketTypeId === onlyTier)
    .map((s) => ({ s, t: types.get(s.ticketTypeId)!, a: byId.get(s.id) }))
    .sort((x, y) => Number(!!y.a?.fits) - Number(!!x.a?.fits) || x.t.priceCents - y.t.priceCents);
  const open = shown.find((x) => x.s.id === openId) ?? null;
  const tiersInMap = [...new Set(sections.map((s) => s.ticketTypeId))].map((id) => types.get(id)!).sort((a, b) => a.priceCents - b.priceCents);

  if (!sections.length) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm, paddingHorizontal: gutter }}>
        <ScreenHeader title="Choose seats" />
        <EmptyState icon="seat" title="No seat map for this event" body="Tickets are general admission or picked for you." action="Back to the event" onAction={() => router.back()} />
      </View>
    );
  }

  if (open) {
    // Pay what you want: the amount from the event page for that tier, else where its suggested price starts.
    const pw = isPwyw(open.t) ? open.t.pwyw : null;
    const asked = open.t.id === tierParam && amountParam && /^\d+$/.test(amountParam) ? Number(amountParam) : null;
    const amount = pw ? (asked !== null && !amountProblem(asked, pw, e.currency) ? asked : startAmount(pw)) : null;
    return <SectionSeatsView e={e} section={open.s} tier={open.t} qty={qty} amount={amount} best={open.a?.row ? open.a.seats.map((n) => ({ row: open.a!.row!, seat: n })) : []} onBack={() => setOpenId(null)} onQty={setQty} />;
  }

  const maxQty = Math.max(1, Math.min(8, ...tiersInMap.map((t) => t.maxPerOrder)));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.lg }}>
        <ScreenHeader title="Choose seats" eyebrow={e.title} />
        <View style={styles.qtyRow}>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">How many?</Txt>
            <Txt variant="small" color={colors.dim}>
              Sections that can seat you together are listed first.
            </Txt>
          </View>
          <Stepper value={qty} max={maxQty} onChange={setQty} label="Number of tickets" />
        </View>

        {tiersInMap.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            <TierChip label="All prices" on={!onlyTier} onPress={() => setOnlyTier(null)} />
            {tiersInMap.map((t) => (
              <TierChip key={t.id} label={`${t.name} · ${money(t.priceCents, e.currency)}`} on={onlyTier === t.id} onPress={() => setOnlyTier(t.id)} />
            ))}
          </ScrollView>
        ) : null}

        {avail.error && !avail.data ? <ErrorState compact message={errorText(avail.error)} onRetry={() => avail.refetch()} /> : null}
        <View style={{ gap: space.sm }}>
          {shown.map(({ s, t, a }) => {
            const fits = !!a?.fits && qty <= t.maxPerOrder;
            const left = a?.available ?? s.available ?? 0;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: !fits }}
                accessibilityLabel={`${sectionTitle(s)}, ${t.name}, ${money(t.priceCents, e.currency)} each, ${left} left${fits ? '' : `, no ${qty} seats together`}`}
                disabled={!fits}
                onPress={() => {
                  haptic.select();
                  setOpenId(s.id);
                }}
                style={({ pressed }) => [styles.section, !fits && { opacity: 0.45 }, pressed && { backgroundColor: colors.surface2 }]}>
                <View style={styles.sectionIcon}>
                  <Icon name={s.seating === 'ga' ? 'users' : 'seat'} size={19} color={fits ? colors.accent : colors.dim} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="title" numberOfLines={1}>
                    {sectionTitle(s)}
                  </Txt>
                  <Txt variant="small" color={colors.muted} numberOfLines={1}>
                    {t.name} · {s.seating === 'ga' ? 'Standing' : `${s.rows ?? 0} rows`} · {avail.isPending ? '…' : `${left} left`}
                  </Txt>
                  {fits && a?.row ? (
                    <Txt variant="tiny" color={colors.success}>
                      Best together: Row {a.row}, seats {a.seats[0]}–{a.seats[a.seats.length - 1]}
                    </Txt>
                  ) : !fits && !avail.isPending ? (
                    <Txt variant="tiny" color={colors.dim}>
                      {left ? `No ${qty} seats together` : 'Sold out'}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt variant="price">{money(t.priceCents, e.currency)}</Txt>
                  <Txt variant="tiny" color={colors.dim}>
                    each, all-in
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function TierChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={[styles.chip, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      <Txt variant="smallStrong" color={on ? colors.accentInk : colors.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

function SectionSeatsView({ e, section, tier, qty, amount, best, onBack, onQty }: { e: EventDetail; section: MapSection; tier: TicketType; qty: number; amount: number | null; best: SeatChoice[]; onBack: () => void; onQty: (n: number) => void }) {
  const insets = useSafeAreaInsets();
  const reserved = section.seating === 'reserved';
  const pw = isPwyw(tier) ? tier.pwyw : null;
  const unit = pw && amount !== null ? allInOf(amount, pw.feePermille) : tier.priceCents;
  const seats = useQuery({
    queryKey: ['event', e.slug, 'section', section.id],
    queryFn: () => api<SectionSeats>(`/events/${encodeURIComponent(e.slug)}/sections/${encodeURIComponent(section.id)}/seats`),
    enabled: reserved,
    staleTime: 5_000,
  });
  const taken = new Set(seats.data?.taken ?? []);
  // Start from the best seats together; the fan can change them.
  const [picked, setPicked] = useState<SeatChoice[]>(() => best.slice(0, qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = picked.filter((p) => !taken.has(key(p)));
  const ready = !reserved || chosen.length === qty;
  const rows = section.rows ?? 0;
  const per = section.seatsPerRow ?? 0;

  const tap = (p: SeatChoice) => {
    haptic.select();
    setError('');
    setPicked((cur) => {
      if (cur.some((c) => key(c) === key(p))) return cur.filter((c) => key(c) !== key(p));
      // Full: the seat picked longest ago makes way for the new one.
      const next = [...cur.filter((c) => !taken.has(key(c))), p];
      return next.length > qty ? next.slice(next.length - qty) : next;
    });
  };

  const hold = async () => {
    if (!ready) {
      haptic.warning();
      setError(`SeatChoice ${qty - chosen.length} more seat${qty - chosen.length === 1 ? '' : 's'}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const h = await api<HoldCreated>('/holds', { body: { ticketTypeId: tier.id, quantity: qty, sectionId: section.id, ...(reserved ? { seats: chosen } : {}), ...(pw && amount !== null ? { amountCents: amount } : {}) } });
      haptic.success();
      router.push({ pathname: '/checkout/[holdId]', params: { holdId: h.id } });
    } catch (err) {
      haptic.error();
      setError(errorText(err));
      void seats.refetch();
    } finally {
      setBusy(false);
    }
  };

  const gridWidth = per * (SEAT + GAP) + 36;
  const sorted = [...chosen].sort((a, b) => a.row.localeCompare(b.row) || a.seat - b.seat);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 170 + insets.bottom, gap: space.lg }}>
        <View style={{ paddingHorizontal: gutter, gap: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to sections" onPress={onBack} hitSlop={8} style={styles.backBtn}>
              <Icon name="back" size={20} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Txt variant="eyebrow" color={colors.accent} numberOfLines={1}>
                {tier.name} · {money(unit, e.currency)} each{pw ? ', your price' : ''}
              </Txt>
              <Txt variant="h2" accessibilityRole="header" numberOfLines={1}>
                {sectionTitle(section)}
              </Txt>
            </View>
          </View>
          <View style={styles.qtyRow}>
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              Tickets
            </Txt>
            <Stepper
              value={qty}
              max={Math.max(1, Math.min(8, tier.maxPerOrder))}
              onChange={(n) => {
                onQty(n);
                // Fewer tickets: keep the first seats. More: they pick the extra ones.
                setPicked((cur) => cur.slice(0, n));
              }}
              label="Number of tickets"
            />
          </View>
          {reserved ? (
            <View style={styles.legend}>
              <Legend style={styles.seatFree} label="Free" />
              <Legend style={styles.seatOn} label="Yours" />
              <Legend style={styles.seatTaken} label="Taken" />
            </View>
          ) : null}
        </View>

        {!reserved ? (
          <View style={{ paddingHorizontal: gutter }}>
            <Notice tone="plain" icon="users" title="Standing area">
              {`No seat numbers here: find your spot on the night. ${section.available ?? ''} places left.`.replace('  ', ' ')}
            </Notice>
          </View>
        ) : seats.isPending ? (
          <View style={{ paddingHorizontal: gutter }}>
            <Skeleton height={220} />
          </View>
        ) : seats.error ? (
          <ErrorState compact message={errorText(seats.error)} onRetry={() => seats.refetch()} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingHorizontal: gutter }}>
            <View style={{ width: gridWidth, gap: GAP }}>
              <View style={styles.stage}>
                <Txt variant="eyebrow" color={colors.muted}>
                  Stage this way
                </Txt>
              </View>
              {Array.from({ length: rows }, (_, ri) => {
                const row = rowLabel(ri);
                return (
                  <View key={row} style={{ flexDirection: 'row', alignItems: 'center', gap: GAP }}>
                    <Txt variant="mono" color={colors.dim} style={{ width: 30, textAlign: 'center' }}>
                      {row}
                    </Txt>
                    {Array.from({ length: per }, (_, si) => {
                      const p = { row, seat: si + 1 };
                      const isTaken = taken.has(key(p));
                      const on = !isTaken && picked.some((c) => key(c) === key(p));
                      return (
                        <Pressable
                          key={si}
                          accessibilityRole="button"
                          accessibilityLabel={`Row ${row}, seat ${p.seat}${isTaken ? ', taken' : on ? ', yours' : ''}`}
                          accessibilityState={{ disabled: isTaken, selected: on }}
                          disabled={isTaken}
                          onPress={() => tap(p)}
                          style={[styles.seat, isTaken ? styles.seatTaken : on ? styles.seatOn : styles.seatFree]}>
                          {isTaken ? (
                            <Icon name="close" size={12} color={colors.dim} />
                          ) : (
                            <Txt variant="tiny" color={on ? colors.accentInk : colors.text}>
                              {p.seat}
                            </Txt>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        {error ? <Notice icon="alert">{error}</Notice> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="small" color={colors.dim} numberOfLines={2}>
              {reserved ? (sorted.length ? sorted.map((p) => `${p.row}${p.seat}`).join(', ') : `Tap ${qty} seat${qty === 1 ? '' : 's'}`) : `${qty} × ${tier.name}`}
              {reserved && sorted.length && sorted.length < qty ? ` · ${qty - sorted.length} more` : ''}
            </Txt>
            <Txt variant="price">{money(unit * qty, e.currency)}</Txt>
          </View>
          <Button label={busy ? 'Holding…' : 'Hold seats'} loading={busy} disabled={!ready} onPress={hold} feedback="firm" style={{ minWidth: 140 }} />
        </View>
        {reserved ? (
          <Badge label="Held for 10 minutes while you check out" style={{ alignSelf: 'center' }} />
        ) : null}
      </View>
    </View>
  );
}

function Legend({ style, label }: { style: object; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={[{ width: 16, height: 16, borderRadius: 5 }, style]} />
      <Txt variant="small" color={colors.muted}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chip: { height: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  section: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  sectionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2 },
  legend: { flexDirection: 'row', gap: space.lg },
  stage: { marginLeft: 36, height: 30, borderRadius: radius.sm, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  seat: { width: SEAT, height: SEAT, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  seatFree: { backgroundColor: colors.surface2, borderColor: 'rgba(255,228,232,0.3)' },
  seatOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  seatTaken: { backgroundColor: 'transparent', borderColor: colors.line, borderStyle: 'dashed' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.sm, paddingTop: space.md, paddingHorizontal: gutter, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.line2 },
});
