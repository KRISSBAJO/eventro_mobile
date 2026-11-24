/** Browser version of send-file.ts: XHR, because fetch can't report upload progress. */
import { uploadError } from './send-file-error';

export type Picked = { uri: string; file?: Blob | null };

export function sizeOf(p: Picked): number | null {
  return p.file?.size ?? null;
}

export async function sendFile(p: Picked, url: string, headers: Record<string, string>, onProgress: (pct: number) => void, signal?: AbortSignal) {
  const body = p.file ?? (await (await fetch(p.uri)).blob());
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(uploadError(xhr.status, xhr.responseText))));
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}
