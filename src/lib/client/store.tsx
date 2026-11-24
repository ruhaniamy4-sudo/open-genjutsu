'use client';

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicConfig } from '@/lib/api-types';
import type { Aspect, Duration, EngineId } from '@/lib/vfx-data';

export interface Render {
  id: string;
  jobToken: string | null;
  engineId: EngineId;
  effectId: string;
  prompt: string;
  roughIdea: string;
  aspect: Aspect;
  duration: Duration;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  outputUrl: string | null;
  outputType: 'video' | 'image' | null;
  demo: boolean;
  createdAt: number;
}

interface ServerGeneration {
  id: string;
  engine_id: EngineId;
  rough_prompt: string;
  compiled_prompt: string;
  aspect: Aspect;
  duration: Duration;
  status: Render['status'];
  output_url: string | null;
  output_type: 'video' | 'image' | null;
  job_token: string | null;
  created_at: string;
}

const DEMO_START_CREDITS = 120;
const KEYS = {
  credits: 'kinetix.demoCredits.v1',
  library: 'kinetix.library.v1',
  likes: 'kinetix.likes.v1',
  sfx: 'kinetix.sfx.v1',
  gpuToken: 'kinetix.gpuToken.v1',
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / storage full: state still works for this visit
  }
}

let browserClient: SupabaseClient | null | undefined;
function supabaseBrowser(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  browserClient = url && key ? createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } }) : null;
  return browserClient;
}

interface AppState {
  config: PublicConfig | null;
  session: Session | null;
  email: string | null;
  plan: string;
  /** null = unknown (signed out with billing on, or still loading). */
  credits: number | null;
  renders: Render[];
  likes: string[];
  authOpen: boolean;
  setAuthOpen: (v: boolean) => void;
  signIn: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Local (demo) credit book-keeping. Server billing ignores these. */
  spendLocal: (n: number) => void;
  refundLocal: (n: number) => void;
  setServerCredits: (n: number) => void;
  refreshAccount: () => Promise<void>;
  upsertRender: (r: Render) => void;
  removeRender: (id: string) => void;
  toggleLike: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [plan, setPlan] = useState('free');
  const [serverCredits, setServerCredits] = useState<number | null>(null);
  const [demoCredits, setDemoCredits] = useState<number>(DEMO_START_CREDITS);
  const [localRenders, setLocalRenders] = useState<Render[]>([]);
  const [serverRenders, setServerRenders] = useState<Render[]>([]);
  const [likes, setLikes] = useState<string[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const hydrated = useRef(false);

  // Hydrate local state after mount (localStorage is browser-only).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage */
    setDemoCredits(load(KEYS.credits, DEMO_START_CREDITS));
    setLocalRenders(load<Render[]>(KEYS.library, []));
    setLikes(load<string[]>(KEYS.likes, []));
    /* eslint-enable react-hooks/set-state-in-effect */
    hydrated.current = true;
    fetch('/api/config')
      .then((r) => r.json() as Promise<PublicConfig>)
      .then(setConfig)
      .catch(() => setConfig({ billing: 'demo', director: 'local', partnersLive: false, gpuDefault: false, uploads: false, checkout: false }));
  }, []);

  useEffect(() => {
    if (hydrated.current) save(KEYS.credits, demoCredits);
  }, [demoCredits]);
  useEffect(() => {
    if (hydrated.current) save(KEYS.library, localRenders.slice(0, 80));
  }, [localRenders]);
  useEffect(() => {
    if (hydrated.current) save(KEYS.likes, likes);
  }, [likes]);

  // Supabase session.
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const apiFetch = useCallback(
    (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
      if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
      // The user's own GPU worker token, forwarded only to the worker they connected.
      if (path.startsWith('/api/generate') || path.startsWith('/api/jobs/')) {
        const gpuToken = load<string>(KEYS.gpuToken, '');
        if (gpuToken) headers.set('x-gpu-token', gpuToken);
      }
      return fetch(path, { ...init, headers });
    },
    [session],
  );

  const refreshAccount = useCallback(async () => {
    if (!session) {
      setServerCredits(null);
      setServerRenders([]);
      return;
    }
    const res = await apiFetch('/api/me').catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as { credits: number; plan: string; generations: ServerGeneration[] };
    setServerCredits(d.credits);
    setPlan(d.plan);
    setServerRenders(
      d.generations.map((g) => ({
        id: g.id,
        jobToken: g.job_token,
        engineId: g.engine_id,
        effectId: '',
        prompt: g.compiled_prompt,
        roughIdea: g.rough_prompt,
        aspect: g.aspect,
        duration: g.duration,
        status: g.status,
        outputUrl: g.output_url,
        outputType: g.output_type,
        demo: false,
        createdAt: new Date(g.created_at).getTime(),
      })),
    );
  }, [session, apiFetch]);

  useEffect(() => {
    // Account data is async; the setState calls happen after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (config?.billing === 'credits') void refreshAccount();
  }, [config?.billing, refreshAccount]);

  const signIn = useCallback(async (email: string) => {
    const sb = supabaseBrowser();
    if (!sb) return 'Accounts are not enabled on this deployment.';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    await supabaseBrowser()?.auth.signOut();
    setSession(null);
  }, []);

  const billingOn = config?.billing === 'credits';
  const upsertRender = useCallback(
    (r: Render) => {
      const apply = (list: Render[]) => {
        const i = list.findIndex((x) => x.id === r.id);
        if (i === -1) return [r, ...list];
        const next = list.slice();
        next[i] = r;
        return next;
      };
      // Billed renders live in Supabase; everything else is kept in this browser.
      if (billingOn && !r.demo) setServerRenders(apply);
      else setLocalRenders(apply);
    },
    [billingOn],
  );

  const removeRender = useCallback((id: string) => {
    setLocalRenders((l) => l.filter((r) => r.id !== id));
  }, []);

  const toggleLike = useCallback((id: string) => {
    setLikes((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }, []);

  const value = useMemo<AppState>(() => {
    const renders = billingOn
      ? [...serverRenders, ...localRenders.filter((r) => !serverRenders.some((s) => s.id === r.id))]
      : [...localRenders];
    return {
      config,
      session,
      email: session?.user.email ?? null,
      plan,
      credits: billingOn ? serverCredits : config ? demoCredits : null,
      renders: renders.sort((a, b) => b.createdAt - a.createdAt),
      likes,
      authOpen,
      setAuthOpen,
      signIn,
      signOut,
      apiFetch,
      spendLocal: (n) => setDemoCredits((c) => Math.max(0, c - n)),
      refundLocal: (n) => setDemoCredits((c) => c + n),
      setServerCredits,
      refreshAccount,
      upsertRender,
      removeRender,
      toggleLike,
    };
  }, [config, billingOn, session, plan, serverCredits, demoCredits, serverRenders, localRenders, likes, authOpen, signIn, signOut, apiFetch, refreshAccount, upsertRender, removeRender, toggleLike]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export const DEMO_CREDITS = DEMO_START_CREDITS;
export { KEYS as STORAGE_KEYS, load as loadLocal, save as saveLocal };
