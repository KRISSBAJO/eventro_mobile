/**
 * Website paths (what notifications carry in `data.path`, and what eventro:// links use) → app routes.
 *
 *   /tickets/<id>   → /ticket/<id>
 *   /tickets        → the wallet tab
 *   /events/<slug>  → /event/<slug>
 *   /gift/<token>   → /gift/<token>
 *
 * src/app/tickets/[id].tsx and src/app/events/[slug].tsx redirect the same way, so eventro:// links opened from
 * outside the app land on the right screen too.
 */
import type { Href } from 'expo-router';

export function appPath(raw: string | null | undefined): Href | null {
  if (!raw) return null;
  // eventro://tickets/X, https://eventro.app/tickets/X or /tickets/X
  let path = raw.trim().replace(/^eventro:\/\/\/?/i, '/').replace(/^https?:\/\/[^/]+/i, '');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.split('#')[0];
  const [p] = path.split('?');
  const parts = p.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const [first, second] = parts;
  if (first === 'tickets' || first === 'ticket') return second ? { pathname: '/ticket/[id]', params: { id: second } } : '/tickets';
  if ((first === 'events' || first === 'event') && second) return { pathname: '/event/[slug]', params: { slug: second } };
  if (first === 'gift' && second) return { pathname: '/gift/[token]', params: { token: second } };
  // "New sale" pushes open the event's organizer dashboard.
  if (first === 'organizer') return second === 'events' && parts[2] ? { pathname: '/organizer/events/[id]', params: { id: parts[2] } } : '/organizer';
  if (first === 'account') return '/account';
  if (!first) return '/';
  return null;
}
