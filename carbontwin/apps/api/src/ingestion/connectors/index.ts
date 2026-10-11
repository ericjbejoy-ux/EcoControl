/**
 * Connector facade + orchestration.
 * Implements the mandatory "Live → Cached → Synthetic" fallback ladder
 * (FR-3, FR-4, NFR-2) and always reports which tier answered.
 */

import type { CarbonIntensityPoint, WeatherPoint } from '@carbontwin/shared';
import type { IngestionConfig } from '../config.js';
import { getLogger, type Logger } from '../logger.js';
import { eachInterval } from '../utils/time.js';
import { interpolateNumericSeries } from '../utils/series.js';
import { round } from '../utils/stats.js';
import { JsonFileCache, type CacheLike } from './cache.js';
import { fetchElectricityMapsHistory, fetchElectricityMapsLatest } from './electricityMaps.client.js';
import { fetchCo2SignalLatest } from './co2signal.client.js';
import { fetchOpenMeteo } from './openMeteo.client.js';
import { fetchOpenWeather } from './openWeather.client.js';
import {
  coordsForRegion,
  syntheticCarbonIntensitySeries,
  syntheticLatestCarbonIntensity,
  syntheticWeatherSeries,
  type CiProvider,
  type DataSourceLabel,
  type ProviderResult,
  type WeatherProviderName,
} from './fallbackProvider.js';

export * from './fallbackProvider.js';
export * from './electricityMaps.client.js';
export * from './co2signal.client.js';
export * from './openMeteo.client.js';
export * from './openWeather.client.js';
export * from './http.js';
export { JsonFileCache, MemoryCache } from './cache.js';
export type { CacheLike } from './cache.js';

export interface ConnectorOptions {
  config: IngestionConfig;
  cache?: CacheLike;
  logger?: Logger;
}

const CI_LATEST_KEY = (region: string) => `ci_latest_${region}`;
const CI_SERIES_KEY = (region: string) => `ci_series_${region}`;
const WEATHER_KEY = (lat: number, lon: number) => `weather_${lat.toFixed(2)}_${lon.toFixed(2)}`;

function clampRange(from: Date, to: Date, maxDays: number): { from: Date; to: Date } {
  const maxMs = maxDays * 86_400_000;
  if (to.getTime() - from.getTime() <= maxMs) return { from, to };
  return { from: new Date(to.getTime() - maxMs), to };
}

// ===========================================================================
// Carbon intensity
// ===========================================================================

export class CarbonIntensityService {
  private readonly cache: CacheLike;
  private readonly logger: Logger;

  constructor(private readonly options: ConnectorOptions) {
    this.cache = options.cache ?? new JsonFileCache(options.config.cacheDir);
    this.logger = options.logger ?? getLogger();
  }

  /** Latest CI value for a region (live → cached → synthetic). */
  async getLatest(region: string): Promise<ProviderResult<CarbonIntensityPoint>> {
    const { config } = this.options;

    if (!config.useFallbackData && (config.electricityMapsToken || config.co2signalToken)) {
      try {
        const { point, provider } = await this.fetchLiveLatest(region);
        await this.cache.set(CI_LATEST_KEY(region), point);
        return { data: point, dataSource: 'live', provider, fetchedAt: new Date().toISOString(), stale: false };
      } catch (err) {
        this.logger.warn('Carbon-intensity providers failed; falling back.', {
          region,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const cached = await this.cache.get<CarbonIntensityPoint>(CI_LATEST_KEY(region), { allowStale: true });
    if (cached) {
      return {
        data: { ...cached.value, dataSource: 'cached' },
        dataSource: 'cached',
        provider: 'fallback',
        fetchedAt: cached.savedAt,
        stale: true,
      };
    }

    const synthetic = syntheticLatestCarbonIntensity(region);
    return { data: synthetic, dataSource: 'synthetic', provider: 'fallback', fetchedAt: new Date().toISOString(), stale: false };
  }

  private async fetchLiveLatest(
    region: string
  ): Promise<{ point: CarbonIntensityPoint; provider: CiProvider }> {
    const { config } = this.options;
    if (config.electricityMapsToken) {
      try {
        const point = await fetchElectricityMapsLatest(region, { token: config.electricityMapsToken, timeoutMs: config.requestTimeoutMs });
        return { point, provider: 'electricitymaps' };
      } catch (err) {
        this.logger.debug('Electricity Maps latest failed.', { error: String(err) });
      }
    }
    if (config.co2signalToken) {
      const point = await fetchCo2SignalLatest(region, { token: config.co2signalToken, timeoutMs: config.requestTimeoutMs });
      return { point, provider: 'co2signal' };
    }
    throw new Error('No carbon-intensity provider token configured.');
  }

  /**
   * Carbon-intensity series for a range, resampled to `intervalMinutes`.
   * Live history is only attempted for recent ranges (free tiers are limited).
   */
  async getSeries(
    region: string,
    from: Date,
    to: Date,
    intervalMinutes = 15
  ): Promise<ProviderResult<CarbonIntensityPoint[]>> {
    const { config } = this.options;
    const range = clampRange(from, to, 31);

    // Try live history (recent ranges only).
    const recent = Date.now() - range.from.getTime() < 7 * 86_400_000;
    if (!config.useFallbackData && config.electricityMapsToken && recent) {
      try {
        const history = await fetchElectricityMapsHistory(region, {
          token: config.electricityMapsToken,
          timeoutMs: config.requestTimeoutMs,
        });
        if (history.length > 0) {
          await this.cache.set(CI_SERIES_KEY(region), history);
          const resampled = this.resample(history, range.from, range.to, intervalMinutes, 'live');
          if (resampled.length > 0) {
            return { data: resampled, dataSource: 'live', provider: 'electricitymaps', fetchedAt: new Date().toISOString(), stale: false };
          }
        }
      } catch (err) {
        this.logger.debug('Carbon-intensity history failed.', { error: String(err), region });
      }
    }

    const cached = await this.cache.get<CarbonIntensityPoint[]>(CI_SERIES_KEY(region), { allowStale: true });
    if (cached && cached.value.length > 0) {
      const resampled = this.resample(cached.value, range.from, range.to, intervalMinutes, 'cached');
      if (resampled.length > 0) {
        return { data: resampled, dataSource: 'cached', provider: 'fallback', fetchedAt: cached.savedAt, stale: true };
      }
    }

    const synthetic = this.resample(
      syntheticCarbonIntensitySeries(region, range.from, range.to, intervalMinutes),
      range.from,
      range.to,
      intervalMinutes,
      'synthetic'
    );
    return { data: synthetic, dataSource: 'synthetic', provider: 'fallback', fetchedAt: new Date().toISOString(), stale: false };
  }

  private resample(
    points: CarbonIntensityPoint[],
    from: Date,
    to: Date,
    intervalMinutes: number,
    label: DataSourceLabel
  ): CarbonIntensityPoint[] {
    const grid = eachInterval(from, to, intervalMinutes).map((d) => d.getTime());
    if (grid.length === 0) return [];
    const srcMs = points.map((p) => Date.parse(p.timestamp));
    const srcVal = points.map((p) => p.carbonIntensity);
    const values = interpolateNumericSeries(srcMs, srcVal, grid);
    const now = Date.now();
    return grid.map((ms, i) => ({
      timestamp: new Date(ms).toISOString(),
      carbonIntensity: round(values[i] ?? 0, 1),
      isForecast: ms > now,
      dataSource: label,
      region: points[0]?.region ?? 'unknown',
    }));
  }
}

// ===========================================================================
// Weather
// ===========================================================================

export class WeatherService {
  private readonly cache: CacheLike;
  private readonly logger: Logger;

  constructor(private readonly options: ConnectorOptions) {
    this.cache = options.cache ?? new JsonFileCache(options.config.cacheDir);
    this.logger = options.logger ?? getLogger();
  }

  /** Weather series (past + forecast) for a location, resampled to the grid. */
  async getSeries(
    lat: number,
    lon: number,
    from: Date,
    to: Date,
    timezone = 'UTC',
    intervalMinutes = 15,
    region?: string
  ): Promise<ProviderResult<WeatherPoint[]>> {
    const { config } = this.options;
    const range = clampRange(from, to, 14);
    const key = WEATHER_KEY(lat, lon);

    if (!config.useFallbackData) {
      try {
        const points = await this.fetchLive(lat, lon, timezone);
        if (points.length > 0) {
          await this.cache.set(key, points);
          const resampled = this.resample(points, lat, lon, range.from, range.to, intervalMinutes, 'live');
          if (resampled.length > 0) {
            const provider: WeatherProviderName = config.openWeatherKey && !this.hasOpenMeteo() ? 'openweather' : 'openmeteo';
            return { data: resampled, dataSource: 'live', provider, fetchedAt: new Date().toISOString(), stale: false };
          }
        }
      } catch (err) {
        this.logger.warn('Weather providers failed; falling back.', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const cached = await this.cache.get<WeatherPoint[]>(key, { allowStale: true });
    if (cached && cached.value.length > 0) {
      const resampled = this.resample(cached.value, lat, lon, range.from, range.to, intervalMinutes, 'cached');
      if (resampled.length > 0) {
        return { data: resampled, dataSource: 'cached', provider: 'fallback', fetchedAt: cached.savedAt, stale: true };
      }
    }

    const synthetic = this.resample(
      syntheticWeatherSeries(lat, lon, range.from, range.to, intervalMinutes, region),
      lat,
      lon,
      range.from,
      range.to,
      intervalMinutes,
      'synthetic'
    );
    return { data: synthetic, dataSource: 'synthetic', provider: 'fallback', fetchedAt: new Date().toISOString(), stale: false };
  }

  private hasOpenMeteo(): boolean {
    // Open-Meteo never needs a key — it is always available.
    return true;
  }

  private async fetchLive(lat: number, lon: number, timezone: string): Promise<WeatherPoint[]> {
    const { config } = this.options;
    // Prefer Open-Meteo (no key, includes irradiance). Fall back to OpenWeather if
    // Open-Meteo fails and a key is present.
    try {
      return await fetchOpenMeteo(lat, lon, { timezone, timeoutMs: config.requestTimeoutMs, pastDays: 2, forecastDays: 3 });
    } catch (err) {
      this.logger.debug('Open-Meteo failed.', { error: String(err) });
      if (config.openWeatherKey) {
        return await fetchOpenWeather(lat, lon, { token: config.openWeatherKey, timeoutMs: config.requestTimeoutMs });
      }
      throw err;
    }
  }

  private resample(
    points: WeatherPoint[],
    lat: number,
    lon: number,
    from: Date,
    to: Date,
    intervalMinutes: number,
    label: DataSourceLabel
  ): WeatherPoint[] {
    const grid = eachInterval(from, to, intervalMinutes).map((d) => d.getTime());
    if (grid.length === 0) return [];
    const srcMs = points.map((p) => Date.parse(p.timestamp));
    const temp = interpolateNumericSeries(srcMs, points.map((p) => p.temperatureC), grid);
    const humidity = interpolateNumericSeries(srcMs, points.map((p) => p.humidityPct), grid);
    const irradiance = interpolateNumericSeries(srcMs, points.map((p) => p.irradianceWm2), grid);
    const wind = interpolateNumericSeries(srcMs, points.map((p) => p.windSpeedMs ?? 0), grid);
    const now = Date.now();
    return grid.map((ms, i) => ({
      timestamp: new Date(ms).toISOString(),
      temperatureC: round(temp[i] ?? 20, 2),
      humidityPct: round(Math.max(0, Math.min(100, humidity[i] ?? 60)), 1),
      irradianceWm2: round(Math.max(0, irradiance[i] ?? 0), 1),
      windSpeedMs: round(Math.max(0, wind[i] ?? 0), 2),
      isForecast: ms > now,
      dataSource: label,
      lat,
      lon,
    }));
  }
}

/** Convenience: resolve coords for a region when the caller has none. */
export function weatherCoordsForRegion(region: string): { lat: number; lon: number } {
  return coordsForRegion(region);
}

/** Convenience factory used by routes. */
export function createConnectors(config: IngestionConfig, cache?: CacheLike) {
  const effectiveCache = cache ?? new JsonFileCache(config.cacheDir);
  return {
    carbon: new CarbonIntensityService({ config, cache: effectiveCache }),
    weather: new WeatherService({ config, cache: effectiveCache }),
  };
}
