/**
 * A gift link (eventro://gift/<token>, /gift/<token>, or a "Gift delivered" notification): what the recipient sees.
 *
 *   scheduled  a wrapped box and the date it opens, nothing else (no peeking)
 *   ready      "Open your gift" reveals the tickets, the sender's message, and "Add to my tickets" (sign in first)
 *   claimed    a calm note that it's been added to an account
 *   cancelled  a comp the organizer revoked
 *
 * A comp (`comp: true`) is a complimentary ticket from the organizer, claimed the same way: "You're on the guest
 * list", from the organizer, with its group ("Press", "Artist"…); it skips the wrapping.
 *
 * GET /gifts/:token is public; POST /gifts/:token/claim needs a signed-in account (any email: the link is the proof).
 */
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icons';
import { TierBadge, TierGlyph, TierSurface } from '@/components/tier-look';
import { Badge, Button, EmptyState, IconButton, Notice, Skeleton, Txt } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { firstName, localStamp, money, when } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useRefreshWallet } from '@/lib/queries';
import { lookOf } from '@/lib/tiers';
import type { Gift } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme';

type Claim = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; already: boolean } | { kind: 'own' } | { kind: 'empty' } | { kind: 'error'; message: string };

export default function GiftScreen() {
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  // Gift tokens are base64url; anything else can't be a real link.
  const token = String(raw ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const insets = useSafeAreaInsets();
  const q = useQuery({
    queryKey: ['gift', token],
    queryFn: () => api<Gift>(`/gifts/${encodeURIComponent(token)}`, { auth: false }),
    enabled: !!token,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status === 404),
  });
  const [status, setStatus] = useState<Gift['status'] | null>(null);
  const [opened, setOpened] = useState(false);

  const gift = q.data ? { ...q.data, status: status ?? q.data.status } : null;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: insets.top + space.sm, paddingHorizontal: gutter - 4 }}>
        <IconButton icon="close" label="Close" onPress={close} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge, gap: space.xl, alignItems: 'center' }}>
        {!token || (q.error instanceof ApiError && q.error.status === 404) ? (
          <EmptyState
            icon="gift"
            title="We can’t find this gift"
            body="The link may be cut short, or the order behind it was cancelled. Try opening it straight from the email, or ask the person who sent it to resend it from their My tickets."
            action="Browse events"
            onAction={() => router.replace('/')}
          />
        ) : q.isPending ? (
          <View style={{ width: '100%', gap: space.lg, alignItems: 'center', paddingTop: space.xxl }}>
            <Skeleton width={120} height={120} radius={30} />
            <Skeleton height={28} width="70%" />
            <Skeleton height={18} width="50%" />
          </View>
        ) : !gift ? (
          <EmptyState icon="alert" title="We couldn’t open your gift just now" body={errorText(q.error)} action="Try again" onAction={() => q.refetch()} />
        ) : gift.status === 'scheduled' ? (
          <View style={styles.center}>
            <GiftBox still />
            <Txt variant="eyebrow" color={colors.accent}>
              A gift for {gift.to}
            </Txt>
            <Txt variant="h1" style={{ textAlign: 'center' }}>
              This gift opens on {localStamp(new Date(gift.sendAt).getTime())}
            </Txt>
            <Txt color={colors.muted} style={{ textAlign: 'center' }}>
              {firstName(gift.from)} has something lined up for you. Come back then: we’ll email you the moment it’s ready, and no peeking until it is.
            </Txt>
            <Txt variant="small" color={colors.dim}>
              Times are shown in your time zone.
            </Txt>
          </View>
        ) : gift.status === 'cancelled' ? (
          <View style={styles.center}>
            <View style={styles.doneIcon}>
              <Icon name="close" size={32} color={colors.muted} />
            </View>
            <Txt variant="eyebrow" color={colors.accent}>
              {gift.comp ? `Complimentary ticket from ${gift.from}` : `Gift from ${gift.from}`}
            </Txt>
            <Txt variant="h1" style={{ textAlign: 'center' }}>
              {gift.comp ? 'This complimentary ticket was cancelled by the organizer.' : 'This gift was cancelled.'}
            </Txt>
            <Txt color={colors.muted} style={{ textAlign: 'center' }}>
              {gift.event ? `It no longer works for ${gift.event.title}. ` : 'It no longer works. '}
              If you think that’s a mistake, contact the organizer.
            </Txt>
            {gift.event ? <Button label="See the event" variant="ghost" onPress={() => router.replace({ pathname: '/event/[slug]', params: { slug: gift.event!.slug } })} /> : null}
          </View>
        ) : gift.status === 'claimed' ? (
          <Claimed gift={gift} />
        ) : !opened && !gift.comp ? (
          <View style={styles.center}>
            <Txt variant="eyebrow" color={colors.accent}>
              A gift for {gift.to}
            </Txt>
            <Txt variant="h1" style={{ textAlign: 'center' }}>
              {firstName(gift.from)} sent you something
            </Txt>
            <GiftBox />
            <Button
              label="Open your gift"
              icon="gift"
              feedback="firm"
              onPress={() => {
                haptic.success();
                setOpened(true);
              }}
            />
          </View>
        ) : (
          <Revealed gift={gift} token={token} onStatus={setStatus} />
        )}
      </ScrollView>
    </View>
  );
}

/** A wrapped box that bobs gently (still: no motion). */
function GiftBox({ still }: { still?: boolean }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, still]);
  return (
    <Animated.View style={[styles.box, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) }] }]}>
      <View style={styles.ribbonV} />
      <View style={styles.ribbonH} />
      <Icon name="gift" size={44} color={colors.accentInk} />
    </Animated.View>
  );
}

function Claimed({ gift }: { gift: Gift }) {
  const { user } = useAuth();
  return (
    <View style={styles.center}>
      <View style={styles.doneIcon}>
        <Icon name="check" size={32} color={colors.muted} />
      </View>
      <Txt variant="eyebrow" color={colors.accent}>
        {gift.comp ? `Complimentary ticket from ${gift.from}` : `Gift from ${gift.from}`}
      </Txt>
      <Txt variant="h1" style={{ textAlign: 'center' }}>
        {gift.comp ? 'This ticket has been added to an account' : 'This gift has been added to an account'}
      </Txt>
      <Txt color={colors.muted} style={{ textAlign: 'center' }}>
        {gift.event ? `The tickets to ${gift.event.title} have been opened. ` : 'It’s been opened. '}
        If that was you, they’re waiting in My tickets with your QR code.
      </Txt>
      <Button label={user ? 'Go to My tickets' : 'Sign in to see your tickets'} onPress={() => (user ? router.replace('/tickets') : router.push({ pathname: '/sign-in', params: { then: 'tickets' } }))} />
    </View>
  );
}

function Revealed({ gift, token, onStatus }: { gift: Gift; token: string; onStatus: (s: Gift['status']) => void }) {
  const { user, signOut } = useAuth();
  const refresh = useRefreshWallet();
  const [claim, setClaim] = useState<Claim>({ kind: 'idle' });
  const [fade] = useState(() => new Animated.Value(0));
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    Animated.timing(fade, { toValue: 1, duration: 500, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [fade]);

  const qty = gift.quantity ?? 1;
  const tickets = qty === 1 ? 'ticket' : `${qty} tickets`;
  const title = gift.event?.title ?? 'the event';
  const e = gift.event;
  const look = lookOf(gift.ticketType);

  const add = async () => {
    setClaim({ kind: 'busy' });
    try {
      const r = await api<{ claimed: true; already?: boolean; tickets?: number }>(`/gifts/${encodeURIComponent(token)}/claim`, { method: 'POST' });
      haptic.success();
      setClaim({ kind: 'done', already: !!r.already });
      await refresh();
    } catch (err) {
      haptic.error();
      const message = errorText(err);
      if (err instanceof ApiError && err.status === 401) setClaim({ kind: 'error', message: 'Please sign in again to add the tickets.' });
      else if (/bought this gift/i.test(message)) setClaim({ kind: 'own' });
      else if (/no tickets left/i.test(message)) setClaim({ kind: 'empty' });
      else if (/already been claimed/i.test(message)) onStatus('claimed');
      else if (/delivered yet/i.test(message)) onStatus('scheduled');
      else if (/cancel/i.test(message)) onStatus('cancelled');
      else setClaim({ kind: 'error', message });
    }
  };

  return (
    <Animated.View style={{ width: '100%', gap: space.xl, alignItems: 'center', opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <Txt variant="eyebrow" color={colors.accent}>
        {gift.comp ? `Complimentary ticket from ${gift.from}` : `A gift from ${gift.from}`}
      </Txt>
      <Txt variant="h1" style={{ textAlign: 'center' }}>
        {gift.comp ? 'You’re on the guest list' : `You’ve got tickets, ${firstName(gift.to)}!`}
      </Txt>
      {gift.comp && gift.group ? <Badge label={gift.group} tone="accent" style={{ alignSelf: 'center' }} /> : null}
      {gift.comp && !gift.message ? (
        <Txt color={colors.muted} style={{ textAlign: 'center' }}>
          {`${gift.from} added you${e ? ` to ${e.title}` : ''}. It’s free: add it to your tickets for the QR code at the door.`}
        </Txt>
      ) : gift.message ? (
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Txt variant="small" color={colors.muted}>
            From {gift.from}:
          </Txt>
          <Txt variant="h3" style={{ textAlign: 'center', fontStyle: 'italic' }}>
            “{gift.message}”
          </Txt>
        </View>
      ) : (
        <Txt color={colors.muted}>From {gift.from}, with love.</Txt>
      )}

      {e ? (
        <View style={styles.ticket}>
          {e.imageUrl ? <Image source={{ uri: e.imageUrl }} style={styles.ticketImage} contentFit="cover" /> : null}
          {/* The tier's band, in its look */}
          <TierSurface look={look} edge="top" style={{ borderWidth: 0 }}>
            <View style={styles.band}>
              <TierGlyph look={look} size={18} />
              <Txt variant="title" color={look.ink} numberOfLines={1} style={{ flex: 1 }}>
                {qty} × {gift.ticketType?.name ?? 'Ticket'}
              </Txt>
              {gift.ticketType?.badge ? <TierBadge label={gift.ticketType.badge} look={look} /> : null}
            </View>
          </TierSurface>
          <View style={{ padding: space.xl, gap: 4 }}>
            <Txt variant="h2" color={colors.ink}>
              {e.title}
            </Txt>
            <Txt variant="small" color={colors.inkMuted}>
              {when(e.startsAt).date} · {when(e.startsAt).time}
            </Txt>
            <Txt variant="small" color={colors.inkMuted}>
              {e.online ? 'Online event' : [e.venue?.name, e.venue?.city].filter(Boolean).join(', ')}
            </Txt>
            {gift.seats?.length ? (
              <Txt variant="smallStrong" color={colors.ink} style={{ marginTop: 4 }}>
                {gift.seats.map((s) => [s.sectionName, s.row ? `Row ${s.row}` : '', s.seat ? `Seat ${s.seat}` : ''].filter(Boolean).join(' · ')).join('\n')}
              </Txt>
            ) : null}
            {gift.totalCents !== undefined && gift.currency && !gift.comp ? (
              <Txt variant="small" color={colors.inkMuted}>
                Worth {money(gift.totalCents, gift.currency)}
              </Txt>
            ) : null}
            {gift.ticketType?.perks?.length ? (
              <Txt variant="small" color={colors.inkMuted}>
                {gift.ticketType.perks.join(' · ')}
              </Txt>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={{ width: '100%', gap: space.md }}>
        {claim.kind === 'done' ? (
          <Notice tone="success" icon="check" title={claim.already ? 'Already in your tickets' : 'It’s in your tickets!'}>
            {`Your ${tickets} to ${title} ${qty === 1 ? 'is' : 'are'} in My tickets. The QR code for the door shows there.`}
          </Notice>
        ) : claim.kind === 'own' ? (
          <Notice tone="warning" icon="gift" title="This is the gift you sent">
            {`A gift can’t go into the account that bought it. Send this link to ${gift.to} so they can open it and add the tickets to their own account.`}
          </Notice>
        ) : claim.kind === 'empty' ? (
          <Notice tone="warning" icon="alert" title="There are no tickets left in this gift">
            {`${firstName(gift.from)} may have taken them back. It’s worth asking them about it.`}
          </Notice>
        ) : null}

        {claim.kind === 'done' ? (
          <>
            <Button label="Go to My tickets" icon="ticket" onPress={() => router.replace('/tickets')} />
            {e ? <Button label="See the event" variant="ghost" onPress={() => router.push({ pathname: '/event/[slug]', params: { slug: e.slug } })} /> : null}
          </>
        ) : claim.kind === 'own' ? (
          <Button label="Manage it in My tickets" variant="ghost" onPress={() => router.replace('/tickets')} />
        ) : claim.kind === 'empty' ? null : user ? (
          <>
            <Button label={claim.kind === 'busy' ? 'Adding to your tickets…' : 'Add to my tickets'} loading={claim.kind === 'busy'} onPress={add} />
            <Txt variant="small" color={colors.dim} style={{ textAlign: 'center' }}>
              Adds {qty === 1 ? 'it' : 'them'} to <Txt variant="smallStrong">{user.email}</Txt>.{' '}
              <Txt variant="smallStrong" color={colors.accent} onPress={() => void signOut()} accessibilityRole="button">
                Not you?
              </Txt>
            </Txt>
          </>
        ) : (
          <>
            <Button label="Sign in to add to your tickets" onPress={() => router.push({ pathname: '/sign-in', params: { then: `/gift/${token}` } })} />
            <Txt variant="small" color={colors.dim} style={{ textAlign: 'center' }}>
              New to Eventro? You can create a free account on the next step. Any email works: the link is what counts.
            </Txt>
          </>
        )}
        {claim.kind === 'error' ? <Notice tone="warning">{claim.message}</Notice> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { width: '100%', alignItems: 'center', gap: space.lg, paddingTop: space.xl },
  box: { width: 132, height: 132, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginVertical: space.lg, overflow: 'hidden' },
  ribbonV: { position: 'absolute', width: 18, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.22)' },
  ribbonH: { position: 'absolute', height: 18, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.22)' },
  doneIcon: { width: 72, height: 72, borderRadius: 22, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  ticket: { width: '100%', borderRadius: radius.panel, overflow: 'hidden', backgroundColor: colors.paper },
  ticketImage: { width: '100%', height: 150, backgroundColor: '#ddd' },
  band: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.md },
});
