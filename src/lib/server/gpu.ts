export type GpuTarget = { ok: true; base: string } | { ok: false; error: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function allowedHosts(): string[] {
  const list = (process.env.KINETIX_GPU_ALLOWED_HOSTS || '.trycloudflare.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const def = process.env.KINETIX_GPU_URL?.trim();
  if (def) {
    try {
      list.push(new URL(def).hostname.toLowerCase());
    } catch {
      // ignore a malformed default; it simply is not allowlisted
    }
  }
  return list;
}

export function hostAllowed(host: string, rules: string[]): boolean {
  return rules.some((rule) => (rule.startsWith('.') ? host.endsWith(rule) && host.length > rule.length : host === rule));
}

/**
 * Resolve the GPU bridge base URL from a user value (?gpu=) or KINETIX_GPU_URL.
 * Guards against SSRF: https only, no IP literals, no credentials, host must be allowlisted.
 * Returns null when no GPU URL is configured at all.
 */
export function resolveGpuTarget(input?: string | null): GpuTarget | null {
  const raw = (input || process.env.KINETIX_GPU_URL || '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'GPU URL is not a valid URL.' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    return process.env.NODE_ENV === 'production'
      ? { ok: false, error: 'Local GPU URLs only work in development.' }
      : { ok: true, base: url.origin };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'GPU URL must use https.' };
  if (url.username || url.password) return { ok: false, error: 'GPU URL must not contain credentials.' };
  if (IPV4.test(host) || host.includes(':') || host.startsWith('[')) {
    return { ok: false, error: 'Use your tunnel hostname, not an IP address.' };
  }
  if (!hostAllowed(host, allowedHosts())) {
    return { ok: false, error: `${host} is not on the GPU allowlist (KINETIX_GPU_ALLOWED_HOSTS).` };
  }
  return { ok: true, base: url.origin };
}

/**
 * Headers for a call to the GPU bridge at `base`.
 * The server's KINETIX_GPU_TOKEN is only ever sent to the configured KINETIX_GPU_URL origin,
 * never to a user-supplied tunnel. A user's own worker token (x-gpu-token) goes only to the worker they chose.
 */
export function gpuHeaders(base: string, userToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = userToken?.trim();
  if (user && /^[!-~]{1,200}$/.test(user)) {
    headers.Authorization = `Bearer ${user}`;
    return headers;
  }
  const envToken = process.env.KINETIX_GPU_TOKEN;
  let envOrigin: string | null = null;
  try {
    envOrigin = process.env.KINETIX_GPU_URL ? new URL(process.env.KINETIX_GPU_URL).origin : null;
  } catch {
    envOrigin = null;
  }
  if (envToken && envOrigin === base) headers.Authorization = `Bearer ${envToken}`;
  return headers;
}

export function userGpuToken(req: Request): string | null {
  return req.headers.get('x-gpu-token');
}
