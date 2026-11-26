/**
 * Event cards, kept plain so the photo does the talking: a large card for the Discover rails (photo, then name, date,
 * place and price) and a compact row for search results. Events with more than one date show their next date and
 * "+2 more dates" / "3 days" (lib/dates.ts cardWhen).
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { WEB_URL } from '@/lib/api';
import { cardWhen } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { cityOnly, distanceLabel, money, when } from '@/lib/format';
import type { EventCard as Ev } from '@/lib/types';
import { colors, radius, space } from '@/theme';
import { HeartButton } from './heart';
import { Icon } from './icons';
import { Skeleton, Txt } from './ui';

const open = (slug: string) => {
  haptic.select();
  router.push({ pathname: '/event/[slug]', params: { slug } });
};

const where = (e: Ev) => [e.venue, cityOnly(e.city)].filter(Boolean).join(' · ') || 'Online';
const hasResale = (e: Ev) => (e.resaleCount ?? 0) > 0;
const a11y = (e: Ev) =>
  `${e.title}, ${e.subtitle}. ${when(cardWhen(e).startsAt).date} at ${when(cardWhen(e).startsAt).time}${cardWhen(e).more ? `, ${cardWhen(e).more}` : ''}. ${where(e)}. From ${money(e.fromCents, e.currency)}.${hasResale(e) ? ' Fan resale tickets available.' : ''}`;

/** Fans are selling tickets for this event (GET /events → resaleCount). `glass` sits on the image. */
function ResaleBadge({ glass }: { glass?: boolean }) {
  return (
    <View style={[styles.resale, glass && styles.resaleGlass]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="tag" size={11} color={colors.accentHi} strokeWidth={2.4} />
      <Txt variant="tiny" color={glass ? colors.onImage : colors.accentHi} numberOfLines={1}>
        Resale
      </Txt>
    </View>
  );
}

/**
 * A full-width card for a short list (Last minute on Discover): a wide photo, then the name with Share and the heart
 * beside it, the date and place, and the price.
 */
export function WideEventCard({ e }: { e: Ev }) {
  const cw = cardWhen(e);
  const d = when(cw.startsAt);
  const share = () => {
    haptic.tap();
    const url = `${WEB_URL}/events/${e.slug}`;
    Share.share(Platform.OS === 'ios' ? { message: `${e.title} on Omoshow`, url } : { message: `${e.title} on Omoshow: ${url}` }).catch(() => undefined);
  };
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(e)} onPress={() => open(e.slug)} style={({ pressed }) => pressed && { opacity: 0.9 }}>
      <View style={styles.wideMedia}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={e.slug} />
      </View>
      <View style={styles.wideMeta}>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="h3" numberOfLines={2}>
            {e.title}
          </Txt>
          <Txt variant="body" color={colors.muted} numberOfLines={1}>
            {d.short} · {d.time} · {e.venue || 'Online'}
          </Txt>
          <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
            {e.fromCents === 0 ? 'Free' : `From ${money(e.fromCents, e.currency)}`}
            {cw.more ? (
              <Txt variant="small" color={colors.muted}>
                {`  ·  ${cw.more}`}
              </Txt>
            ) : null}
          </Txt>
        </View>
        <View style={styles.wideActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Share ${e.title}`} hitSlop={8} onPress={share} style={({ pressed }) => [styles.wideAction, pressed && { opacity: 0.6 }]}>
            <Icon name="share" size={17} color={colors.text} />
          </Pressable>
          <HeartButton card={e} size={36} />
        </View>
      </View>
    </Pressable>
  );
}

export function WideCardSkeleton() {
  return (
    <View>
      <Skeleton height={190} radius={radius.card} />
      <View style={{ gap: 6, paddingTop: space.md }}>
        <Skeleton height={20} width="80%" />
        <Skeleton height={14} width="55%" />
      </View>
    </View>
  );
}

export function LargeEventCard({ e, width = 260, distanceKm }: { e: Ev; width?: number; distanceKm?: number | null }) {
  const cw = cardWhen(e);
  const d = when(cw.startsAt);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(e)} onPress={() => open(e.slug)} style={({ pressed }) => [{ width }, pressed && { opacity: 0.85 }]}>
      <View style={styles.largeMedia}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={e.slug} />
        <View style={styles.largeHeart}>
          <HeartButton card={e} glass size={34} />
        </View>
      </View>
      <View style={styles.largeMeta}>
        <Txt variant="title" numberOfLines={1}>
          {e.title}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {d.short} · {d.time}
          {cw.more ? ` · ${cw.more}` : ''}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {distanceKm != null ? `${distanceLabel(distanceKm)} · ` : ''}
          {where(e)}
        </Txt>
        <Txt variant="smallStrong" style={{ marginTop: 2 }}>
          {e.fromCents === 0 ? 'Free' : `From ${money(e.fromCents, e.currency)}`}
          {hasResale(e) ? (
            <Txt variant="small" color={colors.muted}>
              {'  ·  Resale'}
            </Txt>
          ) : null}
        </Txt>
      </View>
    </Pressable>
  );
}

export function CompactEventCard({ e }: { e: Ev }) {
  const cw = cardWhen(e);
  const d = when(cw.startsAt);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(e)} onPress={() => open(e.slug)} style={({ pressed }) => [styles.compact, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.thumb}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={e.slug} />
      </View>
      <View style={{ flex: 1, gap: 3, justifyContent: 'center' }}>
        <Txt variant="title" numberOfLines={1}>
          {e.title}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={1}>
          {d.short} · {d.time}
          {cw.more ? ` · ${cw.more}` : ''}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={e.venue ? 'pin' : 'stream'} size={13} color={colors.dim} />
          <Txt variant="small" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
            {e.distanceKm != null ? `${distanceLabel(e.distanceKm)} · ` : ''}
            {where(e)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 1 }}>
          {e.fromCents === 0 ? (
            <Txt variant="title">Free</Txt>
          ) : (
            <>
              <Txt variant="small" color={colors.dim}>
                From
              </Txt>
              <Txt variant="title">{money(e.fromCents, e.currency)}</Txt>
            </>
          )}
          {/* With a price filter in the visitor's currency, the API converts the price too (approximate). */}
          {e.fromCentsIn && e.fromCentsIn.currency !== e.currency ? (
            <Txt variant="tiny" color={colors.muted} accessibilityLabel={`about ${money(e.fromCentsIn.cents, e.fromCentsIn.currency)}`}>
              ≈ {money(e.fromCentsIn.cents, e.fromCentsIn.currency)}
            </Txt>
          ) : null}
          {hasResale(e) ? (
            <View style={{ alignSelf: 'center', marginLeft: 2 }}>
              <ResaleBadge />
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ justifyContent: 'center' }}>
        <HeartButton card={e} size={34} />
      </View>
    </Pressable>
  );
}

export function LargeCardSkeleton({ width = 280 }: { width?: number }) {
  return (
    <View style={{ width, gap: space.md }}>
      <Skeleton height={width * 0.8} radius={radius.card} />
      <Skeleton height={14} width="70%" />
      <Skeleton height={12} width="45%" />
    </View>
  );
}

export function CompactCardSkeleton() {
  return (
    <View style={styles.compact}>
      <Skeleton width={86} height={86} radius={radius.md} />
      <View style={{ flex: 1, gap: 8, justifyContent: 'center' }}>
        <Skeleton height={10} width="40%" />
        <Skeleton height={15} width="75%" />
        <Skeleton height={12} width="55%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  largeMedia: { aspectRatio: 1.25, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2 },
  largeHeart: { position: 'absolute', top: 10, right: 10 },
  largeMeta: { gap: 2, paddingTop: space.md },
  wideMedia: { aspectRatio: 2, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2 },
  wideMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingTop: space.md },
  wideActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: -2 },
  wideAction: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  resale: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  resaleGlass: { marginBottom: 5, backgroundColor: colors.glass, borderColor: 'rgba(255,106,92,0.45)' },
  compact: {
    flexDirection: 'row',
    gap: space.md,
    // Lists offset by this padding, so the photo lines up with the page edge and the pressed tint has room.
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    minHeight: 100,
    marginBottom: space.xs,
  },
  thumb: { width: 86, height: 86, alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
});
