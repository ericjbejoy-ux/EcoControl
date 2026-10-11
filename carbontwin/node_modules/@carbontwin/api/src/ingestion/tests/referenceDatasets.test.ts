/**
 * Reference-dataset integration tests.
 *
 * Verifies that the real / government datasets supplied in `data/raw` are
 * correctly wired into the M2 ingestion layer:
 *   * the derived `IN-TN` grid intensity + climate + demand packs,
 *   * the compiled-in region/facility constants, and
 *   * the real-weather "Chennai IT Park" demo facility, ingested end to end.
 *
 * The packs themselves are produced by `data/scripts/build_reference_datasets.py`
 * and committed under `data/cache` + `data/demo`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ANNUAL_AVERAGE_CI,
  DEMO_FACILITY_FILES,
  DEMO_FACILITY_IDS,
  REGION_CENTROIDS,
} from '@carbontwin/shared';
import { runIngestPipeline } from '../pipeline/ingestPipeline.js';
import {
  coordsForRegion,
  loadFallbackPack,
  syntheticCarbonIntensitySeries,
} from '../connectors/fallbackProvider.js';
import { memoryStore, silentLogger, testConfig } from './helpers.js';

const config = testConfig();

async function readJson<T>(name: string): Promise<T> {
  const raw = await fs.readFile(path.join(config.cacheDir, name), 'utf-8');
  return JSON.parse(raw) as T;
}

interface GridPack {
  regions: Record<string, { annualAverageCi: number; diurnal: number[] }>;
}
interface WeatherPack {
  regions: Record<string, { timezone: string; baseC: number; seasonalAmpC: number; diurnalAmpC: number }>;
}
interface DemandPack {
  regions: Record<
    string,
    { monthlyFactors: Record<string, number>; weekdayFactors: Record<string, number>; meanDailyEnergyMU: number }
  >;
}

describe('reference datasets (real / government data)', () => {
  it('derives a plausible IN-TN grid intensity from the Ember mix', async () => {
    const grid = await readJson<GridPack>('grid_ci_fallback.json');
    const tn = grid.regions['IN-TN'];
    expect(tn).toBeTruthy();
    // India's grid sits in the ~500-800 gCO2/kWh band; the 2024 mix derives ≈635.
    expect(tn!.annualAverageCi).toBeGreaterThan(500);
    expect(tn!.annualAverageCi).toBeLessThan(800);
    expect(tn!.diurnal).toHaveLength(24);
    const meanShape = tn!.diurnal.reduce((a, b) => a + b, 0) / tn!.diurnal.length;
    expect(meanShape).toBeCloseTo(1, 1);
    // The compiled-in fallback agrees with the committed pack.
    expect(ANNUAL_AVERAGE_CI['IN-TN']).toBeGreaterThan(500);
  });

  it('stores measured Tamil Nadu climate parameters', async () => {
    const weather = await readJson<WeatherPack>('weather_fallback.json');
    const tn = weather.regions['IN-TN'];
    expect(tn).toBeTruthy();
    expect(tn!.timezone).toBe('Asia/Kolkata');
    // Chennai is hot and humid; the measured annual mean is ≈28 °C.
    expect(tn!.baseC).toBeGreaterThan(20);
    expect(tn!.baseC).toBeLessThan(35);
    expect(tn!.diurnalAmpC).toBeGreaterThan(0);
    expect(tn!.seasonalAmpC).toBeGreaterThan(0);
  });

  it('records the CEA-derived Tamil Nadu demand profile', async () => {
    const demand = await readJson<DemandPack>('demand_profiles.json');
    const tn = demand.regions['IN-TN'];
    expect(tn).toBeTruthy();
    expect(Object.keys(tn!.monthlyFactors)).toHaveLength(12);
    expect(Object.keys(tn!.weekdayFactors)).toHaveLength(7);
    // Tamil Nadu consumes ~250-450 MU/day, averaging ≈290 MU/day.
    expect(tn!.meanDailyEnergyMU).toBeGreaterThan(100);
  });

  it('exposes the Chennai demo facility identity', () => {
    expect(DEMO_FACILITY_FILES.chennaiPark).toBe('chennai_it_park.csv');
    expect(DEMO_FACILITY_IDS.chennaiPark).toMatch(/^55555555-/);
    expect(REGION_CENTROIDS['IN-TN']?.city).toBe('Chennai');
    expect(coordsForRegion('IN-TN')).toEqual({ lat: 13.0827, lon: 80.2707 });
  });

  it('uses the derived intensity in the synthetic CI series', async () => {
    await loadFallbackPack(config.cacheDir);
    const series = syntheticCarbonIntensitySeries(
      'IN-TN',
      new Date('2024-04-01T00:00:00Z'),
      new Date('2024-04-02T00:00:00Z'),
      60
    );
    expect(series.length).toBeGreaterThan(20);
    const avg = series.reduce((acc, p) => acc + p.carbonIntensity, 0) / series.length;
    expect(avg).toBeGreaterThan(500);
    expect(avg).toBeLessThan(750);
  });

  it('ingests the real-weather Chennai demo CSV end to end', async () => {
    const content = await fs.readFile(path.join(config.demoDir, DEMO_FACILITY_FILES.chennaiPark));
    const store = await memoryStore();

    const result = await runIngestPipeline({
      fileName: DEMO_FACILITY_FILES.chennaiPark,
      mimeType: 'text/csv',
      content,
      facilityId: DEMO_FACILITY_IDS.chennaiPark,
      facility: {
        name: 'Chennai IT Park',
        type: 'office',
        region: 'IN-TN',
        timezone: 'Asia/Kolkata',
        lat: 13.0827,
        lon: 80.2707,
      },
      store,
      config,
      logger: silentLogger,
    });

    expect(result.facilityId).toBe(DEMO_FACILITY_IDS.chennaiPark);
    expect(result.mapping.unit).toBe('kW');
    expect(result.totals.kwh).toBeGreaterThan(0);

    const stored = await store.timeseries.query(result.facilityId, {});
    expect(stored.length).toBeGreaterThan(2_800);

    // Outdoor temperature is the real 2024 Tamil Nadu weather — warm but sane.
    const lines = content.toString('utf-8').trim().split(/\r?\n/);
    const header = (lines[0] as string).split(',');
    const tempIdx = header.findIndex((h) => h.includes('Outdoor Temperature'));
    expect(tempIdx).toBeGreaterThanOrEqual(0);
    const temps = lines
      .slice(1)
      .map((line) => Number(line.split(',')[tempIdx]))
      .filter((t) => Number.isFinite(t));
    expect(temps.length).toBeGreaterThan(2_800);
    expect(Math.min(...temps)).toBeGreaterThan(15);
    expect(Math.max(...temps)).toBeLessThan(45);
  }, 60_000);
});
