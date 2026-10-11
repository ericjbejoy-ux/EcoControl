/**
 * Series helpers: interpolate sparse (e.g. hourly) provider data onto a dense
 * 15-minute grid so carbon intensity and weather align with meter readings.
 */

/** Linear interpolation of a numeric series onto a target grid. */
export function interpolateNumericSeries(
  sourceMs: number[],
  sourceValues: number[],
  targetMs: number[]
): number[] {
  const pairs = sourceMs
    .map((t, i) => ({ t, v: sourceValues[i] as number }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  if (pairs.length === 0) return targetMs.map(() => NaN);
  if (pairs.length === 1) return targetMs.map(() => pairs[0]!.v);

  const out: number[] = [];
  let cursor = 0;
  for (const t of targetMs) {
    // Advance cursor so pairs[cursor].t <= t <= pairs[cursor+1].t where possible.
    while (cursor < pairs.length - 1 && (pairs[cursor + 1] as { t: number }).t < t) cursor++;
    if (t <= (pairs[0] as { t: number }).t) {
      out.push((pairs[0] as { v: number }).v);
      continue;
    }
    const last = pairs[pairs.length - 1] as { t: number; v: number };
    if (t >= last.t) {
      out.push(last.v);
      continue;
    }
    const a = pairs[cursor] as { t: number; v: number };
    const b = pairs[cursor + 1] as { t: number; v: number };
    const span = b.t - a.t;
    const frac = span === 0 ? 0 : (t - a.t) / span;
    out.push(a.v + (b.v - a.v) * frac);
  }
  return out;
}

export interface SeriesPoint<T> {
  timestamp: string;
  value: T;
}

/** Nearest-neighbour lookup of the value at a target timestamp. */
export function nearestValue<T>(points: Array<{ timestamp: string; value: T }>, targetMs: number): T | null {
  if (points.length === 0) return null;
  let best: { diff: number; value: T } | null = null;
  for (const p of points) {
    const diff = Math.abs(Date.parse(p.timestamp) - targetMs);
    if (!best || diff < best.diff) best = { diff, value: p.value };
  }
  return best ? best.value : null;
}
