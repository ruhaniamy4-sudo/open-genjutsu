import type { NextRequest } from 'next/server';
import { fetchWithTimeout, json } from '@/lib/server/http';
import { resolveGpuTarget } from '@/lib/server/gpu';
import { clientIp } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/ratelimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const target = resolveGpuTarget(req.nextUrl.searchParams.get('gpu'));
  if (!target) return json({ online: false, reason: 'No GPU worker connected' });
  if (!target.ok) return json({ online: false, reason: target.error });
  if (!(await rateLimit(`ping:${clientIp(req)}`, 30, 60))) return json({ online: false, reason: 'Rate limited' });

  try {
    const res = await fetchWithTimeout(`${target.base}/health`, {}, 5000);
    if (!res.ok) return json({ online: false, reason: `Worker answered ${res.status}` });
    const stats = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const gpu = (stats.gpu ?? null) as { name?: string; vram_total_mb?: number; vram_used_mb?: number } | null;
    return json({
      online: true,
      comfy: stats.comfy !== false,
      workflowLoaded: stats.workflow_loaded !== false,
      gpu: gpu?.name ? { name: gpu.name, vramTotalMb: gpu.vram_total_mb ?? null, vramUsedMb: gpu.vram_used_mb ?? null } : null,
      queue: stats.queue ?? null,
    });
  } catch {
    return json({ online: false, reason: 'Worker unreachable' });
  }
}
