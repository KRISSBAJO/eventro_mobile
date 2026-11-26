/** Data hooks over the API (React Query). */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, isOffline, qs } from './api';
import { dateRange, lastMinuteRange, type DateRange } from './format';
import type { Category, DoorEvent, EventDetail, EventPage, EventResale, Health, MyOrg, MyResale, MyTickets, WatchedEvent } from './types';
import { readVault, writeVault } from './vault';

/** Every upcoming public event (the catalog is small); used for near-you, place options and rails. */
export function useAllEvents() {
  return useQuery({
    queryKey: ['events', 'all'],
    queryFn: () => api<EventPage>(`/events${qs({ pageSize: 100 })}`),
    staleTime: 2 * 60_000,
  });
}

/** Events sorted by distance from a precise position (GET /events?near=lat,lng). */
export function useEventsNear(lat?: number, lng?: number) {
  return useQuery({
    queryKey: ['events', 'near', lat?.toFixed(3), lng?.toFixed(3)],
    queryFn: () => api<EventPage>(`/events${qs({ near: `${lat!.toFixed(4)},${lng!.toFixed(4)}`, pageSize: 100 })}`),
    enabled: lat !== undefined && lng !== undefined,
    staleTime: 2 * 60_000,
  });
}

/**
 * Trending: most paid tickets in the last 14 days, ties soonest first (GET /events?sort=popular).
 * `trending` is false when nothing has sold lately (the list is then simply soonest first).
 */
export function useTrendingEvents() {
  const q = useQuery({
    queryKey: ['events', 'popular'],
    queryFn: () => api<EventPage>(`/events${qs({ sort: 'popular', pageSize: 30 })}`),
    staleTime: 2 * 60_000,
  });
  return { ...q, trending: (q.data?.items[0]?.soldRecent ?? 0) > 0 };
}

export function useEventsBetween(range: DateRange) {
  const { from, to } = dateRange(range);
  return useQuery({
    queryKey: ['events', 'range', from, to],
    queryFn: () => api<EventPage>(`/events${qs({ from, to, pageSize: 20 })}`),
    staleTime: 2 * 60_000,
  });
}

/** Last minute: events on today and in the next two days that still have tickets on sale, soonest first. */
export function useLastMinute() {
  const { from, to } = lastMinuteRange();
  return useQuery({
    queryKey: ['events', 'last-minute', from, to],
    queryFn: () => api<EventPage>(`/events${qs({ from, to, pageSize: 12 })}`),
    staleTime: 2 * 60_000,
  });
}

/** Just announced: published in the last two weeks, newest first (GET /events?sort=new). */
export function useJustAnnounced() {
  const q = useQuery({
    queryKey: ['events', 'new'],
    queryFn: () => api<EventPage>(`/events${qs({ sort: 'new', pageSize: 12 })}`),
    staleTime: 2 * 60_000,
  });
  const [since] = useState(() => Date.now() - 14 * 86_400_000);
  const items = (q.data?.items ?? []).filter((e) => e.publishedAt && new Date(e.publishedAt).getTime() >= since);
  return { ...q, items };
}

export type SearchFilters = {
  q: string;
  category: Category | '';
  country: string;
  city: string;
  date: DateRange;
  /** whole units of `currency`; the API converts each event's lowest price into it before comparing */
  maxPrice: number | null;
  /** the visitor's currency (ISO), sent with maxPrice */
  currency: string;
  /** new: most recently put on sale first ("Just announced") */
  sort: 'date' | 'price-asc' | 'price-desc' | 'popular' | 'new';
};

export const NO_FILTERS: SearchFilters = { q: '', category: '', country: '', city: '', date: 'any', maxPrice: null, currency: 'USD', sort: 'date' };

const PAGE = 20;

export function useEventSearch(f: SearchFilters) {
  const { from, to } = dateRange(f.date);
  const params = {
    q: f.q.trim() || undefined,
    category: f.category || undefined,
    country: f.country || undefined,
    city: f.city || undefined,
    from,
    to,
    maxPrice: f.maxPrice ?? undefined,
    currency: f.maxPrice !== null ? f.currency : undefined,
    sort: f.sort === 'date' ? undefined : f.sort,
  };
  return useInfiniteQuery({
    queryKey: ['events', 'search', params],
    queryFn: ({ pageParam, signal }) => api<EventPage>(`/events${qs({ ...params, page: pageParam, pageSize: PAGE })}`, { signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 60_000,
  });
}

export function useEvent(slug: string | undefined) {
  return useQuery({
    queryKey: ['event', slug],
    queryFn: async () => {
      const e = await api<EventDetail>(`/events/${encodeURIComponent(slug!)}`);
      // Previews of unpublished events need a token the app never sends; treat any as missing.
      if (e.preview) throw new ApiError('Event not found.', 404);
      return e;
    },
    enabled: !!slug,
    staleTime: 30_000,
  });
}

/** Which payment providers are live (mock = test mode, nothing is charged). */
export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), staleTime: 5 * 60_000, retry: 1 });
}

/**
 * The wallet (GET /me/tickets). Each good answer is saved on the device (encrypted: ACTIVE tickets carry their QR
 * seeds), so the wallet and its door codes still work offline; `offline` is true when the saved copy is showing
 * because the API couldn't be reached.
 */
/** Watching: the signed-in fan's price alerts on upcoming events, newest first. */
export function useWatching(userId: string | undefined) {
  return useQuery({
    queryKey: ['me', 'watching', userId],
    queryFn: () => api<{ slugs: string[]; items: WatchedEvent[] }>('/me/watching'),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/** Stop watching an event from the list; the list updates straight away. */
export function useUnwatch() {
  const qc = useQueryClient();
  return async (slug: string) => {
    qc.setQueriesData<{ slugs: string[]; items: WatchedEvent[] }>({ queryKey: ['me', 'watching'] }, (d) =>
      d ? { slugs: d.slugs.filter((s) => s !== slug), items: d.items.filter((e) => e.slug !== slug) } : d,
    );
    try {
      await api(`/me/watching/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    } finally {
      void qc.invalidateQueries({ queryKey: ['me', 'watching'] });
    }
  };
}

export function useMyTickets(userId: string | undefined) {
  const key = userId ? `tickets-${userId}` : null;
  type Saved = { at: number; data: MyTickets };
  const [cache, setCache] = useState<{ key: string | null; value: Saved | null; loaded: boolean }>({ key, value: null, loaded: false });
  // A different account: forget the other one's saved copy straight away (adjusting state while rendering).
  if (cache.key !== key) setCache({ key, value: null, loaded: false });
  const saved = cache.key === key ? cache.value : null;
  const savedLoaded = cache.key === key && cache.loaded;

  useEffect(() => {
    if (!key) return;
    let live = true;
    readVault<Saved>(key).then((s) => {
      if (live) setCache({ key, value: s, loaded: true });
    });
    return () => {
      live = false;
    };
  }, [key]);

  const q = useQuery({
    queryKey: ['me', 'tickets', userId],
    queryFn: async () => {
      const data = await api<MyTickets>('/me/tickets');
      if (key) void writeVault(key, { at: Date.now(), data });
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  // The API can't be reached (a first load or a refresh): keep showing what we have, and say so.
  const netDown = !!q.error && isOffline(q.error);
  const data = q.data ?? (netDown || q.isPending ? saved?.data : undefined);
  return {
    data,
    savedAt: q.data ? q.dataUpdatedAt : (saved?.at ?? null),
    offline: netDown && !!data,
    loading: q.isPending && !q.error && !(savedLoaded && saved),
    error: q.error && !data ? q.error : null,
    refetch: q.refetch,
    isRefetching: q.isRefetching,
  };
}

/** "Sales & payouts" (GET /me/resale). */
export function useMyResale(userId: string | undefined) {
  return useQuery({
    queryKey: ['me', 'resale', userId],
    queryFn: () => api<MyResale>('/me/resale'),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/** Other fans' listings for an event (for "other fans from …" in the sell sheet). */
export function useEventResale(slug: string | undefined) {
  return useQuery({
    queryKey: ['event', slug, 'resale'],
    queryFn: () => api<EventResale>(`/events/${encodeURIComponent(slug!)}/resale`),
    enabled: !!slug,
    staleTime: 60_000,
    retry: 0,
  });
}

/** After a transfer, sale or claim: the wallet and sales lists are out of date. */
export function useRefreshWallet() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['me', 'tickets'] }), qc.invalidateQueries({ queryKey: ['me', 'resale'] })]);
}

/** The door scanner's events for one organization (GET /organizer/orgs/:id/door-events): light, with check-in counts. */
export function useDoorEvents(orgId: string | undefined, opts: { refetchMs?: number | false } = {}) {
  return useQuery({
    queryKey: ['organizer', 'door-events', orgId],
    queryFn: () => api<DoorEvent[]>(`/organizer/orgs/${encodeURIComponent(orgId!)}/door-events`),
    enabled: !!orgId,
    refetchInterval: opts.refetchMs ?? false,
    retry: 0,
  });
}

/** Organizations this account is on the team of (GET /organizer/orgs); empty for most fans. */
export function useMyOrgs(userId: string | undefined) {
  return useQuery({
    queryKey: ['organizer', 'orgs', userId],
    queryFn: () => api<MyOrg[]>('/organizer/orgs'),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
