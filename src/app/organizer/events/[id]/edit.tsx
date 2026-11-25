/**
 * Edit an event from the phone (admins and managers), with the website's endpoints:
 *
 *   PATCH /organizer/events/:id                          title, tagline, description, start (and doors), a stock cover,
 *                                                        donations (cause, description, amounts) and the comp limit
 *   PUT   /organizer/events/:id/media                    a photo uploaded from the phone becomes the cover (first item)
 *   PATCH /organizer/events/:id/ticket-types/:ttId       name, price, quantity, perks, badge, look (a lower price may alert watchers)
 *   POST  /organizer/events/:id/ticket-types             a new ticket type
 *   DELETE /organizer/events/:id/ticket-types/:ttId      only when none are sold and it isn't on the seat map
 *   PUT   /organizer/events/:id/ticket-types/order       the order fans see them in, top tier first
 *
 * Prices here are what fans pay (all-in), as on the website; the API takes the organizer's base price, so they're
 * converted with the event's fee mode. Pay-what-you-want amounts (minimum, suggested, quick picks, maximum) are the
 * organizer's base amounts, as the API takes them. Times are the venue's wall-clock time stored as UTC (the website does the
 * same). "Change venue" opens its own screen (…/venue, PUT /organizer/events/:id/venue); seat maps are designed on
 * the web.
 *
 * Multiple dates (components/date-list.tsx): `dates` is sent as the full list (kept ones with their id, new ones
 * without; a date left out is removed, which the API refuses once it has orders: "Cancel this date" is the way then,
 * for org admins, with the cancel preview in a sheet). DATES tiers are one row per tier (the copies share `tierKey`;
 * a PATCH on any copy changes them all): the quantity is the same on every date (`capacity`) or set per date
 * (`capacityByDate`). DAYS tiers pick their days (`validDates`; once sold, days can only be added). One date /
 * Multiple dates / Multi-day can be switched while nothing has sold (the API's DATE_MODE_LOCKED otherwise).
 *
 *   PUT   /organizer/events/:id/schedule                 the schedule as the full list (components/schedule-editor.tsx),
 *                                                        sent last (once new dates and ticket types have ids) and only
 *                                                        when it changed; read-only fields are never sent. Holders of a
 *                                                        booked session that's removed or moved are told (`notified`).
 *
 * Schedule items keep their date and time of day: moving the event's date (or a date row) moves its items with it.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CancelDateSheet } from '@/components/cancel-date-sheet';
import { useConfirm } from '@/components/confirm';
import { DateList, dateListErrors, datesBody, DayChips, draftsOf, ModePicker, PerDateFields, type DateDraft } from '@/components/date-list';
import { DateField, TimeField } from '@/components/date-time';
import { Icon, type IconName } from '@/components/icons';
import { CoverUpload } from '@/components/cover-upload';
import { DonationFields } from '@/components/donation-fields';
import { Label, OrgScreen, WebButton } from '@/components/org-ui';
import { StockPicker } from '@/components/stock-picker';
import { draftsOfSchedule, ScheduleEditor, scheduleBody, scheduleErrors, sortItems, type ItemDraft, type ScheduleDate } from '@/components/schedule-editor';
import { PricingMode, PwywFields, TierExtras, TierPresets, type Pricing } from '@/components/tier-editor';
import { Button, ErrorState, Field, Notice, Skeleton, TextArea, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { donationChanges, donationDraftOf, donationErrors, type DonationDraft } from '@/lib/donations';
import { dateLine, type DateMode, type EventDate } from '@/lib/dates';
import { CATEGORY_NAME, currencySymbol, money, num, todayYmd } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { UploadedCover } from '@/lib/media-upload';
import {
  baseFromAllIn,
  buyerPrice,
  canEdit,
  isAdmin,
  lastStart,
  membershipOf,
  moneyInput,
  parseMoney,
  tiersOf,
  useOrgEvent,
  wallIso,
  wallParts,
  webPaths,
  type OrgEventDetail,
} from '@/lib/organizer';
import { useAuth } from '@/lib/auth';
import { NO_PWYW, pwywBody, pwywDraftOf, pwywErrors, type PwywDraft } from '@/lib/pwyw';
import { useMyOrgs } from '@/lib/queries';
import { useOrgSchedule, type OrganizerItem } from '@/lib/schedule';
import { cleanPerks, isTierLook, presetIndex, samePerks, type TierLook, type TierPreset } from '@/lib/tiers';
import { colors, radius, space, touch } from '@/theme';

/**
 * `style` null is Auto: the look comes from the name. `pwyw` is used when `pricing` is PWYW. Multiple dates: `copies`
 * are the tier's ticket types per date (DATES), `perDate`/`byDate` (date key → quantity) set quantities per date, and
 * `days` are the date keys a DAYS type is valid on (null: every day; `wasDays` what it had).
 */
type Tier = {
  key: string;
  id: string | null;
  name: string;
  price: string;
  qty: string;
  sold: number;
  mapped: boolean;
  perks: string[];
  badge: string;
  style: TierLook | null;
  pricing: Pricing;
  pwyw: PwywDraft;
  copies: { id: string; eventDateId: string | null; capacity: number; sold: number }[];
  perDate: boolean;
  byDate: Record<string, string>;
  days: string[] | null;
  wasDays: string[];
};

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const ev = useOrgEvent(id);
  const sched = useOrgSchedule(id);
  if (ev.isPending || orgs.isPending || sched.isPending) {
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
  // A schedule that couldn't load is left alone (the card says so), so saving never wipes it.
  return <Editor key={ev.data.id} e={ev.data} admin={isAdmin(membershipOf(orgs.data, ev.data.orgId)?.role)} schedule0={sched.data?.items ?? null} />;
}

/** The dates schedule items can be on: the event's own date (one date), or the date rows. */
const scheduleDates = (m: DateMode, list: DateDraft[], date: string, time: string): ScheduleDate[] =>
  m === 'SINGLE' ? [{ key: 'event', date, start: time }] : list.map((x) => ({ key: x.key, date: x.date, start: x.start, label: x.label, cancelled: x.cancelled }));

function Editor({ e, admin, schedule0 }: { e: OrgEventDetail; admin: boolean; schedule0: OrganizerItem[] | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const start = wallParts(e.startsAt)!;
  const doors0 = wallParts(e.doorsAt);
  // Seat-map sections point at a ticket type, or (multiple dates) at a tier's key.
  const mappedIds = new Set((e.seatMap?.sections ?? []).map((s) => s.ticketTypeId).filter(Boolean) as string[]);
  const mode0: DateMode = e.dateMode ?? 'SINGLE';
  const dates0 = e.dates ?? [];
  const activeIds0 = dates0.filter((d) => d.status !== 'CANCELLED').map((d) => d.id);
  const fromApi = (): Tier[] =>
    tiersOf(e.ticketTypes, dates0).map(({ tier: t, copies, sold }) => {
      const caps = copies.filter((c) => !dates0.some((d) => d.id === c.eventDateId && d.status === 'CANCELLED')).map((c) => c.capacity);
      const uniform = caps.every((c) => c === caps[0]);
      const valid = t.validDateIds ?? [];
      return {
        key: t.id,
        id: t.id,
        name: t.name,
        price: moneyInput(t.priceCents),
        qty: String(mode0 === 'DATES' ? (caps[0] ?? t.capacity) : t.capacity),
        sold,
        mapped: mappedIds.has(t.id) || (!!t.tierKey && mappedIds.has(t.tierKey)),
        perks: t.perks ?? [],
        badge: t.badge ?? '',
        style: isTierLook(t.style) ? t.style : null,
        pricing: t.pricing === 'PWYW' ? 'PWYW' : 'FIXED',
        pwyw: t.pricing === 'PWYW' ? pwywDraftOf(t) : NO_PWYW,
        copies: copies.map((c) => ({ id: c.id, eventDateId: c.eventDateId ?? null, capacity: c.capacity, sold: c.sold })),
        perDate: mode0 === 'DATES' && !uniform,
        byDate: mode0 === 'DATES' && !uniform ? Object.fromEntries(copies.filter((c) => c.eventDateId).map((c) => [c.eventDateId!, String(c.capacity)])) : {},
        days: mode0 === 'DAYS' && !activeIds0.every((id) => valid.includes(id)) ? valid.filter((id) => activeIds0.includes(id)) : null,
        wasDays: valid,
      };
    });

  const [title, setTitle] = useState(e.title);
  const [subtitle, setSubtitle] = useState(e.subtitle ?? '');
  const [about, setAbout] = useState(e.description ?? '');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [doors, setDoors] = useState(doors0?.time ?? '');
  // Multiple dates: the mode and the list (a one-date event starts its list from its own date when switched).
  const [mode, setMode] = useState<DateMode>(mode0);
  const [dates, setDates] = useState<DateDraft[]>(() =>
    mode0 === 'SINGLE' ? [{ key: 'd0', id: null, date: start.date, start: start.time, doors: doors0?.time ?? '', end: wallParts(e.endsAt)?.time ?? '', label: '' }] : draftsOf(dates0),
  );
  const [cancelling, setCancelling] = useState<string | null>(null);
  // The schedule. "Who can book" names ticket types by the form's tier keys (a tier's first copy id); the API's ids
  // and DATES tier keys map back to them.
  const tierKeyOf = (raw: string) => {
    for (const g of tiersOf(e.ticketTypes, dates0)) if (g.tier.id === raw || g.tier.tierKey === raw || g.copies.some((c) => c.id === raw)) return g.tier.id;
    return null;
  };
  const [init] = useState(() => {
    const at = scheduleDates(mode0, mode0 === 'SINGLE' ? [] : draftsOf(dates0), start.date, start.time);
    const drafts = schedule0 ? sortItems(draftsOfSchedule(schedule0, mode0, at, tierKeyOf), mode0, at) : [];
    return { drafts, base: schedule0 ? JSON.stringify(scheduleBody(drafts, mode0, at, { dateRef: (key) => ({ eventDateId: key }), tierRef: (key) => key })) : '' };
  });
  const [sched, setSched] = useState<ItemDraft[]>(init.drafts);
  /** The schedule as the API has it (as last loaded or saved), so it's only sent when it changed. */
  const [schedBase, setSchedBase] = useState(init.base);
  const totalSold = e.ticketTypes.reduce((n, t) => n + t.sold, 0);
  const canSwitch = totalSold === 0 && e.status !== 'CANCELLED';
  const multi = mode !== 'SINGLE';
  const switchMode = (m: DateMode) => {
    if (m === mode) return;
    // Back to one date: it takes the first date's times.
    if (m === 'SINGLE') {
      const first = dates.filter((d) => !d.cancelled && d.date).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))[0];
      if (first) {
        setDate(first.date);
        setTime(first.start);
        setDoors(first.doors);
      }
    } else if (mode === 'SINGLE' && mode0 === 'SINGLE') {
      setDates((list) => (list.length === 1 && !list[0].id ? [{ ...list[0], date, start: time, doors }] : list));
    }
    // Schedule items without a date (or on a date that's gone) go on the first date; they can be moved.
    if (m !== 'SINGLE') {
      const first = dates.find((d) => !d.cancelled);
      if (first) setSched((list) => list.map((i) => (i.dateKey && dates.some((d) => d.key === i.dateKey && !d.cancelled) ? i : { ...i, dateKey: first.key })));
    }
    setMode(m);
  };
  const [cover, setCover] = useState(e.imageUrl ?? '');
  const [picking, setPicking] = useState(false);
  /** A photo uploaded from the phone; saved as the event's first media item, which makes it the cover. */
  const [upload, setUpload] = useState<UploadedCover | null>(null);
  const [now] = useState(() => Date.now());
  const [tiers, setTiers] = useState<Tier[]>(fromApi);
  const [donations, setDonations] = useState<DonationDraft>(() => donationDraftOf(e));
  const [compLimit, setCompLimit] = useState(e.compLimit !== null && e.compLimit !== undefined ? String(e.compLimit) : '');
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
      const t: Tier = { key: `new-${Date.now()}`, id: null, name: preset?.name ?? '', price: '', qty: '', sold: 0, mapped: false, perks: preset ? [...preset.perks] : [], badge: preset?.badge ?? '', style: null, pricing: 'FIXED', pwyw: NO_PWYW, copies: [], perDate: false, byDate: {}, days: null, wasDays: [] };
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
    if (multi) {
      const original = new Map(dates0.map((d) => [d.id, new Date(d.startsAt).toISOString()]));
      Object.assign(ers, dateListErrors(mode, dates, today, original));
    } else {
      if (!date) ers.date = 'Choose a date.';
      if (!time) ers.time = 'Choose a start time.';
      if (doors && time && doors > time) ers.doors = 'Doors usually open before the start time.';
    }
    const parsed = tiers.map((t) => ({ t, cents: parseMoney(t.price), qty: Number(t.qty) }));
    for (const { t, cents, qty } of parsed) {
      if (!t.name.trim()) ers[`${t.key}-name`] = 'Name this ticket.';
      if (t.pricing === 'PWYW') Object.assign(ers, pwywErrors(t.pwyw, t.key, e.currency));
      else if (cents === null) ers[`${t.key}-price`] = 'Enter a price (0 for free).';
      else if (cents > 0 && cents < 100) ers[`${t.key}-price`] = `Paid tickets start at ${money(100, e.currency)}.`;
      // Multiple dates: each date's quantity can't go below what that date has sold.
      const most = mode === 'DATES' && mode0 === 'DATES' ? Math.max(0, ...t.copies.map((c) => c.sold)) : t.sold;
      if (!t.mapped && (!Number.isInteger(qty) || qty < 1)) ers[`${t.key}-qty`] = 'Enter a quantity.';
      else if (!t.mapped && !t.perDate && qty < most) ers[`${t.key}-qty`] = mode === 'DATES' ? `Can’t be below the ${num(most)} already sold on one date.` : `Can’t be below the ${num(t.sold)} already sold.`;
      if (mode === 'DATES' && t.perDate && !t.mapped) {
        for (const d of dates.filter((x) => !x.cancelled)) {
          const v = t.byDate[d.key];
          if (v === undefined || v === '') continue;
          const sold = t.copies.find((c) => c.eventDateId === d.id)?.sold ?? 0;
          if (!Number.isInteger(Number(v)) || Number(v) > 200_000) ers[`${t.key}-qty-${d.key}`] = 'A whole number up to 200,000.';
          else if (Number(v) < sold) ers[`${t.key}-qty-${d.key}`] = `Can’t be below the ${num(sold)} sold.`;
        }
      }
      if (mode === 'DAYS' && t.days && !t.days.some((k) => dates.some((d) => d.key === k && !d.cancelled))) ers[`${t.key}-days`] = 'Pick the days this ticket is valid on.';
    }
    if (!tiers.length) ers.tiers = 'Keep at least one ticket type.';
    const sDates = scheduleDates(mode, dates, date, time);
    if (schedule0) Object.assign(ers, scheduleErrors(sched, mode, sDates));
    for (const [k, v] of Object.entries(donationErrors(donations))) ers[`donation-${k}`] = v;
    const limit = compLimit.trim() ? Number(compLimit) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) ers.compLimit = 'A whole number, or leave it empty for no limit.';
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
      const body: Record<string, unknown> = {};
      if (title.trim() !== e.title) body.title = title.trim();
      if (subtitle.trim() !== (e.subtitle ?? '')) body.subtitle = subtitle.trim();
      if (about.trim() !== (e.description ?? '')) body.description = about.trim();
      if (mode !== mode0) body.dateMode = mode;
      if (multi) {
        // The full list: kept dates with their id, new ones without; the ones left out are removed.
        const next = datesBody(dates);
        if (mode !== mode0 || JSON.stringify(next) !== JSON.stringify(datesBody(draftsOf(dates0)))) body.dates = next;
      } else {
        const startsAt = wallIso(date, time);
        if (startsAt !== new Date(e.startsAt).toISOString() || mode !== mode0) body.startsAt = startsAt;
        const shift = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start.date}T00:00:00Z`);
        if (doors) {
          const d = wallIso(date, doors);
          if (!e.doorsAt || d !== new Date(e.doorsAt).toISOString() || mode !== mode0) body.doorsAt = d;
        }
        if (e.endsAt && shift) body.endsAt = new Date(new Date(e.endsAt).getTime() + shift).toISOString();
      }
      const uploaded = upload && cover === upload.url ? upload : null;
      if (cover && !uploaded && cover !== (e.imageUrl ?? '')) body.imageUrl = cover;
      Object.assign(body, donationChanges(donations, e));
      if (limit !== (e.compLimit ?? null)) body.compLimit = limit;
      const res = Object.keys(body).length ? await api<{ dates?: EventDate[] }>(path, { method: 'PATCH', body }) : null;
      // Multiple dates: a row's date id (new rows get theirs from the answer, matched by start).
      const savedDates = res?.dates ?? dates0;
      const idOf = (key: string) => {
        const d = dates.find((x) => x.key === key);
        if (!d) return null;
        if (d.id) return d.id;
        return savedDates.find((x) => x.status !== 'CANCELLED' && new Date(x.startsAt).toISOString() === wallIso(d.date, d.start))?.id ?? null;
      };
      const activeKeys = dates.filter((d) => !d.cancelled).map((d) => d.key);
      /** DATES: the per-date quantities that differ from what each date has now. */
      const capacityByDate = (t: Tier) => {
        const by: Record<string, number> = {};
        for (const key of activeKeys) {
          const v = t.byDate[key];
          const id = idOf(key);
          if (v === undefined || v === '' || !id) continue;
          const now = t.copies.find((c) => c.eventDateId === id)?.capacity;
          if (Number(v) !== now) by[id] = Number(v);
        }
        return by;
      };
      /** DAYS: the date ids a type is valid on. */
      const validIds = (t: Tier) => (t.days ?? activeKeys).filter((k) => activeKeys.includes(k)).map(idOf).filter((x): x is string => !!x);
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
        const b: Record<string, unknown> = {};
        if (t.name.trim() !== was.name) b.name = t.name.trim();
        const perks = cleanPerks(t.perks);
        if (!samePerks(perks, was.perks ?? [])) b.perks = perks;
        if (t.badge.trim() !== (was.badge ?? '')) b.badge = t.badge.trim();
        // null sends it back to Auto
        if (t.style !== (isTierLook(was.style) ? was.style : null)) b.style = t.style;
        const wasPwyw = was.pricing === 'PWYW';
        if (t.pricing === 'PWYW') {
          // Pay what you want: its amounts (base), sent when they (or the pricing) changed.
          const now = pwywBody(t.pwyw);
          if (!wasPwyw || JSON.stringify(now) !== JSON.stringify(pwywBody(pwywDraftOf(was)))) Object.assign(b, now);
        } else if (wasPwyw) {
          b.pricing = 'FIXED';
          b.basePriceCents = baseFromAllIn(cents!, e.feeMode);
        } else if (cents !== was.priceCents) b.basePriceCents = baseFromAllIn(cents!, e.feeMode);
        if (mode === 'DATES' && mode0 === 'DATES') {
          // The same on every date, or per date.
          if (!t.mapped && !t.perDate && t.copies.some((c) => c.capacity !== qty && !dates0.some((d) => d.id === c.eventDateId && d.status === 'CANCELLED'))) b.capacity = qty;
          if (!t.mapped && t.perDate) {
            const by = capacityByDate(t);
            if (Object.keys(by).length) b.capacityByDate = by;
          }
        } else {
          if (!t.mapped && qty !== was.capacity) b.capacity = qty;
          if (mode === 'DATES' && t.perDate) {
            const by = capacityByDate(t);
            if (Object.keys(by).length) b.capacityByDate = by;
          }
        }
        if (mode === 'DAYS') {
          const ids = validIds(t);
          if (mode !== mode0 || ids.length !== t.wasDays.length || ids.some((x) => !t.wasDays.includes(x))) b.validDates = ids;
        }
        if (!Object.keys(b).length) continue;
        const r = await api<{ priceDrop: { alerting: boolean; reason: string | null; audience: number } | null }>(`${path}/ticket-types/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: b });
        if (r.priceDrop?.alerting) notes.push(`Price drop alert going to ${num(r.priceDrop.audience)} ${r.priceDrop.audience === 1 ? 'fan' : 'fans'}.`);
        else if (r.priceDrop?.reason) notes.push(`Price drop recorded, no alert: ${r.priceDrop.reason.toLowerCase()}.`);
      }

      // 3. New ticket types, then the order (new ones are added last by the API).
      const ids: string[] = [];
      /** new ticket types' ids by their form key (for the schedule's "Who can book") */
      const made: Record<string, string> = {};
      for (const { t, cents, qty } of parsed) {
        if (t.id) {
          ids.push(t.id);
          continue;
        }
        const created = await api<{ id: string }>(`${path}/ticket-types`, {
          body: {
            name: t.name.trim(),
            ...(t.pricing === 'PWYW' ? { basePriceCents: 0, ...pwywBody(t.pwyw) } : { basePriceCents: baseFromAllIn(cents!, e.feeMode) }),
            capacity: qty,
            ...(mode === 'DATES' && t.perDate && Object.keys(capacityByDate(t)).length ? { capacityByDate: capacityByDate(t) } : {}),
            ...(mode === 'DAYS' ? { validDates: validIds(t) } : {}),
            ...(t.perks.length ? { perks: cleanPerks(t.perks) } : {}),
            ...(t.badge.trim() ? { badge: t.badge.trim() } : {}),
            ...(t.style ? { style: t.style } : {}),
          },
        });
        ids.push(created.id);
        made[t.key] = created.id;
        patchTier(t.key, { id: created.id, key: created.id });
      }
      // one id per tier (DATES copies count once)
      const before = tiersOf(e.ticketTypes, dates0).map((g) => g.tier.id);
      const after = ids;
      const sameOrder = after.length === before.length && after.every((x, i) => x === before[i]);
      const appendedOnly = before.every((x, i) => after[i] === x);
      if (!sameOrder && !appendedOnly) await api(`${path}/ticket-types/order`, { method: 'PUT', body: { ids: after } });

      // 4. The schedule, as the full list, when it changed (or the kind of event did: items move between dates).
      if (schedule0) {
        const items = scheduleBody(sched, mode, sDates, { dateRef: (key) => ({ eventDateId: idOf(key) }), tierRef: (key) => made[key] ?? (tiers.some((t) => t.key === key) ? key : null) });
        if (mode !== mode0 || JSON.stringify(items) !== schedBase) {
          const r = await api<{ items: OrganizerItem[]; notified: number }>(`${path}/schedule`, { method: 'PUT', body: { items } });
          // The answer is in the order sent (time order): new items get their ids, so saving again keeps them.
          const kept = sortItems(sched, mode, sDates).map((d, n) => ({ ...d, id: r.items[n]?.id ?? d.id, reserved: r.items[n]?.reserved ?? d.reserved, tiers: d.tiers ? d.tiers.map((k) => made[k] ?? k) : null }));
          setSched(kept);
          setSchedBase(JSON.stringify(items.map((x, n) => ({ ...(r.items[n] ? { id: r.items[n].id } : {}), ...x }))));
          if (r.notified) notes.push(`${num(r.notified)} ${r.notified === 1 ? 'person who booked a session was' : 'people who booked sessions were'} told about the change.`);
        }
      }

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
      <CancelDateSheet
        eventId={e.id}
        dateId={cancelling}
        onClose={() => setCancelling(null)}
        onDone={(r) => {
          const d = dates0.find((x) => x.id === r.dateId);
          setCancelling(null);
          // The date shows as cancelled; the event's page and lists update from the API.
          setDates((list) => list.map((x) => (x.id === r.dateId ? { ...x, cancelled: true } : x)));
          setSaved(
            r.eventCancelled
              ? 'That was the last date, so the event is cancelled. Every buyer is being refunded.'
              : `${d ? dateLine(d) : 'The date'} is cancelled. ${num(r.refunded)} ${r.refunded === 1 ? 'order' : 'orders'} refunded, ${num(r.ticketsVoided)} tickets voided${r.failed.length ? `; ${num(r.failed.length)} ${r.failed.length === 1 ? 'refund' : 'refunds'} didn’t go through yet` : ''}.`,
          );
          void qc.invalidateQueries({ queryKey: ['organizer'] });
          void qc.invalidateQueries({ queryKey: ['event', e.slug] });
        }}
      />
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
        {/* grows with the text; drag the grip to make it taller (same box as Create Event) */}
        <TextArea label="Description" value={about} onChangeText={setAbout} maxLength={5000} placeholder="What should people expect?" />
        <Txt variant="small" color={colors.dim}>
          Category: {CATEGORY_NAME[e.category] ?? e.category}
        </Txt>
      </View>

      <View style={styles.card}>
        <Label>When</Label>
        {canSwitch ? <ModePicker value={mode} onChange={switchMode} /> : null}
        {multi ? (
          <DateList
            mode={mode}
            list={dates}
            onChange={setDates}
            errors={errors}
            today={today}
            keep={(d) => (mode0 === 'DATES' && d.id && e.ticketTypes.some((t) => t.eventDateId === d.id && t.sold > 0) ? 'This date has orders, so it can’t be removed. Cancel it instead.' : null)}
            extra={(d) =>
              // Org admins can cancel one performance of a published run.
              mode0 === 'DATES' && mode === 'DATES' && admin && d.id && !d.cancelled && e.status === 'PUBLISHED' ? (
                <Button label="Cancel this date…" variant="danger" size="sm" icon="alert" onPress={() => setCancelling(d.id)} />
              ) : null
            }
          />
        ) : (
          <>
            <DateField label="Date" value={date} onChange={setDate} min={start.date < today ? undefined : today} error={errors.date} />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <TimeField label="Starts" value={time} onChange={setTime} error={errors.time} />
              <TimeField label="Doors open" value={doors} onChange={setDoors} optional={!e.doorsAt} error={errors.doors} />
            </View>
          </>
        )}
        {!canSwitch && mode0 !== 'SINGLE' ? (
          <Txt variant="small" color={colors.dim}>
            {mode0 === 'DATES' ? 'Multiple dates' : 'Multi-day event'}: tickets have sold, so this can’t change to another kind of event.
          </Txt>
        ) : null}
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
        ) : e.status === 'CANCELLED' || new Date(lastStart(e)).getTime() < now ? null : (
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
          Fixed prices are what fans pay, all-in; pay-what-you-want amounts are your price, before {e.feeMode === 'BUYER' ? 'Omoshow’s fee is added' : 'Omoshow’s fee comes out'}. The order here is the order fans see, top tier first.
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
            <PricingMode value={t.pricing} onChange={(pricing) => patchTier(t.key, { pricing })} />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              {t.pricing === 'FIXED' ? (
                <Field style={{ flex: 1 }} label={`Price (${sym})`} value={t.price} onChangeText={(v) => patchTier(t.key, { price: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" error={errors[`${t.key}-price`]} placeholder="0 = free" />
              ) : null}
              <Field
                style={{ flex: 1 }}
                label={mode === 'DATES' ? 'Per date' : 'Quantity'}
                value={t.qty}
                onChangeText={(v) => patchTier(t.key, { qty: v.replace(/\D/g, '') })}
                keyboardType="number-pad"
                editable={!t.mapped}
                error={errors[`${t.key}-qty`]}
                hint={t.mapped ? 'From the seat map' : undefined}
              />
            </View>
            {t.pricing === 'PWYW' ? <PwywFields value={t.pwyw} onChange={(p) => patchTier(t.key, { pwyw: { ...t.pwyw, ...p } })} currency={e.currency} feeMode={e.feeMode} errors={errors} errorKey={t.key} /> : null}
            {mode === 'DATES' && !t.mapped ? (
              <PerDateFields
                on={t.perDate}
                onToggle={(on) => patchTier(t.key, on ? { perDate: true, byDate: Object.fromEntries(t.copies.filter((c) => c.eventDateId).map((c) => [c.eventDateId!, String(c.capacity)])) } : { perDate: false, byDate: {} })}
                dates={dates}
                base={t.qty}
                values={t.byDate}
                onChange={(byDate) => patchTier(t.key, { byDate })}
                errors={errors}
                errorKey={t.key}
                sold={Object.fromEntries(t.copies.filter((c) => c.eventDateId).map((c) => [c.eventDateId!, c.sold]))}
              />
            ) : null}
            {mode === 'DAYS' ? <DayChips name={t.name} dates={dates} value={t.days} error={errors[`${t.key}-days`]} onChange={(days) => patchTier(t.key, { days })} locked={t.sold > 0 && mode0 === 'DAYS' ? t.wasDays : []} /> : null}
            {t.sold > 0 ? (
              <Txt variant="tiny" color={colors.dim}>
                Sold tickets can’t be deleted. Lowering the price tells fans watching this event.
              </Txt>
            ) : null}
            <View style={styles.divider} />
            <TierExtras
              name={t.name}
              price={(() => {
                if (t.pricing === 'PWYW') {
                  const min = parseMoney(t.pwyw.min);
                  return min === null ? undefined : min > 0 ? `From ${money(buyerPrice(min, e.feeMode), e.currency)}` : 'Any amount';
                }
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

      <View style={styles.card}>
        <Label>Schedule</Label>
        {schedule0 ? (
          <>
            <Txt variant="small" color={colors.dim}>
              Optional. What happens when: sets, talks, workshops. Bookable items let ticket holders reserve a free place.
            </Txt>
            <ScheduleEditor mode={mode} list={sched} onChange={setSched} dates={scheduleDates(mode, dates, date, time)} tiers={tiers.map((t) => ({ key: t.key, name: t.name }))} errors={errors} />
          </>
        ) : (
          <Txt variant="small" color={colors.muted}>
            The schedule couldn’t be loaded, so it’s left as it is. Open Edit again to change it.
          </Txt>
        )}
      </View>

      <View style={styles.card}>
        <Label>Donations</Label>
        <DonationFields
          value={donations}
          onChange={(p) => setDonations((d) => ({ ...d, ...p }))}
          currency={e.currency}
          errors={{ cause: errors['donation-cause'], description: errors['donation-description'], suggested: errors['donation-suggested'], min: errors['donation-min'] }}
        />
      </View>

      <View style={styles.card}>
        <Label>Comps</Label>
        <Field
          label="Comp limit (optional)"
          placeholder="No limit"
          keyboardType="number-pad"
          value={compLimit}
          onChangeText={(v) => setCompLimit(v.replace(/\D/g, ''))}
          error={errors.compLimit}
          hint={errors.compLimit ? undefined : 'The most complimentary tickets that can be live at once. Revoked comps don’t count.'}
        />
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
