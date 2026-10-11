/**
 * Outlier detection (FR-5, cleaning/outlierDetector.ts).
 * Combines three complementary detectors:
 *  1. robust (MAD) z-score — tolerant to the outliers themselves
 *  2. classical z-score — catches series-wide extremes
 *  3. rate-of-change (delta) — catches spikes that look normal in absolute terms
 * Outlier slots are optionally marked so the imputer can reconstruct them.
 */

import { median, mean, stdDev, mad } from '../utils/stats.js';

export interface OutlierOptions {
  /** Robust z-score threshold (default 3.5). */
  zScoreThreshold?: number;
  /** Also flag on absolute z-score (default: true). */
  useAbsoluteZ?: boolean;
  /** Also flag on rate-of-change (default: true). */
  useRateOfChange?: boolean;
  /** If true, extreme outliers are blanked so the imputer can fill them. */
  replaceWithNull?: boolean;
}

export interface OutlierHit {
  index: number;
  value: number;
  robustZ: number;
  absoluteZ: number;
  deltaZ: number;
  reasons: string[];
}

export interface OutlierResult {
  outlierCount: number;
  threshold: number;
  hits: OutlierHit[];
  /** Indices flagged as outliers. */
  indices: number[];
  /** Copy of the input, with outliers blanked when `replaceWithNull` is set. */
  values: Array<number | null>;
}

export function detectOutliers(
  values: Array<number | null>,
  options: OutlierOptions = {}
): OutlierResult {
  const {
    zScoreThreshold = 3.5,
    useAbsoluteZ = true,
    useRateOfChange = true,
    replaceWithNull = false,
  } = options;

  const finite: number[] = [];
  for (const v of values) if (v !== null && Number.isFinite(v)) finite.push(v);

  const empty: OutlierResult = {
    outlierCount: 0,
    threshold: zScoreThreshold,
    hits: [],
    indices: [],
    values: [...values],
  };
  if (finite.length < 4) return empty;

  const med = median(finite);
  const madValue = mad(finite);
  const meanValue = mean(finite);
  const sd = stdDev(finite);

  // Delta statistics
  const deltas: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev != null && cur != null && Number.isFinite(prev) && Number.isFinite(cur)) {
      deltas.push(cur - prev);
    }
  }
  const deltaMed = median(deltas.length ? deltas : [0]);
  const deltaMad = mad(deltas.length ? deltas : [0]) || (deltas.length ? stdDev(deltas) : 0);

  const hits: OutlierHit[] = [];
  const flagged = new Set<number>();

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;

    const robustZ = madValue === 0 ? (v === med ? 0 : Infinity) : (0.6745 * (v - med)) / madValue;
    const absoluteZ = sd === 0 ? 0 : (v - meanValue) / sd;

    let deltaZ = 0;
    if (useRateOfChange && i > 0) {
      const prev = values[i - 1];
      if (prev != null && Number.isFinite(prev)) {
        const d = v - prev;
        deltaZ = deltaMad === 0 ? (d === deltaMed ? 0 : Infinity) : (0.6745 * (d - deltaMed)) / deltaMad;
      }
    }

    const reasons: string[] = [];
    if (Math.abs(robustZ) > zScoreThreshold) reasons.push('robust_zscore');
    if (useAbsoluteZ && Math.abs(absoluteZ) > zScoreThreshold) reasons.push('absolute_zscore');
    if (useRateOfChange && Math.abs(deltaZ) > zScoreThreshold * 1.5) reasons.push('rate_of_change');

    if (reasons.length > 0) {
      hits.push({ index: i, value: v, robustZ, absoluteZ, deltaZ, reasons });
      flagged.add(i);
    }
  }

  const outValues = [...values];
  if (replaceWithNull) for (const i of flagged) outValues[i] = null;

  return {
    outlierCount: hits.length,
    threshold: zScoreThreshold,
    hits,
    indices: [...flagged],
    values: outValues,
  };
}

/**
 * Detect points where the load exceeds `maxInstantKw` (physical plant limit),
 * used as an extra validity check independent of statistics.
 */
export function detectPhysicalViolations(
  values: Array<number | null>,
  maxInstantKw: number
): number[] {
  const out: number[] = [];
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v) && Math.abs(v) > maxInstantKw) out.push(i);
  });
  return out;
}
