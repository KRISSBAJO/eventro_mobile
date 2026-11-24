/**
 * "Are you sure?" as an in-app sheet that looks and works the same on phones and the web build.
 *
 * The web build used window.confirm, which embedded browsers and previews may block: it then returns false straight
 * away without showing anything, so actions like Sign out silently did nothing. This never depends on the browser.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Sign out?', message: '…', confirmLabel: 'Sign out', destructive: true })) …
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme';
import { Button, Txt } from './ui';

export type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };
type Ask = (o: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => {
    // A second question replaces the first, which counts as cancelled.
    resolver.current?.(false);
    haptic.warning();
    setOpen(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (v: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    setOpen(null);
    r?.(v);
  };

  return (
    <Ctx.Provider value={ask}>
      {children}
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => answer(false)} statusBarTranslucent>
        <Pressable accessibilityLabel="Cancel" style={styles.scrim} onPress={() => answer(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={styles.grip} />
          <Txt variant="h3" accessibilityRole="header">
            {open?.title}
          </Txt>
          {open?.message ? <Txt color={colors.muted}>{open.message}</Txt> : null}
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Button label={open?.confirmLabel ?? 'OK'} variant={open?.destructive ? 'danger' : 'primary'} feedback="firm" onPress={() => answer(true)} />
            <Button label={open?.cancelLabel ?? 'Cancel'} variant="ghost" onPress={() => answer(false)} />
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConfirm needs <ConfirmProvider>');
  return v;
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.sm,
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
});
