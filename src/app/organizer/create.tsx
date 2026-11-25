/**
 * Create an event in five short steps: basics → when and where → tickets → cover → review. "Save as draft" is
 * POST /organizer/orgs/:orgId/events (the website's body); "Submit for review" also calls POST …/events/:id/submit.
 *
 * As on the website: times are the venue's wall-clock time stored as UTC; ticket prices are the organizer's price
 * and the fee mode decides who pays Eventro's fee; the cover is a photo uploaded from the phone (expo-image-picker,
 * then the website's upload endpoints and PUT …/events/:id/media, which makes it the cover) or one of the free stock
 * photos; online events need their stream link; seat maps are designed on the website after saving. The venue fields
 * are shared with Change venue (components/venue-fields.tsx).
 *
 * Tickets: preset tiles (as on the website) add a tier with suggested perks and badge, slotted in by rank; each tier
 * has a perks checklist, an optional badge and a look (Auto from the name, or one of six), with a live mini ticket.
 * Each tier is a fixed price or pay what you want (a minimum, an optional suggested price, up to four quick picks and
 * an optional maximum: lib/pwyw.ts). Donations (optional, lib/donations.ts) let fans add a donation to a named cause
 * at checkout. An optional comp limit (`compLimit`, sent only when set) caps the complimentary tickets live at once.
 *
 * "Book a venue on Eventro" sits next to the organizer's own venue: search the venues taking bookings, request a
 * time there (POST …/venue-bookings, held for 48 hours), and the event is saved with `venueBookingId`, in the
 * venue's zone. It waits for the venue to confirm before it can be submitted (instant-book venues confirm at once),
 * and its times have to sit inside the booking (doors included). "Your bookings" lists the organization's pending
 * and confirmed bookings not used by an event yet: picking one uses it as it is (no new request) and fills the date
 * and times from it. `?booking=<id>` (from a booking's "Use for an event") preselects one and keeps its organization.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DateField, dateLabel, TimeField, timeLabel } from '@/components/date-time';
import { Icon } from '@/components/icons';
import { BookingBadge, BookingRequestForm, BookingRow, TermsCard, VenueSearch } from '@/components/booking-ui';
import { CoverUpload } from '@/components/cover-upload';
import { DonationFields } from '@/components/donation-fields';
import { ChoiceRow, ChoiceTile, GradientButton, Section } from '@/components/form-ui';
import { Label, OrgScreen, WebButton } from '@/components/org-ui';
import { StockPicker } from '@/components/stock-picker';
import { PricingMode, PwywFields, TierExtras, TierPresets, type Pricing } from '@/components/tier-editor';
import { placeErrors, VenueFields, type VenuePlace } from '@/components/venue-fields';
import { Button, Chip, EmptyState, Field, Notice, TextArea, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { donationBody, donationErrors, NO_DONATIONS, type DonationDraft } from '@/lib/donations';
import { CATEGORY_NAME, countryName, currencyForCountry, currencySymbol, money, PAYSTACK, todayYmd } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  buyerPrice,
  canEdit,
  CURRENCIES,
  deviceZone,
  organizerNet,
  parseMoney,
  wallIso,
  webPaths,
} from '@/lib/organizer';
import { isLiveBooking, rangeLabel, useBooking, useOrgBookings, type Booking, type ListingResult } from '@/lib/bookings';
import { NO_PWYW, pwywBody, pwywErrors, type PwywDraft } from '@/lib/pwyw';
import { useMyOrgs } from '@/lib/queries';
import type { UploadedCover } from '@/lib/media-upload';
import { defaultCover } from '@/lib/stock-covers';
import { cleanPerks, presetIndex, type TierLook, type TierPreset } from '@/lib/tiers';
import type { Category } from '@/lib/types';
import { colors, font, radius, space, touch } from '@/theme';

const STEPS = ['Basics', 'When and where', 'Tickets', 'Cover photo', 'Review'];
/** Short names for the Next button ("Next: Tickets"). */
const SHORT = ['Basics', 'When & where', 'Tickets', 'Cover', 'Review'];
const CATEGORIES = Object.keys(CATEGORY_NAME) as Category[];

/** One ticket type; `style` null is Auto (the look comes from the name). `pwyw` is used when `pricing` is PWYW. */
type Tier = { key: string; name: string; price: string; qty: string; perks: string[]; badge: string; style: TierLook | null; pricing: Pricing; pwyw: PwywDraft };
const newTier = (name = '', perks: string[] = [], badge = ''): Tier => ({ key: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name, price: '', qty: '', perks, badge, style: null, pricing: 'FIXED', pwyw: NO_PWYW });
type Draft = {
  title: string;
  category: Category | '';
  subtitle: string;
  description: string;
  date: string;
  start: string;
  doors: string;
  end: string;
  /** their own venue, a venue booked on Eventro, or online */
  format: 'venue' | 'book' | 'online';
  /** "Book a venue on Eventro": the venue picked, and the booking requested there */
  pick: ListingResult | null;
  booking: Booking | null;
  /** the booking was requested in this flow (so "another time" withdraws it), not one the org already had */
  bookingNew: boolean;
  venue: string;
  address: string;
  city: string;
  country: string;
  region: string;
  postalCode: string;
  zone: string;
  /** The organizer chose the zone themselves, so the state-based guess leaves it alone. */
  zonePicked: boolean;
  link: string;
  currency: string;
  currencyChosen: boolean;
  feeMode: 'BUYER' | 'ORGANIZER';
  tiers: Tier[];
  /** charity donations at checkout (optional) */
  donations: DonationDraft;
  /** the most live comps (a whole number; empty: no limit) */
  compLimit: string;
  cover: string;
};

const EMPTY: Draft = {
  title: '',
  category: '',
  subtitle: '',
  description: '',
  date: '',
  start: '',
  doors: '',
  end: '',
  format: 'venue',
  pick: null,
  booking: null,
  bookingNew: false,
  venue: '',
  address: '',
  city: '',
  country: '',
  region: '',
  postalCode: '',
  zone: '',
  zonePicked: false,
  link: '',
  currency: '',
  currencyChosen: false,
  feeMode: 'BUYER',
  tiers: [{ key: 't0', name: 'General admission', price: '', qty: '', perks: [], badge: '', style: null, pricing: 'FIXED', pwyw: NO_PWYW }],
  donations: NO_DONATIONS,
  compLimit: '',
  cover: '',
};

function validate(step: number, d: Draft, today: string) {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (d.title.trim().length < 3) e.title = 'Give your event a name (at least 3 characters).';
    if (!d.category) e.category = 'Pick a category so fans can find it.';
    if (d.description.trim().length < 20) e.description = 'Tell people what to expect (at least 20 characters).';
  }
  if (step === 1) {
    if (!d.date) e.date = 'Choose a date.';
    else if (d.date < today) e.date = 'The date is in the past.';
    if (!d.start) e.start = 'Add a start time.';
    if (d.end && d.start && d.end <= d.start) e.end = 'The end time must be after the start.';
    if (d.doors && d.start && d.doors > d.start) e.doors = 'Doors usually open before the start time.';
    if (d.format === 'venue') {
      Object.assign(e, placeErrors(d));
    } else if (d.format === 'book') {
      if (!d.booking) e.booking = d.pick ? `Request a time at ${d.pick.venue.name} first.` : 'Find a venue and request a time.';
      else if (d.date && d.start) {
        // The event, doors included, has to happen within the booking (wall-clock strings compare as times).
        const first = wallIso(d.date, d.doors && d.doors < d.start ? d.doors : d.start);
        const last = wallIso(d.date, d.end || d.start);
        if (first < d.booking.startsAt || last > d.booking.endsAt) e.booking = `The event has to happen within your booking (${rangeLabel(d.booking.startsAt, d.booking.endsAt)}), doors included. Change the times, or request another time.`;
      }
    } else if (!/^https?:\/\/\S+\.\S+/.test(d.link.trim())) {
      e.link = 'Add a full link, starting with https://';
    }
  }
  if (step === 2) {
    if (!d.currency) e.currency = 'Choose the currency fans pay in.';
    if (!d.tiers.length) e.tiers = 'Add at least one ticket type.';
    for (const t of d.tiers) {
      if (!t.name.trim()) e[`${t.key}-name`] = 'Name this ticket.';
      if (t.pricing === 'PWYW') Object.assign(e, pwywErrors(t.pwyw, t.key, d.currency || 'USD'));
      else {
        const p = parseMoney(t.price);
        if (p === null) e[`${t.key}-price`] = 'Enter a price (0 for free).';
        else if (p > 0 && p < 100) e[`${t.key}-price`] = `Paid tickets start at ${money(100, d.currency || 'USD')}.`;
      }
      const q = Number(t.qty);
      if (!Number.isInteger(q) || q < 1) e[`${t.key}-qty`] = 'Enter a quantity.';
      else if (q > 200_000) e[`${t.key}-qty`] = 'At most 200,000.';
    }
    for (const [k, v] of Object.entries(donationErrors(d.donations))) e[`donation-${k}`] = v;
    const limit = d.compLimit.trim() ? Number(d.compLimit) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) e.compLimit = 'A whole number, or leave it empty for no limit.';
  }
  if (step === 3 && !d.cover) e.cover = 'Pick a cover photo.';
  return e;
}

export default function CreateEvent() {
  const params = useLocalSearchParams<{ orgId?: string; first?: string; booking?: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const qc = useQueryClient();
  const editable = (orgs.data ?? []).filter((o) => canEdit(o.role));
  const [orgId, setOrgId] = useState<string | null>(null);
  // A booking opened with "Use for an event" (?booking=<id>): the event belongs to the booking's organization.
  const pre = useBooking('ORGANIZER', params.booking);
  const [d, setD] = useState<Draft>(EMPTY);
  const lockedOrg = d.booking?.org.id ?? pre.data?.org.id;
  const org = lockedOrg ? editable.find((o) => o.org.id === lockedOrg) : (editable.find((o) => o.org.id === (orgId ?? params.orgId)) ?? editable[0]);
  // The organization's bookings that an event can use: pending or confirmed, and not used by another event.
  const mine = useOrgBookings(org?.org.id);
  const usable = (mine.data ?? []).filter((b) => isLiveBooking(b.status) && !b.event);

  // Preselect the booking from the link once it has loaded (state adjusted during render, React's pattern for it).
  const [preApplied, setPreApplied] = useState(false);
  if (pre.data && !preApplied) {
    setPreApplied(true);
    if (isLiveBooking(pre.data.status) && !pre.data.event) setD((p) => withBooking(p, pre.data!, false));
  }

  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  /** A photo uploaded from the phone; it's the cover while `d.cover` is its address. */
  const [upload, setUpload] = useState<UploadedCover | null>(null);
  /** The uploaded cover was attached to the created event (PUT …/media), so a retry doesn't send it again. */
  const [coverSet, setCoverSet] = useState(false);
  const today = todayYmd();
  const errors = useMemo(() => (show ? validate(step, d, today) : {}), [show, step, d, today]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const patchTier = (key: string, p: Partial<Tier>) => setD((x) => ({ ...x, tiers: x.tiers.map((t) => (t.key === key ? { ...t, ...p } : t)) }));
  /** A preset is slotted in by how premium it is (as on the website); a blank tier goes at the end. */
  const addTier = (preset?: TierPreset) =>
    setD((p) => {
      if (p.tiers.length >= 20) return p;
      const t = preset ? newTier(preset.name, [...preset.perks], preset.badge ?? '') : newTier();
      const at = preset ? presetIndex(p.tiers.map((x) => x.name), preset.level) : p.tiers.length;
      return { ...p, tiers: [...p.tiers.slice(0, at), t, ...p.tiers.slice(at)] };
    });
  const cur = d.currency || 'USD';
  /** Held at a booked venue that hasn't confirmed yet: it can be saved, not submitted. */
  const waiting = d.format === 'book' && !!d.booking && d.booking.status !== 'CONFIRMED';

  // "Book a venue on Eventro": picking a venue also sets the currency until the organizer picks one.
  const pickVenue = (r: ListingResult | null) =>
    setD((p) => ({ ...p, pick: r, booking: null, ...(r?.venue.country && !p.currencyChosen ? { currency: currencyForCountry(r.venue.country) } : {}) }));
  /** Another time: the request already made is withdrawn, so the venue isn't left holding it. */
  const rebook = () => {
    const old = d.booking;
    if (old && d.bookingNew) void api(`/organizer/venue-bookings/${encodeURIComponent(old.id)}/cancel`, { body: { reason: 'The organizer picked another time.' } }).catch(() => undefined);
    setD((p) => ({ ...p, booking: null, bookingNew: false }));
  };

  // The venue fields (and the state-based zone guess) live in VenueFields; a new country also sets the currency
  // until the organizer picks one.
  const patchPlace = (patch: Partial<VenuePlace>) =>
    setD((p) => ({ ...p, ...patch, ...(patch.country && patch.country !== p.country && !p.currencyChosen ? { currency: currencyForCountry(patch.country) } : {}) }));

  const next = () => {
    const e = validate(step, d, today);
    if (Object.keys(e).length) {
      setShow(true);
      haptic.warning();
      return;
    }
    haptic.select();
    setShow(false);
    // The cover starts as the category's first stock photo.
    if (step === 2 && !d.cover && d.category) set('cover', defaultCover(CATEGORY_NAME[d.category]));
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => {
    haptic.select();
    setShow(false);
    if (step === 0) {
      if (router.canGoBack()) router.back();
      else router.replace('/organizer');
    } else setStep((s) => s - 1);
  };

  const save = async (submit: boolean) => {
    if (!org) return;
    for (let s = 0; s < 4; s++) {
      const e = validate(s, d, today);
      if (Object.keys(e).length) {
        setStep(s);
        setShow(true);
        haptic.warning();
        return;
      }
    }
    setError('');
    setBusy(submit ? 'submit' : 'draft');
    let id = created;
    try {
      if (!id) {
        // A booked venue brings its own zone.
        const zone = d.format === 'online' ? deviceZone() : d.format === 'book' ? '' : d.zone;
        const ev = await api<{ id: string }>(`/organizer/orgs/${encodeURIComponent(org.org.id)}/events`, {
          body: {
            title: d.title.trim(),
            ...(d.subtitle.trim() ? { subtitle: d.subtitle.trim().slice(0, 120) } : {}),
            description: d.description.trim(),
            category: d.category,
            imageUrl: d.cover,
            // Times are the venue's local wall-clock time, stored as UTC (the website does the same).
            startsAt: wallIso(d.date, d.start),
            ...(d.doors ? { doorsAt: wallIso(d.date, d.doors) } : {}),
            ...(d.end ? { endsAt: wallIso(d.date, d.end) } : {}),
            ...(d.format === 'online'
              ? { online: true, streamUrl: d.link.trim() }
              : d.format === 'book' && d.booking
                ? { venueBookingId: d.booking.id }
                : {
                  venue: {
                    name: d.venue.trim(),
                    address: d.address.trim(),
                    city: d.city.trim(),
                    country: d.country,
                    ...(d.region.trim() ? { region: d.region.trim() } : {}),
                    ...(d.postalCode.trim() ? { postalCode: d.postalCode.trim() } : {}),
                  },
                }),
            // Without a zone the API uses the venue country's main one.
            ...(zone ? { timezone: zone } : {}),
            currency: cur,
            feeMode: d.feeMode,
            visibility: 'PUBLIC',
            ticketTypes: d.tiers.map((t) => ({
              name: t.name.trim(),
              // Pay what you want: the API ignores the base price (sent as 0) and uses the PWYW amounts.
              ...(t.pricing === 'PWYW' ? { basePriceCents: 0, ...pwywBody(t.pwyw) } : { basePriceCents: parseMoney(t.price) ?? 0 }),
              capacity: Number(t.qty),
              ...(t.perks.length ? { perks: cleanPerks(t.perks) } : {}),
              ...(t.badge.trim() ? { badge: t.badge.trim() } : {}),
              ...(t.style ? { style: t.style } : {}),
            })),
            ...(d.donations.on ? donationBody(d.donations) : {}),
            ...(d.compLimit.trim() ? { compLimit: Number(d.compLimit) } : {}),
          },
        });
        id = ev.id;
        setCreated(id);
      }
      // A photo uploaded from the phone becomes the cover the website's way: the event's first media item.
      if (upload && d.cover === upload.url && !coverSet) {
        await api(`/organizer/events/${encodeURIComponent(id)}/media`, { method: 'PUT', body: { items: [{ id: upload.id, kind: 'image' }] } });
        setCoverSet(true);
      }
      // Waiting for a booked venue: saved as a draft; it's submitted once the venue confirms.
      if (submit && !waiting) await api(`/organizer/events/${encodeURIComponent(id)}/submit`, { method: 'POST' });
      haptic.success();
      await qc.invalidateQueries({ queryKey: ['organizer'] });
      router.replace({ pathname: '/organizer/events/[id]', params: { id } });
    } catch (e) {
      haptic.error();
      setError(id ? `Saved as a draft, but it wasn’t submitted: ${errorText(e)} You can submit it from the event’s page.` : errorText(e));
    } finally {
      setBusy('');
    }
  };

  if (!user || (!orgs.isPending && !org)) {
    return (
      <OrgScreen title="Create event">
        {!user ? (
          <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
        ) : (
          <EmptyState icon="lock" title="You can’t create events here" body="Door staff can scan tickets but not create events. Ask an admin of your team to make you a manager, or set up your own organizer profile." action="Set up a profile" onAction={() => router.replace('/organizer/start')} />
        )}
      </OrgScreen>
    );
  }

  const footer = (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <Button label="Back" variant="ghost" style={{ width: 96 }} onPress={back} disabled={!!busy} />
      {step < STEPS.length - 1 ? (
        <GradientButton label={`Next: ${SHORT[step + 1]}`} onPress={next} />
      ) : (
        <GradientButton label={waiting ? 'Save and wait for the venue' : 'Submit for review'} icon={waiting ? 'clock' : 'send'} loading={busy === 'submit'} disabled={!!busy} onPress={() => void save(true)} />
      )}
    </View>
  );

  // What the event card will look like, for the cover and review steps (a pay-what-you-want tier from its minimum).
  const lowest = d.tiers.map((t) => parseMoney(t.pricing === 'PWYW' ? t.pwyw.min : t.price)).filter((p): p is number => p !== null).sort((a, b) => a - b)[0];
  const preview: PreviewProps = {
    cover: d.cover,
    title: d.title.trim() || 'Your event name',
    subtitle: d.subtitle.trim(),
    category: d.category ? CATEGORY_NAME[d.category] : '',
    date: d.date,
    time: d.start ? timeLabel(d.start) : '',
    place:
      d.format === 'online'
        ? 'Online'
        : d.format === 'book' && d.booking
          ? [d.booking.venue.name, d.booking.venue.city].filter(Boolean).join(' · ')
          : [d.venue.trim(), d.city.trim()].filter(Boolean).join(' · ') || 'Venue to be announced',
    online: d.format === 'online',
    price: lowest === undefined ? '' : lowest === 0 ? 'Free' : money(buyerPrice(lowest, d.feeMode), cur),
  };
  /** Earlier steps can be revisited from the progress bar; later ones go through Next (so each step is checked). */
  const jump = (i: number) => {
    if (i >= step) return;
    haptic.select();
    setShow(false);
    setStep(i);
  };

  return (
    // Keyed by step so each step opens scrolled to the top (the form's state lives here, not in the screen).
    <OrgScreen key={step} title={STEPS[step]} eyebrow={`Create event · step ${step + 1} of ${STEPS.length}`} footer={footer}>
      <View style={styles.progress} accessibilityRole="tablist" accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
        {STEPS.map((s, i) => (
          <Pressable
            key={s}
            accessibilityRole="tab"
            accessibilityLabel={`${STEPS[i]}${i < step ? ', done. Go back to it' : i === step ? ', current step' : ''}`}
            accessibilityState={{ selected: i === step, disabled: i > step }}
            disabled={i >= step}
            hitSlop={{ top: 12, bottom: 12 }}
            onPress={() => jump(i)}
            style={styles.segHit}>
            <View style={[styles.dot, i < step && styles.dotDone, i === step && styles.dotNow]} />
          </Pressable>
        ))}
      </View>
      {params.first && step === 0 ? (
        <Notice tone="success" icon="check" title="Your organizer profile is ready">
          Now your first event. It’s saved as a draft until you submit it.
        </Notice>
      ) : null}

      {step === 0 ? (
        <>
          <Section icon="sparkle" title="Name your event" sub="The first thing fans see, on cards and in search.">
            <Field
              label="Event name"
              placeholder="e.g. Afrobeats Night Live"
              value={d.title}
              onChangeText={(v) => set('title', v)}
              maxLength={120}
              error={errors.title}
              inputStyle={styles.titleInput}
            />
            <Field label="Tagline (optional)" placeholder="One line under the name" value={d.subtitle} onChangeText={(v) => set('subtitle', v)} maxLength={120} />
          </Section>

          <Section icon="tag" title="Category" sub="Where fans will find it when they browse.">
            <CategoryGrid value={d.category} onPick={(c) => setD((p) => ({ ...p, category: c, cover: '' }))} />
            {errors.category ? (
              <Txt variant="small" color={colors.accentHi}>
                {errors.category}
              </Txt>
            ) : null}
          </Section>

          <Section icon="file" title="About the event" sub="Who’s on, what to expect, what’s included. Drag the handle to make the box bigger.">
            <TextArea
              label="Description"
              placeholder="Tell people why they shouldn’t miss it…"
              value={d.description}
              onChangeText={(v) => set('description', v)}
              maxLength={5000}
              error={errors.description}
              hint={d.description.trim().length < 20 ? 'At least 20 characters.' : undefined}
            />
          </Section>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Section
            icon="calendar"
            title="Date & schedule"
            sub={d.format === 'book' && d.booking ? `Inside your booking: ${rangeLabel(d.booking.startsAt, d.booking.endsAt)}, doors included.` : 'Doors and the end time are optional.'}>
            <DateField label="Date" value={d.date} onChange={(v) => set('date', v)} min={today} error={errors.date} />
            <View style={styles.row2}>
              <TimeField label="Starts" value={d.start} onChange={(v) => set('start', v)} error={errors.start} />
              <TimeField label="Doors open" value={d.doors} onChange={(v) => set('doors', v)} optional error={errors.doors} />
            </View>
            <View style={styles.row2}>
              <TimeField label="Ends" value={d.end} onChange={(v) => set('end', v)} optional error={errors.end} />
              <View style={{ flex: 1 }} />
            </View>
            {d.date && d.start ? (
              <View style={styles.whenPill}>
                <Icon name="clock" size={14} color={colors.accent} />
                <Txt variant="smallStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {dateLabel(d.date)} · {d.doors ? `doors ${timeLabel(d.doors)}, ` : ''}starts {timeLabel(d.start)}
                  {d.end ? ` · ends ${timeLabel(d.end)}` : ''}
                </Txt>
              </View>
            ) : null}
          </Section>

          <Section icon="pin" title="Where is it happening?" sub="At your own venue, a venue you hire on Eventro, or online.">
            <ChoiceRow>
              <ChoiceTile icon="pin" label="My venue" sub="Your own place" on={d.format === 'venue'} onPress={() => set('format', 'venue')} />
              <ChoiceTile icon="building" label="Book one" sub="Hire on Eventro" on={d.format === 'book'} onPress={() => set('format', 'book')} />
              <ChoiceTile icon="stream" label="Online" sub="Live stream" on={d.format === 'online'} onPress={() => set('format', 'online')} />
            </ChoiceRow>
          {d.format === 'venue' ? (
            <VenueFields value={d} onChange={patchPlace} errors={errors} />
          ) : d.format === 'book' ? (
            <View style={{ gap: space.lg }}>
              <Txt variant="small" color={colors.muted}>
                Venues listed for hire. You request a time; the venue confirms within 48 hours, and the event waits for that before it can be submitted.
              </Txt>
              {d.booking ? (
                <View style={{ gap: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Txt variant="title" style={{ flex: 1 }} numberOfLines={1}>
                      {d.booking.venue.name}
                    </Txt>
                    <BookingBadge status={d.booking.status} />
                  </View>
                  <Txt variant="small" color={colors.muted}>
                    {rangeLabel(d.booking.startsAt, d.booking.endsAt)} · {d.booking.code}
                  </Txt>
                  <Notice tone={d.booking.status === 'CONFIRMED' ? 'success' : 'warning'} icon={d.booking.status === 'CONFIRMED' ? 'check' : 'clock'}>
                    {d.booking.status === 'CONFIRMED'
                      ? 'Confirmed by the venue. You can submit the event for review when it’s ready.'
                      : 'Waiting for the venue to confirm. The event is saved with this booking and can be submitted for review once they confirm.'}
                  </Notice>
                  <Button label={d.bookingNew ? 'Request a different time' : 'Use another booking or venue'} variant="ghost" size="md" onPress={rebook} />
                </View>
              ) : d.pick ? (
                <View style={{ gap: space.lg }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Txt variant="title" style={{ flex: 1 }} numberOfLines={1}>
                      {d.pick.venue.name}
                    </Txt>
                    <Pressable accessibilityRole="button" accessibilityLabel="Pick another venue" onPress={() => pickVenue(null)} hitSlop={8}>
                      <Txt variant="smallStrong" color={colors.accent}>
                        Change
                      </Txt>
                    </Pressable>
                  </View>
                  <TermsCard listing={d.pick.listing} compact />
                  {org ? (
                    <BookingRequestForm
                      key={d.pick.venue.id}
                      venue={d.pick.venue}
                      listing={d.pick.listing}
                      orgs={editable}
                      fixedOrgId={org.org.id}
                      defaults={{ date: d.date || undefined, start: (d.doors && d.start && d.doors < d.start ? d.doors : d.start) || undefined, end: d.end || undefined }}
                      onBooked={(b) => setD((p) => ({ ...p, booking: b, bookingNew: true, ...(p.date ? {} : { date: b.startsAt.slice(0, 10) }) }))}
                    />
                  ) : null}
                </View>
              ) : (
                <>
                  {usable.length ? (
                    <View style={{ gap: space.sm }}>
                      <Label>Your bookings</Label>
                      <Txt variant="small" color={colors.muted}>
                        Already booked a venue on Eventro? Use it for this event; its date and times fill in.
                      </Txt>
                      {usable.map((b) => (
                        <BookingRow key={b.id} b={b} side="ORGANIZER" code onPress={() => setD((p) => withBooking(p, b, false))} />
                      ))}
                      <Label>Or find a venue</Label>
                    </View>
                  ) : null}
                  <VenueSearch date={d.date || undefined} onPick={pickVenue} />
                </>
              )}
              {errors.booking ? (
                <Txt variant="small" color={colors.accentHi}>
                  {errors.booking}
                </Txt>
              ) : null}
            </View>
          ) : (
            <>
              <Field label="Stream link" placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} value={d.link} onChangeText={(v) => set('link', v)} error={errors.link} hint="Only people with a ticket see it." />
              <View style={styles.zoneNote}>
                <Icon name="globe" size={14} color={colors.dim} />
                <Txt variant="small" color={colors.dim} style={{ flex: 1 }}>
                  Times are in your time zone{deviceZone() ? ` (${deviceZone().replace(/_/g, ' ')})` : ''}.
                </Txt>
              </View>
            </>
          )}
          </Section>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Section icon="cash" title="Currency fans pay in" sub={PAYSTACK.has(cur) ? 'Fans pay with card, bank transfer or USSD through Paystack.' : 'Fans pay by card. Fans abroad also see an approximate price in their currency.'}>
            <View style={styles.wrap}>
              {CURRENCIES.map((c) => (
                <Chip key={c.code} label={c.code} accessibilityLabel={c.name} active={d.currency === c.code} onPress={() => setD((p) => ({ ...p, currency: c.code, currencyChosen: true }))} />
              ))}
            </View>
            {errors.currency ? (
              <Txt variant="small" color={colors.accentHi}>
                {errors.currency}
              </Txt>
            ) : null}
          </Section>

          <Section icon="ticket" title="Ticket types" sub="Top tier first: fans see them in this order. Set 0 for a free ticket.">
          {errors.tiers ? (
            <Txt variant="small" color={colors.accentHi}>
              {errors.tiers}
            </Txt>
          ) : null}
          {d.tiers.map((t, i) => {
            const pwyw = t.pricing === 'PWYW';
            const base = parseMoney(t.price);
            const fan = base !== null ? buyerPrice(base, d.feeMode) : null;
            const you = base !== null && fan !== null ? (d.feeMode === 'BUYER' ? base : organizerNet(fan, 'ORGANIZER')) : null;
            const pwMin = parseMoney(t.pwyw.min);
            const shown = pwyw ? (pwMin === null ? undefined : pwMin > 0 ? `From ${money(buyerPrice(pwMin, d.feeMode), cur)}` : 'Any amount') : fan ? money(fan, cur) : base === 0 ? 'Free' : undefined;
            return (
              <View key={t.key} style={styles.tier}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Txt variant="eyebrow" color={colors.dim} style={{ flex: 1 }}>
                    {i === 0 ? 'Top tier first' : `Ticket ${i + 1}`}
                  </Txt>
                  {d.tiers.length > 1 ? (
                    <>
                      <Mini label="Move up" disabled={i === 0} rotate onPress={() => setD((p) => ({ ...p, tiers: swap(p.tiers, i, i - 1) }))} />
                      <Mini label="Move down" disabled={i === d.tiers.length - 1} onPress={() => setD((p) => ({ ...p, tiers: swap(p.tiers, i, i + 1) }))} />
                      <Mini label={`Remove ${t.name || 'ticket'}`} icon="trash" onPress={() => setD((p) => ({ ...p, tiers: p.tiers.filter((x) => x.key !== t.key) }))} />
                    </>
                  ) : null}
                </View>
                <Field label="Name" placeholder="General admission" value={t.name} onChangeText={(v) => patchTier(t.key, { name: v })} maxLength={60} error={errors[`${t.key}-name`]} />
                <PricingMode value={t.pricing} onChange={(pricing) => patchTier(t.key, { pricing })} />
                {pwyw ? (
                  <>
                    <Field label="Quantity" placeholder="100" keyboardType="number-pad" value={t.qty} onChangeText={(v) => patchTier(t.key, { qty: v.replace(/\D/g, '') })} error={errors[`${t.key}-qty`]} />
                    <PwywFields value={t.pwyw} onChange={(p) => patchTier(t.key, { pwyw: { ...t.pwyw, ...p } })} currency={cur} feeMode={d.feeMode} errors={errors} errorKey={t.key} />
                  </>
                ) : (
                  <>
                    <View style={styles.row2}>
                      <Field style={{ flex: 1 }} label={`Your price (${currencySymbol(cur)})`} placeholder="0 = free" keyboardType="decimal-pad" value={t.price} onChangeText={(v) => patchTier(t.key, { price: v.replace(/[^\d.]/g, '') })} error={errors[`${t.key}-price`]} />
                      <Field style={{ flex: 1 }} label="Quantity" placeholder="100" keyboardType="number-pad" value={t.qty} onChangeText={(v) => patchTier(t.key, { qty: v.replace(/\D/g, '') })} error={errors[`${t.key}-qty`]} />
                    </View>
                    {fan ? (
                      <Txt variant="small" color={colors.muted}>
                        Fans pay {money(fan, cur)} all-in · you get {money(you ?? 0, cur)}
                      </Txt>
                    ) : base === 0 ? (
                      <Txt variant="small" color={colors.muted}>
                        Free ticket
                      </Txt>
                    ) : null}
                  </>
                )}
                <View style={styles.tierDivider} />
                <TierExtras
                  name={t.name}
                  price={shown}
                  value={{ perks: t.perks, badge: t.badge, style: t.style }}
                  onChange={(patch) => patchTier(t.key, patch)}
                />
              </View>
            );
          })}
          {d.tiers.length < 20 ? (
            <View style={styles.addTier}>
              <TierPresets names={d.tiers.map((t) => t.name)} onPick={(p) => addTier(p)} />
              <Button label="Blank tier" variant="ghost" size="md" icon="plus" onPress={() => addTier()} />
            </View>
          ) : (
            <Txt variant="small" color={colors.dim}>
              That’s 20 ticket types, the most one event can have.
            </Txt>
          )}
          </Section>

          <Section icon="receipt" title="Eventro’s 3.5% fee" sub={d.feeMode === 'BUYER' ? 'Added to your price, so you get your price in full.' : 'Fans pay your price; the fee comes out of it.'}>
            <View style={styles.wrap}>
              <Chip label="Fans pay it" active={d.feeMode === 'BUYER'} onPress={() => set('feeMode', 'BUYER')} />
              <Chip label="I absorb it" active={d.feeMode === 'ORGANIZER'} onPress={() => set('feeMode', 'ORGANIZER')} />
            </View>
          </Section>

          <Section icon="heart" title="Donations" sub="Optional. Let fans add a donation to a cause when they check out.">
            <DonationFields
              value={d.donations}
              onChange={(p) => setD((x) => ({ ...x, donations: { ...x.donations, ...p } }))}
              currency={cur}
              errors={{ cause: errors['donation-cause'], description: errors['donation-description'], suggested: errors['donation-suggested'], min: errors['donation-min'] }}
            />
          </Section>

          <Section icon="gift" title="Comps" sub="Optional. Complimentary tickets for press, artists, sponsors and crew are issued after saving.">
            <Field
              label="Comp limit (optional)"
              placeholder="No limit"
              keyboardType="number-pad"
              value={d.compLimit}
              onChangeText={(v) => set('compLimit', v.replace(/\D/g, ''))}
              error={errors.compLimit}
              hint={errors.compLimit ? undefined : 'The most complimentary tickets that can be live at once. Revoked comps don’t count.'}
            />
          </Section>
          <Notice tone="plain" icon="seat" title="Reserved seating?">
            Save the event first, then design its seat map on the website. Ticket quantities follow the map.
          </Notice>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <CardPreview {...preview} />
          {errors.cover ? (
            <Txt variant="small" color={colors.accentHi}>
              {errors.cover}
            </Txt>
          ) : null}
          <Section icon="download" title="Your own photo" sub="From your phone’s photos. It replaces the cover on the card above.">
            <CoverUpload
              full={upload && d.cover === upload.url ? 'Upload a different photo' : undefined}
              onUploaded={(c) => {
                setUpload(c);
                setCoverSet(false);
                set('cover', c.url);
              }}
            />
          </Section>
          <Section icon="sparkle" title="Or pick one of ours" sub="Free photos, sorted by category. Tap one to try it on the card above.">
            <StockPicker category={d.category ? CATEGORY_NAME[d.category] : 'Concerts'} value={d.cover} onPick={(c) => set('cover', c)} />
          </Section>
          <Txt variant="small" color={colors.dim}>
            More photos and videos can be added from the event’s page on the website.
          </Txt>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <CardPreview {...preview} />
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={styles.sectionIcon}>
                <Icon name="check" size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="title">Check the details</Txt>
                <Txt variant="small" color={colors.muted}>
                  Tap a line to change it.
                </Txt>
              </View>
            </View>
            <ReviewLine icon="tag" text={d.category ? CATEGORY_NAME[d.category] : ''} onEdit={() => setStep(0)} />
            <ReviewLine icon="calendar" text={`${dateLabel(d.date)} · ${timeLabel(d.start)}${d.doors ? ` (doors ${timeLabel(d.doors)})` : ''}${d.end ? ` to ${timeLabel(d.end)}` : ''}`} onEdit={() => setStep(1)} />
            <ReviewLine
              icon={d.format === 'online' ? 'stream' : 'pin'}
              text={
                d.format === 'online'
                  ? 'Online event'
                  : d.format === 'book' && d.booking
                    ? `${d.booking.venue.name}, ${d.booking.venue.city} · booked on Eventro (${d.booking.status === 'CONFIRMED' ? 'confirmed' : 'waiting for the venue'})`
                    : [d.venue, d.address, d.city, d.region, d.postalCode, d.country ? countryName(d.country) : ''].filter((x) => x.trim()).join(', ')
              }
              onEdit={() => setStep(1)}
            />
            {d.tiers.map((t) => {
              const base = parseMoney(t.price) ?? 0;
              const min = parseMoney(t.pwyw.min) ?? 0;
              const price = t.pricing === 'PWYW' ? `Pay what you want${min ? `, from ${money(min, cur)}` : ''}` : base ? `${money(buyerPrice(base, d.feeMode), cur)} all-in` : 'Free';
              const extras = [t.badge.trim(), t.perks.length ? `${t.perks.length} ${t.perks.length === 1 ? 'perk' : 'perks'}` : ''].filter(Boolean).join(', ');
              return <ReviewLine key={t.key} icon="ticket" text={`${t.name.trim()} · ${price} · ${Number(t.qty).toLocaleString('en-US')}${extras ? ` · ${extras}` : ''}`} onEdit={() => setStep(2)} />;
            })}
            {d.donations.on ? <ReviewLine icon="heart" text={`Donations to ${d.donations.cause.trim()}`} onEdit={() => setStep(2)} /> : null}
            {d.compLimit.trim() ? <ReviewLine icon="gift" text={`Up to ${Number(d.compLimit).toLocaleString('en-US')} ${Number(d.compLimit) === 1 ? 'comp' : 'comps'} at once`} onEdit={() => setStep(2)} /> : null}
          </View>
          {d.format === 'book' && d.booking ? (
            <Txt variant="small" color={colors.dim}>
              Booked for {d.booking.org.name}, so the event is created there too.
            </Txt>
          ) : editable.length > 1 ? (
            <View style={{ gap: space.sm }}>
              <Txt variant="smallStrong" color={colors.muted}>
                Organizer
              </Txt>
              <View style={styles.wrap}>
                {editable.map((o) => (
                  <Chip key={o.org.id} label={o.org.name} active={o.org.id === org?.org.id} onPress={() => setOrgId(o.org.id)} />
                ))}
              </View>
            </View>
          ) : null}
          <Txt variant="small" color={colors.dim}>
            Eventro reviews every event before it goes on sale, usually within a day. You can keep editing while it’s in review.
          </Txt>
          {waiting ? (
            <Notice tone="warning" icon="clock" title="Waiting for the venue">
              {`It’s saved as a draft with your booking at ${d.booking!.venue.name}. Submit it for review from its page once the venue confirms; you’ll get an email and a notification.`}
            </Notice>
          ) : null}
          {error ? <Notice icon="alert">{error}</Notice> : null}
          {waiting && !created ? null : !created ? <Button label="Save as draft" variant="ghost" loading={busy === 'draft'} disabled={!!busy} onPress={() => void save(false)} /> : <Button label="Open the draft" variant="ghost" onPress={() => router.replace({ pathname: '/organizer/events/[id]', params: { id: created } })} />}
          <WebButton label="Create it on the web instead" path={webPaths.create} />
        </>
      ) : null}

    </OrgScreen>
  );
}

/**
 * Use an existing booking for the event: it's held there, on the booking's date, starting when the booking starts
 * and ending when it ends (when that's the same day). Doors are cleared: they'd fall before the booking.
 */
function withBooking(p: Draft, b: Booking, made: boolean): Draft {
  const date = b.startsAt.slice(0, 10);
  const start = b.startsAt.slice(11, 16);
  const end = b.endsAt.slice(0, 10) === date ? b.endsAt.slice(11, 16) : '';
  return {
    ...p,
    format: 'book',
    pick: null,
    booking: b,
    bookingNew: made,
    date,
    start,
    end,
    // Doors before the booking starts wouldn't fit inside it.
    doors: '',
    ...(b.venue.country && !p.currencyChosen ? { currency: currencyForCountry(b.venue.country) } : {}),
  };
}

const swap = <T,>(list: T[], i: number, j: number) => {
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function Mini({ label, onPress, disabled, rotate, icon = 'chevronDown' }: { label: string; onPress: () => void; disabled?: boolean; rotate?: boolean; icon?: 'chevronDown' | 'trash' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.mini, disabled && { opacity: 0.3 }, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={rotate ? { transform: [{ rotate: '180deg' }] } : undefined}>
        <Icon name={icon} size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function ReviewLine({ icon, text, onEdit }: { icon: 'tag' | 'calendar' | 'pin' | 'stream' | 'ticket' | 'heart' | 'gift'; text: string; onEdit: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. Edit`} onPress={onEdit} style={({ pressed }) => [styles.line, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={17} color={colors.muted} />
      <Txt variant="small" style={{ flex: 1 }}>
        {text}
      </Txt>
      <Txt variant="smallStrong" color={colors.accent}>
        Edit
      </Txt>
    </Pressable>
  );
}

type PreviewProps = { cover: string; title: string; subtitle: string; category: string; date: string; time: string; place: string; online: boolean; price: string };

/** The event as fans will see it on Discover, updated live as the organizer fills the form in. */
function CardPreview({ cover, title, subtitle, category, date, time, place, online, price }: PreviewProps) {
  const day = date ? new Date(`${date}T00:00:00Z`) : null;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={styles.liveDot} />
        <Txt variant="eyebrow" color={colors.muted}>
          Live preview · how fans see it
        </Txt>
      </View>
      <View style={styles.previewCard} accessibilityLabel={`Preview: ${title}${date ? `, ${dateLabel(date)}` : ''}${time ? ` at ${time}` : ''}, ${place}${price ? `, from ${price}` : ''}`}>
        <View style={styles.previewMedia}>
          {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} /> : null}
          <LinearGradient colors={[colors.fade0, colors.fade]} locations={[0.4, 1]} style={StyleSheet.absoluteFill} />
          <View style={styles.previewTop}>
            {day ? (
              <View style={styles.previewDate}>
                <Txt variant="eyebrow" color={colors.accent} style={{ fontSize: 10, lineHeight: 12 }}>
                  {day.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}
                </Txt>
                <Txt variant="h3" color={colors.onImage} style={{ lineHeight: 21 }}>
                  {day.getUTCDate()}
                </Txt>
              </View>
            ) : (
              <View />
            )}
            {category ? (
              <View style={styles.previewBadge}>
                <Txt variant="tiny" color={colors.onImage}>
                  {category}
                </Txt>
              </View>
            ) : null}
          </View>
          <View style={styles.previewText}>
            <Txt variant="h3" color={colors.onImage} numberOfLines={1}>
              {title}
            </Txt>
            {subtitle ? (
              <Txt variant="small" color={colors.onImageSoft} numberOfLines={1}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
        </View>
        <View style={styles.previewMeta}>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="smallStrong" numberOfLines={1}>
              {date ? dateLabel(date) : 'Date to come'}
              {time ? ` · ${time}` : ''}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={online ? 'stream' : 'pin'} size={13} color={colors.dim} />
              <Txt variant="small" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
                {place}
              </Txt>
            </View>
          </View>
          {price ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Txt variant="eyebrow" color={colors.dim} style={{ fontSize: 10, lineHeight: 12 }}>
                {price === 'Free' ? 'Tickets' : 'From'}
              </Txt>
              <Txt variant="price" color={colors.accent}>
                {price}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Categories as an even three-column grid of tiles; the chosen one is filled with a check. */
function CategoryGrid({ value, onPick }: { value: string; onPick: (c: (typeof CATEGORIES)[number]) => void }) {
  const [w, setW] = useState(0);
  const tile = w ? Math.floor((w - space.sm * 2) / 3) : 0;
  return (
    <View style={styles.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="radiogroup">
      {tile
        ? CATEGORIES.map((c) => {
            const on = value === c;
            return (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={CATEGORY_NAME[c]}
                onPress={() => {
                  haptic.select();
                  onPick(c);
                }}
                style={({ pressed }) => [styles.tile, { width: tile }, on && styles.tileOn, pressed && { transform: [{ scale: 0.97 }] }]}>
                <Txt variant="smallStrong" color={on ? colors.accentInk : colors.text} numberOfLines={1}>
                  {CATEGORY_NAME[c]}
                </Txt>
                {on ? (
                  <View style={styles.tileCheck}>
                    <Icon name="check" size={10} color={colors.accent} />
                  </View>
                ) : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6 },
  sectionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  titleInput: { fontFamily: font.display.bold, fontSize: 20, letterSpacing: -0.4, minHeight: 56 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tileOn: { backgroundColor: colors.accent, borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  tileCheck: { position: 'absolute', top: 5, right: 5, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accentInk, alignItems: 'center', justifyContent: 'center' },
  segHit: { flex: 1, paddingVertical: 4 },
  dot: { height: 5, borderRadius: 3, backgroundColor: colors.surface2 },
  dotDone: { backgroundColor: colors.accent, opacity: 0.55 },
  dotNow: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  whenPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  zoneNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  previewCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, overflow: 'hidden' },
  previewMedia: { aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  previewTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  previewDate: { width: 44, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center' },
  previewBadge: { paddingHorizontal: 10, height: 26, borderRadius: 13, justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  previewText: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 1 },
  previewMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingVertical: space.md, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: colors.line },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row2: { flexDirection: 'row', gap: space.md },
  tier: { gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tierDivider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
  addTier: { gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line2 },
  mini: { width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2 },
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
});
