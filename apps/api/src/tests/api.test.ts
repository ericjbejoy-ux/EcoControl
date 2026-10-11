// API tests assert route contracts, 96-step alignment, and invalid-input behavior.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  carbonIntensityResponseSchema,
  copilotAskResponseSchema,
  esgReportResponseSchema,
  explainResponseSchema,
  facilitySchema,
  facilityTimeseriesResponseSchema,
  forecastResponseSchema,
  healthResponseSchema,
  impactResponseSchema,
  maccResponseSchema,
  optimizationResponseSchema,
  scenarioRunResponseSchema,
  twinSimulationResponseSchema,
  weatherResponseSchema
} from "../../../../packages/shared/src/api.schemas.js";
import { buildApp } from "../app.js";

describe("CarbonTwin mock API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("returns health and demo facilities", async () => {
    const health = await app.inject("/api/v1/health");
    const facilities = await app.inject("/api/v1/facilities");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", services: { api: "ok" } });
    expect(facilities.json()).toHaveLength(4);
  });

  it("returns aligned, bounded facility readings", async () => {
    const response = await app.inject("/api/v1/facilities/office-tower-01/timeseries");
    const points = response.json().points as Array<{ ts: string; powerKw: number }>;
    expect(response.statusCode).toBe(200);
    expect(points).toHaveLength(96);
    expect(points.every((point) => point.powerKw >= 50 && point.powerKw <= 300)).toBe(true);
    expect(points.every((point, index) => index === 0 || Date.parse(point.ts) - Date.parse(points[index - 1]!.ts) === 900_000)).toBe(true);
  });

  it("supports filtered time ranges and hourly resolution", async () => {
    const hourly = await app.inject("/api/v1/facilities/office-tower-01/timeseries?from=2026-10-09T00:00:00.000Z&to=2026-10-09T06:00:00.000Z&res=1h");
    const halfDay = await app.inject("/api/v1/facilities/office-tower-01/timeseries?from=2026-10-09T00:00:00.000Z&to=2026-10-09T06:00:00.000Z");
    const reversed = await app.inject("/api/v1/facilities/office-tower-01/timeseries?from=2026-10-09T06:00:00.000Z&to=2026-10-09T00:00:00.000Z");
    expect(hourly.statusCode).toBe(200);
    expect(hourly.json().points).toHaveLength(6);
    expect(halfDay.json().points).toHaveLength(24);
    expect(reversed.statusCode).toBe(400);
  });

  it("serves the forecast, carbon, and weather contracts", async () => {
    const forecast = await app.inject("/api/v1/facilities/office-tower-01/forecast");
    const carbon = await app.inject("/api/v1/carbon/intensity?region=US-CAL-CISO");
    const weather = await app.inject("/api/v1/weather?lat=37.77&lon=-122.42");
    expect(forecast.json().forecast).toHaveLength(96);
    expect(carbon.json().forecast24h).toHaveLength(96);
    expect(carbon.json().ci).toBeGreaterThanOrEqual(200);
    expect(carbon.json().ci).toBeLessThanOrEqual(800);
    expect(weather.json().forecast).toHaveLength(24);
  });

  it("validates request input and reports missing facilities", async () => {
    const invalid = await app.inject("/api/v1/weather?lat=100&lon=0");
    const missing = await app.inject("/api/v1/facilities/not-a-facility/timeseries");
    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
  });

  it("returns all requested mock workflows", async () => {
    const routes = [
      { method: "GET" as const, url: "/api/v1/health", schema: healthResponseSchema },
      { method: "GET" as const, url: "/api/v1/facilities", schema: facilitySchema.array() },
      { method: "GET" as const, url: "/api/v1/facilities/office-tower-01/timeseries", schema: facilityTimeseriesResponseSchema },
      { method: "GET" as const, url: "/api/v1/facilities/office-tower-01/forecast", schema: forecastResponseSchema },
      { method: "GET" as const, url: "/api/v1/facilities/office-tower-01/explain", schema: explainResponseSchema },
      { method: "GET" as const, url: "/api/v1/carbon/intensity?region=US-CAL-CISO", schema: carbonIntensityResponseSchema },
      { method: "GET" as const, url: "/api/v1/weather?lat=37.77&lon=-122.42", schema: weatherResponseSchema },
      { method: "POST" as const, url: "/api/v1/twin/simulate", payload: { facilityId: "office-tower-01" }, schema: twinSimulationResponseSchema },
      { method: "POST" as const, url: "/api/v1/scenarios/run", payload: { facilityId: "office-tower-01" }, schema: scenarioRunResponseSchema },
      { method: "GET" as const, url: "/api/v1/scenarios/macc", schema: maccResponseSchema },
      { method: "POST" as const, url: "/api/v1/optimize/schedule", payload: { facilityId: "office-tower-01" }, schema: optimizationResponseSchema },
      { method: "POST" as const, url: "/api/v1/reports/esg", payload: { facilityId: "office-tower-01" }, schema: esgReportResponseSchema },
      { method: "GET" as const, url: "/api/v1/impact/equivalents?tco2e=25", schema: impactResponseSchema },
      { method: "POST" as const, url: "/api/v1/copilot/ask", payload: { question: "How can I lower emissions?" }, schema: copilotAskResponseSchema }
    ];
    for (const route of routes) {
      const request = route.payload
        ? { method: route.method, url: route.url, payload: route.payload }
        : { method: route.method, url: route.url };
      const response = await app.inject(request);
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(200);
      expect(route.schema.safeParse(response.json()).success, `${route.method} ${route.url} response contract`).toBe(true);
    }
  });
});
