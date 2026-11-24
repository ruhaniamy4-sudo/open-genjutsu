'use client';

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  BOOSTER_LABELS,
  DEFAULT_BOOSTERS,
  PRESETS,
  compileLocalDirectorPrompt,
  hasBanglishLeak,
  type BoostersConfig,
} from '@/lib/vfx-data';
import type { EnhanceResponse } from '@/lib/api-types';
import { playSfx } from '@/lib/sfx';

export default function CompilerSandbox() {
  const [idea, setIdea] = useState('foreground man ekdom still thakbe, pichoner futuristic city bend hoye warp hobe');
  const [effectId, setEffectId] = useState('world-morph');
  const [boosters, setBoosters] = useState<BoostersConfig>(DEFAULT_BOOSTERS);
  const [agent, setAgent] = useState<EnhanceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const local = useMemo(() => compileLocalDirectorPrompt(idea, effectId, boosters), [idea, effectId, boosters]);
  const shown = agent ?? { source: 'local' as const, ...local };
  const leak = hasBanglishLeak(shown.prompt);

  async function runAgent() {
    if (!idea.trim()) return;
    playSfx('select');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roughIdea: idea, effectId, boosters }),
      });
      const data = (await res.json()) as EnhanceResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Agent failed');
      setAgent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section wrap" aria-labelledby="sandbox-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">Director compiler sandbox</span>
          <h2 id="sandbox-title" className="display section-title" style={{ marginTop: 10 }}>
            Type it messy. <span className="serif">Watch it compile.</span>
          </h2>
          <p className="section-lede">The local compiler updates as you type. Run the vision agent to see the live LLM version.</p>
        </div>
      </div>
      <div className="sandbox">
        <div>
          <label htmlFor="sandbox-idea" className="eyebrow">Input · EN / Banglish</label>
          <textarea
            id="sandbox-idea"
            value={idea}
            maxLength={2000}
            onChange={(e) => {
              setIdea(e.target.value);
              setAgent(null);
            }}
          />
          <div className="seg" style={{ padding: 0 }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === effectId ? 'on' : ''}
                onClick={() => {
                  playSfx('tap');
                  setEffectId(p.id);
                  setAgent(null);
                }}
              >
                {p.title}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(Object.keys(BOOSTER_LABELS) as Array<keyof BoostersConfig>).map((k) => (
              <button
                key={k}
                type="button"
                className="opt"
                role="switch"
                aria-checked={boosters[k]}
                onClick={() => {
                  playSfx('tap');
                  setBoosters((b) => ({ ...b, [k]: !b[k] }));
                  setAgent(null);
                }}
              >
                <span className="opt-main">
                  <b>{BOOSTER_LABELS[k].name}</b>
                  <small>{BOOSTER_LABELS[k].hint}</small>
                </span>
                <span className={`toggle${boosters[k] ? ' on' : ''}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-lime" onClick={runAgent} disabled={busy} style={{ alignSelf: 'flex-start' }}>
            <Sparkles size={16} /> {busy ? 'Running…' : 'Run vision agent'}
          </button>
          {error && <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}
        </div>
        <div>
          <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>Output · {shown.source === 'local' ? 'local compiler' : `${shown.source} vision`}</span>
            <span style={{ color: leak ? 'var(--error)' : 'var(--live)' }}>{leak ? 'Banglish leak' : 'Leak-free English'}</span>
          </div>
          <p className="code" style={{ color: 'var(--ink)' }} aria-live="polite">{shown.prompt}</p>
          <pre className="code">{JSON.stringify({ camera: shown.camera, lighting: shown.lighting, ...shown.params }, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}
