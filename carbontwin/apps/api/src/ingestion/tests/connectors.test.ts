/**
 * Tests for the external-data connectors and the synthetic fallback provider.
 * The "Live → Cached → Synthetic" ladder (FR-3/FR-4, NFR-2) must never fail and
 * must always report which tier produced the answer.
 */

import { describe, it, expect } from 'vitest';
import {
  clearSkyIrradiance,
  coordsForRegion,
  loadFallbackPack,
  regionDiurnalShape,
  syntheticCarbonIntensitySeries,
  syntheticLatestCarbonIntensity,
  syntheticWeatherSeries,
} from '../connectors/fallbackProvider.js';
import {
  CarbonIntensityService,
  MemoryCache,
  WeatherService,
  createConnectors,
} from '../connectors/index.js';
import { silentLogger, testConfig } from './helpers.js';

const FROM = new Date('2024-01-01T00:00:00Z');
const TO = new Date('2024-01-01T06:00:00Z');
const EXPECTED_POINTS = 25; // 00:00 → 06:00 inclusive on a 15-min grid

describe('synthetic carbon intensity (fallback tier)', () => {
  it('is deterministic and physically bounded', () => {
    const a = syntheticCarbonIntensitySeries('IN-MH', FROM, TO, 15);
    const b = syntheticCarbonIntensitySeries('IN-MH', FROM, TO, 15);
    expect(a).toEqual(b);
    expect(a).toHaveLength(EXPECTED_POINTS);
    for (const point of a) {
      expect(point.carbonIntensity).toBeGreaterThanOrEqual(30);
      expect(point.carbonIntensity).toBeLessThanOrEqual(1100);
      expect(point.dataSource).toBe('synthetic');
      expect(point.region).toBe('IN-MH');
    }
  });

  it('produces a single latest value for any region', () => {
    const point = syntheticLatestCarbonIntensity('US-CA', new Date('2024-06-01T12:00:00Z'));
    expect(point.region).toBe('US-CA');
    expect(point.carbonIntensity).toBeGreaterThan(0);
    expect(point.dataSource).toBe('synthetic');
  });

  it('normalises the regional diurnal shape to a mean of 1', () => {
    const shape = regionDiurnalShape('DE-BE');
    expect(shape).toHaveLength(24);
    const mean = shape.reduce((acc, v) => acc + v, 0) / shape.length;
    expect(mean).toBeCloseTo(1, 6);
  });
});

describe('synthetic weather (fallback tier)', () => {
  it('is deterministic and bounded', () => {
    const a = syntheticWeatherSeries(19.076, 72.8777, FROM, TO, 15, 'IN-MH');
    const b = syntheticWeatherSeries(19.076, 72.8777, FROM, TO, 15, 'IN-MH');
    expect(a).toEqual(b);
    expect(a).toHaveLength(EXPECTED_POINTS);
    for (const point of a) {
      expect(point.humidityPct).toBeGreaterThanOrEqual(0);
      expect(point.humidityPct).toBeLessThanOrEqual(100);
      expect(point.irradianceWm2).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes clear-sky irradiance from solar geometry', () => {
    // Equator at local solar noon on the equinox → near peak sun.
    expect(clearSkyIrradiance(0, 0, new Date('2024-03-20T12:00:00Z'))).toBeGreaterThan(900);
    // Local midnight → no sun.
    expect(clearSkyIrradiance(0, 0, new Date('2024-03-20T00:00:00Z'))).toBe(0);
  });
});

describe('region helpers', () => {
  it('resolves coordinates for a known region and defaults to Mumbai', () => {
    expect(coordsForRegion('US-CA')).toEqual({ lat: 37.7749, lon: -122.4194 });
    expect(coordsForRegion('ZZ-UNKNOWN')).toEqual({ lat: 19.076, lon: 72.8777 });
  });

  it('loads the committed offline fallback pack', async () => {
    await expect(loadFallbackPack(testConfig().cacheDir)).resolves.toBe(true);
  });
});

describe('CarbonIntensityService fallback ladder', () => {
  it('falls through to synthetic when nothing is cached', async () => {
    const service = new CarbonIntensityService({
      config: testConfig(),
      cache: new MemoryCache(),
      logger: silentLogger,
    });
    const result = await service.getLatest('IN-MH');
    expect(result.dataSource).toBe('synthetic');
    expect(result.provider).toBe('fallback');
    expect(result.data.region).toBe('IN-MH');
  });

  it('serves cached values when present', async () => {
    const cache = new MemoryCache();
    await cache.set('ci_latest_IN-MH', {
      timestamp: '2024-01-01T00:00:00.000Z',
      carbonIntensity: 123,
      isForecast: false,
      dataSource: 'synthetic',
      region: 'IN-MH',
    });
    const service = new CarbonIntensityService({ config: testConfig(), cache, logger: silentLogger });
    const result = await service.getLatest('IN-MH');
    expect(result.dataSource).toBe('cached');
    expect(result.data.carbonIntensity).toBe(123);
  });

  it('resamples a series onto the requested grid', async () => {
    const service = new CarbonIntensityService({
      config: testConfig(),
      cache: new MemoryCache(),
      logger: silentLogger,
    });
    const series = await service.getSeries('IN-MH', FROM, TO, 15);
    expect(series.dataSource).toBe('synthetic');
    expect(series.data).toHaveLength(EXPECTED_POINTS);
    expect(series.data[0]?.dataSource).toBe('synthetic');
    expect(series.data[0]?.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('WeatherService fallback ladder', () => {
  it('resamples synthetic weather onto the requested grid', async () => {
    const service = new WeatherService({
      config: testConfig(),
      cache: new MemoryCache(),
      logger: silentLogger,
    });
    const series = await service.getSeries(19.076, 72.8777, FROM, TO, 'Asia/Kolkata', 15, 'IN-MH');
    expect(series.dataSource).toBe('synthetic');
    expect(series.data).toHaveLength(EXPECTED_POINTS);
    expect(series.data[0]?.dataSource).toBe('synthetic');
    expect(series.data[0]?.humidityPct).toBeGreaterThanOrEqual(0);
  });
});

describe('createConnectors', () => {
  it('wires both services onto a shared cache', () => {
    const connectors = createConnectors(testConfig(), new MemoryCache());
    expect(connectors.carbon).toBeInstanceOf(CarbonIntensityService);
    expect(connectors.weather).toBeInstanceOf(WeatherService);
  });
});
