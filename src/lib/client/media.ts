'use client';

/** Grabs an early frame of a local video file as a JPEG data URL (max 768px), for the Director's vision model. */
export function extractFrame0(objectUrl: string, maxSide = 768): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      video.removeAttribute('src');
      video.load();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      clearTimeout(timer);
      try {
        const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        finish(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
  });
}

export interface UploadResult {
  /** URL the GPU worker / partner API can read, or null when uploads are off (local preview only). */
  remoteUrl: string | null;
}

/** Presign + direct PUT to R2. Falls back to local-only when the server has no bucket. */
export async function uploadMedia(
  file: File,
  kind: 'clip' | 'face',
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<UploadResult> {
  const res = await apiFetch('/api/upload/presign', {
    method: 'POST',
    body: JSON.stringify({ kind, filename: file.name, contentType: file.type, size: file.size }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    mode?: 'local' | 'r2';
    uploadUrl?: string;
    readUrl?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || 'Upload was rejected');
  if (data.mode !== 'r2' || !data.uploadUrl || !data.readUrl) return { remoteUrl: null };
  const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return { remoteUrl: data.readUrl };
}

export const ACCEPT = {
  clip: 'video/mp4,video/quicktime,video/webm',
  face: 'image/jpeg,image/png,image/webp',
};
