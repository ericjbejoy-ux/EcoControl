/**
 * CO2 Signal client (FR-3).
 * Lightweight alternative to Electricity Maps; keyed by country code.
 */

import { API_ENDPOINTS, type CarbonIntensityPoint } from '@carbontwin/shared';
import { fetchJson, withQuery } from './http.js';

export interface Co2SignalOptions {
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface LatestResponse {
  data?: { carbonIntensity?: number; datetime?: string; fossilFuelPercentage?: number };
  carbonIntensity?: number;
  datetime?: string;
}

/** CO2 Signal expects ISO-3166 alpha-2 codes; derive from a RegionCode ("IN-MH" → "IN"). */
export function countryCodeFromRegion(region: string): string {
  const part = region.split(/[-_]/)[0];
  return (part ?? region).toUpperCase().slice(0, 2);
}

export async function fetchCo2SignalLatest(
  region: string,
  options: Co2SignalOptions
): Promise<CarbonIntensityPoint> {
  const url = withQuery(`${API_ENDPOINTS.co2signal.base}${API_ENDPOINTS.co2signal.latest}`, {
    countryCode: countryCodeFromRegion(region),
  });
  const json = await fetchJson<LatestResponse>(url, {
    timeoutMs: options.timeoutMs,
    headers: { 'auth-token': options.token },
    fetchImpl: options.fetchImpl,
  });
  const value = json.data?.carbonIntensity ?? json.carbonIntensity;
  if (typeof value !== 'number') {
    throw new Error('CO2 Signal response did not contain a carbonIntensity value.');
  }
  return {
    timestamp: json.data?.datetime ?? json.datetime ?? new Date().toISOString(),
    carbonIntensity: value,
    isForecast: false,
    dataSource: 'live',
    region,
  };
}
