/**
 * Omoshow in live numbers (GET /events/stats, refreshed every 10 minutes on the API), counting up when they appear:
 * on Sell tickets (tickets issued, events on sale, cities) and List your venue (venues taking bookings, cities).
 * Numbers the API can't give, or that are still 0, are left out; nothing shows while they load.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Txt } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, font, space } from '@/theme';

type Stats = { eventsOnSale: number; ticketsIssued: number; organizers: number; cities: number; venuesTakingBookings?: number; venueCities?: number };
type Key = 'tickets' | 'events' | 'cities' | 'venues' | 'venueCities';

const pick: Record<Key, (s: Stats) => { n: number; label: string }> = {
  tickets: (s) => ({ n: s.ticketsIssued, label: 'Tickets issued' }),
  events: (s) => ({ n: s.eventsOnSale, label: 'Events on sale' }),
  cities: (s) => ({ n: s.cities, label: s.cities === 1 ? 'City' : 'Cities' }),
  venues: (s) => ({ n: s.venuesTakingBookings ?? 0, label: 'Venues taking bookings' }),
  venueCities: (s) => ({ n: s.venueCities ?? 0, label: s.venueCities === 1 ? 'City' : 'Cities' }),
};

/** 58,881 → 58.8 + "K+"; 1,240,000 → 1.2 + "M+"; 21 → 21 (rounded down, so the "+" stays true). */
function compact(n: number) {
  if (n >= 1_000_000) return { to: Math.floor(n / 100_000) / 10, decimals: 1, suffix: 'M+' };
  if (n >= 100_000) return { to: Math.floor(n / 1000), decimals: 0, suffix: 'K+' };
  if (n >= 10_000) return { to: Math.floor(n / 100) / 10, decimals: 1, suffix: 'K+' };
  return { to: n, decimals: 0, suffix: '' };
}

/** Counts from 0 to `to` over about a second (straight to it when Reduce Motion is on). */
function CountUp({ to, decimals, suffix }: { to: number; decimals: number; suffix: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let stop = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (stop) return;
        if (reduce) return setV(to);
        const start = Date.now();
        const step = () => {
          const p = Math.min(1, (Date.now() - start) / 1200);
          setV(to * (1 - Math.pow(1 - p, 4)));
          if (p < 1 && !stop) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <Txt style={styles.num}>
      {v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </Txt>
  );
}

export function LiveStats({ show }: { show: Key[] }) {
  const q = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/events/stats'), staleTime: 10 * 60_000, retry: 1 });
  if (!q.data) return null;
  const items = show.map((k) => pick[k](q.data)).filter((x) => x.n > 0);
  if (!items.length) return null;
  return (
    <View style={styles.row} accessibilityRole="summary">
      {items.map((x) => {
        const c = compact(x.n);
        return (
          <View key={x.label} style={{ gap: 2 }}>
            <CountUp to={c.to} decimals={c.decimals} suffix={c.suffix} />
            <Txt variant="small" color={colors.muted}>
              {x.label}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  num: { fontFamily: font.display.heavy, fontSize: 30, lineHeight: 34, letterSpacing: -0.8, color: colors.text },
});
