/**
 * Sends a picked file's bytes as the body of a PUT, with upload progress (phones: expo-file-system's native upload
 * task, which streams the file and sets Content-Length). send-file.web.ts does the same in the browser with XHR.
 */
import { File, UploadType } from 'expo-file-system';
import { uploadError } from './send-file-error';

export type Picked = { uri: string; file?: Blob | null };

/** The file's size in bytes, or null when the phone can't tell. */
export function sizeOf(p: Picked): number | null {
  try {
    const n = new File(p.uri).size;
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function sendFile(p: Picked, url: string, headers: Record<string, string>, onProgress: (pct: number) => void, signal?: AbortSignal) {
  const r = await new File(p.uri).upload(url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    sessionType: 'foreground',
    signal,
    onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && onProgress(Math.round((bytesSent / totalBytes) * 100)),
  });
  if (r.status < 200 || r.status >= 300) throw new Error(uploadError(r.status, r.body));
}
