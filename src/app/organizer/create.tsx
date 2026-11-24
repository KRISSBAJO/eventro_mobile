/**
 * Create an event in five short steps: basics → when and where → tickets → cover → review. "Save as draft" is
 * POST /organizer/orgs/:orgId/events (the website's body); "Submit for review" also calls POST …/events/:id/submit.
 *
 * As on the website: times are the venue's wall-clock time stored as UTC; ticket prices are the organizer's price
 * and the fee mode decides who pays Eventro's fee; the cover is a photo uploaded from the phone (expo-image-picker,
 * then the website's upload endpoints and PUT …/events/:id/media, which makes it the cover) or one of the free stock
 * photos; online events need their stream link; seat maps are designed on the website after saving. The venue fields
 * are shared with Change venue (components/venue-fields.tsx).
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DateField, dateLabel, TimeField, timeLabel } from '@/components/date-time';
import { Icon, type IconName } from '@/components/icons';
import { CoverUpload } from '@/components/cover-upload';
import { Label, OrgScreen, WebButton } from '@/components/org-ui';
import { StockPicker } from '@/components/stock-picker';
import { placeErrors, VenueFields, type VenuePlace } from '@/components/venue-fields';
import { Button, Chip, EmptyState, Field, Notice, TextArea, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
import { useMyOrgs } from '@/lib/queries';
import type { UploadedCover } from '@/lib/media-upload';
import { defaultCover } from '@/lib/stock-covers';
import type { Category } from '@/lib/types';
import { colors, font, radius, space, touch } from '@/theme';

const STEPS = ['Basics', 'When and where', 'Tickets', 'Cover', 'Review'];
const CATEGORIES = Object.keys(CATEGORY_NAME) as Category[];

type Tier = { key: string; name: string; price: string; qty: string };
type Draft = {
  title: string;
  category: Category | '';
  subtitle: string;
  description: string;
  date: string;
  start: string;
  doors: string;
  end: string;
  format: 'venue' | 'online';
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
  tiers: [{ key: 't0', name: 'General admission', price: '', qty: '' }],
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
    } else if (!/^https?:\/\/\S+\.\S+/.test(d.link.trim())) {
      e.link = 'Add a full link, starting with https://';
    }
  }
  if (step === 2) {
    if (!d.currency) e.currency = 'Choose the currency fans pay in.';
    if (!d.tiers.length) e.tiers = 'Add at least one ticket type.';
    for (const t of d.tiers) {
      if (!t.name.trim()) e[`${t.key}-name`] = 'Name this ticket.';
      const p = parseMoney(t.price);
      if (p === null) e[`${t.key}-price`] = 'Enter a price (0 for free).';
      else if (p > 0 && p < 100) e[`${t.key}-price`] = `Paid tickets start at ${money(100, d.currency || 'USD')}.`;
      const q = Number(t.qty);
      if (!Number.isInteger(q) || q < 1) e[`${t.key}-qty`] = 'Enter a quantity.';
      else if (q > 200_000) e[`${t.key}-qty`] = 'At most 200,000.';
    }
  }
  if (step === 3 && !d.cover) e.cover = 'Pick a cover photo.';
  return e;
}

export default function CreateEvent() {
  const params = useLocalSearchParams<{ orgId?: string; first?: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const qc = useQueryClient();
  const editable = (orgs.data ?? []).filter((o) => canEdit(o.role));
  const [orgId, setOrgId] = useState<string | null>(null);
  const org = editable.find((o) => o.org.id === (orgId ?? params.orgId)) ?? editable[0];

  const [d, setD] = useState<Draft>(EMPTY);
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
  const cur = d.currency || 'USD';

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
        const zone = d.format === 'online' ? deviceZone() : d.zone;
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
            ticketTypes: d.tiers.map((t) => ({ name: t.name.trim(), basePriceCents: parseMoney(t.price) ?? 0, capacity: Number(t.qty) })),
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
      if (submit) await api(`/organizer/events/${encodeURIComponent(id)}/submit`, { method: 'POST' });
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
        <Button label="Next" iconRight="arrowRight" style={{ flex: 1 }} onPress={next} />
      ) : (
        <Button label="Submit for review" style={{ flex: 1 }} loading={busy === 'submit'} disabled={!!busy} onPress={() => void save(true)} />
      )}
    </View>
  );

  return (
    <OrgScreen title={STEPS[step]} eyebrow={`Create event · step ${step + 1} of ${STEPS.length}`} footer={footer}>
      <View style={styles.progress} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.dot, i <= step && { backgroundColor: colors.accent }]} />
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
          <DateField label="Date" value={d.date} onChange={(v) => set('date', v)} min={today} error={errors.date} />
          <View style={styles.row2}>
            <TimeField label="Starts" value={d.start} onChange={(v) => set('start', v)} error={errors.start} />
            <TimeField label="Doors open" value={d.doors} onChange={(v) => set('doors', v)} optional error={errors.doors} />
          </View>
          <View style={styles.row2}>
            <TimeField label="Ends" value={d.end} onChange={(v) => set('end', v)} optional error={errors.end} />
            <View style={{ flex: 1 }} />
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" color={colors.muted}>
              Where
            </Txt>
            <View style={styles.wrap}>
              <Chip label="At a venue" icon="pin" active={d.format === 'venue'} onPress={() => set('format', 'venue')} />
              <Chip label="Online" icon="stream" active={d.format === 'online'} onPress={() => set('format', 'online')} />
            </View>
          </View>
          {d.format === 'venue' ? (
            <VenueFields value={d} onChange={patchPlace} errors={errors} />
          ) : (
            <>
              <Field label="Stream link" placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} value={d.link} onChangeText={(v) => set('link', v)} error={errors.link} hint="Only people with a ticket see it." />
              <Txt variant="small" color={colors.dim}>
                Times are in your time zone{deviceZone() ? ` (${deviceZone().replace(/_/g, ' ')})` : ''}.
              </Txt>
            </>
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" color={colors.muted}>
              Currency fans pay in
            </Txt>
            <View style={styles.wrap}>
              {CURRENCIES.map((c) => (
                <Chip key={c.code} label={c.code} accessibilityLabel={c.name} active={d.currency === c.code} onPress={() => setD((p) => ({ ...p, currency: c.code, currencyChosen: true }))} />
              ))}
            </View>
            <Txt variant="small" color={errors.currency ? colors.accentHi : colors.dim}>
              {errors.currency ??
                (PAYSTACK.has(cur) ? 'Fans pay with card, bank transfer or USSD through Paystack.' : 'Fans pay by card. Fans abroad also see an approximate price in their currency.')}
            </Txt>
          </View>

          {errors.tiers ? (
            <Txt variant="small" color={colors.accentHi}>
              {errors.tiers}
            </Txt>
          ) : null}
          {d.tiers.map((t, i) => {
            const base = parseMoney(t.price);
            const fan = base !== null ? buyerPrice(base, d.feeMode) : null;
            const you = base !== null && fan !== null ? (d.feeMode === 'BUYER' ? base : organizerNet(fan, 'ORGANIZER')) : null;
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
              </View>
            );
          })}
          <Button
            label="Add a ticket type"
            variant="ghost"
            size="md"
            icon="plus"
            disabled={d.tiers.length >= 20}
            onPress={() => setD((p) => ({ ...p, tiers: [...p.tiers, { key: `t${Date.now()}`, name: '', price: '', qty: '' }] }))}
          />

          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" color={colors.muted}>
              Eventro’s 3.5% fee
            </Txt>
            <View style={styles.wrap}>
              <Chip label="Fans pay it" active={d.feeMode === 'BUYER'} onPress={() => set('feeMode', 'BUYER')} />
              <Chip label="I absorb it" active={d.feeMode === 'ORGANIZER'} onPress={() => set('feeMode', 'ORGANIZER')} />
            </View>
            <Txt variant="small" color={colors.dim}>
              {d.feeMode === 'BUYER' ? 'Added to your price, so you get your price in full.' : 'Fans pay your price; the fee comes out of it.'}
            </Txt>
          </View>
          <Notice tone="plain" icon="seat" title="Reserved seating?">
            Save the event first, then design its seat map on the website. Ticket quantities follow the map.
          </Notice>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <View style={styles.cover}>{d.cover ? <Image source={{ uri: d.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
          {errors.cover ? (
            <Txt variant="small" color={colors.accentHi}>
              {errors.cover}
            </Txt>
          ) : null}
          <Label>Your own photo</Label>
          <CoverUpload
            full={upload && d.cover === upload.url ? 'Upload a different photo' : undefined}
            onUploaded={(c) => {
              setUpload(c);
              setCoverSet(false);
              set('cover', c.url);
            }}
          />
          <Label>No photos yet? Pick one of ours</Label>
          <StockPicker category={d.category ? CATEGORY_NAME[d.category] : 'Concerts'} value={d.cover} onPick={(c) => set('cover', c)} />
          <Txt variant="small" color={colors.dim}>
            More photos and videos can be added from the event’s page on the website.
          </Txt>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <View style={styles.cover}>{d.cover ? <Image source={{ uri: d.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
          <View style={styles.card}>
            <Txt variant="h3">{d.title.trim()}</Txt>
            {d.subtitle.trim() ? <Txt color={colors.muted}>{d.subtitle.trim()}</Txt> : null}
            <ReviewLine icon="tag" text={d.category ? CATEGORY_NAME[d.category] : ''} onEdit={() => setStep(0)} />
            <ReviewLine icon="calendar" text={`${dateLabel(d.date)} · ${timeLabel(d.start)}${d.doors ? ` (doors ${timeLabel(d.doors)})` : ''}${d.end ? ` to ${timeLabel(d.end)}` : ''}`} onEdit={() => setStep(1)} />
            <ReviewLine
              icon={d.format === 'online' ? 'stream' : 'pin'}
              text={d.format === 'online' ? 'Online event' : [d.venue, d.address, d.city, d.region, d.postalCode, d.country ? countryName(d.country) : ''].filter((x) => x.trim()).join(', ')}
              onEdit={() => setStep(1)}
            />
            {d.tiers.map((t) => {
              const base = parseMoney(t.price) ?? 0;
              return <ReviewLine key={t.key} icon="ticket" text={`${t.name.trim()} · ${base ? `${money(buyerPrice(base, d.feeMode), cur)} all-in` : 'Free'} · ${Number(t.qty).toLocaleString('en-US')}`} onEdit={() => setStep(2)} />;
            })}
          </View>
          {editable.length > 1 ? (
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
          {error ? <Notice icon="alert">{error}</Notice> : null}
          {!created ? <Button label="Save as draft" variant="ghost" loading={busy === 'draft'} disabled={!!busy} onPress={() => void save(false)} /> : <Button label="Open the draft" variant="ghost" onPress={() => router.replace({ pathname: '/organizer/events/[id]', params: { id: created } })} />}
          <WebButton label="Create it on the web instead" path={webPaths.create} />
        </>
      ) : null}

    </OrgScreen>
  );
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

function ReviewLine({ icon, text, onEdit }: { icon: 'tag' | 'calendar' | 'pin' | 'stream' | 'ticket'; text: string; onEdit: () => void }) {
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

/** A titled card that groups the fields of one part of the form. */
function Section({ icon, title, sub, children }: { icon: IconName; title: string; sub?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Icon name={icon} size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title">{title}</Txt>
          {sub ? (
            <Txt variant="small" color={colors.muted}>
              {sub}
            </Txt>
          ) : null}
        </View>
      </View>
      {children}
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
  section: { gap: space.lg, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  sectionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  titleInput: { fontFamily: font.display.bold, fontSize: 20, letterSpacing: -0.4, minHeight: 56 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tileOn: { backgroundColor: colors.accent, borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  tileCheck: { position: 'absolute', top: 5, right: 5, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accentInk, alignItems: 'center', justifyContent: 'center' },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surface2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row2: { flexDirection: 'row', gap: space.md },
  tier: { gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  mini: { width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2 },
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
});
