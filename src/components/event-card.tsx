/** Event cards: a large image card for the Discover rails and a compact row for search results. */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { CATEGORY_NAME, cityOnly, distanceLabel, money, when } from '@/lib/format';
import type { EventCard as Ev } from '@/lib/types';
import { colors, radius, shadow, space } from '@/theme';
import { Icon } from './icons';
import { Badge, Skeleton, Txt } from './ui';

const open = (slug: string) => {
  haptic.select();
  router.push({ pathname: '/event/[slug]', params: { slug } });
};

const where = (e: Ev) => [e.venue, cityOnly(e.city)].filter(Boolean).join(' · ') || 'Online';
const a11y = (e: Ev) => `${e.title}, ${e.subtitle}. ${when(e.startsAt).date} at ${when(e.startsAt).time}. ${where(e)}. From ${money(e.fromCents, e.currency)}.`;

function DateTile({ iso }: { iso: string }) {
  const d = when(iso);
  return (
    <View style={styles.dateTile}>
      <Txt variant="eyebrow" color={colors.accent} style={{ fontSize: 10, lineHeight: 12 }}>
        {d.month}
      </Txt>
      <Txt variant="h3" style={{ lineHeight: 21 }}>
        {d.day}
      </Txt>
    </View>
  );
}

export function LargeEventCard({ e, width = 280, distanceKm }: { e: Ev; width?: number; distanceKm?: number | null }) {
  const d = when(e.startsAt);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(e)} onPress={() => open(e.slug)} style={({ pressed }) => [{ width }, pressed && { transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.largeMedia, shadow.card]}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={e.slug} />
        <LinearGradient colors={[colors.fade0, colors.fade]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.largeTop}>
          <DateTile iso={e.startsAt} />
          <Badge label={CATEGORY_NAME[e.category] ?? e.category} tone="glass" />
        </View>
        <View style={styles.largeBottom}>
          <Txt variant="h3" numberOfLines={1}>
            {e.title}
          </Txt>
          <Txt variant="small" color="rgba(247,242,242,0.8)" numberOfLines={1}>
            {e.subtitle}
          </Txt>
        </View>
      </View>
      <View style={styles.largeMeta}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="smallStrong" numberOfLines={1}>
            {d.short} · {d.time}
          </Txt>
          <Txt variant="small" color={colors.muted} numberOfLines={1}>
            {distanceKm != null ? `${distanceLabel(distanceKm)} · ` : ''}
            {where(e)}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt variant="tiny" color={colors.dim}>
            From
          </Txt>
          <Txt variant="price">{money(e.fromCents, e.currency)}</Txt>
        </View>
      </View>
    </Pressable>
  );
}

export function CompactEventCard({ e }: { e: Ev }) {
  const d = when(e.startsAt);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(e)} onPress={() => open(e.slug)} style={({ pressed }) => [styles.compact, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.thumb}>
        <Image source={e.imageUrl ? { uri: e.imageUrl } : null} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={e.slug} />
      </View>
      <View style={{ flex: 1, gap: 3, justifyContent: 'center' }}>
        <Txt variant="eyebrow" color={colors.accent} numberOfLines={1}>
          {d.short} · {d.time}
        </Txt>
        <Txt variant="title" numberOfLines={1}>
          {e.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="pin" size={13} color={colors.dim} />
          <Txt variant="small" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
            {e.distanceKm != null ? `${distanceLabel(e.distanceKm)} · ` : ''}
            {where(e)}
          </Txt>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
        <Txt variant="tiny" color={colors.dim}>
          From
        </Txt>
        <Txt variant="title">{money(e.fromCents, e.currency)}</Txt>
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
      <Skeleton width={76} height={76} radius={radius.md} />
      <View style={{ flex: 1, gap: 8, justifyContent: 'center' }}>
        <Skeleton height={10} width="40%" />
        <Skeleton height={15} width="75%" />
        <Skeleton height={12} width="55%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  largeMedia: { aspectRatio: 1.5, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  largeTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  largeBottom: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 1 },
  largeMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingTop: space.md, paddingHorizontal: 2 },
  dateTile: { width: 44, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center' },
  compact: { flexDirection: 'row', gap: space.md, padding: space.sm, borderRadius: radius.card, minHeight: 92 },
  thumb: { width: 76, height: 76, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 },
});
