import type { Metadata } from 'next';
import { Suspense } from 'react';
import StudioClient from '@/components/studio/StudioClient';

export const metadata: Metadata = { title: 'Studio' };

export default function StudioPage() {
  return (
    <Suspense fallback={<main className="studio" aria-busy="true" />}>
      <StudioClient />
    </Suspense>
  );
}
