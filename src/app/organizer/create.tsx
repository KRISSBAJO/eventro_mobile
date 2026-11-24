/**
 * Create an event in five short steps: basics → when and where → tickets → cover → review. "Save as draft" is
 * POST /organizer/orgs/:orgId/events (the website's body); "Submit for review" also calls POST …/events/:id/submit.
 *
 * As on the website: times are the venue's wall-clock time stored as UTC; ticket prices are the organizer's price
 * and the fee mode decides who pays Eventro's fee; the cover is one of the free stock photos (no image picker is
 * installed, so uploading your own happens on the website); online events need their stream link; seat maps are
 * designed on the website after saving.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DateField, dateLabel, TimeField, timeLabel } from '@/components/date-time';
import { Icon } from '@/components/icons';
import { OptionSheet } from '@/components/option-sheet';
import { Label, OrgScreen, WebButton } from '@/components/org-ui';
import { StockPicker } from '@/components/stock-picker';
import { Button, Chip, EmptyState, Field, Notice, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CATEGORY_NAME, countryName, currencyForCountry, currencySymbol, money, PAYSTACK, todayYmd } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  buyerPrice,
  canEdit,
  COUNTRY_ZONES,
  CURRENCIES,
  deviceZone,
  organizerNet,
  parseMoney,
  VENUE_COUNTRIES,
  wallIso,
  webPaths,
} from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { defaultCover } from '@/lib/stock-covers';
import type { Category } from '@/lib/types';
import { colors, radius, space, touch } from '@/theme';

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
      if (!/^[A-Z]{2}$/.test(d.country)) e.country = 'Choose the country.';
      if (d.venue.trim().length < 2) e.venue = 'Add the venue name.';
      if (d.address.trim().length < 3) e.address = 'Add the street address.';
      if (d.city.trim().length < 2) e.city = 'Add the city.';
      if (COUNTRY_ZONES[d.country] && !d.zone) e.zone = 'Choose the time zone the times are in.';
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
  const [sheet, setSheet] = useState<'' | 'country' | 'zone'>('');
  const today = todayYmd();
  const errors = useMemo(() => (show ? validate(step, d, today) : {}), [show, step, d, today]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const patchTier = (key: string, p: Partial<Tier>) => setD((x) => ({ ...x, tiers: x.tiers.map((t) => (t.key === key ? { ...t, ...p } : t)) }));
  const cur = d.currency || 'USD';

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

  const pickCountry = (c: string) => {
    setD((p) => ({
      ...p,
      country: c,
      zone: COUNTRY_ZONES[c]?.some((z) => z.id === p.zone) ? p.zone : COUNTRY_ZONES[c]?.find((z) => z.id === deviceZone())?.id ?? '',
      currency: p.currencyChosen ? p.currency : currencyForCountry(c),
    }));
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
          <Field label="Event name" placeholder="e.g. Afrobeats Night Live" value={d.title} onChangeText={(v) => set('title', v)} maxLength={120} error={errors.title} />
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" color={colors.muted}>
              Category
            </Txt>
            <View style={styles.wrap}>
              {CATEGORIES.map((c) => (
                <Chip key={c} label={CATEGORY_NAME[c]} active={d.category === c} onPress={() => setD((p) => ({ ...p, category: c, cover: '' }))} />
              ))}
            </View>
            {errors.category ? (
              <Txt variant="small" color={colors.accentHi}>
                {errors.category}
              </Txt>
            ) : null}
          </View>
          <Field label="Tagline (optional)" placeholder="One line under the name" value={d.subtitle} onChangeText={(v) => set('subtitle', v)} maxLength={120} />
          <Field label="Description" placeholder="Who’s on, what to expect, what’s included…" value={d.description} onChangeText={(v) => set('description', v)} multiline textAlignVertical="top" maxLength={5000} error={errors.description} hint={`${d.description.trim().length} characters`} />
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
            <>
              <Pick label="Country" value={d.country ? countryName(d.country) : ''} placeholder="Choose the country" error={errors.country} onPress={() => setSheet('country')} />
              <Field label="Venue name" placeholder="e.g. Eko Convention Centre" value={d.venue} onChangeText={(v) => set('venue', v)} maxLength={120} error={errors.venue} />
              <Field label="Street address" value={d.address} onChangeText={(v) => set('address', v)} maxLength={200} error={errors.address} />
              <View style={styles.row2}>
                <Field style={{ flex: 1 }} label="City" value={d.city} onChangeText={(v) => set('city', v)} maxLength={80} error={errors.city} />
                <Field style={{ flex: 1 }} label="State (optional)" value={d.region} onChangeText={(v) => set('region', v)} maxLength={80} />
              </View>
              <Field label="Postal code (optional)" value={d.postalCode} onChangeText={(v) => set('postalCode', v)} maxLength={20} autoCapitalize="characters" />
              {COUNTRY_ZONES[d.country] ? (
                <Pick
                  label="Time zone"
                  value={COUNTRY_ZONES[d.country].find((z) => z.id === d.zone)?.label ?? ''}
                  placeholder="Choose the venue’s time zone"
                  error={errors.zone}
                  hint="The times above are local to the venue."
                  onPress={() => setSheet('zone')}
                />
              ) : (
                <Txt variant="small" color={colors.dim}>
                  Times are local to the venue.
                </Txt>
              )}
            </>
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
          <Label>No photos yet? Pick one of ours</Label>
          <StockPicker category={d.category ? CATEGORY_NAME[d.category] : 'Concerts'} value={d.cover} onPick={(c) => set('cover', c)} />
          <Notice tone="plain" icon="external" title="Your own photos">
            Uploading your own photos and videos happens on the website for now. Save the event, then add them from its page there.
          </Notice>
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

      <OptionSheet<string>
        visible={sheet === 'country'}
        title="Country"
        options={VENUE_COUNTRIES.map((c) => ({ value: c, label: countryName(c) }))}
        value={d.country}
        onPick={pickCountry}
        onClose={() => setSheet('')}
      />
      <OptionSheet<string>
        visible={sheet === 'zone'}
        title="Time zone"
        options={(COUNTRY_ZONES[d.country] ?? []).map((z) => ({ value: z.id, label: z.label, detail: z.id.split('/')[1]?.replace(/_/g, ' ') }))}
        value={d.zone}
        onPick={(z) => set('zone', z)}
        onClose={() => setSheet('')}
      />
    </OrgScreen>
  );
}

const swap = <T,>(list: T[], i: number, j: number) => {
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function Pick({ label, value, placeholder, error, hint, onPress }: { label: string; value: string; placeholder: string; error?: string; hint?: string; onPress: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="smallStrong" color={colors.muted}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}`}
        onPress={() => {
          haptic.select();
          onPress();
        }}
        style={({ pressed }) => [styles.pick, !!error && { borderColor: colors.accent }, pressed && { backgroundColor: colors.surface2 }]}>
        <Txt color={value ? colors.text : colors.dim} style={{ flex: 1 }} numberOfLines={1}>
          {value || placeholder}
        </Txt>
        <Icon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
      {error ? (
        <Txt variant="small" color={colors.accentHi}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" color={colors.dim}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

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

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6 },
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
