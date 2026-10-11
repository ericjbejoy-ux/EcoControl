/**
 * Tests for the validation layer: unit normalisation, timezone/timestamp
 * handling and interval validation (FR-1, FR-5).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToKw,
  guessUnitFromHeader,
  isEnergyUnit,
  convertPowerToKw,
  convertEnergyToKwh,
  describeNormalization,
} from '../validators/unitNormalizer.js';
import {
  resolveTimezone,
  timezoneFromLongitude,
  offsetHoursFromLongitude,
  parseTimestamp,
  parseTimestampColumn,
  formatInZone,
} from '../validators/timezone.js';
import { validateIntervals, findDuplicateTimestamps } from '../validators/intervalValidator.js';
import type { RawRow } from '../types.js';

describe('unit normalisation', () => {
  it('keeps kW unchanged and scales W/MW', () => {
    expect(normalizeToKw(100, { unit: 'kW' })).toBe(100);
    expect(normalizeToKw(1000, { unit: 'W' })).toBe(1);
    expect(normalizeToKw(1, { unit: 'MW' })).toBe(1000);
  });

  it('converts energy to average kW using the interval', () => {
    expect(normalizeToKw(25, { unit: 'kWh', isEnergy: true, intervalMinutes: 15 })).toBe(100);
    expect(normalizeToKw(1, { unit: 'MWh', isEnergy: true, intervalMinutes: 15 })).toBe(4000);
    expect(normalizeToKw(1000, { unit: 'Wh', isEnergy: true, intervalMinutes: 60 })).toBe(1);
  });

  it('rejects non-finite input', () => {
    expect(normalizeToKw(Number.NaN, { unit: 'kW' })).toBeNaN();
  });

  it('classifies energy vs power units', () => {
    expect(isEnergyUnit('kWh')).toBe(true);
    expect(isEnergyUnit('Wh')).toBe(true);
    expect(isEnergyUnit('kW')).toBe(false);
  });

  it('scales power and energy primitives', () => {
    expect(convertPowerToKw(2, 'MW')).toBe(2000);
    expect(convertEnergyToKwh(2, 'MWh')).toBe(2000);
  });

  it('guesses a unit from a header string', () => {
    expect(guessUnitFromHeader('Active Power (kW)')).toBe('kW');
    expect(guessUnitFromHeader('energy_kwh')).toBe('kWh');
    expect(guessUnitFromHeader('mwh_total')).toBe('MWh');
    expect(guessUnitFromHeader('temperature_c')).toBeNull();
  });

  it('describes the transformation for the UI', () => {
    expect(describeNormalization({ unit: 'kWh', isEnergy: true, intervalMinutes: 15 })).toContain('kWh');
    expect(describeNormalization({ unit: 'kW' })).toContain('unchanged');
    expect(describeNormalization({ unit: 'W' })).toContain('W');
  });
});

describe('timezone resolution', () => {
  it('prefers an explicit zone', () => {
    expect(resolveTimezone({ explicit: 'Europe/Berlin' })).toBe('Europe/Berlin');
    expect(resolveTimezone({ explicit: 'garbage', region: 'IN-MH' })).toBe('Asia/Kolkata');
  });

  it('derives the zone from a region centroid', () => {
    expect(resolveTimezone({ region: 'IN-MH' })).toBe('Asia/Kolkata');
    expect(resolveTimezone({ region: 'US-CA' })).toBe('America/Los_Angeles');
  });

  it('falls back to longitude then UTC', () => {
    expect(resolveTimezone({ lon: 0 })).toBe('UTC');
    expect(resolveTimezone({ lon: 90 })).toBe('Etc/GMT-6');
    expect(resolveTimezone({})).toBe('UTC');
  });

  it('maps longitude to a whole-hour offset', () => {
    expect(offsetHoursFromLongitude(90)).toBe(6);
    expect(offsetHoursFromLongitude(-75)).toBe(-5);
    expect(offsetHoursFromLongitude(0)).toBe(0);
    expect(timezoneFromLongitude(0)).toBe('UTC');
  });
});

describe('timestamp parsing', () => {
  it('parses epoch seconds and milliseconds', () => {
    expect(parseTimestamp(1704067200, 'epoch_s', 'UTC')?.utcIso).toBe('2024-01-01T00:00:00.000Z');
    expect(parseTimestamp(1704067200000, 'epoch_ms', 'UTC')?.utcIso).toBe('2024-01-01T00:00:00.000Z');
    expect(parseTimestamp('1704067200', null, 'UTC')?.utcIso).toBe('2024-01-01T00:00:00.000Z');
  });

  it('trusts an explicit ISO offset', () => {
    const parsed = parseTimestamp('2024-01-01T05:30:00+05:30', null, 'UTC');
    expect(parsed?.utcIso).toBe('2024-01-01T00:00:00.000Z');
  });

  it('interpretes naive wall-clock time in the given zone (DST aware)', () => {
    expect(parseTimestamp('2024-06-01 12:00', 'yyyy-MM-dd HH:mm', 'Europe/London')?.utcIso).toBe(
      '2024-06-01T11:00:00.000Z'
    );
    expect(parseTimestamp('2024-01-01 12:00', 'yyyy-MM-dd HH:mm', 'Europe/London')?.utcIso).toBe(
      '2024-01-01T12:00:00.000Z'
    );
  });

  it('returns null for missing or invalid values', () => {
    expect(parseTimestamp(null, null, 'UTC')).toBeNull();
    expect(parseTimestamp('', null, 'UTC')).toBeNull();
    expect(parseTimestamp('not-a-date', null, 'UTC')).toBeNull();
  });

  it('parses a whole column and reports the success rate', () => {
    const rows: RawRow[] = [{ t: '2024-01-01T00:00:00Z' }, { t: 'nope' }, { t: '2024-01-01T00:15:00Z' }];
    const result = parseTimestampColumn(rows, 't', 'iso', 'UTC');
    expect(result.successRate).toBeCloseTo(2 / 3, 5);
    expect(result.parsed).toHaveLength(3);
    expect(result.parsed[1]?.utcIso).toBeNull();
  });

  it('formats a UTC instant for display in a zone', () => {
    expect(formatInZone('2024-06-01T11:00:00.000Z', 'Europe/London')).toBe('2024-06-01 12:00');
  });
});

describe('interval validation', () => {
  const start = Date.parse('2024-01-01T00:00:00.000Z');
  const at = (minutes: number) => start + minutes * 60_000;

  it('scores a perfectly regular series as 1', () => {
    const timestamps = Array.from({ length: 10 }, (_, i) => at(i * 15));
    const result = validateIntervals(timestamps, 15);
    expect(result.missingIntervals).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.dominantIntervalMinutes).toBe(15);
    expect(result.regularityScore).toBe(1);
    expect(result.span.start).toBe('2024-01-01T00:00:00.000Z');
  });

  it('counts missing intervals across a gap', () => {
    const result = validateIntervals([at(0), at(15), at(75)], 15);
    expect(result.missingIntervals).toBe(3);
    expect(result.gapCount).toBe(1);
    expect(result.gaps[0]?.missingIntervals).toBe(3);
  });

  it('detects duplicate timestamps', () => {
    const result = validateIntervals([at(0), at(0), at(15)], 15);
    expect(result.duplicateCount).toBe(1);
    expect(result.duplicates).toEqual(['2024-01-01T00:00:00.000Z']);
  });

  it('penalises irregular spacing', () => {
    const regular = validateIntervals(Array.from({ length: 8 }, (_, i) => at(i * 15)), 15);
    // Second point is ~14.2 min after the first (off-cadence but not a full gap).
    const irregular = validateIntervals([at(0), at(0) + 850_000, at(0) + 1_750_000], 15);
    expect(irregular.irregularCount).toBeGreaterThan(0);
    expect(irregular.regularityScore).toBeLessThan(regular.regularityScore);
  });

  it('returns zero score for an empty series', () => {
    const result = validateIntervals([], 15);
    expect(result.count).toBe(0);
    expect(result.regularityScore).toBe(0);
  });

  it('finds duplicate ISO strings', () => {
    expect(findDuplicateTimestamps(['a', 'a', 'b', 'b']).sort()).toEqual(['a', 'b']);
  });
});
