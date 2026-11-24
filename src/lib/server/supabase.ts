import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

let admin: SupabaseClient | null = null;

/** Service-role client. Server only: bypasses RLS. */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

/** Verifies the `Authorization: Bearer <supabase access token>` header. */
export async function getRequestUser(req: Request): Promise<User | null> {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!match) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(match[1]);
  if (error || !data.user) return null;
  return data.user;
}

export interface GenerationRow {
  id: string;
  user_id: string;
  status: string;
  output_url: string | null;
  output_type: string | null;
  error: string | null;
  credits_charged: number;
}

/** Marks a generation terminal. Refunds credits on failed/canceled (idempotent in SQL). Returns refunded credits. */
export async function settleGeneration(
  id: string,
  status: 'completed' | 'failed' | 'canceled',
  outputUrl: string | null,
  outputType: string | null,
  error: string | null,
): Promise<number> {
  const { data, error: rpcError } = await supabaseAdmin().rpc('settle_generation', {
    p_id: id,
    p_status: status,
    p_output_url: outputUrl,
    p_output_type: outputType,
    p_error: error,
  });
  if (rpcError) throw new Error(`settle_generation failed: ${rpcError.message}`);
  return typeof data === 'number' ? data : 0;
}
