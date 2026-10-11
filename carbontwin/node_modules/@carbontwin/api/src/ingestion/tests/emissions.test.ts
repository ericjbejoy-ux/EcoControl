/**
 * Tests for the dynamic Scope 2 emissions engine (FR-7, FR-9).
 * Verifies the SRS formula, the dynamic-vs-static comparison and projections.
 */

import { describe, it, expect } from 'vitest';
import type { CarbonIntensityPoint } from '@carbontwin/shared';
import {
  calculateEmissionsKg,
  kgToTonnes,
  computeEmissions,
  compareDynamicVsStatic,
  sumEmissions,
  projectEndOfDay,
} from '../pipeline/emissions.service.js';
import type { GridPoint } from '../types.js';

function ci(timestamp: string, carbonIntensity: number): CarbonIntensityPoint {
  return { timestamp, carbonIntensity, isForecast: false, dataSource: 'synthetic', region: 'IN-MH' };
}

function point(timestampUtc: string, powerKw: number): GridPoint {
  return { timestampUtc, powerKw, quality: 'measured', flags: [] };
}

describe('emissions formula', () => {
  it('applies Emissions_kg = Power_kW · 0.25 h · CI / 1000 (SRS §5.2)', () => {
    expect(calculateEmissionsKg(100, 500)).toBe(12.5);
    expect(calculateEmissionsKg(0, 900)).toBe(0);
    expect(calculateEmissionsKg(400, 200, 1)).toBe(80);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(calculateEmissionsKg(Number.NaN, 500)).toBe(0);
    expect(calculateEmissionsKg(100, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('converts kilograms to tonnes', () => {
    expect(kgToTonnes(1500)).toBe(1.5);
    expect(kgToTonnes(0)).toBe(0);
  });
});

describe('computeEmissions', () => {
  it('joins power with CI by timestamp', () => {
    const power = [point('2024-01-01T00:00:00.000Z', 100), point('2024-01-01T00:15:00.000Z', 100)];
    const carbon = [ci('2024-01-01T00:00:00.000Z', 400), ci('2024-01-01T00:15:00.000Z', 600)];
    const out = computeEmissions(power, carbon);
    expect(out.map((o) => o.emissionsKg)).toEqual([10, 15]);
    expect(out.map((o) => o.carbonIntensity)).toEqual([400, 600]);
  });

  it('falls back to the mean CI when a timestamp has no match', () => {
    const power = [point('2024-01-01T00:00:00.000Z', 100), point('2024-01-01T00:15:00.000Z', 100)];
    const carbon = [ci('2024-01-01T00:00:00.000Z', 400)];
    const out = computeEmissions(power, carbon);
    expect(out[1]?.carbonIntensity).toBe(400);
    expect(out[1]?.emissionsKg).toBe(10);
  });
});

describe('dynamic vs static (FR-9)', () => {
  it('reports zero error when the dynamic CI equals the annual average', () => {
    const emissions = [
      { timestampUtc: '2024-01-01T00:00:00.000Z', powerKw: 100, carbonIntensity: 500, emissionsKg: 12.5 },
    ];
    const result = compareDynamicVsStatic(emissions, { annualAverageCi: 500 });
    expect(result.totals.totalEnergyKwh).toBe(25);
    expect(result.totals.dynamicEmissionsKg).toBe(12.5);
    expect(result.totals.staticEmissionsKg).toBe(12.5);
    expect(result.totals.differenceKg).toBe(0);
    expect(result.totals.differencePct).toBe(0);
    expect(result.totals.annualAverageCiUsed).toBe(500);
    expect(result.comparison).toHaveLength(1);
  });

  it('quantifies the error made by a single annual average', () => {
    const emissions = [
      { timestampUtc: '2024-01-01T00:00:00.000Z', powerKw: 100, carbonIntensity: 800, emissionsKg: 20 },
      { timestampUtc: '2024-01-01T00:15:00.000Z', powerKw: 100, carbonIntensity: 200, emissionsKg: 5 },
    ];
    const result = compareDynamicVsStatic(emissions, { annualAverageCi: 400 });
    expect(result.totals.dynamicEmissionsKg).toBe(25);
    expect(result.totals.staticEmissionsKg).toBe(20);
    expect(result.totals.differenceKg).toBe(5);
    expect(result.totals.differencePct).toBe(25);
  });

  it('derives the static factor from the region when none is supplied', () => {
    const result = compareDynamicVsStatic([], { region: 'IN-MH' });
    expect(result.totals.annualAverageCiUsed).toBe(700);
  });
});

describe('aggregations', () => {
  it('sums emissions across a series', () => {
    const points = [
      { timestampUtc: 'a', powerKw: 1, carbonIntensity: 1, emissionsKg: 1.5 },
      { timestampUtc: 'b', powerKw: 1, carbonIntensity: 1, emissionsKg: 2.5 },
    ];
    expect(sumEmissions(points)).toBe(4);
  });

  it('projects a partial day to 24 h', () => {
    expect(projectEndOfDay(10, 12)).toBe(20);
    expect(projectEndOfDay(10, 0)).toBe(0);
  });
});
