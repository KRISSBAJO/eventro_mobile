import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Txt } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { cityOnly, dateRange, when } from '@/lib/format';
import type { SearchFilters } from '@/lib/queries';
import type { EventCard } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

// The website's built-in catalog. Sample cards open the website's event details.
export const sampleCatalog: EventCard[] = [
  {
    "slug": "nova-hart",
    "title": "Nova Hart",
    "subtitle": "Neon Hearts World Tour",
    "category": "CONCERTS",
    "startsAt": "2026-12-12T20:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=900&q=70",
    "city": "New York, NY",
    "venue": "Riverside Arena",
    "country": "US",
    "lat": 40.724720000000005,
    "lng": -73.9986,
    "currency": "USD",
    "fromCents": 8900
  },
  {
    "slug": "harbor-derby",
    "title": "Harbor FC vs. Kingsport",
    "subtitle": "Premier Cup · Matchday 14",
    "category": "SPORTS",
    "startsAt": "2026-12-06T15:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=70",
    "city": "London, UK",
    "venue": "Harbor Stadium",
    "country": "GB",
    "lat": 51.4914,
    "lng": -0.1398,
    "currency": "USD",
    "fromCents": 5400
  },
  {
    "slug": "solstice",
    "title": "Solstice Festival",
    "subtitle": "3 days · 60+ artists",
    "category": "FESTIVALS",
    "startsAt": "2027-03-19T12:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=900&q=70",
    "city": "Austin, TX",
    "venue": "Lakeshore Grounds",
    "country": "US",
    "lat": 30.252399999999998,
    "lng": -97.7401,
    "currency": "USD",
    "fromCents": 17900
  },
  {
    "slug": "dana-okafor",
    "title": "Dana Okafor",
    "subtitle": "Overthinking It — Live",
    "category": "COMEDY",
    "startsAt": "2026-12-04T21:30:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=900&q=70",
    "city": "Toronto, ON",
    "venue": "The Velvet Room",
    "country": "CA",
    "lat": 43.692319999999995,
    "lng": -79.51480000000001,
    "currency": "USD",
    "fromCents": 4200
  },
  {
    "slug": "metro-hoops",
    "title": "Metro Hawks vs. Bay Comets",
    "subtitle": "Regular season",
    "category": "SPORTS",
    "startsAt": "2026-12-09T19:30:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=900&q=70",
    "city": "Chicago, IL",
    "venue": "Central Court",
    "country": "US",
    "lat": 41.90218,
    "lng": -87.6774,
    "currency": "USD",
    "fromCents": 3800
  },
  {
    "slug": "the-lantern",
    "title": "The Lantern",
    "subtitle": "A new musical",
    "category": "THEATER",
    "startsAt": "2026-12-18T19:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1503095396549-807759245b35?auto=format&fit=crop&w=900&q=70",
    "city": "London, UK",
    "venue": "Paramount Hall",
    "country": "GB",
    "lat": 51.53196,
    "lng": -0.2152,
    "currency": "USD",
    "fromCents": 6500
  },
  {
    "slug": "kairo",
    "title": "KAIRO",
    "subtitle": "Afterglow Club Tour",
    "category": "CONCERTS",
    "startsAt": "2026-12-27T22:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=70",
    "city": "Lagos, NG",
    "venue": "Warehouse 9",
    "country": "NG",
    "lat": 6.5272,
    "lng": 3.4061,
    "currency": "USD",
    "fromCents": 3500
  },
  {
    "slug": "ice-gala",
    "title": "Winter Ice Gala",
    "subtitle": "Family holiday show",
    "category": "FAMILY",
    "startsAt": "2026-12-21T14:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=900&q=70",
    "city": "Denver, CO",
    "venue": "Northgate Center",
    "country": "US",
    "lat": 39.76576,
    "lng": -105.0134,
    "currency": "USD",
    "fromCents": 2900
  },
  {
    "slug": "the-wild-coast",
    "title": "The Wild Coast",
    "subtitle": "Sunset Sessions",
    "category": "CONCERTS",
    "startsAt": "2027-01-15T19:30:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=70",
    "city": "Los Angeles, CA",
    "venue": "Pier 40 Amphitheatre",
    "country": "US",
    "lat": 34.01964,
    "lng": -118.38080000000001,
    "currency": "USD",
    "fromCents": 5800
  },
  {
    "slug": "eko-laughs",
    "title": "Eko Laughs Live",
    "subtitle": "Six comedians, one wild night",
    "category": "COMEDY",
    "startsAt": "2026-12-19T19:30:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1527224538127-2104bb71c51b?auto=format&fit=crop&w=900&q=70",
    "city": "Lagos, NG",
    "venue": "Lagoon Arts Theatre",
    "country": "NG",
    "lat": 6.53736,
    "lng": 3.3546,
    "currency": "USD",
    "fromCents": 2400
  },
  {
    "slug": "midnight-orchestra",
    "title": "The Midnight Orchestra",
    "subtitle": "Film scores by candlelight",
    "category": "CONCERTS",
    "startsAt": "2027-01-23T20:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=900&q=70",
    "city": "London, UK",
    "venue": "Thameside Concert Hall",
    "country": "GB",
    "lat": 51.4698,
    "lng": -0.09839999999999999,
    "currency": "USD",
    "fromCents": 4800
  },
  {
    "slug": "austin-bolts",
    "title": "Austin Bolts vs. Denver Peaks",
    "subtitle": "Season opener",
    "category": "SPORTS",
    "startsAt": "2027-02-28T18:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=900&q=70",
    "city": "Austin, TX",
    "venue": "Riverbend Park",
    "country": "US",
    "lat": 30.26128,
    "lng": -97.84819999999999,
    "currency": "USD",
    "fromCents": 3200
  },
  {
    "slug": "northern-lights-film",
    "title": "Northern Lights Film Festival",
    "subtitle": "10 days · 120 films",
    "category": "FESTIVALS",
    "startsAt": "2027-04-08T17:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=70",
    "city": "Toronto, ON",
    "venue": "Harbourfront Cinemas",
    "country": "CA",
    "lat": 43.64544,
    "lng": -79.491,
    "currency": "USD",
    "fromCents": 7900
  },
  {
    "slug": "hall-of-mirrors",
    "title": "Hall of Mirrors",
    "subtitle": "A magic show for the whole family",
    "category": "FAMILY",
    "startsAt": "2026-12-29T13:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?auto=format&fit=crop&w=900&q=70",
    "city": "New York, NY",
    "venue": "Liberty Playhouse",
    "country": "US",
    "lat": 40.69248,
    "lng": -74.1439,
    "currency": "USD",
    "fromCents": 3900
  },
  {
    "slug": "lagoon-sound",
    "title": "Lagoon Sound Festival",
    "subtitle": "2 days on the water",
    "category": "FESTIVALS",
    "startsAt": "2026-12-31T16:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=900&q=70",
    "city": "Lagos, NG",
    "venue": "Tarkwa Bay Beach",
    "country": "NG",
    "lat": 6.4916,
    "lng": 3.2541,
    "currency": "USD",
    "fromCents": 6500
  },
  {
    "slug": "velvet-hour",
    "title": "The Velvet Hour",
    "subtitle": "A late-night jazz revue",
    "category": "THEATER",
    "startsAt": "2027-02-06T21:00:00Z",
    "imageUrl": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=70",
    "city": "London, UK",
    "venue": "Paramount Hall",
    "country": "GB",
    "lat": 51.53196,
    "lng": -0.2152,
    "currency": "USD",
    "fromCents": 5500
  }
];

export function availableSamples(live: EventCard[]) {
  const slugs = new Set(live.map(e => e.slug));
  return sampleCatalog.filter(e => !slugs.has(e.slug));
}

export function matchSamples(events: EventCard[], f: SearchFilters, rate?: number) {
  const { from, to } = dateRange(f.date);
  const query = f.q.trim().toLowerCase();
  return events.filter(e => {
    const date = e.startsAt.slice(0, 10);
    return (!f.category || e.category === f.category) && (!f.country || e.country === f.country)
      && (!f.city || cityOnly(e.city) === f.city) && (!from || date >= from) && (!to || date <= to)
      && (f.maxPrice === null || (rate !== undefined && e.fromCents * rate <= f.maxPrice * 100))
      && [e.title, e.subtitle, e.venue, e.city].join(' ').toLowerCase().includes(query);
  }).sort((a,b) => f.sort === 'price-asc' ? a.fromCents - b.fromCents : f.sort === 'price-desc' ? b.fromCents - a.fromCents : a.startsAt.localeCompare(b.startsAt));
}

export function SampleEvents({ events }: { events: EventCard[] }) {
  if (!events.length) return null;
  return (
    <View style={{ gap: space.md, marginVertical: space.lg }}>
      <View style={{ paddingHorizontal: gutter }}>
        <Txt variant="h2" accessibilityRole="header">Sample events</Txt>
        <Txt variant="small" color={colors.muted}>Explore the website’s sample catalog.</Txt>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}>
        {events.map(e => (
          <Pressable key={e.slug} accessibilityRole="link" accessibilityLabel={e.title + ', sample event, view on website'}
            onPress={() => void WebBrowser.openBrowserAsync(WEB_URL + '/events/' + encodeURIComponent(e.slug)).catch(() => Alert.alert('Couldn’t open event', 'Please try again.'))}
            style={{ width: 215, gap: 4 }}>
            <Image source={{ uri: e.imageUrl ?? undefined }} style={{ height: 128, borderRadius: radius.card, backgroundColor: colors.surface2 }} contentFit="cover" />
            <Txt variant="tiny" color={colors.accent}>Sample</Txt>
            <Txt variant="bodyStrong">{e.title}</Txt>
            <Txt variant="small" color={colors.muted}>{when(e.startsAt).short} · {cityOnly(e.city)}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
