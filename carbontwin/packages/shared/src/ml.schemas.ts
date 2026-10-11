/**
 * Shared Zod schemas for ML service communication
 * Mirror of Python Pydantic models in services/ml/app/schemas.py
 * Used by Node.js API gateway to talk to Python FastAPI ML service
 */

import { z } from 'zod';

export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const FacilityIdSchema = z.string().uuid();
export type FacilityId = z.infer<typeof FacilityIdSchema>;

// ============================================================================
// Forecasting
// ============================================================================

export const ForecastRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  horizonHours: z.number().int().positive().max(168).default(24), // up to 1 week
  resolutionMinutes: z.number().int().positive().default(15),
  includeQuantiles: z.boolean().default(true),
  quantiles: z.array(z.number().min(0).max(1)).default([0.1, 0.5, 0.9]),
});
export type ForecastRequest = z.infer<typeof ForecastRequestSchema>;

export const ForecastPointSchema = z.object({
  timestamp: TimestampSchema,
  powerKw: z.number().finite(),
  powerKwLower: z.number().finite().optional(),
  powerKwUpper: z.number().finite().optional(),
  emissionsKg: z.number().finite().optional(),
  emissionsKgLower: z.number().finite().optional(),
  emissionsKgUpper: z.number().finite().optional(),
  carbonIntensity: z.number().finite().optional(),
});
export type ForecastPoint = z.infer<typeof ForecastPointSchema>;

export const ForecastResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  generatedAt: TimestampSchema,
  horizonHours: z.number().int().positive(),
  resolutionMinutes: z.number().int().positive(),
  quantiles: z.array(z.number().min(0).max(1)),
  forecast: z.array(ForecastPointSchema),
  modelMeta: z.object({
    modelVersion: z.string(),
    trainedAt: TimestampSchema,
    trainingWindowDays: z.number().int().positive(),
    metrics: z.object({
      mae: z.number().finite(),
      rmse: z.number().finite(),
      mape: z.number().finite(),
      r2: z.number().finite(),
    }),
  }),
});
export type ForecastResponse = z.infer<typeof ForecastResponseSchema>;

// ============================================================================
// SHAP Explainability
// ============================================================================

export const ShapValueSchema = z.object({
  feature: z.string(),
  featureGroup: z.enum(['weather', 'time', 'grid_carbon', 'occupancy', 'historical', 'other']),
  shapValue: z.number().finite(),
  featureValue: z.number().finite(),
  contributionPct: z.number().finite(),
});
export type ShapValue = z.infer<typeof ShapValueSchema>;

export const ExplainRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  timestamp: TimestampSchema,
  topK: z.number().int().positive().max(20).default(10),
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const ExplainResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  timestamp: TimestampSchema,
  baseValue: z.number().finite(),
  prediction: z.number().finite(),
  shapValues: z.array(ShapValueSchema),
  explanationText: z.string(),
  featureGroups: z.object({
    weather: z.number().finite(),
    time: z.number().finite(),
    grid_carbon: z.number().finite(),
    occupancy: z.number().finite(),
    historical: z.number().finite(),
    other: z.number().finite(),
  }),
});
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

export const GlobalShapRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  sampleSize: z.number().int().positive().max(10000).default(1000),
});
export type GlobalShapRequest = z.infer<typeof GlobalShapRequestSchema>;

export const GlobalShapResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  computedAt: TimestampSchema,
  sampleSize: z.number().int().positive(),
  featureImportance: z.array(ShapValueSchema),
  featureGroups: z.object({
    weather: z.number().finite(),
    time: z.number().finite(),
    grid_carbon: z.number().finite(),
    occupancy: z.number().finite(),
    historical: z.number().finite(),
    other: z.number().finite(),
  }),
});
export type GlobalShapResponse = z.infer<typeof GlobalShapResponseSchema>;

// ============================================================================
// Digital Twin (RC Model)
// ============================================================================

export const TwinCalibrateRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  powerSeries: z.array(z.object({
    timestamp: TimestampSchema,
    powerKw: z.number().finite(),
  })),
  weatherSeries: z.array(z.object({
    timestamp: TimestampSchema,
    temperatureC: z.number().finite(),
    irradianceWm2: z.number().finite(),
  })),
  initialGuess: z.object({
    R: z.number().positive().optional(), // K/W
    C: z.number().positive().optional(), // J/K
    windowFactor: z.number().positive().optional(),
    copBase: z.number().positive().optional(),
    copTempCoeff: z.number().optional(),
  }).optional(),
  bounds: z.object({
    R: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    C: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    windowFactor: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  }).optional(),
});
export type TwinCalibrateRequest = z.infer<typeof TwinCalibrateRequestSchema>;

export const TwinCalibrateResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  calibratedAt: TimestampSchema,
  parameters: z.object({
    R: z.number().finite(), // K/W
    C: z.number().finite(), // J/K
    windowFactor: z.number().finite(),
    copBase: z.number().finite(),
    copTempCoeff: z.number().finite(),
  }),
  fitMetrics: z.object({
    rmse: z.number().finite(),
    mae: z.number().finite(),
    r2: z.number().finite(),
    nObservations: z.number().int().positive(),
  }),
  confidenceIntervals: z.object({
    R: z.tuple([z.number().finite(), z.number().finite()]),
    C: z.tuple([z.number().finite(), z.number().finite()]),
    windowFactor: z.tuple([z.number().finite(), z.number().finite()]),
  }),
  convergence: z.boolean(),
  message: z.string(),
});
export type TwinCalibrateResponse = z.infer<typeof TwinCalibrateResponseSchema>;

export const TwinSimulateRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  parameters: z.object({
    R: z.number().positive(),
    C: z.number().positive(),
    windowFactor: z.number().positive(),
    copBase: z.number().positive(),
    copTempCoeff: z.number(),
  }),
  initialTempC: z.number().finite(),
  setpointC: z.number().finite(),
  comfortBand: z.object({
    min: z.number().finite(),
    max: z.number().finite(),
  }).default({ min: 22, max: 26 }),
  throttleProfile: z.array(z.object({
    timestamp: TimestampSchema,
    throttle: z.number().min(0).max(1), // 0-100%
  })),
  weatherSeries: z.array(z.object({
    timestamp: TimestampSchema,
    temperatureC: z.number().finite(),
    irradianceWm2: z.number().min(0).finite(),
  })),
  occupancySeries: z.array(z.object({
    timestamp: TimestampSchema,
    occupancy: z.number().min(0).max(1), // 0-1
  })).optional(),
  internalGainsW: z.number().nonnegative().default(5000), // 5 kW default
  resolutionMinutes: z.number().int().positive().default(1),
  outputResolutionMinutes: z.number().int().positive().default(15),
});
export type TwinSimulateRequest = z.infer<typeof TwinSimulateRequestSchema>;

export const TwinSimulationPointSchema = z.object({
  timestamp: TimestampSchema,
  tempInC: z.number().finite(),
  tempOutC: z.number().finite(),
  hvacPowerKw: z.number().finite(),
  hvacThrottle: z.number().finite(),
  coolingLoadKw: z.number().finite(),
  comfortViolation: z.boolean(),
  comfortMarginC: z.number().finite(),
});
export type TwinSimulationPoint = z.infer<typeof TwinSimulationPointSchema>;

export const TwinSimulateResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  simulatedAt: TimestampSchema,
  simulation: z.array(TwinSimulationPointSchema),
  summary: z.object({
    avgTempInC: z.number().finite(),
    minTempInC: z.number().finite(),
    maxTempInC: z.number().finite(),
    totalHvacEnergyKwh: z.number().finite(),
    comfortViolationHours: z.number().finite(),
    peakHvacPowerKw: z.number().finite(),
  }),
});
export type TwinSimulateResponse = z.infer<typeof TwinSimulateResponseSchema>;

// ============================================================================
// Optimization (MPC)
// ============================================================================

export const OptimizeRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  horizonHours: z.number().int().positive().max(168).default(24),
  resolutionMinutes: z.number().int().positive().default(15),
  currentTempC: z.number().finite(),
  currentTimestamp: TimestampSchema,
  comfortBand: z.object({
    min: z.number().finite(),
    max: z.number().finite(),
  }).default({ min: 22, max: 26 }),
  minThrottle: z.number().min(0).max(1).default(0.3),
  lambdaComfort: z.number().positive().default(1000), // penalty weight for comfort violation
  lambdaSmooth: z.number().nonnegative().default(10), // penalty for throttle changes
  weatherForecast: z.array(z.object({
    timestamp: TimestampSchema,
    temperatureC: z.number().finite(),
    irradianceWm2: z.number().min(0).finite(),
    carbonIntensity: z.number().positive().finite(),
  })),
  occupancyForecast: z.array(z.object({
    timestamp: TimestampSchema,
    occupancy: z.number().min(0).max(1),
  })).optional(),
  twinParameters: z.object({
    R: z.number().positive(),
    C: z.number().positive(),
    windowFactor: z.number().positive(),
    copBase: z.number().positive(),
    copTempCoeff: z.number(),
    internalGainsW: z.number().nonnegative(),
  }),
});
export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

export const OptimizePointSchema = z.object({
  timestamp: TimestampSchema,
  throttle: z.number().min(0).max(1),
  tempInC: z.number().finite(),
  hvacPowerKw: z.number().finite(),
  carbonIntensity: z.number().finite(),
  emissionsKg: z.number().finite(),
  comfortViolation: z.boolean(),
});
export type OptimizePoint = z.infer<typeof OptimizePointSchema>;

export const OptimizeResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  optimizedAt: TimestampSchema,
  schedule: z.array(OptimizePointSchema),
  baselineComparison: z.object({
    baselineEmissionsKg: z.number().finite(),
    optimizedEmissionsKg: z.number().finite(),
    emissionsReductionKg: z.number().finite(),
    emissionsReductionPct: z.number().finite(),
    baselineComfortViolationHours: z.number().finite(),
    optimizedComfortViolationHours: z.number().finite(),
    precoolingEnergyKwh: z.number().finite().optional(),
  }),
  solverMeta: z.object({
    iterations: z.number().int().nonnegative(),
    solveTimeMs: z.number().finite(),
    converged: z.boolean(),
    status: z.string(),
  }),
});
export type OptimizeResponse = z.infer<typeof OptimizeResponseSchema>;

// ============================================================================
// Scenarios
// ============================================================================

export const ScenarioLeverSchema = z.object({
  type: z.enum([
    'hvac_peak_shaving',
    'load_shifting',
    'rooftop_solar',
    'setpoint_relaxation',
    'led_retrofit',
    'vfd_retrofit',
    'battery_storage',
  ]),
  params: z.record(z.string(), z.unknown()),
});
export type ScenarioLever = z.infer<typeof ScenarioLeverSchema>;

export const ScenarioRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  levers: z.array(ScenarioLeverSchema).min(1).max(10),
  horizonHours: z.number().int().positive().max(8760).default(8760), // 1 year
  baselineSeries: z.array(z.object({
    timestamp: TimestampSchema,
    powerKw: z.number().finite(),
    carbonIntensity: z.number().positive().finite(),
  })).optional(), // if not provided, uses stored data
  tariff: z.object({
    energyRatePerKwh: z.number().positive(),
    demandChargePerKw: z.number().nonnegative().optional(),
    currency: z.string().default('USD'),
  }).optional(),
});
export type ScenarioRequest = z.infer<typeof ScenarioRequestSchema>;

export const ScenarioKpiSchema = z.object({
  kwhSavedYear: z.number().finite(),
  tco2eAvoidedYear: z.number().finite(),
  costSavedYear: z.number().finite(),
  capex: z.number().finite(),
  paybackYears: z.number().finite(),
  npv: z.number().finite(),
  abatementCostPerTco2e: z.number().finite(),
  comfortViolationHours: z.number().finite(),
});
export type ScenarioKpi = z.infer<typeof ScenarioKpiSchema>;

export const ScenarioSeriesSchema = z.object({
  baseline: z.array(z.object({
    timestamp: TimestampSchema,
    powerKw: z.number().finite(),
    emissionsKg: z.number().finite(),
    tempInC: z.number().finite().optional(),
  })),
  scenario: z.array(z.object({
    timestamp: TimestampSchema,
    powerKw: z.number().finite(),
    emissionsKg: z.number().finite(),
    tempInC: z.number().finite().optional(),
  })),
  tempIn: z.array(z.object({
    timestamp: TimestampSchema,
    baseline: z.number().finite(),
    scenario: z.number().finite(),
  })).optional(),
});
export type ScenarioSeries = z.infer<typeof ScenarioSeriesSchema>;

export const ScenarioResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  evaluatedAt: TimestampSchema,
  kpis: ScenarioKpiSchema,
  series: ScenarioSeriesSchema,
  leverBreakdown: z.array(z.object({
    lever: ScenarioLeverSchema,
    kpis: ScenarioKpiSchema,
  })),
});
export type ScenarioResponse = z.infer<typeof ScenarioResponseSchema>;

export const MaccRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  levers: z.array(ScenarioLeverSchema).optional(),
  tariff: z.object({
    energyRatePerKwh: z.number().positive(),
    demandChargePerKw: z.number().nonnegative().optional(),
    currency: z.string().default('USD'),
    discountRate: z.number().min(0).max(1).default(0.05),
    projectLifeYears: z.number().int().positive().default(15),
  }).optional(),
});
export type MaccRequest = z.infer<typeof MaccRequestSchema>;

export const MaccLeverSchema = z.object({
  name: z.string(),
  type: z.string(),
  tco2eAvoidedYear: z.number().finite(),
  abatementCostPerTco2e: z.number().finite(),
  capex: z.number().finite(),
  annualSaving: z.number().finite(),
  paybackYears: z.number().finite(),
  width: z.number().finite(), // tCO2e avoided (bar width)
  height: z.number().finite(), // $/tCO2e (bar height)
  color: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type MaccLever = z.infer<typeof MaccLeverSchema>;

export const MaccResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  computedAt: TimestampSchema,
  levers: z.array(MaccLeverSchema),
  totalTco2eAvoided: z.number().finite(),
  weightedAverageAbatementCost: z.number().finite(),
});
export type MaccResponse = z.infer<typeof MaccResponseSchema>;

// ============================================================================
// Anomaly Detection
// ============================================================================

export const AnomalyRequestSchema = z.object({
  facilityId: FacilityIdSchema,
  from: TimestampSchema,
  to: TimestampSchema,
  method: z.enum(['isolation_forest', 'residual_zscore', 'both']).default('both'),
  sensitivity: z.number().min(0).max(1).default(0.95),
  minAnomalyDurationMinutes: z.number().int().positive().default(15),
});
export type AnomalyRequest = z.infer<typeof AnomalyRequestSchema>;

export const AnomalyPointSchema = z.object({
  timestamp: TimestampSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  method: z.enum(['isolation_forest', 'residual_zscore']),
  anomalyScore: z.number().finite(),
  expectedPowerKw: z.number().finite(),
  actualPowerKw: z.number().finite(),
  deviationKw: z.number().finite(),
  deviationPct: z.number().finite(),
  estimatedWasteKwh: z.number().finite(),
  estimatedWasteKgCo2e: z.number().finite(),
  possibleCauses: z.array(z.string()),
});
export type AnomalyPoint = z.infer<typeof AnomalyPointSchema>;

export const AnomalyResponseSchema = z.object({
  facilityId: FacilityIdSchema,
  detectedAt: TimestampSchema,
  from: TimestampSchema,
  to: TimestampSchema,
  anomalies: z.array(AnomalyPointSchema),
  summary: z.object({
    totalAnomalies: z.number().int().nonnegative(),
    totalWasteKwh: z.number().finite(),
    totalWasteKgCo2e: z.number().finite(),
    bySeverity: z.object({
      low: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      high: z.number().int().nonnegative(),
      critical: z.number().int().nonnegative(),
    }),
  }),
});
export type AnomalyResponse = z.infer<typeof AnomalyResponseSchema>;

// ============================================================================
// Model Card
// ============================================================================

export const ModelCardSchema = z.object({
  facilityId: FacilityIdSchema,
  modelType: z.enum(['lightgbm_quantile', 'rc_twin', 'optimizer']),
  version: z.string(),
  trainedAt: TimestampSchema,
  trainingWindow: z.object({
    from: TimestampSchema,
    to: TimestampSchema,
  }),
  dataPoints: z.number().int().positive(),
  features: z.array(z.string()),
  target: z.string(),
  metrics: z.object({
    mae: z.number().finite(),
    rmse: z.number().finite(),
    mape: z.number().finite(),
    r2: z.number().finite(),
    quantileCoverage: z.record(z.string(), z.number().min(0).max(1)).optional(),
  }),
  validationStrategy: z.string(),
  hyperparameters: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
  intendedUse: z.string(),
  ethicalConsiderations: z.array(z.string()),
});
export type ModelCard = z.infer<typeof ModelCardSchema>;

// ============================================================================
// ML Service Health
// ============================================================================

export const MlHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'down']),
  modelsLoaded: z.number().int().nonnegative(),
  cacheHitRate: z.number().min(0).max(1).optional(),
  avgInferenceMs: z.number().finite().optional(),
  gpuAvailable: z.boolean().optional(),
});
export type MlHealth = z.infer<typeof MlHealthSchema>;

// ============================================================================
// Re-export
// ============================================================================

export const MlSchemas = {
  Timestamp: TimestampSchema,
  FacilityId: FacilityIdSchema,
  ForecastRequest: ForecastRequestSchema,
  ForecastPoint: ForecastPointSchema,
  ForecastResponse: ForecastResponseSchema,
  ShapValue: ShapValueSchema,
  ExplainRequest: ExplainRequestSchema,
  ExplainResponse: ExplainResponseSchema,
  GlobalShapRequest: GlobalShapRequestSchema,
  GlobalShapResponse: GlobalShapResponseSchema,
  TwinCalibrateRequest: TwinCalibrateRequestSchema,
  TwinCalibrateResponse: TwinCalibrateResponseSchema,
  TwinSimulateRequest: TwinSimulateRequestSchema,
  TwinSimulationPoint: TwinSimulationPointSchema,
  TwinSimulateResponse: TwinSimulateResponseSchema,
  OptimizeRequest: OptimizeRequestSchema,
  OptimizePoint: OptimizePointSchema,
  OptimizeResponse: OptimizeResponseSchema,
  ScenarioLever: ScenarioLeverSchema,
  ScenarioRequest: ScenarioRequestSchema,
  ScenarioKpi: ScenarioKpiSchema,
  ScenarioSeries: ScenarioSeriesSchema,
  ScenarioResponse: ScenarioResponseSchema,
  MaccRequest: MaccRequestSchema,
  MaccLever: MaccLeverSchema,
  MaccResponse: MaccResponseSchema,
  AnomalyRequest: AnomalyRequestSchema,
  AnomalyPoint: AnomalyPointSchema,
  AnomalyResponse: AnomalyResponseSchema,
  ModelCard: ModelCardSchema,
  MlHealth: MlHealthSchema,
} as const;