'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, Search, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import Lightbox from './Lightbox';
import { CATEGORIES, VFX_EFFECTS, getEngine, type VfxEffect } from '@/lib/vfx-data';
import { useApp } from '@/lib/client/store';
import { balance, useColumnCount } from '@/lib/client/useColumns';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

const FILTERS = ['All', ...CATEGORIES, 'Liked'] as const;
type Filter = (typeof FILTERS)[number];

export default function Feed() {
  const { likes, toggleLike } = useApp();
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<VfxEffect | null>(null);
  const cols = useColumnCount();

  const shots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VFX_EFFECTS.filter((fx) => {
      if (filter === 'Liked' && !likes.includes(fx.id)) return false;
      if (filter !== 'All' && filter !== 'Liked' && fx.category !== filter) return false;
      if (!q) return true;
      return [fx.title, fx.subtitle, fx.camera, fx.lighting, fx.category].some((s) => s.toLowerCase().includes(q));
    });
  }, [filter, query, likes]);

  return (
    <section className="section wrap" id="explore">
      <div className="section-head">
        <div>
          <span className="eyebrow">Explore</span>
          <h2 className="display section-title" style={{ marginTop: 10 }}>
            What will you <span className="serif">create?</span>
          </h2>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-inner" role="toolbar" aria-label="Filter shots">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-chip${filter === f ? ' on' : ''}`}
              aria-pressed={filter === f}
              onClick={() => {
                playSfx('tap');
                setFilter(f);
              }}
            >
              {filter === f && <motion.span layoutId="filter-pill" className="nav-pill" transition={SPRING} />}
              <span style={{ position: 'relative' }}>{f}</span>
            </button>
          ))}
          <label className="filter-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search shots</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" type="search" />
          </label>
        </div>
      </div>

      {shots.length === 0 ? (
        <p className="empty">{filter === 'Liked' ? 'Tap the heart on any shot to save it here.' : 'No shots match that search.'}</p>
      ) : (
        <div className="masonry-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {balance(shots.map((fx, idx) => ({ fx, idx })), cols, (x) => x.fx.ratio).map((col, ci) => (
            <div className="masonry-col" key={ci}>
              {col.map(({ fx, idx }) => {
            const liked = likes.includes(fx.id);
            return (
              <motion.article
                key={fx.id}
                className="tile"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ ...SPRING, delay: (idx % 4) * 0.06 }}
              >
                <motion.div layoutId={`shot-${fx.id}`} transition={SPRING} style={{ aspectRatio: String(fx.ratio) }}>
                  <button
                    type="button"
                    style={{ display: 'block', width: '100%', height: '100%' }}
                    onClick={() => {
                      playSfx('select');
                      setOpen(fx);
                    }}
                    aria-label={`Inspect ${fx.title}`}
                  >
                    <img src={fx.image} alt={fx.title} loading={idx < 4 ? 'eager' : 'lazy'} />
                  </button>
                </motion.div>
                <div className="tile-scrim" aria-hidden="true" />
                <button
                  type="button"
                  className={`tile-heart${liked ? ' on' : ''}`}
                  aria-pressed={liked}
                  aria-label={liked ? `Unlike ${fx.title}` : `Like ${fx.title}`}
                  onClick={() => {
                    playSfx('tap');
                    toggleLike(fx.id);
                  }}
                >
                  <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
                </button>
                <div className="tile-ui">
                  <div>
                    <div className="tile-title">{fx.title}</div>
                    <div className="tile-sub">
                      {fx.subtitle} · <span className="mono">{getEngine(fx.engine).name}</span>
                    </div>
                  </div>
                  <div className="tile-actions">
                    <Link href={`/studio?shot=${fx.id}`} className="btn btn-lime btn-sm" onClick={() => playSfx('select')}>
                      <Wand2 size={14} /> Recreate
                    </Link>
                    <button type="button" className="btn btn-glass btn-sm" onClick={() => setOpen(fx)}>
                      Inspect
                    </button>
                  </div>
                </div>
                <div className="playhead" aria-hidden="true">
                  <i />
                </div>
              </motion.article>
            );
              })}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>{open && <Lightbox key={open.id} shot={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </section>
  );
}
