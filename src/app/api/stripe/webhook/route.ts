import type Stripe from 'stripe';
import { serverConfig } from '@/lib/server/env';
import { json, jsonError } from '@/lib/server/http';
import { creditsFor, stripe } from '@/lib/server/stripe';
import { supabaseAdmin } from '@/lib/server/supabase';

async function grant(userId: string | undefined, plan: string | undefined, eventId: string) {
  const credits = plan ? creditsFor(plan) : 0;
  if (!userId || !credits) return;
  const { error } = await supabaseAdmin().rpc('add_credits', {
    p_user_id: userId,
    p_amount: credits,
    p_event_id: eventId,
    p_plan: plan,
  });
  if (error) throw new Error(error.message);
}

/** Subscription id on an invoice; the field moved between Stripe API versions. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const loose = invoice as unknown as {
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const sub = loose.parent?.subscription_details?.subscription ?? loose.subscription ?? null;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

export async function POST(req: Request) {
  if (!serverConfig().stripe) return jsonError(503, 'Payments are not enabled');
  const signature = req.headers.get('stripe-signature');
  if (!signature) return jsonError(400, 'Missing signature');

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, process.env.STRIPE_WEBHOOK_SECRET ?? '');
  } catch {
    return jsonError(400, 'Invalid signature');
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') await grant(session.metadata?.user_id, session.metadata?.plan, event.id);
    } else if (event.type === 'invoice.paid') {
      // First invoice is covered by checkout.session.completed; only renewals grant here.
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(invoice);
      if (invoice.billing_reason === 'subscription_cycle' && subId) {
        const sub = await stripe().subscriptions.retrieve(subId);
        await grant(sub.metadata?.user_id, sub.metadata?.plan, event.id);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.user_id) {
        await supabaseAdmin().from('profiles').update({ plan: 'free' }).eq('id', sub.metadata.user_id);
      }
    }
  } catch {
    // Non-2xx makes Stripe retry; add_credits is idempotent per event id.
    return jsonError(500, 'Webhook handling failed');
  }
  return json({ received: true });
}
