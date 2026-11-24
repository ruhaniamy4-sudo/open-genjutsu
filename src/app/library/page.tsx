import type { Metadata } from 'next';
import { Suspense } from 'react';
import LibraryClient from '@/components/library/LibraryClient';
import Footer from '@/components/Footer';

export const metadata: Metadata = { title: 'Library' };

export default function LibraryPage() {
  return (
    <main className="page" style={{ paddingBottom: 0 }}>
      <Suspense>
        <LibraryClient />
      </Suspense>
      <Footer />
    </main>
  );
}
