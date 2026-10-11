/**
 * Internal data-model types for the ingestion layer.
 * These are lower-level than the shared zod schemas and are used to pass
 * data between parsers → validators → cleaning → store.
 */

import type { PowerUnit, EnergyUnit } from '@carbontwin/shared';

/** A single parsed row keyed by original column header. */
export type RawRow = Record<string, string | number | boolean | null>;

/** Output of any parser (csv / parquet). */
export interface ParsedTable {
  /** Original column headers, in order. */
  headers: string[];
  /** Parsed data rows. */
  rows: RawRow[];
  /** Detected delimiter (csv only). */
  delimiter: string;
  /** Declared / detected encoding. */
  encoding: string;
  /** Number of data rows (excludes header). */
  rowCount: number;
}

export interface ColumnProfile {
  name: string;
  inferredType: 'timestamp' | 'numeric' | 'boolean' | 'string' | 'unknown';
  confidence: number;
  /** First few non-empty values for previewing. */
  sampleValues: string[];
  nullCount: number;
  /** For numeric columns. */
  stats?: {
    min: number;
    max: number;
    mean: number;
    median: number;
    stdDev: number;
    negativeCount: number;
    zeroCount: number;
  };
  /** For timestamp candidates. */
  timestampFormat?: string;
}

/** Result of schema auto-detection. */
export interface DetectedSchema {
  /** Header chosen as the timestamp column. */
  timestampColumn: string | null;
  /** Header chosen as the power/energy column. */
  powerColumn: string | null;
  /** Other numeric columns kept as auxiliary series. */
  auxiliaryColumns: string[];
  timestampFormat: string | null;
  timezone: string;
  unit: PowerUnit | EnergyUnit | null;
  /** Whether the value column is energy (Wh/kWh…) rather than power. */
  isEnergy: boolean;
  /** Detected sampling interval in minutes (rounded). */
  intervalMinutes: number;
  confidence: number;
  columnProfiles: ColumnProfile[];
  warnings: string[];
}

/** A reading after unit normalisation but before resampling. */
export interface NormalizedReading {
  /** UTC ISO-8601 timestamp. */
  timestampUtc: string;
  /** Normalised average power in kW. */
  powerKw: number;
  /** Quality flags found for this row. */
  flags: string[];
}

export type QualityKind = 'measured' | 'imputed' | 'interpolated' | 'synthetic';

/** A point on the canonical 15-minute grid. */
export interface GridPoint {
  timestampUtc: string;
  powerKw: number;
  quality: QualityKind;
  flags: string[];
}

/** A single slot on the canonical grid; `powerKw` may be missing before imputation. */
export interface GridSlot {
  timestampUtc: string;
  powerKw: number | null;
  quality: QualityKind | 'missing';
  flags: string[];
}

/** A stored time-series record (mirrors the DB row). */
export interface TimeseriesRecord {
  facilityId: string;
  timestamp: string; // ISO UTC
  powerKw: number;
  emissionsKg: number | null;
  carbonIntensity: number | null; // gCO2/kWh
  quality: 'measured' | 'imputed' | 'interpolated' | 'synthetic';
  flags: string[];
}

export interface DateRange {
  start: Date;
  end: Date;
}

/** Options shared across the cleaning steps. */
export interface CleaningOptions {
  resampleTo15min: boolean;
  fillGaps: boolean;
  removeOutliers: boolean;
  /** Max gap (minutes) that may be interpolated; larger gaps use a profile. */
  maxInterpolationGapMinutes: number;
  outlierZScoreThreshold: number;
}

export const DEFAULT_CLEANING_OPTIONS: CleaningOptions = {
  resampleTo15min: true,
  fillGaps: true,
  removeOutliers: true,
  maxInterpolationGapMinutes: 120,
  outlierZScoreThreshold: 3.5,
};
