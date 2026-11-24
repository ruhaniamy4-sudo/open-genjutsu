'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Copy, Download, Loader2, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getEffect, getEngine, PRESETS } from '@/lib/vfx-data';
import { isTerminal, type JobStatus } from '@/lib/api-types';
import { useApp, type Render } from '@/lib/client/store';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

function reopenHref(r: Render) {
  const qs = new URLSearchParams({ prompt: r.roughIdea || r.prompt, engine: r.engineId });
  if (r.effectId) qs.set('effect', r.effectId);
  return `/studio?${qs.toString()}`;
}

/** Keeps polling renders that were still running when the user left the Studio. */
function useResumePending() {
  const { renders, apiFetch, upsertRender, config, refreshAccount } = useApp();
  const inflight = useRef(new Set<string>());
  useEffect(() => {
    if (!config) return;
    const active = inflight.current;
    const pending = renders.filter((r) => !isTerminal(r.status) && r.jobToken && !inflight.current.has(r.id));
    const timers: ReturnType<typeof setTimeout>[] = [];
    let stopped = false;
    for (const r of pending) {
      inflight.current.add(r.id);
      const tick = async () => {
        if (stopped) return;
        try {
          const res = await apiFetch(`/api/jobs/${encodeURIComponent(r.jobToken!)}`);
          const s = (await res.json()) as JobStatus;
          if (res.ok && isTerminal(s.status)) {
            upsertRender({ ...r, status: s.status, outputUrl: s.outputUrl, outputType: s.outputType });
            inflight.current.delete(r.id);
            if (config.billing === 'credits') void refreshAccount();
            return;
          }
          if (!res.ok && res.status !== 401) {
            upsertRender({ ...r, status: 'failed' });
            inflight.current.delete(r.id);
            return;
          }
        } catch {
          // network blip, retry
        }
        timers.push(setTimeout(tick, 4000));
      };
      void tick();
    }
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      active.clear();
    };
  }, [renders, apiFetch, upsertRender, config, refreshAccount]);
}

function Tile({ r, idx }: { r: Render; idx: number }) {
  const { removeRender, config } = useApp();
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engine = getEngine(r.engineId);
  const done = r.status === 'completed' && r.outputUrl;
  const ratio = r.aspect === '9:16' ? '9 / 16' : r.aspect === '1:1' ? '1 / 1' : r.aspect === '2.39:1' ? '2.39 / 1' : '16 / 9';

  return (
    <motion.article
      className="lib-tile"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: Math.min(idx, 8) * 0.04 }}
      onMouseEnter={() => void videoRef.current?.play().catch(() => undefined)}
      onMouseLeave={() => videoRef.current?.pause()}
    >
      {done ? (
        r.outputType === 'video' ? (
          <video ref={videoRef} src={r.outputUrl!} muted loop playsInline preload="metadata" style={{ aspectRatio: ratio }} />
        ) : (
          <img src={r.outputUrl!} alt={r.roughIdea || 'Render'} loading="lazy" style={{ aspectRatio: ratio }} />
        )
      ) : (
        <div className="lib-pending" style={{ aspectRatio: ratio }}>
          {isTerminal(r.status) ? (
            <span className="mono">{r.status === 'canceled' ? 'Canceled · refunded' : 'Failed · refunded'}</span>
          ) : (
            <span className="mono" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Loader2 size={14} className="spin" /> Rendering…
            </span>
          )}
        </div>
      )}
      <span className="lib-tag mono">
        {engine.name}
        {r.demo ? ' · demo' : ''}
      </span>
      <div className="lib-meta">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {r.roughIdea || r.prompt}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link href={reopenHref(r)} className="btn btn-lime btn-sm" onClick={() => playSfx('select')}>
            <Wand2 size={14} /> Reopen
          </Link>
          <button
            type="button"
            className="btn btn-glass btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(r.prompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard blocked
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Prompt'}
          </button>
          {done && (
            <a className="btn btn-glass btn-sm" href={r.outputUrl!} download target="_blank" rel="noreferrer" aria-label="Download">
              <Download size={14} />
            </a>
          )}
          {(r.demo || config?.billing !== 'credits') && (
            <button type="button" className="btn btn-glass btn-sm" onClick={() => removeRender(r.id)} aria-label="Remove from library">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export default function LibraryClient() {
  const { renders, config, session, setAuthOpen, refreshAccount } = useApp();
  const params = useSearchParams();
  const checkout = params.get('checkout');
  useResumePending();

  useEffect(() => {
    if (checkout === 'success') void refreshAccount();
  }, [checkout, refreshAccount]);

  const billingOn = config?.billing === 'credits';

  return (
    <div className="wrap">
      <div className="section-head">
        <div>
          <span className="eyebrow">Library</span>
          <h1 className="display" style={{ fontSize: 'clamp(2.4rem, 6vw, 4.6rem)', marginTop: 12 }}>
            My <span className="serif">creations.</span>
          </h1>
          <p className="section-lede">
            {billingOn ? 'Every render on your account.' : 'Renders are kept in this browser. Sign-in accounts sync across devices once billing is enabled.'}
          </p>
        </div>
        <Link href="/studio" className="btn btn-lime">
          New shot <ArrowRight size={16} />
        </Link>
      </div>

      {checkout === 'success' && (
        <p className="prompt-box" style={{ marginBottom: 20, color: 'var(--live)' }}>Payment received. Your credits are being added.</p>
      )}

      {billingOn && !session ? (
        <div className="empty">
          <p>Sign in to see your renders.</p>
          <button type="button" className="btn btn-lime" style={{ marginTop: 18 }} onClick={() => setAuthOpen(true)}>
            Sign in
          </button>
        </div>
      ) : renders.length === 0 ? (
        <div>
          <p className="empty" style={{ paddingBottom: 36 }}>No renders yet. Start from a preset:</p>
          <div className="masonry">
            {PRESETS.slice(0, 4).map((p) => (
              <Link key={p.id} href={`/studio?effect=${p.id}`} className="tile" style={{ display: 'block', cursor: 'pointer' }}>
                <img src={p.image} alt="" style={{ aspectRatio: String(p.ratio) }} />
                <div className="tile-scrim" style={{ opacity: 1 }} />
                <div className="tile-ui" style={{ opacity: 1, transform: 'none' }}>
                  <div className="tile-title">{getEffect(p.id).title}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="masonry">
          {renders.map((r, i) => (
            <Tile key={r.id} r={r} idx={i} />
          ))}
        </div>
      )}
    </div>
  );
}
