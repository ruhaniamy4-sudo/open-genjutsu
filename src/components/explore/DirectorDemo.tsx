'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { compileLocalDirectorPrompt, type BoostersConfig } from '@/lib/vfx-data';
import type { EnhanceResponse } from '@/lib/api-types';
import { playSfx } from '@/lib/sfx';

const SAMPLE = 'bristi te cyberpunk hero kore dao, tungsten rim light ar wet leather jacket';

/** Types `text` out character by character. */
function useTypewriter(text: string, speed = 9) {
  const [shown, setShown] = useState(text);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let i = 0;
    setShown('');
    const id = setInterval(() => {
      i += 3;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return shown;
}

export default function DirectorDemo({ boosters }: { boosters?: BoostersConfig }) {
  const [idea, setIdea] = useState(SAMPLE);
  const [result, setResult] = useState<EnhanceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const initial = compileLocalDirectorPrompt(SAMPLE);
  const text = result?.prompt ?? initial.prompt;
  const shown = useTypewriter(text);

  async function compile() {
    if (!idea.trim() || busy) return;
    playSfx('select');
    setBusy(true);
    try {
      const res = await fetch('/api/agent/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roughIdea: idea, boosters }),
      });
      if (!res.ok) throw new Error();
      setResult((await res.json()) as EnhanceResponse);
    } catch {
      const local = compileLocalDirectorPrompt(idea);
      setResult({ source: 'local', ...local });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section wrap" aria-labelledby="director-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">Middleman Director Agent</span>
          <h2 id="director-title" className="display section-title" style={{ marginTop: 10 }}>
            You type four words. <span className="serif">It writes the shot.</span>
          </h2>
        </div>
      </div>
      <div className="director">
        <div>
          <label htmlFor="director-idea" className="eyebrow" style={{ display: 'block', marginBottom: 14 }}>
            Your idea · English or Banglish
          </label>
          <textarea
            id="director-idea"
            className="director-input"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void compile();
            }}
            placeholder="bristi te cyberpunk hero…"
            maxLength={2000}
          />
          <button type="button" className="btn btn-lime" style={{ marginTop: 20 }} onClick={compile} disabled={busy}>
            <Sparkles size={16} /> {busy ? 'Directing…' : 'Direct this shot'}
          </button>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>Model-ready prompt</span>
            <span className="lime">{result ? (result.source === 'local' ? 'local compiler' : `${result.source} vision`) : 'preview'}</span>
          </div>
          <p className="director-out" aria-live="polite">
            {shown}
            {shown.length < text.length && <span className="caret" aria-hidden="true" />}
          </p>
          <div className="mono dim" style={{ fontSize: 11.5, marginTop: 18, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <span>CAM · {(result ?? initial).camera}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
