/**
 * Venues: the marketplace of venues taking bookings on Omoshow (GET /venue-listings), like /venues on the website.
 * Search by city, date and guests, show only venues that confirm by themselves, or sort by price; the city from the
 * fan's location comes first. A card opens the venue's page, where it's booked (app/book-venue/[slug].tsx).
 */
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateField } from '@/components/date-time';
import { Icon } from '@/components/icons';
import { ScreenHeader } from '@/components/screen-header';
import { Chip, EmptyState, ErrorState, Field, FadeIn, Skeleton, Txt } from '@/components/ui';
import { api, errorText, qs } from '@/lib/api';
import { priceLabel, type ListingResult } from '@/lib/bookings';
import { cityOnly, num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePlace } from '@/lib/place';
import { colors, gutter, radius, space } from '@/theme';

type Sort = 'recommended' | 'price';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Venues() {
  const insets = useSafeAreaInsets();
  const { place } = usePlace();
  const [city, setCity] = useState('');
  const [guests, setGuests] = useState('');
  const [date, setDate] = useState('');
  const [instant, setInstant] = useState(false);
  const [sort, setSort] = useState<Sort>('recommended');
  // Typing settles before searching.
  const [term, setTerm] = useState({ city: '', guests: '' });
  useEffect(() => {
    const t = setTimeout(() => setTerm({ city: city.trim(), guests: guests.trim() }), 350);
    return () => clearTimeout(t);
  }, [city, guests]);
  const near = place?.city ?? '';
  const params = {
    city: term.city || undefined,
    guests: Number(term.guests) > 0 ? Number(term.guests) : undefined,
    date: date || undefined,
    instant: instant ? 1 : undefined,
    sort: sort === 'price' ? 'price' : undefined,
    near: !term.city && near ? near : undefined,
  };
  const res = useQuery({
    queryKey: ['venue-listings', 'market', params],
    queryFn: () => api<ListingResult[]>(`/venue-listings${qs(params)}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const [pulling, setPulling] = useState(false);
  const filtered = !!(term.city || term.guests || date || instant);
  const clear = () => {
    haptic.select();
    setCity('');
    setGuests('');
    setDate('');
    setInstant(false);
  };
  const items = res.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.sm }}>
      <FlatList
        data={res.isPending ? [] : items}
        keyExtractor={(r) => r.venue.id}
        renderItem={({ item, index }) => (
          <FadeIn delay={Math.min(index, 6) * 50}>
            <VenueCard r={item} />
          </FadeIn>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.xl }} />}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge }}
        automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              await res.refetch();
              setPulling(false);
            }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingBottom: space.xl }}>
            <ScreenHeader title="Venues" fallback="/" />
            <Txt color={colors.muted}>Halls, theatres, clubs and gardens to hire. Request a time and the venue confirms.</Txt>
            <View style={styles.search}>
              <Field label="Where" placeholder={near ? `${cityOnly(near)}, or any city` : 'Any city'} value={city} onChangeText={setCity} autoCorrect={false} returnKeyType="search" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1.2 }}>
                  <DateField label="When" value={date} onChange={setDate} min={today()} />
                </View>
                <Field style={{ flex: 1 }} label="Guests" placeholder="How many?" value={guests} onChangeText={(v) => setGuests(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.sm }}>
              <Chip label="Instant book" icon="flash" active={instant} onPress={() => setInstant((v) => !v)} />
              <Chip label="Recommended" active={sort === 'recommended'} onPress={() => setSort('recommended')} />
              <Chip label="Lowest price" active={sort === 'price'} onPress={() => setSort('price')} />
              {filtered ? <Chip label="Clear" icon="close" onPress={clear} /> : null}
            </ScrollView>
            {res.data ? (
              <Txt variant="small" color={colors.dim}>
                {items.length} {items.length === 1 ? 'venue' : 'venues'}
                {date ? ' free that day' : ''}
              </Txt>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          res.isPending ? (
            <View style={{ gap: space.xl }}>
              <Skeleton height={220} radius={radius.card} />
              <Skeleton height={220} radius={radius.card} />
            </View>
          ) : res.error ? (
            <ErrorState message={errorText(res.error)} onRetry={() => void res.refetch()} />
          ) : (
            <EmptyState icon="building" title="No venues match" body="Try another date, fewer guests or a nearby city." action={filtered ? 'Show all venues' : undefined} onAction={filtered ? clear : undefined} />
          )
        }
        ListFooterComponent={
          items.length ? (
            <Pressable accessibilityRole="link" onPress={() => router.push('/my-venues/add')} style={({ pressed }) => [styles.own, pressed && { opacity: 0.7 }]}>
              <Icon name="building" size={20} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">Own or run a venue?</Txt>
                <Txt variant="small" color={colors.muted}>
                  List it free and get booked by organizers.
                </Txt>
              </View>
              <Icon name="chevronRight" size={18} color={colors.dim} />
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}

function VenueCard({ r }: { r: ListingResult }) {
  const { width } = useWindowDimensions();
  const { venue, listing } = r;
  const guests = listing.capacity ?? venue.capacity;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${venue.name}, ${cityOnly(venue.city)}, ${priceLabel(listing)}`}
      onPress={() => {
        haptic.tap();
        router.push({ pathname: '/venue/[slug]', params: { slug: venue.slug } });
      }}
      style={({ pressed }) => [{ gap: space.sm }, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
    >
      <View style={[styles.photo, { height: Math.min(260, Math.round((Math.min(width, 720) - gutter * 2) * 0.62)) }]}>
        {venue.imageUrl ? <Image source={{ uri: venue.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={venue.id} /> : <Icon name="building" size={30} color={colors.dim} />}
      </View>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
            {venue.name}
          </Txt>
          {venue.verified ? (
            <View style={styles.tick} accessibilityLabel="Verified venue">
              <Icon name="check" size={11} color="#fff" strokeWidth={3} />
            </View>
          ) : null}
        </View>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {cityOnly(venue.city)}
          {guests ? ` · up to ${num(guests)} guests` : ''}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 }}>
          <Txt variant={listing.priceMode === 'QUOTE' ? 'small' : 'smallStrong'} color={listing.priceMode === 'QUOTE' ? colors.muted : colors.text}>
            {listing.priceMode === 'QUOTE' ? 'Price on request' : `From ${priceLabel(listing)}`}
          </Txt>
          {listing.instantBook ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="flash" size={13} color={colors.accent} />
              <Txt variant="smallStrong" color={colors.accent}>
                Instant book
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  photo: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  own: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xxl, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg2 },
});
