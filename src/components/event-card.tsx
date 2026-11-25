/**
 * Event cards: a large image card for the Discover rails and a compact row for search results. Events with more than
 * one date show their next date and "+2 more dates" / "3 days" (lib/dates.ts cardWhen).
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { cardWhen } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { CATEGORY_NAME, cityOnly, distanceLabel, money, when } from '@/lib/format';
import type { EventCard as Ev } from '@/lib/types';
import { colors, radius, space } from '@/theme';
import { HeartButton } from './heart';
import { Icon } from './icons';
import { Badge, Skeleton, Txt } from './ui';

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

function DateTile({ iso }: { iso: string }) {
  const d = when(iso);
  return (
    <View style={styles.dateTile}>
      <Txt variant="eyebrow" color={colors.accent} style={{ fontSize: 10, lineHeight: 12 }}>
        {d.month}
      </Txt>
      <Txt variant="h3" color={colors.onImage} style={{ lineHeight: 21 }}>
        {d.day}
      </Txt>
    </View>
  );
}

export function LargeEventCard({ e, width = 280, distanceKm }: { e: Ev; width?: number; distanceKm?: number | null }) {
  const cw = cardWhen(e);
  const d = when(cw.startsAt);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={a11y(e)}
      onPress={() => open(e.slug)}
      style={({ pressed }) => [styles.largeCard, { width }, pressed && { transform: [{ scale: 0.98 }], borderColor: colors.line2 }]}>
      <View style={styles.largeMedia}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={e.slug} />
        <LinearGradient colors={[colors.fade0, colors.fade]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.largeTop}>
          <DateTile iso={cw.startsAt} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={CATEGORY_NAME[e.category] ?? e.category} tone="glass" />
            <HeartButton card={e} glass size={34} />
          </View>
        </View>
        <View style={styles.largeBottom}>
          {hasResale(e) ? <ResaleBadge glass /> : null}
          <Txt variant="h3" color={colors.onImage} numberOfLines={1}>
            {e.title}
          </Txt>
          <Txt variant="small" color={colors.onImageSoft} numberOfLines={1}>
            {e.subtitle}
          </Txt>
        </View>
      </View>
      <View style={styles.largeMeta}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="smallStrong" numberOfLines={1}>
            {d.short} · {d.time}
            {cw.more ? (
              <Txt variant="small" color={colors.muted}>
                {` · ${cw.more}`}
              </Txt>
            ) : null}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name={e.venue ? 'pin' : 'stream'} size={13} color={colors.dim} />
            <Txt variant="small" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
              {distanceKm != null ? `${distanceLabel(distanceKm)} · ` : ''}
              {where(e)}
            </Txt>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt variant="eyebrow" color={colors.dim} style={{ fontSize: 10, lineHeight: 12 }}>
            From
          </Txt>
          <Txt variant="price" color={colors.accent}>
            {money(e.fromCents, e.currency)}
          </Txt>
        </View>
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
        <Txt variant="eyebrow" color={colors.accent} numberOfLines={1}>
          {d.short} · {d.time}
          {cw.more ? ` · ${cw.more}` : ''}
        </Txt>
        <Txt variant="title" numberOfLines={1}>
          {e.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={e.venue ? 'pin' : 'stream'} size={13} color={colors.dim} />
          <Txt variant="small" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
            {e.distanceKm != null ? `${distanceLabel(e.distanceKm)} · ` : ''}
            {where(e)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 1 }}>
          <Txt variant="small" color={colors.dim}>
            From
          </Txt>
          <Txt variant="title">{money(e.fromCents, e.currency)}</Txt>
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
      <Skeleton height={width * 0.66} radius={radius.card} />
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
  largeCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  largeMedia: { aspectRatio: 1.5, overflow: 'hidden', backgroundColor: colors.surface2 },
  largeTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  largeBottom: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 1 },
  resale: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  resaleGlass: { marginBottom: 5, backgroundColor: colors.glass, borderColor: 'rgba(255,106,92,0.45)' },
  largeMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingVertical: space.md, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: colors.line },
  dateTile: { width: 44, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center' },
  compact: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.card,
    minHeight: 104,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  thumb: { width: 86, height: 86, alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
});
