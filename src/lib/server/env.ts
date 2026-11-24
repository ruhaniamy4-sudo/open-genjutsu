import type { PublicConfig } from '@/lib/api-types';

/** Server-side feature detection. Every integration is optional; missing keys switch that part to demo. */
export function serverConfig() {
  const e = process.env;
  const supabase = Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY && e.SUPABASE_SERVICE_ROLE_KEY);
  const director: PublicConfig['director'] = e.GEMINI_API_KEY
    ? 'gemini'
    : e.OPENROUTER_API_KEY
      ? 'openrouter'
      : e.OPENAI_API_KEY
        ? 'openai'
        : 'local';
  const fal = Boolean(e.FAL_KEY);
  const allowAnonLive = e.KINETIX_ALLOW_ANON_LIVE === 'true';
  const r2 = Boolean(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET_NAME);
  const stripe = Boolean(
    supabase && e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET && e.STRIPE_PRICE_CREATOR && e.STRIPE_PRICE_PRO,
  );
  return {
    supabase,
    director,
    fal,
    allowAnonLive,
    /** Paid partner calls need real billing (or an explicit opt-in) so anonymous visitors cannot spend your fal balance. */
    partnersLive: fal && (supabase || allowAnonLive),
    gpuDefault: Boolean(e.KINETIX_GPU_URL?.trim()),
    r2,
    stripe,
    billing: (supabase ? 'credits' : 'demo') as PublicConfig['billing'],
  };
}

export function publicConfig(): PublicConfig {
  const c = serverConfig();
  return {
    billing: c.billing,
    director: c.director,
    partnersLive: c.partnersLive,
    gpuDefault: c.gpuDefault,
    uploads: c.r2,
    checkout: c.stripe,
  };
}
