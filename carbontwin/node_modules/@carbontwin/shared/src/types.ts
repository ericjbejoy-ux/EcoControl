/**
 * Shared TypeScript types and constants
 * Used across all packages and services
 */

import { z } from 'zod';

// ============================================================================
// Base Types
// ============================================================================

export type UUID = string & { readonly __brand: unique symbol };
export type ISO8601 = string & { readonly __brand: unique symbol };

export function isUUID(value: string): value is UUID {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isISO8601(value: string): value is ISO8601 {
  return !isNaN(Date.parse(value));
}

// ============================================================================
// Units & Conversions
// ============================================================================

export const PowerUnit = {
  W: 'W',
  KW: 'kW',
  MW: 'MW',
} as const;
export type PowerUnit = (typeof PowerUnit)[keyof typeof PowerUnit];

export const EnergyUnit = {
  WH: 'Wh',
  KWH: 'kWh',
  MWH: 'MWh',
} as const;
export type EnergyUnit = (typeof EnergyUnit)[keyof typeof EnergyUnit];

export enum TemperatureUnit {
  CELSIUS = '°C',
  FAHRENHEIT = '°F',
  KELVIN = 'K',
}

export enum CarbonIntensityUnit {
  G_CO2_PER_KWH = 'gCO2/kWh',
  KG_CO2_PER_KWH = 'kgCO2/kWh',
  KG_CO2_PER_MWH = 'kgCO2/MWh',
}

export const POWER_UNIT_TO_KW: Record<PowerUnit, number> = {
  [PowerUnit.W]: 0.001,
  [PowerUnit.KW]: 1,
  [PowerUnit.MW]: 1000,
};

export const ENERGY_UNIT_TO_KWH: Record<EnergyUnit, number> = {
  [EnergyUnit.WH]: 0.001,
  [EnergyUnit.KWH]: 1,
  [EnergyUnit.MWH]: 1000,
};

export function convertPower(value: number, from: PowerUnit, to: PowerUnit = PowerUnit.KW): number {
  return value * POWER_UNIT_TO_KW[from] / POWER_UNIT_TO_KW[to];
}

export function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit = EnergyUnit.KWH): number {
  return value * ENERGY_UNIT_TO_KWH[from] / ENERGY_UNIT_TO_KWH[to];
}

export function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

export function fahrenheitToCelsius(f: number): number {
  return (f - 32) * 5 / 9;
}

// ============================================================================
// Time & Intervals
// ============================================================================

export enum TimeInterval {
  MINUTE_1 = '1m',
  MINUTE_5 = '5m',
  MINUTE_15 = '15m',
  MINUTE_30 = '30m',
  HOUR_1 = '1h',
  DAY_1 = '1d',
}

export const INTERVAL_TO_MS: Record<TimeInterval, number> = {
  [TimeInterval.MINUTE_1]: 60 * 1000,
  [TimeInterval.MINUTE_5]: 5 * 60 * 1000,
  [TimeInterval.MINUTE_15]: 15 * 60 * 1000,
  [TimeInterval.MINUTE_30]: 30 * 60 * 1000,
  [TimeInterval.HOUR_1]: 60 * 60 * 1000,
  [TimeInterval.DAY_1]: 24 * 60 * 60 * 1000,
};

export const INTERVAL_TO_MINUTES: Record<TimeInterval, number> = {
  [TimeInterval.MINUTE_1]: 1,
  [TimeInterval.MINUTE_5]: 5,
  [TimeInterval.MINUTE_15]: 15,
  [TimeInterval.MINUTE_30]: 30,
  [TimeInterval.HOUR_1]: 60,
  [TimeInterval.DAY_1]: 1440,
};

export function intervalToMs(interval: TimeInterval): number {
  return INTERVAL_TO_MS[interval];
}

export function intervalToMinutes(interval: TimeInterval): number {
  return INTERVAL_TO_MINUTES[interval];
}

export function roundToInterval(date: Date, interval: TimeInterval): Date {
  const ms = intervalToMs(interval);
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

export function generateTimestamps(
  start: Date,
  end: Date,
  interval: TimeInterval
): Date[] {
  const timestamps: Date[] = [];
  const current = roundToInterval(new Date(start), interval);
  const endTime = end.getTime();
  const step = intervalToMs(interval);

  while (current.getTime() <= endTime) {
    timestamps.push(new Date(current));
    current.setTime(current.getTime() + step);
  }

  return timestamps;
}

// ============================================================================
// Data Quality
// ============================================================================

export enum DataQualityFlag {
  MEASURED = 'measured',
  IMPUTED = 'imputed',
  INTERPOLATED = 'interpolated',
  SYNTHETIC = 'synthetic',
  OUTLIER = 'outlier',
  MISSING = 'missing',
}

export enum DataSource {
  LIVE = 'live',
  CACHED = 'cached',
  SYNTHETIC = 'synthetic',
  UPLOADED = 'uploaded',
  DEMO = 'demo',
}

// ============================================================================
// Facility Types
// ============================================================================

export enum FacilityKind {
  OFFICE = 'office',
  HOSPITAL = 'hospital',
  CAMPUS = 'campus',
  DATA_CENTER = 'data_center',
  RETAIL = 'retail',
  INDUSTRIAL = 'industrial',
  CUSTOM = 'custom',
}

export interface FacilityDefaults {
  typicalOperatingHours: { start: string; end: string; days: number[] };
  internalGainsWPerM2: number;
  typicalCop: number;
  comfortBand: { min: number; max: number };
}

export const FACILITY_DEFAULTS: Record<FacilityKind, FacilityDefaults> = {
  [FacilityKind.OFFICE]: {
    typicalOperatingHours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    internalGainsWPerM2: 15,
    typicalCop: 3.5,
    comfortBand: { min: 22, max: 26 },
  },
  [FacilityKind.HOSPITAL]: {
    typicalOperatingHours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    internalGainsWPerM2: 25,
    typicalCop: 3.0,
    comfortBand: { min: 21, max: 24 },
  },
  [FacilityKind.CAMPUS]: {
    typicalOperatingHours: { start: '07:00', end: '22:00', days: [1, 2, 3, 4, 5] },
    internalGainsWPerM2: 20,
    typicalCop: 3.2,
    comfortBand: { min: 21, max: 26 },
  },
  [FacilityKind.DATA_CENTER]: {
    typicalOperatingHours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    internalGainsWPerM2: 500,
    typicalCop: 4.0,
    comfortBand: { min: 18, max: 27 },
  },
  [FacilityKind.RETAIL]: {
    typicalOperatingHours: { start: '09:00', end: '21:00', days: [0, 1, 2, 3, 4, 5, 6] },
    internalGainsWPerM2: 30,
    typicalCop: 3.0,
    comfortBand: { min: 21, max: 25 },
  },
  [FacilityKind.INDUSTRIAL]: {
    typicalOperatingHours: { start: '06:00', end: '22:00', days: [1, 2, 3, 4, 5] },
    internalGainsWPerM2: 40,
    typicalCop: 2.8,
    comfortBand: { min: 18, max: 28 },
  },
  [FacilityKind.CUSTOM]: {
    typicalOperatingHours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    internalGainsWPerM2: 20,
    typicalCop: 3.0,
    comfortBand: { min: 20, max: 26 },
  },
};

// ============================================================================
// Region Codes (ISO 3166-2 style)
// ============================================================================

export const REGION_TIMEZONES: Record<string, string> = {
  'US-CA': 'America/Los_Angeles',
  'US-TX': 'America/Chicago',
  'US-NY': 'America/New_York',
  'US-WA': 'America/Los_Angeles',
  'IN-MH': 'Asia/Kolkata',
  'IN-DL': 'Asia/Kolkata',
  'IN-KA': 'Asia/Kolkata',
  'GB-LND': 'Europe/London',
  'DE-BE': 'Europe/Berlin',
  'FR-IDF': 'Europe/Paris',
  'AU-NSW': 'Australia/Sydney',
  'SG': 'Asia/Singapore',
  'JP-13': 'Asia/Tokyo',
  'CN-BJ': 'Asia/Shanghai',
};

export const REGION_CARBON_INTENSITY_PROFILES: Record<string, { avg: number; diurnal: number[] }> = {
  'US-CA': { avg: 250, diurnal: [200, 180, 170, 160, 180, 220, 280, 320, 280, 250, 220, 200, 190, 185, 180, 180, 190, 220, 280, 320, 300, 280, 250, 220] },
  'US-TX': { avg: 400, diurnal: [350, 330, 320, 310, 330, 380, 420, 450, 420, 400, 380, 360, 350, 340, 330, 330, 340, 380, 430, 460, 430, 400, 370, 350] },
  'IN-MH': { avg: 700, diurnal: [650, 630, 620, 610, 630, 680, 720, 750, 720, 700, 680, 660, 650, 640, 630, 630, 640, 680, 730, 760, 730, 700, 670, 650] },
  'GB-LND': { avg: 200, diurnal: [180, 170, 160, 150, 160, 180, 210, 240, 220, 200, 190, 180, 175, 170, 165, 165, 170, 190, 220, 240, 220, 200, 190, 180] },
  'DE-BE': { avg: 350, diurnal: [300, 280, 270, 260, 280, 320, 380, 420, 380, 350, 330, 310, 300, 290, 280, 280, 290, 320, 370, 410, 380, 350, 320, 300] },
};

// ============================================================================
// Emissions Calculation
// ============================================================================

export function calculateEmissionsKg(powerKw: number, carbonIntensityGPerKwh: number): number {
  return (powerKw * 0.25 * carbonIntensityGPerKwh) / 1000;
}

export function calculateAnnualEmissions(
  avgPowerKw: number,
  carbonIntensityGPerKwh: number,
  hoursPerYear: number = 8760
): number {
  return avgPowerKw * hoursPerYear * carbonIntensityGPerKwh / 1000;
}

// ============================================================================
// Economics
// ============================================================================

export interface Tariff {
  energyRatePerKwh: number;
  demandChargePerKw?: number;
  currency: string;
  discountRate?: number;
  projectLifeYears?: number;
}

export function calculateAnnualSavings(
  energySavedKwh: number,
  demandSavedKw: number,
  tariff: Tariff
): number {
  let savings = energySavedKwh * tariff.energyRatePerKwh;
  if (tariff.demandChargePerKw && demandSavedKw > 0) {
    savings += demandSavedKw * tariff.demandChargePerKw * 12; // monthly demand charge
  }
  return savings;
}

export function calculateNpv(
  annualSavings: number,
  capex: number,
  discountRate: number = 0.05,
  projectLifeYears: number = 15
): number {
  let npv = -capex;
  for (let year = 1; year <= projectLifeYears; year++) {
    npv += annualSavings / Math.pow(1 + discountRate, year);
  }
  return npv;
}

export function calculatePayback(capex: number, annualSavings: number): number {
  if (annualSavings <= 0) return Infinity;
  return capex / annualSavings;
}

export function calculateAbatementCost(
  capex: number,
  annualSavings: number,
  tco2eAvoidedYear: number,
  discountRate: number = 0.05,
  projectLifeYears: number = 15
): number {
  const annualizedCapex = capex * (discountRate * Math.pow(1 + discountRate, projectLifeYears)) /
    (Math.pow(1 + discountRate, projectLifeYears) - 1);
  const netAnnualCost = annualizedCapex - annualSavings;
  if (tco2eAvoidedYear <= 0) return Infinity;
  return netAnnualCost / tco2eAvoidedYear;
}

// ============================================================================
// Common Constants
// ============================================================================

export const CONSTANTS = {
  // Physics
  SECONDS_PER_HOUR: 3600,
  SECONDS_PER_DAY: 86400,
  JOULES_PER_KWH: 3.6e6,
  WATTS_PER_KW: 1000,

  // Default RC model parameters (typical office building)
  DEFAULT_R: 0.002, // K/W
  DEFAULT_C: 1.5e7, // J/K
  DEFAULT_WINDOW_FACTOR: 0.15,
  DEFAULT_COP_BASE: 3.5,
  DEFAULT_COP_TEMP_COEFF: -0.05, // COP decreases as outdoor temp rises
  DEFAULT_INTERNAL_GAINS_W: 5000, // 5 kW

  // Comfort
  DEFAULT_COMFORT_MIN: 22,
  DEFAULT_COMFORT_MAX: 26,

  // Data quality thresholds
  MAX_GAP_MINUTES: 60,
  OUTLIER_ZSCORE_THRESHOLD: 3.5,
  MAX_POWER_CHANGE_PCT_PER_INTERVAL: 50,

  // API limits
  MAX_UPLOAD_SIZE_MB: 50,
  MAX_FORECAST_HORIZON_HOURS: 168,
  MAX_HISTORY_DAYS: 365 * 5,

  // Cache TTLs (seconds)
  CI_CACHE_TTL: 300, // 5 minutes
  WEATHER_CACHE_TTL: 600, // 10 minutes
  FORECAST_CACHE_TTL: 3600, // 1 hour

  // Replay
  DEFAULT_REPLAY_SPEED: 1440, // 1 day = 60 seconds

  // Emissions
  KG_PER_TONNE: 1000,
} as const;

// ============================================================================
// Zod Helpers
// ============================================================================

export const UUIDSchema = z.string().uuid();
export const ISO8601Schema = z.string().datetime({ offset: true });
export const NonEmptyStringSchema = z.string().min(1);
export const PositiveNumberSchema = z.number().positive();
export const NonNegativeNumberSchema = z.number().nonnegative();
export const PercentSchema = z.number().min(0).max(100);
export const RatioSchema = z.number().min(0).max(1);

export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export const DateRangeSchema = z.object({
  from: ISO8601Schema,
  to: ISO8601Schema,
});

export type DateRange = z.infer<typeof DateRangeSchema>;