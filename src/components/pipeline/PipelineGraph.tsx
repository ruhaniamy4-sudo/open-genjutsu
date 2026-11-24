'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

type NodeId = 'upload' | 'r2' | 'director' | 'credits' | 'router' | 'gpu' | 'fal' | 'output';

interface GraphNode {
  id: NodeId;
  title: string;
  sub: string;
  detail: string;
  stack: string[];
}

const NODES: Record<NodeId, GraphNode> = {
  upload: {
    id: 'upload',
    title: 'Your material',
    sub: 'Clip, portrait, script or just an idea',
    detail: 'Bring your own footage for VFX, a character photo for identity, or nothing at all. Write in English, Bangla or Banglish.',
    stack: ['MP4 / MOV / WebM clips', 'JPG / PNG / WebP portraits', 'Script lines and dialogue'],
  },
  r2: {
    id: 'r2',
    title: 'Private upload',
    sub: 'Only your renders can read it',
    detail: 'Files go straight to private storage with short-lived links. Nobody else can open them.',
    stack: ['Signed, expiring links', 'Up to 500 MB per clip', 'Deleted from previews when you remove them'],
  },
  director: {
    id: 'director',
    title: 'Director Agent',
    sub: 'Writes the shot for you',
    detail: 'Reads your words and the first frame of your clip, then writes one precise shot prompt: identity, lens, light, camera move and what to avoid.',
    stack: ['Understands Banglish', 'Keeps character identity locked', 'You can edit every word'],
  },
  credits: {
    id: 'credits',
    title: 'Fair credits',
    sub: 'Pay only for finished shots',
    detail: 'Credits are reserved when a shot starts. If it fails or you cancel, they come straight back.',
    stack: ['Exact price before you render', 'Automatic refunds', 'Monthly top-ups on paid plans'],
  },
  router: {
    id: 'router',
    title: 'Engine choice',
    sub: 'One studio, every model',
    detail: 'Pick the engine per shot. The same prompt, references and continuity carry over, whatever you choose.',
    stack: ['Video and image models', 'Live progress while it renders', 'Cancel any time'],
  },
  gpu: {
    id: 'gpu',
    title: 'Kinetix Pro',
    sub: 'Our own cinema model',
    detail: 'Tuned for skin, hair and neon without banding, with face refine and a filmic grade built in. About half the credits of partner engines.',
    stack: ['FP16 video quality', 'Macro face refine', 'Orion4D filmic grade'],
  },
  fal: {
    id: 'fal',
    title: 'Partner engines',
    sub: 'Kling · Veo · Seedance · WAN · image models',
    detail: 'The best-known video and image models, inside the same studio and the same credits.',
    stack: ['Kling 3.0, Veo 3.1, Seedance 2.5, WAN 2.6', 'Nano Banana, GPT Image, FLUX', 'Same Director prompt'],
  },
  output: {
    id: 'output',
    title: 'Your film',
    sub: 'Library, playground, download',
    detail: 'Every shot lands in your Library and in your Film Playground timeline, ready to download or continue.',
    stack: ['Before / after compare', 'Continue the next shot from the last frame', 'One-click download'],
  },
};

const COLUMNS: NodeId[][] = [['upload', 'r2'], ['director', 'credits'], ['router'], ['gpu', 'fal'], ['output']];
const EDGES: Array<[NodeId, NodeId, 'flow' | 'alt' | '']> = [
  ['upload', 'director', 'flow'],
  ['r2', 'director', ''],
  ['upload', 'credits', ''],
  ['director', 'router', 'flow'],
  ['credits', 'router', ''],
  ['router', 'gpu', 'flow'],
  ['router', 'fal', 'alt'],
  ['gpu', 'output', 'flow'],
  ['fal', 'output', 'alt'],
];

export default function PipelineGraph() {
  const [selected, setSelected] = useState<NodeId>('director');
  const [paths, setPaths] = useState<Array<{ d: string; cls: string }>>([]);
  const graphRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Partial<Record<NodeId, HTMLButtonElement | null>>>({});


  useLayoutEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const draw = () => {
      const g = graph.getBoundingClientRect();
      const next = EDGES.flatMap(([a, b, cls]) => {
        const ra = nodeRefs.current[a]?.getBoundingClientRect();
        const rb = nodeRefs.current[b]?.getBoundingClientRect();
        if (!ra || !rb) return [];
        const x1 = ra.right - g.left;
        const y1 = ra.top + ra.height / 2 - g.top;
        const x2 = rb.left - g.left;
        const y2 = rb.top + rb.height / 2 - g.top;
        const dx = Math.max(30, (x2 - x1) / 2);
        return [{ d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, cls }];
      });
      setPaths(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(graph);
    return () => ro.disconnect();
  }, []);

  const node = NODES[selected];

  return (
    <section className="section wrap" style={{ paddingTop: 56 }}>
      <div className="graph" ref={graphRef}>
        <svg className="graph-svg" aria-hidden="true">
          {paths.map((p, i) => (
            <path key={i} d={p.d} className={p.cls ? `flow${p.cls === 'alt' ? ' alt' : ''}` : ''} />
          ))}
        </svg>
        {COLUMNS.map((col, ci) => (
          <div className="gcol" key={ci}>
            {col.map((id) => (
              <motion.button
                key={id}
                ref={(el) => {
                  nodeRefs.current[id] = el;
                }}
                type="button"
                className={`gnode${selected === id ? ' on' : ''}`}
                onClick={() => {
                  playSfx('tap');
                  setSelected(id);
                }}
                aria-pressed={selected === id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ ...SPRING, delay: ci * 0.07 }}
              >
                <b>{NODES[id].title}</b>
                <small>{NODES[id].sub}</small>

              </motion.button>
            ))}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={node.id} className="node-detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={SPRING}>
          <div>
            <span className="eyebrow">How it works</span>
            <h2 className="display" style={{ fontSize: 30, marginTop: 8 }}>{node.title}</h2>
            <p className="muted" style={{ marginTop: 10 }}>{node.detail}</p>
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, alignSelf: 'center' }}>
            {node.stack.map((s) => (
              <li key={s} className="mono" style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', gap: 10 }}>
                <span className="lime" aria-hidden="true">→</span>
                {s}
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
