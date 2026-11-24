'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check, Copy, Heart, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import BeforeAfterWipe from '@/components/BeforeAfterWipe';
import { compileLocalDirectorPrompt, getEngine, RAW_PLATE, type VfxEffect } from '@/lib/vfx-data';
import { useApp } from '@/lib/client/store';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

export default function Lightbox({ shot, onClose }: { shot: VfxEffect; onClose: () => void }) {
  const { likes, toggleLike } = useApp();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const engine = getEngine(shot.engine);
  const compiled = compileLocalDirectorPrompt(shot.roughPrompt, shot.id).prompt;
  const liked = likes.includes(shot.id);
  const realRaw = shot.id === 'neon-overpass';

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(compiled);
      setCopied(true);
      playSfx('select');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (insecure context); nothing else to do
    }
  }

  return (
    <motion.div className="lb-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="lb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lb-title"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={SPRING}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="icon-btn lb-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <motion.div className="lb-media" layoutId={`shot-${shot.id}`} transition={SPRING}>
          <BeforeAfterWipe
            before={realRaw ? RAW_PLATE : shot.image}
            after={shot.image}
            simulateRaw={!realRaw}
            alt={`${shot.title}: raw versus graded`}
            style={{ aspectRatio: String(shot.ratio) }}
          />
        </motion.div>
        <div className="lb-side">
          <div>
            <span className="eyebrow">{shot.category} · Shot inspector</span>
            <h2 id="lb-title" className="display" style={{ fontSize: 30, marginTop: 8 }}>
              {shot.title}
            </h2>
            <p className="muted" style={{ marginTop: 4 }}>{shot.subtitle}</p>
          </div>
          <dl className="spec-list">
            <dt>Engine</dt>
            <dd>
              {engine.name} <span className="mono dim">· {engine.credits} CR</span>
            </dd>
            <dt>Camera</dt>
            <dd>{shot.camera}</dd>
            <dt>Light</dt>
            <dd>{shot.lighting}</dd>
            <dt>You typed</dt>
            <dd className="muted">“{shot.roughPrompt}”</dd>
          </dl>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Director prompt</div>
            <div className="prompt-box">{compiled}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
            <Link href={`/studio?shot=${shot.id}`} className="btn btn-lime" onClick={() => playSfx('select')}>
              <Wand2 size={16} /> Recreate in Studio
            </Link>
            <button type="button" className="btn btn-glass" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 44, height: 44, color: liked ? 'var(--lime)' : undefined }}
              aria-pressed={liked}
              aria-label={liked ? 'Remove from favourites' : 'Add to favourites'}
              onClick={() => {
                playSfx('tap');
                toggleLike(shot.id);
              }}
            >
              <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
