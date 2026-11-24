/** The app's small design system: text, buttons, chips, fields, notices, skeletons and empty states. */
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { haptic } from '@/lib/haptics';
import { colors, radius, space, touch, type, type TypeName } from '@/theme';
import { Icon, type IconName } from './icons';

/* ---------- text ---------- */

export function Txt({ variant = 'body', color, style, ...rest }: TextProps & { variant?: TypeName; color?: string }) {
  return <Text {...rest} style={[type[variant] as TextStyle, { color: color ?? colors.text }, style]} />;
}

/* ---------- buttons ---------- */

type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
  size?: 'md' | 'lg' | 'sm';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  /** haptic on press (default: a light tap for primary buttons) */
  feedback?: 'tap' | 'firm' | 'select' | false;
};

export function Button({ label, variant = 'primary', size = 'lg', icon, iconRight, loading, block, disabled, style, feedback, onPress, ...rest }: ButtonProps) {
  const off = disabled || loading;
  const fg = variant === 'primary' ? colors.accentInk : variant === 'danger' ? colors.accent : colors.text;
  const h = size === 'lg' ? 54 : size === 'md' ? 46 : 38;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={(e) => {
        const fb = feedback ?? (variant === 'primary' ? 'tap' : false);
        if (fb) haptic[fb]();
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.btn,
        { height: h, paddingHorizontal: size === 'sm' ? 14 : 20 },
        variant === 'primary' && styles.btnPrimary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'subtle' && styles.btnSubtle,
        variant === 'danger' && styles.btnDanger,
        block && { alignSelf: 'stretch' },
        off && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        style,
      ]}
      {...rest}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 19} color={fg} /> : null}
      <Txt variant={size === 'sm' ? 'smallStrong' : 'button'} color={fg} numberOfLines={1}>
        {label}
      </Txt>
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'sm' ? 16 : 19} color={fg} /> : null}
    </Pressable>
  );
}

/** A round icon-only button (back, share, close). `glass` sits on top of images. */
export function IconButton({ icon, label, onPress, glass, size = touch, color = colors.text, style }: { icon: IconName; label: string; onPress: () => void; glass?: boolean; size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' },
        glass ? styles.glass : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2 },
        pressed && { opacity: 0.75, transform: [{ scale: 0.95 }] },
        style,
      ]}>
      <Icon name={icon} size={Math.round(size * 0.45)} color={color} />
    </Pressable>
  );
}

/** A pill you can toggle: categories, filters. */
export function Chip({ label, active, onPress, icon, accessibilityLabel }: { label: string; active?: boolean; onPress: () => void; icon?: IconName; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && { opacity: 0.8 }]}>
      {icon ? <Icon name={icon} size={15} color={active ? colors.accentInk : colors.muted} /> : null}
      <Txt variant="smallStrong" color={active ? colors.accentInk : colors.text} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** A small status label. */
export function Badge({ label, tone = 'plain', style }: { label: string; tone?: 'plain' | 'accent' | 'success' | 'warning' | 'glass'; style?: StyleProp<ViewStyle> }) {
  const t = {
    plain: { bg: colors.surface2, border: colors.line2, fg: colors.text },
    accent: { bg: colors.accentSoft, border: colors.accentLine, fg: colors.accentHi },
    success: { bg: colors.successSoft, border: colors.successLine, fg: colors.success },
    warning: { bg: colors.warningSoft, border: 'rgba(245,165,36,0.35)', fg: colors.warning },
    glass: { bg: colors.glass, border: 'rgba(255,255,255,0.16)', fg: colors.text },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      <Txt variant="tiny" color={t.fg} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/* ---------- layout ---------- */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1, gap: 4 }}>
        {eyebrow ? (
          <Txt variant="eyebrow" color={colors.accent}>
            {eyebrow}
          </Txt>
        ) : null}
        <Txt variant="h2" accessibilityRole="header">
          {title}
        </Txt>
      </View>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10} style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.6 }]}>
          <Txt variant="smallStrong" color={colors.muted}>
            {action}
          </Txt>
          <Icon name="chevronRight" size={15} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const Divider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line2 }, style]} />;

/* ---------- notices ---------- */

export function Notice({ tone = 'accent', icon, title, children, action, onAction }: { tone?: 'accent' | 'plain' | 'success' | 'warning'; icon?: IconName; title?: string; children?: ReactNode; action?: string; onAction?: () => void }) {
  const t = {
    accent: { bg: colors.accentSoft, border: colors.accentLine, fg: colors.accent },
    plain: { bg: colors.surface, border: colors.line2, fg: colors.muted },
    success: { bg: colors.successSoft, border: colors.successLine, fg: colors.success },
    warning: { bg: colors.warningSoft, border: 'rgba(245,165,36,0.35)', fg: colors.warning },
  }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <Icon name={icon} size={18} color={t.fg} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Txt variant="smallStrong">{title}</Txt> : null}
        {typeof children === 'string' ? (
          <Txt variant="small" color={colors.muted}>
            {children}
          </Txt>
        ) : (
          children
        )}
        {action && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Txt variant="smallStrong" color={t.fg}>
              {action}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function EmptyState({ icon = 'sparkle', title, body, action, onAction, compact }: { icon?: IconName; title: string; body?: string; action?: string; onAction?: () => void; compact?: boolean }) {
  return (
    <View style={[styles.empty, compact && { paddingVertical: space.xxl }]}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={24} color={colors.accent} />
      </View>
      <Txt variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {body ? (
        <Txt variant="small" color={colors.muted} style={{ textAlign: 'center', maxWidth: 300 }}>
          {body}
        </Txt>
      ) : null}
      {action && onAction ? <Button label={action} variant="ghost" size="md" onPress={onAction} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry, compact }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return <EmptyState icon="alert" title="Something went wrong" body={message} action={onRetry ? 'Try again' : undefined} onAction={onRetry} compact={compact} />;
}

/* ---------- skeletons ---------- */

/** A shimmering placeholder block. */
export function Skeleton({ width, height, radius: r = radius.md, style }: { width?: number | `${number}%`; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const [pulse] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 0.45, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ width: width ?? '100%', height, borderRadius: r, backgroundColor: colors.surface2, opacity: pulse }, style]} />;
}

/** Fades and lifts its children in when first shown. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 380, delay, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: NATIVE_DRIVER }).start();
  }, [v, delay]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }, style]}>{children}</Animated.View>;
}

/* ---------- forms ---------- */

export function Field({ label, error, hint, secure, style, inputStyle, ...input }: TextInputProps & { label: string; error?: string; hint?: string; secure?: boolean; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      <Txt variant="smallStrong" color={colors.muted}>
        {label}
      </Txt>
      <View style={[styles.inputWrap, focused && { borderColor: colors.text }, !!error && { borderColor: colors.accent }]}>
        <TextInput
          placeholderTextColor={colors.dim}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          accessibilityLabel={label}
          accessibilityHint={error || hint}
          secureTextEntry={secure && !shown}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, inputStyle]}
          {...input}
        />
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} onPress={() => setShown((s) => !s)} hitSlop={8} style={styles.eye}>
            <Icon name={shown ? 'eyeOff' : 'eye'} size={19} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Txt variant="small" color={colors.accentHi}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" color={colors.dim}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * A text box for longer writing (descriptions). It grows with what's typed, up to `maxAuto`, then scrolls; the grip
 * along the bottom drags it taller or shorter, like a desktop textarea. Shows a live count against `maxLength`.
 */
export function TextArea({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  error,
  hint,
  minHeight = 148,
  maxAuto = 360,
  maxHeight = 720,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  error?: string;
  hint?: string;
  minHeight?: number;
  maxAuto?: number;
  maxHeight?: number;
}) {
  const [focused, setFocused] = useState(false);
  const [content, setContent] = useState(minHeight);
  // Once dragged, the box keeps the height the organizer chose.
  const [manual, setManual] = useState<number | null>(null);
  const auto = Math.max(minHeight, Math.min(content, maxAuto));
  const height = manual ?? auto;
  // While dragging: where the finger started (page y) and the box's height then.
  const [drag, setDrag] = useState<{ y: number; h: number } | null>(null);
  const dragging = !!drag;
  const clamp = (h: number) => Math.round(Math.max(minHeight, Math.min(maxHeight, h)));
  // The grip uses the touch responder directly: it claims the touch, keeps it from the page's scroll, and resizes.
  const grip = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      setDrag({ y: e.nativeEvent.pageY, h: height });
      haptic.select();
    },
    onResponderMove: (e: GestureResponderEvent) => {
      if (drag) setManual(clamp(drag.h + e.nativeEvent.pageY - drag.y));
    },
    onResponderRelease: () => setDrag(null),
    onResponderTerminate: () => setDrag(null),
  };
  const count = value.length;
  const near = maxLength ? count > maxLength * 0.9 : false;
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="smallStrong" color={colors.muted}>
        {label}
      </Txt>
      <View style={[styles.areaWrap, focused && { borderColor: colors.text }, dragging && { borderColor: colors.accent }, !!error && { borderColor: colors.accent }]}>
        <TextInput
          multiline
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          maxLength={maxLength}
          placeholderTextColor={colors.dim}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          accessibilityLabel={label}
          accessibilityHint={error || hint}
          textAlignVertical="top"
          scrollEnabled
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // On the web the measured height already includes the padding (and never drops below the box), so adding it
          // again would make the box creep taller on its own.
          onContentSizeChange={(e) => setContent(Math.ceil(e.nativeEvent.contentSize.height) + (Platform.OS === 'web' ? 0 : space.lg + space.sm))}
          style={[styles.area, { height }]}
        />
        <View style={styles.areaFoot}>
          <Txt variant="tiny" color={near ? colors.warning : colors.dim}>
            {maxLength ? `${count.toLocaleString()} / ${maxLength.toLocaleString()}` : `${count.toLocaleString()} characters`}
          </Txt>
          <View
            {...grip}
            accessibilityRole="adjustable"
            accessibilityLabel={`Resize ${label.toLowerCase()} box`}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => setManual(clamp(height + (e.nativeEvent.actionName === 'increment' ? 80 : -80)))}
            hitSlop={10}
            style={[styles.grip, Platform.OS === 'web' && ({ cursor: 'ns-resize' } as ViewStyle)]}>
            <View style={[styles.gripBar, dragging && { backgroundColor: colors.accent }]} />
            <View style={[styles.gripBar, { width: 14 }, dragging && { backgroundColor: colors.accent }]} />
          </View>
        </View>
      </View>
      {error ? (
        <Txt variant="small" color={colors.accentHi}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" color={colors.dim}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/** − 2 + */
export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  const btn = (icon: IconName, next: number, disabled: boolean, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.select();
        onChange(next);
      }}
      style={({ pressed }) => [styles.stepBtn, disabled && { opacity: 0.35 }, pressed && { backgroundColor: colors.surface2 }]}>
      <Icon name={icon} size={18} />
    </Pressable>
  );
  return (
    <View style={styles.stepper} accessibilityLabel={label}>
      {btn('minus', value - 1, value <= min, 'One fewer ticket')}
      <Txt variant="title" accessibilityLiveRegion="polite" style={{ minWidth: 30, textAlign: 'center' }}>
        {value}
      </Txt>
      {btn('plus', value + 1, value >= max, 'One more ticket')}
    </View>
  );
}

/** A tappable settings-style row. */
export function Row({ icon, label, detail, onPress, tone }: { icon: IconName; label: string; detail?: string; onPress: () => void; tone?: 'accent' }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={tone === 'accent' ? colors.accent : colors.muted} />
      </View>
      <Txt variant="bodyStrong" color={tone === 'accent' ? colors.accent : colors.text} style={{ flex: 1 }}>
        {label}
      </Txt>
      {detail ? (
        <Txt variant="small" color={colors.dim}>
          {detail}
        </Txt>
      ) : null}
      <Icon name="chevronRight" size={17} color={colors.dim} />
    </Pressable>
  );
}

/** The native animation driver doesn't exist on web. */
const NATIVE_DRIVER = Platform.OS !== 'web';

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.pill },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { borderWidth: 1, borderColor: colors.line2, backgroundColor: 'transparent' },
  btnSubtle: { backgroundColor: colors.surface2 },
  btnDanger: { borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  glass: { backgroundColor: colors.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: space.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginBottom: space.lg },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: touch, paddingLeft: space.sm },
  notice: { flexDirection: 'row', gap: space.md, padding: space.md + 2, borderRadius: radius.md, borderWidth: 1, alignItems: 'flex-start' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.huge, paddingHorizontal: space.xxl },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  areaWrap: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface, overflow: 'hidden' },
  area: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, color: colors.text, ...type.body, outlineWidth: 0 },
  areaFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.lg, paddingRight: space.sm, height: 30, borderTopWidth: 1, borderTopColor: colors.line },
  grip: { width: 44, height: 30, alignItems: 'center', justifyContent: 'center', gap: 3 },
  gripBar: { width: 22, height: 2, borderRadius: 1, backgroundColor: colors.dim },
  inputWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
  input: { flex: 1, minWidth: 0, minHeight: 50, paddingHorizontal: space.lg, color: colors.text, ...type.body, lineHeight: undefined, outlineWidth: 0 },
  eye: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.line2, borderRadius: radius.pill, padding: 3 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
