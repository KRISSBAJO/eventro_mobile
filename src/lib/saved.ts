/**
 * Saved events (the hearts), the same everywhere in the app and on the website.
 *
 * Signed out, hearts live on this phone (storage.ts: a file, or localStorage on web), each with a copy of its event
 * card so the Saved screen works offline. Signed in, the server is the source of truth (GET/PUT/DELETE /me/saved),
 * so saves follow the fan to the website and other phones. At sign-in, <SavedSync /> sends the phone's hearts once
 * (POST /me/saved/sync, which skips events that are gone) and then forgets them here.
 *
 * Toggling is optimistic: the heart changes at once and goes back if the API says no.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { api, errorText } from './api';
import { useAuth } from './auth';
import { haptic } from './haptics';
import { readJson, writeJson } from './storage';
import type { EventCard, EventDetail, SavedEvents } from './types';

const KEY = 'saved-events';
/** the API's limit for one sync */
const SYNC_MAX = 200;

/* ---------- hearts kept on this phone (signed out) ---------- */

let local: EventCard[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const loading = readJson<EventCard[]>(KEY).then((v) => {
  // A heart tapped before the file was read stays, ahead of the saved ones.
  const seen = new Set(local.map((c) => c.slug));
  local = [...local, ...(Array.isArray(v) ? v.filter((c) => c && typeof c.slug === 'string' && !seen.has(c.slug)) : [])];
  loaded = true;
  emit();
});

const setLocal = (next: EventCard[]) => {
  local = next;
  void writeJson(KEY, next.length ? next : null);
  emit();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useLocal = () => useSyncExternalStore(subscribe, () => local, () => local);

/** An event page's details as a card, for saving from the event screen. */
export function cardOf(e: EventDetail): EventCard {
  return {
    slug: e.slug,
    title: e.title,
    subtitle: e.subtitle,
    category: e.category,
    startsAt: e.startsAt,
    imageUrl: e.imageUrl,
    venue: e.venue?.name ?? (e.online ? 'Online' : null),
    city: e.venue?.city ?? null,
    country: e.venue?.country ?? null,
    lat: e.venue?.lat ?? null,
    lng: e.venue?.lng ?? null,
    currency: e.currency,
    fromCents: e.fromCents,
  };
}

const savedKey = (userId: string | undefined) => ['me', 'saved', userId] as const;

/** The account's saved events (signed in only). */
export function useSavedQuery(userId: string | undefined) {
  return useQuery({
    queryKey: savedKey(userId),
    queryFn: () => api<SavedEvents>('/me/saved'),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/**
 * Hearts for any screen: `isSaved(slug)`, `toggle(card)` and the saved cards (newest first), from the account when
 * signed in and from this phone otherwise.
 */
export function useSaved() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const mine = useLocal();
  const server = useSavedQuery(user?.id);
  const slugs = user ? (server.data?.slugs ?? []) : mine.map((c) => c.slug);
  const set = new Set(slugs);

  /** Saves or unsaves; resolves to an error message when the API refused (the heart is put back). */
  const toggle = async (card: EventCard): Promise<string | null> => {
    const on = !set.has(card.slug);
    haptic.select();
    if (!user) {
      setLocal(on ? [card, ...local.filter((c) => c.slug !== card.slug)] : local.filter((c) => c.slug !== card.slug));
      return null;
    }
    const key = savedKey(user.id);
    await qc.cancelQueries({ queryKey: key });
    const before = qc.getQueryData<SavedEvents>(key);
    const base = before ?? { ids: [], slugs: [], items: [] };
    const without = (s: SavedEvents) => {
      const keep = s.slugs.map((x, i) => [x, i] as const).filter(([x]) => x !== card.slug);
      return { ids: keep.map(([, i]) => s.ids[i]).filter(Boolean), slugs: keep.map(([x]) => x), items: s.items.filter((c) => c.slug !== card.slug) };
    };
    const rest = without(base);
    qc.setQueryData<SavedEvents>(key, on ? { ids: rest.ids, slugs: [card.slug, ...rest.slugs], items: [card, ...rest.items] } : rest);
    try {
      await api(`/me/saved/${encodeURIComponent(card.slug)}`, { method: on ? 'PUT' : 'DELETE' });
      void qc.invalidateQueries({ queryKey: key });
      return null;
    } catch (e) {
      qc.setQueryData(key, before);
      haptic.error();
      return errorText(e);
    }
  };

  return {
    signedIn: !!user,
    isSaved: (slug: string) => set.has(slug),
    toggle,
    items: user ? (server.data?.items ?? []) : mine,
    loading: user ? server.isPending : !loaded,
    error: user ? server.error : null,
    refetch: () => (user ? server.refetch() : Promise.resolve()),
  };
}

/**
 * Mounted once at the root: when someone signs in and this phone has hearts from before, add them to the account
 * (oldest first, so the newest stays newest) and forget them here.
 */
export function SavedSync() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      await loading;
      if (!live || !local.length) return;
      const cards = local.slice(0, SYNC_MAX);
      try {
        const merged = await api<SavedEvents>('/me/saved/sync', { body: { eventIds: cards.map((c) => c.slug).reverse() } });
        if (!live) return;
        qc.setQueryData(savedKey(user.id), merged);
        const sent = new Set(cards.map((c) => c.slug));
        setLocal(local.filter((c) => !sent.has(c.slug)));
      } catch {
        // Offline or refused: keep them on the phone and try again next time.
      }
    })();
    return () => {
      live = false;
    };
  }, [user, qc]);
  return null;
}
