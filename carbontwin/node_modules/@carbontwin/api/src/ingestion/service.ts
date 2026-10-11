/**
 * IngestionService — the composition root for the M2 data-ingestion layer.
 * Owns the store, connectors and replay engine, and exposes the operations the
 * routes need. Everything is injectable so tests can run without network/disk.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ANNUAL_AVERAGE_CI,
  type CarbonIntensityResponse,
  type DataQualityReport,
  type Facility,
  type FacilityType,
  type TimeSeriesResponse,
  type WeatherResponse,
} from '@carbontwin/shared';
import { getIngestionConfig, type IngestionConfig } from './config.js';
import { getLogger, type Logger } from './logger.js';
import { createStore, type Store } from './store/index.js';
import { createConnectors, type CarbonIntensityService, type WeatherService } from './connectors/index.js';
import { runIngestPipeline, type IngestResult } from './pipeline/ingestPipeline.js';
import { ReplayEngine, type ReplayOptions } from './pipeline/replayEngine.js';
import { compareDynamicVsStatic, type EmissionsPoint } from './pipeline/emissions.service.js';
import { seedDemoFacilities, DEMO_FACILITIES, type SeedResult } from './db/seed.js';
import { facilityNotFound } from './errors.js';
import type { TimeseriesQuery } from './store/timeseries.repo.js';
import { round } from './utils/stats.js';
import { eachInterval } from './utils/time.js';

export interface UploadInput {
  content: Buffer | ArrayBuffer | Uint8Array;
  fileName: string;
  mimeType?: string;
  facilityId?: string;
  facility?: {
    name?: string;
    type?: FacilityType;
    region?: string;
    timezone?: string;
    lat?: number;
    lon?: number;
    address?: string;
    floorAreaM2?: number;
    metadata?: Record<string, unknown>;
  };
  mapping?: Parameters<typeof runIngestPipeline>[0]['mapping'];
}

export interface IngestionServiceDeps {
  config?: IngestionConfig;
  store?: Store;
  carbon?: CarbonIntensityService;
  weather?: WeatherService;
  logger?: Logger;
}

export class IngestionService {
  readonly config: IngestionConfig;
  readonly store: Store;
  readonly carbon: CarbonIntensityService;
  readonly weather: WeatherService;
  readonly replay: ReplayEngine;
  readonly logger: Logger;

  private constructor(deps: Required<Pick<IngestionServiceDeps, 'config' | 'store' | 'carbon' | 'weather' | 'logger'>>) {
    this.config = deps.config;
    this.store = deps.store;
    this.carbon = deps.carbon;
    this.weather = deps.weather;
    this.logger = deps.logger;
    this.replay = new ReplayEngine({
      store: this.store,
      config: this.config,
      carbon: this.carbon,
      weather: this.weather,
      logger: this.logger,
    });
  }

  static async create(deps: IngestionServiceDeps = {}): Promise<IngestionService> {
    const config = deps.config ?? getIngestionConfig();
    const logger = deps.logger ?? getLogger();
    const store = deps.store ?? (await createStore(config));
    const connectors = createConnectors(config);
    // Load the committed offline fallback pack (best-effort, non-blocking failure).
    try {
      const { loadFallbackPack } = await import('./connectors/fallbackProvider.js');
      await loadFallbackPack(config.cacheDir);
    } catch (err) {
      logger.debug('Offline fallback pack not loaded.', { error: String(err) });
    }
    return new IngestionService({
      config,
      store,
      carbon: deps.carbon ?? connectors.carbon,
      weather: deps.weather ?? connectors.weather,
      logger,
    });
  }

  // -------------------------------------------------------------------------
  // Facilities
  // -------------------------------------------------------------------------

  async upload(input: UploadInput): Promise<IngestResult> {
    // Attach carbon intensity for the uploaded window (live → cached → synthetic).
    let carbonIntensity;
    const region = input.facility?.region ?? this.config.defaultRegion;
    try {
      const range = peekRange(input.content);
      if (range) {
        const series = await this.carbon.getSeries(region, range.from, range.to, 15);
        carbonIntensity = series.data;
      }
    } catch (err) {
      this.logger.warn('Could not attach carbon intensity during upload.', { error: String(err) });
    }

    return runIngestPipeline({
      ...input,
      carbonIntensity,
      store: this.store,
      config: this.config,
      logger: this.logger,
    });
  }

  async listFacilities(): Promise<Facility[]> {
    return this.store.facilities.list();
  }

  async getFacility(id: string): Promise<Facility> {
    const facility = await this.store.facilities.get(id);
    if (!facility) throw facilityNotFound(id);
    return facility;
  }

  async deleteFacility(id: string): Promise<boolean> {
    return this.store.facilities.delete(id);
  }

  async getQualityReport(id: string): Promise<DataQualityReport> {
    const report = await this.store.facilities.getQualityReport(id);
    if (!report) throw facilityNotFound(id);
    return report;
  }

  // -------------------------------------------------------------------------
  // Time series
  // -------------------------------------------------------------------------

  async getTimeseries(id: string, query: TimeseriesQuery & { timezone?: string } = {}): Promise<TimeSeriesResponse> {
    const facility = await this.getFacility(id);
    const records = await this.store.timeseries.query(id, query);

    const summary = { measured: 0, imputed: 0, interpolated: 0, synthetic: 0 };
    for (const r of records) summary[r.quality]++;

    const total = records.length || 1;
    return {
      facilityId: id,
      timezone: query.timezone ?? facility.timezone,
      intervalMinutes: query.resolutionMinutes ?? 15,
      data: records.map((r) => ({
        timestamp: r.timestamp,
        powerKw: r.powerKw,
        emissionsKg: r.emissionsKg ?? undefined,
        carbonIntensity: r.carbonIntensity ?? undefined,
        dataQuality: r.quality,
        flags: r.flags,
      })),
      meta: {
        from: records[0]?.timestamp ?? new Date().toISOString(),
        to: records[records.length - 1]?.timestamp ?? new Date().toISOString(),
        count: records.length,
        dataSource: 'uploaded',
        qualitySummary: {
          measuredPct: round((summary.measured / total) * 100, 2),
          imputedPct: round((summary.imputed / total) * 100, 2),
          interpolatedPct: round((summary.interpolated / total) * 100, 2),
          syntheticPct: round((summary.synthetic / total) * 100, 2),
          gapCount: 0,
          outlierCount: records.reduce((acc, r) => acc + (r.flags.includes('outlier') ? 1 : 0), 0),
        },
      },
    };
  }

  async getStats(id: string) {
    await this.getFacility(id);
    return this.store.timeseries.stats(id);
  }

  // -------------------------------------------------------------------------
  // Carbon intensity & weather
  // -------------------------------------------------------------------------

  async getCarbonIntensity(
    region: string,
    options: { from?: string; to?: string } = {}
  ): Promise<CarbonIntensityResponse> {
    const latest = await this.carbon.getLatest(region);
    const now = new Date();
    const from = options.from ? new Date(options.from) : new Date(now.getTime() - 86_400_000);
    const to = options.to ? new Date(options.to) : new Date(now.getTime() + 86_400_000);
    const series = await this.carbon.getSeries(region, from, to, 15);

    const history = series.data.filter((p) => !p.isForecast);
    const forecast = series.data.filter((p) => p.isForecast);
    return {
      region,
      timezone: 'UTC',
      current: latest.data,
      forecast,
      history,
      meta: {
        dataSource: latest.dataSource,
        lastUpdated: latest.fetchedAt,
        provider: (latest.provider as CarbonIntensityResponse['meta']['provider']) ?? 'fallback',
      },
    };
  }

  async getWeather(
    lat: number,
    lon: number,
    options: { from?: string; to?: string; timezone?: string; region?: string } = {}
  ): Promise<WeatherResponse> {
    const now = new Date();
    const from = options.from ? new Date(options.from) : new Date(now.getTime() - 86_400_000);
    const to = options.to ? new Date(options.to) : new Date(now.getTime() + 2 * 86_400_000);
    const series = await this.weather.getSeries(lat, lon, from, to, options.timezone ?? 'UTC', 15, options.region);
    const history = series.data.filter((p) => !p.isForecast);
    const forecast = series.data.filter((p) => p.isForecast);
    const current = [...history].reverse()[0] ?? series.data[0];
    return {
      lat,
      lon,
      timezone: options.timezone ?? 'UTC',
      current: current ?? {
        timestamp: now.toISOString(),
        temperatureC: 20,
        humidityPct: 60,
        irradianceWm2: 0,
        isForecast: false,
        dataSource: 'synthetic',
        lat,
        lon,
      },
      forecast,
      history,
      meta: {
        dataSource: series.dataSource,
        lastUpdated: series.fetchedAt,
        provider: (series.provider as WeatherResponse['meta']['provider']) ?? 'fallback',
      },
    };
  }

  // -------------------------------------------------------------------------
  // Emissions (FR-7, FR-9)
  // -------------------------------------------------------------------------

  async getEmissionsComparison(
    id: string,
    options: { from?: string; to?: string; annualAverageCi?: number } = {}
  ) {
    const facility = await this.getFacility(id);
    const records = await this.store.timeseries.query(id, { from: options.from, to: options.to, limit: 100_000 });

    let ciByMs = new Map<number, number>();
    const needCi = records.some((r) => r.carbonIntensity === null);
    if (needCi && records.length > 0) {
      const from = new Date(records[0]!.timestamp);
      const to = new Date(records[records.length - 1]!.timestamp);
      try {
        const series = await this.carbon.getSeries(facility.region, from, to, 15);
        ciByMs = new Map(series.data.map((p) => [Date.parse(p.timestamp), p.carbonIntensity]));
      } catch (err) {
        this.logger.warn('CI fetch failed for emissions comparison.', { error: String(err) });
      }
    }

    const fallbackCi = options.annualAverageCi ?? ANNUAL_AVERAGE_CI[facility.region] ?? 400;
    const emissions: EmissionsPoint[] = records.map((r) => {
      const ci = r.carbonIntensity ?? ciByMs.get(Date.parse(r.timestamp)) ?? fallbackCi;
      const emissionsKg = r.emissionsKg ?? (r.powerKw * 0.25 * ci) / 1000;
      return { timestampUtc: r.timestamp, powerKw: r.powerKw, carbonIntensity: ci, emissionsKg };
    });

    const comparison = compareDynamicVsStatic(emissions, {
      region: facility.region,
      annualAverageCi: options.annualAverageCi,
    });

    return {
      facilityId: id,
      region: facility.region,
      from: records[0]?.timestamp ?? new Date().toISOString(),
      to: records[records.length - 1]?.timestamp ?? new Date().toISOString(),
      comparison: comparison.comparison,
      totals: comparison.totals,
      meta: { dataSource: 'cached' as const, calculatedAt: new Date().toISOString() },
    };
  }

  // -------------------------------------------------------------------------
  // Replay (FR-6)
  // -------------------------------------------------------------------------

  async prepareReplay(options: ReplayOptions) {
    await this.getFacility(options.facilityId);
    return this.replay.prepare(options);
  }

  // -------------------------------------------------------------------------
  // Demo seeding (FR-2)
  // -------------------------------------------------------------------------

  async seed(options: { force?: boolean; only?: string[] } = {}): Promise<SeedResult> {
    return seedDemoFacilities({
      store: this.store,
      config: this.config,
      carbon: this.carbon,
      logger: this.logger,
      force: options.force,
      only: options.only,
    });
  }

  get demoFacilitySpecs() {
    return DEMO_FACILITIES;
  }

  // -------------------------------------------------------------------------
  // Health (NFR-8)
  // -------------------------------------------------------------------------

  async health() {
    const facilities = await this.store.facilities.count();
    return {
      status: 'healthy' as const,
      database: 'connected' as const,
      facilities,
      externalApis: {
        electricityMaps: this.config.electricityMapsToken ? ('live' as const) : ('cached' as const),
        co2signal: this.config.co2signalToken ? ('live' as const) : ('cached' as const),
        openMeteo: 'live' as const,
        openWeather: this.config.openWeatherKey ? ('live' as const) : ('unavailable' as const),
      },
      scheduler: this.config.enableScheduler,
      persistence: this.config.persistence,
      useFallbackData: this.config.useFallbackData,
    };
  }

  async flush(): Promise<void> {
    await this.store.db.flush();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Best-effort first/last timestamp sniff without a full parse. */
function peekRange(content: Buffer | ArrayBuffer | Uint8Array): { from: Date; to: Date } | null {
  try {
    const buffer = Buffer.isBuffer(content)
      ? content
      : content instanceof ArrayBuffer
        ? Buffer.from(content)
        : Buffer.from(content);
    const text = buffer.subarray(0, 64_000).toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return null;
    const header = (lines[0] as string).split(',').map((h) => h.trim().toLowerCase());
    let tsIndex = header.findIndex((h) => h.includes('time') || h.includes('date'));
    if (tsIndex < 0) tsIndex = 0;
    const first = (lines[1] as string).split(',')[tsIndex]?.replace(/"/g, '').trim();
    const from = first ? new Date(first) : null;
    // tail
    const tail = buffer.subarray(Math.max(0, buffer.length - 4000)).toString('utf-8');
    const tailLines = tail.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const last = tailLines[tailLines.length - 1]?.split(',')[tsIndex]?.replace(/"/g, '').trim();
    const to = last ? new Date(last) : null;
    if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
    return { from, to };
  } catch {
    return null;
  }
}

/** Expose interpolation grid helper for callers that need aligned CI/weather. */
export function alignedGrid(from: Date, to: Date, minutes = 15): Date[] {
  return eachInterval(from, to, minutes);
}
