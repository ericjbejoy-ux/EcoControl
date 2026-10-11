/**
 * Unit tests for the low-level numeric + time + series utilities (utils/*).
 */

import { describe, it, expect } from 'vitest';
import {
  mean,
  median,
  stdDev,
  mad,
  quantile,
  clamp,
  round,
  lerp,
  pearson,
  robustZScore,
  min,
  max,
  sum,
  isFiniteNumber,
} from '../utils/stats.js';
import { mulberry32, hashSeed, createRng } from '../utils/rng.js';
import {
  floorToInterval,
  roundToInterval,
  gridTimestamps,
  addMinutes,
  diffMinutes,
  toUtcIso,
  zonedToUtcIso,
  utcIsoToZoned,
  isValidZone,
  midpoint,
  isWeekend,
  hourOfDay,
  dayBounds,
  eachInterval,
} from '../utils/time.js';
import { interpolateNumericSeries, nearestValue } from '../utils/series.js';

describe('utils/stats', () => {
  it('computes mean, median, min, max and sum', () => {
    const values = [1, 2, 3, 4, 10];
    expect(mean(values)).toBe(4);
    expect(median(values)).toBe(3);
    expect(min(values)).toBe(1);
    expect(max(values)).toBe(10);
    expect(sum(values)).toBe(20);
  });

  it('handles empty arrays without throwing', () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(stdDev([])).toBe(0);
    expect(mad([])).toBe(0);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('computes a sample standard deviation', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9], true)).toBeCloseTo(2.138, 3);
    // Population (n) variant is slightly smaller.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9], false)).toBeCloseTo(2, 3);
  });

  it('computes median absolute deviation', () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it('interpolates quantiles', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('clamps, rounds, lerps and checks finiteness', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(round(1.23456, 3)).toBe(1.235);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(isFiniteNumber(3)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber('3')).toBe(false);
  });

  it('produces a robust z-score that ignores an extreme outlier', () => {
    const series = [10, 11, 10, 12, 11, 10, 1000];
    expect(robustZScore(1000, series)).toBeGreaterThan(3.5);
    expect(Math.abs(robustZScore(11, series))).toBeLessThan(1);
  });

  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 6);
    expect(pearson([1], [1])).toBe(0);
  });
});

describe('utils/rng — determinism', () => {
  it('mulberry32 is reproducible for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('hashSeed is stable and collision-resistant for typical inputs', () => {
    expect(hashSeed('IN-MH:2026-01-01')).toBe(hashSeed('IN-MH:2026-01-01'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed('abc') >>> 0).toBe(hashSeed('abc'));
  });

  it('createRng accepts string seeds and is reproducible', () => {
    const r1 = createRng('office-tower');
    const r2 = createRng('office-tower');
    expect([r1.next(), r1.next()]).toEqual([r2.next(), r2.next()]);
  });

  it('range/int/bool stay within bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const r = rng.range(5, 10);
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThan(10);
      const n = rng.int(1, 3);
      expect([1, 2, 3]).toContain(n);
      expect(typeof rng.bool()).toBe('boolean');
    }
  });

  it('normal samples have approximately the requested mean', () => {
    const rng = createRng(123);
    const samples = Array.from({ length: 20_000 }, () => rng.normal(100, 5));
    expect(mean(samples)).toBeGreaterThan(99);
    expect(mean(samples)).toBeLessThan(101);
  });
});

describe('utils/time', () => {
  it('floors and rounds to interval boundaries', () => {
    expect(floorToInterval(new Date('2024-01-01T00:07:00Z'), 15).toISOString()).toBe(
      '2024-01-01T00:00:00.000Z'
    );
    expect(roundToInterval(new Date('2024-01-01T00:08:00Z'), 15).toISOString()).toBe(
      '2024-01-01T00:15:00.000Z'
    );
  });

  it('enumerates an inclusive grid', () => {
    const grid = gridTimestamps(new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T01:00:00Z'), 15);
    expect(grid).toHaveLength(5);
    expect(grid[0]?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(grid[4]?.toISOString()).toBe('2024-01-01T01:00:00.000Z');
    expect(eachInterval(new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:30:00Z'), 15)).toHaveLength(3);
  });

  it('adds/diffs minutes and finds midpoints', () => {
    expect(addMinutes(new Date('2024-01-01T00:00:00Z'), 30).toISOString()).toBe(
      '2024-01-01T00:30:00.000Z'
    );
    expect(diffMinutes(new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T01:00:00Z'))).toBe(60);
    expect(midpoint(new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T01:00:00Z')).toISOString()).toBe(
      '2024-01-01T00:30:00.000Z'
    );
  });

  it('converts zoned wall-clock time to UTC (DST-aware)', () => {
    // June in London is BST (UTC+1).
    expect(zonedToUtcIso('2024-06-01 12:00', 'Europe/London')).toBe('2024-06-01T11:00:00.000Z');
    // January in London is GMT (UTC+0).
    expect(zonedToUtcIso('2024-01-01 12:00', 'Europe/London')).toBe('2024-01-01T12:00:00.000Z');
    expect(zonedToUtcIso('not-a-date', 'Europe/London')).toBeNull();
  });

  it('round-trips UTC ↔ zoned display strings', () => {
    expect(utcIsoToZoned('2024-06-01T11:00:00.000Z', 'Europe/London')).toBe('2024-06-01 12:00');
    expect(toUtcIso(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01T00:00:00.000Z');
  });

  it('validates IANA zones', () => {
    expect(isValidZone('Asia/Kolkata')).toBe(true);
    expect(isValidZone('UTC')).toBe(true);
    expect(isValidZone('Not/AZone')).toBe(false);
  });

  it('classifies weekdays vs weekends in a zone', () => {
    // 2024-01-06 is a Saturday, 2024-01-08 a Monday.
    expect(isWeekend(new Date('2024-01-06T12:00:00Z'))).toBe(true);
    expect(isWeekend(new Date('2024-01-08T12:00:00Z'))).toBe(false);
    expect(hourOfDay(new Date('2024-06-01T11:00:00Z'), 'Europe/London')).toBe(12);
  });

  it('computes calendar-day bounds in a zone', () => {
    const { start, end } = dayBounds(new Date('2024-06-01T12:00:00Z'), 'Europe/London');
    // BST midnight local = 23:00 UTC the previous day.
    expect(start.toISOString()).toBe('2024-05-31T23:00:00.000Z');
    expect(end.toISOString()).toBe('2024-06-01T23:00:00.000Z');
  });
});

describe('utils/series', () => {
  it('linearly interpolates onto a dense grid', () => {
    const t0 = Date.parse('2024-01-01T00:00:00Z');
    const srcMs = [t0, t0 + 3_600_000];
    const srcVal = [0, 10];
    const target = [t0, t0 + 1_800_000, t0 + 3_600_000];
    expect(interpolateNumericSeries(srcMs, srcVal, target)).toEqual([0, 5, 10]);
  });

  it('clamps to the nearest endpoint outside the source range', () => {
    const t0 = Date.parse('2024-01-01T00:00:00Z');
    const out = interpolateNumericSeries([t0, t0 + 3_600_000], [1, 2], [t0 - 3_600_000, t0 + 7_200_000]);
    expect(out).toEqual([1, 2]);
  });

  it('returns a constant series for a single source point', () => {
    const t0 = Date.parse('2024-01-01T00:00:00Z');
    expect(interpolateNumericSeries([t0], [7], [t0, t0 + 60_000])).toEqual([7, 7]);
  });

  it('finds the nearest value by timestamp', () => {
    const points = [
      { timestamp: '2024-01-01T00:00:00Z', value: 'a' },
      { timestamp: '2024-01-01T01:00:00Z', value: 'b' },
    ];
    expect(nearestValue(points, Date.parse('2024-01-01T00:20:00Z'))).toBe('a');
    expect(nearestValue(points, Date.parse('2024-01-01T00:40:00Z'))).toBe('b');
    expect(nearestValue([], 0)).toBeNull();
  });
});
