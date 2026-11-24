/** A QR code drawn with react-native-svg (encoded by qrcode-generator), dark modules on a light card. */
import makeQr from 'qrcode-generator';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

type Matrix = { getModuleCount(): number; isDark(row: number, col: number): boolean };

export function QrCode({ value, size, color = '#0d0d0f', background = '#ffffff' }: { value: string; size: number; color?: string; background?: string }) {
  const { d, n } = useMemo(() => {
    const qr = makeQr(0, 'M');
    qr.addData(value);
    qr.make();
    const m = qr as unknown as Matrix;
    const count = m.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (m.isDark(r, c)) path += `M${c + 2},${r + 2}h1v1h-1z`;
      }
    }
    return { d: path, n: count + 4 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} accessibilityLabel="Ticket QR code">
      <Rect width={n} height={n} fill={background} />
      <Path d={d} fill={color} />
    </Svg>
  );
}
