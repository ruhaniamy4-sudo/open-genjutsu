'use client';

import type { GenerateRequest, GenerateResponse, JobStatus } from '@/lib/api-types';

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type DispatchResult =
  | { ok: true; data: GenerateResponse }
  | { ok: false; status: number; error: string; code?: string; remaining?: number | null };

export async function dispatchRender(apiFetch: ApiFetch, body: GenerateRequest): Promise<DispatchResult> {
  const res = await apiFetch('/api/generate', { method: 'POST', body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as GenerateResponse & { error?: string; code?: string; remaining?: number | null };
  if (!res.ok) return { ok: false, status: res.status, error: data.error || 'Could not start the render.', code: data.code, remaining: data.remaining };
  return { ok: true, data };
}

/** One status check. Returns null on a network blip (caller should just try again). */
export async function checkJob(apiFetch: ApiFetch, token: string): Promise<JobStatus | null> {
  try {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(token)}`);
    const s = (await res.json()) as JobStatus & { error?: string };
    if (!res.ok) return { ...s, status: 'failed', error: s.error || 'Status check failed' } as JobStatus;
    return s;
  } catch {
    return null;
  }
}

export interface CancelResult {
  ok: boolean;
  refunded: number;
  status?: string;
}

export async function cancelJob(apiFetch: ApiFetch, token: string): Promise<CancelResult> {
  try {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(token)}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => ({}))) as { refunded?: number; status?: string };
    return {
      ok: res.ok,
      refunded: typeof data.refunded === 'number' ? data.refunded : 0,
      status: data.status,
    };
  } catch {
    return { ok: false, refunded: 0 };
  }
}

export function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, b64] = dataUrl.split(',');
  const type = /data:(.*?);base64/.exec(meta)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

function drawToJpeg(src: CanvasImageSource, w: number, h: number, maxSide: number, quality: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  try {
    canvas.getContext('2d')?.drawImage(src, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null; // cross-origin media without CORS taints the canvas
  }
}

/** Resizes a local image file to a small JPEG data URL (character references). */
export function fileToJpeg(file: File, maxSide = 512): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(drawToJpeg(img, img.naturalWidth, img.naturalHeight, maxSide, 0.82));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Last frame of a finished shot as a JPEG data URL, for the next shot's continuity.
 * Fetches via CORS blob first to sidestep browser non-CORS cache poisoning, then falls back to direct anonymous load.
 * Returns null when the media host blocks cross-origin reads.
 */
export async function captureLastFrame(url: string, type: 'video' | 'image', maxSide = 480): Promise<string | null> {
  let blobUrl: string | null = null;
  let srcUrl = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
        if (res.ok) {
          blobUrl = URL.createObjectURL(await res.blob());
          srcUrl = blobUrl;
        }
      } finally {
        clearTimeout(t);
      }
    } catch {
      // Fall back to direct crossOrigin element load (works for same-origin and some CDN setups).
    }
  }

  return new Promise((resolve) => {
    let done = false;
    let videoEl: HTMLVideoElement | null = null;
    const timer = setTimeout(() => finish(null), 15_000);
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (videoEl) {
        videoEl.onloadedmetadata = null;
        videoEl.onloadeddata = null;
        videoEl.onseeked = null;
        videoEl.onerror = null;
        videoEl.removeAttribute('src');
        videoEl.load();
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      resolve(v);
    };

    if (type === 'image') {
      const img = new Image();
      if (!blobUrl) img.crossOrigin = 'anonymous';
      img.onload = () => finish(drawToJpeg(img, img.naturalWidth, img.naturalHeight, maxSide, 0.72));
      img.onerror = () => finish(null);
      img.src = srcUrl;
      return;
    }

    const video = document.createElement('video');
    videoEl = video;
    if (!blobUrl) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let seekRequested = false;
    const captureNow = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null);
        return;
      }
      finish(drawToJpeg(video, video.videoWidth, video.videoHeight, maxSide, 0.72));
    };

    video.onloadedmetadata = () => {
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0.12) {
        seekRequested = true;
        try {
          video.currentTime = Math.max(0.02, dur - 0.08);
        } catch {
          seekRequested = false;
        }
      }
    };
    video.onloadeddata = () => {
      if (!seekRequested) captureNow();
    };
    video.onseeked = () => captureNow();
    video.onerror = () => finish(null);
    video.src = srcUrl;
    video.load();
  });
}
