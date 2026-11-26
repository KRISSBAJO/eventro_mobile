/**
 * One venue this person manages: how it shows on Omoshow, taking bookings on or off (PUT /me/venues/:id/listing
 * { active }), and the way to its listing and price, opening hours, blocked-out time, details and booking requests.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ToggleCard } from '@/components/form-ui';
import { Icon } from '@/components/icons';
import { Group, OrgScreen } from '@/components/org-ui';
import { managerGate, placeLine } from '@/components/venue-owner';
import { Button, Divider, Notice, Row, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { minutesLabel, plural, priceLabel } from '@/lib/bookings';
import { haptic } from '@/lib/haptics';
import { CLAIM_ROLE_NAME, listingKey, useManagedVenue, useOwnerListing, type OwnerListing } from '@/lib/my-venues';
import { colors, radius, space } from '@/theme';

export default function ManageVenue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { q, m } = useManagedVenue(id);
  const listing = useOwnerListing(m ? id : undefined);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const gate = managerGate('Your venue', !!user, q, !!m);
  if (gate || !m) return gate;
  const v = m.venue;
  const l = listing.data;
  const open = (screen: 'listing' | 'hours' | 'blackouts' | 'details') => router.push({ pathname: `/my-venues/[id]/${screen}`, params: { id: v.id } });

  const toggle = async (active: boolean) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const out = await api<OwnerListing>(`/me/venues/${encodeURIComponent(v.id)}/listing`, { method: 'PUT', body: { active } });
      haptic.success();
      qc.setQueryData(listingKey(v.id), out);
      setNote(out.active ? `${v.name} is taking bookings. Organizers can find it and request times.` : 'Bookings are off. Organizers can’t request new times; bookings you have stay as they are.');
      await qc.invalidateQueries({ queryKey: ['me', 'venues'] });
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const days = l?.hours?.length ? new Set(l.hours.map((h) => h.day)).size : 0;

  return (
    <OrgScreen title={v.name} eyebrow="Your venue" fallback="/my-venues" onRefresh={() => Promise.all([q.refetch(), listing.refetch()])}>
      <View style={styles.hero}>
        {v.imageUrl ? <Image source={{ uri: v.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={['rgba(255,77,61,0.28)', colors.surface]} style={StyleSheet.absoluteFill} />}
        <LinearGradient colors={[colors.fade0, colors.fade]} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.heroText}>
          <Txt variant="small" color={colors.onImageSoft} numberOfLines={2}>
            {placeLine(v)}
          </Txt>
          <Txt variant="tiny" color={colors.onImageSoft}>
            {CLAIM_ROLE_NAME[m.role] ?? m.role}
            {v.verified || v.verifiedAt ? ' · Verified' : ''}
          </Txt>
        </View>
      </View>

      {listing.isPending ? (
        <Skeleton height={76} radius={radius.md} />
      ) : listing.error ? (
        <Notice tone="plain" icon="alert" action="Try again" onAction={() => void listing.refetch()}>
          {errorText(listing.error)}
        </Notice>
      ) : l && !l.exists ? (
        <View style={styles.setup}>
          <View style={styles.setupIcon}>
            <Icon name="sparkle" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodyStrong">Take bookings on Omoshow</Txt>
            <Txt variant="small" color={colors.muted}>
              Set your price, terms and hours, then switch bookings on.
            </Txt>
          </View>
          <Button label="Set up" size="sm" onPress={() => open('listing')} />
        </View>
      ) : l ? (
        <ToggleCard
          label={l.active ? 'Taking bookings' : 'Not taking bookings'}
          sub={l.active ? 'Organizers can find it under “Book a venue” and request times.' : 'Switch on to show your price and “Book this venue” on its page.'}
          value={l.active}
          disabled={busy || (l.hidden && !l.active)}
          onChange={(on) => void toggle(on)}
        />
      ) : null}
      {l?.hidden ? (
        <Notice tone="warning" icon="lock" title="Hidden on Omoshow">
          This venue is hidden on Omoshow, so it can’t take bookings. Contact Omoshow support.
        </Notice>
      ) : null}
      {note ? (
        <Notice tone="success" icon="check">
          {note}
        </Notice>
      ) : null}
      {error ? <Notice icon="alert">{error}</Notice> : null}

      <Group>
        <Row icon="cash" label="Listing and price" detail={l ? (l.exists ? priceLabel(l) : 'Not set up') : undefined} onPress={() => open('listing')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="clock" label="Opening hours" detail={l ? (days ? `${plural(days, 'day')} a week` : 'Any time') : undefined} onPress={() => open('hours')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="calendar" label="Blocked-out time" onPress={() => open('blackouts')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="building" label="Venue details" detail="About, contact, photos" onPress={() => open('details')} />
      </Group>
      <Group>
        <Row icon="bell" label="Booking requests" detail={m.pendingBookings ? `${m.pendingBookings} waiting` : undefined} tone={m.pendingBookings ? 'accent' : undefined} onPress={() => router.push('/venue-bookings')} />
        <Divider style={{ marginLeft: 62 }} />
        <Row icon="external" label="View public page" onPress={() => router.push({ pathname: '/venue/[slug]', params: { slug: v.slug } })} />
      </Group>

      {l?.exists ? (
        <Txt variant="small" color={colors.dim}>
          {`At least ${plural(l.minHours, 'hour')} · ${l.noticeDays ? `${plural(l.noticeDays, 'day')}’ notice` : 'No notice needed'} · ${minutesLabel(l.bufferMinutes)} setup and cleanup · ${l.instantBook ? 'Instant booking' : 'You confirm each request within 48 hours'}.`}
        </Txt>
      ) : null}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 170, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2, justifyContent: 'flex-end' },
  heroText: { gap: space.sm, padding: space.lg },
  setup: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: 'rgba(255,77,61,0.06)' },
  setupIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
});
