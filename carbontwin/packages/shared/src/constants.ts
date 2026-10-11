/**
 * Shared constants used across the CarbonTwin platform.
 * Single source of truth for magic numbers, defaults, and enums.
 */

// ============================================================================
// Physical & Unit Constants
// ============================================================================

export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86_400;
export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_HOUR = 60;
export const JOULES_PER_KWH = 3.6e6;
export const WATTS_PER_KW = 1000;
export const KG_PER_TONNE = 1000;

/** Canonical data interval: 15 minutes, expressed in hours. */
export const INTERVAL_HOURS = 0.25;
/** Canonical data interval in minutes. */
export const INTERVAL_MINUTES = 15;

// ============================================================================
// Ingestion defaults
// ============================================================================

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB (NFR-4)
export const MAX_UPLOAD_MB = 50;
export const SUPPORTED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.apache.parquet',
  'application/octet-stream',
] as const;
export const SUPPORTED_EXTENSIONS = ['.csv', '.parquet', '.pq'] as const;

// ============================================================================
// Data quality
// ============================================================================

export const DEFAULT_OUTLIER_ZSCORE_THRESHOLD = 3.5;
export const DEFAULT_MAX_GAP_MINUTES = 60;
export const DEFAULT_IRREGULARITY_TOLERANCE_PCT = 5;
export const MAX_INTERPOLATION_GAP_MINUTES = 120;
export const QUALITY_SCORE_WEIGHTS = {
  completeness: 0.4,
  regularity: 0.3,
  validity: 0.2,
  consistency: 0.1,
} as const;

// ============================================================================
// Cache TTLs (milliseconds)
// ============================================================================

export const CACHE_TTL = {
  carbonIntensity: 5 * 60 * 1000, // 5 min
  weather: 10 * 60 * 1000, // 10 min
  forecast: 60 * 60 * 1000, // 1 h
  fallback: 24 * 60 * 60 * 1000, // 24 h
} as const;

// ============================================================================
// External API endpoints
// ============================================================================

export const API_ENDPOINTS = {
  electricityMaps: {
    base: 'https://api.electricitymap.org/v3',
    carbonIntensity: '/carbon-intensity/latest',
    carbonIntensityHistory: '/carbon-intensity/history',
    carbonIntensityForecast: '/carbon-intensity/forecast',
  },
  co2signal: {
    base: 'https://api.co2signal.com/v1',
    latest: '/latest',
  },
  openMeteo: {
    base: 'https://api.open-meteo.com/v1',
    forecast: '/forecast',
    archive: 'https://archive-api.open-meteo.com/v1/archive',
  },
  openWeather: {
    base: 'https://api.openweathermap.org/data/2.5',
    current: '/weather',
    forecast: '/forecast',
  },
} as const;

// ============================================================================
// Region defaults
// ============================================================================

export const DEFAULT_REGION = 'IN-MH';

/** Annual-average grid carbon intensity (gCO2/kWh), used for FR-9 comparison. */
export const ANNUAL_AVERAGE_CI: Record<string, number> = {
  'IN-MH': 700,
  'IN-DL': 720,
  'IN-KA': 480,
  'IN-TN': 635, // derived from the Ember 2024 India generation mix (see data/cache)
  'US-CA': 250,
  'US-TX': 400,
  'US-NY': 220,
  'US-WA': 130,
  'GB-LND': 200,
  'DE-BE': 350,
  'FR-IDF': 60,
  'AU-NSW': 650,
  SG: 430,
  'JP-13': 470,
  'CN-BJ': 620,
};

export const REGION_CENTROIDS: Record<string, { lat: number; lon: number; timezone: string; city: string }> = {
  'IN-MH': { lat: 19.076, lon: 72.8777, timezone: 'Asia/Kolkata', city: 'Mumbai' },
  'IN-DL': { lat: 28.6139, lon: 77.209, timezone: 'Asia/Kolkata', city: 'New Delhi' },
  'IN-KA': { lat: 12.9716, lon: 77.5946, timezone: 'Asia/Kolkata', city: 'Bengaluru' },
  'IN-TN': { lat: 13.0827, lon: 80.2707, timezone: 'Asia/Kolkata', city: 'Chennai' },
  'US-CA': { lat: 37.7749, lon: -122.4194, timezone: 'America/Los_Angeles', city: 'San Francisco' },
  'US-TX': { lat: 29.7604, lon: -95.3698, timezone: 'America/Chicago', city: 'Houston' },
  'US-NY': { lat: 40.7128, lon: -74.006, timezone: 'America/New_York', city: 'New York' },
  'US-WA': { lat: 47.6062, lon: -122.3321, timezone: 'America/Los_Angeles', city: 'Seattle' },
  'GB-LND': { lat: 51.5074, lon: -0.1278, timezone: 'Europe/London', city: 'London' },
  'DE-BE': { lat: 52.52, lon: 13.405, timezone: 'Europe/Berlin', city: 'Berlin' },
  'FR-IDF': { lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris', city: 'Paris' },
  'AU-NSW': { lat: -33.8688, lon: 151.2093, timezone: 'Australia/Sydney', city: 'Sydney' },
  SG: { lat: 1.3521, lon: 103.8198, timezone: 'Asia/Singapore', city: 'Singapore' },
  'JP-13': { lat: 35.6762, lon: 139.6503, timezone: 'Asia/Tokyo', city: 'Tokyo' },
  'CN-BJ': { lat: 39.9042, lon: 116.4074, timezone: 'Asia/Shanghai', city: 'Beijing' },
};

// ============================================================================
// Replay
// ============================================================================

/** Default replay speed: one simulated day per real minute. */
export const DEFAULT_REPLAY_SPEED_MULTIPLIER = 1440;
export const REPLAY_TICK_INTERVAL_MS = 2500; // push a tick every 2.5 s (≈1 data-day / 60 s)

// ============================================================================
// Emissions reduction factors (for impact equivalents)
// ============================================================================

export const IMPACT_EQUIVALENTS = {
  /** kg CO2 absorbed by one mature tree per year. */
  kgCo2PerTreePerYear: 21,
  /** kg CO2 emitted by an average passenger car per km. */
  kgCo2PerCarKm: 0.192,
  /** kg CO2 for one home's electricity per year (US avg). */
  kgCo2PerHomePerYear: 4500,
} as const;

// ============================================================================
// Demo facility identifiers (stable UUIDs so links never break)
// ============================================================================

export const DEMO_FACILITY_IDS = {
  officeTower: '11111111-1111-4111-8111-111111111111',
  hospital: '22222222-2222-4222-8222-222222222222',
  campus: '33333333-3333-4333-8333-333333333333',
  dataCenter: '44444444-4444-4444-8444-444444444444',
  chennaiPark: '55555555-5555-4555-8555-555555555555',
} as const;

export const DEMO_FACILITY_FILES = {
  officeTower: 'office_tower.csv',
  hospital: 'hospital.csv',
  campus: 'campus.csv',
  dataCenter: 'data_center.csv',
  chennaiPark: 'chennai_it_park.csv',
} as const;

// ============================================================================
// HTTP status / error codes
// ============================================================================

export const INGESTION_ERROR_CODES = {
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PARSE_ERROR: 'PARSE_ERROR',
  SCHEMA_NOT_DETECTED: 'SCHEMA_NOT_DETECTED',
  MISSING_REQUIRED_COLUMN: 'MISSING_REQUIRED_COLUMN',
  EMPTY_DATASET: 'EMPTY_DATASET',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_POWER_VALUE: 'INVALID_POWER_VALUE',
  FACILITY_NOT_FOUND: 'FACILITY_NOT_FOUND',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
} as const;

export type IngestionErrorCode = (typeof INGESTION_ERROR_CODES)[keyof typeof INGESTION_ERROR_CODES];
