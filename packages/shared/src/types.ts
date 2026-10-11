// Shared API contracts are inferred from the Zod schemas in api.schemas.ts.
import type { z } from "zod";
import type {
  carbonIntensityResponseSchema,
  copilotAskResponseSchema,
  esgReportResponseSchema,
  facilitySchema,
  facilityTimeseriesQuerySchema,
  facilityTimeseriesResponseSchema,
  forecastResponseSchema,
  healthResponseSchema,
  impactResponseSchema,
  maccResponseSchema,
  optimizationResponseSchema,
  scenarioRunResponseSchema,
  twinSimulationResponseSchema,
  weatherResponseSchema
} from "./api.schemas.js";

export type Facility = z.infer<typeof facilitySchema>;
export type FacilityTimeseriesQuery = z.infer<typeof facilityTimeseriesQuerySchema>;
export type FacilityTimeseriesResponse = z.infer<typeof facilityTimeseriesResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type CarbonIntensityResponse = z.infer<typeof carbonIntensityResponseSchema>;
export type WeatherResponse = z.infer<typeof weatherResponseSchema>;
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;
export type TwinSimulationResponse = z.infer<typeof twinSimulationResponseSchema>;
export type ScenarioRunResponse = z.infer<typeof scenarioRunResponseSchema>;
export type MaccResponse = z.infer<typeof maccResponseSchema>;
export type OptimizationResponse = z.infer<typeof optimizationResponseSchema>;
export type EsgReportResponse = z.infer<typeof esgReportResponseSchema>;
export type ImpactResponse = z.infer<typeof impactResponseSchema>;
export type CopilotAskResponse = z.infer<typeof copilotAskResponseSchema>;
