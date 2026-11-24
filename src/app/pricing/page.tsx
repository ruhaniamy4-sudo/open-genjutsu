import type { Metadata } from 'next';
import { Suspense } from 'react';
import PricingClient from '@/components/pricing/PricingClient';
import Footer from '@/components/Footer';

export const metadata: Metadata = { title: 'Pricing' };

export default function PricingPage() {
  return (
    <main className="page" style={{ paddingBottom: 0 }}>
      <Suspense>
        <PricingClient />
      </Suspense>
      <Footer />
    </main>
  );
}
