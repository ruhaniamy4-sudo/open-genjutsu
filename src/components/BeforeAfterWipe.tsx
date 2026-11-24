'use client';

import { animate, motion, useMotionValue, useMotionValueEvent, useSpring, useTransform } from 'framer-motion';
import { MoveHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface Props {
  before: string;
  after: string;
  /** Simulate a flat S-Log3 plate from `before` with a CSS grade (when no real raw plate exists). */
  simulateRaw?: boolean;
  beforeLabel?: string;
  afterLabel?: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** Sweep once on mount to show the user it is interactive. */
  intro?: boolean;
}

/**
 * Magnetic before/after wipe: the handle springs toward the pointer on hover (mouse)
 * or follows a drag (touch/pen). Keyboard: arrows, Home, End.
 */
export default function BeforeAfterWipe({
  before,
  after,
  simulateRaw = false,
  beforeLabel = 'Original',
  afterLabel = 'Kinetix',
  alt = 'Before and after comparison',
  className,
  style,
  intro = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useMotionValue(50);
  const pos = useSpring(target, { stiffness: 420, damping: 30, mass: 0.8 });
  const clip = useTransform(pos, (v) => `inset(0 ${100 - v}% 0 0)`);
  const left = useTransform(pos, (v) => `${v}%`);
  const [value, setValue] = useState(50);
  const dragging = useRef(false);
  useMotionValueEvent(pos, 'change', (v) => setValue(Math.round(v)));

  useEffect(() => {
    if (!intro) return;
    const controls = animate(target, [50, 72, 30, 50], { duration: 2.2, ease: 'easeInOut', delay: 0.6 });
    return () => controls.stop();
  }, [intro, target]);

  const setFromX = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect?.width) return;
    target.set(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      ref={ref}
      className={`wipe${className ? ` ${className}` : ''}`}
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={alt}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}% ${beforeLabel}`}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' || dragging.current) setFromX(e.clientX);
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
        setFromX(e.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 4;
        if (e.key === 'ArrowLeft') target.set(Math.max(0, target.get() - step));
        else if (e.key === 'ArrowRight') target.set(Math.min(100, target.get() + step));
        else if (e.key === 'Home') target.set(0);
        else if (e.key === 'End') target.set(100);
        else return;
        e.preventDefault();
      }}
    >
      <img src={after} alt="" draggable={false} />
      <motion.div style={{ position: 'absolute', inset: 0, clipPath: clip }}>
        <img src={before} alt="" className={simulateRaw ? 'raw' : undefined} draggable={false} />
      </motion.div>
      <span className="wipe-tag" style={{ left: 14 }}>{beforeLabel}</span>
      <span className="wipe-tag" style={{ right: 14, color: 'var(--lime)' }}>{afterLabel}</span>
      <motion.div className="wipe-handle" style={{ left }} aria-hidden="true">
        <span className="wipe-knob">
          <MoveHorizontal size={16} />
        </span>
      </motion.div>
    </div>
  );
}
