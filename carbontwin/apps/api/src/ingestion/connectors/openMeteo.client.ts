/**
 * Open-Meteo client (FR-4). No API key required — the primary weather source.
 * Returns historical + current + forecast points normalised to `WeatherPoint`.
 */

import { API_ENDPOINTS, type WeatherPoint } from '@carbontwin/shared';
import { fetchJson, withQuery } from './http.js';
import { round } from '../utils/stats.js';

export interface OpenMeteoOptions {
  timezone?: string;
  pastDays?: number;
  forecastDays?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone?: string;
  utc_offset_seconds?: number;
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    shortwave_radiation?: number[];
    wind_speed_10m?: number[];
    cloud_cover?: number[];
  };
}

/**
 * Open-Meteo returns naive local times (in the requested timezone). We request
 * `timezone=UTC` from callers so the timestamps are directly ISO-comparable.
 */
export async function fetchOpenMeteo(
  lat: number,
  lon: number,
  options: OpenMeteoOptions = {}
): Promise<WeatherPoint[]> {
  const {
    timezone = 'UTC',
    pastDays = 2,
    forecastDays = 3,
    timeoutMs,
    fetchImpl,
  } = options;

  const url = withQuery(`${API_ENDPOINTS.openMeteo.base}${API_ENDPOINTS.openMeteo.forecast}`, {
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,relative_humidity_2m,shortwave_radiation,wind_speed_10m,cloud_cover',
    timezone,
    past_days: pastDays,
    forecast_days: forecastDays,
    wind_speed_unit: 'ms',
  });

  const json = await fetchJson<OpenMeteoResponse>(url, { timeoutMs, fetchImpl });
  const hourly = json.hourly;
  if (!hourly?.time || hourly.time.length === 0) {
    throw new Error('Open-Meteo response contained no hourly data.');
  }

  const out: WeatherPoint[] = [];
  const now = Date.now();
  for (let i = 0; i < hourly.time.length; i++) {
    const time = hourly.time[i];
    if (!time) continue;
    // Timezone requested is UTC, so treat the naive time as UTC.
    const iso = time.length === 16 ? `${time}:00Z` : `${time}Z`;
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) continue;
    out.push({
      timestamp: new Date(ts).toISOString(),
      temperatureC: num(hourly.temperature_2m?.[i], 20),
      humidityPct: clamp(num(hourly.relative_humidity_2m?.[i], 60), 0, 100),
      irradianceWm2: Math.max(0, num(hourly.shortwave_radiation?.[i], 0)),
      windSpeedMs: Math.max(0, num(hourly.wind_speed_10m?.[i], 0)),
      cloudCoverPct: clamp(num(hourly.cloud_cover?.[i], 0), 0, 100),
      isForecast: ts > now,
      dataSource: 'live',
      lat: json.latitude ?? lat,
      lon: json.longitude ?? lon,
    });
  }
  return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? round(value, 2) : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
