// Operations services cover schedule optimization and simple mock integrations.
import { facilities, mockSource, quarterHourTimestamp } from "../mock/mockData.js";
import { getBasePowerSeries } from "./energy.service.js";

export function optimizeSchedule(facilityId: string) {
  const power = getBasePowerSeries(facilityId);
  if (!power || !facilities.some((facility) => facility.id === facilityId)) return undefined;
  const schedule = power.map((_, index) => ({
    ts: quarterHourTimestamp(index),
    hvacPct: index >= 64 && index <= 80 ? 72 : index >= 20 && index <= 32 ? 94 : 85
  }));
  return { schedule, savings: 18.6, source: mockSource };
}

export function generateEsgReport(facilityId: string, period: "month" | "quarter" | "year") {
  if (!facilities.some((facility) => facility.id === facilityId)) return undefined;
  const reportId = `mock-esg-${period}-${Date.now().toString(36)}`;
  return {
    reportId,
    downloadUrl: `https://example.invalid/mock/reports/${reportId}.pdf`,
    status: "ready" as const,
    source: mockSource
  };
}

export function getImpactEquivalents(tco2e: number) {
  return {
    trees: Math.round(tco2e * 16.5),
    km: Math.round(tco2e * 4_000),
    homes: Math.round(tco2e / 7.5 * 10) / 10,
    source: mockSource
  };
}

export function askCopilot(question: string, facilityId?: string) {
  const facility = facilities.find((item) => item.id === facilityId);
  return {
    answer: facility
      ? `For ${facility.name}, the mock twin recommends shifting flexible HVAC load toward lower-carbon hours while keeping indoor temperatures within 21-26 °C.`
      : "The mock twin recommends prioritizing HVAC optimization and load shifting, then validating comfort and savings against facility meter data.",
    derivedFrom: ["mock facility telemetry", "mock grid carbon forecast", "mock scenario analysis"],
    source: mockSource
  };
}
