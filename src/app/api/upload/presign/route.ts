import { randomUUID } from 'node:crypto';
import { PresignRequestSchema, UPLOAD_TYPES } from '@/lib/api-types';
import { serverConfig } from '@/lib/server/env';
import { clientIp, json, jsonError, readJson, zodMessage } from '@/lib/server/http';
import { presignObject } from '@/lib/server/r2';
import { rateLimit } from '@/lib/server/ratelimit';
import { getRequestUser } from '@/lib/server/supabase';

const EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(req: Request) {
  if (!(await rateLimit(`presign:${clientIp(req)}`, 20, 60))) return jsonError(429, 'Too many uploads. Wait a minute.');
  const parsed = PresignRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));
  const { kind, contentType, size } = parsed.data;

  const rule = UPLOAD_TYPES[kind];
  if (!(rule.types as readonly string[]).includes(contentType)) {
    return jsonError(415, kind === 'clip' ? 'Clips must be MP4, MOV or WebM.' : 'Portraits must be JPG, PNG or WebP.');
  }
  if (size > rule.maxBytes) {
    return jsonError(413, `File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB).`);
  }

  const cfg = serverConfig();
  // No bucket: the browser keeps the file locally for preview and the render runs in demo mode.
  if (!cfg.r2) return json({ mode: 'local' as const });

  let owner = 'anon';
  if (cfg.supabase) {
    const user = await getRequestUser(req);
    if (!user) return jsonError(401, 'Sign in to upload media.', { code: 'AUTH_REQUIRED' });
    owner = user.id;
  }

  const key = `uploads/${owner}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${EXT[contentType]}`;
  const { uploadUrl, readUrl } = await presignObject(key, contentType, size);
  return json({ mode: 'r2' as const, key, uploadUrl, readUrl, contentType });
}
