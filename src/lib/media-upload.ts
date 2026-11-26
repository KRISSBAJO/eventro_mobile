/**
 * Uploading a cover photo from the phone, through the same endpoints as the website's uploader
 * (eventro/components/media-uploader.tsx). The mediaEX key never leaves the API:
 *
 *   GET  /media/config                 whether uploads are on, and the limits (types, bytes, photos per event)
 *   POST /media/uploads                { fileName, size, mimeType } → an upload slot
 *   PUT  <slot>                        the file: to the API (PUT /media/uploads/:id, which adds the key) or a signed bucket URL
 *   POST /media/uploads/:id/complete   then GET /media/uploads/:id until it's ready
 *   PUT  /organizer/events/:id/media   { items: [{ id, kind }] }: the first item is the cover; the API sets imageUrl from it
 *
 * Picking uses expo-image-picker (a file chooser in the web build), cropped to the website's 16:9 cover where the
 * phone's picker can crop.
 */
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api, API_URL, getApiTokens } from './api';
import { sendFile, sizeOf } from './send-file';

/** GET /media/config */
export type MediaConfig = { enabled: boolean; images: number; videos: number; imageBytes: number; imageTypes?: string[] };
type Started = { id: string; kind: 'image' | 'video'; upload: { url: string | null; method: string; headers: Record<string, string>; through: 'eventro' | 'bucket' } };
type Status = { id: string; status: string; progress: number; error: string | null; url?: string; thumbUrl?: string };

/** A photo uploaded to mediaEX and ready to be the cover. */
export type UploadedCover = { id: string; url: string; thumbUrl?: string; fileName: string };

export function useMediaConfig() {
  return useQuery({ queryKey: ['media', 'config'], queryFn: () => api<MediaConfig>('/media/config'), staleTime: 10 * 60_000, retry: 1 });
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif' };
const TYPE_NAMES = 'JPG, PNG, WebP or HEIC';

/** Why a pick didn't produce an upload. `quiet` ones (a cancelled pick) aren't shown as errors. */
export class PickError extends Error {
  constructor(
    message: string,
    readonly kind: 'cancelled' | 'permission' | 'blocked' | 'type' | 'size' | 'upload',
  ) {
    super(message);
  }
}

export type PickedPhoto = { uri: string; file?: Blob | null; fileName: string; mimeType: string; size: number };

/** Asks for photo access when needed, opens the picker, and checks the photo against the API's limits. */
export async function pickPhoto(cfg: MediaConfig, aspect: [number, number] = [16, 9]): Promise<PickedPhoto> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw perm.canAskAgain
        ? new PickError('Omoshow needs access to your photos to upload a cover. Try again and choose Allow.', 'permission')
        : new PickError('Photo access is turned off for Omoshow. Turn it on in Settings, then try again.', 'blocked');
    }
  }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.85, exif: false });
  if (r.canceled || !r.assets?.length) throw new PickError('No photo picked.', 'cancelled');
  const a = r.assets[0];
  const fromName = (a.fileName ?? a.uri.split('?')[0]).split('.').pop()?.toLowerCase() ?? '';
  const mimeType = (a.mimeType || a.file?.type || EXT[fromName] || '').toLowerCase();
  const types = cfg.imageTypes ?? ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!mimeType.startsWith('image/')) throw new PickError(`That isn’t a photo. Choose a ${TYPE_NAMES} image.`, 'type');
  if (!types.includes(mimeType)) throw new PickError(`Photos can be ${TYPE_NAMES}. That one is ${mimeType.replace('image/', '').toUpperCase()}.`, 'type');
  const size = a.fileSize ?? a.file?.size ?? sizeOf({ uri: a.uri, file: a.file }) ?? 0;
  if (!size) throw new PickError('We couldn’t read that photo. Try another one.', 'type');
  if (size > cfg.imageBytes) throw new PickError(`That photo is ${(size / 1024 / 1024).toFixed(1)} MB. Photos can be up to ${mb(cfg.imageBytes)}.`, 'size');
  const ext = Object.entries(EXT).find(([, m]) => m === mimeType)?.[0] ?? 'jpg';
  const fileName = a.fileName || a.file?.name || `cover-${Date.now()}.${ext}`;
  return { uri: a.uri, file: a.file ?? null, fileName, mimeType, size };
}

/** Uploads a picked photo and waits until mediaEX can serve it. `onProgress` gets 0–100 for the upload itself. */
export async function uploadPhoto(p: PickedPhoto, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<UploadedCover> {
  try {
    const s = await api<Started>('/media/uploads', { body: { fileName: p.fileName, size: p.size, mimeType: p.mimeType } });
    // api() refreshed the session if it was about to run out, so this token is fresh.
    const viaApi = s.upload.through === 'eventro';
    const url = viaApi ? `${API_URL}/media/uploads/${encodeURIComponent(s.id)}` : s.upload.url!;
    const headers: Record<string, string> = viaApi ? { Authorization: `Bearer ${getApiTokens()?.token ?? ''}`, 'Content-Type': p.mimeType } : { 'Content-Type': p.mimeType, ...s.upload.headers };
    await sendFile(p, url, headers, onProgress, signal);
    onProgress(100);
    let st = await api<Status>(`/media/uploads/${encodeURIComponent(s.id)}/complete`, { method: 'POST' });
    // Photos are usually ready at once; give processing up to ~30 seconds.
    for (let i = 0; st.status !== 'ready' && st.status !== 'failed' && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      st = await api<Status>(`/media/uploads/${encodeURIComponent(s.id)}`);
    }
    if (st.status === 'failed') throw new Error(st.error || 'mediaEX couldn’t process that photo. Try another one.');
    if (st.status !== 'ready' || !st.url) throw new Error('The photo is still processing. Try again in a minute.');
    return { id: s.id, url: st.url, thumbUrl: st.thumbUrl, fileName: p.fileName };
  } catch (e) {
    throw new PickError(e instanceof Error && e.message ? e.message : 'The upload didn’t go through. Try again.', 'upload');
  }
}
