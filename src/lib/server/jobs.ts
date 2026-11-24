import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ENGINE_IDS, type EngineId } from '@/lib/vfx-data';

const FAL_QUEUE = 'https://queue.fal.run/';
const falUrl = z
  .string()
  .max(1000)
  .refine((v) => v.startsWith(FAL_QUEUE), 'Not a fal queue URL');

/**
 * Stateless job handle given to the browser. It carries only routing data (no secrets).
 * Everything in it is re-validated on use: fal URLs must be on queue.fal.run, the GPU URL goes
 * through the SSRF allowlist, and `gen` ownership is checked against the signed-in user.
 */
const JobTokenSchema = z.object({
  v: z.literal(1),
  p: z.enum(['demo', 'fal', 'gpu']),
  id: z.string().min(1).max(200),
  e: z.enum(ENGINE_IDS as [string, ...string[]]),
  t: z.number().int().positive(),
  fx: z.string().max(64).optional(),
  g: z.string().max(300).optional(),
  s: falUrl.optional(),
  r: falUrl.optional(),
  c: falUrl.optional(),
  gen: z.string().uuid().optional(),
});

export type JobToken = Omit<z.infer<typeof JobTokenSchema>, 'e'> & { e: EngineId };

/** Tokens are HMAC-signed so a client cannot forge or edit one (engine, owner, fal URLs). Set KINETIX_JOB_SECRET in production. */
function sign(payload: string): string {
  const secret = process.env.KINETIX_JOB_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'kinetix-dev-secret';
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeJob(token: JobToken): string {
  const payload = Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeJob(raw: string): JobToken | null {
  if (!raw || raw.length > 4200) return null;
  try {
    const [payload, sig, extra] = raw.split('.');
    if (!payload || !sig || extra !== undefined) return null;
    const want = Buffer.from(sign(payload));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const parsed = JobTokenSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.success ? (parsed.data as JobToken) : null;
  } catch {
    return null;
  }
}

/** Demo renders finish after this long (simulated pipeline). */
export const DEMO_RENDER_MS = 14_000;
