'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp, Clapperboard, Download, Film, ImagePlus, Loader2, RotateCcw, ScanFace, SlidersHorizontal, Sparkles, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import BeforeAfterWipe from '@/components/BeforeAfterWipe';
import GpuPill, { type GpuState } from './GpuPill';
import DirectorDrawer from './DirectorDrawer';
import {
  ASPECTS,
  BOOSTER_LABELS,
  DEFAULT_BOOSTERS,
  DURATIONS,
  IMAGE_ENGINES,
  PRESETS,
  VIDEO_ENGINES,
  RAW_PLATE,
  getEffect,
  getEngine,
  type Aspect,
  type BoostersConfig,
  type Duration,
  type EngineId,
  type MediaKind,
} from '@/lib/vfx-data';
import { isTerminal, type EnhanceResponse, type GenerateResponse, type JobStatus } from '@/lib/api-types';
import { useApp, type Render } from '@/lib/client/store';
import { ACCEPT, extractFrame0, uploadMedia } from '@/lib/client/media';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

const RATIO: Record<Aspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '2.39:1': 2.39, '1:1': 1 };
const STAGES = ['Tracking', 'Synthesis', 'FaceRefine', 'Color Grade'];
const POLL_MS = 2500;
const MAX_POLL_MS = 20 * 60 * 1000;
const GPU_KEY = 'kinetix.gpu.v1';

interface Media {
  file: File;
  url: string;
  thumb: string | null;
  remoteUrl: string | null;
}

interface Message {
  text: string;
  kind: 'info' | 'error';
  action?: 'signin' | 'pricing' | 'engine';
}

/** Fits a box of `ratio` inside the element, returns pixel size. */
function useFit(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width) return;
      if (window.matchMedia('(max-width: 560px)').matches) {
        const maxH = Math.max(240, Math.floor(width * 1.15));
        const w = Math.min(width, maxH * ratio);
        setSize({ w: Math.floor(w), h: Math.floor(w / ratio) });
        return;
      }
      if (!height) return;
      const w = Math.min(width, height * ratio);
      setSize({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return { ref, size };
}

export default function StudioClient() {
  const params = useSearchParams();
  const app = useApp();
  const { config, credits, session, apiFetch, setAuthOpen, upsertRender, spendLocal, refundLocal, setServerCredits, refreshAccount } = app;
  const billingOn = config?.billing === 'credits';

  // ---- initial state from the URL (?effect, ?shot, ?prompt, ?engine, ?gpu)
  const shotParam = params.get('shot');
  const initialFx = getEffect(shotParam || params.get('effect'));
  const engineParam = params.get('engine');
  const [effectId, setEffectId] = useState(initialFx.id);
  const [idea, setIdea] = useState(params.get('prompt') || initialFx.roughPrompt);
  const [engineId, setEngineId] = useState<EngineId>(
    getEngine(engineParam || (shotParam ? initialFx.engine : 'kinetix-pro')).id,
  );
  const [mode, setMode] = useState<MediaKind>(getEngine(engineParam || (shotParam ? initialFx.engine : 'kinetix-pro')).kind);
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [duration, setDuration] = useState<Duration>('7s');
  const [boosters, setBoosters] = useState<BoostersConfig>(DEFAULT_BOOSTERS);
  const [compiled, setCompiled] = useState<EnhanceResponse | null>(null);
  const [compiledEdited, setCompiledEdited] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pop, setPop] = useState<'engine' | 'format' | null>(null);
  const [clip, setClip] = useState<Media | null>(null);
  const [face, setFace] = useState<Media | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<false | 'directing' | 'uploading' | 'dispatching'>(false);
  const [job, setJob] = useState<{ render: Render; status: JobStatus } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [gpuUrl, setGpuUrl] = useState(params.get('gpu') || '');
  const [gpu, setGpu] = useState<GpuState>({ online: false, checked: false });

  const fx = getEffect(effectId);
  const engine = getEngine(engineId);
  const running = !!job && !isTerminal(job.status.status);
  const { ref: fitRef, size } = useFit(RATIO[aspect]);
  const clipInput = useRef<HTMLInputElement>(null);
  const faceInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const cancelRef = useRef(false);
  const popRef = useRef<HTMLDivElement>(null);
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  const focusTimerRef = useRef<number | null>(null);

  // Auto-grow the prompt box (also for text set from presets / URL).
  useLayoutEffect(() => {
    const el = ideaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [idea]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, []);

  // Remember a pasted GPU link for this browser.
  useEffect(() => {
    try {
      if (params.get('gpu')) window.localStorage.setItem(GPU_KEY, params.get('gpu')!);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted GPU link once
      else setGpuUrl(window.localStorage.getItem(GPU_KEY) || '');
    } catch {
      // storage blocked
    }
  }, [params]);

  // GPU worker health.
  useEffect(() => {
    if (!config) return;
    if (!gpuUrl && !config.gpuDefault) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to ping
      setGpu({ online: false, checked: true });
      return;
    }
    let stop = false;
    const ping = async () => {
      try {
        const res = await fetch(`/api/engine/ping${gpuUrl ? `?gpu=${encodeURIComponent(gpuUrl)}` : ''}`);
        const d = (await res.json()) as GpuState;
        if (!stop) setGpu({ ...d, checked: true });
      } catch {
        if (!stop) setGpu({ online: false, checked: true, reason: 'Unreachable' });
      }
    };
    void ping();
    const id = setInterval(ping, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [gpuUrl, config]);

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPop(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pop]);

  // Free object URLs.
  const clipUrlKey = clip?.url;
  const faceUrlKey = face?.url;
  useEffect(() => () => void (clipUrlKey && URL.revokeObjectURL(clipUrlKey)), [clipUrlKey]);
  useEffect(() => () => void (faceUrlKey && URL.revokeObjectURL(faceUrlKey)), [faceUrlKey]);

  const pickPreset = (id: string) => {
    playSfx('select');
    const next = getEffect(id);
    setEffectId(next.id);
    setIdea(next.roughPrompt);
    setCompiled(null);
    setCompiledEdited(false);
    if (job && isTerminal(job.status.status)) setJob(null);
  };

  const attach = useCallback(async (file: File, kind: 'clip' | 'face') => {
    const allowed = ACCEPT[kind].split(',');
    if (!allowed.includes(file.type)) {
      setMessage({ kind: 'error', text: kind === 'clip' ? 'Clips must be MP4, MOV or WebM.' : 'Portraits must be JPG, PNG or WebP.' });
      return;
    }
    const url = URL.createObjectURL(file);
    playSfx('select');
    setMessage(null);
    if (kind === 'clip') {
      setClip({ file, url, thumb: null, remoteUrl: null });
      setJob(null);
      const thumb = await extractFrame0(url);
      if (alive.current) setClip((c) => (c && c.url === url ? { ...c, thumb } : c));
    } else {
      setFace({ file, url, thumb: url, remoteUrl: null });
    }
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void attach(file, file.type.startsWith('video/') ? 'clip' : 'face');
  };

  async function direct(): Promise<EnhanceResponse> {
    const res = await fetch('/api/agent/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roughIdea: idea, effectId, boosters, frame0Base64: clip?.thumb ?? undefined }),
    });
    const data = (await res.json()) as EnhanceResponse & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Director Agent is unavailable');
    return data;
  }

  async function openDirector() {
    playSfx('tap');
    setDrawer(true);
    if (compiled || !idea.trim()) return;
    try {
      setCompiled(await direct());
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Director failed' });
    }
  }

  async function poll(render: Render, token: string, startedAt: number) {
    while (alive.current && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!alive.current || cancelRef.current) return;
      let status: JobStatus;
      try {
        const res = await apiFetch(`/api/jobs/${encodeURIComponent(token)}`);
        status = (await res.json()) as JobStatus;
        if (!res.ok) status = { ...status, status: 'failed', error: (status as { error?: string }).error || 'Status check failed' };
      } catch {
        continue; // offline blip: keep polling
      }
      if (cancelRef.current) return;
      const next: Render = { ...render, status: status.status, outputUrl: status.outputUrl, outputType: status.outputType };
      setJob({ render: next, status });
      if (isTerminal(status.status)) {
        upsertRender(next);
        if (status.status === 'completed') {
          playSfx('ready');
          setMessage(null);
        } else {
          setMessage({ kind: 'error', text: `Render failed: ${status.error || 'unknown error'}. Credits refunded.` });
          if (!billingOn) refundLocal(engine.credits);
        }
        if (billingOn) void refreshAccount();
        return;
      }
      if (Date.now() - startedAt > MAX_POLL_MS) {
        setMessage({ kind: 'info', text: 'Still rendering. It will appear in your Library when done.' });
        return;
      }
    }
  }

  async function generate() {
    if (busy || running) return;
    if (!idea.trim() && !compiledEdited) {
      setMessage({ kind: 'error', text: 'Describe your scene first.' });
      return;
    }
    if (billingOn && !session) {
      setMessage({ kind: 'info', text: 'Sign in to start rendering. New accounts get 30 free credits.', action: 'signin' });
      setAuthOpen(true);
      return;
    }
    if (credits !== null && credits < engine.credits) {
      setMessage({ kind: 'error', text: `${engine.name} needs ${engine.credits} credits. You have ${credits}.`, action: 'pricing' });
      return;
    }
    playSfx('shutter');
    setMessage(null);
    setPop(null);
    cancelRef.current = false;

    try {
      // 1. Director Agent (skipped when the user hand-edited the prompt).
      let finalPrompt = compiled?.prompt ?? '';
      if (!compiledEdited || !finalPrompt) {
        setBusy('directing');
        const d = await direct();
        setCompiled(d);
        finalPrompt = d.prompt;
      }

      // 2. Upload references (only when the server has a bucket).
      const useClip = mode === 'video' ? clip : null; // clips are video-only
      let clipUrl = useClip?.remoteUrl ?? null;
      let faceUrl = face?.remoteUrl ?? null;
      if (config?.uploads && ((useClip && !clipUrl) || (face && !faceUrl))) {
        setBusy('uploading');
        if (useClip && !clipUrl) {
          clipUrl = (await uploadMedia(useClip.file, 'clip', apiFetch)).remoteUrl;
          setClip((c) => (c ? { ...c, remoteUrl: clipUrl } : c));
        }
        if (face && !faceUrl) {
          faceUrl = (await uploadMedia(face.file, 'face', apiFetch)).remoteUrl;
          setFace((f) => (f ? { ...f, remoteUrl: faceUrl } : f));
        }
      }

      // 3. Dispatch.
      setBusy('dispatching');
      const res = await apiFetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          engineId,
          prompt: finalPrompt,
          roughIdea: idea,
          effectId,
          aspect,
          duration,
          boosters,
          gpuUrl: gpuUrl || undefined,
          clipUrl: clipUrl ?? undefined,
          faceUrl: faceUrl ?? undefined,
        }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string; code?: string; remaining?: number | null };
      if (!res.ok) {
        if (data.code === 'AUTH_REQUIRED') {
          setAuthOpen(true);
          setMessage({ kind: 'info', text: 'Sign in to start rendering.', action: 'signin' });
        } else if (data.code === 'INSUFFICIENT_CREDITS') {
          setMessage({ kind: 'error', text: data.error || 'Not enough credits.', action: 'pricing' });
        } else {
          setMessage({ kind: 'error', text: data.error || 'Could not start the render.', action: res.status === 503 ? 'engine' : undefined });
        }
        if (typeof data.remaining === 'number') setServerCredits(data.remaining);
        return;
      }

      if (data.billing === 'demo') spendLocal(data.creditsCharged);
      else if (typeof data.remaining === 'number') setServerCredits(data.remaining);

      const render: Render = {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()),
        jobToken: data.jobToken,
        engineId,
        effectId,
        prompt: finalPrompt,
        roughIdea: idea,
        aspect,
        duration,
        status: 'queued',
        outputUrl: null,
        outputType: null,
        demo: data.provider === 'demo',
        createdAt: Date.now(),
      };
      const status: JobStatus = { status: 'queued', progress: 0, stage: 'Queued', queuePosition: null, outputUrl: null, outputType: null, error: null, demo: render.demo };
      setJob({ render, status });
      upsertRender(render);
      setBusy(false);
      await poll(render, data.jobToken, Date.now());
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    playSfx('tap');
    cancelRef.current = true;
    const { render } = job;
    const canceled: Render = { ...render, status: 'canceled' };
    setJob({ render: canceled, status: { ...job.status, status: 'canceled' } });
    upsertRender(canceled);
    try {
      if (render.jobToken) await apiFetch(`/api/jobs/${encodeURIComponent(render.jobToken)}`, { method: 'DELETE' });
    } finally {
      if (billingOn) void refreshAccount();
      else refundLocal(engine.credits);
      setMessage({ kind: 'info', text: `Canceled. ${engine.credits} credits refunded.` });
    }
  }

  const status = job?.status;
  const output = status?.status === 'completed' ? status.outputUrl : null;
  const progress = Math.round((status?.progress ?? 0) * 100);
  const stageIndex = status?.stage ? STAGES.indexOf(status.stage) : -1;
  const realRaw = fx.id === 'neon-overpass';
  const gpuMode: 'live' | 'demo' | 'off' =
    engineId !== 'kinetix-pro' ? (config?.partnersLive ? 'live' : billingOn ? 'off' : 'demo') : gpu.online ? 'live' : billingOn ? 'off' : 'demo';

  const busyLabel =
    busy === 'directing' ? 'Directing…' : busy === 'uploading' ? 'Uploading…' : busy === 'dispatching' ? 'Starting…' : null;

  return (
    <main
      className="studio"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <h1 className="sr-only">Cinema Studio</h1>
      {/* Worker controls are for the studio owner / friend testers only (opened with a ?gpu= link). */}
      {gpuUrl && <GpuPill gpuUrl={gpuUrl} setGpuUrl={setGpuUrl} gpu={gpu} mode={gpuMode} engineName={engine.name} billingOn={billingOn} />}

      {/* preset dock */}
      <nav className="dock" aria-label="Cinema presets">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={`dock-item${p.id === effectId ? ' on' : ''}`} onClick={() => pickPreset(p.id)} aria-pressed={p.id === effectId} aria-label={p.title} title={p.title}>
            <img src={p.image} alt="" />
          </button>
        ))}
      </nav>

      {/* monitor */}
      <div className="monitor-wrap" ref={fitRef}>
        <motion.div
          className="monitor"
          animate={{ width: size.w || '100%', height: size.h || 'auto' }}
          transition={SPRING}
          style={{
            width: size.w || undefined,
            height: size.h || undefined,
            aspectRatio: size.h ? undefined : aspect.replace(':', ' / '),
          }}
        >
          {!output && !(mode === 'video' && clip) && (
            <div className="monitor-hud mono" aria-hidden="true">
              <span>{fx.title}</span>
              <span>
                {engine.name} · {aspect}
                {mode === 'video' ? ` · ${duration}` : ''}
              </span>
            </div>
          )}

          {output ? (
            status?.outputType === 'video' ? (
              <video key={output} src={output} autoPlay loop muted playsInline controls />
            ) : (
              <img key={output} src={output} alt="Render output" className="output" />
            )
          ) : mode === 'video' && clip ? (
            <video key={clip.url} src={clip.url} autoPlay loop muted playsInline controls />
          ) : (
            <BeforeAfterWipe
              key={fx.id}
              before={realRaw ? RAW_PLATE : fx.image}
              after={fx.image}
              simulateRaw={!realRaw}
              alt={`${fx.title} preview`}
              style={{ height: '100%' }}
            />
          )}

          <AnimatePresence>
            {(running || busy) && (
              <motion.div className="progress-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <span className="eyebrow lime">{busyLabel ?? (status?.status === 'queued' ? 'Queued' : 'Rendering')}</span>
                <div className="display" style={{ fontSize: 'clamp(28px, 4vw, 44px)' }}>
                  {busy ? <Loader2 className="spin" size={34} /> : `${progress}%`}
                </div>
                {!busy && (
                  <>
                    <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <div className="stages mono">
                      {STAGES.map((s, n) => (
                        <span key={s} className={n === stageIndex ? 'on' : n < stageIndex ? 'done' : ''}>
                          {s}
                        </span>
                      ))}
                    </div>
                    {status?.queuePosition ? <span className="mono dim" style={{ fontSize: 12 }}>Position {status.queuePosition} in queue</span> : null}
                    {status?.demo && <span className="mono dim" style={{ fontSize: 11 }}>Preview render · demo mode</span>}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {output && (
            <div className="result-bar">
              <a className="btn btn-glass btn-sm" href={output} download target="_blank" rel="noreferrer">
                <Download size={14} /> Download
              </a>
              <button type="button" className="btn btn-glass btn-sm" onClick={() => setJob(null)}>
                <RotateCcw size={14} /> New shot
              </button>
            </div>
          )}
          {dragOver && <div className="monitor-drop">Drop a clip or a portrait</div>}
        </motion.div>
      </div>

      {/* status line */}
      <AnimatePresence>
        {message && (
          <motion.div
            className={`status-line${message.kind === 'error' ? ' err' : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            role={message.kind === 'error' ? 'alert' : 'status'}
          >
            {message.text}{' '}
            {message.action === 'pricing' && <Link href="/pricing">Get credits</Link>}
            {message.action === 'signin' && (
              <button type="button" className="link" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
            {message.action === 'engine' && (
              <button type="button" className="link" onClick={() => setPop('engine')}>
                Switch engine
              </button>
            )}
            <button type="button" className="ref-x" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 6 }} onClick={() => setMessage(null)} aria-label="Dismiss">
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* composer */}
      <div className="composer" ref={popRef}>
        <div className="composer-top">
          <label htmlFor="composer-idea" className="sr-only">
            Describe your scene
          </label>
          <textarea
            id="composer-idea"
            ref={ideaRef}
            className="composer-input"
            rows={1}
            value={idea}
            maxLength={2000}
            placeholder="Describe your scene in English or Banglish…"
            onChange={(e) => {
              setIdea(e.target.value);
              if (!compiledEdited) setCompiled(null);
            }}
            onFocus={() => {
              if (typeof window === 'undefined' || !window.matchMedia('(max-width: 560px)').matches) return;
              const target = popRef.current ?? ideaRef.current;
              if (!target) return;
              const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
              const scrollComposer = () => {
                target.scrollIntoView({ behavior, block: 'end', inline: 'nearest' });
              };
              scrollComposer();
              if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
              focusTimerRef.current = window.setTimeout(() => {
                focusTimerRef.current = null;
                scrollComposer();
              }, 280);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void generate();
              }
            }}
          />
        </div>
        <div className="studio-summary" aria-label="Render settings summary">
          <button
            type="button"
            className="studio-summary-btn"
            disabled={running}
            onClick={() => {
              playSfx('tap');
              setPop(pop === 'engine' ? null : 'engine');
            }}
          >
            {engine.name}
          </button>
          <span className="dim" aria-hidden="true">·</span>
          <button
            type="button"
            className="studio-summary-btn mono"
            onClick={() => {
              playSfx('tap');
              setPop(pop === 'format' ? null : 'format');
            }}
          >
            {mode === 'video' ? `${aspect} · ${duration}` : aspect}
          </button>
        </div>
        <div className="composer-row">
          <input ref={clipInput} type="file" accept={ACCEPT.clip} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f, 'clip'); e.target.value = ''; }} />
          <input ref={faceInput} type="file" accept={ACCEPT.face} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f, 'face'); e.target.value = ''; }} />
          {mode !== 'video' ? null : clip ? (
            <span className="ref-slot filled">
              {clip.thumb ? <img className="thumb" src={clip.thumb} alt="" /> : <span className="thumb" />}
              <span className="lbl">Clip</span>
              <button type="button" className="ref-x" onClick={() => setClip(null)} aria-label="Remove clip" disabled={running}>
                <X size={12} />
              </button>
            </span>
          ) : (
            <button type="button" className="ref-slot" onClick={() => clipInput.current?.click()} aria-label="Add clip">
              <Film size={16} /> <span className="lbl">Clip</span>
            </button>
          )}
          {face ? (
            <span className="ref-slot filled">
              <img className="thumb" src={face.url} alt="" />
              <span className="lbl">Face</span>
              <button type="button" className="ref-x" onClick={() => setFace(null)} aria-label="Remove portrait" disabled={running}>
                <X size={12} />
              </button>
            </span>
          ) : (
            <button type="button" className="ref-slot" onClick={() => faceInput.current?.click()} aria-label="Add character portrait">
              <ScanFace size={16} /> <span className="lbl">Face</span>
            </button>
          )}

          <div className="mode-toggle" role="radiogroup" aria-label="Output type">
            {(['video', 'image'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? 'on' : ''}
                disabled={running}
                onClick={() => {
                  if (mode === m) return;
                  playSfx('tap');
                  setMode(m);
                  setEngineId((m === 'video' ? VIDEO_ENGINES : IMAGE_ENGINES)[0].id);
                  setMessage(null);
                }}
              >
                {m === 'video' ? 'Video' : 'Image'}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative' }}>
            <button type="button" className={`pop-btn${pop === 'engine' ? ' open' : ''}`} disabled={running} onClick={() => { playSfx('tap'); setPop(pop === 'engine' ? null : 'engine'); }} aria-expanded={pop === 'engine'} aria-haspopup="true">
              <Clapperboard size={15} /> <span className="lbl">{engine.name}</span> <ChevronUp size={13} />
            </button>
            <AnimatePresence>
              {pop === 'engine' && (
                <motion.div className="popover" style={{ left: 0 }} initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }} transition={SPRING}>
                  <div className="pop-label eyebrow">Engine</div>
                  {(mode === 'video' ? VIDEO_ENGINES : IMAGE_ENGINES).map((e) => {
                    const live = e.id === 'kinetix-pro' ? gpu.online : !!config?.partnersLive;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={`opt${e.id === engineId ? ' on' : ''}`}
                        onClick={() => {
                          playSfx('select');
                          setEngineId(e.id);
                          setPop(null);
                          setMessage(null);
                        }}
                      >
                        <span className="opt-main">
                          <b>{e.name}</b>
                          <small>
                            {e.provider}
                            {!live && (billingOn ? ' · unavailable' : ' · preview')}
                          </small>
                        </span>
                        <span className="mono" style={{ fontSize: 12, color: e.id === 'kinetix-pro' ? 'var(--lime)' : 'var(--ink-2)' }}>
                          {e.credits} CR
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div style={{ position: 'relative' }}>
            <button type="button" className={`pop-btn${pop === 'format' ? ' open' : ''}`} onClick={() => { playSfx('tap'); setPop(pop === 'format' ? null : 'format'); }} aria-expanded={pop === 'format'} aria-haspopup="true">
              <SlidersHorizontal size={15} /> <span className="lbl mono">{mode === 'video' ? `${aspect} · ${duration}` : aspect}</span> <ChevronUp size={13} />
            </button>
            <AnimatePresence>
              {pop === 'format' && (
                <motion.div className="popover" style={{ left: 0, width: 320 }} initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }} transition={SPRING}>
                  <div className="pop-label eyebrow">Aspect</div>
                  <div className="seg">
                    {ASPECTS.map((a) => (
                      <button key={a} type="button" className={a === aspect ? 'on' : ''} onClick={() => { playSfx('tap'); setAspect(a); }}>
                        {a}
                      </button>
                    ))}
                  </div>
                  {mode === 'video' && (
                    <>
                      <div className="pop-label eyebrow">Duration</div>
                      <div className="seg">
                        {DURATIONS.map((d) => (
                          <button key={d} type="button" className={d === duration ? 'on' : ''} onClick={() => { playSfx('tap'); setDuration(d); }}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {mode === 'video' && <div className="pop-label eyebrow">Boosters</div>}
                  {mode === 'video' && (Object.keys(BOOSTER_LABELS) as Array<keyof BoostersConfig>).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="opt"
                      role="switch"
                      aria-checked={boosters[k]}
                      onClick={() => {
                        playSfx('tap');
                        setBoosters((b) => ({ ...b, [k]: !b[k] }));
                        if (!compiledEdited) setCompiled(null);
                      }}
                    >
                      <span className="opt-main">
                        <b>{BOOSTER_LABELS[k].name}</b>
                        <small>{BOOSTER_LABELS[k].hint}</small>
                      </span>
                      <span className={`toggle${boosters[k] ? ' on' : ''}`} aria-hidden="true" />
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button type="button" className="pop-btn" onClick={openDirector} aria-label="Open Director Agent prompt">
            <Sparkles size={15} /> <span className="lbl">Director</span>
          </button>

          <span className="spacer" />

          {running ? (
            <button type="button" className="btn btn-glass gen-btn" onClick={cancel}>
              <Square size={13} fill="currentColor" /> Cancel
            </button>
          ) : (
            <button type="button" className="btn btn-lime gen-btn" onClick={() => void generate()} disabled={!!busy || !config}>
              {busy ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
              {busy ? busyLabel : 'Generate'} <span className="mono">· {engine.credits} CR</span>
            </button>
          )}
        </div>
      </div>

      <DirectorDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        compiled={compiled}
        edited={compiledEdited}
        onEdit={(prompt) => {
          setCompiledEdited(true);
          setCompiled((c) => ({ ...(c ?? { source: 'local', camera: '', lighting: '', params: {} }), prompt }));
        }}
        onReset={async () => {
          setCompiledEdited(false);
          setCompiled(null);
          try {
            setCompiled(await direct());
          } catch (err) {
            setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Director failed' });
          }
        }}
        frame={clip?.thumb ?? null}
      />
    </main>
  );
}
