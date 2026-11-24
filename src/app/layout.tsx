import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import AuthSheet from '@/components/AuthSheet';
import { AppProvider } from '@/lib/client/store';

const display = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif' });
const body = Inter({ subsets: ['latin'], variable: '--font-body' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'KINETIX Studio — Recast reality. Direct cinema.', template: '%s · KINETIX Studio' },
  description:
    'AI cinema and VFX studio. Drop a clip and a portrait, describe the shot in English or Banglish, and the Director Agent writes it for Kinetix Pro, Kling, Veo, Seedance or WAN.',
  openGraph: {
    title: 'KINETIX Studio',
    description: 'Recast reality. Direct cinema.',
    images: [{ url: '/images/hero-cinema.jpg', width: 1280, height: 714 }],
    type: 'website',
  },
  twitter: { card: 'summary_large_image', images: ['/images/hero-cinema.jpg'] },
};

export const viewport: Viewport = { themeColor: '#1b202a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <AppProvider>
          <div className="film-grain" aria-hidden="true" />
          <Navbar />
          {children}
          <AuthSheet />
        </AppProvider>
      </body>
    </html>
  );
}
