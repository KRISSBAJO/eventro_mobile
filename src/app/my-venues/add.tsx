/**
 * Getting a venue onto Eventro, for whoever owns or runs one: what it brings (bookings from organizers, your price,
 * hours and blocked-out time, 48 hours to confirm, payment arranged directly), then find the venue (GET /venues?q=)
 * and claim it (POST /venues/:slug/claims), or add one that isn't on Eventro (POST /me/venues; it stays hidden until
 * Eventro approves). A 409 VENUE_EXISTS offers claiming that one instead. Then: waiting for approval.
 *
 * `?slug=` (a venue page's "Claim this page") goes straight to claiming that venue. Declined-claim notifications
 * (/venues/list) open this screen.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GradientButton, Section, formStyles } from '@/components/form-ui';
import { Icon, type IconName } from '@/components/icons';
import { OptionSheet } from '@/components/option-sheet';
import { OrgScreen } from '@/components/org-ui';
import { Pick } from '@/components/venue-fields';
import { claimErrors, ClaimFields, EMPTY_CLAIM, placeLine, RequestCard, VenueRow, type ClaimInput } from '@/components/venue-owner';
import { Badge, Button, EmptyState, ErrorState, Field, Notice, Skeleton, TextArea, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMyVenues } from '@/lib/bookings';
import { countryName, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { linkError, PHONE_RE, useVenueMatches, wholeIn, type ExistingVenue } from '@/lib/my-venues';
import { VENUE_COUNTRIES } from '@/lib/organizer';
import { usePlace } from '@/lib/place';
import type { VenuePage } from '@/lib/types';
import { colors, radius, space } from '@/theme';

type Step = 'intro' | 'find' | 'claim' | 'new' | 'done';
/** The venue being claimed. */
type Target = { slug: string; name: string; city: string; address?: string; country?: string | null; managed?: boolean };

const BENEFITS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'calendar', title: 'Get booked by organizers', body: 'Organizers find your venue under “Book a venue” and request the times they want.' },
  { icon: 'cash', title: 'Set your price', body: 'Per hour, per day, or ask for a quote and price each request yourself.' },
  { icon: 'clock', title: 'Your hours, your rules', body: 'Weekly opening hours, notice, setup and cleanup time, and blocked-out dates nobody can request.' },
  { icon: 'check', title: 'You decide', body: 'Confirm or decline each request within 48 hours, or turn on instant booking for free times.' },
  { icon: 'receipt', title: 'Paid directly', body: 'Payment is arranged directly between you and the organizer, outside Eventro.' },
];

export default function ListVenue() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const mine = useMyVenues(user?.id);
  const { place } = usePlace();
  const [step, setStep] = useState<Step>(params.slug ? 'claim' : 'intro');
  const [target, setTarget] = useState<Target | null>(null);
  const [claim, setClaim] = useState<ClaimInput>(EMPTY_CLAIM);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ name: string; newVenue: boolean } | null>(null);

  // "Claim this page" from a venue page: that venue.
  const fromPage = useQuery({ queryKey: ['venue', params.slug], queryFn: () => api<VenuePage>(`/venues/${encodeURIComponent(params.slug!)}`), enabled: !!params.slug, staleTime: 60_000 });
  const page = fromPage.data;
  const claiming: Target | null = target ?? (page ? { slug: page.slug, name: page.name, city: page.city, address: page.address, country: page.country, managed: page.managed } : null);

  const go = (s: Step) => {
    setError('');
    setTried(false);
    setStep(s);
  };
  const back = () => {
    if (step === 'find') go('intro');
    else if ((step === 'claim' && !(params.slug && !target)) || step === 'new') go('find');
    else if (router.canGoBack()) router.back();
    else router.replace('/account');
  };

  if (!user) {
    return (
      <OrgScreen title="List your venue" eyebrow="For venues" fallback="/account">
        <Intro />
        <EmptyState
          compact
          icon="lock"
          title="Sign in to start"
          body="Venue managers have an Eventro account, so organizers and our team know who they’re talking to."
          action="Sign in"
          onAction={() => router.push({ pathname: '/sign-in', params: { then: params.slug ? `/venues/${params.slug}` : '/venues/list' } })}
        />
      </OrgScreen>
    );
  }

  const managedSlugs = new Set((mine.data?.managed ?? []).map((m) => m.venue.slug));
  const pendingFor = (slug: string) => mine.data?.requests.find((r) => r.venue.slug === slug && r.status === 'PENDING');

  const sendClaim = async () => {
    if (!claiming) return;
    setTried(true);
    setError('');
    if (Object.keys(claimErrors(claim, true)).length) {
      haptic.warning();
      return;
    }
    setBusy(true);
    try {
      await api(`/venues/${encodeURIComponent(claiming.slug)}/claims`, {
        body: { role: claim.role, message: claim.message.trim(), ...(claim.website.trim() ? { website: claim.website.trim() } : {}) },
      });
      haptic.success();
      await qc.invalidateQueries({ queryKey: ['me', 'venues'] });
      setDone({ name: claiming.name, newVenue: false });
      go('done');
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- the steps ---------- */

  if (step === 'done' && done) {
    return (
      <OrgScreen title="Request sent" eyebrow="For venues" fallback="/account" onBack={() => router.replace('/account')}>
        <View style={styles.doneCard}>
          <View style={styles.doneIcon}>
            <Icon name="clock" size={28} color={colors.warning} />
          </View>
          <Txt variant="h2" style={{ textAlign: 'center' }}>
            Waiting for approval
          </Txt>
          <Txt color={colors.muted} style={{ textAlign: 'center' }}>
            Eventro checks every request by hand, usually within a day. We’ll email you and send a notification as soon as you can manage {done.name}.
          </Txt>
          {done.newVenue ? (
            <Txt variant="small" color={colors.dim} style={{ textAlign: 'center' }}>
              Until then, {done.name} isn’t shown on Eventro.
            </Txt>
          ) : null}
        </View>
        <Section icon="sparkle" title="Once you’re approved" sub="From Account → My venues:">
          {['Set your price and terms, and switch on bookings', 'Add your weekly opening hours', 'Block out dates you’re closed', 'Answer requests within 48 hours'].map((t) => (
            <View key={t} style={styles.bullet}>
              <Icon name="check" size={15} color={colors.success} />
              <Txt variant="small" style={{ flex: 1 }}>
                {t}
              </Txt>
            </View>
          ))}
        </Section>
        <Button label="Back to my account" variant="ghost" onPress={() => router.replace('/account')} />
      </OrgScreen>
    );
  }

  if (step === 'claim') {
    if (!claiming) {
      return (
        <OrgScreen title="Claim this venue" eyebrow="For venues" fallback="/account">
          {fromPage.error ? (
            fromPage.error instanceof ApiError && fromPage.error.status === 404 ? (
              <EmptyState icon="building" title="Venue not found" body="Search for it instead, or add it." action="Find your venue" onAction={() => go('find')} />
            ) : (
              <ErrorState message={errorText(fromPage.error)} onRetry={() => void fromPage.refetch()} />
            )
          ) : (
            <>
              <Skeleton height={80} radius={radius.card} />
              <Skeleton height={200} radius={radius.card} />
            </>
          )}
        </OrgScreen>
      );
    }
    const manages = managedSlugs.has(claiming.slug);
    const pending = pendingFor(claiming.slug);
    const errors = tried ? claimErrors(claim, true) : {};
    return (
      <OrgScreen
        title={`Claim ${claiming.name}`}
        eyebrow="Step 2 of 2 · Who you are"
        fallback="/account"
        onBack={back}
        footer={
          manages || pending ? undefined : (
            <View style={{ flexDirection: 'row' }}>
              <GradientButton label="Send request" icon="send" loading={busy} onPress={() => void sendClaim()} />
            </View>
          )
        }>
        <VenueRow name={claiming.name} sub={placeLine(claiming)} badges={claiming.managed ? <Badge label="Has a manager on Eventro" /> : undefined} />
        {manages ? (
          <Notice tone="success" icon="check" title="You manage this venue" action="Open My venues" onAction={() => router.replace('/my-venues')}>
            Its listing, hours and blocked-out time are in My venues.
          </Notice>
        ) : pending ? (
          <RequestCard r={pending} />
        ) : (
          <>
            {claiming.managed ? (
              <Notice tone="plain" icon="users" title="Already managed on Eventro">
                {`${claiming.name} has a manager on Eventro. You can still ask to join them; our team checks it the same way.`}
              </Notice>
            ) : null}
            <ClaimFields value={claim} onChange={(p) => setClaim((c) => ({ ...c, ...p }))} errors={errors} venueName={claiming.name} />
            {error ? <Notice icon="alert">{error}</Notice> : null}
            {!params.slug || target ? <Button label="Not this venue" variant="subtle" size="md" onPress={() => go('find')} /> : null}
          </>
        )}
      </OrgScreen>
    );
  }

  if (step === 'new') {
    return (
      <NewVenue
        initialName={search.trim()}
        initialCountry={place?.country && VENUE_COUNTRIES.includes(place.country) ? place.country : ''}
        claim={claim}
        setClaim={setClaim}
        onBack={back}
        onClaimInstead={(v) => {
          setTarget({ slug: v.slug, name: v.name, city: v.city, address: v.address });
          go('claim');
        }}
        onSent={(name) => {
          setDone({ name, newVenue: true });
          go('done');
        }}
      />
    );
  }

  if (step === 'find') {
    return (
      <OrgScreen title="Find your venue" eyebrow="Step 1 of 2 · Your venue" fallback="/account" onBack={back}>
        <FindVenue
          query={search}
          onQuery={setSearch}
          managedSlugs={managedSlugs}
          pendingFor={(slug) => !!pendingFor(slug)}
          onPick={(v) => {
            setTarget(v);
            go('claim');
          }}
          onAdd={() => go('new')}
        />
      </OrgScreen>
    );
  }

  // intro
  const waiting = (mine.data?.requests ?? []).filter((r) => r.status === 'PENDING');
  return (
    <OrgScreen
      title="List your venue"
      eyebrow="For venues"
      fallback="/account"
      footer={
        <View style={{ flexDirection: 'row' }}>
          <GradientButton label="Find your venue" icon="search" onPress={() => go('find')} />
        </View>
      }>
      <Intro />
      {waiting.map((r) => (
        <RequestCard key={r.id} r={r} onOpen={() => router.push({ pathname: '/venue/[slug]', params: { slug: r.venue.slug } })} />
      ))}
      <Section icon="sparkle" title="How it works">
        {['Find your venue on Eventro, or add it', 'Tell us who you are there', 'Eventro checks, usually within a day', 'Set your price and hours, and take bookings'].map((t, i) => (
          <View key={t} style={styles.bullet}>
            <View style={styles.stepNum}>
              <Txt variant="tiny" color={colors.accent}>
                {i + 1}
              </Txt>
            </View>
            <Txt variant="small" style={{ flex: 1 }}>
              {t}
            </Txt>
          </View>
        ))}
      </Section>
      <Txt variant="small" color={colors.dim}>
        Free to list. Eventro only shows your price; you and the organizer agree on payment yourselves.
      </Txt>
    </OrgScreen>
  );
}

/** What listing a venue brings. */
function Intro() {
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Txt variant="h1">Get your venue booked on Eventro</Txt>
        <Txt color={colors.muted}>Own or run a venue? List it, and organizers can request it for their events.</Txt>
      </View>
      <View style={styles.benefits}>
        {BENEFITS.map((b) => (
          <View key={b.title} style={styles.benefit}>
            <View style={styles.benefitIcon}>
              <Icon name={b.icon} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">{b.title}</Txt>
              <Txt variant="small" color={colors.muted}>
                {b.body}
              </Txt>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------- find ---------- */

function FindVenue({
  query,
  onQuery,
  managedSlugs,
  pendingFor,
  onPick,
  onAdd,
}: {
  query: string;
  onQuery: (q: string) => void;
  managedSlugs: Set<string>;
  pendingFor: (slug: string) => boolean;
  onPick: (v: Target) => void;
  onAdd: () => void;
}) {
  const [term, setTerm] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const res = useVenueMatches(term);
  const short = term.length < 2;
  return (
    <>
      <Section icon="search" title="Is it on Eventro already?" sub="Many venues are, from events held there. Search by name, street or city.">
        <Field label="Venue" placeholder="e.g. Eko Convention Centre" value={query} onChangeText={onQuery} autoCorrect={false} autoFocus returnKeyType="search" />
      </Section>
      {short ? (
        <Txt variant="small" color={colors.dim}>
          Type at least 2 letters.
        </Txt>
      ) : res.isPending ? (
        <>
          <Skeleton height={80} radius={radius.card} />
          <Skeleton height={80} radius={radius.card} />
        </>
      ) : res.error ? (
        <Notice tone="plain" icon="alert" action="Try again" onAction={() => void res.refetch()}>
          {errorText(res.error)}
        </Notice>
      ) : !res.data?.length ? (
        <EmptyState compact icon="building" title="No venue found" body={`Nothing on Eventro matches “${term}”. Add it below.`} />
      ) : (
        <View style={{ gap: space.sm }}>
          {res.data.map((v) => {
            const mine = managedSlugs.has(v.slug);
            const asked = pendingFor(v.slug);
            return (
              <VenueRow
                key={v.slug}
                name={v.name}
                sub={placeLine(v)}
                imageUrl={v.imageUrl}
                onPress={() => onPick({ slug: v.slug, name: v.name, city: v.city, address: v.address, country: v.country, managed: v.managed })}
                badges={
                  mine || asked || v.verified || v.managed || v.capacity ? (
                    <>
                      {mine ? <Badge label="You manage it" tone="success" /> : asked ? <Badge label="Request sent" tone="warning" /> : v.managed ? <Badge label="Has a manager" /> : null}
                      {v.verified ? <Badge label="Verified" tone="accent" /> : null}
                      {v.capacity ? <Badge label={`${num(v.capacity)} capacity`} /> : null}
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </View>
      )}
      <View style={styles.addCard}>
        <View style={{ gap: 2 }}>
          <Txt variant="bodyStrong">Not on Eventro yet?</Txt>
          <Txt variant="small" color={colors.muted}>
            Add your venue. It’s shown on Eventro once our team has checked it.
          </Txt>
        </View>
        <Button label="Add your venue" icon="plus" variant="ghost" size="md" onPress={onAdd} />
      </View>
    </>
  );
}

/* ---------- add a new venue ---------- */

type NewForm = {
  name: string;
  /** a code, '' (not chosen) or 'OTHER' (typed in `otherCountry`) */
  country: string;
  otherCountry: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  capacity: string;
  phone: string;
  website: string;
  imageUrl: string;
  about: string;
};

function newErrors(f: NewForm, claim: ClaimInput) {
  const e: Record<string, string> = {};
  const country = f.country === 'OTHER' ? f.otherCountry.trim().toUpperCase() : f.country;
  const len = (s: string) => s.trim().length;
  if (len(f.name) < 2) e.name = 'Add the venue’s name.';
  else if (len(f.name) > 120) e.name = 'Keep the name to 120 characters.';
  if (!/^[A-Z]{2}$/.test(country)) e.country = f.country === 'OTHER' ? 'Type the country’s 2-letter code, e.g. PT.' : 'Choose the country.';
  if (len(f.address) < 3) e.address = 'Add the street address.';
  if (len(f.city) < 2) e.city = 'Add the city.';
  if (f.capacity.trim()) {
    const c = wholeIn(f.capacity, 1, 500_000, 'Capacity');
    if (c.error) e.capacity = 'Capacity is a whole number of people, from 1 to 500,000.';
  }
  if (f.phone.trim() && !PHONE_RE.test(f.phone.trim())) e.phone = 'Enter the phone number with its country code, e.g. +234 803 000 0000.';
  const w = linkError(f.website, 'The website', 200);
  if (w) e.website = w;
  const p = linkError(f.imageUrl, 'The photo link', 500);
  if (p) e.imageUrl = p;
  if (len(f.about) > 2000) e.about = 'Keep it to 2,000 characters.';
  return { errors: { ...e, ...claimErrors(claim, false) }, countryCode: country };
}

function NewVenue({
  initialName,
  initialCountry,
  claim,
  setClaim,
  onBack,
  onClaimInstead,
  onSent,
}: {
  initialName: string;
  initialCountry: string;
  claim: ClaimInput;
  setClaim: (fn: (c: ClaimInput) => ClaimInput) => void;
  onBack: () => void;
  onClaimInstead: (v: ExistingVenue) => void;
  onSent: (name: string) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<NewForm>({ name: initialName, country: initialCountry, otherCountry: '', address: '', city: '', region: '', postalCode: '', capacity: '', phone: '', website: '', imageUrl: '', about: '' });
  const [sheet, setSheet] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exists, setExists] = useState<ExistingVenue | null>(null);
  const set = (patch: Partial<NewForm>) => setF((p) => ({ ...p, ...patch }));
  const { errors: checks, countryCode } = newErrors(f, claim);
  const problems = Object.values(checks);
  const errors = tried ? checks : {};

  const send = async () => {
    setTried(true);
    setError('');
    setExists(null);
    if (problems.length) {
      haptic.warning();
      return;
    }
    setBusy(true);
    const t = (s: string) => s.trim();
    try {
      await api('/me/venues', {
        body: {
          name: t(f.name),
          address: t(f.address),
          city: t(f.city),
          country: countryCode,
          ...(t(f.region) ? { region: t(f.region) } : {}),
          ...(t(f.postalCode) ? { postalCode: t(f.postalCode) } : {}),
          ...(t(f.capacity) ? { capacity: wholeIn(f.capacity, 1, 500_000, 'Capacity').n } : {}),
          ...(t(f.phone) ? { phone: t(f.phone) } : {}),
          ...(t(f.website) ? { website: t(f.website) } : {}),
          ...(t(f.imageUrl) ? { imageUrl: t(f.imageUrl) } : {}),
          ...(t(f.about) ? { about: t(f.about) } : {}),
          role: claim.role,
          message: t(claim.message),
        },
      });
      haptic.success();
      await qc.invalidateQueries({ queryKey: ['me', 'venues'] });
      onSent(t(f.name));
    } catch (e) {
      haptic.error();
      const found = e instanceof ApiError && e.code === 'VENUE_EXISTS' ? (e.data as { venue?: ExistingVenue } | undefined)?.venue : undefined;
      if (found?.slug) setExists(found);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgScreen
      title="Add your venue"
      eyebrow="Step 2 of 2 · Your venue"
      fallback="/account"
      onBack={onBack}
      footer={
        <View style={{ flexDirection: 'row' }}>
          <GradientButton label="Send for approval" icon="send" loading={busy} onPress={() => void send()} />
        </View>
      }>
      <Section icon="building" title="The venue" sub="Where it is, as organizers and fans will see it.">
        <Field label="Venue name" placeholder="e.g. The Garden Hall" value={f.name} onChangeText={(name) => set({ name })} maxLength={120} error={errors.name} />
        <Pick
          label="Country"
          value={f.country === 'OTHER' ? 'Another country' : f.country ? countryName(f.country) : ''}
          placeholder="Choose the country"
          error={f.country === 'OTHER' ? undefined : errors.country}
          onPress={() => setSheet(true)}
          active={sheet}
        />
        {f.country === 'OTHER' ? (
          <Field
            label="Country code"
            placeholder="2 letters, e.g. PT"
            value={f.otherCountry}
            onChangeText={(v) => set({ otherCountry: v.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() })}
            autoCapitalize="characters"
            maxLength={2}
            error={errors.country}
            hint={/^[A-Z]{2}$/.test(f.otherCountry) ? countryName(f.otherCountry) : undefined}
          />
        ) : null}
        <Field label="Street address" value={f.address} onChangeText={(address) => set({ address })} maxLength={200} error={errors.address} />
        <View style={formStyles.row2}>
          <Field style={{ flex: 1 }} label="City" value={f.city} onChangeText={(city) => set({ city })} maxLength={80} error={errors.city} />
          <Field style={{ flex: 1 }} label="State (optional)" value={f.region} onChangeText={(region) => set({ region })} maxLength={80} />
        </View>
        <Field label="Postal code (optional)" value={f.postalCode} onChangeText={(postalCode) => set({ postalCode })} maxLength={20} autoCapitalize="characters" />
      </Section>

      <Section icon="sliders" title="Details" sub="Optional, and you can change them later.">
        <View style={formStyles.row2}>
          <Field style={{ flex: 1 }} label="Capacity" placeholder="e.g. 400" keyboardType="number-pad" value={f.capacity} onChangeText={(v) => set({ capacity: v.replace(/[^\d,]/g, '') })} error={errors.capacity} />
          <Field style={{ flex: 1.4 }} label="Phone" placeholder="+234 803 000 0000" keyboardType="phone-pad" value={f.phone} onChangeText={(phone) => set({ phone })} maxLength={25} error={errors.phone} />
        </View>
        <Field label="Website" placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} value={f.website} onChangeText={(website) => set({ website })} maxLength={200} error={errors.website} />
        <Field label="Photo link" placeholder="https://…/photo.jpg" keyboardType="url" autoCapitalize="none" autoCorrect={false} value={f.imageUrl} onChangeText={(imageUrl) => set({ imageUrl })} maxLength={500} error={errors.imageUrl} />
        <TextArea label="About" value={f.about} onChangeText={(about) => set({ about })} maxLength={2000} minHeight={110} placeholder="What it’s like, getting there, accessibility, food and drink…" error={errors.about} />
      </Section>

      <ClaimFields value={claim} onChange={(p) => setClaim((c) => ({ ...c, ...p }))} errors={errors} venueName={f.name.trim()} website={false} />

      {exists ? (
        <View style={styles.exists}>
          <Txt variant="bodyStrong">{exists.name} is on Eventro already</Txt>
          <Txt variant="small" color={colors.muted}>
            {placeLine(exists)}. If that’s your venue, claim it instead: your role and message come with you.
          </Txt>
          <Button label="Claim this one instead" icon="arrowRight" size="md" onPress={() => onClaimInstead(exists)} />
        </View>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}
      {tried && problems.length && !error ? <Notice icon="alert">{problems[0]}</Notice> : null}
      <Txt variant="small" color={colors.dim}>
        New venues stay hidden until Eventro approves your request, usually within a day.
      </Txt>

      <OptionSheet<string>
        visible={sheet}
        title="Country"
        options={[...VENUE_COUNTRIES.map((c) => ({ value: c, label: countryName(c) })), { value: 'OTHER', label: 'Another country', detail: 'Type its code' }]}
        value={f.country}
        onPick={(c) => set({ country: c })}
        onClose={() => setSheet(false)}
      />
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  benefits: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  benefitIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  addCard: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, borderStyle: 'dashed', backgroundColor: colors.surface },
  doneCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg, borderRadius: radius.panel, borderWidth: 1, borderColor: 'rgba(245,165,36,0.35)', backgroundColor: colors.surface },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warningSoft },
  exists: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
});
