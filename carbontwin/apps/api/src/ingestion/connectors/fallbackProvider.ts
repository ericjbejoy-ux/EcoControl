/**
 * Fallback provider (FR-3, FR-4, NFR-2).
 * Guarantees the demo never hard-fails: when live providers are unavailable it
 * serves cached values, and when there is no cache it generates a deterministic
 * synthetic profile ("Live → Cached → Synthetic" ladder).
 *
 * Determinism matters: the same region/lat/lon/date always yields the same
 * values, so tests are stable and judges see consistent numbers offline.
 */

import {
  ANNUAL_AVERAGE_CI,
  REGION_CENTROIDS,
  type CarbonIntensityPoint,
  type WeatherPoint,
} from '@carbontwin/shared';
import { createRng } from '../utils/rng.js';
import { clamp, round } from '../utils/stats.js';
import { eachInterval } from '../utils/time.js';
import { DateTime } from 'luxon';

// ---------------------------------------------------------------------------
// Provider result envelope
// ---------------------------------------------------------------------------

export type DataSourceLabel = 'live' | 'cached' | 'synthetic';
export type CiProvider = 'electricitymaps' | 'co2signal' | 'fallback';
export type WeatherProviderName = 'openmeteo' | 'openweather' | 'fallback';

export interface ProviderResult<T> {
  data: T;
  dataSource: DataSourceLabel;
  provider: CiProvider | WeatherProviderName;
  fetchedAt: string;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Grid carbon intensity — synthetic profile
// ---------------------------------------------------------------------------

/** Regional hour-of-day CI shapes (0-23). Values are relative multipliers. */
export interface RegionCiProfile {
  annualAverageCi: number;
  diurnal: number[];
}

let REGION_CARBON_INTENSITY_PROFILES: Record<string, RegionCiProfile> = {
  'IN-MH': { annualAverageCi: 700, diurnal: [0.93, 0.9, 0.89, 0.87, 0.9, 0.97, 1.03, 1.07, 1.03, 1.0, 0.97, 0.94, 0.93, 0.91, 0.9, 0.9, 0.91, 0.97, 1.04, 1.09, 1.04, 1.0, 0.96, 0.93] },
  'IN-DL': { annualAverageCi: 720, diurnal: [0.94, 0.91, 0.89, 0.88, 0.91, 0.98, 1.04, 1.07, 1.03, 1.0, 0.97, 0.94, 0.93, 0.91, 0.9, 0.9, 0.92, 0.98, 1.05, 1.1, 1.05, 1.0, 0.96, 0.93] },
  'IN-KA': { annualAverageCi: 480, diurnal: [0.9, 0.86, 0.84, 0.82, 0.86, 0.95, 1.06, 1.12, 1.05, 1.0, 0.96, 0.92, 0.9, 0.88, 0.86, 0.86, 0.88, 0.95, 1.05, 1.12, 1.06, 1.0, 0.94, 0.9] },
  // IN-TN values are derived from real data (Ember 2024 mix + Open-Meteo 2024
  // irradiance); see data/scripts/build_reference_datasets.py and data/cache.
  'IN-TN': { annualAverageCi: 634.6, diurnal: [1.0222, 0.9881, 0.9576, 0.8965, 0.8833, 0.9116, 0.9411, 0.9643, 0.9365, 0.9318, 0.9376, 0.9501, 0.9818, 0.9922, 0.9892, 0.9892, 1.0002, 1.0661, 1.1431, 1.198, 1.1431, 1.0991, 1.0551, 1.0222] },
  'US-CA': { annualAverageCi: 250, diurnal: [0.8, 0.72, 0.68, 0.64, 0.72, 0.88, 1.12, 1.28, 1.12, 1.0, 0.88, 0.8, 0.76, 0.74, 0.72, 0.72, 0.76, 0.88, 1.12, 1.28, 1.2, 1.12, 1.0, 0.88] },
  'US-TX': { annualAverageCi: 400, diurnal: [0.88, 0.83, 0.8, 0.78, 0.83, 0.95, 1.05, 1.13, 1.05, 1.0, 0.95, 0.9, 0.88, 0.85, 0.83, 0.83, 0.85, 0.95, 1.08, 1.15, 1.08, 1.0, 0.93, 0.88] },
  'US-NY': { annualAverageCi: 220, diurnal: [0.84, 0.78, 0.74, 0.7, 0.76, 0.88, 1.08, 1.2, 1.08, 1.0, 0.92, 0.86, 0.84, 0.82, 0.8, 0.8, 0.84, 0.92, 1.08, 1.2, 1.12, 1.0, 0.9, 0.84] },
  'GB-LND': { annualAverageCi: 200, diurnal: [0.9, 0.85, 0.8, 0.75, 0.8, 0.9, 1.05, 1.2, 1.1, 1.0, 0.95, 0.9, 0.88, 0.85, 0.83, 0.83, 0.85, 0.95, 1.1, 1.2, 1.1, 1.0, 0.95, 0.9] },
  'DE-BE': { annualAverageCi: 350, diurnal: [0.86, 0.8, 0.77, 0.74, 0.8, 0.91, 1.09, 1.2, 1.09, 1.0, 0.94, 0.89, 0.86, 0.83, 0.8, 0.8, 0.83, 0.91, 1.06, 1.17, 1.09, 1.0, 0.91, 0.86] },
  'FR-IDF': { annualAverageCi: 60, diurnal: [0.72, 0.66, 0.62, 0.6, 0.68, 0.86, 1.12, 1.3, 1.12, 1.0, 0.86, 0.78, 0.72, 0.7, 0.68, 0.68, 0.72, 0.86, 1.12, 1.3, 1.2, 1.05, 0.88, 0.78] },
  'AU-NSW': { annualAverageCi: 650, diurnal: [0.9, 0.87, 0.85, 0.84, 0.88, 0.97, 1.04, 1.08, 1.03, 1.0, 0.96, 0.92, 0.9, 0.88, 0.86, 0.86, 0.88, 0.96, 1.05, 1.1, 1.05, 1.0, 0.95, 0.92] },
  SG: { annualAverageCi: 430, diurnal: [0.92, 0.9, 0.89, 0.88, 0.91, 0.97, 1.03, 1.05, 1.02, 1.0, 0.98, 0.96, 0.95, 0.94, 0.93, 0.94, 0.97, 1.02, 1.06, 1.07, 1.03, 1.0, 0.96, 0.93] },
  'JP-13': { annualAverageCi: 470, diurnal: [0.86, 0.82, 0.8, 0.78, 0.84, 0.96, 1.06, 1.1, 1.04, 1.0, 0.96, 0.92, 0.9, 0.88, 0.86, 0.86, 0.9, 0.98, 1.08, 1.14, 1.08, 1.0, 0.94, 0.88] },
  'CN-BJ': { annualAverageCi: 620, diurnal: [0.93, 0.9, 0.88, 0.86, 0.9, 0.98, 1.05, 1.08, 1.03, 1.0, 0.97, 0.94, 0.92, 0.9, 0.89, 0.89, 0.91, 0.97, 1.05, 1.1, 1.05, 1.0, 0.96, 0.93] },
};

/** Per-region climate parameters for the synthetic weather model. */
export interface RegionClimateProfile {
  lat: number;
  lon: number;
  timezone: string;
  baseC: number;
  seasonalAmpC: number;
  diurnalAmpC: number;
}

const DEFAULT_CLIMATE: Record<string, RegionClimateProfile> = {
  'IN-MH': { lat: 19.076, lon: 72.8777, timezone: 'Asia/Kolkata', baseC: 28, seasonalAmpC: 4, diurnalAmpC: 6 },
  // Measured from the Open-Meteo 2024 Tamil Nadu archive (build_reference_datasets.py).
  'IN-TN': { lat: 13.0827, lon: 80.2707, timezone: 'Asia/Kolkata', baseC: 28.43, seasonalAmpC: 3.77, diurnalAmpC: 4.96 },
  'GB-LND': { lat: 51.5074, lon: -0.1278, timezone: 'Europe/London', baseC: 11, seasonalAmpC: 8, diurnalAmpC: 5 },
  'US-CA': { lat: 37.7749, lon: -122.4194, timezone: 'America/Los_Angeles', baseC: 17, seasonalAmpC: 7, diurnalAmpC: 8 },
  'DE-BE': { lat: 52.52, lon: 13.405, timezone: 'Europe/Berlin', baseC: 11, seasonalAmpC: 11, diurnalAmpC: 6 },
};

let REGION_CLIMATE_PROFILES: Record<string, RegionClimateProfile> = { ...DEFAULT_CLIMATE };

/**
 * Merge an offline fallback pack (data/cache/grid_ci_fallback.json +
 * data/cache/weather_fallback.json) into the in-memory profiles. This is how
 * the committed cache files are consumed at boot.
 */
export function applyFallbackPack(pack: {
  carbon?: { regions?: Record<string, RegionCiProfile> };
  weather?: { regions?: Record<string, RegionClimateProfile> };
}): void {
  if (pack.carbon?.regions) {
    for (const [region, profile] of Object.entries(pack.carbon.regions)) {
      if (profile?.diurnal?.length === 24) {
        REGION_CARBON_INTENSITY_PROFILES[region] = {
          annualAverageCi: profile.annualAverageCi ?? ANNUAL_AVERAGE_CI[region] ?? 400,
          diurnal: profile.diurnal,
        };
      }
    }
  }
  if (pack.weather?.regions) {
    for (const [region, profile] of Object.entries(pack.weather.regions)) {
      if (profile) REGION_CLIMATE_PROFILES = { ...REGION_CLIMATE_PROFILES, [region]: profile };
    }
  }
}

/** Regional hour-of-day multipliers (0-23), normalised to mean 1.0. */
export function regionDiurnalShape(region: string): number[] {
  const profile = REGION_CARBON_INTENSITY_PROFILES[region];
  const hourly = profile?.diurnal;
  if (hourly && hourly.length === 24) {
    const m = hourly.reduce((a, b) => a + b, 0) / hourly.length;
    return hourly.map((v) => (m > 0 ? v / m : 1));
  }
  // Generic duck curve: cleaner overnight, dirtier 6-9 pm.
  const generic = [
    0.85, 0.82, 0.8, 0.79, 0.82, 0.88, 0.96, 1.03, 1.05, 1.04, 1.02, 1.0,
    0.99, 0.99, 1.0, 1.02, 1.06, 1.12, 1.2, 1.24, 1.18, 1.08, 0.97, 0.9,
  ];
  const m = generic.reduce((a, b) => a + b, 0) / generic.length;
  return generic.map((v) => v / m);
}

/** Deterministic synthetic carbon-intensity series for a region + time range. */
export function syntheticCarbonIntensitySeries(
  region: string,
  from: Date,
  to: Date,
  intervalMinutes = 15
): CarbonIntensityPoint[] {
  const avg = REGION_CARBON_INTENSITY_PROFILES[region]?.annualAverageCi ?? ANNUAL_AVERAGE_CI[region] ?? 400;
  const shape = regionDiurnalShape(region);
  const out: CarbonIntensityPoint[] = [];

  for (const ts of eachInterval(from, to, intervalMinutes)) {
    const dt = DateTime.fromJSDate(ts, { zone: 'utc' });
    const hourFloat = dt.hour + dt.minute / 60;
    const i0 = Math.floor(hourFloat) % 24;
    const i1 = (i0 + 1) % 24;
    const frac = hourFloat - Math.floor(hourFloat);
    const shapeValue = (shape[i0] as number) * (1 - frac) + (shape[i1] as number) * frac;

    const rng = createRng(`${region}:${dt.toISODate()}:${dt.hour}:${dt.minute}`);
    const noise = rng.normal(1, 0.035);
    // Renewables abundance on weekends + summer afternoons modestly lower CI.
    const weekendFactor = dt.weekday > 5 ? 0.96 : 1.0;
    const value = clamp(avg * shapeValue * noise * weekendFactor, 30, 1100);

    out.push({
      timestamp: ts.toISOString(),
      carbonIntensity: round(value, 1),
      isForecast: ts > new Date(),
      dataSource: 'synthetic',
      region,
    });
  }
  return out;
}

/** A single synthetic "latest" CI value. */
export function syntheticLatestCarbonIntensity(region: string, at: Date = new Date()): CarbonIntensityPoint {
  const series = syntheticCarbonIntensitySeries(region, at, at, 15);
  return (
    series[0] ?? {
      timestamp: at.toISOString(),
      carbonIntensity: ANNUAL_AVERAGE_CI[region] ?? 400,
      isForecast: false,
      dataSource: 'synthetic',
      region,
    }
  );
}

// ---------------------------------------------------------------------------
// Weather — synthetic profile
// ---------------------------------------------------------------------------

function regionClimate(
  lat: number,
  region?: string
): { base: number; seasonalAmp: number; diurnalAmp: number } {
  const pack = region ? REGION_CLIMATE_PROFILES[region] : undefined;
  if (pack) return { base: pack.baseC, seasonalAmp: pack.seasonalAmpC, diurnalAmp: pack.diurnalAmpC };
  const absLat = Math.abs(lat);
  if (absLat < 15) return { base: 28, seasonalAmp: 2, diurnalAmp: 5 };
  if (absLat < 30) return { base: 25, seasonalAmp: 8, diurnalAmp: 7 };
  if (absLat < 45) return { base: 17, seasonalAmp: 13, diurnalAmp: 8 };
  if (absLat < 60) return { base: 11, seasonalAmp: 15, diurnalAmp: 7 };
  return { base: 3, seasonalAmp: 16, diurnalAmp: 6 };
}

/** Clear-sky irradiance (W/m²) from solar geometry. */
export function clearSkyIrradiance(lat: number, lon: number, at: Date): number {
  const dt = DateTime.fromJSDate(at, { zone: 'utc' });
  const dayOfYear = dt.ordinal;
  const declination = 23.45 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const solarHour = dt.hour + dt.minute / 60 - lon / 15; // solar time (UTC reference)
  const hourAngle = 15 * (solarHour - 12);
  const latRad = (lat * Math.PI) / 180;
  const decRad = (declination * Math.PI) / 180;
  const haRad = (hourAngle * Math.PI) / 180;
  const sinElev =
    Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  if (sinElev <= 0) return 0;
  return round(1000 * Math.pow(sinElev, 1.15), 1);
}

/** Deterministic synthetic weather series. */
export function syntheticWeatherSeries(
  lat: number,
  lon: number,
  from: Date,
  to: Date,
  intervalMinutes = 15,
  region?: string
): WeatherPoint[] {
  const climate = regionClimate(lat, region);
  const southern = lat < 0;
  const out: WeatherPoint[] = [];

  for (const ts of eachInterval(from, to, intervalMinutes)) {
    const dt = DateTime.fromJSDate(ts, { zone: 'utc' });
    const dayOfYear = dt.ordinal;
    const peakDay = southern ? 20 : 200;
    const seasonal = Math.cos((2 * Math.PI * (dayOfYear - peakDay)) / 365);
    const hourFloat = dt.hour + dt.minute / 60;
    const diurnal = Math.cos((2 * Math.PI * (hourFloat - 15)) / 24); // peak ~15:00
    const rng = createRng(`wx:${lat.toFixed(2)}:${lon.toFixed(2)}:${dt.toISODate()}:${dt.hour}:${dt.minute}`);

    const temperatureC =
      climate.base + climate.seasonalAmp * seasonal + climate.diurnalAmp * diurnal + rng.normal(0, 1.1);

    const clearSky = clearSkyIrradiance(lat, lon, ts);
    const cloudCover = clamp(30 + rng.normal(0, 22), 0, 100);
    const irradianceWm2 = clearSky * (1 - 0.75 * (cloudCover / 100));

    const humidity = clamp(70 - 20 * seasonal - 8 * diurnal + rng.normal(0, 5), 15, 100);
    const windSpeed = clamp(2.5 + rng.normal(0, 1.2), 0, 20);

    out.push({
      timestamp: ts.toISOString(),
      temperatureC: round(temperatureC, 2),
      humidityPct: round(humidity, 1),
      irradianceWm2: round(Math.max(0, irradianceWm2), 1),
      windSpeedMs: round(windSpeed, 2),
      cloudCoverPct: round(cloudCover, 1),
      isForecast: ts > new Date(),
      dataSource: 'synthetic',
      lat,
      lon,
    });
  }
  return out;
}

/** A single synthetic "current" weather observation. */
export function syntheticCurrentWeather(lat: number, lon: number, at: Date = new Date()): WeatherPoint {
  const series = syntheticWeatherSeries(lat, lon, at, at, 15);
  const first = series[0];
  if (first) return first;
  return {
    timestamp: at.toISOString(),
    temperatureC: regionClimate(lat).base,
    humidityPct: 60,
    irradianceWm2: 0,
    windSpeedMs: 2,
    cloudCoverPct: 40,
    isForecast: false,
    dataSource: 'synthetic',
    lat,
    lon,
  };
}

/** Resolve lat/lon for a region code (falls back to Mumbai). */
export function coordsForRegion(region: string): { lat: number; lon: number } {
  const centroid = REGION_CENTROIDS[region];
  if (centroid) return { lat: centroid.lat, lon: centroid.lon };
  return { lat: 19.076, lon: 72.8777 };
}

/**
 * Load the committed offline fallback pack from `data/cache`.
 * Reads `grid_ci_fallback.json` and `weather_fallback.json` when present and
 * merges them into the synthetic models. Safe to call when files are missing.
 */
export async function loadFallbackPack(cacheDir: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const read = async (name: string) => {
      try {
        const raw = await fs.readFile(path.join(cacheDir, name), 'utf-8');
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    };
    const [carbon, weather] = await Promise.all([read('grid_ci_fallback.json'), read('weather_fallback.json')]);
    if (!carbon && !weather) return false;
    applyFallbackPack({
      carbon: (carbon as { regions?: Record<string, RegionCiProfile> }) ?? undefined,
      weather: (weather as { regions?: Record<string, RegionClimateProfile> }) ?? undefined,
    });
    return true;
  } catch {
    return false;
  }
}
