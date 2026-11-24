'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  ClipboardList,
  Copy,
  FileText,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ShotPanel from './ShotPanel';
import { CharactersSheet, FilmPlayer, ScriptSheet, ShotListSheet } from './Sheets';
import {
  LOOKS,
  compileShotPrompt,
  duplicateShot,
  findShot,
  loadProjects,
  moveScene,
  moveShot,
  newProject,
  newScene,
  newShot,
  sampleProject,
  saveProjects,
  totalShots,
  type LookId,
  type Project,
  type Scene,
  type Shot,
  type ShotRender,
} from '@/lib/playground';
import { ASPECTS, getEngine, type Aspect } from '@/lib/vfx-data';
import { isTerminal, type EnhanceResponse } from '@/lib/api-types';
import { useApp } from '@/lib/client/store';
import { uploadMedia } from '@/lib/client/media';
import { cancelJob, captureLastFrame, checkJob, dataUrlToFile, dispatchRender } from '@/lib/client/render';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

/** Demo renders show a still that matches the film's look. */
const LOOK_FX: Record<LookId, string> = {
  'neon-noir': 'neon-overpass',
  'golden-drama': 'desert-drift',
  'desaturated-thriller': 'helipad-landing',
  'bangla-natok': 'character-swap',
  'epic-fantasy': 'earth-zoom',
  documentary: 'underwater-rays',
};

const POLL_MS = 2500;
const MAX_POLL_MS = 20 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 12;
const SAVE_DEBOUNCE_MS = 300;
// Event-time clock (kept outside the component so the React compiler does not treat it as render work).
const now = () => Date.now();

interface ShootOutcome {
  ok: boolean;
  lastFrame: string | null;
}

export default function PlaygroundClient() {
  const app = useApp();
  const { config, credits, session, apiFetch, setAuthOpen, spendLocal, refundLocal, setServerCredits, refreshAccount, upsertRender } = app;
  const billingOn = config?.billing === 'credits';
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shotId, setShotId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'shots' | 'preview' | 'details'>('details');
  const [sheet, setSheet] = useState<'cast' | 'script' | 'shotlist' | 'play' | null>(null);
  const [notice, setNotice] = useState<{ text: string; err?: boolean; action?: 'pricing' | 'signin' } | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [directing, setDirecting] = useState(false);
  const [sceneRun, setSceneRun] = useState<{ sceneId: string; current: number; total: number } | null>(null);
  const [dragState, setDragState] = useState<{ sceneId: string; fromIndex: number; overIndex: number } | null>(null);
  const [footageNames, setFootageNames] = useState<Record<string, string>>({});

  const footage = useRef(new Map<string, File>());
  const alive = useRef(true);
  const canceled = useRef(new Set<string>());
  const activeShoots = useRef(new Set<string>());
  const jobTokens = useRef(new Map<string, string>());
  const chargedDemo = useRef(new Map<string, number>());
  const sceneStopRef = useRef(false);
  const projectsRef = useRef<Project[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const creditsRef = useRef<number | null>(credits);
  const resumedRef = useRef(false);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    creditsRef.current = credits;
  }, [credits]);

  useEffect(() => {
    alive.current = true;
    const initial = loadProjects();
    projectsRef.current = initial;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate projects from this browser once
    setProjects(initial);
    setLoaded(true);
    return () => {
      alive.current = false;
      sceneStopRef.current = true;
    };
  }, []);

  // Debounced localStorage persistence + flush on tab hide/unload so rapid typing never freezes the UI or drops edits.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      setStorageWarning(saveProjects(projectsRef.current, activeIdRef.current));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [projects, activeId, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const flush = () => {
      saveProjects(projectsRef.current, activeIdRef.current);
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      flush();
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [loaded]);

  const project = projects.find((p) => p.id === activeId) ?? null;

  const patchProject = useCallback((id: string, fn: (p: Project) => Project) => {
    setProjects((list) => {
      const next = list.map((p) => (p.id === id ? { ...fn(p), updatedAt: Date.now() } : p));
      projectsRef.current = next;
      return next;
    });
  }, []);

  const patchShot = useCallback(
    (pid: string, sid: string, patch: Partial<Shot> | ((s: Shot) => Partial<Shot>)) => {
      patchProject(pid, (p) => ({
        ...p,
        scenes: p.scenes.map((sc) => ({
          ...sc,
          shots: sc.shots.map((s) => (s.id === sid ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)),
        })),
      }));
    },
    [patchProject],
  );

  const setRender = useCallback(
    (pid: string, sid: string, r: Partial<ShotRender>) =>
      patchShot(pid, sid, (s) => ({
        render: { jobToken: null, status: 'queued', outputUrl: null, outputType: null, progress: 0, error: null, demo: false, ...s.render, ...r },
      })),
    [patchShot],
  );

  const pollShot = useCallback(
    async (
      pid: string,
      sid: string,
      token: string,
      engineCredits: number,
      libBase?: Parameters<typeof upsertRender>[0],
    ): Promise<ShootOutcome> => {
      const startedAt = now();
      let consecutiveErrors = 0;
      while (alive.current && !canceled.current.has(sid)) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current || canceled.current.has(sid)) return { ok: false, lastFrame: null };
        const s = await checkJob(apiFetch, token);
        if (!s) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            setRender(pid, sid, { status: 'failed', error: 'Lost connection while checking render status.', refunded: false });
            setNotice({ text: 'Lost connection while polling render status. Check your Library for the final result.', err: true });
            return { ok: false, lastFrame: null };
          }
          continue;
        }
        consecutiveErrors = 0;
        if (canceled.current.has(sid)) return { ok: false, lastFrame: null };

        setRender(pid, sid, {
          status: s.status,
          progress: s.progress ?? 0,
          outputUrl: s.outputUrl,
          outputType: s.outputType,
          error: s.error,
          refunded: typeof s.refunded === 'number' ? s.refunded > 0 : undefined,
        });

        if (!isTerminal(s.status)) {
          if (now() - startedAt > MAX_POLL_MS) {
            setNotice({ text: 'Render is taking longer than expected. It will appear in your Library when done.' });
            return { ok: false, lastFrame: null };
          }
          continue;
        }

        jobTokens.current.delete(sid);
        if (libBase) {
          upsertRender({ ...libBase, status: s.status, outputUrl: s.outputUrl, outputType: s.outputType });
        }

        if (s.status === 'completed' && s.outputUrl) {
          chargedDemo.current.delete(sid);
          playSfx('ready');
          const frame = await captureLastFrame(s.outputUrl, s.outputType ?? 'video');
          patchShot(pid, sid, { lastFrame: frame });
          if (!frame) {
            setNotice({ text: 'Shot done. Its last frame could not be read, so the next shot will fall back to the cast portrait.' });
          }
          if (billingOn) void refreshAccount();
          return { ok: true, lastFrame: frame };
        }

        // Failed or canceled upstream: refund local demo credits only if charged for this shot.
        const demoCharged = chargedDemo.current.get(sid) ?? 0;
        chargedDemo.current.delete(sid);
        const didRefund = billingOn ? (s.refunded ?? 0) > 0 : demoCharged > 0;
        if (!billingOn && demoCharged > 0) refundLocal(demoCharged);
        setRender(pid, sid, { status: s.status, error: s.error, refunded: didRefund });
        setNotice({
          text: `Shot ${s.status}: ${s.error || 'unknown error'}.${didRefund ? ` ${billingOn ? (s.refunded ?? engineCredits) : demoCharged} credits refunded.` : ''}`,
          err: true,
        });
        if (billingOn) void refreshAccount();
        return { ok: false, lastFrame: null };
      }
      return { ok: false, lastFrame: null };
    },
    [apiFetch, billingOn, patchShot, refundLocal, refreshAccount, setRender, upsertRender],
  );

  // Resume any in-flight shots persisted across page reload / navigation so they never stay stuck at "Rolling 0%".
  useEffect(() => {
    if (!loaded || !config || resumedRef.current) return;
    resumedRef.current = true;
    for (const p of projectsRef.current) {
      for (const sc of p.scenes) {
        for (const s of sc.shots) {
          const r = s.render;
          if (!r || isTerminal(r.status)) continue;
          if (!r.jobToken) {
            setRender(p.id, s.id, { status: 'failed', error: 'Interrupted before dispatch finished.', refunded: false });
            continue;
          }
          if (activeShoots.current.has(s.id)) continue;
          activeShoots.current.add(s.id);
          jobTokens.current.set(s.id, r.jobToken);
          const eng = getEngine(s.engineId);
          void pollShot(p.id, s.id, r.jobToken, eng.credits).finally(() => {
            activeShoots.current.delete(s.id);
          });
        }
      }
    }
  }, [loaded, config, pollShot, setRender]);

  const open = (p: Project) => {
    playSfx('select');
    setActiveId(p.id);
    setShotId(p.scenes[0]?.shots[0]?.id ?? null);
    setMobileTab('details');
  };

  const create = (sample: boolean) => {
    const p = sample ? sampleProject() : newProject();
    setProjects((l) => {
      const next = [p, ...l];
      projectsRef.current = next;
      return next;
    });
    open(p);
  };

  /* ---------------------------------------------------------------- shooting */

  async function shoot(pid: string, sid: string, overridePrevFrame?: string | null): Promise<ShootOutcome> {
    if (activeShoots.current.has(sid)) return { ok: false, lastFrame: null };
    const proj = projectsRef.current.find((p) => p.id === pid);
    const found = proj && findShot(proj, sid);
    if (!proj || !found) return { ok: false, lastFrame: null };
    const { scene, shot, prev } = found;
    const engine = getEngine(shot.engineId);
    setNotice(null);

    if (billingOn && !session) {
      setAuthOpen(true);
      setNotice({ text: 'Sign in to shoot. New accounts get 30 free credits.', action: 'signin' });
      return { ok: false, lastFrame: null };
    }
    const currentCredits = creditsRef.current;
    if (currentCredits !== null && currentCredits < engine.credits) {
      setNotice({ text: `${engine.name} needs ${engine.credits} credits. You have ${currentCredits}.`, err: true, action: 'pricing' });
      return { ok: false, lastFrame: null };
    }
    if (shot.source === 'footage' && !footage.current.get(sid)) {
      setNotice({ text: 'Attach your footage for this shot first.', err: true });
      return { ok: false, lastFrame: null };
    }

    activeShoots.current.add(sid);
    canceled.current.delete(sid);
    playSfx('shutter');
    setRender(pid, sid, { status: 'queued', progress: 0, outputUrl: null, outputType: null, error: null, jobToken: null, refunded: false });

    try {
      const prevFrame = overridePrevFrame !== undefined ? overridePrevFrame : (prev?.lastFrame ?? null);
      const hasContinuityFrame = Boolean(shot.continuity && prevFrame);
      const prompt = shot.promptOverride !== null ? shot.promptOverride.trim() : compileShotPrompt(proj, scene, shot, hasContinuityFrame);
      if (!prompt) {
        setRender(pid, sid, { status: 'failed', error: 'Shot prompt is empty.', refunded: false });
        setNotice({ text: 'Shot prompt is empty. Reset to automatic or write an action.', err: true });
        return { ok: false, lastFrame: null };
      }

      // Identity / continuity reference: previous shot's last frame wins, else the first cast portrait.
      const castPortrait = proj.characters.find((c) => shot.characterIds.includes(c.id) && c.ref)?.ref ?? null;
      const ref = (hasContinuityFrame ? prevFrame : null) || castPortrait;
      let faceUrl: string | undefined;
      let clipUrl: string | undefined;

      if (config?.uploads) {
        if (ref) faceUrl = (await uploadMedia(dataUrlToFile(ref, 'reference.jpg'), 'face', apiFetch)).remoteUrl ?? undefined;
        if (!alive.current || canceled.current.has(sid)) return { ok: false, lastFrame: null };
        const clip = footage.current.get(sid);
        if (shot.source === 'footage' && clip) {
          clipUrl = (await uploadMedia(clip, 'clip', apiFetch)).remoteUrl ?? undefined;
          if (!alive.current || canceled.current.has(sid)) return { ok: false, lastFrame: null };
        }
      } else if (billingOn && (ref || shot.source === 'footage')) {
        setNotice({ text: 'Media uploads are not configured on this server; shooting with text prompt only.' });
      }

      const res = await dispatchRender(apiFetch, {
        engineId: shot.engineId,
        prompt,
        roughIdea: shot.action,
        effectId: LOOK_FX[proj.look],
        aspect: proj.aspect,
        duration: shot.duration,
        faceUrl,
        clipUrl,
      });

      if (!res.ok) {
        setRender(pid, sid, { status: 'failed', error: res.error, refunded: false });
        if (res.code === 'AUTH_REQUIRED') setAuthOpen(true);
        setNotice({ text: res.error, err: true, action: res.code === 'INSUFFICIENT_CREDITS' ? 'pricing' : undefined });
        if (typeof res.remaining === 'number') setServerCredits(res.remaining);
        return { ok: false, lastFrame: null };
      }

      const { data } = res;
      // If the user clicked Cancel while upload/dispatch was still in flight, cancel the newly created server job immediately.
      if (!alive.current || canceled.current.has(sid)) {
        await cancelJob(apiFetch, data.jobToken);
        if (billingOn) void refreshAccount();
        setRender(pid, sid, { status: 'canceled', jobToken: null, error: null });
        return { ok: false, lastFrame: null };
      }

      jobTokens.current.set(sid, data.jobToken);
      if (data.billing === 'demo') {
        spendLocal(data.creditsCharged);
        chargedDemo.current.set(sid, data.creditsCharged);
      } else if (typeof data.remaining === 'number') {
        setServerCredits(data.remaining);
      }
      const demo = data.provider === 'demo';
      setRender(pid, sid, { jobToken: data.jobToken, status: 'running', demo, refunded: false });

      const libraryId = `pg-${sid}-${now()}`;
      const libBase = {
        id: libraryId,
        jobToken: data.jobToken,
        engineId: shot.engineId,
        effectId: '',
        prompt,
        roughIdea: shot.action || scene.heading,
        aspect: proj.aspect,
        duration: shot.duration,
        demo,
        createdAt: now(),
      };
      upsertRender({ ...libBase, status: 'running', outputUrl: null, outputType: null });

      return await pollShot(pid, sid, data.jobToken, data.creditsCharged, { ...libBase, status: 'running', outputUrl: null, outputType: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Shot failed';
      setRender(pid, sid, { status: 'failed', error: msg, refunded: false });
      setNotice({ text: msg, err: true });
      return { ok: false, lastFrame: null };
    } finally {
      activeShoots.current.delete(sid);
    }
  }

  async function cancel(pid: string, sid: string, silent = false) {
    const proj = projectsRef.current.find((p) => p.id === pid);
    const token = jobTokens.current.get(sid) ?? (proj ? findShot(proj, sid)?.shot.render?.jobToken : null);
    canceled.current.add(sid);
    jobTokens.current.delete(sid);
    setRender(pid, sid, { status: 'canceled', jobToken: null });

    let serverRefunded = 0;
    let alreadyCompleted = false;
    if (token) {
      const res = await cancelJob(apiFetch, token);
      serverRefunded = res.refunded;
      alreadyCompleted = res.status === 'completed';
    }

    const demoCharged = chargedDemo.current.get(sid) ?? 0;
    chargedDemo.current.delete(sid);
    if (billingOn) {
      void refreshAccount();
    } else if (demoCharged > 0) {
      refundLocal(demoCharged);
    }

    if (!silent) {
      if (alreadyCompleted) {
        setNotice({ text: 'Shot had already finished before cancel arrived.' });
      } else if (billingOn) {
        setNotice({ text: serverRefunded > 0 ? `Shot canceled. ${serverRefunded} credits refunded.` : 'Shot canceled.' });
      } else {
        setNotice({ text: demoCharged > 0 ? `Shot canceled. ${demoCharged} credits refunded.` : 'Shot canceled.' });
      }
    }
  }

  function cancelShotsInList(pid: string, shots: Shot[]) {
    for (const s of shots) {
      if (s.render && !isTerminal(s.render.status)) {
        void cancel(pid, s.id, true);
      }
    }
  }

  async function shootScene(pid: string, sceneId: string) {
    if (sceneRun) return;
    const proj = projectsRef.current.find((p) => p.id === pid);
    const sc = proj?.scenes.find((s) => s.id === sceneId);
    if (!proj || !sc) return;

    const queue = sc.shots.filter((s) => s.render?.status !== 'completed');
    if (!queue.length) {
      setNotice({ text: 'Every shot in this scene is already rendered.' });
      return;
    }

    const totalCost = queue.reduce((sum, s) => sum + getEngine(s.engineId).credits, 0);
    if (billingOn && !session) {
      setAuthOpen(true);
      setNotice({ text: 'Sign in to shoot this scene. New accounts get 30 free credits.', action: 'signin' });
      return;
    }
    if (creditsRef.current !== null && creditsRef.current < totalCost) {
      setNotice({
        text: `This scene needs ${totalCost} credits for ${queue.length} unshot shots. You have ${creditsRef.current}.`,
        err: true,
        action: 'pricing',
      });
      return;
    }

    sceneStopRef.current = false;
    setSceneRun({ sceneId, current: 0, total: queue.length });

    // Only reuse the in-memory frame when the shot just rolled is the target's real predecessor in the scene.
    let carry: { shotId: string; frame: string | null } | null = null;

    for (let idx = 0; idx < queue.length; idx += 1) {
      if (!alive.current || sceneStopRef.current) break;
      const targetId = queue[idx].id;
      setSceneRun({ sceneId, current: idx + 1, total: queue.length });
      setShotId(targetId);

      const latestProj = projectsRef.current.find((p) => p.id === pid);
      const latestFound = latestProj && findShot(latestProj, targetId);
      const predecessor = latestFound?.prev ?? null;
      const prevFrame = carry && predecessor && carry.shotId === predecessor.id && carry.frame ? carry.frame : (predecessor?.lastFrame ?? null);

      const outcome = await shoot(pid, targetId, prevFrame);
      if (!outcome.ok) {
        if (!sceneStopRef.current) {
          setNotice({ text: `Scene shoot stopped on shot ${idx + 1} of ${queue.length}.`, err: true });
        }
        break;
      }
      carry = { shotId: targetId, frame: outcome.lastFrame };
    }

    setSceneRun(null);
    if (alive.current && !sceneStopRef.current) {
      const doneScene = projectsRef.current.find((p) => p.id === pid)?.scenes.find((s) => s.id === sceneId);
      if (doneScene && doneScene.shots.every((s) => s.render?.status === 'completed')) {
        setNotice({ text: `Finished shooting ${doneScene.heading}.` });
      }
    }
  }

  function stopScene() {
    sceneStopRef.current = true;
    if (project && sceneRun) {
      const sc = project.scenes.find((s) => s.id === sceneRun.sceneId);
      if (sc) cancelShotsInList(project.id, sc.shots);
    }
    setSceneRun(null);
    setNotice({ text: 'Stopped scene shoot.' });
  }

  async function direct(pid: string, sid: string, action: string, effectId: string) {
    setDirecting(true);
    try {
      const res = await apiFetch('/api/agent/enhance', {
        method: 'POST',
        body: JSON.stringify({ roughIdea: action, effectId }),
      });
      const d = (await res.json()) as EnhanceResponse & { error?: string };
      if (!res.ok) throw new Error(d.error || 'Director failed');
      // Extract only the visual scene/action sentence so we never duplicate camera/lighting/Negative blocks.
      const scenePart = /Scene:\s*([^.]+)\./i.exec(d.prompt)?.[1]?.trim();
      const cleaned = d.prompt
        .replace(/Negative:[\s\S]*$/i, '')
        .replace(/Finish:[^.]+\./gi, '')
        .replace(/Camera:[^.]+\./gi, '')
        .replace(/Lighting:[^.]+\./gi, '')
        .trim();
      const nextAction = d.source === 'local' ? (scenePart || cleaned) : (cleaned || d.prompt);
      patchShot(pid, sid, { action: nextAction.slice(0, 600) });
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Director failed', err: true });
    } finally {
      setDirecting(false);
    }
  }

  const allShots = project ? project.scenes.flatMap((s) => s.shots) : [];
  const shotIndexMap = new Map(allShots.map((s, idx) => [s.id, idx + 1]));

  /* ---------------------------------------------------------------- views */

  if (!loaded) return <div className="page wrap" aria-busy="true" />;

  if (!project) {
    return (
      <div className="page wrap">
        <span className="eyebrow">Film Playground</span>
        <h1 className="display" style={{ fontSize: 'clamp(2.4rem, 6vw, 5rem)', marginTop: 12 }}>
          Build the set. <span className="serif">Then roll camera.</span>
        </h1>
        <p className="section-lede">
          For short films, natok and AI films. Write or paste your script, cast your characters, pick camera, lens and angle for every shot, and keep continuity from one shot to the next.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-lime" onClick={() => create(false)}>
            <Plus size={16} /> New film
          </button>
          <button type="button" className="btn btn-glass" onClick={() => create(true)}>
            Open a sample film
          </button>
        </div>

        {storageWarning && (
          <div className="pg-notice err" style={{ marginTop: 16 }} role="alert">
            {storageWarning}
          </div>
        )}

        {projects.length > 0 && (
          <div className="pg-projects">
            {projects.map((p) => {
              const cover = p.scenes
                .flatMap((s) => s.shots)
                .map((s) => (s.render?.status === 'completed' ? (s.render.outputType === 'image' ? s.render.outputUrl : s.lastFrame) : null))
                .find(Boolean);
              return (
                <div key={p.id} className="pg-project">
                  <button type="button" className="pg-project-open" onClick={() => open(p)}>
                    <div className="pg-cover">{cover ? <img src={cover} alt="" /> : <span className="mono dim">{p.aspect}</span>}</div>
                    <b>{p.title}</b>
                    <small className="dim">
                      {p.scenes.length} scenes · {totalShots(p)} shots · {LOOKS.find((l) => l.id === p.look)?.name}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${p.title}`}
                    onClick={() => {
                      if (!window.confirm(`Delete "${p.title}" and all its shots?`)) return;
                      cancelShotsInList(p.id, p.scenes.flatMap((s) => s.shots));
                      setProjects((l) => {
                        const next = l.filter((x) => x.id !== p.id);
                        projectsRef.current = next;
                        return next;
                      });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="dim" style={{ fontSize: 12, marginTop: 28 }}>Projects are saved in this browser.</p>
      </div>
    );
  }

  const current = (shotId && findShot(project, shotId)) || findShot(project, allShots[0]?.id ?? '');
  const shotIndex = current ? (shotIndexMap.get(current.shot.id) ?? 0) : 0;
  const currentSceneIndex = current ? project.scenes.findIndex((s) => s.id === current.scene.id) + 1 : 0;
  const selectedShotLabel = current ? `S${currentSceneIndex} · Shot ${shotIndex} · ${current.shot.angle}` : 'No shot selected';
  const currentEngine = current ? getEngine(current.shot.engineId) : null;
  const currentRender = current?.shot.render;
  const currentRunning = Boolean(currentRender && (currentRender.status === 'queued' || currentRender.status === 'running'));

  const addShotAfter = (scene: Scene, after?: Shot) => {
    const shot = newShot(after ?? scene.shots.at(-1));
    patchProject(project.id, (p) => ({
      ...p,
      scenes: p.scenes.map((sc) => {
        if (sc.id !== scene.id) return sc;
        const i = after ? sc.shots.findIndex((s) => s.id === after.id) + 1 : sc.shots.length;
        const shots = sc.shots.slice();
        shots.splice(i, 0, shot);
        return { ...sc, shots };
      }),
    }));
    setShotId(shot.id);
    setMobileTab('details');
  };

  const deleteCurrentShot = () => {
    if (!current) return;
    const sc = current.scene;
    cancelShotsInList(project.id, [current.shot]);
    patchProject(project.id, (p) => ({
      ...p,
      scenes: p.scenes.map((s) => (s.id === sc.id ? { ...s, shots: s.shots.length > 1 ? s.shots.filter((x) => x.id !== current.shot.id) : [newShot()] } : s)),
    }));
    setShotId(null);
  };

  const duplicateCurrentShot = () => {
    if (!current) return;
    const res = duplicateShot(project, current.scene.id, current.shot.id);
    if (!res) return;
    playSfx('select');
    patchProject(project.id, () => res.project);
    setShotId(res.newShotId);
    setMobileTab('details');
  };

  return (
    <div className={`pg-page${current ? ' pg-has-actionbar' : ''}`}>
      <div className="pg-top wrap">
        <button type="button" className="icon-btn" onClick={() => setActiveId(null)} aria-label="All films">
          <ArrowLeft size={18} />
        </button>
        <input
          className="pg-title display"
          value={project.title}
          maxLength={80}
          onChange={(e) => patchProject(project.id, (p) => ({ ...p, title: e.target.value }))}
          aria-label="Film title"
        />
        <select
          className="field"
          style={{ width: 'auto' }}
          value={project.look}
          onChange={(e) => patchProject(project.id, (p) => ({ ...p, look: e.target.value as LookId }))}
          aria-label="Film look"
        >
          {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select
          className="field mono"
          style={{ width: 'auto' }}
          value={project.aspect}
          onChange={(e) => patchProject(project.id, (p) => ({ ...p, aspect: e.target.value as Aspect }))}
          aria-label="Aspect ratio"
        >
          {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button type="button" className="btn btn-glass btn-sm" onClick={() => setSheet('cast')}>
          <Users size={14} /> Cast · {project.characters.length}
        </button>
        <button type="button" className="btn btn-glass btn-sm" onClick={() => setSheet('script')}>
          <FileText size={14} /> Script
        </button>
        <button type="button" className="btn btn-glass btn-sm" onClick={() => setSheet('shotlist')}>
          <ClipboardList size={14} /> Shot list
        </button>
        <button type="button" className="btn btn-lime btn-sm" onClick={() => setSheet('play')}>
          <Play size={14} /> Rough cut
        </button>
      </div>

      <div className="pg-mobile-bar">
        <div className="pg-mobile-shotbar">
          <span className="pg-mobile-shotlabel mono">{selectedShotLabel}</span>
          {current && (
            <div className="pg-mobile-shottools">
              <button type="button" className="icon-btn" onClick={duplicateCurrentShot} aria-label="Duplicate shot" title="Duplicate shot">
                <Copy size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={deleteCurrentShot} aria-label="Delete shot" title="Delete shot">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="pg-mobile-tabs" role="tablist" aria-label="Editor sections">
          {([
            ['shots', 'Shots'],
            ['preview', 'Preview'],
            ['details', 'Details'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mobileTab === id}
              className={`pg-mobile-tab${mobileTab === id ? ' on' : ''}`}
              onClick={() => {
                playSfx('tap');
                setMobileTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pg-editor wrap" data-mobile-tab={mobileTab}>
        <aside className="pg-board" aria-label="Scenes and shots">
          <div className="pg-board-scenes">
          {project.scenes.map((sc, si) => {
            const unshot = sc.shots.filter((s) => s.render?.status !== 'completed');
            const sceneCredits = unshot.reduce((sum, s) => sum + getEngine(s.engineId).credits, 0);
            const isRollingThisScene = sceneRun?.sceneId === sc.id;
            return (
              <div key={sc.id} className="pg-scene">
                <div className="pg-scene-head">
                  <span className="mono dim">S{si + 1}</span>
                  <b title={sc.heading}>{sc.heading}</b>
                  <div className="pg-order-btns">
                    {project.scenes.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="icon-btn pg-mini-btn"
                          disabled={si === 0}
                          aria-label={`Move ${sc.heading} up`}
                          onClick={() => patchProject(project.id, (p) => moveScene(p, si, si - 1))}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn pg-mini-btn"
                          disabled={si === project.scenes.length - 1}
                          aria-label={`Move ${sc.heading} down`}
                          onClick={() => patchProject(project.id, (p) => moveScene(p, si, si + 1))}
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn pg-mini-btn"
                          aria-label={`Delete ${sc.heading}`}
                          onClick={() => {
                            const hasRendered = sc.shots.some((s) => s.render?.status === 'completed');
                            if (hasRendered && !window.confirm(`Delete "${sc.heading}" and its rendered shots?`)) return;
                            cancelShotsInList(project.id, sc.shots);
                            patchProject(project.id, (p) => ({ ...p, scenes: p.scenes.filter((x) => x.id !== sc.id) }));
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="pg-shots">
                  {sc.shots.map((s, shotIdx) => {
                    const n = shotIndexMap.get(s.id) ?? 0;
                    const thumb = s.render?.status === 'completed' ? (s.render.outputType === 'image' ? s.render.outputUrl : s.lastFrame) : null;
                    const st = s.render?.status;
                    const isOver = dragState?.sceneId === sc.id && dragState.overIndex === shotIdx && dragState.fromIndex !== shotIdx;
                    return (
                      <div
                        key={s.id}
                        className={`pg-shot-wrap${isOver ? ' drag-over' : ''}`}
                        draggable={sc.shots.length > 1}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          setDragState({ sceneId: sc.id, fromIndex: shotIdx, overIndex: shotIdx });
                        }}
                        onDragOver={(e) => {
                          if (!dragState || dragState.sceneId !== sc.id) return;
                          e.preventDefault();
                          if (dragState.overIndex !== shotIdx) setDragState({ ...dragState, overIndex: shotIdx });
                        }}
                        onDrop={(e) => {
                          if (!dragState || dragState.sceneId !== sc.id) return;
                          e.preventDefault();
                          patchProject(project.id, (p) => moveShot(p, sc.id, dragState.fromIndex, shotIdx));
                          setDragState(null);
                        }}
                        onDragEnd={() => setDragState(null)}
                      >
                        <button
                          type="button"
                          className={`pg-shot${current?.shot.id === s.id ? ' on' : ''}`}
                          onClick={() => {
                            playSfx('tap');
                            setShotId(s.id);
                            setMobileTab('details');
                          }}
                        >
                          {sc.shots.length > 1 && <GripVertical size={12} className="pg-grip" aria-hidden="true" />}
                          <span className="pg-thumb">{thumb ? <img src={thumb} alt="" /> : <span className="mono">{n}</span>}</span>
                          <span className="pg-shot-meta">
                            <b>{s.angle}</b>
                            <small>{s.action || 'No action yet'}</small>
                          </span>
                          <i className={`pg-dot ${st ?? ''}`} aria-label={st ?? 'not shot'} />
                        </button>
                        {sc.shots.length > 1 && (
                          <div className="pg-shot-order">
                            <button
                              type="button"
                              className="icon-btn pg-mini-btn"
                              disabled={shotIdx === 0}
                              aria-label={`Move shot ${n} up`}
                              onClick={() => patchProject(project.id, (p) => moveShot(p, sc.id, shotIdx, shotIdx - 1))}
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn pg-mini-btn"
                              disabled={shotIdx === sc.shots.length - 1}
                              aria-label={`Move shot ${n} down`}
                              onClick={() => patchProject(project.id, (p) => moveShot(p, sc.id, shotIdx, shotIdx + 1))}
                            >
                              <ChevronDown size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="pg-scene-foot">
                    <button type="button" className="btn btn-text pg-add-shot-btn" onClick={() => addShotAfter(sc)}>
                      <Plus size={13} /> Add shot
                    </button>
                    {isRollingThisScene ? (
                      <button type="button" className="btn btn-glass btn-sm pg-shoot-scene-btn" onClick={stopScene}>
                        <Square size={10} fill="currentColor" /> Stop ({sceneRun.current}/{sceneRun.total})
                      </button>
                    ) : (
                      unshot.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-glass btn-sm pg-shoot-scene-btn"
                          disabled={Boolean(sceneRun)}
                          onClick={() => void shootScene(project.id, sc.id)}
                          title={`Shoot ${unshot.length} unshot shot${unshot.length === 1 ? '' : 's'} sequentially with continuity (${sceneCredits} CR)`}
                        >
                          <Clapperboard size={12} /> Shoot scene · {sceneCredits} CR
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          <button
            type="button"
            className="btn btn-glass btn-sm pg-add-scene"
            onClick={() => {
              const sc = newScene(project.scenes.length + 1);
              patchProject(project.id, (p) => ({ ...p, scenes: [...p.scenes, sc] }));
              setShotId(sc.shots[0].id);
              setMobileTab('details');
            }}
          >
            <Plus size={14} /> Add scene
          </button>
        </aside>

        <section className="pg-main">
          {storageWarning && (
            <div className="pg-notice err" role="alert">
              {storageWarning}
            </div>
          )}
          <AnimatePresence>
            {notice && (
              <motion.div
                className={`pg-notice${notice.err ? ' err' : ''}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role={notice.err ? 'alert' : 'status'}
              >
                {notice.text}{' '}
                {notice.action === 'pricing' && <Link href="/pricing">Get credits</Link>}
                {notice.action === 'signin' && (
                  <button type="button" className="link" onClick={() => setAuthOpen(true)}>Sign in</button>
                )}
                <button
                  type="button"
                  className="ref-x"
                  style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 6 }}
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {current && (
            <motion.div key={current.shot.id} className="pg-shot-slot" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
              <ShotPanel
                project={project}
                scene={current.scene}
                shot={current.shot}
                prev={current.prev}
                index={shotIndex}
                footageName={footageNames[current.shot.id] ?? null}
                directing={directing}
                onPatch={(p) => patchShot(project.id, current.shot.id, p)}
                onPatchScene={(p) => patchProject(project.id, (pr) => ({ ...pr, scenes: pr.scenes.map((s) => (s.id === current.scene.id ? { ...s, ...p } : s)) }))}
                onAttachFootage={(f) => {
                  const id = current.shot.id;
                  if (f) footage.current.set(id, f);
                  else footage.current.delete(id);
                  setFootageNames((m) => ({ ...m, [id]: f?.name ?? '' }));
                }}
                onShoot={() => void shoot(project.id, current.shot.id)}
                onCancel={() => void cancel(project.id, current.shot.id)}
                onDelete={deleteCurrentShot}
                onDuplicate={duplicateCurrentShot}
                onNext={() => addShotAfter(current.scene, current.shot)}
                onDirect={() => void direct(project.id, current.shot.id, current.shot.action, LOOK_FX[project.look])}
              />
            </motion.div>
          )}
        </section>
      </div>

      {current && currentEngine && (
        <div className="pg-mobile-actionbar" role="region" aria-label="Shot actions">
          <button
            type="button"
            className="btn btn-glass pg-mobile-next"
            onClick={() => addShotAfter(current.scene, current.shot)}
          >
            <Plus size={15} /> Next shot
          </button>
          {currentRunning ? (
            <button
              type="button"
              className="btn btn-glass pg-mobile-shoot"
              onClick={() => void cancel(project.id, current.shot.id)}
            >
              <Square size={13} fill="currentColor" /> Cancel{' '}
              <span className="mono">{Math.round((currentRender?.progress ?? 0) * 100)}%</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-lime pg-mobile-shoot"
              onClick={() => void shoot(project.id, current.shot.id)}
            >
              {currentRender?.status === 'queued' ? <Loader2 size={16} className="spin" /> : <Clapperboard size={16} />}
              {currentRender?.status === 'completed' ? 'Reshoot' : 'Shoot'}{' '}
              <span className="mono">· {currentEngine.credits} CR</span>
            </button>
          )}
        </div>
      )}

      <CharactersSheet
        open={sheet === 'cast'}
        onClose={() => setSheet(null)}
        characters={project.characters}
        onChange={(characters) => patchProject(project.id, (p) => ({ ...p, characters }))}
      />
      <ScriptSheet
        open={sheet === 'script'}
        onClose={() => setSheet(null)}
        project={project}
        onImport={(p, append) => {
          if (!append) cancelShotsInList(project.id, project.scenes.flatMap((s) => s.shots));
          patchProject(project.id, () => p);
          setShotId(append ? (p.scenes.at(-1)?.shots[0]?.id ?? null) : (p.scenes[0]?.shots[0]?.id ?? null));
          setSheet(null);
          playSfx('ready');
        }}
      />
      <ShotListSheet open={sheet === 'shotlist'} onClose={() => setSheet(null)} project={project} />
      <FilmPlayer open={sheet === 'play'} onClose={() => setSheet(null)} shots={allShots} />
    </div>
  );
}
