/**
 * Following organizers and venues (GET /me/following, PUT/DELETE /me/following/:kind/:slug) and organizer pages
 * (GET /organizers/:slug). New events from who a fan follows show on Home and in Following, and the API sends a push
 * when one goes on sale.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { EventCard } from './types';

export type FollowKind = 'organizers' | 'venues';

export type Followed = { slug: string; name: string; verified: boolean; upcoming: number; followedAt: string; city?: string; country?: string | null; imageUrl?: string | null; logoUrl?: string | null };
export type FollowedEvent = EventCard & { via: { kind: 'organizer' | 'venue'; slug: string; name: string } };
export type Following = { organizers: Followed[]; venues: Followed[]; events: FollowedEvent[] };

/** GET /organizers/:slug */
export type OrganizerPage = { slug: string; name: string; about: string | null; website: string | null; logoUrl?: string | null; coverUrl?: string | null; verified: boolean; since: string; followers: number; eventsHosted: number; events: EventCard[] };

const KEY = ['me', 'following'] as const;

/** "Lagos Live Co" → "LL", for an organizer's mark. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function useFollowing(userId: string | undefined) {
  return useQuery({ queryKey: [...KEY, userId], queryFn: () => api<Following>('/me/following'), enabled: !!userId, staleTime: 60_000 });
}

export function useOrganizer(slug: string | undefined) {
  return useQuery({ queryKey: ['organizer', slug], queryFn: () => api<OrganizerPage>(`/organizers/${encodeURIComponent(slug!)}`), enabled: !!slug, staleTime: 60_000 });
}

/** Follow or unfollow; the button flips straight away, and follower counts and the list refresh after. */
export function useFollowToggle() {
  const qc = useQueryClient();
  return async (kind: FollowKind, slug: string, follow: boolean, name: string) => {
    const list = kind === 'organizers' ? 'organizers' : 'venues';
    const stub: Followed = { slug, name, verified: false, upcoming: 0, followedAt: new Date().toISOString() };
    qc.setQueriesData<Following>({ queryKey: KEY }, (d) => (d ? { ...d, [list]: follow ? [stub, ...d[list].filter((x) => x.slug !== slug)] : d[list].filter((x) => x.slug !== slug) } : d));
    try {
      await api(`/me/following/${kind}/${encodeURIComponent(slug)}`, { method: follow ? 'PUT' : 'DELETE' });
    } finally {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: [kind === 'organizers' ? 'organizer' : 'venue', slug] });
    }
  };
}
