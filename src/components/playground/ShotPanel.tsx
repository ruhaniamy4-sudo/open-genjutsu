'use client';

import { Clapperboard, Copy, Film, Link2, Loader2, Plus, Square, Trash2, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import { ANGLES, CAMERAS, LENSES, MOVES, TIMES, compileShotPrompt, resolveReference, uid, type Project, type Scene, type Shot } from '@/lib/playground';
import { DURATIONS, ENGINES, getEngine, type Duration, type EngineId } from '@/lib/vfx-data';
import { playSfx } from '@/lib/sfx';
import './reference-card.css';

/** Shows exactly which frame this shot is shot against, using the same resolver as the render. */
function ReferenceCard({ shot, prev, index, cast, uploads, sceneNo }: { shot: Shot; prev: Shot | null; index: number; cast: Project['characters']; uploads: boolean; sceneNo: number }) {
  const [compare, setCompare] = useState(false);
  const ref = resolveReference(shot, prev, cast);
  const who = ref.portraitName ? `${ref.portraitName}'s cast portrait` : null;
  const ready = ref.reason === 'ready';
  const title = {
    first: 'First shot of the scene: nothing to carry',
    off: 'Continuity off: fresh start',
    ready: `Using final frame of shot ${index - 1} · scene ${sceneNo}`,
    noframe: `Shot ${index - 1} is done, but its last frame could not be read`,
    unshot: `Waiting for shot ${index - 1}`,
  }[ref.reason];
  const note = {
    first: who ? `${who} is the only reference.` : 'No image reference. Add a cast portrait to lock the look.',
    off: who ? `${who} is the only reference.` : 'No image reference. The previous frame is ignored.',
    ready: 'Eyeline, wardrobe and screen direction are sent as the reference image.',
    noframe: who ? `Using ${who} instead. Reshoot shot ${index - 1} to capture a frame.` : 'No image reference. Reshoot the previous shot to capture a frame.',
    unshot: who ? `Until it is shot, ${who} is used.` : 'Shoot the previous shot first.',
  }[ref.reason];
  const own = shot.render?.status === 'completed' ? (shot.render.outputType === 'image' ? shot.render.outputUrl : shot.lastFrame) : null;
  const changed = shot.render?.status === 'completed' && shot.render.refFromId !== undefined && shot.render.refFromId !== (shot.continuity && prev ? prev.id : null);
  return (
    <div className={`pg-ref${ready ? ' ready' : ''}`} role="status">
      {ref.img ? <img className={`pg-ref-thumb${ready ? '' : ' dim'}`} src={ref.img} alt="" /> : <span className="pg-ref-thumb">No frame</span>}
      <span className="pg-ref-text">
        <b>{title}</b>
        <small>{note}</small>
        {ref.img && !uploads && <small>Preview only: image uploads are off on this server, so only the text prompt is sent.</small>}
        {changed && <small className="pg-ref-changed">Reference changed since this take. Reshoot to use the new one.</small>}
        {ref.img && (
          <button type="button" className="btn btn-text pg-ref-cmp" onClick={() => setCompare(true)}>
            {own ? 'Compare frames' : 'View frame'}
          </button>
        )}
      </span>
      {compare && ref.img && (
        <div className="pg-cmp" role="dialog" aria-modal="true" aria-label="Compare reference frame" onClick={() => setCompare(false)} onKeyDown={(e) => e.key === 'Escape' && setCompare(false)}>
          <div className="pg-cmp-body" onClick={(e) => e.stopPropagation()}>
            <figure>
              <img src={ref.img} alt="Reference frame" />
              <figcaption className="mono">Reference</figcaption>
            </figure>
            {own && (
              <figure>
                <img src={own} alt="This shot" />
                <figcaption className="mono">This shot</figcaption>
              </figure>
            )}
            <button type="button" className="btn btn-glass" autoFocus onClick={() => setCompare(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chips<T extends string>({ label, options, value, onPick }: { label: string; options: readonly T[]; value: string; onPick: (v: T) => void }) {
  return (
    <div className="pg-field">
      <span className="eyebrow">{label}</span>
      <div className="pg-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            className={o === value ? 'on' : ''}
            onClick={() => {
              playSfx('tap');
              onPick(o);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ShotPanel({
  project,
  scene,
  shot,
  prev,
  uploads,
  index,
  footageName,
  onPatch,
  onPatchScene,
  onAttachFootage,
  onShoot,
  onCancel,
  onDelete,
  onDuplicate,
  onNext,
  directing,
  onDirect,
}: {
  project: Project;
  scene: Scene;
  shot: Shot;
  prev: Shot | null;
  uploads: boolean;
  index: number;
  footageName: string | null;
  onPatch: (p: Partial<Shot>) => void;
  onPatchScene: (p: Partial<Scene>) => void;
  onAttachFootage: (f: File | null) => void;
  onShoot: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onNext: () => void;
  directing: boolean;
  onDirect: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const engine = getEngine(shot.engineId);
  const compiled = compileShotPrompt(project, scene, shot, Boolean(prev?.lastFrame));
  const r = shot.render;
  const running = !!r && (r.status === 'queued' || r.status === 'running');
  const cast = project.characters;

  return (
    <div className="pg-panel">
      <div className="pg-monitor" style={{ aspectRatio: project.aspect.replace(':', ' / ') }}>
        {r?.status === 'completed' && r.outputUrl ? (
          r.outputType === 'video' ? (
            <video key={r.outputUrl} src={r.outputUrl} crossOrigin="anonymous" controls autoPlay loop muted playsInline />
          ) : (
            <img src={r.outputUrl} crossOrigin="anonymous" alt={`Shot ${index}`} />
          )
        ) : prev?.lastFrame && shot.continuity ? (
          <img src={prev.lastFrame} alt="Previous shot, last frame" className="pg-ghost" />
        ) : (
          <div className="pg-slate">
            <span className="mono">SCENE {project.scenes.indexOf(scene) + 1} · SHOT {index}</span>
            <span className="display" style={{ fontSize: 22 }}>{shot.angle}</span>
            <span className="mono dim">{shot.camera} · {shot.lens} · {shot.move}</span>
          </div>
        )}
        {running && (
          <div className="progress-veil">
            <span className="eyebrow lime">{r?.status === 'queued' ? 'Queued' : 'Rolling'}</span>
            <div className="display" style={{ fontSize: 34 }}>{Math.round((r?.progress ?? 0) * 100)}%</div>
            <div className="progress-track"><i style={{ width: `${Math.round((r?.progress ?? 0) * 100)}%` }} /></div>
          </div>
        )}
        {r?.status === 'failed' && <span className="pg-badge err">{r.refunded ? 'Failed · refunded' : 'Failed'}</span>}
        {r?.demo && r.status === 'completed' && <span className="pg-badge">Preview render</span>}
        {prev?.lastFrame && shot.continuity && r?.status !== 'completed' && <span className="pg-badge">Continues from shot {index - 1}</span>}
      </div>

      <div className="pg-form">
        <div className="pg-field">
          <label className="eyebrow" htmlFor="scene-heading">Scene</label>
          <input id="scene-heading" className="field" value={scene.heading} maxLength={120} onChange={(e) => onPatchScene({ heading: e.target.value })} />
        </div>
        <div className="pg-row">
          <div className="pg-field" style={{ flex: 2 }}>
            <label className="eyebrow" htmlFor="scene-location">Location</label>
            <input id="scene-location" className="field" value={scene.location} maxLength={160} placeholder="rooftop, old Dhaka alley…" onChange={(e) => onPatchScene({ location: e.target.value })} />
          </div>
          <div className="pg-field" style={{ flex: 1 }}>
            <label className="eyebrow" htmlFor="scene-time">Time</label>
            <select id="scene-time" className="field" value={TIMES.includes(scene.time as (typeof TIMES)[number]) ? scene.time : 'Day'} onChange={(e) => onPatchScene({ time: e.target.value })}>
              {TIMES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="pg-field" style={{ flex: 1 }}>
            <label className="eyebrow" htmlFor="scene-mood">Mood</label>
            <input id="scene-mood" className="field" value={scene.mood} maxLength={80} placeholder="tense" onChange={(e) => onPatchScene({ mood: e.target.value })} />
          </div>
        </div>

        <div className="pg-field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <label className="eyebrow" htmlFor="shot-action">Action</label>
            <button type="button" className="btn btn-text" style={{ fontSize: 12 }} onClick={onDirect} disabled={directing || !shot.action.trim()}>
              <Wand2 size={13} /> {directing ? 'Directing…' : 'Polish with Director'}
            </button>
          </div>
          <textarea
            id="shot-action"
            className="pg-text"
            value={shot.action}
            maxLength={600}
            placeholder="What happens in this shot? English or Banglish."
            onChange={(e) => onPatch({ action: e.target.value })}
          />
        </div>

        <div className="pg-field">
          <span className="eyebrow">In this shot</span>
          <div className="pg-chips">
            {cast.length === 0 && <span className="dim" style={{ fontSize: 13 }}>Add your cast from the top bar.</span>}
            {cast.map((c) => {
              const on = shot.characterIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={on ? 'on' : ''}
                  aria-pressed={on}
                  onClick={() => onPatch({ characterIds: on ? shot.characterIds.filter((x) => x !== c.id) : [...shot.characterIds, c.id] })}
                >
                  {c.ref && <img src={c.ref} alt="" className="pg-chip-face" />}
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pg-field">
          <span className="eyebrow">Dialogue</span>
          {shot.dialogue.map((d) => (
            <div key={d.id} className="pg-row" style={{ alignItems: 'center' }}>
              <select
                className="field"
                style={{ flex: '0 0 140px' }}
                value={d.characterId}
                onChange={(e) => onPatch({ dialogue: shot.dialogue.map((x) => (x.id === d.id ? { ...x, characterId: e.target.value } : x)) })}
                aria-label="Speaker"
              >
                <option value="">VOICE</option>
                {cast.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                className="field"
                value={d.line}
                maxLength={300}
                placeholder="Line (any language)"
                onChange={(e) => onPatch({ dialogue: shot.dialogue.map((x) => (x.id === d.id ? { ...x, line: e.target.value } : x)) })}
                aria-label="Dialogue line"
              />
              <button type="button" className="icon-btn" onClick={() => onPatch({ dialogue: shot.dialogue.filter((x) => x.id !== d.id) })} aria-label="Remove line">
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-text"
            style={{ fontSize: 12, alignSelf: 'flex-start' }}
            onClick={() => onPatch({ dialogue: [...shot.dialogue, { id: uid(), characterId: shot.characterIds[0] ?? cast[0]?.id ?? '', line: '' }] })}
          >
            <Plus size={13} /> Add line
          </button>
        </div>

        <Chips label="Camera" options={CAMERAS} value={shot.camera} onPick={(camera) => onPatch({ camera })} />
        <Chips label="Lens" options={LENSES} value={shot.lens} onPick={(lens) => onPatch({ lens })} />
        <Chips label="Angle" options={ANGLES} value={shot.angle} onPick={(angle) => onPatch({ angle })} />
        <Chips label="Movement" options={MOVES} value={shot.move} onPick={(move) => onPatch({ move })} />

        <div className="pg-field">
          <span className="eyebrow">Reference</span>
          <ReferenceCard shot={shot} prev={prev} index={index} cast={cast} uploads={uploads} sceneNo={project.scenes.indexOf(scene) + 1} />
        </div>

        <div className="pg-row">
          <div className="pg-field" style={{ flex: 1 }}>
            <span className="eyebrow">Source</span>
            <div className="seg" style={{ padding: 0 }}>
              <button type="button" className={shot.source === 'generate' ? 'on' : ''} onClick={() => onPatch({ source: 'generate' })}>Generate</button>
              <button type="button" className={shot.source === 'footage' ? 'on' : ''} onClick={() => onPatch({ source: 'footage' })}>My footage</button>
            </div>
            {shot.source === 'footage' && (
              <>
                <label className="btn btn-glass btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                  <Film size={14} /> {footageName ? footageName.slice(0, 28) : 'Attach clip'}
                  <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => { onAttachFootage(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                </label>
                {shot.engineId !== 'kinetix-pro' && (
                  <small className="dim" style={{ fontSize: 11.5 }}>
                    Video plates require Kinetix Pro; partner engines ignore clip footage.
                  </small>
                )}
              </>
            )}
          </div>
          <div className="pg-field" style={{ flex: 1 }}>
            <span className="eyebrow">Duration</span>
            <div className="seg" style={{ padding: 0 }}>
              {DURATIONS.map((d) => (
                <button key={d} type="button" className={d === shot.duration ? 'on' : ''} disabled={engine.kind === 'image'} onClick={() => onPatch({ duration: d as Duration })}>{d}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="pg-row" style={{ alignItems: 'flex-end' }}>
          <div className="pg-field" style={{ flex: 1 }}>
            <label className="eyebrow" htmlFor="shot-engine">Engine</label>
            <select id="shot-engine" className="field" value={shot.engineId} onChange={(e) => onPatch({ engineId: e.target.value as EngineId })}>
              <optgroup label="Video">
                {ENGINES.filter((e) => e.kind === 'video').map((e) => <option key={e.id} value={e.id}>{e.name} · {e.credits} CR</option>)}
              </optgroup>
              <optgroup label="Image (storyboard frame)">
                {ENGINES.filter((e) => e.kind === 'image').map((e) => <option key={e.id} value={e.id}>{e.name} · {e.credits} CR</option>)}
              </optgroup>
            </select>
          </div>
          <button
            type="button"
            className={`opt${shot.continuity ? ' on' : ''}`}
            style={{ flex: 1, padding: '6px 10px' }}
            role="switch"
            aria-checked={Boolean(prev && shot.continuity)}
            disabled={!prev}
            onClick={() => onPatch({ continuity: !shot.continuity })}
          >
            <Link2 size={15} />
            <span className="opt-main">
              <b>Continuity</b>
              <small>{prev ? (prev.lastFrame ? 'Start from last shot’s final frame' : 'Shoot the previous shot first') : 'First shot of the scene'}</small>
            </span>
            <span className={`toggle${shot.continuity && prev ? ' on' : ''}`} aria-hidden="true" />
          </button>
        </div>

        <div className="pg-field">
          <button type="button" className="btn btn-text" style={{ fontSize: 12, alignSelf: 'flex-start' }} onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? 'Hide' : 'Show'} shot prompt {shot.promptOverride !== null ? '(edited)' : ''}
          </button>
          {showPrompt && (
            <>
              <textarea
                className="pg-text mono"
                style={{ minHeight: 130, fontSize: 12 }}
                value={shot.promptOverride ?? compiled}
                maxLength={4000}
                onChange={(e) => onPatch({ promptOverride: e.target.value })}
                aria-label="Shot prompt"
              />
              {shot.promptOverride !== null && (
                <button type="button" className="btn btn-text" style={{ fontSize: 12, alignSelf: 'flex-start' }} onClick={() => onPatch({ promptOverride: null })}>
                  Reset to automatic
                </button>
              )}
            </>
          )}
        </div>

        <div className="pg-actions">
          <button type="button" className="icon-btn" onClick={onDelete} aria-label="Delete shot" title="Delete shot">
            <Trash2 size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onDuplicate} aria-label="Duplicate shot" title="Duplicate shot">
            <Copy size={15} />
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-glass btn-sm" onClick={onNext}>
            <Plus size={14} /> Next shot
          </button>
          {running ? (
            <button type="button" className="btn btn-glass" onClick={onCancel}>
              <Square size={13} fill="currentColor" /> Cancel
            </button>
          ) : (
            <button type="button" className="btn btn-lime" onClick={onShoot}>
              {r?.status === 'queued' ? <Loader2 size={16} className="spin" /> : <Clapperboard size={16} />}
              {r?.status === 'completed' ? 'Reshoot' : 'Shoot'} <span className="mono" style={{ fontSize: 12, opacity: 0.7 }}>· {engine.credits} CR</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
