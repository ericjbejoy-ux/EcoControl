/**
 * Gap filling / imputation (FR-5, cleaning/imputer.ts).
 * Strategy ladder (least invasive first):
 *  1. Linear interpolation across short gaps (≤ maxInterpolationGapMinutes)
 *  2. Diurnal profile (weekday/weekend × hour × quarter) learned from the series
 *  3. Series mean
 *  4. Synthetic diurnal shape (last resort — always available, so the grid is
 *     never left with holes)
 */

import { round } from '../utils/stats.js';
import { DateTime } from 'luxon';
import type { GridPoint, GridSlot, QualityKind } from '../types.js';

export interface ImputeOptions {
  /** Longest gap (minutes) that may be linearly interpolated. */
  maxInterpolationGapMinutes?: number;
  /** Timezone used to build the diurnal profile. */
  timezone?: string;
  /** Force a synthetic fallback value when nothing else is available (kW). */
  syntheticFallbackKw?: number;
}

export interface ImputeResult {
  points: GridPoint[];
  /** Total slots filled by any method. */
  filledCount: number;
  interpolatedCount: number;
  imputedCount: number;
  syntheticCount: number;
}

/** Build a diurnal profile keyed by `weekday|hour|quarter`. */
export function buildDiurnalProfile(
  slots: GridSlot[],
  timezone: string
): { profile: Map<string, number>; seriesMean: number | null } {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const slot of slots) {
    if (slot.powerKw === null || !Number.isFinite(slot.powerKw)) continue;
    all.push(slot.powerKw);
    const dt = DateTime.fromISO(slot.timestampUtc, { zone: 'utc' }).setZone(timezone);
    const key = profileKey(dt);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(slot.powerKw);
    else buckets.set(key, [slot.powerKw]);
  }
  const profile = new Map<string, number>();
  for (const [key, values] of buckets) {
    profile.set(key, values.reduce((a, b) => a + b, 0) / values.length);
  }
  const seriesMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  return { profile, seriesMean };
}

function profileKey(dt: DateTime): string {
  const isWeekend = dt.weekday > 5 ? 1 : 0;
  const quarter = Math.floor(dt.minute / 15);
  return `${isWeekend}|${dt.hour}|${quarter}`;
}

/** Synthetic diurnal shape: low overnight, midday plateau, evening taper. */
export function syntheticDiurnalKw(hour: number, minute: number, peakKw = 300, baseKw = 120): number {
  const t = hour + minute / 60;
  // Smooth double-peak (morning + afternoon) curve.
  const morning = Math.exp(-(((t - 9) / 2.6) ** 2));
  const afternoon = Math.exp(-(((t - 15.5) / 3.1) ** 2));
  const shape = Math.max(morning, afternoon * 0.95);
  return round(baseKw + (peakKw - baseKw) * shape, 3);
}

/** Fill the holes in a grid of slots. Returns a dense, non-null grid. */
export function imputeGaps(slots: GridSlot[], options: ImputeOptions = {}): ImputeResult {
  const {
    maxInterpolationGapMinutes = 120,
    timezone = 'UTC',
    syntheticFallbackKw = 200,
  } = options;

  const intervalMinutes = inferInterval(slots);
  const maxGapSlots = Math.max(1, Math.round(maxInterpolationGapMinutes / intervalMinutes));
  const { profile, seriesMean } = buildDiurnalProfile(slots, timezone);

  const out: GridPoint[] = [];
  let interpolatedCount = 0;
  let imputedCount = 0;
  let syntheticCount = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as GridSlot;
    if (slot.powerKw !== null && Number.isFinite(slot.powerKw)) {
      out.push({ ...slot, powerKw: slot.powerKw, quality: slot.quality as QualityKind, flags: slot.flags });
      continue;
    }

    // Find surrounding known points.
    let prev = i - 1;
    while (prev >= 0 && (slots[prev] as GridSlot).powerKw === null) prev--;
    let next = i + 1;
    while (next < slots.length && (slots[next] as GridSlot).powerKw === null) next++;

    const prevVal = prev >= 0 ? (slots[prev] as GridSlot).powerKw : null;
    const nextVal = next < slots.length ? (slots[next] as GridSlot).powerKw : null;
    const gapSpan = next - prev - 1;

    // 1. Linear interpolation
    if (prevVal !== null && nextVal !== null && gapSpan <= maxGapSlots) {
      const t = (i - prev) / (next - prev);
      const value = prevVal + (nextVal - prevVal) * t;
      out.push({ timestampUtc: slot.timestampUtc, powerKw: round(value, 3), quality: 'interpolated', flags: ['gap_interpolated'] });
      interpolatedCount++;
      continue;
    }

    // 2. Diurnal profile
    const dt = DateTime.fromISO(slot.timestampUtc, { zone: 'utc' }).setZone(timezone);
    const profileValue = profile.get(profileKey(dt));
    if (profileValue !== undefined) {
      out.push({ timestampUtc: slot.timestampUtc, powerKw: round(profileValue, 3), quality: 'imputed', flags: ['gap_profile'] });
      imputedCount++;
      continue;
    }

    // 3. Series mean
    if (seriesMean !== null) {
      out.push({ timestampUtc: slot.timestampUtc, powerKw: round(seriesMean, 3), quality: 'imputed', flags: ['gap_mean'] });
      imputedCount++;
      continue;
    }

    // 4. Synthetic
    const value = syntheticDiurnalKw(dt.hour, dt.minute, syntheticFallbackKw * 1.5, syntheticFallbackKw * 0.6);
    out.push({ timestampUtc: slot.timestampUtc, powerKw: value, quality: 'synthetic', flags: ['gap_synthetic'] });
    syntheticCount++;
  }

  return {
    points: out,
    filledCount: interpolatedCount + imputedCount + syntheticCount,
    interpolatedCount,
    imputedCount,
    syntheticCount,
  };
}

function inferInterval(slots: GridSlot[]): number {
  if (slots.length < 2) return 15;
  const a = Date.parse((slots[0] as GridSlot).timestampUtc);
  const b = Date.parse((slots[1] as GridSlot).timestampUtc);
  const minutes = Math.round((b - a) / 60000);
  return minutes > 0 ? minutes : 15;
}
