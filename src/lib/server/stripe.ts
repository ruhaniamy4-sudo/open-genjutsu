import Stripe from 'stripe';
import { PLANS, type PaidPlanId } from '@/lib/vfx-data';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY ?? '');
  return client;
}

export function priceFor(plan: PaidPlanId): string {
  return (plan === 'creator' ? process.env.STRIPE_PRICE_CREATOR : process.env.STRIPE_PRICE_PRO) ?? '';
}

export function creditsFor(plan: string): number {
  return PLANS.find((p) => p.id === plan && p.id !== 'free')?.credits ?? 0;
}
