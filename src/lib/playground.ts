import type { Aspect, Duration, EngineId } from './vfx-data';

/* ------------------------------------------------------------------ vocabulary */

export const CAMERAS = ['ARRI Alexa 65', 'ARRI Alexa Mini LF', 'Sony Venice 2', 'RED V-Raptor', 'Blackmagic URSA 12K', '16mm film', 'iPhone handheld'] as const;
export const LENSES = ['18mm wide', '24mm', '35mm', '50mm', '85mm portrait', '100mm macro', '40mm anamorphic', '75mm anamorphic'] as const;
export const ANGLES = ['Extreme wide', 'Wide', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Over-the-shoulder', 'Low angle', 'High angle', 'Top-down', 'POV', 'Dutch angle'] as const;
export const MOVES = ['Static', 'Slow dolly in', 'Dolly out', 'Pan', 'Tilt', 'Handheld', 'Steadicam follow', 'Orbit', 'Crane up', 'Drone fly-over', 'Whip pan'] as const;
export const TIMES = ['Day', 'Golden hour', 'Blue hour', 'Night', 'Dawn', 'Overcast'] as const;

export const LOOKS = [
  { id: 'neon-noir', name: 'Neon noir', text: 'rain-soaked neon noir, teal shadows, warm practical lights, deep blacks' },
  { id: 'golden-drama', name: 'Golden drama', text: 'warm golden-hour drama, soft haze, rich skin tones, gentle film grain' },
  { id: 'desaturated-thriller', name: 'Cold thriller', text: 'cold desaturated thriller, steel-blue palette, hard side light' },
  { id: 'bangla-natok', name: 'Bangla natok', text: 'natural Bangladeshi drama look, soft daylight, true-to-life colours, intimate framing' },
  { id: 'epic-fantasy', name: 'Epic fantasy', text: 'epic fantasy, volumetric god-rays, painterly highlights, sweeping scale' },
  { id: 'documentary', name: 'Documentary', text: 'grounded documentary realism, available light, handheld texture' },
] as const;

export type LookId = (typeof LOOKS)[number]['id'];

/* ------------------------------------------------------------------ model */

export interface Character {
  id: string;
  name: string;
  description: string;
  /** Small JPEG data URL used as the identity reference. */
  ref: string | null;
}

export interface DialogueLine {
  id: string;
  characterId: string;
  line: string;
}

export interface ShotRender {
  jobToken: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  outputUrl: string | null;
  outputType: 'video' | 'image' | null;
  progress: number;
  error: string | null;
  demo: boolean;
  refunded?: boolean;
  /** Id of the previous shot whose frame was sent as the reference (null = none / portrait). Set at shoot time. */
  refFromId?: string | null;
}

export interface Shot {
  id: string;
  camera: string;
  lens: string;
  angle: string;
  move: string;
  duration: Duration;
  action: string;
  dialogue: DialogueLine[];
  characterIds: string[];
  engineId: EngineId;
  source: 'generate' | 'footage';
  /** Carry the previous shot's last frame into this one. */
  continuity: boolean;
  /** Hand-edited prompt; null = compiled automatically. */
  promptOverride: string | null;
  render: ShotRender | null;
  /** Last frame of this shot's output (JPEG data URL) for the next shot's continuity. */
  lastFrame: string | null;
}

export interface Scene {
  id: string;
  heading: string;
  location: string;
  time: string;
  mood: string;
  shots: Shot[];
}

export interface Project {
  id: string;
  title: string;
  logline: string;
  look: LookId;
  aspect: Aspect;
  characters: Character[];
  scenes: Scene[];
  createdAt: number;
  updatedAt: number;
}

export const uid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newShot(prev?: Shot): Shot {
  return {
    id: uid(),
    camera: prev?.camera ?? CAMERAS[0],
    lens: prev?.lens ?? '35mm',
    angle: 'Medium',
    move: 'Static',
    duration: '5s',
    action: '',
    dialogue: [],
    characterIds: prev?.characterIds ?? [],
    engineId: prev?.engineId ?? 'kinetix-pro',
    source: 'generate',
    continuity: Boolean(prev),
    promptOverride: null,
    render: null,
    lastFrame: null,
  };
}

export function newScene(n: number, time: string = 'Day'): Scene {
  return { id: uid(), heading: `Scene ${n}`, location: '', time, mood: '', shots: [newShot()] };
}

export function newProject(title = 'Untitled film'): Project {
  const now = Date.now();
  return {
    id: uid(),
    title,
    logline: '',
    look: 'neon-noir',
    aspect: '2.39:1',
    characters: [],
    scenes: [newScene(1)],
    createdAt: now,
    updatedAt: now,
  };
}

/** Ready-made starter so a new user sees how a film is laid out. */
export function sampleProject(): Project {
  const p = newProject('Rain Over Dhaka');
  const rafi: Character = { id: uid(), name: 'RAFI', description: 'man in his 30s, wet black leather jacket, short hair, tired eyes', ref: null };
  const mitu: Character = { id: uid(), name: 'MITU', description: 'woman in her late 20s, red scarf, sharp gaze', ref: null };
  p.logline = 'A courier gets one last delivery on the night the city floods.';
  p.characters = [rafi, mitu];
  const s1 = newScene(1, 'Night');
  s1.heading = 'EXT. OLD DHAKA ALLEY – NIGHT';
  s1.location = 'narrow old Dhaka alley, rickshaws, hanging signboards';
  s1.mood = 'tense, lonely';
  const a = newShot();
  Object.assign(a, { angle: 'Wide', move: 'Slow dolly in', lens: '24mm', action: 'Rafi walks through heavy rain, neon signs flicker above him', characterIds: [rafi.id] });
  const b = newShot(a);
  Object.assign(b, {
    angle: 'Close-up',
    lens: '85mm portrait',
    move: 'Static',
    action: 'Rafi stops and looks at the parcel in his hand',
    characterIds: [rafi.id],
    dialogue: [{ id: uid(), characterId: rafi.id, line: 'Ar ekta delivery. Tarpor shesh.' }],
  });
  const c = newShot(b);
  Object.assign(c, { angle: 'Over-the-shoulder', lens: '50mm', action: 'Mitu appears at the end of the alley under a red lamp', characterIds: [rafi.id, mitu.id] });
  s1.shots = [a, b, c];
  p.scenes = [s1];
  return p;
}

/* ------------------------------------------------------------------ prompt compiler */

export function findShot(project: Project, shotId: string): { scene: Scene; shot: Shot; prev: Shot | null } | null {
  for (const scene of project.scenes) {
    let prev: Shot | null = null;
    for (const shot of scene.shots) {
      if (shot.id === shotId) return { scene, shot, prev };
      prev = shot;
    }
  }
  return null;
}

export type RefReason = 'first' | 'off' | 'unshot' | 'noframe' | 'ready';

/**
 * The one place that decides which image a shot is shot against.
 * Used by both the reference card and the render dispatch so they cannot disagree.
 * `prevFrame` lets the batch runner pass a fresh in-memory capture for the real predecessor.
 */
export function resolveReference(
  shot: Shot,
  prev: Shot | null,
  cast: Character[],
  prevFrame: string | null = prev?.lastFrame ?? null,
): { reason: RefReason; img: string | null; kind: 'frame' | 'portrait' | 'none'; portraitName: string | null } {
  const portrait = cast.find((c) => c.ref && shot.characterIds.includes(c.id)) ?? null;
  const fallback = { img: portrait?.ref ?? null, kind: portrait ? ('portrait' as const) : ('none' as const), portraitName: portrait?.name ?? null };
  if (!prev) return { reason: 'first', ...fallback };
  if (!shot.continuity) return { reason: 'off', ...fallback };
  if (prevFrame) return { reason: 'ready', img: prevFrame, kind: 'frame', portraitName: portrait?.name ?? null };
  return { reason: prev.render?.status === 'completed' ? 'noframe' : 'unshot', ...fallback };
}

/** Deterministic English shot prompt. Dialogue is kept verbatim (it is meant to be spoken). */
export function compileShotPrompt(project: Project, scene: Scene, shot: Shot, hasPrev: boolean): string {
  const look = LOOKS.find((l) => l.id === project.look)?.text ?? '';
  const cast = project.characters.filter((c) => shot.characterIds.includes(c.id));
  const parts: string[] = [];
  parts.push(`${shot.angle} shot on ${shot.camera}, ${shot.lens} lens, ${shot.move.toLowerCase()} camera.`);
  const where = [scene.location || scene.heading, scene.time ? `${scene.time.toLowerCase()}` : ''].filter(Boolean).join(', ');
  if (where) parts.push(`Setting: ${where}.`);
  if (scene.mood) parts.push(`Mood: ${scene.mood}.`);
  if (cast.length) {
    parts.push(
      `Characters: ${cast.map((c) => `${c.name} (${c.description || 'as in reference'})`).join('; ')}. Keep each face identical to its reference portrait.`,
    );
  }
  if (shot.action.trim()) parts.push(`Action: ${shot.action.trim()}.`);
  const lines = shot.dialogue.filter((d) => d.line.trim());
  if (lines.length) {
    const names = new Map(project.characters.map((c) => [c.id, c.name]));
    parts.push(`Dialogue (lip-sync, keep the original language): ${lines.map((d) => `${names.get(d.characterId) ?? 'VOICE'}: "${d.line.trim()}"`).join(' ')}`);
  }
  if (shot.continuity && hasPrev) {
    parts.push('Continuity: start exactly from the previous shot’s final frame; same wardrobe, props, lighting direction and screen positions.');
  }
  if (shot.source === 'footage') parts.push('Use the supplied footage as the motion and layout plate; apply the VFX and grade on top.');
  if (look) parts.push(`Look: ${look}.`);
  parts.push('Negative: no plastic skin, no identity drift, no warped hands, no subtitles, no watermark.');
  return parts.join(' ');
}

/* ------------------------------------------------------------------ script import */

const HEADING_RE = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.|SCENE\b|দৃশ্য)/i;
// Supports ASCII and Unicode (including Bangla letters + combining vowel/virama marks \p{M}) before ':' / '：' / 'ঃ'.
const DIALOGUE_RE = /^([\p{L}][\p{L}\p{M}\p{N} .'-]{0,36})\s*[:：ঃ]\s*(.+)$/u;
const DIRECTIVE_SPEAKERS = new Set([
  'SFX', 'BGM', 'MUSIC', 'SOUND', 'AUDIO', 'CUT TO', 'FADE IN', 'FADE OUT', 'DISSOLVE TO',
  'SMASH CUT', 'MATCH CUT', 'NOTE', 'NOTES', 'CAMERA', 'ANGLE', 'LENS', 'SHOT', 'TITLE',
  'SUPER', 'CHYRON', 'TIME', 'ACT', 'PART', 'EPISODE', 'LOCATION', 'SETTING', 'MOOD',
]);
const MAX_IMPORT_SHOTS = 200;

function extractSceneTime(heading: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/(?:\bNIGHT\b|রাত|রাত্রি)/i, 'Night'],
    [/(?:\bDAWN\b|ভোর)/i, 'Dawn'],
    [/(?:\bGOLDEN\s*HOUR\b|\bDUSK\b|\bEVENING\b|সন্ধ্যা|বিকেল|বিকাল)/i, 'Golden hour'],
    [/(?:\bBLUE\s*HOUR\b|গোধূলি)/i, 'Blue hour'],
    [/(?:\bOVERCAST\b|মেঘলা)/i, 'Overcast'],
    [/(?:\bDAY\b|\bMORNING\b|\bNOON\b|দিন|সকাল|দুপুর)/i, 'Day'],
  ];
  for (const [re, label] of rules) {
    if (re.test(heading)) return label;
  }
  return null;
}

/**
 * Splits a plain-text script into scenes and shots.
 * Scene headings: INT./EXT./SCENE/দৃশ্য lines. "NAME: line" (English or Bangla) = dialogue on the current shot.
 * Blank lines separate shots. Unknown speaker names become characters (excluding stage directives like SFX/NOTE).
 */
export function parseScript(text: string, base: Project, options?: { append?: boolean }): Project {
  const project: Project = {
    ...base,
    characters: [...base.characters],
    scenes: options?.append ? base.scenes.map((s) => ({ ...s, shots: [...s.shots] })) : [],
  };
  const byName = new Map(project.characters.map((c) => [c.name.trim().toUpperCase(), c]));
  let scene: Scene | null = null;
  let shot: Shot | null = null;
  let importedShots = 0;

  const ensureScene = () => {
    if (!scene) {
      scene = newScene(project.scenes.length + 1);
      scene.shots = [];
      project.scenes.push(scene);
    }
    return scene;
  };
  const character = (raw: string) => {
    const trimmed = raw.trim();
    const key = trimmed.toUpperCase();
    let c = byName.get(key);
    if (!c) {
      const displayName = /[a-z]/i.test(trimmed) ? key : trimmed;
      c = { id: uid(), name: displayName.slice(0, 24), description: '', ref: null };
      byName.set(key, c);
      project.characters.push(c);
    }
    return c;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      shot = null;
      continue;
    }
    if (HEADING_RE.test(line)) {
      if (importedShots >= MAX_IMPORT_SHOTS) break;
      const parsedTime = extractSceneTime(line);
      scene = newScene(project.scenes.length + 1, parsedTime ?? 'Day');
      scene.heading = line.slice(0, 120);
      scene.location = line
        .replace(HEADING_RE, '')
        .replace(/^\s*[0-9০-৯]+\s*[:：ঃ.\-–—]?\s*/, '')
        .replace(/\s*[-–—].*$/, '')
        .trim()
        .toLowerCase();
      scene.shots = [];
      project.scenes.push(scene);
      shot = null;
      continue;
    }
    const d = DIALOGUE_RE.exec(line);
    const speakerRaw = d?.[1]?.trim() ?? '';
    const isDialogue = Boolean(d && speakerRaw && !DIRECTIVE_SPEAKERS.has(speakerRaw.toUpperCase()));
    const sc = ensureScene();
    if (isDialogue && d) {
      const c = character(speakerRaw);
      if (!shot) {
        if (importedShots >= MAX_IMPORT_SHOTS) break;
        shot = newShot(sc.shots.at(-1));
        shot.angle = 'Close-up';
        sc.shots.push(shot);
        importedShots += 1;
      }
      shot.dialogue.push({ id: uid(), characterId: c.id, line: d[2].trim().slice(0, 300) });
      if (!shot.characterIds.includes(c.id)) shot.characterIds = [...shot.characterIds, c.id];
      continue;
    }
    if (importedShots >= MAX_IMPORT_SHOTS) break;
    shot = newShot(sc.shots.at(-1));
    shot.action = line.slice(0, 600);
    shot.dialogue = [];
    sc.shots.push(shot);
    importedShots += 1;
  }
  for (const s of project.scenes) if (!s.shots.length) s.shots.push(newShot());
  if (!project.scenes.length) project.scenes = [newScene(1)];
  project.updatedAt = Date.now();
  return project;
}

/* ------------------------------------------------------------------ editing helpers */

export function moveScene(project: Project, fromIndex: number, toIndex: number): Project {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= project.scenes.length || toIndex >= project.scenes.length) {
    return project;
  }
  const scenes = project.scenes.slice();
  const [moved] = scenes.splice(fromIndex, 1);
  scenes.splice(toIndex, 0, moved);
  return { ...project, scenes, updatedAt: Date.now() };
}

export function moveShot(project: Project, sceneId: string, fromIndex: number, toIndex: number): Project {
  const scIdx = project.scenes.findIndex((s) => s.id === sceneId);
  if (scIdx === -1) return project;
  const sc = project.scenes[scIdx];
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sc.shots.length || toIndex >= sc.shots.length) {
    return project;
  }
  const shots = sc.shots.slice();
  const [moved] = shots.splice(fromIndex, 1);
  shots.splice(toIndex, 0, moved);
  // First shot in a scene cannot continue from a previous shot in that scene.
  if (shots[0]?.continuity) shots[0] = { ...shots[0], continuity: false };
  const scenes = project.scenes.slice();
  scenes[scIdx] = { ...sc, shots };
  return { ...project, scenes, updatedAt: Date.now() };
}

export function duplicateShot(project: Project, sceneId: string, shotId: string): { project: Project; newShotId: string } | null {
  const scIdx = project.scenes.findIndex((s) => s.id === sceneId);
  if (scIdx === -1) return null;
  const sc = project.scenes[scIdx];
  const idx = sc.shots.findIndex((s) => s.id === shotId);
  if (idx === -1) return null;
  const orig = sc.shots[idx];
  const copy: Shot = {
    ...orig,
    id: uid(),
    dialogue: orig.dialogue.map((d) => ({ ...d, id: uid() })),
    characterIds: [...orig.characterIds],
    continuity: true,
    render: null,
    lastFrame: null,
  };
  const shots = sc.shots.slice();
  shots.splice(idx + 1, 0, copy);
  const scenes = project.scenes.slice();
  scenes[scIdx] = { ...sc, shots };
  return { project: { ...project, scenes, updatedAt: Date.now() }, newShotId: copy.id };
}

/* ------------------------------------------------------------------ shot list export */

export interface ShotListRow {
  sceneNumber: number;
  sceneHeading: string;
  location: string;
  time: string;
  shotNumber: number;
  camera: string;
  lens: string;
  angle: string;
  move: string;
  duration: Duration;
  engineId: EngineId;
  characters: string;
  action: string;
  dialogue: string;
  status: string;
  thumb: string | null;
}

export function buildShotList(project: Project): ShotListRow[] {
  const names = new Map(project.characters.map((c) => [c.id, c.name]));
  const rows: ShotListRow[] = [];
  let shotNumber = 0;
  project.scenes.forEach((sc, si) => {
    sc.shots.forEach((s) => {
      shotNumber += 1;
      const characters = s.characterIds.map((id) => names.get(id)).filter(Boolean).join(', ');
      const dialogue = s.dialogue
        .filter((d) => d.line.trim())
        .map((d) => `${names.get(d.characterId) ?? 'VOICE'}: ${d.line.trim()}`)
        .join(' | ');
      const thumb = s.render?.status === 'completed' ? (s.render.outputType === 'image' ? s.render.outputUrl : s.lastFrame) : null;
      rows.push({
        sceneNumber: si + 1,
        sceneHeading: sc.heading,
        location: sc.location,
        time: sc.time,
        shotNumber,
        camera: s.camera,
        lens: s.lens,
        angle: s.angle,
        move: s.move,
        duration: s.duration,
        engineId: s.engineId,
        characters,
        action: s.action.trim(),
        dialogue,
        status: s.render?.status ?? 'unshot',
        thumb,
      });
    });
  });
  return rows;
}

function csvCell(value: string | number): string {
  const raw = String(value);
  // Neutralize spreadsheet formula prefixes while keeping normal punctuation intact.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC-4180 CSV with UTF-8 BOM so Bangla text opens cleanly in Excel / Google Sheets. */
export function exportShotListCsv(project: Project): string {
  const header = ['Scene', 'Scene Heading', 'Location', 'Time', 'Shot', 'Camera', 'Lens', 'Angle', 'Movement', 'Duration', 'Cast', 'Action', 'Dialogue', 'Status'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of buildShotList(project)) {
    lines.push(
      [
        `S${r.sceneNumber}`,
        r.sceneHeading,
        r.location,
        r.time,
        r.shotNumber,
        r.camera,
        r.lens,
        r.angle,
        r.move,
        r.duration,
        r.characters,
        r.action,
        r.dialogue,
        r.status,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeThumbSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('data:image/') || url.startsWith('https://') || url.startsWith('/')) return url;
  return null;
}

/** Standalone printable HTML shot list / storyboard sheet. */
export function exportShotListHtml(project: Project): string {
  const rows = buildShotList(project);
  const lookName = LOOKS.find((l) => l.id === project.look)?.name ?? project.look;
  const bodyRows = rows
    .map((r) => {
      const thumb = safeThumbSrc(r.thumb);
      const frameCell = thumb
        ? `<img src="${escapeHtml(thumb)}" alt="Shot ${r.shotNumber}" class="thumb" />`
        : `<div class="thumb empty">#${r.shotNumber}</div>`;
      return `<tr>
        <td class="mono">S${r.sceneNumber}<div class="sub">${escapeHtml(r.sceneHeading)}${r.time ? ` · ${escapeHtml(r.time)}` : ''}</div></td>
        <td class="mono">${r.shotNumber}</td>
        <td>${frameCell}</td>
        <td><b>${escapeHtml(r.angle)}</b><div class="sub">${escapeHtml(r.camera)} · ${escapeHtml(r.lens)} · ${escapeHtml(r.move)}</div></td>
        <td class="mono">${escapeHtml(r.duration)}</td>
        <td>${escapeHtml(r.action || '—')}${r.characters ? `<div class="sub">Cast: ${escapeHtml(r.characters)}</div>` : ''}</td>
        <td>${escapeHtml(r.dialogue || '—')}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(project.title)} — Shot List</title>
<style>
  body { font-family: system-ui, -apple-system, 'Noto Sans Bengali', sans-serif; color: #111; margin: 28px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 18px; gap: 16px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 22px; }
  .meta { font-family: ui-monospace, monospace; font-size: 12px; color: #444; }
  .logline { margin: 0 0 16px; color: #333; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #d4d4d8; padding: 8px; vertical-align: top; text-align: left; }
  th { background: #f4f4f5; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  .mono { font-family: ui-monospace, monospace; white-space: nowrap; }
  .sub { font-size: 11px; color: #52525b; margin-top: 3px; white-space: normal; }
  .thumb { width: 96px; height: 54px; object-fit: cover; border-radius: 4px; display: block; background: #18181b; color: #a1a1aa; }
  .thumb.empty { display: grid; place-items: center; font-family: ui-monospace, monospace; font-size: 11px; }
  @media print { body { margin: 12mm; } tr { break-inside: avoid; } }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(project.title)}</h1>
    <div class="meta">${project.scenes.length} scenes · ${rows.length} shots · ${escapeHtml(project.aspect)} · ${escapeHtml(lookName)}</div>
  </header>
  ${project.logline ? `<p class="logline">${escapeHtml(project.logline)}</p>` : ''}
  <table>
    <thead>
      <tr>
        <th>Scene</th>
        <th>Shot</th>
        <th>Frame</th>
        <th>Camera / Lens / Angle / Move</th>
        <th>Dur</th>
        <th>Action &amp; Cast</th>
        <th>Dialogue</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ storage */

const KEY = 'kinetix.playground.v1';

export function loadProjects(): Project[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function stripLastFrames(list: Project[], keepPredicate: (p: Project, sc: Scene, s: Shot, idx: number) => boolean): Project[] {
  return list.map((p) => ({
    ...p,
    scenes: p.scenes.map((sc) => ({
      ...sc,
      shots: sc.shots.map((s, idx) => (s.lastFrame && !keepPredicate(p, sc, s, idx) ? { ...s, lastFrame: null } : s)),
    })),
  }));
}

export function saveProjects(list: Project[], activeProjectId?: string | null): string | null {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    return null;
  } catch {
    // Quota exceeded: compact older continuity frames so edits and scripts are never silently lost.
    const candidates: Project[][] = [
      // Pass 1: drop lastFrame from inactive projects.
      stripLastFrames(list, (p) => p.id === activeProjectId),
      // Pass 2: keep only the latest captured lastFrame per scene in the active project.
      stripLastFrames(list, (p, sc, _s, idx) => {
        if (p.id !== activeProjectId) return false;
        const lastWithFrame = sc.shots.reduce((acc, x, i) => (x.lastFrame ? i : acc), -1);
        return idx === lastWithFrame;
      }),
      // Pass 3: drop all lastFrames while preserving project text, cast portraits, and render URLs.
      stripLastFrames(list, () => false),
    ];
    for (const compacted of candidates) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(compacted));
        return 'Browser storage is nearly full. Older continuity thumbnails were trimmed to keep your project saved.';
      } catch {
        // try a smaller pass
      }
    }
    return 'Browser storage is full. Delete old projects or character portraits to save changes.';
  }
}

export function totalShots(p: Project): number {
  return p.scenes.reduce((n, s) => n + s.shots.length, 0);
}
