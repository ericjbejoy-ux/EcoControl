// Facility services create aligned, physically plausible mock readings.
import { alignedQuarterHourStart, facilities, facilityPower, carbonIntensity, quarterHourTimestamp } from "../mock/mockData.js";

export function listFacilities() {
  return facilities;
}

export function getFacilityIndex(id: string): number {
  return facilities.findIndex((facility) => facility.id === id);
}

export function getFacilityTimeseries(
  id: string,
  query: { from?: string | undefined; to?: string | undefined; res: "15m" | "1h" }
) {
  const facilityIndex = getFacilityIndex(id);
  if (facilityIndex < 0) return undefined;

  const stepMinutes = query.res === "1h" ? 60 : 15;
  const stepMs = stepMinutes * 60_000;
  const defaultStart = alignedQuarterHourStart();
  const fromMs = query.from ? Date.parse(query.from) : defaultStart.getTime();
  const toMs = query.to ? Date.parse(query.to) : fromMs + 24 * 60 * 60_000;
  const startMs = Math.ceil(fromMs / stepMs) * stepMs;
  const count = Math.max(0, Math.ceil((toMs - startMs) / stepMs));
  const points = Array.from({ length: count }, (_, index) => {
    const ts = new Date(startMs + index * stepMs);
    const slot = Math.floor((ts.getUTCHours() * 60 + ts.getUTCMinutes()) / 15);
    const powerKw = facilityPower(slot, facilityIndex);
    const emissionsKg = powerKw * stepMinutes / 60 * carbonIntensity(slot, facilityIndex * 5) / 1000;
    return { ts: ts.toISOString(), powerKw, emissionsKg: Math.round(emissionsKg * 1000) / 1000 };
  });
  return { points };
}
