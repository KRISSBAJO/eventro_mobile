/**
 * The door scanner's camera: expo-camera's CameraView reading QR codes only. Asks for the camera when first shown.
 * `paused` stops reading while a result is on screen; the same code is ignored for a few seconds so one ticket held
 * up to the camera isn't scanned twice. door-camera.web.tsx stands in on the web preview (no camera there).
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Icon } from './icons';
import { Button, Txt } from './ui';

export const HAS_CAMERA = true;

export function DoorCamera({ paused, torch, onCode, height }: { paused: boolean; torch: boolean; onCode: (data: string) => void; height: number }) {
  const [permission, request] = useCameraPermissions();
  const last = useRef<{ data: string; at: number } | null>(null);

  if (!permission) return <View style={[styles.box, { height }]} />;
  if (!permission.granted) {
    return (
      <View style={[styles.box, styles.ask, { height }]}>
        <Icon name="scan" size={30} color={colors.accent} />
        <Txt variant="title" style={{ textAlign: 'center' }}>
          Scan tickets with the camera
        </Txt>
        <Txt variant="small" color={colors.muted} style={{ textAlign: 'center' }}>
          {permission.canAskAgain ? 'Eventro uses the camera only to read ticket QR codes at the door.' : 'Camera access is off for Eventro. Turn it on in Settings, or enter codes by hand below.'}
        </Txt>
        {permission.canAskAgain ? <Button label="Allow camera" size="md" onPress={() => void request()} /> : <Button label="Open Settings" size="md" variant="ghost" onPress={() => Linking.openSettings().catch(() => undefined)} />}
      </View>
    );
  }
  return (
    <View style={[styles.box, { height }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          paused
            ? undefined
            : ({ data }) => {
                const now = Date.now();
                if (last.current && last.current.data === data && now - last.current.at < 4000) return;
                last.current = { data, at: now };
                onCode(data);
              }
        }
      />
      <View pointerEvents="none" style={styles.frame} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.panel, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: colors.line2 },
  ask: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl, backgroundColor: colors.surface },
  frame: { position: 'absolute', top: '18%', bottom: '18%', left: '18%', right: '18%', borderRadius: radius.lg, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
});
