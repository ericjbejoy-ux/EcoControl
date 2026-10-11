/**
 * Tests for the cleaning stage: resampling onto the 15-minute grid, outlier
 * detection and gap imputation (FR-5).
 */

import { describe, it, expect } from 'vitest';
import { resample, buildGrid } from '../cleaning/resampler.js';
import { imputeGaps, buildDiurnalProfile, syntheticDiurnalKw } from '../cleaning/imputer.js';
import { detectOutliers, detectPhysicalViolations } from '../cleaning/outlierDetector.js';
import type { GridSlot, NormalizedReading } from '../types.js';
import { isoSeries } from './helpers.js';

function readings(values: Array<number | null>, startIso = '2024-01-01T00:00:00Z', step = 15): NormalizedReading[] {
  return isoSeries(startIso, values.length, step).flatMap((timestampUtc, i) => {
    const value = values[i];
    if (value === null || value === undefined) return [];
    return [{ timestampUtc, powerKw: value, flags: [] }];
  });
}

function slots(pairs: Array<[string, number | null]>): GridSlot[] {
  return pairs.map(([timestampUtc, powerKw]) => ({
    timestampUtc,
    powerKw,
    quality: powerKw === null ? 'missing' : 'measured',
    flags: [],
  }));
}

describe('resampler', () => {
  it('places readings on a regular grid and marks missing slots', () => {
    const result = resample(readings([100, 200, null, 400]));
    expect(result.slots).toHaveLength(4);
    expect(result.presentCount).toBe(3);
    expect(result.slots[0]?.powerKw).toBe(100);
    expect(result.slots[2]?.powerKw).toBeNull();
    expect(result.slots[2]?.quality).toBe('missing');
    expect(result.intervalMinutes).toBe(15);
  });

  it('aggregates multiple readings in the same slot by mean', () => {
    const same = [
      { timestampUtc: '2024-01-01T00:00:05Z', powerKw: 100, flags: [] },
      { timestampUtc: '2024-01-01T00:07:00Z', powerKw: 200, flags: [] },
    ];
    const result = resample(same);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.powerKw).toBe(150);
    expect(result.slots[0]?.flags).toContain('aggregated');
    expect(result.aggregatedCount).toBe(1);
  });

  it('supports alternative aggregations', () => {
    const same: NormalizedReading[] = [
      { timestampUtc: '2024-01-01T00:00:05Z', powerKw: 100, flags: [] },
      { timestampUtc: '2024-01-01T00:07:00Z', powerKw: 200, flags: [] },
    ];
    expect(resample(same, { aggregate: 'max' }).slots[0]?.powerKw).toBe(200);
    expect(resample(same, { aggregate: 'min' }).slots[0]?.powerKw).toBe(100);
    expect(resample(same, { aggregate: 'sum' }).slots[0]?.powerKw).toBe(300);
  });

  it('returns an empty result for no readings', () => {
    const result = resample([]);
    expect(result.slots).toHaveLength(0);
    expect(result.presentCount).toBe(0);
  });

  it('builds a grid of ISO timestamps', () => {
    expect(buildGrid('2024-01-01T00:00:00Z', '2024-01-01T00:45:00Z', 15)).toHaveLength(4);
  });
});

describe('outlier detection', () => {
  it('flags an extreme spike via robust z-score', () => {
    const series: Array<number | null> = [100, 102, 101, 103, 100, 102, 900, 101, 102, 100];
    const result = detectOutliers(series);
    expect(result.outlierCount).toBeGreaterThanOrEqual(1);
    expect(result.indices).toContain(6);
    expect(result.hits.find((h) => h.index === 6)?.reasons.length).toBeGreaterThan(0);
  });

  it('blanks outliers when replaceWithNull is set', () => {
    const series: Array<number | null> = [100, 102, 101, 103, 100, 102, 900, 101, 102, 100];
    const result = detectOutliers(series, { replaceWithNull: true });
    expect(result.values[6]).toBeNull();
  });

  it('returns nothing for short or flat series', () => {
    expect(detectOutliers([1, 2, 3]).outlierCount).toBe(0);
    expect(detectOutliers([5, 5, 5, 5, 5, 5]).outlierCount).toBe(0);
  });

  it('flags physical-plant violations independently of statistics', () => {
    expect(detectPhysicalViolations([100, 50_000, 120], 10_000)).toEqual([1]);
  });
});

describe('gap imputation', () => {
  const grid = (pairs: Array<[string, number | null]>) => slots(pairs);

  it('linearly interpolates short gaps', () => {
    const result = imputeGaps(
      grid([
        ['2024-01-01T00:00:00.000Z', 100],
        ['2024-01-01T00:15:00.000Z', null],
        ['2024-01-01T00:30:00.000Z', 200],
      ])
    );
    expect(result.points).toHaveLength(3);
    expect(result.interpolatedCount).toBe(1);
    expect(result.points[1]?.powerKw).toBe(150);
    expect(result.points[1]?.quality).toBe('interpolated');
    expect(result.points[1]?.flags).toContain('gap_interpolated');
  });

  it('falls back to the series mean when a gap cannot be interpolated', () => {
    const result = imputeGaps(
      grid([
        ['2024-01-01T00:00:00.000Z', 100],
        ['2024-01-01T00:15:00.000Z', 200],
        ['2024-01-01T00:30:00.000Z', null],
        ['2024-01-01T00:45:00.000Z', null],
      ])
    );
    expect(result.points.every((p) => p.powerKw !== null)).toBe(true);
    expect(result.filledCount).toBe(2);
    expect(result.interpolatedCount).toBe(0);
    expect(result.imputedCount).toBe(2);
  });

  it('never leaves a hole in the grid', () => {
    const pairs: Array<[string, number | null]> = isoSeries('2024-01-01T00:00:00Z', 8).map((t, i) => [
      t,
      i === 4 ? null : 100 + i,
    ]);
    const result = imputeGaps(grid(pairs));
    expect(result.points).toHaveLength(8);
    expect(result.points.every((p) => Number.isFinite(p.powerKw))).toBe(true);
  });

  it('builds a diurnal profile and a series mean', () => {
    const { profile, seriesMean } = buildDiurnalProfile(
      grid([
        ['2024-01-01T00:00:00.000Z', 100],
        ['2024-01-01T00:15:00.000Z', 300],
      ]),
      'UTC'
    );
    expect(seriesMean).toBe(200);
    expect(profile.size).toBeGreaterThan(0);
  });

  it('shapes a synthetic diurnal curve with a daytime peak', () => {
    expect(syntheticDiurnalKw(9, 0, 300, 120)).toBeGreaterThan(syntheticDiurnalKw(3, 0, 300, 120));
  });
});
