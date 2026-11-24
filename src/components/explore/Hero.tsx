'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getEffect } from '@/lib/vfx-data';
import { playSfx } from '@/lib/sfx';
import { EASE, SPRING } from '@/lib/motion';

const SLIDES = [
  { id: 'neon-overpass', line1: 'Recast reality.', line2: 'Direct cinema.' },
  { id: 'shibuya-ronin', line1: 'Any clip.', line2: 'Any character.' },
  { id: 'desert-drift', line1: 'Four words in.', line2: 'A shot out.' },
].map((s) => ({ ...s, fx: getEffect(s.id) }));

const SLIDE_MS = 6500;

export default function Hero() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SLIDES.length), SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, paused]);

  const slide = SLIDES[i];

  return (
    <section className="hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carousel" aria-label="Featured shots">
      <AnimatePresence initial={false}>
        <motion.div
          key={slide.id}
          className="hero-media"
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1.0 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.1, ease: EASE }, scale: { duration: SLIDE_MS / 1000 + 1.2, ease: 'linear' } }}
        >
          <img src={slide.fx.image} alt={slide.fx.title} fetchPriority={i === 0 ? 'high' : 'auto'} />
        </motion.div>
      </AnimatePresence>
      <div className="hero-scrim" />

      <div className="hero-copy wrap">
        <AnimatePresence mode="wait">
          <motion.h1
            key={slide.id}
            className="display hero-title"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={SPRING}
          >
            {slide.line1}
            <br />
            <span className="serif">{slide.line2}</span>
          </motion.h1>
        </AnimatePresence>
        <p className="hero-sub">Drop a clip and a portrait. Say what you want in English or Banglish. Our Director Agent writes the shot.</p>
        <div className="hero-ctas">
          <Link href="/studio" className="btn btn-lime" onClick={() => playSfx('select')}>
            Start creating <ArrowRight size={16} />
          </Link>
          <Link href={`/studio?shot=${slide.fx.id}`} className="btn btn-glass" onClick={() => playSfx('tap')}>
            Recreate this shot
          </Link>
        </div>
      </div>

      <div className="filmstrip" role="tablist" aria-label="Choose featured shot">
        {SLIDES.map((s, n) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={n === i}
            aria-label={s.fx.title}
            className={`film-thumb${n === i ? ' on' : ''}`}
            onClick={() => {
              playSfx('tap');
              setI(n);
            }}
          >
            <img src={s.fx.image} alt="" />
            <span>{s.fx.title}</span>
            {n === i && (
              <motion.i
                key={`${s.id}-${paused}`}
                className="film-progress"
                initial={{ width: '0%' }}
                animate={{ width: paused ? '0%' : '100%' }}
                transition={{ duration: paused ? 0.2 : SLIDE_MS / 1000, ease: 'linear' }}
              />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
