import { z } from 'zod';
import { ASPECTS, DURATIONS, ENGINE_IDS } from './vfx-data';

const isHttpsUrl = (v: string) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

const httpsUrl = z.string().max(2048).refine(isHttpsUrl, 'Must be an https URL');

export const BoostersSchema = z
  .object({
    fp16Vae: z.boolean().default(true),
    faceRefine: z.boolean().default(true),
    orionDctl: z.boolean().default(true),
  })
  .default({ fp16Vae: true, faceRefine: true, orionDctl: true });

export const EnhanceRequestSchema = z.object({
  roughIdea: z.string().trim().min(1, 'Describe your scene first').max(2000),
  effectId: z.string().max(64).default('character-swap'),
  /** First frame of the uploaded clip as a data URL (jpeg/png/webp), max ~1.1 MB of base64. */
  frame0Base64: z
    .string()
    .max(1_500_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Invalid frame image')
    .optional(),
  boosters: BoostersSchema,
});

export const GenerateRequestSchema = z.object({
  engineId: z.enum(ENGINE_IDS as [string, ...string[]]),
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000),
  roughIdea: z.string().max(2000).default(''),
  effectId: z.string().max(64).default('character-swap'),
  aspect: z.enum(ASPECTS as [string, ...string[]]).default('16:9'),
  duration: z.enum(DURATIONS as [string, ...string[]]).default('7s'),
  boosters: BoostersSchema,
  gpuUrl: z.string().max(300).optional(),
  clipUrl: httpsUrl.optional(),
  faceUrl: httpsUrl.optional(),
});

export const UPLOAD_TYPES = {
  clip: { types: ['video/mp4', 'video/quicktime', 'video/webm'], maxBytes: 500 * 1024 * 1024 },
  face: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 20 * 1024 * 1024 },
} as const;

export const PresignRequestSchema = z.object({
  kind: z.enum(['clip', 'face']),
  filename: z.string().min(1).max(200),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

export const CheckoutRequestSchema = z.object({
  plan: z.enum(['creator', 'pro']),
});

export type EnhanceRequest = z.input<typeof EnhanceRequestSchema>;
export type GenerateRequest = z.input<typeof GenerateRequestSchema>;

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface JobStatus {
  status: JobState;
  /** 0..1, or null when the provider gives no progress. */
  progress: number | null;
  stage: string | null;
  queuePosition: number | null;
  outputUrl: string | null;
  outputType: 'video' | 'image' | null;
  error: string | null;
  demo?: boolean;
  refunded?: number;
}

export interface GenerateResponse {
  jobToken: string;
  provider: 'demo' | 'fal' | 'gpu';
  billing: 'credits' | 'demo';
  creditsCharged: number;
  /** Server balance after charging (credits billing only). */
  remaining: number | null;
}

export interface EnhanceResponse {
  source: 'gemini' | 'openrouter' | 'openai' | 'local';
  prompt: string;
  camera: string;
  lighting: string;
  params: Record<string, string | number>;
}

export interface PublicConfig {
  billing: 'credits' | 'demo';
  director: 'gemini' | 'openrouter' | 'openai' | 'local';
  partnersLive: boolean;
  gpuDefault: boolean;
  uploads: boolean;
  checkout: boolean;
}

export function isTerminal(s: string | null | undefined): s is 'completed' | 'failed' | 'canceled' {
  return s === 'completed' || s === 'failed' || s === 'canceled';
}

/** Stage label for a 0..1 progress fraction (same mapping as the GPU bridge). */
export function stageFor(p: number): string {
  if (p < 0.25) return 'Tracking';
  if (p < 0.6) return 'Synthesis';
  if (p < 0.85) return 'FaceRefine';
  return 'Color Grade';
}
