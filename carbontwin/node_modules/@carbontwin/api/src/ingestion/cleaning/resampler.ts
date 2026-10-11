/**
 * Resampler (FR-1/FR-5, cleaning/resampler.ts).
 * Places normalised readings onto a regular 15-minute grid. Multiple readings
 * that fall inside the same slot are aggregated. Slots with no data are emitted
 * with `powerKw = null` / `quality: 'missing'` so the imputer can fill them.
 */

import { round } from '../utils/stats.js';
import { floorToInterval } from '../utils/time.js';
import type { GridSlot, NormalizedReading } from '../types.js';

export interface ResampleOptions {
  intervalMinutes?: number;
  /** Aggregation used when >1 reading lands in a slot. */
  aggregate?: 'mean' | 'sum' | 'max' | 'min';
}

export interface ResampleResult {
  startIso: string;
  endIso: string;
  intervalMinutes: number;
  /** One entry per grid slot in the range (missing slots have null power). */
  slots: GridSlot[];
  /** Number of slots that received ≥ 1 reading. */
  presentCount: number;
  /** Number of slots that received > 1 reading and were aggregated. */
  aggregatedCount: number;
  /** Readings discarded because they fell outside the resolved range. */
  nonGridCount: number;
}

/**
 * Resample readings onto a regular grid.
 * Slots with no data are emitted with `powerKw = null` and `quality: 'missing'`
 * so that the imputer can fill them deterministically.
 */
export function resample(readings: NormalizedReading[], options: ResampleOptions = {}): ResampleResult {
  const intervalMinutes = options.intervalMinutes ?? 15;
  const aggregate = options.aggregate ?? 'mean';

  if (readings.length === 0) {
    return {
      startIso: new Date(0).toISOString(),
      endIso: new Date(0).toISOString(),
      intervalMinutes,
      slots: [],
      presentCount: 0,
      aggregatedCount: 0,
      nonGridCount: 0,
    };
  }

  const parsed = readings
    .map((r) => ({ ...r, ms: Date.parse(r.timestampUtc) }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms);

  const firstSlot = floorToInterval(new Date(parsed[0]!.ms), intervalMinutes).getTime();
  const lastSlot = floorToInterval(new Date(parsed[parsed.length - 1]!.ms), intervalMinutes).getTime();
  const step = intervalMinutes * 60_000;

  const bySlot = new Map<number, NormalizedReading[]>();
  for (const reading of parsed) {
    const slot = floorToInterval(new Date(reading.ms), intervalMinutes).getTime();
    const bucket = bySlot.get(slot);
    if (bucket) bucket.push(reading);
    else bySlot.set(slot, [reading]);
  }

  const slots: GridSlot[] = [];
  let aggregatedCount = 0;
  let presentCount = 0;

  for (let t = firstSlot; t <= lastSlot; t += step) {
    const bucket = bySlot.get(t);
    if (!bucket || bucket.length === 0) {
      slots.push({ timestampUtc: new Date(t).toISOString(), powerKw: null, quality: 'missing', flags: [] });
      continue;
    }
    if (bucket.length > 1) aggregatedCount++;

    const values = bucket.map((b) => b.powerKw).filter((v) => Number.isFinite(v));
    let value: number;
    switch (aggregate) {
      case 'sum':
        value = values.reduce((a, b) => a + b, 0);
        break;
      case 'max':
        value = Math.max(...values);
        break;
      case 'min':
        value = Math.min(...values);
        break;
      default:
        value = values.reduce((a, b) => a + b, 0) / values.length;
    }

    const flags = new Set<string>();
    for (const b of bucket) for (const f of b.flags) flags.add(f);
    if (bucket.length > 1) flags.add('aggregated');

    slots.push({
      timestampUtc: new Date(t).toISOString(),
      powerKw: round(value, 6),
      quality: 'measured',
      flags: [...flags],
    });
    presentCount++;
  }

  return {
    startIso: new Date(firstSlot).toISOString(),
    endIso: new Date(lastSlot).toISOString(),
    intervalMinutes,
    slots,
    presentCount,
    aggregatedCount,
    nonGridCount: parsed.length - [...bySlot.values()].reduce((a, b) => a + b.length, 0),
  };
}

/** Build the canonical grid of UTC ISO timestamps for a range. */
export function buildGrid(startIso: string, endIso: string, intervalMinutes = 15): string[] {
  const start = floorToInterval(new Date(startIso), intervalMinutes).getTime();
  const end = floorToInterval(new Date(endIso), intervalMinutes).getTime();
  const step = intervalMinutes * 60_000;
  const out: string[] = [];
  for (let t = start; t <= end; t += step) out.push(new Date(t).toISOString());
  return out;
}
