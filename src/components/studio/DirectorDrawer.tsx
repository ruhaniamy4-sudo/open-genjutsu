'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import type { EnhanceResponse } from '@/lib/api-types';
import { SPRING } from '@/lib/motion';

export default function DirectorDrawer({
  open,
  onClose,
  compiled,
  edited,
  onEdit,
  onReset,
  frame,
}: {
  open: boolean;
  onClose: () => void;
  compiled: EnhanceResponse | null;
  edited: boolean;
  onEdit: (prompt: string) => void;
  onReset: () => void;
  frame: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="drawer"
          role="dialog"
          aria-label="Director Agent prompt"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={SPRING}
        >
          <div className="drawer-head">
            <div>
              <div className="eyebrow">Middleman Director Agent</div>
              <h2 className="display" style={{ fontSize: 22, marginTop: 6 }}>
                The shot, <span className="serif">written.</span>
              </h2>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          {frame && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <img src={frame} alt="Frame 0 of your clip" style={{ width: 88, borderRadius: 8 }} />
              <span className="dim" style={{ fontSize: 12 }}>Frame 0 is sent to the vision model so the prompt matches your plate.</span>
            </div>
          )}

          <label htmlFor="director-prompt" className="sr-only">
            Compiled prompt
          </label>
          <textarea
            id="director-prompt"
            value={compiled?.prompt ?? ''}
            placeholder={compiled ? '' : 'Directing…'}
            onChange={(e) => onEdit(e.target.value)}
            maxLength={4000}
          />

          <div>
            <div className="kv mono">
              <span>Source</span>
              <span className="lime">{edited ? 'edited by you' : compiled ? (compiled.source === 'local' ? 'local compiler' : `${compiled.source} vision`) : '—'}</span>
            </div>
            {compiled &&
              Object.entries(compiled.params).map(([k, v]) => (
                <div className="kv mono" key={k}>
                  <span>{k}</span>
                  <span>{String(v)}</span>
                </div>
              ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-glass btn-sm" onClick={onReset}>
              <RotateCcw size={14} /> Re-direct
            </button>
            <button type="button" className="btn btn-lime btn-sm" onClick={onClose}>
              Use this prompt
            </button>
          </div>
          <p className="dim" style={{ fontSize: 12 }}>Edits here are sent as-is. Re-direct to let the agent rewrite it.</p>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
