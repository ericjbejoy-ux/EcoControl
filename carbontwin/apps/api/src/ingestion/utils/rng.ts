/**
 * Deterministic pseudo-random utilities.
 * Used by the synthetic generator and fallback provider so that demo data is
 * reproducible across runs (important for tests and judging).
 */

/** mulberry32 — tiny, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an arbitrary string into a 32-bit integer seed. */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  /** Box–Muller normal sample with mean `mu` and std-dev `sigma`. */
  normal(mu: number, sigma: number): number;
  pick<T>(items: readonly T[]): T;
  bool(p?: number): boolean;
}

export function createRng(seed: number | string): Rng {
  const numericSeed = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  const next = mulberry32(numericSeed);
  let spare: number | null = null;

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    normal(mu, sigma) {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return mu + sigma * value;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      return mu + sigma * (u * mul);
    },
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
    bool: (p = 0.5) => next() < p,
  };
}
