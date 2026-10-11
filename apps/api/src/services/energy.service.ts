// Energy and weather services generate bounded forecasts at documented time intervals.
import {
  alignedQuarterHourStart,
  carbonIntensity,
  clamp,
  facilityPower,
  facilities,
  indoorTemperature,
  mockSource,
  quarterHourTimestamp
} from "../mock/mockData.js";

export function getCarbonIntensity(region: string) {
  const phase = [...region].reduce((total, character) => total + character.charCodeAt(0), 0) % 24;
  return {
    ci: carbonIntensity(0, phase),
    forecast24h: Array.from({ length: 96 }, (_, index) => carbonIntensity(index, phase)),
    source: mockSource
  };
}

export function getWeather(lat: number, lon: number) {
  const seed = Math.abs(Math.round(lat * 7 + lon * 3)) % 11;
  return {
    temp: Math.round(clamp(22 + seed * 0.6, 15, 35) * 10) / 10,
    humidity: 48 + seed * 2,
    forecast: Array.from({ length: 24 }, (_, hour) => ({
      ts: new Date(Date.now() + hour * 60 * 60_000).toISOString(),
      temp: Math.round(clamp(21 + seed * 0.5 + 3 * Math.sin((hour / 24) * Math.PI * 2), 15, 35) * 10) / 10
    })),
    source: mockSource
  };
}

export function getFacilityForecast(facilityId: string) {
  const facilityIndex = facilities.findIndex((facility) => facility.id === facilityId);
  if (facilityIndex < 0) return undefined;
  const start = alignedQuarterHourStart();
  return {
    forecast: Array.from({ length: 96 }, (_, index) => {
      const powerKw = facilityPower(index, facilityIndex);
      return {
        ts: quarterHourTimestamp(index, start),
        powerKw,
        lowKw: Math.round(clamp(powerKw * 0.9, 50, 300) * 10) / 10,
        highKw: Math.round(clamp(powerKw * 1.1, 50, 300) * 10) / 10
      };
    }),
    confidence: 0.91,
    source: mockSource
  };
}

export function explainFacility(facilityId: string, ts?: string) {
  const facilityIndex = facilities.findIndex((facility) => facility.id === facilityId);
  if (facilityIndex < 0) return undefined;
  const hour = ts ? new Date(ts).getUTCHours() : new Date().getUTCHours();
  const weatherContribution = hour >= 12 && hour <= 18 ? 38 : 24;
  return {
    topDrivers: [
      { feature: "Outdoor temperature", "contribution%": weatherContribution },
      { feature: "Grid carbon intensity", "contribution%": 29 },
      { feature: "Occupancy and operating hours", "contribution%": 21 },
      { feature: "Historical load pattern", "contribution%": 100 - weatherContribution - 50 }
    ],
    source: mockSource
  };
}

export function getBasePowerSeries(facilityId: string) {
  const facilityIndex = facilities.findIndex((facility) => facility.id === facilityId);
  if (facilityIndex < 0) return undefined;
  return Array.from({ length: 96 }, (_, index) => facilityPower(index, facilityIndex));
}

export function getTemperatureSeries(setpoint = 23) {
  return Array.from({ length: 96 }, (_, index) => indoorTemperature(index, setpoint));
}
