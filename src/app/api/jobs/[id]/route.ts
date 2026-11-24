import { isTerminal, stageFor, type JobStatus } from '@/lib/api-types';
import { getEffect } from '@/lib/vfx-data';
import { serverConfig } from '@/lib/server/env';
import { falCancel, falPoll } from '@/lib/server/fal';
import { gpuHeaders, resolveGpuTarget, userGpuToken } from '@/lib/server/gpu';
import { errorMessage, fetchWithTimeout, json, jsonError } from '@/lib/server/http';
import { DEMO_RENDER_MS, decodeJob, type JobToken } from '@/lib/server/jobs';
import { getRequestUser, settleGeneration, supabaseAdmin, type GenerationRow } from '@/lib/server/supabase';

type Ctx = { params: Promise<{ id: string }> };

const EMPTY: Omit<JobStatus, 'status'> = {
  progress: null,
  stage: null,
  queuePosition: null,
  outputUrl: null,
  outputType: null,
  error: null,
};

/** Loads the job and, when billing is on, checks the signed-in user owns it. */
async function authorize(req: Request, raw: string) {
  const token = decodeJob(raw);
  if (!token) return { error: jsonError(400, 'Invalid job handle') } as const;
  const cfg = serverConfig();
  if (!cfg.supabase || token.p === 'demo') return { token, gen: null } as const;

  const user = await getRequestUser(req);
  if (!user) return { error: jsonError(401, 'Sign in to view this render.') } as const;
  if (!token.gen) return { error: jsonError(400, 'Invalid job handle') } as const;
  const { data } = await supabaseAdmin()
    .from('generations')
    .select('id,user_id,status,output_url,output_type,error,credits_charged')
    .eq('id', token.gen)
    .maybeSingle();
  const gen = data as GenerationRow | null;
  if (!gen || gen.user_id !== user.id) return { error: jsonError(404, 'Render not found') } as const;
  return { token, gen } as const;
}

function fromRow(gen: GenerationRow): JobStatus {
  return {
    ...EMPTY,
    status: gen.status as JobStatus['status'],
    progress: gen.status === 'completed' ? 1 : null,
    outputUrl: gen.output_url,
    outputType: (gen.output_type as JobStatus['outputType']) ?? null,
    error: gen.error,
  };
}

function demoStatus(token: JobToken): JobStatus {
  const p = Math.min(1, (Date.now() - token.t) / DEMO_RENDER_MS);
  if (p >= 1) {
    return { ...EMPTY, status: 'completed', progress: 1, outputUrl: getEffect(token.fx).image, outputType: 'image', demo: true };
  }
  return { ...EMPTY, status: p < 0.08 ? 'queued' : 'running', progress: p, stage: stageFor(p), demo: true };
}

/** Rough progress for providers that report none: eases toward 95% over ~2 minutes. */
function estimate(token: JobToken): number {
  const elapsed = (Date.now() - token.t) / 1000;
  return Math.min(0.95, 1 - Math.exp(-elapsed / 60));
}

async function falStatus(token: JobToken): Promise<JobStatus> {
  if (!token.s || !token.r) return { ...EMPTY, status: 'failed', error: 'Invalid fal job' };
  const r = await falPoll(token.s, token.r);
  if (r.state === 'queued') return { ...EMPTY, status: 'queued', queuePosition: r.position, progress: 0, stage: 'Queued' };
  if (r.state === 'running') {
    const p = estimate(token);
    return { ...EMPTY, status: 'running', progress: p, stage: stageFor(p) };
  }
  if (r.state === 'failed') return { ...EMPTY, status: 'failed', error: r.error };
  return { ...EMPTY, status: 'completed', progress: 1, outputUrl: r.url, outputType: r.type };
}

interface BridgeStatus {
  status?: string;
  progress?: number | null;
  stage?: string | null;
  queue_position?: number | null;
  output_url?: string | null;
  output_type?: 'video' | 'image' | null;
  error?: string | null;
}

async function gpuStatus(token: JobToken, userToken: string | null): Promise<JobStatus> {
  const target = resolveGpuTarget(token.g);
  if (!target?.ok) return { ...EMPTY, status: 'failed', error: 'GPU worker URL is no longer allowed' };
  const res = await fetchWithTimeout(
    `${target.base}/api/kinetix/status/${encodeURIComponent(token.id)}`,
    { headers: gpuHeaders(target.base, userToken) },
    10_000,
  );
  if (!res.ok) {
    if (res.status >= 500) return { ...EMPTY, status: 'running', progress: estimate(token), stage: 'Reconnecting' };
    return { ...EMPTY, status: 'failed', error: `GPU worker answered ${res.status}` };
  }
  const d = (await res.json()) as BridgeStatus;
  switch (d.status) {
    case 'queued':
      return { ...EMPTY, status: 'queued', progress: 0, stage: 'Queued', queuePosition: d.queue_position ?? null };
    case 'running': {
      const p = typeof d.progress === 'number' ? d.progress : estimate(token);
      return { ...EMPTY, status: 'running', progress: p, stage: d.stage || stageFor(p) };
    }
    case 'completed': {
      // Only accept outputs served by the same worker.
      let outputUrl: string | null = null;
      if (d.output_url) {
        const u = new URL(d.output_url, target.base);
        if (u.origin === target.base) outputUrl = u.toString();
      }
      if (!outputUrl) return { ...EMPTY, status: 'failed', error: 'Worker finished without an output file' };
      return { ...EMPTY, status: 'completed', progress: 1, outputUrl, outputType: d.output_type ?? 'video' };
    }
    case 'failed':
      return { ...EMPTY, status: 'failed', error: d.error || 'Render failed on the GPU worker' };
    default:
      return { ...EMPTY, status: 'failed', error: 'The GPU worker lost this job (it may have restarted).' };
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authorize(req, (await ctx.params).id);
  if ('error' in auth) return auth.error;
  const { token, gen } = auth;
  if (gen && isTerminal(gen.status)) return json(fromRow(gen));

  let status: JobStatus;
  try {
    status = token.p === 'demo' ? demoStatus(token) : token.p === 'fal' ? await falStatus(token) : await gpuStatus(token, userGpuToken(req));
  } catch (err) {
    // Network blips should not fail (and refund) a render that may still be running.
    return json<JobStatus>({ ...EMPTY, status: 'running', progress: estimate(token), stage: 'Reconnecting', error: errorMessage(err, 'Poll failed') });
  }

  if (gen && isTerminal(status.status)) {
    status.refunded = await settleGeneration(gen.id, status.status, status.outputUrl, status.outputType, status.error);
  }
  return json(status);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authorize(req, (await ctx.params).id);
  if ('error' in auth) return auth.error;
  const { token, gen } = auth;
  if (gen && isTerminal(gen.status)) return json(fromRow(gen));

  if (token.p === 'fal' && token.c) {
    const accepted = await falCancel(token.c);
    if (!accepted) {
      // fal refused: the job already runs or finished. Report its real state; never refund a render that may complete.
      let status: JobStatus;
      try {
        status = await falStatus(token);
      } catch {
        return json<JobStatus>({ ...EMPTY, status: 'running', progress: estimate(token), stage: 'Could not cancel: render already started' });
      }
      if (gen && isTerminal(status.status)) {
        status.refunded = await settleGeneration(gen.id, status.status, status.outputUrl, status.outputType, status.error);
      }
      return json(status);
    }
  }
  if (token.p === 'gpu') {
    const target = resolveGpuTarget(token.g);
    if (target?.ok) {
      await fetchWithTimeout(
        `${target.base}/api/kinetix/cancel/${encodeURIComponent(token.id)}`,
        { method: 'POST', headers: gpuHeaders(target.base, userGpuToken(req)) },
        8_000,
      ).catch(() => undefined);
    }
  }
  const refunded = gen ? await settleGeneration(gen.id, 'canceled', null, null, 'Canceled by user') : 0;
  return json<JobStatus>({ ...EMPTY, status: 'canceled', refunded });
}
