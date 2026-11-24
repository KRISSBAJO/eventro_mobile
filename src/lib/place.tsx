/**
 * "Happening near you": where the fan is, and the events closest to them (same rules as the website's near.ts).
 *
 * Where they are, best first:
 *   1. a place they picked, or their precise position if they shared it; remembered on this device;
 *   2. otherwise the API's guess from the connection (GET /geo/me).
 * Nothing is asked for up front: the location prompt only appears when they tap "Use my precise location".
 */
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { cityOnly, countryName, km } from './format';
import { readJson, writeJson } from './storage';
import type { EventCard, GeoMe } from './types';

export type Place = {
  /** ISO 3166 country code, e.g. "NG" */
  country: string;
  city?: string;
  lat?: number;
  lng?: number;
  source: 'picked' | 'precise' | 'guess';
};

const KEY = 'place';

type PlaceCtx = { place: Place | null; ready: boolean; save: (p: Place | null) => void };
const Ctx = createContext<PlaceCtx | null>(null);

export function PlaceProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Place | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    readJson<Place>(KEY).then((p) => {
      setSaved(p);
      setLoaded(true);
    });
  }, []);
  const guess = useQuery({
    queryKey: ['geo-me'],
    queryFn: () => api<GeoMe>('/geo/me'),
    enabled: loaded && !saved,
    staleTime: Infinity,
    retry: 0,
  });
  const fromGuess: Place | null = guess.data?.country ? { country: guess.data.country, ...(guess.data.city ? { city: guess.data.city } : {}), source: 'guess' } : null;
  const save = useCallback((p: Place | null) => {
    setSaved(p);
    void writeJson(KEY, p);
  }, []);
  const value: PlaceCtx = { place: saved ?? fromGuess, ready: loaded && (!!saved || !guess.isPending), save };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlace needs <PlaceProvider>');
  return v;
}

export const placeLabel = (p: Place | null) =>
  !p ? 'Choose location' : p.source === 'precise' ? 'Your location' : [p.city, countryName(p.country)].filter(Boolean).join(', ');

/** A city name short enough for a header pill: one-word names as they are (up to 9 letters), several words as
 * initials ("New York" → "NY", "Los Angeles" → "LA", "Port Harcourt" → "PH"). */
export const shortCity = (city: string) => {
  const c = city.trim();
  if (!/[\s-]/.test(c) && c.length <= 9) return c;
  const initials = c
    .split(/[\s-]+/)
    .filter((w) => /^[A-ZÀ-Ý]/.test(w))
    .map((w) => w[0])
    .join('');
  return initials.length >= 2 ? initials : c.slice(0, 7) + '…';
};

/** The header pill: "NY", "Lagos", "Near you", or the country when there's no city ("Nigeria" / "US"). */
export const placeShort = (p: Place | null) => {
  if (!p) return 'Location';
  if (p.source === 'precise') return 'Near you';
  if (p.city) return shortCity(p.city);
  const name = countryName(p.country);
  return name.length <= 8 ? name : p.country;
};

/** Asks for the device's position (shows the system prompt the first time). */
export async function preciseLocation(): Promise<{ lat: number; lng: number }> {
  const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (!perm || perm.status !== 'granted') {
    throw new Error(perm?.canAskAgain === false ? 'Location is off for Eventro. Turn it on in Settings, or pick a city instead.' : 'Location wasn’t shared. You can pick a city instead.');
  }
  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
  if (!pos) throw new Error('We couldn’t get your location. Try picking a city.');
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/* ---------- ranking ---------- */

export type Ranked = { event: EventCard; tier: 'city' | 'country' | 'online' | 'world'; distanceKm: number | null };

const pointOf = (e: EventCard): [number, number] | null => (e.lat !== null && e.lng !== null ? [e.lat, e.lng] : null);
const isOnline = (e: EventCard) => e.venue === 'Online' && !e.city;

/** Events ranked for this place: city, then country, then online, then the rest. */
export function rankNear(events: EventCard[], place: Place | null): Ranked[] {
  const order = { city: 0, country: 1, online: 2, world: 3 } as const;
  const here: [number, number] | null = place?.lat !== undefined && place?.lng !== undefined ? [place.lat, place.lng] : null;
  return events
    .map((e): Ranked => {
      const p = pointOf(e);
      const distanceKm = e.distanceKm ?? (here && p && !isOnline(e) ? km(here, p) : null);
      const sameCity = !!place?.city && !isOnline(e) && cityOnly(e.city).toLowerCase() === place.city.toLowerCase();
      // With a precise position, anything within ~60 km counts as "your city" (suburbs, neighbouring towns).
      const tier = sameCity || (distanceKm !== null && distanceKm < 60) ? 'city' : place && e.country === place.country && !isOnline(e) ? 'country' : isOnline(e) ? 'online' : 'world';
      return { event: e, tier, distanceKm };
    })
    .sort(
      (a, b) =>
        order[a.tier] - order[b.tier] ||
        (a.distanceKm !== null && b.distanceKm !== null ? a.distanceKm - b.distanceKm : 0) ||
        a.event.startsAt.localeCompare(b.event.startsAt),
    );
}

/** The country of the closest place with events (a position only gives coordinates); null if nothing within 800 km. */
export function nearestCountry(events: EventCard[], lat: number, lng: number): string | null {
  let best: { c: string; d: number } | null = null;
  for (const e of events) {
    const p = pointOf(e);
    if (!p || !e.country) continue;
    const d = km([lat, lng], p);
    if (!best || d < best.d) best = { c: e.country, d };
  }
  return best && best.d < 800 ? best.c : null;
}

export type CountryOption = { code: string; name: string; total: number; cities: [string, number][] };

/** Countries and cities with upcoming in-person events, busiest first. */
export function placeOptions(events: EventCard[]): CountryOption[] {
  const byCountry = new Map<string, Map<string, number>>();
  for (const e of events) {
    if (!e.country || isOnline(e)) continue;
    const city = cityOnly(e.city);
    const m = byCountry.get(e.country) ?? new Map<string, number>();
    if (city) m.set(city, (m.get(city) ?? 0) + 1);
    byCountry.set(e.country, m);
  }
  return [...byCountry.entries()]
    .map(([code, cities]) => ({
      code,
      name: countryName(code),
      total: [...cities.values()].reduce((a, b) => a + b, 0),
      cities: [...cities.entries()].sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.total - a.total);
}
