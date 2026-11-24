'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { PRESETS } from '@/lib/vfx-data';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

export default function PresetBand() {
  return (
    <section className="section wrap" aria-labelledby="presets-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">Cinema presets</span>
          <h2 id="presets-title" className="display section-title" style={{ marginTop: 10 }}>
            One tap. <span className="serif">A whole look.</span>
          </h2>
        </div>
        <Link href="/studio" className="btn btn-text" onClick={() => playSfx('tap')}>
          Open Studio <ArrowRight size={15} />
        </Link>
      </div>
      <div className="preset-band">
        {PRESETS.map((fx, i) => (
          <motion.div
            key={fx.id}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ ...SPRING, delay: i * 0.06 }}
            style={{ display: 'contents' }}
          >
            <Link href={`/studio?effect=${fx.id}`} className="preset-card" onClick={() => playSfx('select')}>
              <img src={fx.image} alt="" loading="lazy" />
              <span className="preset-try btn btn-glass btn-sm">Try effect</span>
              <div className="preset-info">
                <h3>{fx.title}</h3>
                <p>{fx.subtitle}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
