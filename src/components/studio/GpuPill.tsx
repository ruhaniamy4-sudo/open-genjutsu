'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';
import { loadLocal, saveLocal, STORAGE_KEYS } from '@/lib/client/store';

export interface GpuState {
  online: boolean;
  checked: boolean;
  reason?: string;
  comfy?: boolean;
  workflowLoaded?: boolean;
  gpu?: { name: string; vramTotalMb: number | null; vramUsedMb: number | null } | null;
}

const GPU_KEY = 'kinetix.gpu.v1';

export default function GpuPill({
  gpuUrl,
  setGpuUrl,
  gpu,
  mode,
  engineName,
  billingOn,
}: {
  gpuUrl: string;
  setGpuUrl: (v: string) => void;
  gpu: GpuState;
  mode: 'live' | 'demo' | 'off';
  engineName: string;
  billingOn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(gpuUrl);
  const [token, setToken] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the input in sync with the saved link
    setDraft(gpuUrl);
  }, [gpuUrl]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the saved worker token once
    setToken(loadLocal<string>(STORAGE_KEYS.gpuToken, ''));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = (value: string, tokenValue: string) => {
    const v = value.trim();
    const t = v ? tokenValue.trim() : '';
    saveLocal(STORAGE_KEYS.gpuToken, t);
    setToken(t);
    try {
      if (v) window.localStorage.setItem(GPU_KEY, v);
      else window.localStorage.removeItem(GPU_KEY);
    } catch {
      // storage blocked
    }
    setGpuUrl(v);
    playSfx('select');
  };

  const label =
    mode === 'live'
      ? gpu.online && gpu.gpu?.name && engineName === 'Kinetix Pro'
        ? `${gpu.gpu.name.replace(/^NVIDIA\s+/i, '')} live`
        : `${engineName} live`
      : mode === 'demo'
        ? 'Demo render'
        : `${engineName} offline`;

  return (
    <div className="gpu-pill" ref={ref}>
      <button type="button" className="credit-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span className={`gpu-dot${mode === 'live' ? ' live' : mode === 'demo' ? ' demo' : ''}`} aria-hidden="true" />
        <span style={{ fontSize: 12 }}>{label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="gpu-sheet"
            role="dialog"
            aria-label="GPU worker"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={SPRING}
          >
            <div>
              <div className="eyebrow">Kinetix GPU worker</div>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Paste the <span className="mono">trycloudflare.com</span> link printed by the Colab notebook or Vast.ai script.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save(draft, token);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label htmlFor="gpu-url" className="sr-only">GPU worker URL</label>
              <input id="gpu-url" className="field mono" placeholder="https://xxxx.trycloudflare.com" value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="url" />
              <label htmlFor="gpu-token" className="sr-only">Worker token</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  id="gpu-token"
                  className="field mono"
                  type="password"
                  autoComplete="off"
                  placeholder="Worker token (if the notebook printed one)"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button type="submit" className="btn btn-lime btn-sm" style={{ height: 42 }}>
                  Connect
                </button>
              </div>
            </form>
            <div className="kv mono">
              <span>Status</span>
              <span style={{ color: gpu.online ? 'var(--live)' : 'var(--ink-2)' }}>
                {!gpu.checked ? 'Checking…' : gpu.online ? 'Online' : gpu.reason || 'Not connected'}
              </span>
            </div>
            {gpu.online && (
              <>
                {gpu.gpu && (
                  <div className="kv mono">
                    <span>GPU</span>
                    <span>
                      {gpu.gpu.name}
                      {gpu.gpu.vramTotalMb ? ` · ${Math.round(gpu.gpu.vramTotalMb / 1024)} GB` : ''}
                    </span>
                  </div>
                )}
                <div className="kv mono">
                  <span>Workflow</span>
                  <span style={{ color: gpu.workflowLoaded === false ? 'var(--amber)' : undefined }}>{gpu.workflowLoaded === false ? 'Missing' : 'Loaded'}</span>
                </div>
              </>
            )}
            {!gpu.online && (
              <p className="dim" style={{ fontSize: 12 }}>
                {billingOn
                  ? 'Without a worker, Kinetix Pro is paused. Partner engines still run.'
                  : 'Without a worker, Kinetix Pro runs a free demo render.'}
              </p>
            )}
            {gpuUrl && (
              <button type="button" className="btn btn-text" style={{ fontSize: 12, alignSelf: 'flex-start' }} onClick={() => save('', '')}>
                Disconnect
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
