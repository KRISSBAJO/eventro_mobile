/** Data hooks over the API (React Query). */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, isOffline, qs } from './api';
import { dateRange, type DateRange } from './format';
import { readJson, writeJson } from './storage';
import type { Category, EventDetail, EventPage, Health, MyTickets } from './types';

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

export function useEventsBetween(range: DateRange) {
  const { from, to } = dateRange(range);
  return useQuery({
    queryKey: ['events', 'range', from, to],
    queryFn: () => api<EventPage>(`/events${qs({ from, to, pageSize: 20 })}`),
    staleTime: 2 * 60_000,
  });
}

export type SearchFilters = {
  q: string;
  category: Category | '';
  country: string;
  city: string;
  date: DateRange;
  /** whole units of the event currency; the API compares the lowest price against it */
  maxPrice: number | null;
  sort: 'date' | 'price-asc' | 'price-desc';
};

export const NO_FILTERS: SearchFilters = { q: '', category: '', country: '', city: '', date: 'any', maxPrice: null, sort: 'date' };

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
 * The wallet (GET /me/tickets). Each good answer is saved on the device, so the wallet still opens offline;
 * `offline` is true when the saved copy is showing because the API couldn't be reached.
 */
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
    readJson<Saved>(key).then((s) => {
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
      if (key) void writeJson(key, { at: Date.now(), data });
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
