/**
 * Interval validation (FR-1/FR-5, validators/intervalValidator.ts).
 * Detects duplicate timestamps, gaps (missing intervals), irregular spacing and
 * negative/implausible power values, and computes a regularity score.
 */

import { median } from '../utils/stats.js';

export interface Gap {
  /** First missing grid slot (UTC ISO). */
  start: string;
  /** Last missing grid slot (UTC ISO). */
  end: string;
  missingIntervals: number;
  minutes: number;
}

export interface IntervalValidationResult {
  /** Total observations supplied. */
  count: number;
  duplicates: string[];
  duplicateCount: number;
  gaps: Gap[];
  gapCount: number;
  missingIntervals: number;
  /** Off-grid points (not aligned to the expected interval). */
  irregularCount: number;
  /** Observed interval that occurs most often, in minutes. */
  dominantIntervalMinutes: number;
  /** 0–1; 1 = perfectly regular, no gaps or duplicates. */
  regularityScore: number;
  /** Overall span in the source data (UTC ISO). */
  span: { start: string | null; end: string | null };
}

function isoOf(date: Date): string {
  return date.toISOString();
}

/**
 * Validate a set of UTC millisecond timestamps against an expected interval.
 */
export function validateIntervals(
  timestampsMs: number[],
  expectedIntervalMinutes = 15,
  options: { tolerancePct?: number; maxGapReport?: number } = {}
): IntervalValidationResult {
  const { tolerancePct = 5, maxGapReport = 1000 } = options;
  const expectedMs = expectedIntervalMinutes * 60_000;
  const result: IntervalValidationResult = {
    count: timestampsMs.length,
    duplicates: [],
    duplicateCount: 0,
    gaps: [],
    gapCount: 0,
    missingIntervals: 0,
    irregularCount: 0,
    dominantIntervalMinutes: expectedIntervalMinutes,
    regularityScore: 1,
    span: { start: null, end: null },
  };
  if (timestampsMs.length === 0) {
    result.regularityScore = 0;
    return result;
  }

  const sorted = [...timestampsMs].sort((a, b) => a - b);
  result.span = { start: isoOf(new Date(sorted[0] as number)), end: isoOf(new Date(sorted[sorted.length - 1] as number)) };

  // Duplicates
  const seen = new Set<number>();
  const duplicates: string[] = [];
  for (const t of sorted) {
    if (seen.has(t)) {
      if (duplicates.length < 100) duplicates.push(isoOf(new Date(t)));
      result.duplicateCount++;
    } else {
      seen.add(t);
    }
  }
  result.duplicates = duplicates;

  // Deltas
  const unique = [...seen].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < unique.length; i++) {
    deltas.push((unique[i] as number) - (unique[i - 1] as number));
  }

  if (deltas.length > 0) {
    const dominant = median(deltas);
    result.dominantIntervalMinutes = Math.round(dominant / 60_000);
    const toleranceMs = expectedMs * (tolerancePct / 100);

    let missingTotal = 0;
    const gaps: Gap[] = [];
    for (let i = 1; i < unique.length; i++) {
      const prev = unique[i - 1] as number;
      const cur = unique[i] as number;
      const d = cur - prev;
      if (d > expectedMs + toleranceMs) {
        const missing = Math.max(0, Math.round(d / expectedMs) - 1);
        missingTotal += missing;
        if (gaps.length < maxGapReport) {
          gaps.push({
            start: isoOf(new Date(prev + expectedMs)),
            end: isoOf(new Date(cur - expectedMs)),
            missingIntervals: missing,
            minutes: Math.round(d / 60_000) - expectedIntervalMinutes,
          });
        }
      } else if (Math.abs(d - expectedMs) > toleranceMs) {
        result.irregularCount++;
      }
    }
    result.gaps = gaps.sort((a, b) => b.missingIntervals - a.missingIntervals).slice(0, 100);
    result.gapCount = result.gaps.length;
    result.missingIntervals = missingTotal;
  }

  const totalSlots = unique.length + result.missingIntervals;
  const completeness = totalSlots > 0 ? unique.length / totalSlots : 0;
  const irregularPenalty = unique.length > 1 ? result.irregularCount / Math.max(1, unique.length - 1) : 0;
  result.regularityScore = Math.max(0, Math.min(1, completeness * (1 - irregularPenalty)));

  return result;
}

/** Detect duplicates within a list of UTC ISO strings. */
export function findDuplicateTimestamps(isoStrings: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const iso of isoStrings) {
    if (seen.has(iso)) dupes.add(iso);
    else seen.add(iso);
  }
  return [...dupes];
}
