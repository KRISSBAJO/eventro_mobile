/**
 * A ticket tier's look (see lib/tiers.ts): the gradient, ink and glyph a tier wears on the event page, at checkout,
 * in the wallet and in orders. Premium looks are clearly special; Special VIP is holographic with a static sheen
 * (no animation). Text sits in the look's ink, chosen for contrast on its gradient.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptic } from '@/lib/haptics';
import { lookOf, TIER_LOOK_KEYS, TIER_LOOKS, type TierLook, type TierLookDef } from '@/lib/tiers';
import { colors, font, radius, space } from '@/theme';
import { Icon } from './icons';
import { Txt } from './ui';

export type TierLike = { name: string; style?: string | null; look?: string | null; badge?: string | null; perks?: string[] };

/** The tier's glyph in its ink. */
export function TierGlyph({ look, size = 16, color }: { look: TierLookDef; size?: number; color?: string }) {
  return <Icon name={look.glyph} size={size} color={color ?? look.ink} strokeWidth={2.2} />;
}

/** The static holographic sheen laid over Special VIP. */
function Sheen() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
      locations={[0.28, 0.48, 0.68]}
      start={{ x: 0, y: 0.15 }}
      end={{ x: 1, y: 0.85 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

/**
 * The look's gradient as a background, with General's border and orange edge line and Special VIP's sheen.
 * `edge` says where General's orange line goes.
 */
export function TierSurface({ look, style, edge = 'left', children }: { look: TierLookDef; style?: StyleProp<ViewStyle>; edge?: 'left' | 'top'; children?: ReactNode }) {
  return (
    <View style={[{ overflow: 'hidden' }, look.border ? { borderWidth: 1, borderColor: look.border } : null, style]}>
      <LinearGradient colors={look.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Early bird and Table start light: a dark wash from the top-left keeps white text readable (as on the website). */}
      {look.scrim ? <LinearGradient pointerEvents="none" colors={[look.scrim, 'rgba(0,0,0,0)']} locations={[0, 0.75]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {look.sheen ? <Sheen /> : null}
      {look.edge ? <View pointerEvents="none" style={[edge === 'left' ? styles.edgeLeft : styles.edgeTop, { backgroundColor: look.edge }]} /> : null}
      {children}
    </View>
  );
}

/** A small pill in the tier's look: glyph and tier name (ticket rows, checkout, orders). */
export function TierChip({ tier, label, size = 'sm', style }: { tier: TierLike; label?: string; size?: 'sm' | 'md'; style?: StyleProp<ViewStyle> }) {
  const look = lookOf(tier);
  const md = size === 'md';
  return (
    <TierSurface look={look} edge="left" style={[styles.chip, style]}>
      <View style={[styles.chipInner, md && styles.chipInnerMd]} accessible accessibilityLabel={`${label ?? tier.name} ticket`}>
        <TierGlyph look={look} size={md ? 15 : 13} />
        <Txt variant={md ? 'smallStrong' : 'tiny'} color={look.ink} numberOfLines={1} style={[{ flexShrink: 1 }, !md && { fontFamily: font.body.bold }]}>
          {label ?? tier.name}
        </Txt>
      </View>
    </TierSurface>
  );
}

/** A tier's badge ("Most popular") on its gradient: dark glass so it reads on every look. */
export function TierBadge({ label, look }: { label: string; look: TierLookDef }) {
  const dark = look.ink !== '#ffffff' && look.ink !== '#f7f2f2';
  return (
    <View style={[styles.badge, dark ? { backgroundColor: 'rgba(255,255,255,0.55)', borderColor: 'rgba(0,0,0,0.12)' } : { backgroundColor: 'rgba(0,0,0,0.28)', borderColor: 'rgba(255,255,255,0.22)' }]}>
      <Txt variant="tiny" color={look.ink} numberOfLines={1} style={{ fontFamily: font.body.bold }}>
        {label}
      </Txt>
    </View>
  );
}

/** The ticket-shaped preview the organizer sees while picking a look, updated live. */
export function MiniTicket({ name, look, badge, price, perks = 0 }: { name: string; look: TierLook; badge?: string; price?: string; perks?: number }) {
  const l = TIER_LOOKS[look];
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={styles.liveDot} />
        <Txt variant="eyebrow" color={colors.muted}>
          Live preview · how fans see it
        </Txt>
      </View>
      <TierSurface look={l} edge="left" style={[styles.mini, l.premium && styles.miniGlow, { shadowColor: l.colors[l.colors.length - 1] }]}>
        <View style={styles.miniBody} accessible accessibilityLabel={`Preview: ${name || 'Ticket'}, ${l.name} look${badge ? `, ${badge}` : ''}${price ? `, ${price}` : ''}`}>
          <View style={[styles.miniGlyph, { borderColor: l.ink === '#f7f2f2' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)', backgroundColor: l.ink === '#ffffff' || l.ink === '#f7f2f2' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.4)' }]}>
            <TierGlyph look={l} size={18} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title" color={l.ink} numberOfLines={1}>
              {name.trim() || 'Ticket name'}
            </Txt>
            <Txt variant="tiny" color={l.inkSoft} numberOfLines={1}>
              {perks ? `${perks} ${perks === 1 ? 'perk' : 'perks'} included` : 'Admit one'}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {badge ? <TierBadge label={badge} look={l} /> : null}
            {price ? (
              <Txt variant="price" color={l.ink} numberOfLines={1}>
                {price}
              </Txt>
            ) : null}
          </View>
        </View>
        {/* the ticket's notches */}
        <View style={[styles.notch, { left: -9 }]} />
        <View style={[styles.notch, { right: -9 }]} />
      </TierSurface>
    </View>
  );
}

/** One swatch of the look picker. */
function Swatch({ look, on, auto, marked, label, onPress }: { look: TierLookDef; on: boolean; auto?: boolean; marked?: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.swatchWrap, pressed && { transform: [{ scale: 0.95 }] }]}>
      <View style={[styles.swatchRing, on && styles.swatchRingOn]}>
        <TierSurface look={look} edge="top" style={styles.swatch}>
          <View style={styles.swatchCenter}>
            <TierGlyph look={look} size={15} />
          </View>
        </TierSurface>
        {on ? (
          <View style={styles.swatchCheck}>
            <Icon name="check" size={9} color={colors.accentInk} strokeWidth={3} />
          </View>
        ) : null}
        {marked ? (
          <View style={styles.autoMark} pointerEvents="none">
            <Txt variant="tiny" color={colors.text} style={{ fontSize: 8, lineHeight: 10, fontFamily: font.body.bold, letterSpacing: 0.4 }}>
              AUTO
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt variant="tiny" color={on ? colors.text : colors.muted} numberOfLines={1} style={{ textAlign: 'center' }}>
        {auto ? 'Auto' : look.name.replace(' / group', '')}
      </Txt>
    </Pressable>
  );
}

/**
 * Auto plus the six looks. Auto follows the tier's name; the look Auto would pick is marked "auto" among the six,
 * so the organizer can see what they'd get without choosing.
 */
export function LookPicker({ value, auto, onChange }: { value: TierLook | null; auto: TierLook; onChange: (v: TierLook | null) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm }}>
        <Txt variant="smallStrong" color={colors.muted}>
          Look
        </Txt>
        <Txt variant="tiny" color={colors.dim} numberOfLines={1} style={{ flexShrink: 1 }}>
          {value ? `${TIER_LOOKS[value].name} · picked by you` : `Auto: ${TIER_LOOKS[auto].name}, from the name`}
        </Txt>
      </View>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Ticket look">
        <Swatch look={TIER_LOOKS[auto]} auto on={value === null} label={`Auto, from the name (${TIER_LOOKS[auto].name})`} onPress={() => onChange(null)} />
        {TIER_LOOK_KEYS.map((k) => (
          <Swatch key={k} look={TIER_LOOKS[k]} on={value === k} marked={k === auto} label={`${TIER_LOOKS[k].name}${k === auto ? ' (what Auto picks)' : ''}`} onPress={() => onChange(k)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  edgeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  edgeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 3 },
  chip: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: radius.pill },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 10, paddingVertical: 4 },
  chipInnerMd: { paddingLeft: 11, paddingRight: 12, paddingVertical: 6 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  mini: { borderRadius: radius.md },
  miniGlow: { shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  miniBody: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, paddingLeft: space.lg + 2, paddingRight: space.lg + 2 },
  miniGlyph: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notch: { position: 'absolute', top: '50%', marginTop: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatchWrap: { width: 52, alignItems: 'center', gap: 6 },
  swatchRing: { padding: 2, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  swatchRingOn: { borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  swatch: { width: 40, height: 40, borderRadius: 10 },
  swatchCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  swatchCheck: { position: 'absolute', right: -4, top: -4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.bg2 },
  autoMark: { position: 'absolute', bottom: -6, left: 6, right: 6, alignItems: 'center', paddingVertical: 1, borderRadius: 4, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.accentLine },
});
