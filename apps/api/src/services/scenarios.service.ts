// Scenario and MACC services provide plausible annualized economics for demo flows.
import { facilities, mockSource } from "../mock/mockData.js";
import { getBasePowerSeries, getTemperatureSeries } from "./energy.service.js";

export function runScenario(facilityId: string) {
  if (!facilities.some((facility) => facility.id === facilityId)) return undefined;
  const baseline = getBasePowerSeries(facilityId);
  if (!baseline) return undefined;
  const scenario = baseline.map((power, index) => Math.round(power * (0.84 + (index % 8) * 0.002) * 10) / 10);
  return {
    kpis: {
      kwhSaved: 412_300,
      tco2eAvoided: 186.4,
      cost: 51_200,
      capex: 240_000,
      payback: 4.7,
      abatementCost: -38.2
    },
    series: { baseline, scenario, tempIn: getTemperatureSeries() },
    source: mockSource
  };
}

export function getMarginalAbatementCurve() {
  return {
    levers: [
      { name: "HVAC optimization", tco2eAvoided: 72.5, "$/tco2e": -118, roi: 0.31 },
      { name: "Load shifting", tco2eAvoided: 41.2, "$/tco2e": -54, roi: 0.22 },
      { name: "Rooftop solar", tco2eAvoided: 186.4, "$/tco2e": 38, roi: 0.16 },
      { name: "Battery storage", tco2eAvoided: 94.1, "$/tco2e": 126, roi: 0.09 }
    ],
    source: mockSource
  };
}
