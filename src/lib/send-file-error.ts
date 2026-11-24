/** The API's (or the bucket's) reason for a failed upload, else a plain one. */
export function uploadError(status: number, body: string) {
  try {
    const b = JSON.parse(body) as { message?: string | string[]; error?: string };
    const m = Array.isArray(b.message) ? b.message.join(' ') : (b.message ?? b.error);
    if (m) return m;
  } catch {
    /* not JSON */
  }
  if (status === 401) return 'Your session ended. Sign in again, then upload the photo.';
  return status === 413 ? 'That photo is too big to upload.' : `The upload didn’t go through (${status}). Try again.`;
}
