/** Line icons in the website's style (24-unit grid, 2px round strokes), drawn with react-native-svg. */
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme';

const PATHS = {
  discover: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
  ticket: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5Z', 'M14 6v12'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
  pin: ['M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronRight: ['m9 6 6 6-6 6'],
  back: ['M15 18 9 12l6-6'],
  close: ['M6 6l12 12M18 6 6 18'],
  share: ['M12 15V4', 'm8 8 4-4 4 4', 'M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5'],
  calendar: ['M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z', 'M4 10h16M8 3v4M16 3v4'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z', 'M9 4v14M15 6v14'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  sliders: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M16 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM10 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  locate: ['M12 2v3M12 19v3M2 12h3M19 12h3', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'],
  offline: ['M3 3l18 18', 'M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.5M14.8 10.4A10 10 0 0 1 19 12.9M2 9a15 15 0 0 1 4.4-2.7M12 5c3.7 0 7.1 1.4 10 3.9', 'M12 20h.01'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  mail: ['M4 6h16v12H4z', 'm4 7 8 6 8-6'],
  logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l-5-5 5-5M5 12h11'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01'],
  file: ['M7 3h7l5 5v13H7z', 'M14 3v5h5M10 13h6M10 17h6'],
  shield: ['M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z', 'm9 12 2 2 4-4'],
  gift: ['M4 11h16v9H4zM3 7h18v4H3zM12 7v13', 'M12 7S10.5 3 8 3a2 2 0 0 0 0 4h4ZM12 7s1.5-4 4-4a2 2 0 0 1 0 4h-4Z'],
  arrowRight: ['M5 12h14', 'm13 6 6 6-6 6'],
  alert: ['M12 3 2 20h20L12 3Z', 'M12 10v4M12 17h.01'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z'],
  external: ['M14 4h6v6', 'M20 4 11 13', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  stream: ['M3 6h18v12H3z', 'm10 9 5 3-5 3V9Z'],
  card: ['M3 6h18v12H3z', 'M3 10h18M7 15h3'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z'],
  key: ['M14 10a4 4 0 1 0-3.9 4H11l1 1h2v2h2v2h3v-3l-5.1-5.1c.1-.3.1-.6.1-.9Z'],
  tag: ['M3 12V4h8l9 9-8 8-9-9Z', 'M7.5 8.5h.01'],
  bell: ['M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2Z', 'M10 20a2 2 0 0 0 4 0'],
  phone: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z', 'M11 18h2'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3', 'M4 12h16'],
  flash: ['M13 3 5 14h6l-1 7 8-11h-6l1-7Z'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  sync: ['M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4', 'M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4'],
  cash: ['M3 7h18v10H3z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 12h.01M17.5 12h.01'],
  send: ['M21 3 10 14', 'M21 3l-7 18-4-7-7-4 18-7Z'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  keyboard: ['M3 7h18v10H3z', 'M7 11h.01M11 11h.01M15 11h.01M7 14h10'],
  users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 20a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6'],
  trash: ['M4 7h16M10 11v6M14 11v6', 'M6 7l1 13h10l1-13M9 7V4h6v3'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, color = colors.text, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[name].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

/** The Eventro ticket mark from the website's logo. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path fill={colors.accent} d="M5 8a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v4.5a3.5 3.5 0 0 0 0 7V24a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4.5a3.5 3.5 0 0 0 0-7z" />
      <Path fill={colors.bg} d="M11.5 11h9v2.4h-6.4v1.4h5.4v2h-5.4v1.4h6.4V21h-9z" />
    </Svg>
  );
}
