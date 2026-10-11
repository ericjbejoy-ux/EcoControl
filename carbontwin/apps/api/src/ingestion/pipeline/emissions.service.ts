/**
 * Dynamic Scope 2 emissions (FR-7, FR-9).
 *   Emissions_kg(t) = Power_kW(t) · 0.25 h · CI_(g/kWh)(t) / 1000
 * Also computes the dynamic-vs-annual-average comparison that demonstrates the
 * error of static accounting.
 */

import { ANNUAL_AVERAGE_CI, INTERVAL_HOURS, KG_PER_TONNE, type EmissionsComparisonPoint } from '@carbontwin/shared';
import type { CarbonIntensityPoint } from '@carbontwin/shared';
import { round } from '../utils/stats.js';
import type { GridPoint } from '../types.js';

export interface EmissionsPoint {
  timestampUtc: string;
  powerKw: number;
  carbonIntensity: number; // gCO2/kWh
  emissionsKg: number;
}

/** Core formula (SRS §5.2). */
export function calculateEmissionsKg(
  powerKw: number,
  carbonIntensityGPerKwh: number,
  intervalHours = INTERVAL_HOURS
): number {
  if (!Number.isFinite(powerKw) || !Number.isFinite(carbonIntensityGPerKwh)) return 0;
  return (powerKw * intervalHours * carbonIntensityGPerKwh) / 1000;
}

export function kgToTonnes(kg: number): number {
  return kg / KG_PER_TONNE;
}

/**
 * Join a power series with a carbon-intensity series (matched by timestamp) and
 * compute per-interval emissions. Missing CI is filled with the series average.
 */
export function computeEmissions(
  power: GridPoint[],
  carbon: CarbonIntensityPoint[]
): EmissionsPoint[] {
  const ciByTs = new Map<number, number>();
  for (const point of carbon) {
    const ms = Date.parse(point.timestamp);
    if (Number.isFinite(ms)) ciByTs.set(ms, point.carbonIntensity);
  }
  const ciValues = carbon.map((c) => c.carbonIntensity);
  const fallbackCi = ciValues.length ? ciValues.reduce((a, b) => a + b, 0) / ciValues.length : 0;

  return power.map((p) => {
    const ms = Date.parse(p.timestampUtc);
    const ci = ciByTs.get(ms) ?? fallbackCi;
    return {
      timestampUtc: p.timestampUtc,
      powerKw: p.powerKw,
      carbonIntensity: round(ci, 2),
      emissionsKg: round(calculateEmissionsKg(p.powerKw, ci), 4),
    };
  });
}

export interface EmissionsTotals {
  totalEnergyKwh: number;
  dynamicEmissionsKg: number;
  staticEmissionsKg: number;
  differenceKg: number;
  differencePct: number;
  annualAverageCiUsed: number;
}

export interface DynamicVsStaticResult {
  comparison: EmissionsComparisonPoint[];
  totals: EmissionsTotals;
}

/** FR-9: compare dynamic (hourly) Scope 2 against a single annual-average factor. */
export function compareDynamicVsStatic(
  emissions: EmissionsPoint[],
  options: { region?: string; annualAverageCi?: number; intervalHours?: number } = {}
): DynamicVsStaticResult {
  const intervalHours = options.intervalHours ?? INTERVAL_HOURS;
  const staticCi =
    options.annualAverageCi ?? (options.region ? ANNUAL_AVERAGE_CI[options.region] : undefined) ?? 400;

  let totalEnergyKwh = 0;
  let dynamicTotal = 0;
  let staticTotal = 0;

  const comparison: EmissionsComparisonPoint[] = emissions.map((e) => {
    const energyKwh = e.powerKw * intervalHours;
    const dynamicKg = e.emissionsKg;
    const staticKg = calculateEmissionsKg(e.powerKw, staticCi, intervalHours);
    totalEnergyKwh += energyKwh;
    dynamicTotal += dynamicKg;
    staticTotal += staticKg;
    const diffKg = dynamicKg - staticKg;
    return {
      timestamp: e.timestampUtc,
      powerKw: round(e.powerKw, 4),
      dynamicCi: round(e.carbonIntensity, 2),
      dynamicEmissionsKg: round(dynamicKg, 4),
      staticCi,
      staticEmissionsKg: round(staticKg, 4),
      differenceKg: round(diffKg, 4),
      differencePct: staticKg === 0 ? 0 : round((diffKg / staticKg) * 100, 2),
    };
  });

  const differenceKg = dynamicTotal - staticTotal;
  return {
    comparison,
    totals: {
      totalEnergyKwh: round(totalEnergyKwh, 3),
      dynamicEmissionsKg: round(dynamicTotal, 3),
      staticEmissionsKg: round(staticTotal, 3),
      differenceKg: round(differenceKg, 3),
      differencePct: staticTotal === 0 ? 0 : round((differenceKg / staticTotal) * 100, 2),
      annualAverageCiUsed: staticCi,
    },
  };
}

/** Sum emissions over a series (kg). */
export function sumEmissions(points: EmissionsPoint[]): number {
  return round(points.reduce((acc, p) => acc + p.emissionsKg, 0), 3);
}

/** Project emissions to a full day given a partial-day sample (Carbon Clock). */
export function projectEndOfDay(emissionsKgSoFar: number, elapsedHours: number): number {
  if (elapsedHours <= 0) return 0;
  return round((emissionsKgSoFar / elapsedHours) * 24, 2);
}
