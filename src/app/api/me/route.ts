import { serverConfig } from '@/lib/server/env';
import { json, jsonError } from '@/lib/server/http';
import { getRequestUser, supabaseAdmin } from '@/lib/server/supabase';

export const dynamic = 'force-dynamic';

/** Signed-in user's balance, plan and latest renders. */
export async function GET(req: Request) {
  if (!serverConfig().supabase) return jsonError(404, 'Accounts are not enabled');
  const user = await getRequestUser(req);
  if (!user) return jsonError(401, 'Not signed in');

  const db = supabaseAdmin();
  const [{ data: profile, error: profileErr }, { data: generations, error: genErr }] = await Promise.all([
    db.from('profiles').select('credits,plan').eq('id', user.id).maybeSingle(),
    db
      .from('generations')
      .select('id,engine_id,credits_charged,rough_prompt,compiled_prompt,aspect,duration,status,output_url,output_type,job_token,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  if (profileErr || genErr) return jsonError(502, 'Could not load your account. Try again.');

  return json({
    email: user.email ?? null,
    credits: profile?.credits ?? 0,
    plan: profile?.plan ?? 'free',
    generations: generations ?? [],
  });
}
