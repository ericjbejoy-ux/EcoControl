/**
 * Small, dependency-free numeric helpers used across cleaning / outliers /
 * quality reporting. No external stats library needed.
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base] as number;
  const upper = sorted[Math.min(base + 1, sorted.length - 1)] as number;
  return lower + rest * (upper - lower);
}

export function stdDev(values: number[], sample = true): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - (sample ? 1 : 0));
  return Math.sqrt(variance);
}

export function min(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

export function max(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

/** Median absolute deviation — robust spread estimate. */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** Robust z-score based on MAD (scaled to be comparable to std-dev z). */
export function robustZScore(value: number, values: number[]): number {
  const m = median(values);
  const d = mad(values);
  if (d === 0) return value === m ? 0 : Infinity;
  return (0.6745 * (value - m)) / d;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Linear interpolation between two points. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pearson correlation coefficient. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}
