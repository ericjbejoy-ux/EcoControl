/**
 * CarbonTwin ML service contract — TypeScript/zod mirror of
 * `services/ml/app/schemas.py` (owner: M1, reviewer: M3).
 *
 * Keep both files in lock-step. Bump `ML_CONTRACT_VERSION` here and in the
 * Python `CONTRACT_VERSION` together, and note it in `docs/api.md`.
 */
import { z } from "zod";

export const ML_CONTRACT_VERSION = "2.0.0" as const;

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const leverTypeSchema = z.enum([
  "hvac_peak_shaving",
  "load_shifting",
  "rooftop_solar",
  "setpoint_relaxation",
  "retrofit",
  "battery",
]);
export type LeverType = z.infer<typeof leverTypeSchema>;

export const dataSourceSchema = z.enum(["live", "cached", "synthetic"]);
export type DataSource = z.infer<typeof dataSourceSchema>;

export const seriesPointSchema = z.object({
  ts: z.coerce.date(),
  power_kw: z.number().nonnegative(),
  temp_out: z.number().nullable().optional(),
  temp_in: z.number().nullable().optional(),
  humidity: z.number().nullable().optional(),
  irradiance: z.number().nullable().optional(),
  ci: z.number().nullable().optional(),
  occupancy: z.number().nullable().optional(),
});
export type SeriesPoint = z.infer<typeof seriesPointSchema>;

export const twinParamsSchema = z.object({
  r_envelope: z.number().positive().default(0.05),
  c_thermal: z.number().positive().default(120.0),
  cop_a: z.number().default(4.4),
  cop_b: z.number().nonnegative().default(0.06),
  window_factor: z.number().nonnegative().default(0.35),
  internal_gain_kw: z.number().nonnegative().default(30.0),
  hvac_rated_kw: z.number().positive().default(100.0),
  solar_aperture_m2: z.number().nonnegative().default(400.0),
  occupancy_gain_kw: z.number().nonnegative().default(40.0),
  floors: z.number().int().positive().default(1),
});
export type TwinParams = z.infer<typeof twinParamsSchema>;

export const comfortBandSchema = z
  .object({ min_c: z.number().default(22.0), max_c: z.number().default(26.0) })
  .refine((b) => b.max_c >= b.min_c, { message: "comfort band max_c must be >= min_c" });
export type ComfortBand = z.infer<typeof comfortBandSchema>;

export const modelMetricsSchema = z.object({
  mae: z.number().nullable().optional(),
  rmse: z.number().nullable().optional(),
  mape: z.number().nullable().optional(),
  r2: z.number().nullable().optional(),
  coverage_p10_p90: z.number().nullable().optional(),
});
export type ModelMetrics = z.infer<typeof modelMetricsSchema>;

/* ------------------------------------------------------------------ */
/* /ml/train  +  /ml/model-card/:facilityId                            */
/* ------------------------------------------------------------------ */

export const modelTypeSchema = z.enum([
  "office",
  "hospital",
  "campus",
  "data_center",
  "generic",
]);
export type ModelType = z.infer<typeof modelTypeSchema>;

export const trainRequestSchema = z.object({
  facility_id: z.string(),
  history: z.array(seriesPointSchema),
  model_type: modelTypeSchema.default("generic"),
  horizon: z.number().int().min(4).max(672).default(96),
  test_fraction: z.number().gt(0.05).lt(0.5).default(0.2),
});
export type TrainRequest = z.infer<typeof trainRequestSchema>;

export const trainResponseSchema = z.object({
  facility_id: z.string(),
  status: z.enum(["trained", "trained_fallback", "insufficient_data"]),
  backend: z.string(),
  n_samples: z.number().int(),
  horizon: z.number().int(),
  metrics: modelMetricsSchema,
  model_version: z.string(),
  trained_at: z.coerce.date(),
  top_features: z.array(z.string()).default([]),
});
export type TrainResponse = z.infer<typeof trainResponseSchema>;

export const modelCardResponseSchema = z.object({
  facility_id: z.string(),
  exists: z.boolean(),
  model_version: z.string().nullable().optional(),
  backend: z.string().nullable().optional(),
  model_type: z.string().nullable().optional(),
  trained_at: z.coerce.date().nullable().optional(),
  n_samples: z.number().int().nullable().optional(),
  horizon: z.number().int().nullable().optional(),
  metrics: modelMetricsSchema.nullable().optional(),
  features: z.array(z.string()).default([]),
  feature_groups: z.record(z.array(z.string())).default({}),
  training_window: z.record(z.string().nullable()).nullable().optional(),
  target: z.string().nullable().optional(),
  notes: z.array(z.string()).default([]),
  model_card: z.record(z.unknown()).default({}),
});
export type ModelCardResponse = z.infer<typeof modelCardResponseSchema>;

/* ------------------------------------------------------------------ */
/* /ml/forecast                                                        */
/* ------------------------------------------------------------------ */

export const forecastRequestSchema = z.object({
  facility_id: z.string(),
  history: z.array(seriesPointSchema),
  future_weather: z.array(seriesPointSchema).default([]),
  horizon: z.number().int().min(1).max(672).default(96),
  step_minutes: z.number().int().min(1).max(60).default(15),
  train_if_missing: z.boolean().default(true),
  model_type: modelTypeSchema.default("generic"),
});
export type ForecastRequest = z.infer<typeof forecastRequestSchema>;

export const forecastPointSchema = z.object({
  ts: z.coerce.date(),
  power_kw_p10: z.number(),
  power_kw_p50: z.number(),
  power_kw_p90: z.number(),
  emissions_kg_p10: z.number().nullable().optional(),
  emissions_kg_p50: z.number().nullable().optional(),
  emissions_kg_p90: z.number().nullable().optional(),
  ci: z.number().nullable().optional(),
  temp_out: z.number().nullable().optional(),
});
export type ForecastPoint = z.infer<typeof forecastPointSchema>;

export const forecastResponseSchema = z.object({
  facility_id: z.string(),
  generated_at: z.coerce.date(),
  horizon: z.number().int(),
  step_minutes: z.number().int(),
  model_version: z.string(),
  backend: z.string(),
  points: z.array(forecastPointSchema),
  metrics: modelMetricsSchema.nullable().optional(),
  data_source: dataSourceSchema.default("synthetic"),
  notes: z.array(z.string()).default([]),
});
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;

/* ------------------------------------------------------------------ */
/* /ml/explain                                                         */
/* ------------------------------------------------------------------ */

export const explainRequestSchema = z.object({
  facility_id: z.string(),
  history: z.array(seriesPointSchema),
  ts: z.coerce.date().nullable().optional(),
  global: z.boolean().default(true),
  top_k: z.number().int().min(1).max(50).default(6),
  model_type: modelTypeSchema.default("generic"),
});
export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const featureContributionSchema = z.object({
  feature: z.string(),
  group: z.string(),
  value: z.number().nullable().optional(),
  shap_value: z.number(),
  abs_value: z.number(),
  pct: z.number(),
  direction: z.enum(["increase", "decrease", "neutral"]),
});
export type FeatureContribution = z.infer<typeof featureContributionSchema>;

export const explainResponseSchema = z.object({
  facility_id: z.string(),
  method: z.string(),
  backend: z.string(),
  base_value: z.number().nullable().optional(),
  predicted_power_kw: z.number().nullable().optional(),
  explained_ts: z.coerce.date().nullable().optional(),
  global_importance: z.array(featureContributionSchema).default([]),
  local: z.array(featureContributionSchema).default([]),
  narrative: z.string().nullable().optional(),
  group_rollup: z.record(z.number()).default({}),
  notes: z.array(z.string()).default([]),
});
export type ExplainResponse = z.infer<typeof explainResponseSchema>;

/* ------------------------------------------------------------------ */
/* /twin/simulate  +  /twin/calibrate                                  */
/* ------------------------------------------------------------------ */

export const twinSimulateRequestSchema = z.object({
  facility_id: z.string().default("sim"),
  initial_temp_in: z.number().default(24.0),
  setpoint_c: z.number().default(23.0),
  horizon: z.number().int().min(1).max(672).default(96),
  step_minutes: z.number().int().min(1).max(60).default(15),
  throttle: z.number().min(0).max(1).default(0.7),
  throttle_profile: z.array(z.number()).default([]),
  outdoor_temp_c: z.number().nullable().optional(),
  outdoor_temp_profile: z.array(z.number()).default([]),
  solar_profile: z.array(z.number()).default([]),
  occupancy_profile: z.array(z.number()).default([]),
  ci_profile: z.array(z.number()).default([]),
  comfort: comfortBandSchema.default({ min_c: 22, max_c: 26 }),
  params: twinParamsSchema.default(twinParamsSchema.parse({})),
  start_ts: z.coerce.date().nullable().optional(),
});
export type TwinSimulateRequest = z.infer<typeof twinSimulateRequestSchema>;

export const twinPointSchema = z.object({
  ts: z.coerce.date().nullable().optional(),
  temp_in: z.number(),
  temp_out: z.number(),
  power_kw: z.number(),
  cop: z.number(),
  cooling_kw: z.number(),
  emissions_kg: z.number(),
  ci: z.number(),
  throttle: z.number(),
  comfort_ok: z.boolean(),
});
export type TwinPoint = z.infer<typeof twinPointSchema>;

export const twinSimulateResponseSchema = z.object({
  facility_id: z.string(),
  step_minutes: z.number().int(),
  comfort: comfortBandSchema,
  points: z.array(twinPointSchema),
  params: twinParamsSchema,
  energy_kwh: z.number(),
  emissions_kg: z.number(),
  min_temp_in: z.number(),
  max_temp_in: z.number(),
  comfort_violation_hours: z.number(),
  interpretation: z.string(),
});
export type TwinSimulateResponse = z.infer<typeof twinSimulateResponseSchema>;

export const calibrateRequestSchema = z.object({
  facility_id: z.string(),
  history: z.array(seriesPointSchema),
  initial_guess: twinParamsSchema.nullable().optional(),
});
export type CalibrateRequest = z.infer<typeof calibrateRequestSchema>;

export const calibrateResponseSchema = z.object({
  facility_id: z.string(),
  status: z.enum(["calibrated", "insufficient_data"]),
  params: twinParamsSchema,
  rmse_c: z.number().nullable().optional(),
  mape_power: z.number().nullable().optional(),
  n_observations: z.number().int(),
  notes: z.array(z.string()).default([]),
});
export type CalibrateResponse = z.infer<typeof calibrateResponseSchema>;

/* ------------------------------------------------------------------ */
/* /optimize                                                           */
/* ------------------------------------------------------------------ */

export const optimizeRequestSchema = z.object({
  facility_id: z.string().default("opt"),
  horizon: z.number().int().min(4).max(672).default(96),
  step_minutes: z.number().int().min(1).max(60).default(15),
  history_power_kw: z.array(z.number()).default([]),
  outdoor_temp_profile: z.array(z.number()).default([]),
  solar_profile: z.array(z.number()).default([]),
  occupancy_profile: z.array(z.number()).default([]),
  ci_profile: z.array(z.number()).default([]),
  comfort: comfortBandSchema.default({ min_c: 22, max_c: 26 }),
  initial_temp_in: z.number().default(24.0),
  throttle_min: z.number().min(0).max(1).default(0.2),
  lambda_comfort: z.number().nonnegative().default(50.0),
  mu_ramp: z.number().nonnegative().default(0.05),
  params: twinParamsSchema.default(twinParamsSchema.parse({})),
  start_ts: z.coerce.date().nullable().optional(),
});
export type OptimizeRequest = z.infer<typeof optimizeRequestSchema>;

export const schedulePointSchema = z.object({
  ts: z.coerce.date().nullable().optional(),
  throttle: z.number(),
  power_kw: z.number(),
  temp_in: z.number(),
  temp_out: z.number(),
  ci: z.number(),
  emissions_kg: z.number(),
  comfort_ok: z.boolean(),
});
export type SchedulePoint = z.infer<typeof schedulePointSchema>;

export const optimizeResponseSchema = z.object({
  facility_id: z.string(),
  solver: z.string(),
  status: z.enum(["optimal", "feasible", "fallback"]),
  schedule: z.array(schedulePointSchema),
  baseline_emissions_kg: z.number(),
  optimized_emissions_kg: z.number(),
  emissions_saved_kg: z.number(),
  emissions_reduction_pct: z.number(),
  baseline_energy_kwh: z.number(),
  optimized_energy_kwh: z.number(),
  comfort_violation_hours: z.number(),
  pre_cool_hour: z.number().int().nullable().optional(),
  cleanest_hour: z.number().int().nullable().optional(),
  narrative: z.string(),
  notes: z.array(z.string()).default([]),
});
export type OptimizeResponse = z.infer<typeof optimizeResponseSchema>;

/* ------------------------------------------------------------------ */
/* /scenario/evaluate  +  /scenario/macc                               */
/* ------------------------------------------------------------------ */

export const leverSchema = z.object({
  type: leverTypeSchema,
  params: z.record(z.unknown()).default({}),
});
export type Lever = z.infer<typeof leverSchema>;

export const scenarioContextSchema = z.object({
  annual_kwh: z.number().nullable().optional(),
  annual_emissions_kg: z.number().nullable().optional(),
  peak_kw: z.number().nullable().optional(),
  tariff_usd_per_kwh: z.number().nullable().optional(),
  ci_g_per_kwh: z.number().nullable().optional(),
  horizon: z.number().int().min(4).max(672).default(96),
  step_minutes: z.number().int().min(1).max(60).default(15),
  history_power_kw: z.array(z.number()).default([]),
  outdoor_temp_profile: z.array(z.number()).default([]),
  solar_profile: z.array(z.number()).default([]),
  occupancy_profile: z.array(z.number()).default([]),
  ci_profile: z.array(z.number()).default([]),
  params: twinParamsSchema.default(twinParamsSchema.parse({})),
});
export type ScenarioContext = z.infer<typeof scenarioContextSchema>;

export const scenarioKPIsSchema = z.object({
  kwh_saved_year: z.number(),
  tco2e_avoided_year: z.number(),
  cost_saved_year: z.number(),
  capex: z.number(),
  payback_years: z.number().nullable().optional(),
  npv: z.number(),
  abatement_cost_per_tco2e: z.number().nullable().optional(),
  comfort_violation_hours: z.number(),
  emissions_reduction_pct: z.number(),
  kwhSavedYear: z.number().optional(),
  tco2eAvoidedYear: z.number().optional(),
  costSavedYear: z.number().optional(),
  paybackYears: z.number().nullable().optional(),
  abatementCostPerTco2e: z.number().nullable().optional(),
});
export type ScenarioKPIs = z.infer<typeof scenarioKPIsSchema>;

export const leverResultSchema = z.object({
  type: leverTypeSchema,
  kwh_saved_year: z.number(),
  tco2e_avoided_year: z.number(),
  cost_saved_year: z.number(),
  capex: z.number(),
  payback_years: z.number().nullable().optional(),
  abatement_cost_per_tco2e: z.number().nullable().optional(),
  notes: z.array(z.string()).default([]),
});
export type LeverResult = z.infer<typeof leverResultSchema>;

export const scenarioSeriesSchema = z.object({
  baseline_power_kw: z.array(z.number()).default([]),
  scenario_power_kw: z.array(z.number()).default([]),
  baseline_emissions_kg: z.array(z.number()).default([]),
  scenario_emissions_kg: z.array(z.number()).default([]),
  temp_in: z.array(z.number()).default([]),
  ci: z.array(z.number()).default([]),
});
export type ScenarioSeries = z.infer<typeof scenarioSeriesSchema>;

export const scenarioEvaluateRequestSchema = z.object({
  facility_id: z.string().default("scenario"),
  levers: z.array(leverSchema),
  context: scenarioContextSchema.default(scenarioContextSchema.parse({})),
  comfort: comfortBandSchema.default({ min_c: 22, max_c: 26 }),
});
export type ScenarioEvaluateRequest = z.infer<typeof scenarioEvaluateRequestSchema>;

export const scenarioEvaluateResponseSchema = z.object({
  facility_id: z.string(),
  levers: z.array(leverResultSchema),
  kpis: scenarioKPIsSchema,
  series: scenarioSeriesSchema,
  narrative: z.string(),
  notes: z.array(z.string()).default([]),
});
export type ScenarioEvaluateResponse = z.infer<typeof scenarioEvaluateResponseSchema>;

export const maccEntrySchema = z.object({
  type: leverTypeSchema,
  label: z.string(),
  tco2e_avoided_year: z.number(),
  abatement_cost_per_tco2e: z.number(),
  capex: z.number(),
  cost_saved_year: z.number(),
  payback_years: z.number().nullable().optional(),
  profitable: z.boolean(),
  cumulative_tco2e_avoided: z.number().optional(),
});
export type MaccEntry = z.infer<typeof maccEntrySchema>;

export const maccResponseSchema = z.object({
  facility_id: z.string(),
  currency: z.string().default("USD"),
  total_tco2e_avoided: z.number(),
  total_capex: z.number(),
  entries: z.array(maccEntrySchema),
  cumulative_tco2e_avoided: z.number().optional(),
});
export type MaccResponse = z.infer<typeof maccResponseSchema>;

/* ------------------------------------------------------------------ */
/* /anomaly/detect                                                     */
/* ------------------------------------------------------------------ */

export const anomalyDetectRequestSchema = z.object({
  facility_id: z.string(),
  history: z.array(seriesPointSchema),
  expected_power_kw: z.array(z.number()).default([]),
  z_threshold: z.number().positive().default(3.0),
  contamination: z.number().gt(0).lt(0.5).default(0.05),
  step_minutes: z.number().int().min(1).max(60).default(15),
  ci_g_per_kwh: z.number().nullable().optional(),
});
export type AnomalyDetectRequest = z.infer<typeof anomalyDetectRequestSchema>;

export const anomalyFlagSchema = z.object({
  ts: z.coerce.date(),
  severity: z.enum(["info", "warning", "critical"]),
  method: z.string(),
  score: z.number(),
  observed_kw: z.number(),
  expected_kw: z.number().nullable().optional(),
  excess_kwh: z.number(),
  est_waste_kg_co2e: z.number(),
  reason: z.string(),
});
export type AnomalyFlag = z.infer<typeof anomalyFlagSchema>;

export const anomalyDetectResponseSchema = z.object({
  facility_id: z.string(),
  method: z.string(),
  n_flagged: z.number().int(),
  total_est_waste_kg_co2e: z.number(),
  flags: z.array(anomalyFlagSchema),
  notes: z.array(z.string()).default([]),
});
export type AnomalyDetectResponse = z.infer<typeof anomalyDetectResponseSchema>;

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  version: z.string(),
  contract_version: z.string(),
  environment: z.string(),
  backend: z.string(),
  shap_available: z.boolean(),
  lightgbm_available: z.boolean(),
  dependencies: z.record(z.boolean()),
  time: z.coerce.date(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
