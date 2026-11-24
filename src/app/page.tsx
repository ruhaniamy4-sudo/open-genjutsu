import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Hero from '@/components/explore/Hero';
import PresetBand from '@/components/explore/PresetBand';
import Feed from '@/components/explore/Feed';
import DirectorDemo from '@/components/explore/DirectorDemo';
import BeforeAfterWipe from '@/components/BeforeAfterWipe';
import Footer from '@/components/Footer';
import { ENGINES, RAW_PLATE } from '@/lib/vfx-data';

export default function ExplorePage() {
  return (
    <main>
      <Hero />
      <PresetBand />
      <Feed />

      <section className="section wrap" aria-labelledby="grade-title">
        <div className="section-head">
          <div>
            <span className="eyebrow">Before / after</span>
            <h2 id="grade-title" className="display section-title" style={{ marginTop: 10 }}>
              Flat log plate in. <span className="serif">Graded cinema out.</span>
            </h2>
            <p className="section-lede">Move across the frame. Skin and neon stay clean and free of banding, then a filmic grade finishes the shot.</p>
          </div>
        </div>
        <BeforeAfterWipe before={RAW_PLATE} after="/images/hero-cinema.jpg" alt="Raw S-Log3 plate versus Kinetix graded output" style={{ aspectRatio: '1280 / 714', borderRadius: 18 }} />
      </section>

      <DirectorDemo />

      <section className="section wrap" aria-labelledby="models-title">
        <div className="section-head">
          <div>
            <span className="eyebrow">One studio, five engines</span>
            <h2 id="models-title" className="display section-title" style={{ marginTop: 10 }}>
              Pick the model. <span className="serif">Keep the director.</span>
            </h2>
          </div>
          <Link href="/pricing" className="btn btn-text">
            Compare credits <ArrowRight size={15} />
          </Link>
        </div>
        <div className="models">
          {ENGINES.map((e) => (
            <span key={e.id} className="model-name" style={e.id === 'kinetix-pro' ? { color: 'var(--ink)' } : undefined}>
              {e.name}
              <small>{e.credits} CR</small>
            </span>
          ))}
        </div>
      </section>

      <section className="section wrap" style={{ textAlign: 'center' }}>
        <h2 className="display" style={{ fontSize: 'clamp(2.2rem, 6vw, 5rem)' }}>
          Your next shot <span className="serif">starts here.</span>
        </h2>
        <Link href="/studio" className="btn btn-lime" style={{ marginTop: 28 }}>
          Open Studio <ArrowRight size={16} />
        </Link>
      </section>

      <Footer />
    </main>
  );
}
