/** House spring: snappy, no sloppy bounce. */
export const SPRING = { type: 'spring', stiffness: 420, damping: 30, mass: 0.8 } as const;

export const EASE = [0.22, 1, 0.36, 1] as const;

export const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: SPRING,
} as const;
