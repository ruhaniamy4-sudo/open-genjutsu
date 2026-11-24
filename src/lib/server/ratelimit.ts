import { fetchWithTimeout } from './http';

const memory = new Map<string, { count: number; reset: number }>();

/**
 * Fixed-window rate limit. Uses Upstash Redis when configured (shared across instances),
 * otherwise an in-memory map. shortcut: memory mode is per serverless instance; set Upstash for real limits.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
      const res = await fetchWithTimeout(
        `${url.replace(/\/$/, '')}/pipeline`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([
            ['INCR', bucket],
            ['EXPIRE', bucket, String(windowSec)],
          ]),
        },
        3000,
      );
      if (res.ok) {
        const data = (await res.json()) as Array<{ result?: number }>;
        return (data[0]?.result ?? 0) <= limit;
      }
    } catch {
      // Redis unreachable: fall back to memory so the site keeps working.
    }
  }

  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.reset <= now) {
    if (memory.size > 5000) {
      for (const [k, v] of memory) if (v.reset <= now) memory.delete(k);
    }
    memory.set(key, { count: 1, reset: now + windowSec * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}
