/**
 * Ingestion-scoped configuration.
 * Reads from environment variables with safe, offline-first defaults so the
 * demo never depends on network availability (NFR-2, FR-3, FR-4).
 */

import { DEFAULT_REGION } from '@carbontwin/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root = …/carbontwin (4 levels up from src/ingestion/config.ts). */
export const REPO_ROOT = path.resolve(HERE, '../../../..');

export interface IngestionConfig {
  /** External provider tokens. */
  electricityMapsToken: string | null;
  co2signalToken: string | null;
  openWeatherKey: string | null;
  /** Force cached/synthetic data even when tokens exist. */
  useFallbackData: boolean;
  /** Timeout for outbound HTTP calls (ms). */
  requestTimeoutMs: number;
  /** Default region used when none is supplied. */
  defaultRegion: string;
  /** Filesystem locations. */
  dataDir: string;
  demoDir: string;
  cacheDir: string;
  rawDir: string;
  /** Persistence backend. */
  persistence: 'memory' | 'file' | 'postgres';
  persistenceFile: string;
  databaseUrl: string | null;
  /** HTTP server. */
  host: string;
  port: number;
  logLevel: string;
  /** Scheduler. */
  enableScheduler: boolean;
  ciRefreshCron: string;
  weatherRefreshCron: string;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadIngestionConfig(env: NodeJS.ProcessEnv = process.env): IngestionConfig {
  const dataDir = env.CARBONTWIN_DATA_DIR ?? path.join(REPO_ROOT, 'data');
  const persistence = (env.INGESTION_PERSISTENCE as IngestionConfig['persistence']) ?? 'file';

  return {
    electricityMapsToken: env.ELECTRICITY_MAPS_TOKEN?.trim() || null,
    co2signalToken: env.CO2SIGNAL_TOKEN?.trim() || env.CO2SIGNAL_API_KEY?.trim() || null,
    openWeatherKey: env.OPENWEATHER_KEY?.trim() || env.OPENWEATHER_API_KEY?.trim() || null,
    useFallbackData: bool(env.USE_FALLBACK_DATA, false),
    requestTimeoutMs: num(env.INGESTION_HTTP_TIMEOUT_MS, 6000),
    defaultRegion: env.DEFAULT_REGION ?? DEFAULT_REGION,
    dataDir,
    demoDir: path.join(dataDir, 'demo'),
    cacheDir: env.CARBONTWIN_CACHE_DIR ?? path.join(dataDir, 'cache'),
    rawDir: path.join(dataDir, 'raw'),
    persistence,
    persistenceFile: env.INGESTION_PERSISTENCE_FILE ?? path.join(dataDir, '.store', 'carbontwin.json'),
    databaseUrl: env.DATABASE_URL ?? null,
    host: env.HOST ?? '0.0.0.0',
    port: num(env.PORT, 4000),
    logLevel: env.LOG_LEVEL ?? 'info',
    enableScheduler: bool(env.ENABLE_SCHEDULER, true),
    ciRefreshCron: env.CI_REFRESH_CRON ?? '*/5 * * * *',
    weatherRefreshCron: env.WEATHER_REFRESH_CRON ?? '*/10 * * * *',
  };
}

let cached: IngestionConfig | null = null;

/** Process-wide singleton config. */
export function getIngestionConfig(): IngestionConfig {
  if (!cached) cached = loadIngestionConfig();
  return cached;
}

/** Test helper — override the singleton (pass null to reset). */
export function setIngestionConfig(config: IngestionConfig | null): void {
  cached = config;
}
