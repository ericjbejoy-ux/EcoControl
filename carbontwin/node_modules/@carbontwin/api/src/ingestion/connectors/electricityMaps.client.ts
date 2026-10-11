/**
 * Electricity Maps v3 client (FR-3).
 * Free-tier friendly. Returns raw, normalised samples; the caller decides on
 * caching / fallback. All failures throw so the orchestrator can fall back.
 */

import { API_ENDPOINTS, type CarbonIntensityPoint } from '@carbontwin/shared';
import { fetchJson, withQuery } from './http.js';

export interface ElectricityMapsOptions {
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface LatestResponse {
  zone?: string;
  carbonIntensity?: number;
  datetime?: string;
  updatedAt?: string;
  isEstimated?: boolean;
}

interface HistoryResponse {
  zone?: string;
  history?: Array<{ carbonIntensity?: number; datetime?: string }>;
}

function normaliseZone(region: string): string {
  // Electricity Maps uses its own zone ids (e.g. "IN-MH", "US-CAL-CISO").
  return region.toUpperCase().replace('_', '-');
}

export async function fetchElectricityMapsLatest(
  region: string,
  options: ElectricityMapsOptions
): Promise<CarbonIntensityPoint> {
  const url = withQuery(`${API_ENDPOINTS.electricityMaps.base}${API_ENDPOINTS.electricityMaps.carbonIntensity}`, {
    zone: normaliseZone(region),
  });
  const json = await fetchJson<LatestResponse>(url, {
    timeoutMs: options.timeoutMs,
    headers: { 'auth-token': options.token },
    fetchImpl: options.fetchImpl,
  });
  if (typeof json.carbonIntensity !== 'number') {
    throw new Error('Electricity Maps response did not contain a carbonIntensity value.');
  }
  return {
    timestamp: json.datetime ?? new Date().toISOString(),
    carbonIntensity: json.carbonIntensity,
    isForecast: false,
    dataSource: 'live',
    region,
  };
}

export async function fetchElectricityMapsHistory(
  region: string,
  options: ElectricityMapsOptions
): Promise<CarbonIntensityPoint[]> {
  const url = withQuery(`${API_ENDPOINTS.electricityMaps.base}${API_ENDPOINTS.electricityMaps.carbonIntensityHistory}`, {
    zone: normaliseZone(region),
  });
  const json = await fetchJson<HistoryResponse>(url, {
    timeoutMs: options.timeoutMs,
    headers: { 'auth-token': options.token },
    fetchImpl: options.fetchImpl,
  });
  const history = json.history ?? [];
  return history
    .filter((p) => typeof p.carbonIntensity === 'number' && typeof p.datetime === 'string')
    .map((p) => ({
      timestamp: p.datetime as string,
      carbonIntensity: p.carbonIntensity as number,
      isForecast: false,
      dataSource: 'live' as const,
      region,
    }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
