/**
 * Date and time fields for event times, without a native picker library (none is installed; one would need a
 * development build). A field opens a bottom sheet: a month calendar for dates, hour / minute / AM-PM chips for
 * times. Values are plain wall-clock strings, "2026-12-27" and "20:00", because event times are stored as the
 * venue's wall-clock time (see lib/organizer.ts wallIso).
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space, touch } from '@/theme';
import { Icon } from './icons';
import { Button, focusRing, Txt } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** "Sat, Dec 27, 2026" */
export function dateLabel(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const d = new Date(`${v}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
/** "8:00 PM" */
export function timeLabel(v: string) {
  if (!/^\d{2}:\d{2}$/.test(v)) return '';
  const h = Number(v.slice(0, 2));
  return `${((h + 11) % 12) + 1}:${v.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `active`: its picker is open, so it glows like a text field being typed in. */
function FieldShell({ label, value, placeholder, error, hint, onPress, icon, active }: { label: string; value: string; placeholder: string; error?: string; hint?: string; onPress: () => void; icon: 'calendar' | 'clock'; active?: boolean }) {
  return (
    <View style={{ gap: 6, flex: 1, minWidth: 0 }}>
      <Txt variant="smallStrong" color={colors.muted}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}`}
        accessibilityHint={error || hint}
        onPress={() => {
          haptic.select();
          onPress();
        }}
        style={({ pressed }) => [styles.field, !!error && { borderColor: colors.accent }, (active || pressed) && focusRing]}>
        <Icon name={icon} size={18} color={active ? colors.accent : colors.muted} />
        <Txt color={value ? colors.text : colors.dim} numberOfLines={1} style={{ flex: 1 }}>
          {value || placeholder}
        </Txt>
      </Pressable>
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

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
        <View style={styles.grip} />
        <Txt variant="h3" accessibilityRole="header">
          {title}
        </Txt>
        {children}
      </View>
    </Modal>
  );
}

/** A date. `min` ("2026-11-24") greys out earlier days. */
export function DateField({ label, value, onChange, error, hint, min }: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; min?: string }) {
  const [open, setOpen] = useState(false);
  const start = value || min || ymd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const [cursor, setCursor] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const move = (n: number) => {
    haptic.select();
    setCursor((c) => {
      const m = c.m + n;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  };
  const show = () => {
    const s = value || min || start;
    setCursor({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 });
    setOpen(true);
  };
  return (
    <>
      <FieldShell label={label} value={dateLabel(value)} placeholder="Choose a date" error={error} hint={hint} onPress={show} icon="calendar" active={open} />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={styles.monthRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => move(-1)} hitSlop={8} style={styles.navBtn}>
            <Icon name="back" size={20} />
          </Pressable>
          <Txt variant="title" accessibilityLiveRegion="polite">
            {MONTHS[cursor.m]} {cursor.y}
          </Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => move(1)} hitSlop={8} style={styles.navBtn}>
            <Icon name="chevronRight" size={20} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {DOW.map((d) => (
            <View key={d} style={styles.cell}>
              <Txt variant="tiny" color={colors.dim}>
                {d.slice(0, 2)}
              </Txt>
            </View>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <View key={`x${i}`} style={styles.cell} />;
            const v = ymd(cursor.y, cursor.m, d);
            const on = v === value;
            const off = !!min && v < min;
            return (
              <View key={v} style={styles.cell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={dateLabel(v)}
                  accessibilityState={{ selected: on, disabled: off }}
                  disabled={off}
                  onPress={() => {
                    haptic.select();
                    onChange(v);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.day, on && { backgroundColor: colors.accent }, pressed && !on && { backgroundColor: colors.surface2 }]}>
                  <Txt variant="bodyStrong" color={on ? colors.accentInk : off ? colors.dim : colors.text}>
                    {d}
                  </Txt>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = ['00', '15', '30', '45'];

/** A time of day. `optional` adds "No time" to clear it. */
export function TimeField({ label, value, onChange, error, hint, optional }: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const h24 = value ? Number(value.slice(0, 2)) : 20;
  const minute = value ? value.slice(3, 5) : '00';
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const set = (h: number, m: string, isPm: boolean) => onChange(`${pad((h % 12) + (isPm ? 12 : 0))}:${m}`);
  const chip = (text: string, on: boolean, press: () => void, a11y: string) => (
    <Pressable
      key={a11y}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on }}
      onPress={() => {
        haptic.select();
        press();
      }}
      style={({ pressed }) => [styles.tChip, on && { backgroundColor: colors.accent, borderColor: colors.accent }, pressed && !on && { backgroundColor: colors.surface2 }]}>
      <Txt variant="bodyStrong" color={on ? colors.accentInk : colors.text}>
        {text}
      </Txt>
    </Pressable>
  );
  return (
    <>
      <FieldShell label={label} value={timeLabel(value)} placeholder={optional ? 'Optional' : 'Choose a time'} error={error} hint={hint} onPress={() => setOpen(true)} icon="clock" active={open} />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <Txt variant="small" color={colors.muted}>
          {value ? timeLabel(value) : 'Pick the hour, then the minutes.'}
        </Txt>
        <View style={styles.wrap}>{HOURS.map((h) => chip(String(h), !!value && h === h12, () => set(h, minute, pm), `${h} o’clock`))}</View>
        <View style={styles.wrap}>{MINUTES.map((m) => chip(`:${m}`, !!value && m === minute, () => set(h12, m, pm), `${m} minutes`))}</View>
        <View style={styles.wrap}>
          {chip('AM', !!value && !pm, () => set(h12, minute, false), 'AM')}
          {chip('PM', !!value && pm, () => set(h12, minute, true), 'PM')}
        </View>
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Button
            label="Done"
            onPress={() => {
              if (!value) set(h12, minute, pm);
              setOpen(false);
            }}
          />
          {optional && value ? (
            <Button
              label="No time"
              variant="ghost"
              onPress={() => {
                onChange('');
                setOpen(false);
              }}
            />
          ) : null}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.field },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.md,
    paddingHorizontal: gutter,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.line2,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line2, marginBottom: space.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  day: { width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tChip: { minWidth: 52, height: touch, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
});
