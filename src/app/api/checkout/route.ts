import { CheckoutRequestSchema } from '@/lib/api-types';
import { serverConfig } from '@/lib/server/env';
import { errorMessage, json, jsonError, readJson, zodMessage } from '@/lib/server/http';
import { priceFor, stripe } from '@/lib/server/stripe';
import { getRequestUser } from '@/lib/server/supabase';

export async function POST(req: Request) {
  if (!serverConfig().stripe) return jsonError(503, 'Payments are not enabled yet.');
  const parsed = CheckoutRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));
  const user = await getRequestUser(req);
  if (!user) return jsonError(401, 'Sign in to subscribe.', { code: 'AUTH_REQUIRED' });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const metadata = { user_id: user.id, plan: parsed.data.plan };
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceFor(parsed.data.plan), quantity: 1 }],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      success_url: `${origin}/library?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=canceled`,
    });
    if (!session.url) return jsonError(502, 'Stripe returned no checkout URL.');
    return json({ url: session.url });
  } catch (err) {
    return jsonError(502, errorMessage(err, 'Checkout failed'));
  }
}
