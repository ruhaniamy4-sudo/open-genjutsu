'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Download, ImagePlus, Plus, Printer, Trash2, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildShotList, exportShotListCsv, exportShotListHtml, parseScript, uid, type Character, type Project, type Shot } from '@/lib/playground';
import { fileToJpeg } from '@/lib/client/render';
import { SPRING } from '@/lib/motion';

function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="sheet"
            style={{ width: wide ? 'min(860px, 100%)' : undefined, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto' }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={SPRING}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="display" style={{ fontSize: 24 }}>{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CharactersSheet({
  open,
  onClose,
  characters,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  characters: Character[];
  onChange: (next: Character[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const patch = (id: string, p: Partial<Character>) => onChange(characters.map((c) => (c.id === id ? { ...c, ...p } : c)));

  return (
    <Sheet open={open} onClose={onClose} title="Cast" wide>
      <p className="muted" style={{ fontSize: 14 }}>
        Add a portrait for each character. It is used as the identity reference in every shot they appear in.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !target) return;
          const ref = await fileToJpeg(f, 512);
          if (!ref) setErr('Could not read that image.');
          else patch(target, { ref });
        }}
      />
      {err && <p style={{ color: 'var(--error)', fontSize: 13 }}>{err}</p>}
      <div className="pg-cast">
        {characters.map((c) => (
          <div key={c.id} className="pg-cast-row">
            <button
              type="button"
              className="pg-portrait"
              onClick={() => {
                setTarget(c.id);
                fileRef.current?.click();
              }}
              aria-label={`Upload portrait for ${c.name || 'character'}`}
            >
              {c.ref ? <img src={c.ref} alt="" /> : <ImagePlus size={18} />}
            </button>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <input className="field" value={c.name} placeholder="NAME" maxLength={24} onChange={(e) => patch(c.id, { name: e.target.value.toUpperCase() })} aria-label="Character name" />
              <input
                className="field"
                value={c.description}
                placeholder="Look: age, hair, wardrobe…"
                maxLength={200}
                onChange={(e) => patch(c.id, { description: e.target.value })}
                aria-label="Character description"
              />
            </div>
            <button type="button" className="icon-btn" onClick={() => onChange(characters.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-glass btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...characters, { id: uid(), name: `CHARACTER ${characters.length + 1}`, description: '', ref: null }])}
      >
        <Plus size={14} /> Add character
      </button>
    </Sheet>
  );
}

const SCRIPT_HINT = `EXT. OLD DHAKA ALLEY – NIGHT
Rafi walks through heavy rain, neon signs flicker above him.
RAFI: Ar ekta delivery. Tarpor shesh.
Mitu appears at the end of the alley under a red lamp.

INT. TEA STALL – NIGHT
Steam rises from the kettle as Rafi sits down.`;

export function ScriptSheet({ open, onClose, project, onImport }: { open: boolean; onClose: () => void; project: Project; onImport: (p: Project, append: boolean) => void }) {
  const [text, setText] = useState('');
  const [append, setAppend] = useState(false);
  const deferredText = useDeferredValue(text);
  const preview = useMemo(
    () => (deferredText.trim() ? parseScript(deferredText, { ...project, characters: project.characters }, { append }) : null),
    [deferredText, project, append],
  );
  return (
    <Sheet open={open} onClose={onClose} title="Import script" wide>
      <p className="muted" style={{ fontSize: 14 }}>
        Paste your script. <span className="mono">INT./EXT./দৃশ্য</span> lines start scenes, <span className="mono">NAME: line</span> (English or Bangla) is dialogue, blank lines separate shots.
      </p>
      <label htmlFor="script-text" className="sr-only">Script</label>
      <textarea id="script-text" className="pg-script" value={text} onChange={(e) => setText(e.target.value)} placeholder={SCRIPT_HINT} maxLength={40_000} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-lime btn-sm"
          disabled={!text.trim()}
          onClick={() => {
            const built = parseScript(text, { ...project, characters: project.characters }, { append });
            onImport(built, append);
            setText('');
          }}
        >
          {append ? 'Append scenes' : 'Build scenes'}
        </button>
        <div className="seg" style={{ padding: 0 }}>
          <button type="button" className={!append ? 'on' : ''} onClick={() => setAppend(false)}>
            Replace
          </button>
          <button type="button" className={append ? 'on' : ''} onClick={() => setAppend(true)}>
            Append
          </button>
        </div>
        {preview && (
          <span className="mono dim" style={{ fontSize: 12 }}>
            {preview.scenes.length} scenes · {preview.scenes.reduce((n, s) => n + s.shots.length, 0)} shots · {preview.characters.length} characters
          </span>
        )}
      </div>
    </Sheet>
  );
}

/** Printable shot list preview + CSV / Print (PDF) export. */
export function ShotListSheet({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const rows = useMemo(() => buildShotList(project), [project]);

  const downloadCsv = () => {
    const csv = exportShotListCsv(project);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const slug = (project.title || 'shot-list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shot-list';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-shot-list.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const printSheet = () => {
    const html = exportShotListHtml(project);
    const win = window.open('', '_blank', 'width=1024,height=760');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 250);
      return;
    }
    // Fallback when popups are blocked: print via a hidden iframe.
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 1500);
      }, 250);
    } else {
      iframe.remove();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Shot list" wide>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-lime btn-sm" onClick={printSheet}>
          <Printer size={14} /> Print / Save PDF
        </button>
        <button type="button" className="btn btn-glass btn-sm" onClick={downloadCsv}>
          <Download size={14} /> Download CSV
        </button>
        <span className="mono dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {project.scenes.length} scenes · {rows.length} shots
        </span>
      </div>
      <div className="table-scroll" style={{ maxHeight: '55dvh' }}>
        <table className="econ pg-shotlist-table">
          <thead>
            <tr>
              <th>Scene</th>
              <th>Shot</th>
              <th>Camera &amp; Framing</th>
              <th>Dur</th>
              <th>Action</th>
              <th>Dialogue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.sceneNumber}-${r.shotNumber}`}>
                <td className="mono">
                  S{r.sceneNumber}
                  <div className="dim" style={{ fontSize: 11 }}>{r.sceneHeading}</div>
                </td>
                <td className="mono">{r.shotNumber}</td>
                <td>
                  <div>{r.angle}</div>
                  <div className="dim" style={{ fontSize: 11 }}>{r.camera} · {r.lens} · {r.move}</div>
                </td>
                <td className="mono">{r.duration}</td>
                <td style={{ maxWidth: 260 }}>{r.action || '—'}</td>
                <td style={{ maxWidth: 240 }}>{r.dialogue || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}

/** Plays every finished shot in order, like a rough cut. */
export function FilmPlayer({ open, onClose, shots }: { open: boolean; onClose: () => void; shots: Shot[] }) {
  const playable = shots.filter((s) => s.render?.status === 'completed' && s.render.outputUrl);
  const [i, setI] = useState(0);
  const [failedId, setFailedId] = useState<string | null>(null);
  const cur = playable[i];
  const mediaError = Boolean(cur && failedId === cur.id);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restart the cut whenever the player opens
    if (open) setI(0);
  }, [open]);

  useEffect(() => {
    if (!open || !cur || cur.render?.outputType === 'video') return;
    const t = setTimeout(() => setI((n) => n + 1), 2500);
    return () => clearTimeout(t);
  }, [open, cur, i]);

  return (
    <Sheet open={open} onClose={onClose} title="Rough cut" wide>
      {playable.length === 0 ? (
        <p className="muted">Shoot a few shots first. Finished shots play here in order.</p>
      ) : cur ? (
        <div className="pg-player">
          {mediaError ? (
            <p className="muted" style={{ padding: '24px 0' }}>Could not load media for shot {i + 1}.</p>
          ) : cur.render?.outputType === 'video' ? (
            <video
              key={cur.id}
              src={cur.render.outputUrl!}
              autoPlay
              playsInline
              controls
              onEnded={() => setI((n) => n + 1)}
              onError={() => setFailedId(cur.id)}
            />
          ) : (
            <img key={cur.id} src={cur.render!.outputUrl!} alt="" onError={() => setFailedId(cur.id)} />
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              className="icon-btn"
              disabled={i <= 0}
              onClick={() => {
                setFailedId(null);
                setI((n) => Math.max(0, n - 1));
              }}
              aria-label="Previous shot"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="mono dim" style={{ fontSize: 12 }}>
              Shot {i + 1} / {playable.length}
            </span>
            <button
              type="button"
              className="icon-btn"
              disabled={i >= playable.length - 1}
              onClick={() => {
                setFailedId(null);
                setI((n) => Math.min(playable.length - 1, n + 1));
              }}
              aria-label="Next shot"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <p className="muted">End of cut.</p>
          <button
            type="button"
            className="btn btn-glass btn-sm"
            onClick={() => {
              setFailedId(null);
              setI(0);
            }}
          >
            Play again
          </button>
        </div>
      )}
    </Sheet>
  );
}
