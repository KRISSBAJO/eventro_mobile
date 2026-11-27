/**
 * "Have a presale code?" on the event screen, when ticket types aren't on public sale yet. The code is checked with
 * the API (POST /events/:slug/presale), which says which ticket types it opens; it then goes with the hold.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorText } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Button, Field, Txt } from './ui';

const whenLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PresaleBox({ slug, presale, onUnlocked }: { slug: string; presale: { open: boolean; startsAt: string | null }; onUnlocked: (code: string, ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const check = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setNote('');
    try {
      const r = await api<{ ok: boolean; opensAt: string | null; ticketTypeIds: string[] }>(`/events/${encodeURIComponent(slug)}/presale`, { body: { code: code.trim() } });
      if (r.ok) {
        haptic.success();
        onUnlocked(code.trim(), r.ticketTypeIds);
      } else {
        setNote(r.opensAt ? `Right code. The presale opens ${whenLabel(r.opensAt)}.` : 'The presale hasn’t opened yet.');
      }
    } catch (e) {
      haptic.error();
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptic.select();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.box, pressed && { backgroundColor: colors.surface2 }]}>
        <Icon name="tag" size={18} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">Have a presale code?</Txt>
          <Txt variant="small" color={colors.dim}>
            {presale.open ? 'It opens the tickets that aren’t on public sale yet.' : presale.startsAt ? `The presale opens ${whenLabel(presale.startsAt)}.` : 'The presale hasn’t opened yet.'}
          </Txt>
        </View>
        <Icon name="chevronRight" size={17} color={colors.dim} />
      </Pressable>
    );
  }
  return (
    <View style={[styles.box, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <Field label="Presale code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={30} error={note} returnKeyType="go" onSubmitEditing={() => void check()} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Unlock" size="md" icon="tag" loading={busy} disabled={!code.trim()} onPress={() => void check()} style={{ flex: 1 }} />
        <Button label="Cancel" size="md" variant="ghost" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface },
});
