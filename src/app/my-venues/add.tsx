/**
 * Listing a venue, one question per screen, like the website's (/venues/list):
 *
 *   find → claim:  find it (GET /venues?q=) → you → review → POST /venues/:slug/claims
 *   find → add:    find → name → address → photos → details → you → review → POST /me/venues
 *
 * A progress bar runs along the top and Back / Continue sit at the bottom. The note to Omoshow is written for you from
 * your role and email until you edit it. A new venue that turns out to be on Omoshow already (409 VENUE_EXISTS) can be
 * claimed instead with the same role and note. `?slug=` (a venue page's "Claim this page") starts at claiming it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChoiceRow, ChoiceTile } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { OptionSheet } from '@/components/option-sheet';
import { VenuePhotos } from '@/components/venue-photos';
import { Pick } from '@/components/venue-fields';
import { placeLine, RequestCard } from '@/components/venue-owner';
import { Badge, Button, EmptyState, ErrorState, Field, FadeIn, IconButton, Notice, Skeleton, TextArea, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMyVenues, type ClaimRole } from '@/lib/bookings';
import { cityOnly, countryName, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { CLAIM_ROLES, linkError, PHONE_RE, useVenueMatches, wholeIn, type ExistingVenue } from '@/lib/my-venues';
import { VENUE_COUNTRIES } from '@/lib/organizer';
import { usePlace } from '@/lib/place';
import type { VenuePage } from '@/lib/types';
import { colors, gutter, radius, space, type } from '@/theme';

type StepId = 'find' | 'name' | 'where' | 'photos' | 'details' | 'you' | 'review';
const ADD: StepId[] = ['find', 'name', 'where', 'photos', 'details', 'you', 'review'];
const CLAIM: StepId[] = ['find', 'you', 'review'];
const TITLE: Record<StepId, [string, string]> = {
  find: ['Find your venue', 'Many venues are on Omoshow already, from events held there.'],
  name: ['What’s it called?', 'As organizers and fans will see it.'],
  where: ['Where is it?', 'The address shown on its page.'],
  photos: ['Show it off', 'Add a few photos. The first one is the cover.'],
  details: ['A few details', 'All optional. All helpful.'],
  you: ['Who are you there?', 'We check every venue by hand, usually within a day.'],
  review: ['Ready to send?', 'Check it over. You can change it all later.'],
};
const SIZES = [100, 300, 500, 1000, 5000];

/** The venue being claimed. */
type Target = { slug: string; name: string; city: string; address?: string; country?: string | null; managed?: boolean; imageUrl?: string | null };

type Form = {
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
  photos: string[];
  about: string;
  role: ClaimRole;
  message: string;
};

/** The note to Omoshow, written from the role; kept in step until it's edited by hand. */
const noteFor = (role: ClaimRole, name: string, email: string) => {
  const venue = name.trim() || 'the venue';
  return role === 'owner'
    ? `I own ${venue}. You can reach me at ${email}.`
    : role === 'manager'
      ? `I manage bookings at ${venue}. You can reach me at ${email}.`
      : `I work at ${venue} and keep its listing up to date. You can reach me at ${email}.`;
};

/** Problems by field, for the request as it stands. */
function problems(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {};
  const len = (s: string) => s.trim().length;
  const country = f.country === 'OTHER' ? f.otherCountry.trim().toUpperCase() : f.country;
  if (len(f.name) < 2) e.name = 'Add the venue’s name.';
  else if (len(f.name) > 120) e.name = 'Keep the name to 120 characters.';
  if (!/^[A-Z]{2}$/.test(country)) e.country = f.country === 'OTHER' ? 'Type the country’s 2-letter code, e.g. PT.' : 'Choose the country.';
  if (len(f.address) < 3) e.address = 'Add the street address.';
  if (len(f.city) < 2) e.city = 'Add the city.';
  if (!f.photos.length) e.photos = 'Add at least one photo of the venue.';
  if (len(f.about) > 2000) e.about = 'Keep it to 2,000 characters.';
  if (f.capacity.trim() && wholeIn(f.capacity, 1, 500_000, 'Capacity').error) e.capacity = 'A whole number of people, from 1 to 500,000.';
  if (f.phone.trim() && !PHONE_RE.test(f.phone.trim())) e.phone = 'Include the country code, e.g. +234 803 000 0000.';
  const w = linkError(f.website, 'The website', 200);
  if (w) e.website = w;
  if (len(f.message) < 10) e.message = 'Tell us who you are at the venue and how we can check it.';
  else if (len(f.message) > 600) e.message = 'Keep it to 600 characters.';
  return { errors: e, country };
}
const FIELDS: Partial<Record<StepId, (keyof Form)[]>> = {
  name: ['name', 'country'],
  where: ['address', 'city'],
  photos: ['photos', 'about'],
  details: ['capacity', 'phone', 'website'],
  you: ['message'],
};

export default function ListVenue() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const mine = useMyVenues(user?.id);
  const { place } = usePlace();
  const [target, setTarget] = useState<Target | null>(null);
  const [path, setPath] = useState<'add' | 'claim'>(params.slug ? 'claim' : 'add');
  const [at, setAt] = useState(params.slug ? 1 : 0);
  const [search, setSearch] = useState('');
  const [f, setF] = useState<Form>(() => ({
    name: '',
    country: place?.country && VENUE_COUNTRIES.includes(place.country) ? place.country : '',
    otherCountry: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    capacity: '',
    phone: '',
    website: '',
    photos: [],
    about: '',
    role: 'owner',
    message: '',
  }));
  const [autoNote, setAutoNote] = useState(true);
  const [tried, setTried] = useState<Set<StepId>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exists, setExists] = useState<ExistingVenue | null>(null);
  const [done, setDone] = useState<{ name: string; newVenue: boolean } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  // "Claim this page" from a venue page: that venue.
  const fromPage = useQuery({ queryKey: ['venue', params.slug], queryFn: () => api<VenuePage>(`/venues/${encodeURIComponent(params.slug!)}`), enabled: !!params.slug, staleTime: 60_000 });
  const page = fromPage.data;
  const claiming: Target | null = target ?? (page ? { slug: page.slug, name: page.name, city: page.city, address: page.address, country: page.country, managed: page.managed, imageUrl: page.imageUrl } : null);

  const steps = path === 'claim' ? CLAIM : ADD;
  const step = steps[at];
  const venueName = path === 'claim' ? (claiming?.name ?? '') : f.name;
  // The note, written for them, follows the role and name until they change it.
  const note = autoNote ? (user?.email ? noteFor(f.role, venueName, user.email) : '') : f.message;
  const { errors: all, country } = problems({ ...f, message: note });
  const err = (k: keyof Form) => (tried.has(step) || tried.has('review') ? all[k] : undefined);
  const stepOk = (s: StepId) => (FIELDS[s] ?? []).every((k) => !all[k]);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [at, path]);

  if (!user) {
    return (
      <Shell title="List your venue" sub="Get your venue booked by organizers on Omoshow. Free to list, no commission." onClose={close}>
        <EmptyState
          icon="lock"
          title="Sign in to start"
          body="Venue managers have an Omoshow account, so organizers and our team know who they’re talking to."
          action="Sign in"
          onAction={() => router.push({ pathname: '/sign-in', params: { then: params.slug ? `/venues/${params.slug}` : '/venues/list' } })}
        />
      </Shell>
    );
  }

  const managedSlugs = new Set((mine.data?.managed ?? []).map((m) => m.venue.slug));
  const pendingFor = (slug: string) => mine.data?.requests.find((r) => r.venue.slug === slug && r.status === 'PENDING');
  const set = (patch: Partial<Form>) => setF((p) => ({ ...p, ...patch }));

  const goTo = (i: number) => {
    setError('');
    setAt(Math.max(0, Math.min(i, steps.length - 1)));
  };
  const next = () => {
    if (step === 'review') return void send();
    setTried((t) => new Set(t).add(step));
    if (!stepOk(step)) {
      haptic.warning();
      return;
    }
    haptic.select();
    goTo(at + 1);
  };
  const back = () => {
    if (at === 0 || (params.slug && path === 'claim' && at === 1 && !target)) return close();
    goTo(at - 1);
  };
  const startAdd = () => {
    setPath('add');
    setTarget(null);
    if (!f.name.trim() && search.trim()) set({ name: search.trim() });
    setAt(1);
  };
  const startClaim = (v: Target) => {
    setTarget(v);
    setPath('claim');
    setAt(1);
  };

  const send = async () => {
    setTried((t) => new Set(t).add('review'));
    setError('');
    setExists(null);
    const bad = steps.findIndex((s) => s !== 'review' && s !== 'find' && !stepOk(s));
    if (bad >= 0) {
      haptic.warning();
      goTo(bad);
      return;
    }
    setBusy(true);
    const t = (s: string) => s.trim();
    try {
      if (path === 'claim' && claiming) {
        await api(`/venues/${encodeURIComponent(claiming.slug)}/claims`, { body: { role: f.role, message: t(note) } });
      } else {
        await api('/me/venues', {
          body: {
            name: t(f.name),
            address: t(f.address),
            city: t(f.city),
            country,
            ...(t(f.region) ? { region: t(f.region) } : {}),
            ...(t(f.postalCode) ? { postalCode: t(f.postalCode) } : {}),
            ...(t(f.capacity) ? { capacity: wholeIn(f.capacity, 1, 500_000, 'Capacity').n } : {}),
            ...(t(f.phone) ? { phone: t(f.phone) } : {}),
            ...(t(f.website) ? { website: t(f.website) } : {}),
            photos: f.photos,
            ...(t(f.about) ? { about: t(f.about) } : {}),
            role: f.role,
            message: t(note),
          },
        });
      }
      haptic.success();
      await qc.invalidateQueries({ queryKey: ['me', 'venues'] });
      setDone({ name: t(venueName), newVenue: path === 'add' });
    } catch (e) {
      haptic.error();
      const found = e instanceof ApiError && e.code === 'VENUE_EXISTS' ? (e.data as { venue?: ExistingVenue } | undefined)?.venue : undefined;
      if (found?.slug) setExists(found);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- sent ---------- */
  if (done) {
    return (
      <Shell onClose={() => router.replace('/account')}>
        <FadeIn style={styles.done}>
          <View style={styles.doneIcon}>
            <Icon name="check" size={34} color={colors.success} strokeWidth={2.6} />
          </View>
          <Txt variant="h1" style={{ textAlign: 'center' }}>
            {done.name ? `${done.name} is on its way` : 'Request sent'}
          </Txt>
          <Txt color={colors.muted} style={{ textAlign: 'center' }}>
            We’ll check it and let you know, usually within a day. {done.newVenue ? 'Until then it isn’t shown on Omoshow. ' : ''}Then set your price, hours and blocked-out time in My venues.
          </Txt>
          <View style={{ alignSelf: 'stretch', gap: space.sm, marginTop: space.lg }}>
            <Button label="Done" onPress={() => router.replace('/account')} />
            <Button label="My venues" variant="ghost" onPress={() => router.replace('/my-venues')} />
          </View>
        </FadeIn>
      </Shell>
    );
  }

  /* ---------- a claim from a venue page, still loading ---------- */
  if (path === 'claim' && !claiming) {
    return (
      <Shell title="Claim this venue" onClose={close}>
        {fromPage.error ? (
          fromPage.error instanceof ApiError && fromPage.error.status === 404 ? (
            <EmptyState icon="building" title="Venue not found" body="Search for it instead, or add it." action="Find your venue" onAction={() => (setPath('add'), setAt(0))} />
          ) : (
            <ErrorState message={errorText(fromPage.error)} onRetry={() => void fromPage.refetch()} />
          )
        ) : (
          <View style={{ gap: space.md }}>
            <Skeleton height={90} radius={radius.card} />
            <Skeleton height={200} radius={radius.card} />
          </View>
        )}
      </Shell>
    );
  }

  const manages = path === 'claim' && claiming ? managedSlugs.has(claiming.slug) : false;
  const pending = path === 'claim' && claiming ? pendingFor(claiming.slug) : undefined;
  const blocked = manages || !!pending;
  const [title, sub] = step === 'you' && path === 'claim' && claiming ? [`Who are you at ${claiming.name}?`, TITLE.you[1]] : TITLE[step];
  const waiting = (mine.data?.requests ?? []).filter((r) => r.status === 'PENDING');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon="back" label={at ? 'Back' : 'Close'} onPress={back} />
        <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps.length, now: at + 1 }}>
          {steps.map((s, i) => (
            <View key={s} style={[styles.bar, i <= at && styles.barOn]} />
          ))}
        </View>
        <IconButton icon="close" label="Close" onPress={close} />
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: gutter, paddingBottom: space.huge }} keyboardShouldPersistTaps="handled">
        <FadeIn key={`${path}-${step}`} style={{ gap: space.xl }}>
          <View style={{ gap: space.xs }}>
            <Txt variant="eyebrow" color={colors.accent}>
              Step {at + 1} of {steps.length}
            </Txt>
            <Txt variant="h1" accessibilityRole="header">
              {title}
            </Txt>
            <Txt color={colors.muted}>{sub}</Txt>
          </View>

          {step === 'find' ? (
            <FindStep
              query={search}
              onQuery={setSearch}
              managedSlugs={managedSlugs}
              pendingFor={(s) => !!pendingFor(s)}
              onPick={startClaim}
              onAdd={startAdd}
              waiting={waiting.map((r) => (
                <RequestCard key={r.id} r={r} onOpen={() => router.push({ pathname: '/venue/[slug]', params: { slug: r.venue.slug } })} />
              ))}
            />
          ) : null}

          {step === 'name' ? (
            <View style={{ gap: space.lg }}>
              <Field label="Venue name" placeholder="e.g. The Garden Hall" value={f.name} onChangeText={(name) => set({ name })} maxLength={120} error={err('name')} autoFocus returnKeyType="next" />
              <Pick label="Country" value={f.country === 'OTHER' ? 'Another country' : f.country ? countryName(f.country) : ''} placeholder="Choose the country" error={f.country === 'OTHER' ? undefined : err('country')} onPress={() => setSheet(true)} active={sheet} />
              {f.country === 'OTHER' ? (
                <Field
                  label="Country code"
                  placeholder="2 letters, e.g. PT"
                  value={f.otherCountry}
                  onChangeText={(v) => set({ otherCountry: v.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() })}
                  autoCapitalize="characters"
                  maxLength={2}
                  error={err('country')}
                  hint={/^[A-Z]{2}$/.test(f.otherCountry) ? countryName(f.otherCountry) : undefined}
                />
              ) : null}
            </View>
          ) : null}

          {step === 'where' ? (
            <View style={{ gap: space.lg }}>
              <Field label="Street address" placeholder="Street and number" value={f.address} onChangeText={(address) => set({ address })} maxLength={200} error={err('address')} autoFocus />
              <View style={styles.row2}>
                <Field style={{ flex: 1 }} label="City" value={f.city} onChangeText={(city) => set({ city })} maxLength={80} error={err('city')} />
                <Field style={{ flex: 1 }} label="State (optional)" value={f.region} onChangeText={(region) => set({ region })} maxLength={80} />
              </View>
              <Field label="Postal code (optional)" value={f.postalCode} onChangeText={(postalCode) => set({ postalCode })} maxLength={20} autoCapitalize="characters" />
            </View>
          ) : null}

          {step === 'photos' ? (
            <View style={{ gap: space.lg }}>
              <VenuePhotos photos={f.photos} onChange={(fn) => setF((p) => ({ ...p, photos: fn(p.photos) }))} error={err('photos')} />
              <TextArea label="About the venue (optional)" value={f.about} onChangeText={(about) => set({ about })} maxLength={2000} minHeight={110} placeholder="The room, the sound, getting there, food and drink, accessibility…" error={err('about')} />
            </View>
          ) : null}

          {step === 'details' ? (
            <View style={{ gap: space.lg }}>
              <View style={{ gap: space.sm }}>
                <Txt variant="smallStrong" color={colors.muted}>
                  How many people does it hold?
                </Txt>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.sm }}>
                  {SIZES.map((n) => {
                    const on = Number(f.capacity.replace(/,/g, '')) === n;
                    return (
                      <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => (haptic.select(), set({ capacity: String(n) }))} style={[styles.size, on && styles.sizeOn]}>
                        <Txt variant="smallStrong" color={on ? colors.bg : colors.text}>
                          {num(n)}
                          {n === 5000 ? '+' : ''}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Field label="Or type it" placeholder="e.g. 800" keyboardType="number-pad" value={f.capacity} onChangeText={(v) => set({ capacity: v.replace(/[^\d,]/g, '') })} error={err('capacity')} />
              </View>
              <Field label="Phone (optional)" placeholder="+234 803 000 0000" keyboardType="phone-pad" value={f.phone} onChangeText={(phone) => set({ phone })} maxLength={25} error={err('phone')} />
              <Field
                label="Website (optional)"
                placeholder="https://"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                value={f.website}
                onChangeText={(website) => set({ website })}
                onBlur={() => f.website.trim() && !/^https?:\/\//i.test(f.website.trim()) && set({ website: `https://${f.website.trim()}` })}
                maxLength={200}
                error={err('website')}
              />
            </View>
          ) : null}

          {step === 'you' ? (
            blocked && claiming ? (
              manages ? (
                <Notice tone="success" icon="check" title="You manage this venue" action="Open My venues" onAction={() => router.replace('/my-venues')}>
                  Its listing, hours and blocked-out time are in My venues.
                </Notice>
              ) : (
                <RequestCard r={pending!} />
              )
            ) : (
              <View style={{ gap: space.lg }}>
                {path === 'claim' && claiming ? <VenueCard v={claiming} /> : null}
                {path === 'claim' && claiming?.managed ? (
                  <Notice tone="plain" icon="users" title="Already managed on Omoshow">
                    {`${claiming.name} has a manager on Omoshow. You can still ask to join them; we check it the same way.`}
                  </Notice>
                ) : null}
                <ChoiceRow>
                  {CLAIM_ROLES.map((r) => (
                    <ChoiceTile key={r.id} icon={r.icon} label={r.label} sub={r.sub} on={f.role === r.id} onPress={() => set({ role: r.id })} />
                  ))}
                </ChoiceRow>
                <TextArea
                  label="Your note to Omoshow"
                  value={note}
                  onChangeText={(message) => {
                    setAutoNote(false);
                    set({ message });
                  }}
                  maxLength={600}
                  minHeight={110}
                  error={err('message')}
                  hint="Written for you. Add a link we can check, like the venue’s Instagram or an email at its own domain."
                />
              </View>
            )
          ) : null}

          {step === 'review' ? (
            <View style={{ gap: space.lg }}>
              {path === 'claim' && claiming ? (
                <VenueCard v={claiming} />
              ) : (
                <VenueCard v={{ slug: '', name: f.name.trim() || 'Your venue', city: [f.city.trim(), f.region.trim()].filter(Boolean).join(', '), country, imageUrl: f.photos[0] ?? null }} />
              )}
              <View style={styles.review}>
                {(path === 'claim'
                  ? ([
                      ['Your role', CLAIM_ROLES.find((r) => r.id === f.role)!.label, 1],
                      ['Your note', note.trim(), 1],
                    ] as [string, string, number][])
                  : ([
                      ['Address', [f.address, f.city, f.region, f.postalCode].map((x) => x.trim()).filter(Boolean).join(', '), 2],
                      ['Photos', `${f.photos.length} ${f.photos.length === 1 ? 'photo' : 'photos'}`, 3],
                      ['Details', [f.capacity && `Up to ${num(wholeIn(f.capacity, 1, 500_000, 'Capacity').n ?? 0)}`, f.phone.trim(), f.website.trim()].filter(Boolean).join(' · ') || 'None', 4],
                      ['Your role', CLAIM_ROLES.find((r) => r.id === f.role)!.label, 5],
                      ['Your note', note.trim(), 5],
                    ] as [string, string, number][])
                ).map(([k, v, i], n) => (
                  <Pressable key={k} accessibilityRole="button" accessibilityLabel={`Edit ${k}`} onPress={() => goTo(i)} style={[styles.reviewRow, n > 0 && styles.reviewLine]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="small" color={colors.dim}>
                        {k}
                      </Txt>
                      <Txt numberOfLines={3}>{v}</Txt>
                    </View>
                    <Txt variant="smallStrong" color={colors.muted}>
                      Edit
                    </Txt>
                  </Pressable>
                ))}
              </View>
              {exists ? (
                <View style={styles.exists}>
                  <Txt variant="bodyStrong">{exists.name} is on Omoshow already</Txt>
                  <Txt variant="small" color={colors.muted}>
                    {placeLine(exists)}. If that’s your venue, claim it instead: your role and note come with you.
                  </Txt>
                  <Button label="Claim this one instead" icon="arrowRight" size="md" onPress={() => (setExists(null), setTarget({ slug: exists.slug, name: exists.name, city: exists.city, address: exists.address }), setPath('claim'), setAt(2))} />
                </View>
              ) : null}
              {error ? <Notice icon="alert">{error}</Notice> : null}
              <Txt variant="small" color={colors.dim}>
                {path === 'add' ? 'New venues stay private until Omoshow approves them, usually within a day.' : 'Omoshow checks every request by hand, usually within a day.'}
              </Txt>
            </View>
          ) : null}
        </FadeIn>
      </ScrollView>

      {step === 'find' || (step === 'you' && blocked) ? null : (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <Button label={step === 'review' ? 'Send for approval' : 'Continue'} icon={step === 'review' ? 'send' : undefined} loading={busy} onPress={next} block style={{ flex: 1 }} />
        </View>
      )}

      <OptionSheet<string>
        visible={sheet}
        title="Country"
        options={[...VENUE_COUNTRIES.map((c) => ({ value: c, label: countryName(c) })), { value: 'OTHER', label: 'Another country', detail: 'Type its code' }]}
        value={f.country}
        onPick={(c) => set({ country: c })}
        onClose={() => setSheet(false)}
      />
    </KeyboardAvoidingView>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/account');
}

/** A plain screen with a close button (sign-in, loading and the sent screen). */
function Shell({ title, sub, onClose, children }: { title?: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm, justifyContent: 'flex-end' }]}>
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + space.huge, gap: space.xl }}>
        {title ? (
          <View style={{ gap: space.xs }}>
            <Txt variant="h1">{title}</Txt>
            {sub ? <Txt color={colors.muted}>{sub}</Txt> : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
    </View>
  );
}

/** Search for the venue; pick one to claim, or add it. */
function FindStep({
  query,
  onQuery,
  managedSlugs,
  pendingFor,
  onPick,
  onAdd,
  waiting,
}: {
  query: string;
  onQuery: (q: string) => void;
  managedSlugs: Set<string>;
  pendingFor: (slug: string) => boolean;
  onPick: (v: Target) => void;
  onAdd: () => void;
  waiting: ReactNode[];
}) {
  const [term, setTerm] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const res = useVenueMatches(term);
  const short = term.length < 2;
  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.search}>
        <Icon name="search" size={20} color={colors.dim} />
        <TextInput
          style={styles.searchInput}
          placeholder="Venue name or city"
          placeholderTextColor={colors.dim}
          value={query}
          onChangeText={onQuery}
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Search for your venue"
        />
      </View>

      {short ? null : res.isPending ? (
        <View style={{ gap: space.sm }}>
          <Skeleton height={72} radius={radius.card} />
          <Skeleton height={72} radius={radius.card} />
        </View>
      ) : res.error ? (
        <Notice tone="plain" icon="alert" action="Try again" onAction={() => void res.refetch()}>
          {errorText(res.error)}
        </Notice>
      ) : res.data?.length ? (
        <View style={styles.results}>
          {res.data.slice(0, 8).map((v, i) => {
            const mine = managedSlugs.has(v.slug);
            const asked = pendingFor(v.slug);
            return (
              <Pressable
                key={v.slug}
                accessibilityRole="button"
                accessibilityLabel={`${v.name}, ${placeLine(v)}`}
                onPress={() => (haptic.tap(), onPick({ slug: v.slug, name: v.name, city: v.city, address: v.address, country: v.country, managed: v.managed, imageUrl: v.imageUrl }))}
                style={({ pressed }) => [styles.result, i > 0 && styles.reviewLine, pressed && { backgroundColor: colors.surface2 }]}
              >
                <View style={styles.thumb}>{v.imageUrl ? <Image source={{ uri: v.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="building" size={20} color={colors.dim} />}</View>
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {v.name}
                  </Txt>
                  <Txt variant="small" color={colors.muted} numberOfLines={1}>
                    {[v.address, cityOnly(v.city)].filter(Boolean).join(', ')}
                  </Txt>
                  {mine || asked ? <Badge label={mine ? 'You manage it' : 'Request sent'} tone={mine ? 'success' : 'warning'} /> : null}
                </View>
                <Txt variant="smallStrong" color={colors.accent}>
                  {mine ? 'Open' : v.managed ? 'Join' : 'Claim'}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Txt variant="small" color={colors.muted}>
          Nothing on Omoshow matches “{term}”.
        </Txt>
      )}

      <Pressable accessibilityRole="button" onPress={() => (haptic.tap(), onAdd())} style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.8 }]}>
        <View style={styles.addIcon}>
          <Icon name="plus" size={20} color={colors.accentInk} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong">{short || !res.data?.length ? 'Add your venue' : 'Not here? Add it'}</Txt>
          <Txt variant="small" color={colors.muted}>
            A few quick steps. It goes live once we’ve checked it.
          </Txt>
        </View>
        <Icon name="chevronRight" size={18} color={colors.dim} />
      </Pressable>

      {waiting.length ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="h3">Your requests</Txt>
          {waiting}
        </View>
      ) : (
        <View style={styles.perks}>
          {['Free to list, no commission', 'You set the price and hours', 'You approve every booking'].map((t) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="check" size={15} color={colors.success} strokeWidth={2.6} />
              <Txt variant="small" color={colors.muted}>
                {t}
              </Txt>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** The venue as a card: its cover (or a calm placeholder), name and place. */
function VenueCard({ v }: { v: Target }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardPhoto}>{v.imageUrl ? <Image source={{ uri: v.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <Icon name="building" size={30} color={colors.dim} />}</View>
      <View style={{ padding: space.lg, gap: 2 }}>
        <Txt variant="h3" numberOfLines={2}>
          {v.name}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {[v.address, cityOnly(v.city), v.country ? countryName(v.country) : null].filter(Boolean).join(', ') || 'City, country'}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: gutter, paddingBottom: space.sm },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line2 },
  barOn: { backgroundColor: colors.accent },
  row2: { flexDirection: 'row', gap: space.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  searchInput: { flex: 1, height: 54, ...type.body, color: colors.text, outlineStyle: 'none' } as object,
  results: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  thumb: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  addIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  perks: { gap: space.sm, paddingTop: space.sm },
  size: { height: 40, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  sizeOn: { backgroundColor: colors.text, borderColor: colors.text },
  review: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  reviewLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2 },
  card: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  cardPhoto: { height: 150, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  exists: { gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  done: { alignItems: 'center', gap: space.md, paddingTop: space.huge },
  doneIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft, marginBottom: space.sm },
  footer: { flexDirection: 'row', gap: space.sm, paddingHorizontal: gutter, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2, backgroundColor: colors.bg },
});
