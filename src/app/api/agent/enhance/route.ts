import { EnhanceRequestSchema, type EnhanceResponse } from '@/lib/api-types';
import { compileLocalDirectorPrompt } from '@/lib/vfx-data';
import { runDirector } from '@/lib/server/director';
import { clientIp, json, jsonError, readJson, zodMessage } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/ratelimit';

export async function POST(req: Request) {
  if (!(await rateLimit(`enhance:${clientIp(req)}`, 30, 60))) {
    return jsonError(429, 'Too many Director requests. Wait a minute and try again.');
  }
  const parsed = EnhanceRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));
  const { roughIdea, effectId, boosters, frame0Base64 } = parsed.data;

  const local = compileLocalDirectorPrompt(roughIdea, effectId, boosters);
  const llm = await runDirector(roughIdea, effectId, boosters, frame0Base64);

  const body: EnhanceResponse = llm
    ? {
        source: llm.source,
        prompt: llm.result.prompt,
        camera: llm.result.camera || local.camera,
        lighting: llm.result.lighting || local.lighting,
        params: local.params,
      }
    : { source: 'local', prompt: local.prompt, camera: local.camera, lighting: local.lighting, params: local.params };
  return json(body);
}
