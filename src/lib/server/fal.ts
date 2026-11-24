import type { Aspect, Duration, EngineId } from '@/lib/vfx-data';
import { fetchWithTimeout } from './http';

type PartnerId = Exclude<EngineId, 'kinetix-pro'>;

interface PartnerSpec {
  /** Endpoint used when a reference image is attached (image-to-video / image edit). */
  i2v: string;
  /** Endpoint used for pure text prompts. */
  t2v: string;
  imageField: 'image_url' | 'start_image_url' | 'image_urls';
  /** Video only; image models take no duration. */
  duration?: (seconds: number) => string;
  /** Parameter name for sizing (`aspect_ratio` by default, `image_size` for GPT Image / Seedream 4). */
  sizeField?: 'aspect_ratio' | 'image_size';
  /** Returns the sizing value, or undefined when the endpoint derives aspect from the input image. */
  aspect: (a: Aspect, withImage: boolean) => unknown;
}

const wide = (a: Aspect) => (a === '2.39:1' ? '16:9' : a);
const cinema = (a: Aspect) => (a === '2.39:1' ? '21:9' : a);

/**
 * Verified fal.ai catalog endpoints and input schemas.
 * Any endpoint can still be overridden via FAL_ENDPOINT_<ENGINE>_I2V / _T2V env vars
 * (e.g. FAL_ENDPOINT_SEEDANCE_25_I2V) without a code change.
 */
const PARTNERS: Record<PartnerId, PartnerSpec> = {
  'wan-26': {
    i2v: 'wan/v2.6/image-to-video',
    t2v: 'wan/v2.6/text-to-video',
    imageField: 'image_url',
    // Wan 2.6 accepts "5", "10", or "15".
    duration: (s) => String(s <= 5 ? 5 : 10),
    // Wan 2.6 I2V infers aspect ratio from image_url; only T2V takes aspect_ratio.
    aspect: (a, withImage) => (withImage ? undefined : wide(a)),
  },
  'kling-30': {
    i2v: 'fal-ai/kling-video/v3/pro/image-to-video',
    t2v: 'fal-ai/kling-video/v3/pro/text-to-video',
    imageField: 'start_image_url',
    // Kling v3 Pro accepts integer duration strings "3" through "15".
    duration: (s) => String(Math.min(15, Math.max(3, s))),
    // Kling v3 Pro I2V derives aspect ratio from start_image_url; only T2V takes aspect_ratio.
    aspect: (a, withImage) => (withImage ? undefined : wide(a)),
  },
  'seedance-25': {
    i2v: 'bytedance/seedance-2.5/us/image-to-video',
    t2v: 'bytedance/seedance-2.5/us/text-to-video',
    imageField: 'image_url',
    duration: (s) => String(s),
    // Seedance 2.5 supports 21:9, 16:9, 9:16, 1:1, 4:3, 3:4.
    aspect: (a) => cinema(a),
  },
  'veo-31': {
    i2v: 'fal-ai/veo3.1/image-to-video',
    t2v: 'fal-ai/veo3.1',
    imageField: 'image_url',
    // Veo 3.1 accepts "4s" / "6s" / "8s".
    duration: (s) => (s <= 4 ? '4s' : s <= 6 ? '6s' : '8s'),
    // Veo 3.1 T2V supports 16:9 / 9:16; I2V also supports "auto".
    aspect: (a, withImage) => (a === '9:16' ? '9:16' : a === '1:1' && withImage ? 'auto' : '16:9'),
  },
  'nano-banana-pro': {
    i2v: 'fal-ai/nano-banana-pro/edit',
    t2v: 'fal-ai/nano-banana-pro',
    imageField: 'image_urls',
    aspect: (a) => cinema(a),
  },
  'gpt-image': {
    i2v: 'fal-ai/gpt-image-1/edit-image',
    t2v: 'fal-ai/gpt-image-1/text-to-image',
    imageField: 'image_urls',
    sizeField: 'image_size',
    // GPT Image 1 uses image_size ("auto" | "1024x1024" | "1536x1024" | "1024x1536"), not aspect_ratio.
    aspect: (a) => (a === '1:1' ? '1024x1024' : a === '9:16' ? '1024x1536' : '1536x1024'),
  },
  'seedream-4': {
    i2v: 'fal-ai/bytedance/seedream/v4/edit',
    t2v: 'fal-ai/bytedance/seedream/v4/text-to-image',
    imageField: 'image_urls',
    sizeField: 'image_size',
    // Seedream v4 uses image_size presets or { width, height }, not aspect_ratio.
    aspect: (a) =>
      a === '1:1'
        ? 'square_hd'
        : a === '9:16'
          ? 'portrait_16_9'
          : a === '2.39:1'
            ? { width: 2560, height: 1080 }
            : 'landscape_16_9',
  },
  'flux-ultra': {
    i2v: 'fal-ai/flux-pro/kontext',
    t2v: 'fal-ai/flux-pro/v1.1-ultra',
    imageField: 'image_url',
    aspect: (a) => cinema(a),
  },
};

function envKey(engine: PartnerId, kind: 'I2V' | 'T2V') {
  return `FAL_ENDPOINT_${engine.replace(/-/g, '_').toUpperCase()}_${kind}`;
}

export function falEndpoint(engine: PartnerId, withImage: boolean): string {
  const kind = withImage ? 'I2V' : 'T2V';
  const override = process.env[envKey(engine, kind)]?.trim();
  if (override && /^[\w.-]+(\/[\w.-]+)+$/.test(override)) return override;
  return withImage ? PARTNERS[engine].i2v : PARTNERS[engine].t2v;
}

export function buildFalInput(
  engine: PartnerId,
  args: { prompt: string; aspect: Aspect; duration: Duration; imageUrl?: string },
): Record<string, unknown> {
  const spec = PARTNERS[engine];
  const withImage = Boolean(args.imageUrl);
  const input: Record<string, unknown> = { prompt: args.prompt };
  const sizing = spec.aspect(args.aspect, withImage);
  if (sizing !== undefined) input[spec.sizeField ?? 'aspect_ratio'] = sizing;
  if (spec.duration) input.duration = spec.duration(parseInt(args.duration, 10));
  if (args.imageUrl) input[spec.imageField] = spec.imageField === 'image_urls' ? [args.imageUrl] : args.imageUrl;
  return input;
}

function falHeaders() {
  return { Authorization: `Key ${process.env.FAL_KEY ?? ''}`, 'Content-Type': 'application/json' };
}

export interface FalSubmit {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

export async function falSubmit(endpoint: string, input: Record<string, unknown>): Promise<FalSubmit> {
  const res = await fetchWithTimeout(
    `https://queue.fal.run/${endpoint}`,
    { method: 'POST', headers: falHeaders(), body: JSON.stringify(input) },
    20_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`fal.ai rejected the job (${res.status}): ${describeFalError(data)}`);
  }
  const requestId = String(data.request_id ?? '');
  if (!requestId) throw new Error('fal.ai returned no request id');
  const base = `https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}`;
  const pick = (k: string, fallback: string) =>
    typeof data[k] === 'string' && (data[k] as string).startsWith('https://queue.fal.run/') ? (data[k] as string) : fallback;
  return {
    requestId,
    statusUrl: pick('status_url', `${base}/status`),
    responseUrl: pick('response_url', base),
    cancelUrl: pick('cancel_url', `${base}/cancel`),
  };
}

export function describeFalError(data: Record<string, unknown>): string {
  const detail = data.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    return [first.loc?.join('.'), first.msg].filter(Boolean).join(': ') || 'validation error';
  }
  if (typeof data.error === 'string') return data.error;
  return 'unknown error';
}

export type FalPoll =
  | { state: 'queued'; position: number | null }
  | { state: 'running' }
  | { state: 'completed'; url: string; type: 'video' | 'image' }
  | { state: 'failed'; error: string };

export async function falPoll(statusUrl: string, responseUrl: string): Promise<FalPoll> {
  const res = await fetchWithTimeout(statusUrl, { headers: falHeaders() }, 10_000);
  if (res.status === 404) return { state: 'failed', error: 'fal.ai no longer knows this request.' };
  if (!res.ok) {
    // 5xx / 429 are transient: report running and let the client poll again.
    if (res.status >= 500 || res.status === 429) return { state: 'running' };
    return { state: 'failed', error: `fal.ai status error (${res.status})` };
  }
  const data = (await res.json()) as { status?: string; queue_position?: number; error?: string };
  if (data.status === 'IN_QUEUE') {
    return { state: 'queued', position: typeof data.queue_position === 'number' ? data.queue_position + 1 : null };
  }
  if (data.status === 'FAILED' || data.status === 'CANCELLED') {
    return { state: 'failed', error: data.error || `fal.ai reported ${data.status.toLowerCase()}.` };
  }
  if (data.status !== 'COMPLETED') return { state: 'running' };

  const out = await fetchWithTimeout(responseUrl, { headers: falHeaders() }, 15_000);
  if (out.status >= 500 || out.status === 429) return { state: 'running' };
  const body = (await out.json().catch(() => ({}))) as Record<string, unknown>;
  if (!out.ok) return { state: 'failed', error: describeFalError(body) };
  const found = extractOutput(body);
  return found ? { state: 'completed', ...found } : { state: 'failed', error: 'fal.ai finished without an output file.' };
}

type Media = { url?: unknown };

export function extractOutput(body: Record<string, unknown>): { url: string; type: 'video' | 'image' } | null {
  const asUrl = (m: unknown) => {
    const url = (m as Media | undefined)?.url;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  };
  const video = asUrl(body.video) ?? (Array.isArray(body.videos) ? asUrl(body.videos[0]) : null);
  if (video) return { url: video, type: 'video' };
  const image = asUrl(body.image) ?? (Array.isArray(body.images) ? asUrl(body.images[0]) : null);
  return image ? { url: image, type: 'image' } : null;
}

/** True only when fal accepted the cancel (a running or finished job answers with an error status). */
export async function falCancel(cancelUrl: string): Promise<boolean> {
  const res = await fetchWithTimeout(cancelUrl, { method: 'PUT', headers: falHeaders() }, 8_000).catch(() => null);
  return Boolean(res?.ok);
}

export function isPartner(id: EngineId): id is PartnerId {
  return id !== 'kinetix-pro';
}
