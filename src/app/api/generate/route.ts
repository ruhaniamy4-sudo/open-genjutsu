import { randomUUID } from 'node:crypto';
import { GenerateRequestSchema, type GenerateResponse } from '@/lib/api-types';
import { getEngine, type Aspect, type Duration, type EngineId } from '@/lib/vfx-data';
import { serverConfig } from '@/lib/server/env';
import { buildFalInput, falEndpoint, falSubmit, isPartner } from '@/lib/server/fal';
import { gpuHeaders, resolveGpuTarget, userGpuToken } from '@/lib/server/gpu';
import { clientIp, errorMessage, fetchWithTimeout, json, jsonError, readJson, zodMessage } from '@/lib/server/http';
import { encodeJob, type JobToken } from '@/lib/server/jobs';
import { r2Host } from '@/lib/server/r2';
import { rateLimit } from '@/lib/server/ratelimit';
import { getRequestUser, settleGeneration, supabaseAdmin } from '@/lib/server/supabase';

type Route = { kind: 'demo' } | { kind: 'fal' } | { kind: 'gpu'; base: string };

export async function POST(req: Request) {
  if (!(await rateLimit(`generate:${clientIp(req)}`, 12, 60))) {
    return jsonError(429, 'Too many renders started. Wait a minute and try again.');
  }
  const parsed = GenerateRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));
  const body = parsed.data;
  const cfg = serverConfig();
  const engine = getEngine(body.engineId);
  const engineId = engine.id as EngineId;

  // Uploaded media must come from our own bucket when uploads are live (the GPU worker downloads it).
  if (cfg.r2) {
    for (const u of [body.clipUrl, body.faceUrl]) {
      if (u && new URL(u).hostname !== r2Host()) return jsonError(400, 'Media must be uploaded through KINETIX.');
    }
  }

  const user = cfg.supabase ? await getRequestUser(req) : null;
  if (cfg.supabase && !user) return jsonError(401, 'Sign in to start a render.', { code: 'AUTH_REQUIRED' });

  // Pick where the job runs. Demo simulation is only used when billing is off (no Supabase).
  let route: Route;
  if (!isPartner(engineId)) {
    const target = resolveGpuTarget(body.gpuUrl);
    if (target && !target.ok) return jsonError(400, target.error);
    if (target?.ok) route = { kind: 'gpu', base: target.base };
    else if (!cfg.supabase) route = { kind: 'demo' };
    else return jsonError(503, 'The Kinetix GPU worker is offline right now. Pick a partner engine or try later.');
  } else if (cfg.partnersLive) {
    route = { kind: 'fal' };
  } else if (!cfg.supabase) {
    route = { kind: 'demo' };
  } else {
    return jsonError(503, 'Partner engines are not configured on this server.');
  }

  // Charge first (atomic deduct + generation row), refund if dispatch fails.
  let generationId: string | undefined;
  let remaining: number | null = null;
  if (user) {
    const { data, error } = await supabaseAdmin().rpc('start_generation', {
      p_user_id: user.id,
      p_engine: engineId,
      p_credits: engine.credits,
      p_rough: body.roughIdea,
      p_compiled: body.prompt,
      p_aspect: body.aspect,
      p_duration: body.duration,
    });
    if (error) {
      if (error.message.includes('INSUFFICIENT_CREDITS')) {
        return jsonError(402, 'Not enough credits for this engine.', { code: 'INSUFFICIENT_CREDITS' });
      }
      return jsonError(500, 'Could not reserve credits. Try again.');
    }
    const row = (Array.isArray(data) ? data[0] : data) as { generation_id: string; remaining: number } | undefined;
    if (!row?.generation_id) return jsonError(500, 'Could not reserve credits. Try again.');
    generationId = row.generation_id;
    remaining = row.remaining;
  }

  const base: Omit<JobToken, 'p' | 'id'> = { v: 1, e: engineId, t: Date.now(), fx: body.effectId, gen: generationId };
  let token: JobToken;
  try {
    if (route.kind === 'demo') {
      token = { ...base, p: 'demo', id: randomUUID() };
    } else if (route.kind === 'gpu') {
      const res = await fetchWithTimeout(
        `${route.base}/api/kinetix/submit`,
        {
          method: 'POST',
          headers: gpuHeaders(route.base, userGpuToken(req)),
          body: JSON.stringify({
            prompt: body.prompt,
            aspect: body.aspect,
            duration: body.duration,
            boosters: body.boosters,
            clipUrl: body.clipUrl ?? null,
            faceUrl: body.faceUrl ?? null,
          }),
        },
        30_000,
      );
      const data = (await res.json().catch(() => ({}))) as { job_id?: string; error?: string; detail?: unknown };
      if (!res.ok || !data.job_id) {
        const reason = data.error || (typeof data.detail === 'string' ? data.detail : `status ${res.status}`);
        throw new Error(`GPU worker rejected the job: ${reason}`);
      }
      token = { ...base, p: 'gpu', id: String(data.job_id), g: route.base };
    } else {
      const partner = engineId as Exclude<EngineId, 'kinetix-pro'>;
      const endpoint = falEndpoint(partner, Boolean(body.faceUrl));
      const sub = await falSubmit(
        endpoint,
        buildFalInput(partner, {
          prompt: body.prompt,
          aspect: body.aspect as Aspect,
          duration: body.duration as Duration,
          imageUrl: body.faceUrl,
        }),
      );
      token = { ...base, p: 'fal', id: sub.requestId, s: sub.statusUrl, r: sub.responseUrl, c: sub.cancelUrl };
    }
  } catch (err) {
    const message = errorMessage(err, 'Dispatch failed');
    let refunded = 0;
    if (generationId) refunded = await settleGeneration(generationId, 'failed', null, null, message).catch(() => 0);
    return jsonError(502, message, { refunded, remaining: remaining !== null ? remaining + refunded : null });
  }

  const jobToken = encodeJob(token);
  if (generationId) {
    await supabaseAdmin()
      .from('generations')
      .update({ status: 'running', provider: token.p, provider_job_id: token.id, job_token: jobToken })
      .eq('id', generationId);
  }

  const response: GenerateResponse = {
    jobToken,
    provider: token.p,
    billing: cfg.billing,
    creditsCharged: engine.credits,
    remaining,
  };
  return json(response);
}
