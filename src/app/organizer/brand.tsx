/**
 * Organizer → Logo and banner (admins): both optional. Picking a photo uploads it to mediaEX (lib/media-upload.ts, like
 * event covers) and saves it straight away (PATCH /organizer/orgs/:id { logoUrl | coverUrl }); Remove sets it back to
 * null. The logo shows on the organizer page, "Presented by" on events and in Following; the banner tops the organizer
 * page, and without one the cover of their next event is used.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/icons';
import { OrgScreen } from '@/components/org-ui';
import { Button, EmptyState, Skeleton, Txt } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { PickError, pickPhoto, uploadPhoto, useMediaConfig } from '@/lib/media-upload';
import { isAdmin, membershipOf } from '@/lib/organizer';
import { useMyOrgs } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

type Field = 'logoUrl' | 'coverUrl';

export default function Brand() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { user } = useAuth();
  const orgs = useMyOrgs(user?.id);
  const m = membershipOf(orgs.data, orgId) ?? (orgs.data?.length === 1 ? orgs.data[0] : undefined);
  const cfg = useMediaConfig();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<{ field: Field; progress: number | 'saving' } | null>(null);
  const [problem, setProblem] = useState<{ field: Field; text: string } | null>(null);

  const save = async (field: Field, url: string | null) => {
    setBusy({ field, progress: 'saving' });
    await api(`/organizer/orgs/${encodeURIComponent(m!.org.id)}`, { method: 'PATCH', body: { [field]: url } });
    await qc.invalidateQueries({ queryKey: ['organizer', 'orgs'] });
    void qc.invalidateQueries({ queryKey: ['organizer'] });
  };

  const change = async (field: Field) => {
    if (busy || !cfg.data || !m) return;
    setProblem(null);
    try {
      const picked = await pickPhoto(cfg.data, field === 'logoUrl' ? [1, 1] : [3, 1]);
      setBusy({ field, progress: 0 });
      const up = await uploadPhoto(picked, (progress) => setBusy({ field, progress: progress >= 100 ? 'saving' : progress }));
      await save(field, up.url);
      haptic.success();
    } catch (e) {
      if (e instanceof PickError && e.kind === 'cancelled') return;
      const msg = e instanceof PickError ? e.message : errorText(e);
      setProblem({ field, text: /unavailable|reachable/i.test(msg) ? 'Photo uploads aren’t working right now. Try again in a few minutes.' : msg });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (field: Field) => {
    if (busy || !m) return;
    setProblem(null);
    try {
      await save(field, null);
      haptic.tap();
    } catch (e) {
      setProblem({ field, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const org = m?.org;
  const status = (field: Field) =>
    busy?.field === field ? (
      <View style={styles.busy}>
        <ActivityIndicator color="#fff" />
        <Txt variant="tiny" color="#fff">
          {busy.progress === 'saving' ? 'Saving…' : `${busy.progress}%`}
        </Txt>
      </View>
    ) : null;
  const error = (field: Field) =>
    problem?.field === field ? (
      <Txt variant="small" color={colors.accent}>
        {problem.text}
      </Txt>
    ) : null;

  return (
    <OrgScreen title="Logo and banner" eyebrow={org?.name} fallback="/organizer">
      {orgs.isPending ? (
        <Skeleton height={220} radius={radius.card} />
      ) : !org || !isAdmin(m?.role) ? (
        <EmptyState icon="lock" title="Admins only" body="Ask an admin on your team to change the logo and banner." />
      ) : (
        <>
          <Txt color={colors.muted}>Optional. Fans see them on your page, your event pages and in Following.</Txt>

          <View style={{ gap: space.md }}>
            <Txt variant="h3">Logo</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
              <Pressable accessibilityRole="button" accessibilityLabel={org.logoUrl ? 'Change logo' : 'Add a logo'} onPress={() => void change('logoUrl')} style={styles.logo}>
                {org.logoUrl ? <Image source={{ uri: org.logoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <Icon name="plus" size={24} color={colors.accent} />}
                {status('logoUrl')}
              </Pressable>
              <View style={{ flex: 1, gap: space.sm }}>
                <Txt variant="small" color={colors.dim}>
                  Square, at least 400 × 400.
                </Txt>
                <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                  <Button label={org.logoUrl ? 'Change' : 'Upload logo'} variant="ghost" size="sm" disabled={!!busy} onPress={() => void change('logoUrl')} />
                  {org.logoUrl ? <Button label="Remove" variant="subtle" size="sm" disabled={!!busy} onPress={() => void remove('logoUrl')} /> : null}
                </View>
              </View>
            </View>
            {error('logoUrl')}
          </View>

          <View style={{ gap: space.md }}>
            <Txt variant="h3">Banner</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={org.coverUrl ? 'Change banner' : 'Add a banner'} onPress={() => void change('coverUrl')} style={[styles.banner, !org.coverUrl && styles.empty]}>
              {org.coverUrl ? (
                <Image source={{ uri: org.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
              ) : (
                <>
                  <Icon name="plus" size={22} color={colors.accent} />
                  <Txt variant="smallStrong">Add a banner</Txt>
                  <Txt variant="tiny" color={colors.muted}>
                    Wide photo, at least 1600 px across
                  </Txt>
                </>
              )}
              {status('coverUrl')}
            </Pressable>
            <Txt variant="small" color={colors.dim}>
              Tops your organizer page. Without one, your next event’s photo is used.
            </Txt>
            {org.coverUrl ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label="Change" variant="ghost" size="sm" disabled={!!busy} onPress={() => void change('coverUrl')} />
                <Button label="Remove" variant="subtle" size="sm" disabled={!!busy} onPress={() => void remove('coverUrl')} />
              </View>
            ) : null}
            {error('coverUrl')}
          </View>
        </>
      )}
    </OrgScreen>
  );
}

const styles = StyleSheet.create({
  logo: { width: 96, height: 96, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface2 },
  banner: { width: '100%', aspectRatio: 2.4, borderRadius: radius.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.surface2 },
  empty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line2, backgroundColor: 'transparent' },
  busy: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(15,10,11,0.55)' },
});
