'use client';

import { useEffect, useState } from 'react';

/** Column count for the masonry wall by viewport width. */
export function useColumnCount(): number {
  const [n, setN] = useState(4);
  useEffect(() => {
    const pick = () => {
      const w = window.innerWidth;
      setN(w >= 1200 ? 4 : w >= 860 ? 3 : 2);
    };
    pick();
    window.addEventListener('resize', pick);
    return () => window.removeEventListener('resize', pick);
  }, []);
  return n;
}

/** Greedy shortest-column placement so column bottoms line up. `ratio` = width / height. */
export function balance<T>(items: T[], cols: number, ratio: (item: T) => number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => []);
  const heights = new Array<number>(cols).fill(0);
  for (const item of items) {
    let min = 0;
    for (let c = 1; c < cols; c++) if (heights[c] < heights[min] - 1e-6) min = c;
    out[min].push(item);
    heights[min] += 1 / Math.max(0.1, ratio(item));
  }
  return out;
}
