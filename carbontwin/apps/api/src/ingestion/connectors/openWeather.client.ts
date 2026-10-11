/**
 * OpenWeather client (FR-4) — secondary weather source when a key is configured.
 * Irradiance is not provided by OpenWeather, so it is estimated from solar
 * geometry and the reported cloud cover.
 */

import { API_ENDPOINTS, type WeatherPoint } from '@carbontwin/shared';
import { fetchJson, withQuery } from './http.js';
import { clearSkyIrradiance } from './fallbackProvider.js';
import { round } from '../utils/stats.js';

export interface OpenWeatherOptions {
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface CurrentResponse {
  coord?: { lat: number; lon: number };
  dt?: number;
  main?: { temp?: number; humidity?: number };
  wind?: { speed?: number };
  clouds?: { all?: number };
}

interface ForecastResponse {
  city?: { coord?: { lat: number; lon: number } };
  list?: Array<{
    dt?: number;
    main?: { temp?: number; humidity?: number };
    wind?: { speed?: number };
    clouds?: { all?: number };
  }>;
}

function toPoint(
  entry: { dt?: number; main?: { temp?: number; humidity?: number }; wind?: { speed?: number }; clouds?: { all?: number } },
  lat: number,
  lon: number
): WeatherPoint | null {
  if (typeof entry.dt !== 'number') return null;
  const at = new Date(entry.dt * 1000);
  const cloudCover = entry.clouds?.all ?? 30;
  const irradiance = clearSkyIrradiance(lat, lon, at) * (1 - 0.75 * (cloudCover / 100));
  return {
    timestamp: at.toISOString(),
    temperatureC: round(entry.main?.temp ?? 20, 2),
    humidityPct: Math.max(0, Math.min(100, entry.main?.humidity ?? 60)),
    irradianceWm2: round(Math.max(0, irradiance), 1),
    windSpeedMs: entry.wind?.speed !== undefined ? round(entry.wind.speed, 2) : undefined,
    cloudCoverPct: cloudCover,
    isForecast: at.getTime() > Date.now(),
    dataSource: 'live',
    lat,
    lon,
  };
}

export async function fetchOpenWeather(
  lat: number,
  lon: number,
  options: OpenWeatherOptions
): Promise<WeatherPoint[]> {
  const base = `${API_ENDPOINTS.openWeather.base}`;
  const currentUrl = withQuery(`${base}${API_ENDPOINTS.openWeather.current}`, {
    lat,
    lon,
    appid: options.token,
    units: 'metric',
  });
  const forecastUrl = withQuery(`${base}${API_ENDPOINTS.openWeather.forecast}`, {
    lat,
    lon,
    appid: options.token,
    units: 'metric',
  });

  const [current, forecast] = await Promise.all([
    fetchJson<CurrentResponse>(currentUrl, { timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl }),
    fetchJson<ForecastResponse>(forecastUrl, { timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl }).catch(
      () => ({ list: [] }) as ForecastResponse
    ),
  ]);

  const pts: WeatherPoint[] = [];
  const resolvedLat = current.coord?.lat ?? forecast.city?.coord?.lat ?? lat;
  const resolvedLon = current.coord?.lon ?? forecast.city?.coord?.lon ?? lon;

  const currentPoint = toPoint(current, resolvedLat, resolvedLon);
  if (currentPoint) pts.push(currentPoint);
  for (const entry of forecast.list ?? []) {
    const point = toPoint(entry, resolvedLat, resolvedLon);
    if (point) pts.push(point);
  }

  const seen = new Set<string>();
  return pts
    .filter((p) => {
      if (seen.has(p.timestamp)) return false;
      seen.add(p.timestamp);
      return true;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
