'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '@/lib/client/store';
import { SPRING } from '@/lib/motion';

export default function AuthSheet() {
  const { authOpen, setAuthOpen, signIn, session } = useApp();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session && authOpen) setAuthOpen(false);
  }, [session, authOpen, setAuthOpen]);

  useEffect(() => {
    if (!authOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAuthOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authOpen, setAuthOpen]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setState('sending');
    const err = await signIn(email.trim());
    if (err) {
      setError(err);
      setState('idle');
    } else {
      setState('sent');
    }
  }

  return (
    <AnimatePresence>
      {authOpen && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAuthOpen(false)}>
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={SPRING}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="icon-btn" style={{ position: 'absolute', top: 14, right: 14 }} onClick={() => setAuthOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <span className="eyebrow">Account</span>
            <h2 id="auth-title" className="display" style={{ fontSize: 30 }}>
              Sign in to <span className="serif">direct.</span>
            </h2>
            {state === 'sent' ? (
              <p className="muted">
                Check <b style={{ color: 'var(--ink)' }}>{email}</b> for a sign-in link. New accounts start with 30 free credits.
              </p>
            ) : (
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="muted" style={{ fontSize: 14 }}>We email you a one-time link. No password. New accounts get 30 free credits.</p>
                <label className="sr-only" htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  className="field"
                  type="email"
                  autoComplete="email"
                  placeholder="you@studio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
                {error && <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}
                <button type="submit" className="btn btn-lime" disabled={state === 'sending'}>
                  {state === 'sending' ? 'Sending…' : 'Email me a link'}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
