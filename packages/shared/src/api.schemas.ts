// Zod schemas validate incoming requests and document the shared REST payload shapes.
import { z } from "zod";

export const facilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().min(1),
  type: z.string().min(1)
});

export const timeSeriesPointSchema = z.object({
  ts: z.string().datetime(),
  powerKw: z.number().min(50).max(300),
  emissionsKg: z.number().nonnegative()
});

export const facilityTimeseriesResponseSchema = z.object({
  points: z.array(timeSeriesPointSchema).max(672)
});

export const facilityTimeseriesQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  res: z.enum(["15m", "1h"]).default("15m")
}).refine((query) => {
  if (!query.from || !query.to) return true;
  const duration = Date.parse(query.to) - Date.parse(query.from);
  return duration > 0 && duration <= 7 * 24 * 60 * 60_000;
}, {
  message: "from must be earlier than to and the range cannot exceed 7 days",
  path: ["to"]
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
  services: z.record(z.string())
});

export const carbonIntensityQuerySchema = z.object({
  region: z.string().trim().min(2).max(80)
});
export const carbonIntensityResponseSchema = z.object({
  ci: z.number().min(200).max(800),
  forecast24h: z.array(z.number().min(200).max(800)).length(96),
  source: z.literal("mock")
});

export const weatherQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180)
});
export const weatherResponseSchema = z.object({
  temp: z.number().min(15).max(35),
  humidity: z.number().min(0).max(100),
  forecast: z.array(z.object({
    ts: z.string().datetime(),
    temp: z.number().min(15).max(35)
  })).length(24),
  source: z.literal("mock")
});

export const facilityIdParamsSchema = z.object({ id: z.string().min(1) });
export const explainQuerySchema = z.object({ ts: z.string().datetime().optional() });
export const explainResponseSchema = z.object({
  topDrivers: z.array(z.object({
    feature: z.string().min(1),
    "contribution%": z.number().min(0).max(100)
  })),
  source: z.literal("mock")
});

export const forecastPointSchema = z.object({
  ts: z.string().datetime(),
  powerKw: z.number().min(50).max(300),
  lowKw: z.number().min(50).max(300),
  highKw: z.number().min(50).max(300)
});
export const forecastResponseSchema = z.object({
  forecast: z.array(forecastPointSchema).length(96),
  confidence: z.number().min(0).max(1),
  source: z.literal("mock")
});

export const twinSimulationRequestSchema = z.object({
  facilityId: z.string().min(1),
  throttleProfile: z.array(z.number().min(0).max(100)).length(96).optional(),
  setpoint: z.number().min(18).max(30).default(23),
  window: z.number().int().min(1).max(96).default(96)
});
export const twinSimulationResponseSchema = z.object({
  tempCurve: z.array(z.number().min(15).max(35)).length(96),
  comfortViolations: z.number().int().nonnegative(),
  source: z.literal("mock")
});

export const scenarioRunRequestSchema = z.object({
  facilityId: z.string().min(1),
  levers: z.array(z.object({
    type: z.string().min(1),
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({})
  })).default([])
});
export const scenarioRunResponseSchema = z.object({
  kpis: z.object({
    kwhSaved: z.number().nonnegative(),
    tco2eAvoided: z.number().nonnegative(),
    cost: z.number(),
    capex: z.number().nonnegative(),
    payback: z.number().nonnegative(),
    abatementCost: z.number()
  }),
  series: z.object({
    baseline: z.array(z.number()),
    scenario: z.array(z.number()),
    tempIn: z.array(z.number())
  }),
  source: z.literal("mock")
});

export const maccResponseSchema = z.object({
  levers: z.array(z.object({
    name: z.string().min(1),
    tco2eAvoided: z.number().nonnegative(),
    "$/tco2e": z.number(),
    roi: z.number()
  })),
  source: z.literal("mock")
});

export const optimizeScheduleRequestSchema = z.object({
  facilityId: z.string().min(1),
  region: z.string().trim().min(2).max(80).optional(),
  comfortMin: z.number().min(15).max(35).default(21),
  comfortMax: z.number().min(15).max(35).default(26)
}).refine((value) => value.comfortMin < value.comfortMax, {
  message: "comfortMin must be less than comfortMax"
});
export const optimizationResponseSchema = z.object({
  schedule: z.array(z.object({
    ts: z.string().datetime(),
    hvacPct: z.number().min(0).max(100)
  })).length(96),
  savings: z.number().nonnegative(),
  source: z.literal("mock")
});

export const esgReportRequestSchema = z.object({
  facilityId: z.string().min(1),
  period: z.enum(["month", "quarter", "year"]).default("year")
});
export const esgReportResponseSchema = z.object({
  reportId: z.string().min(1),
  downloadUrl: z.string().url(),
  status: z.literal("ready"),
  source: z.literal("mock")
});

export const impactQuerySchema = z.object({
  tco2e: z.coerce.number().min(0).max(1_000_000)
});
export const impactResponseSchema = z.object({
  trees: z.number().nonnegative(),
  km: z.number().nonnegative(),
  homes: z.number().nonnegative(),
  source: z.literal("mock")
});

export const copilotAskRequestSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  facilityId: z.string().min(1).optional()
});
export const copilotAskResponseSchema = z.object({
  answer: z.string().min(1),
  derivedFrom: z.array(z.string()),
  source: z.literal("mock")
});
