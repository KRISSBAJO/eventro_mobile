/**
 * Edit an event from the phone (admins and managers), with the website's endpoints:
 *
 *   PATCH /organizer/events/:id                          title, tagline, description, start (and doors), a stock cover
 *   PUT   /organizer/events/:id/media                    a photo uploaded from the phone becomes the cover (first item)
 *   PATCH /organizer/events/:id/ticket-types/:ttId       name, price, quantity, perks, badge, look (a lower price may alert watchers)
 *   POST  /organizer/events/:id/ticket-types             a new ticket type
 *   DELETE /organizer/events/:id/ticket-types/:ttId      only when none are sold and it isn't on the seat map
 *   PUT   /organizer/events/:id/ticket-types/order       the order fans see them in, top tier first
 *
 * Prices here are what fans pay (all-in), as on the website; the API takes the organizer's base price, so they're
 * converted with the event's fee mode. Times are the venue's wall-clock time stored as UTC (the website does the
 * same). "Change venue" opens its own screen (…/venue, PUT /organizer/events/:id/venue); seat maps are designed on
 * the web.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/confirm';
import { DateField, TimeField } from '@/components/date-time';
import { Icon, type IconName } from '@/components/icons';
import { CoverUpload } from '@/components/cover-upload';
import { Label, OrgScreen, WebButton } from '@/components/org-ui';
import { StockPicker } from '@/components/stock-picker';
import { TierExtras, TierPresets } from '@/components/tier-editor';
import { Button, ErrorState, Field, Notice, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { CATEGORY_NAME, currencySymbol, money, num, todayYmd } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { UploadedCover } from '@/lib/media-upload';
import {
  baseFromAllIn,
  canEdit,
  membershipOf,
  moneyInput,
  parseMoney,
  useOrgEvent,
  wallIso,
  wallParts,
  webPaths,
  type OrgEventDetail,
} from '@/lib/organizer';
import { useAuth } from '@/lib/auth';
import { useMyOrgs } from '@/lib/queries';
import { cleanPerks, isTierLook, presetIndex, samePerks, type TierLook, type TierPreset } from '@/lib/tiers';
import { colors, radius, space, touch } from '@/theme';

/** `style` null is Auto: the look comes from the name. */
type Tier = { key: string; id: string | null; name: string; price: string; qty: string; sold: number; mapped: boolean; perks: string[]; badge: string; style: TierLook | null };

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  if (ev.isPending || orgs.isPending) {
    return (
      <OrgScreen title="Edit event">
        <Skeleton height={300} radius={radius.card} />
      </OrgScreen>
    );
  }
  if (ev.error || !ev.data) {
    return (
      <OrgScreen title="Edit event">
        <ErrorState message={ev.error ? errorText(ev.error) : 'Event not found.'} onRetry={() => void ev.refetch()} />
      </OrgScreen>
    );
  }
  if (!canEdit(membershipOf(orgs.data, ev.data.orgId)?.role)) {
    return (
      <OrgScreen title="Edit event">
        <ErrorState message="Your role can’t edit events. Ask an admin to make you a manager." />
      </OrgScreen>
    );
  }
  // The form keeps its values across refetches; comparisons use the latest saved event.
  return <Editor key={ev.data.id} e={ev.data} />;
}

function Editor({ e }: { e: OrgEventDetail }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const start = wallParts(e.startsAt)!;
  const doors0 = wallParts(e.doorsAt);
  const mappedIds = new Set((e.seatMap?.sections ?? []).map((s) => s.ticketTypeId).filter(Boolean) as string[]);
  const fromApi = (): Tier[] =>
    [...e.ticketTypes]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ key: t.id, id: t.id, name: t.name, price: moneyInput(t.priceCents), qty: String(t.capacity), sold: t.sold, mapped: mappedIds.has(t.id), perks: t.perks ?? [], badge: t.badge ?? '', style: isTierLook(t.style) ? t.style : null }));

  const [title, setTitle] = useState(e.title);
  const [subtitle, setSubtitle] = useState(e.subtitle ?? '');
  const [about, setAbout] = useState(e.description ?? '');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [doors, setDoors] = useState(doors0?.time ?? '');
  const [cover, setCover] = useState(e.imageUrl ?? '');
  const [picking, setPicking] = useState(false);
  /** A photo uploaded from the phone; saved as the event's first media item, which makes it the cover. */
  const [upload, setUpload] = useState<UploadedCover | null>(null);
  const [now] = useState(() => Date.now());
  const [tiers, setTiers] = useState<Tier[]>(fromApi);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const today = todayYmd();
  const hasMedia = (e.media ?? []).length > 0;
  const sym = currencySymbol(e.currency);

  const patchTier = (key: string, p: Partial<Tier>) => setTiers((list) => list.map((t) => (t.key === key ? { ...t, ...p } : t)));
  const move = (i: number, d: -1 | 1) => {
    haptic.select();
    setTiers((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  /** A preset is slotted in by how premium it is (as on the website); a blank tier goes at the end. */
  const addTier = (preset?: TierPreset) => {
    haptic.select();
    setTiers((list) => {
      if (list.length >= 20) return list;
      const t: Tier = { key: `new-${Date.now()}`, id: null, name: preset?.name ?? '', price: '', qty: '', sold: 0, mapped: false, perks: preset ? [...preset.perks] : [], badge: preset?.badge ?? '', style: null };
      const at = preset ? presetIndex(list.map((x) => x.name), preset.level) : list.length;
      return [...list.slice(0, at), t, ...list.slice(at)];
    });
  };
  const removeTier = async (t: Tier) => {
    if (!t.id) return setTiers((list) => list.filter((x) => x.key !== t.key));
    const yes = await confirm({ title: `Delete ${t.name}?`, message: 'Fans won’t see this ticket type any more. Nobody has bought one, so nothing else changes.', confirmLabel: 'Delete ticket type', destructive: true });
    if (!yes) return;
    setError('');
    try {
      await api(`/organizer/events/${encodeURIComponent(e.id)}/ticket-types/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      haptic.success();
      setTiers((list) => list.filter((x) => x.key !== t.key));
      void qc.invalidateQueries({ queryKey: ['organizer'] });
    } catch (err) {
      haptic.error();
      setError(errorText(err));
    }
  };

  const save = async () => {
    setError('');
    setSaved('');
    const ers: Record<string, string> = {};
    if (title.trim().length < 3) ers.title = 'The event name needs at least 3 characters.';
    if (!date) ers.date = 'Choose a date.';
    if (!time) ers.time = 'Choose a start time.';
    if (doors && time && doors > time) ers.doors = 'Doors usually open before the start time.';
    const parsed = tiers.map((t) => ({ t, cents: parseMoney(t.price), qty: Number(t.qty) }));
    for (const { t, cents, qty } of parsed) {
      if (!t.name.trim()) ers[`${t.key}-name`] = 'Name this ticket.';
      if (cents === null) ers[`${t.key}-price`] = 'Enter a price (0 for free).';
      else if (cents > 0 && cents < 100) ers[`${t.key}-price`] = `Paid tickets start at ${money(100, e.currency)}.`;
      if (!t.mapped && (!Number.isInteger(qty) || qty < 1)) ers[`${t.key}-qty`] = 'Enter a quantity.';
      else if (!t.mapped && qty < t.sold) ers[`${t.key}-qty`] = `Can’t be below the ${num(t.sold)} already sold.`;
    }
    if (!tiers.length) ers.tiers = 'Keep at least one ticket type.';
    setErrors(ers);
    if (Object.keys(ers).length) {
      haptic.warning();
      setError('Check the highlighted fields.');
      return;
    }

    setBusy(true);
    const notes: string[] = [];
    try {
      const path = `/organizer/events/${encodeURIComponent(e.id)}`;
      // 1. The event. Doors and the end move with the date, so a new date doesn't leave them on the old day.
      const body: Record<string, string> = {};
      if (title.trim() !== e.title) body.title = title.trim();
      if (subtitle.trim() !== (e.subtitle ?? '')) body.subtitle = subtitle.trim();
      if (about.trim() !== (e.description ?? '')) body.description = about.trim();
      const startsAt = wallIso(date, time);
      if (startsAt !== new Date(e.startsAt).toISOString()) body.startsAt = startsAt;
      const shift = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start.date}T00:00:00Z`);
      if (doors) {
        const d = wallIso(date, doors);
        if (!e.doorsAt || d !== new Date(e.doorsAt).toISOString()) body.doorsAt = d;
      }
      if (e.endsAt && shift) body.endsAt = new Date(new Date(e.endsAt).getTime() + shift).toISOString();
      const uploaded = upload && cover === upload.url ? upload : null;
      if (cover && !uploaded && cover !== (e.imageUrl ?? '')) body.imageUrl = cover;
      if (Object.keys(body).length) await api(path, { method: 'PATCH', body });
      // An uploaded photo goes first in the event's media (the cover), ahead of what's already there.
      if (uploaded) {
        const rest = (e.media ?? []).filter((m) => m.id !== uploaded.id).map((m) => ({ id: m.id, kind: m.kind }));
        await api(`${path}/media`, { method: 'PUT', body: { items: [{ id: uploaded.id, kind: 'image' }, ...rest] } });
        setUpload(null);
      }

      // 2. Ticket types that changed.
      const byId = new Map(e.ticketTypes.map((t) => [t.id, t]));
      for (const { t, cents, qty } of parsed) {
        if (!t.id) continue;
        const was = byId.get(t.id);
        if (!was) continue;
        const b: Record<string, string | number | string[] | null> = {};
        if (t.name.trim() !== was.name) b.name = t.name.trim();
        const perks = cleanPerks(t.perks);
        if (!samePerks(perks, was.perks ?? [])) b.perks = perks;
        if (t.badge.trim() !== (was.badge ?? '')) b.badge = t.badge.trim();
        // null sends it back to Auto
        if (t.style !== (isTierLook(was.style) ? was.style : null)) b.style = t.style;
        if (cents !== was.priceCents) b.basePriceCents = baseFromAllIn(cents!, e.feeMode);
        if (!t.mapped && qty !== was.capacity) b.capacity = qty;
        if (!Object.keys(b).length) continue;
        const r = await api<{ priceDrop: { alerting: boolean; reason: string | null; audience: number } | null }>(`${path}/ticket-types/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: b });
        if (r.priceDrop?.alerting) notes.push(`Price drop alert going to ${num(r.priceDrop.audience)} ${r.priceDrop.audience === 1 ? 'fan' : 'fans'}.`);
        else if (r.priceDrop?.reason) notes.push(`Price drop recorded, no alert: ${r.priceDrop.reason.toLowerCase()}.`);
      }

      // 3. New ticket types, then the order (new ones are added last by the API).
      const ids: string[] = [];
      for (const { t, cents, qty } of parsed) {
        if (t.id) {
          ids.push(t.id);
          continue;
        }
        const made = await api<{ id: string }>(`${path}/ticket-types`, {
          body: {
            name: t.name.trim(),
            basePriceCents: baseFromAllIn(cents!, e.feeMode),
            capacity: qty,
            ...(t.perks.length ? { perks: cleanPerks(t.perks) } : {}),
            ...(t.badge.trim() ? { badge: t.badge.trim() } : {}),
            ...(t.style ? { style: t.style } : {}),
          },
        });
        ids.push(made.id);
        patchTier(t.key, { id: made.id, key: made.id });
      }
      const before = [...e.ticketTypes].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.id);
      const after = ids;
      const sameOrder = after.length === before.length && after.every((x, i) => x === before[i]);
      const appendedOnly = before.every((x, i) => after[i] === x);
      if (!sameOrder && !appendedOnly) await api(`${path}/ticket-types/order`, { method: 'PUT', body: { ids: after } });

      haptic.success();
      setSaved(['Saved.', ...notes].join(' '));
      await Promise.all([qc.invalidateQueries({ queryKey: ['organizer'] }), qc.invalidateQueries({ queryKey: ['event', e.slug] })]);
      if (!notes.length) {
        if (router.canGoBack()) router.back();
        else router.replace({ pathname: '/organizer/events/[id]', params: { id: e.id } });
      }
    } catch (err) {
      haptic.error();
      setError(errorText(err));
      // Some steps may have been saved: reload what the API has.
      void qc.invalidateQueries({ queryKey: ['organizer'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgScreen title="Edit event" eyebrow={e.title} footer={<Button label="Save changes" loading={busy} onPress={() => void save()} />}>
      {saved ? (
        <Notice tone="success" icon="check">
          {saved}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      <View style={styles.card}>
        <Label>Details</Label>
        <Field label="Event name" value={title} onChangeText={setTitle} maxLength={120} error={errors.title} />
        <Field label="Tagline (optional)" value={subtitle} onChangeText={setSubtitle} maxLength={120} placeholder="One line under the name" />
        <Field label="Description" value={about} onChangeText={setAbout} maxLength={5000} multiline textAlignVertical="top" placeholder="What should people expect?" />
        <Txt variant="small" color={colors.dim}>
          Category: {CATEGORY_NAME[e.category] ?? e.category}
        </Txt>
      </View>

      <View style={styles.card}>
        <Label>When</Label>
        <DateField label="Date" value={date} onChange={setDate} min={start.date < today ? undefined : today} error={errors.date} />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <TimeField label="Starts" value={time} onChange={setTime} error={errors.time} />
          <TimeField label="Doors open" value={doors} onChange={setDoors} optional={!e.doorsAt} error={errors.doors} />
        </View>
        <Txt variant="small" color={colors.dim}>
          {e.online ? 'Times are in the event’s time zone' : 'Times are local to the venue'}
          {e.timezone && e.timezone !== 'UTC' ? ` (${e.timezone.replace(/_/g, ' ')})` : ''}.
        </Txt>
      </View>

      <View style={styles.card}>
        <Label>Where</Label>
        {e.online ? (
          <Txt>Online event{e.streamUrl ? `: ${e.streamUrl}` : ''}</Txt>
        ) : e.venue ? (
          <>
            <Txt variant="bodyStrong">{e.venue.name}</Txt>
            <Txt variant="small" color={colors.muted}>
              {[e.venue.address, e.venue.city, e.venue.region, e.venue.postalCode, e.venue.country].filter(Boolean).join(', ')}
            </Txt>
          </>
        ) : null}
        {e.online ? (
          <Txt variant="small" color={colors.dim}>
            Online events have no venue. To hold it in person, create a new event.
          </Txt>
        ) : e.status === 'CANCELLED' || new Date(e.startsAt).getTime() < now ? null : (
          <Button
            label="Change venue"
            variant="subtle"
            size="md"
            icon="pin"
            onPress={() => router.push({ pathname: '/organizer/events/[id]/venue', params: { id: e.id } })}
          />
        )}
      </View>

      <View style={styles.card}>
        <Label>Cover photo</Label>
        <View style={styles.cover}>{cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
        <CoverUpload
          full={upload && cover === upload.url ? 'Upload a different photo' : undefined}
          onUploaded={(c) => {
            setUpload(c);
            setCover(c.url);
          }}
        />
        {upload && cover === upload.url ? (
          <Txt variant="small" color={colors.muted}>
            New cover uploaded. Save changes to use it.
          </Txt>
        ) : null}
        {hasMedia ? (
          <>
            <Txt variant="small" color={colors.muted}>
              This event uses photos you uploaded (the first one is the cover). A new upload goes first. Reorder or remove photos on the website.
            </Txt>
            <WebButton label="Manage photos on the web" path={webPaths.event(e.id)} />
          </>
        ) : picking ? (
          <StockPicker category={CATEGORY_NAME[e.category] ?? 'Concerts'} value={cover} onPick={setCover} />
        ) : (
          <Button label="Pick one of our photos" variant="ghost" size="md" icon="sparkle" onPress={() => setPicking(true)} />
        )}
      </View>

      <View style={styles.card}>
        <Label>Tickets</Label>
        <Txt variant="small" color={colors.dim}>
          Prices are what fans pay, all-in. The order here is the order fans see, top tier first.
          {e.seatMap ? ' Quantities for ticket types on the seat map come from the map.' : ''}
        </Txt>
        {errors.tiers ? (
          <Txt variant="small" color={colors.accentHi}>
            {errors.tiers}
          </Txt>
        ) : null}
        {tiers.map((t, i) => (
          <View key={t.key} style={styles.tier}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Txt variant="eyebrow" color={colors.dim} style={{ flex: 1 }}>
                {t.id ? `${num(t.sold)} sold` : 'New'}
              </Txt>
              <Mini icon="chevronDown" label={`Move ${t.name || 'ticket'} up`} up disabled={i === 0} onPress={() => move(i, -1)} />
              <Mini icon="chevronDown" label={`Move ${t.name || 'ticket'} down`} disabled={i === tiers.length - 1} onPress={() => move(i, 1)} />
              <Mini icon="trash" label={`Delete ${t.name || 'ticket'}`} disabled={t.sold > 0 || t.mapped || tiers.length === 1} onPress={() => void removeTier(t)} />
            </View>
            <Field label="Name" value={t.name} onChangeText={(v) => patchTier(t.key, { name: v })} maxLength={60} error={errors[`${t.key}-name`]} placeholder="General admission" />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Field style={{ flex: 1 }} label={`Price (${sym})`} value={t.price} onChangeText={(v) => patchTier(t.key, { price: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" error={errors[`${t.key}-price`]} placeholder="0 = free" />
              <Field
                style={{ flex: 1 }}
                label="Quantity"
                value={t.qty}
                onChangeText={(v) => patchTier(t.key, { qty: v.replace(/\D/g, '') })}
                keyboardType="number-pad"
                editable={!t.mapped}
                error={errors[`${t.key}-qty`]}
                hint={t.mapped ? 'From the seat map' : undefined}
              />
            </View>
            {t.sold > 0 ? (
              <Txt variant="tiny" color={colors.dim}>
                Sold tickets can’t be deleted. Lowering the price tells fans watching this event.
              </Txt>
            ) : null}
            <View style={styles.divider} />
            <TierExtras
              name={t.name}
              price={(() => {
                const c = parseMoney(t.price);
                return c === null ? undefined : c === 0 ? 'Free' : money(c, e.currency);
              })()}
              value={{ perks: t.perks, badge: t.badge, style: t.style }}
              onChange={(patch) => patchTier(t.key, patch)}
            />
          </View>
        ))}
        {tiers.length < 20 ? (
          <View style={styles.addTier}>
            <TierPresets names={tiers.map((t) => t.name)} onPick={(p) => addTier(p)} />
            <Button label="Blank tier" variant="ghost" size="md" icon="plus" onPress={() => addTier()} />
          </View>
        ) : null}
        {e.seatMap ? <WebButton label="Edit the seat map on the web" path={webPaths.seating(e.id)} /> : null}
      </View>
    </OrgScreen>
  );
}

function Mini({ icon, label, onPress, disabled, up }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; up?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.mini, disabled && { opacity: 0.3 }, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={up ? { transform: [{ rotate: '180deg' }] } : undefined}>
        <Icon name={icon} size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
  tier: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
  addTier: { gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 },
  mini: { width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
});
