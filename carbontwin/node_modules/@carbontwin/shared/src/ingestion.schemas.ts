/**
 * Shared Zod schemas for Data Ingestion layer
 * Used by both Node.js API gateway and TypeScript frontend
 * Contract between Member 2 (Ingestion) and all consumers
 */

import { z } from 'zod';

// ============================================================================
// Core Domain Types
// ============================================================================

export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const TimezoneSchema = z.string().min(1);
export type Timezone = z.infer<typeof TimezoneSchema>;

export const FacilityIdSchema = z.string().uuid();
export type FacilityId = z.infer<typeof FacilityIdSchema>;

export const RegionCodeSchema = z.string().regex(/^[A-Z]{2}-[A-Z]{2,3}$/);
export type RegionCode = z.infer<typeof RegionCodeSchema>;

// ============================================================================
// Raw Upload & Parsing
// ============================================================================

export const RawColumnSchema = z.object({
  name: z.string(),
  sampleValues: z.array(z.string()).max(5),
  inferredType: z.enum(['timestamp', 'numeric', 'string', 'boolean', 'unknown']),
  confidence: z.number().min(0).max(1),
});
export type RawColumn = z.infer<typeof RawColumnSchema>;

export const UploadSchemaRequest = z.object({
  fileName: z.string(),
  mimeType: z.enum(['text/csv', 'application/vnd.apache.parquet']),
  sizeBytes: z.number().positive().max(50 * 1024 * 1024), // 50MB
  columns: z.array(RawColumnSchema),
  delimiter: z.string().length(1).optional(),
  hasHeader: z.boolean().default(true),
  encoding: z.string().default('utf-8'),
});
export type UploadSchemaRequest = z.infer<typeof UploadSchemaRequest>;

export const UploadSchemaResponse = z.object({
  facilityId: FacilityIdSchema,
  detectedSchema: z.object({
    timestampColumn: z.string(),
    powerColumn: z.string(),
    timestampFormat: z.string().optional(),
    timezone: TimezoneSchema,
    unit: z.enum(['W', 'kW', 'MW', 'Wh', 'kWh', 'MWh']),
    intervalMinutes: z.number().int().positive(),
    columns: z.array(RawColumnSchema),
  }),
  preview: z.array(z.record(z.string(), z.unknown())).max(10),
  warnings: z.array(z.string()),
});
export type UploadSchemaResponse = z.infer<typeof UploadSchemaResponse>;

export const ColumnMappingRequest = z.object({
  facilityId: FacilityIdSchema,
  mapping: z.object({
    timestampColumn: z.string(),
    powerColumn: z.string(),
    timestampFormat: z.string().optional(),
    timezone: TimezoneSchema,
    unit: z.enum(['W', 'kW', 'MW', 'Wh', 'kWh', 'MWh']),
  }),
  options: z.object({
    resampleTo15min: z.boolean().default(true),
    fillGaps: z.boolean().default(true),
    removeOutliers: z.boolean().default(true),
  }).optional(),
});
export type ColumnMappingRequest = z.infer<typeof ColumnMappingRequest>;

// ============================================================================
// Time Series Data
// ============================================================================

export const TimeSeriesPointSchema = z.object({
  timestamp: TimestampSchema,
  powerKw: z.number().finite(),
  emissionsKg: z.number().finite().optional(),
  carbonIntensity: z.number().finite().optional(), // gCO2/kWh
  dataQuality: z.enum(['measured', 'imputed', 'interpolated', 'synthetic']).default('measured'),
  flags: z.array(z.string()).default([]),
});
export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

export const TimeSeriesResponse = z.object({
  facilityId: FacilityIdSchema,
  timezone: TimezoneSchema,
  intervalMinutes: z.number().int().positive().default(15),
  data: z.array(TimeSeriesPointSchema),
  meta: z.object({
    from: TimestampSchema,
    to: TimestampSchema,
    count: z.number().int().nonnegative(),
    dataSource: z.enum(['live', 'cached', 'synthetic', 'uploaded']),
    qualitySummary: z.object({
      measuredPct: z.number().min(0).max(100),
      imputedPct: z.number().min(0).max(100),
      interpolatedPct: z.number().min(0).max(100),
      syntheticPct: z.number().min(0).max(100),
      gapCount: z.number().int().nonnegative(),
      outlierCount: z.number().int().nonnegative(),
    }),
  }),
});
export type TimeSeriesResponse = z.infer<typeof TimeSeriesResponse>;

export const TimeSeriesQueryParams = z.object({
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
  resolution: z.enum(['1m', '5m', '15m', '30m', '1h', '1d']).default('15m'),
  limit: z.number().int().positive().max(100000).default(10000),
});
export type TimeSeriesQueryParams = z.infer<typeof TimeSeriesQueryParams>;

// ============================================================================
// Data Quality Report
// ============================================================================

export const QualityIssueSchema = z.object({
  type: z.enum(['missing_interval', 'duplicate_timestamp', 'outlier', 'unit_mismatch', 'timezone_ambiguity', 'irregular_interval', 'negative_power', 'excessive_power']),
  severity: z.enum(['info', 'warning', 'error']),
  count: z.number().int().nonnegative(),
  affectedTimestamps: z.array(TimestampSchema).max(10).optional(),
  description: z.string(),
  suggestion: z.string(),
});
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const DataQualityReportSchema = z.object({
  facilityId: FacilityIdSchema,
  generatedAt: TimestampSchema,
  summary: z.object({
    totalRows: z.number().int().nonnegative(),
    validRows: z.number().int().nonnegative(),
    missingIntervals: z.number().int().nonnegative(),
    duplicateTimestamps: z.number().int().nonnegative(),
    outliersDetected: z.number().int().nonnegative(),
    imputedRows: z.number().int().nonnegative(),
    dateRange: z.object({
      start: TimestampSchema,
      end: TimestampSchema,
    }),
    actualIntervalMinutes: z.number().positive(),
    expectedIntervalMinutes: z.number().int().positive(),
    regularityScore: z.number().min(0).max(1), // 1 = perfectly regular
  }),
  issues: z.array(QualityIssueSchema),
  columnProfile: z.object({
    timestamp: z.object({
      parsedSuccessfully: z.number().int().nonnegative(),
      parseErrors: z.number().int().nonnegative(),
      format: z.string(),
      timezone: TimezoneSchema,
    }),
    power: z.object({
      min: z.number().finite(),
      max: z.number().finite(),
      mean: z.number().finite(),
      median: z.number().finite(),
      stdDev: z.number().finite(),
      unit: z.enum(['W', 'kW', 'MW', 'Wh', 'kWh', 'MWh']),
      negativeCount: z.number().int().nonnegative(),
      zeroCount: z.number().int().nonnegative(),
    }),
  }),
  recommendations: z.array(z.string()),
});
export type DataQualityReport = z.infer<typeof DataQualityReportSchema>;

// ============================================================================
// Grid Carbon Intensity
// ============================================================================

export const CarbonIntensityPointSchema = z.object({
  timestamp: TimestampSchema,
  carbonIntensity: z.number().finite(), // gCO2/kWh
  isForecast: z.boolean().default(false),
  dataSource: z.enum(['live', 'cached', 'synthetic']),
  region: RegionCodeSchema,
});
export type CarbonIntensityPoint = z.infer<typeof CarbonIntensityPointSchema>;

export const CarbonIntensityResponse = z.object({
  region: RegionCodeSchema,
  timezone: TimezoneSchema,
  current: CarbonIntensityPointSchema,
  forecast: z.array(CarbonIntensityPointSchema),
  history: z.array(CarbonIntensityPointSchema),
  meta: z.object({
    dataSource: z.enum(['live', 'cached', 'synthetic']),
    lastUpdated: TimestampSchema,
    provider: z.enum(['electricitymaps', 'co2signal', 'fallback']),
  }),
});
export type CarbonIntensityResponse = z.infer<typeof CarbonIntensityResponse>;

// ============================================================================
// Weather Data
// ============================================================================

export const WeatherPointSchema = z.object({
  timestamp: TimestampSchema,
  temperatureC: z.number().finite(),
  humidityPct: z.number().min(0).max(100).finite(),
  irradianceWm2: z.number().min(0).finite(),
  windSpeedMs: z.number().min(0).finite().optional(),
  cloudCoverPct: z.number().min(0).max(100).finite().optional(),
  isForecast: z.boolean().default(false),
  dataSource: z.enum(['live', 'cached', 'synthetic']),
  lat: z.number().finite(),
  lon: z.number().finite(),
});
export type WeatherPoint = z.infer<typeof WeatherPointSchema>;

export const WeatherResponse = z.object({
  lat: z.number().finite(),
  lon: z.number().finite(),
  timezone: TimezoneSchema,
  current: WeatherPointSchema,
  forecast: z.array(WeatherPointSchema),
  history: z.array(WeatherPointSchema),
  meta: z.object({
    dataSource: z.enum(['live', 'cached', 'synthetic']),
    lastUpdated: TimestampSchema,
    provider: z.enum(['openmeteo', 'openweather', 'fallback']),
  }),
});
export type WeatherResponse = z.infer<typeof WeatherResponse>;

export const WeatherQueryParams = z.object({
  lat: z.number().finite(),
  lon: z.number().finite(),
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
});
export type WeatherQueryParams = z.infer<typeof WeatherQueryParams>;

// ============================================================================
// Emissions Calculation
// ============================================================================

export const EmissionsCalculationRequest = z.object({
  facilityId: FacilityIdSchema,
  region: RegionCodeSchema,
  from: TimestampSchema,
  to: TimestampSchema,
  useAnnualAverage: z.boolean().default(false),
  annualAverageCi: z.number().positive().optional(), // gCO2/kWh
});
export type EmissionsCalculationRequest = z.infer<typeof EmissionsCalculationRequest>;

export const EmissionsComparisonPointSchema = z.object({
  timestamp: TimestampSchema,
  powerKw: z.number().finite(),
  dynamicCi: z.number().finite(), // gCO2/kWh
  dynamicEmissionsKg: z.number().finite(),
  staticCi: z.number().finite(), // gCO2/kWh
  staticEmissionsKg: z.number().finite(),
  differenceKg: z.number().finite(),
  differencePct: z.number().finite(),
});
export type EmissionsComparisonPoint = z.infer<typeof EmissionsComparisonPointSchema>;

export const EmissionsCalculationResponse = z.object({
  facilityId: FacilityIdSchema,
  region: RegionCodeSchema,
  from: TimestampSchema,
  to: TimestampSchema,
  comparison: z.array(EmissionsComparisonPointSchema),
  totals: z.object({
    totalEnergyKwh: z.number().finite(),
    dynamicEmissionsKg: z.number().finite(),
    staticEmissionsKg: z.number().finite(),
    differenceKg: z.number().finite(),
    differencePct: z.number().finite(),
    annualAverageCiUsed: z.number().finite(),
  }),
  meta: z.object({
    dataSource: z.enum(['live', 'cached', 'synthetic']),
    calculatedAt: TimestampSchema,
  }),
});
export type EmissionsCalculationResponse = z.infer<typeof EmissionsCalculationResponse>;

// ============================================================================
// Facilities Management
// ============================================================================

export const FacilityTypeSchema = z.enum(['office', 'hospital', 'campus', 'data_center', 'retail', 'industrial', 'custom']);
export type FacilityType = z.infer<typeof FacilityTypeSchema>;

export const FacilitySchema = z.object({
  id: FacilityIdSchema,
  name: z.string().min(1).max(200),
  type: FacilityTypeSchema,
  region: RegionCodeSchema,
  timezone: TimezoneSchema,
  lat: z.number().finite(),
  lon: z.number().finite(),
  address: z.string().optional(),
  floorAreaM2: z.number().positive().optional(),
  operatingHours: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    timezone: TimezoneSchema,
    days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]), // Mon-Fri
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  isDemo: z.boolean().default(false),
  dataSource: z.enum(['uploaded', 'demo', 'synthetic']).default('uploaded'),
});
export type Facility = z.infer<typeof FacilitySchema>;

export const FacilityListResponse = z.object({
  facilities: z.array(FacilitySchema),
  total: z.number().int().nonnegative(),
});
export type FacilityListResponse = z.infer<typeof FacilityListResponse>;

export const CreateFacilityRequest = z.object({
  name: z.string().min(1).max(200),
  type: FacilityTypeSchema,
  region: RegionCodeSchema,
  timezone: TimezoneSchema,
  lat: z.number().finite(),
  lon: z.number().finite(),
  address: z.string().optional(),
  floorAreaM2: z.number().positive().optional(),
  operatingHours: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    timezone: TimezoneSchema,
    days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateFacilityRequest = z.infer<typeof CreateFacilityRequest>;

// ============================================================================
// Replay Engine
// ============================================================================

export const ReplayConfigSchema = z.object({
  facilityId: FacilityIdSchema,
  speedMultiplier: z.number().positive().default(1440), // 1 day = 60s default
  from: TimestampSchema,
  to: TimestampSchema,
  includeEmissions: z.boolean().default(true),
  includeWeather: z.boolean().default(true),
});
export type ReplayConfig = z.infer<typeof ReplayConfigSchema>;

export const ReplayTickSchema = z.object({
  timestamp: TimestampSchema,
  powerKw: z.number().finite(),
  emissionsKg: z.number().finite().optional(),
  carbonIntensity: z.number().finite().optional(),
  temperatureC: z.number().finite().optional(),
  humidityPct: z.number().finite().optional(),
  irradianceWm2: z.number().finite().optional(),
  isReplay: z.boolean().default(true),
  progressPct: z.number().min(0).max(100),
});
export type ReplayTick = z.infer<typeof ReplayTickSchema>;

// ============================================================================
// Demo Facilities
// ============================================================================

export const DemoFacilityInfoSchema = z.object({
  id: FacilityIdSchema,
  name: z.string(),
  type: FacilityTypeSchema,
  region: RegionCodeSchema,
  description: z.string(),
  dataPeriodDays: z.number().int().positive(),
  sizeKwh: z.number().positive(),
  peakKw: z.number().positive(),
  avgCi: z.number().positive(),
  tags: z.array(z.string()),
});
export type DemoFacilityInfo = z.infer<typeof DemoFacilityInfoSchema>;

export const DemoFacilitiesResponse = z.object({
  facilities: z.array(DemoFacilityInfoSchema),
});
export type DemoFacilitiesResponse = z.infer<typeof DemoFacilitiesResponse>;

// ============================================================================
// Health & Status
// ============================================================================

export const IngestionHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'down']),
  database: z.enum(['connected', 'disconnected']),
  externalApis: z.object({
    electricityMaps: z.enum(['live', 'cached', 'unavailable']),
    co2signal: z.enum(['live', 'cached', 'unavailable']),
    openMeteo: z.enum(['live', 'cached', 'unavailable']),
    openWeather: z.enum(['live', 'cached', 'unavailable']),
  }),
  lastIngestion: TimestampSchema.optional(),
  queueDepth: z.number().int().nonnegative().optional(),
});
export type IngestionHealth = z.infer<typeof IngestionHealthSchema>;

// ============================================================================
// Re-export for convenience
// ============================================================================

export const IngestionSchemas = {
  Timestamp: TimestampSchema,
  Timezone: TimezoneSchema,
  FacilityId: FacilityIdSchema,
  RegionCode: RegionCodeSchema,
  RawColumn: RawColumnSchema,
  UploadSchemaRequest,
  UploadSchemaResponse,
  ColumnMappingRequest,
  TimeSeriesPoint: TimeSeriesPointSchema,
  TimeSeriesResponse,
  TimeSeriesQueryParams,
  QualityIssue: QualityIssueSchema,
  DataQualityReport: DataQualityReportSchema,
  CarbonIntensityPoint: CarbonIntensityPointSchema,
  CarbonIntensityResponse,
  WeatherPoint: WeatherPointSchema,
  WeatherResponse,
  WeatherQueryParams,
  EmissionsCalculationRequest,
  EmissionsComparisonPoint: EmissionsComparisonPointSchema,
  EmissionsCalculationResponse,
  FacilityType: FacilityTypeSchema,
  Facility: FacilitySchema,
  FacilityListResponse,
  CreateFacilityRequest,
  ReplayConfig: ReplayConfigSchema,
  ReplayTick: ReplayTickSchema,
  DemoFacilityInfo: DemoFacilityInfoSchema,
  DemoFacilitiesResponse,
  IngestionHealth: IngestionHealthSchema,
} as const;