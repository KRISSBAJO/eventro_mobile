/** Pieces the organizer screens share: the screen frame, number tiles, sales bars, progress, status and web links. */
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { num } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { openWeb, STATUS_TONE, type EventStatus } from '@/lib/organizer';
import { colors, gutter, radius, space, touch } from '@/theme';
import { Icon, type IconName } from './icons';
import { Badge, Button, IconButton, Txt } from './ui';

/** A scrolling organizer screen with a back button, title and pull-to-refresh. */
export function OrgScreen({
  title,
  eyebrow,
  fallback = '/organizer',
  onRefresh,
  right,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  fallback?: Href;
  onRefresh?: () => Promise<unknown>;
  right?: ReactNode;
  children: ReactNode;
  /** pinned under the scroll area (the screen's one primary action) */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: footer ? space.xl : insets.bottom + space.huge, gap: space.lg }}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={pulling}
              onRefresh={async () => {
                setPulling(true);
                await onRefresh().catch(() => undefined);
                setPulling(false);
              }}
              tintColor={colors.accent}
            />
          ) : undefined
        }>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))} />
          <View style={{ flex: 1, gap: 2 }}>
            {eyebrow ? (
              <Txt variant="eyebrow" color={colors.accent} numberOfLines={1}>
                {eyebrow}
              </Txt>
            ) : null}
            <Txt variant="h2" accessibilityRole="header" numberOfLines={2}>
              {title}
            </Txt>
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View> : null}
    </View>
  );
}

/** A big number with a label. */
export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'accent' | 'success' }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Txt variant="eyebrow" color={colors.dim} numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="priceLg" color={tone === 'accent' ? colors.accent : tone === 'success' ? colors.success : colors.text} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
      {sub ? (
        <Txt variant="small" color={colors.muted} numberOfLines={2}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

/** Two tiles side by side. */
export const TileRow = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', gap: space.md }}>{children}</View>;

/** Tickets sold per day as bars (oldest first); empty days are short stubs. */
export function SalesBars({ days, label }: { days: { date: string; tickets: number }[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.tickets));
  const total = days.reduce((s, d) => s + d.tickets, 0);
  return (
    <View accessible accessibilityLabel={`${label}: ${num(total)} tickets`} style={{ gap: space.sm }}>
      <View style={styles.bars}>
        {days.map((d) => (
          <View key={d.date} style={{ flex: 1, justifyContent: 'flex-end', height: '100%' }}>
            <View style={{ height: d.tickets ? `${Math.max(6, (d.tickets / max) * 100)}%` : 2, borderRadius: 3, backgroundColor: d.tickets ? colors.accent : colors.line2 }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="tiny" color={colors.dim}>
          {shortDate(days[0]?.date)}
        </Txt>
        <Txt variant="tiny" color={colors.dim}>
          Today
        </Txt>
      </View>
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd?: string) => (ymd ? `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}` : '');

/** A thin bar showing how full something is. */
export function Progress({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'success' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={styles.track}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: tone === 'success' ? colors.success : colors.accent }} />
    </View>
  );
}

export const StatusBadge = ({ status }: { status: EventStatus }) => <Badge label={status} tone={STATUS_TONE[status]} />;

/** "Open on the web" for the things that stay on the website. */
export function WebButton({ label = 'Open on the web', path, variant = 'ghost' }: { label?: string; path: string; variant?: 'ghost' | 'primary' | 'subtle' }) {
  return <Button label={label} variant={variant} size="md" iconRight="external" onPress={() => openWeb(path)} />;
}

/** A large square action: Scan, Pause, Share, Edit. */
export function ActionTile({ icon, label, onPress, disabled, tone }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; tone?: 'accent' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.action, disabled && { opacity: 0.4 }, pressed && { backgroundColor: colors.surface2, transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.actionIcon, tone === 'accent' && { backgroundColor: colors.accent }]}>
        <Icon name={icon} size={20} color={tone === 'accent' ? colors.accentInk : colors.text} />
      </View>
      <Txt variant="smallStrong" numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** A card-styled group of rows. */
export const Group = ({ children }: { children: ReactNode }) => <View style={styles.group}>{children}</View>;

/** An eyebrow label above a block. */
export const Label = ({ children }: { children: string }) => (
  <Txt variant="eyebrow" color={colors.dim}>
    {children}
  </Txt>
);

const styles = StyleSheet.create({
  footer: { paddingHorizontal: gutter, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line2, backgroundColor: colors.bg },
  tile: { flex: 1, gap: 4, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, minWidth: 0 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 72 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  action: { flex: 1, minWidth: 0, minHeight: touch + 44, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  group: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
});
