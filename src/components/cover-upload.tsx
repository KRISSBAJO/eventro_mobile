/**
 * "Upload a photo": pick a photo (cropped to the 16:9 cover where the phone can crop), upload it to mediaEX through
 * the API with progress, and hand it back to become the cover. Explains refused photo access (with a way to
 * Settings), photos of the wrong type or too big for the API's limits, and failed uploads. A cancelled pick says
 * nothing. In the web build the picker is the browser's file chooser.
 */
import { useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { pickPhoto, PickError, uploadPhoto, useMediaConfig, type UploadedCover } from '@/lib/media-upload';
import { colors, space } from '@/theme';
import { Progress } from './org-ui';
import { Button, Notice, Txt } from './ui';

export function CoverUpload({ onUploaded, full, onBusy }: { onUploaded: (c: UploadedCover) => void; full?: string; onBusy?: (busy: boolean) => void }) {
  const cfg = useMediaConfig();
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<PickError | null>(null);
  const abort = useRef<AbortController | null>(null);

  if (cfg.isPending) return <Button label="Upload a photo" variant="subtle" size="md" icon="plus" disabled loading />;
  if (!cfg.data?.enabled) {
    return (
      <Notice icon="alert" title="Photo uploads unavailable" action="Check again" onAction={() => void cfg.refetch()}>Choose a stock cover or try again.</Notice>
    );
  }
  const limits = cfg.data;

  const start = async () => {
    if (abort.current) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    onBusy?.(true);
    setError(null);
    haptic.select();
    let picked;
    try {
      picked = await pickPhoto(limits);
    } catch (e) {
      const pe = e instanceof PickError ? e : new PickError('We couldn’t open your photos. Try again.', 'upload');
      if (pe.kind !== 'cancelled') {
        haptic.warning();
        setError(pe);
      }
      abort.current = null;
      onBusy?.(false);
      return;
    }
    setPct(0);
    try {
      const up = await uploadPhoto(picked, setPct, ctrl.signal);
      haptic.success();
      onUploaded(up);
    } catch (e) {
      if (!ctrl.signal.aborted) {
        haptic.error();
        setError(e instanceof PickError ? e : new PickError('The upload didn’t go through. Try again.', 'upload'));
      }
    } finally {
      abort.current = null;
      setPct(null);
      onBusy?.(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      {pct !== null ? (
        <View style={{ gap: 6 }} accessible accessibilityRole="progressbar" accessibilityLabel={`Uploading photo, ${pct}%`} accessibilityValue={{ min: 0, max: 100, now: pct }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="smallStrong">{pct < 100 ? `Uploading… ${pct}%` : 'Getting it ready…'}</Txt>
            {pct < 100 ? (
              <Txt variant="smallStrong" color={colors.accent} accessibilityRole="button" onPress={() => abort.current?.abort()}>
                Cancel
              </Txt>
            ) : null}
          </View>
          <Progress value={pct} max={100} />
        </View>
      ) : (
        <Button label={full ?? 'Upload a photo'} variant="primary" icon="plus" onPress={() => void start()} />
      )}
      {error ? (
        <Notice
          icon="alert"
          title={error.kind === 'size' ? 'That photo is too big' : error.kind === 'type' ? 'That file won’t work' : error.kind === 'upload' ? 'Upload failed' : 'No access to your photos'}
          action={error.kind === 'blocked' && Platform.OS !== 'web' ? 'Open Settings' : error.kind === 'upload' || error.kind === 'permission' ? 'Try again' : undefined}
          onAction={() => (error.kind === 'blocked' ? void Linking.openSettings().catch(() => undefined) : void start())}>
          {error.message}
        </Notice>
      ) : (
        <Txt variant="tiny" color={colors.dim}>
          {`JPG, PNG, WebP or HEIC, up to ${Math.round(limits.imageBytes / 1024 / 1024)} MB. Wide photos look best: covers are 16:9.`}
        </Txt>
      )}
    </View>
  );
}
