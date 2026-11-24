import type { Metadata } from 'next';
import PipelineGraph from '@/components/pipeline/PipelineGraph';
import CompilerSandbox from '@/components/pipeline/CompilerSandbox';
import Footer from '@/components/Footer';

export const metadata: Metadata = { title: 'How it works' };

export default function PipelinePage() {
  return (
    <main className="page" style={{ paddingBottom: 0 }}>
      <div className="wrap">
        <span className="eyebrow">How it works</span>
        <h1 className="display" style={{ fontSize: 'clamp(2.4rem, 6vw, 5rem)', marginTop: 12 }}>
          From rough idea <span className="serif">to graded MP4.</span>
        </h1>
        <p className="section-lede">What happens between your idea and your finished shot. Tap any step to see more.</p>
      </div>
      <PipelineGraph />
      <CompilerSandbox />
      <Footer />
    </main>
  );
}
