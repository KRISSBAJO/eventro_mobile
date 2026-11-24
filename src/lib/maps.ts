/**
 * "Open in Maps": Apple Maps on iOS, the maps app (geo:) on Android, Google Maps on the web.
 * The app has no in-app map (that needs a native maps library); this hands off to the phone's own.
 */
import { Linking, Platform } from 'react-native';
import { haptic } from './haptics';

export type MapPlace = { name: string; address?: string | null; city?: string | null; lat: number | null; lng: number | null };

export function mapsUrls(v: MapPlace) {
  const label = [v.name, v.address, v.address?.includes(v.city ?? '') ? null : v.city].filter(Boolean).join(', ');
  const hasPoint = v.lat !== null && v.lng !== null;
  const google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasPoint ? `${v.lat},${v.lng}` : label)}`;
  const apple = `https://maps.apple.com/?q=${encodeURIComponent(v.name)}${hasPoint ? `&ll=${v.lat},${v.lng}` : `&address=${encodeURIComponent(label)}`}`;
  const geo = hasPoint ? `geo:${v.lat},${v.lng}?q=${v.lat},${v.lng}(${encodeURIComponent(v.name)})` : `geo:0,0?q=${encodeURIComponent(label)}`;
  return { google, apple, geo };
}

export function openMaps(v: MapPlace) {
  haptic.tap();
  const u = mapsUrls(v);
  const url = Platform.OS === 'ios' ? u.apple : Platform.OS === 'android' ? u.geo : u.google;
  Linking.openURL(url).catch(() => Linking.openURL(u.google).catch(() => undefined));
}
