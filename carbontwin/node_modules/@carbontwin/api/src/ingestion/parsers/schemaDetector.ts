/**
 * Schema auto-detection (FR-1).
 * Given a `ParsedTable`, works out which column holds the timestamp and which
 * holds the power/energy value, together with the unit, timezone and interval.
 * Detection is heuristic + scored, and every decision is explainable via the
 * returned `columnProfiles` and `warnings`.
 */

import { DateTime } from 'luxon';
import { mean, median, stdDev } from '../utils/stats.js';
import type { ColumnProfile, DetectedSchema, ParsedTable, RawRow } from '../types.js';

// ---------------------------------------------------------------------------
// Keyword hints
// ---------------------------------------------------------------------------

const TIMESTAMP_HINTS = [
  'timestamp', 'datetime', 'date_time', 'time', 'date', 'period', 'reading_time',
  'interval_start', 'start', 'ts', 'epoch', 'log_time', 'meter_time', 'utc',
];

const POWER_HINTS = [
  'power', 'demand', 'load', 'consumption', 'energy', 'usage', 'electric',
  'meter', 'active', 'kw', 'kwh', 'mw', 'mwh', 'w', 'apparent', 'real',
];

const NEGATIVE_METER_HINTS = ['temperature', 'temp', 'humidity', 'rh', 'irradiance',
  'solar', 'wind', 'pressure', 'speed', 'occupancy', 'price', 'tariff', 'voltage',
  'current', 'frequency', 'powerfactor', 'power_factor', 'lat', 'lon'];

function scoreNameHint(header: string, hints: string[]): number {
  const normalised = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  let score = 0;
  for (const hint of hints) {
    const h = hint.replace(/[^a-z0-9]/g, '');
    if (normalised === h) score += 3;
    else if (normalised.includes(h)) score += h.length >= 3 ? 1.5 : 0.75;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Unit detection
// ---------------------------------------------------------------------------

export interface UnitDetection {
  unit: 'W' | 'kW' | 'MW' | 'Wh' | 'kWh' | 'MWh';
  isEnergy: boolean;
  confidence: number;
}

/** Detect the unit from a header such as "Active Power (kW)" or "energy_kwh". */
export function detectUnitFromHeader(header: string): UnitDetection | null {
  const h = header.toLowerCase();
  // Longest / most specific tokens first.
  const checks: Array<[RegExp, UnitDetection]> = [
    [/\bkwh\b|kwh|kilowatt.?hour/, { unit: 'kWh', isEnergy: true, confidence: 0.95 }],
    [/\bmwh\b|mwh|megawatt.?hour/, { unit: 'MWh', isEnergy: true, confidence: 0.95 }],
    [/\bwh\b|(?<![km])wh(?!h)|watt.?hour/, { unit: 'Wh', isEnergy: true, confidence: 0.8 }],
    [/\bkw\b|kw(?!h)|kilowatt(?!.?hour)/, { unit: 'kW', isEnergy: false, confidence: 0.95 }],
    [/\bmw\b|mw(?!h)|megawatt(?!.?hour)/, { unit: 'MW', isEnergy: false, confidence: 0.9 }],
    [/\bw\b|(?:^|[^kmg])w(?!h)|watt(?!.?hour)/, { unit: 'W', isEnergy: false, confidence: 0.7 }],
  ];
  for (const [pattern, detection] of checks) {
    if (pattern.test(h)) return detection;
  }
  return null;
}

/**
 * Fallback unit inference from the numeric magnitude of the series.
 * Used only when the header gives no explicit unit.
 */
export function inferUnitFromMagnitude(values: number[], isEnergyHeader: boolean): UnitDetection {
  const med = median(values);
  const isEnergy = isEnergyHeader;
  if (isEnergy) {
    // Energy readings: Wh if huge, MWh if tiny, else kWh.
    if (med > 20_000) return { unit: 'Wh', isEnergy, confidence: 0.4 };
    if (med < 2) return { unit: 'MWh', isEnergy, confidence: 0.4 };
    return { unit: 'kWh', isEnergy, confidence: 0.5 };
  }
  if (med > 5_000) return { unit: 'W', isEnergy, confidence: 0.4 };
  if (med < 1) return { unit: 'MW', isEnergy, confidence: 0.35 };
  return { unit: 'kW', isEnergy, confidence: 0.5 };
}

// ---------------------------------------------------------------------------
// Timestamp format detection
// ---------------------------------------------------------------------------

export const TIMESTAMP_FORMATS: string[] = [
  "yyyy-MM-dd'T'HH:mm:ss.SSS",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm",
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'yyyy/MM/dd HH:mm:ss',
  'yyyy/MM/dd HH:mm',
  'MM/dd/yyyy HH:mm:ss',
  'MM/dd/yyyy HH:mm',
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy HH:mm',
  'dd.MM.yyyy HH:mm:ss',
  'dd.MM.yyyy HH:mm',
  'MM-dd-yyyy HH:mm',
  'yyyyMMddHHmm',
];

const EPOCH_SECONDS_RE = /^\d{10}$/;
const EPOCH_MILLIS_RE = /^\d{13}$/;

export interface TimestampFormatResult {
  format: string;
  /** 'iso' | 'luxon' | 'epoch_s' | 'epoch_ms' */
  kind: 'iso' | 'luxon' | 'epoch_s' | 'epoch_ms';
  parseRate: number;
}

/** Determine the best timestamp format for a set of sample strings. */
export function detectTimestampFormat(samples: string[]): TimestampFormatResult | null {
  const clean = samples.filter((s) => s != null && String(s).trim() !== '');
  if (clean.length === 0) return null;

  // ISO with offset (e.g. 2024-01-01T00:00:00+05:30)
  const isoRate = clean.filter((s) => DateTime.fromISO(String(s), { setZone: true }).isValid).length / clean.length;
  if (isoRate >= 0.9) return { format: 'iso', kind: 'iso', parseRate: isoRate };

  let best: TimestampFormatResult | null = null;
  for (const format of TIMESTAMP_FORMATS) {
    const ok = clean.filter((s) => DateTime.fromFormat(String(s), format).isValid).length;
    const rate = ok / clean.length;
    if (!best || rate > best.parseRate) {
      best = { format, kind: 'luxon', parseRate: rate };
    }
    if (rate === 1) break;
  }
  if (best && best.parseRate >= 0.5) return best;

  const epochS = clean.filter((s) => EPOCH_SECONDS_RE.test(String(s).trim())).length / clean.length;
  if (epochS >= 0.9) return { format: 'epoch_s', kind: 'epoch_s', parseRate: epochS };

  const epochMs = clean.filter((s) => EPOCH_MILLIS_RE.test(String(s).trim())).length / clean.length;
  if (epochMs >= 0.9) return { format: 'epoch_ms', kind: 'epoch_ms', parseRate: epochMs };

  return best && best.parseRate > 0 ? best : null;
}

// ---------------------------------------------------------------------------
// Column profiling
// ---------------------------------------------------------------------------

function stringValues(rows: RawRow[], column: string, max = 5000): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length && out.length < max; i++) {
    const v = (rows[i] as RawRow)[column];
    if (v !== null && v !== undefined && String(v).trim() !== '') out.push(String(v));
  }
  return out;
}

export function profileColumn(rows: RawRow[], column: string): ColumnProfile {
  const nonEmpty = stringValues(rows, column);
  const nullCount = rows.length - nonEmpty.length;

  const numeric = nonEmpty.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  const numericRate = nonEmpty.length > 0 ? numeric.length / nonEmpty.length : 0;

  const tsResult = numericRate >= 0.9 && nonEmpty.every((v) => EPOCH_SECONDS_RE.test(v) || EPOCH_MILLIS_RE.test(v))
    ? detectTimestampFormat(nonEmpty)
    : detectTimestampFormat(nonEmpty);

  const timestampRate = tsResult?.parseRate ?? 0;

  let inferredType: ColumnProfile['inferredType'] = 'string';
  let confidence = 0.5;

  if (timestampRate >= 0.8 && timestampRate >= numericRate) {
    inferredType = 'timestamp';
    confidence = timestampRate;
  } else if (numericRate >= 0.8) {
    inferredType = 'numeric';
    confidence = numericRate;
  } else if (nonEmpty.length > 0 && nonEmpty.every((v) => /^(true|false|0|1)$/i.test(v))) {
    inferredType = 'boolean';
    confidence = 0.7;
  } else if (nonEmpty.length === 0) {
    inferredType = 'unknown';
    confidence = 0;
  }

  const profile: ColumnProfile = {
    name: column,
    inferredType,
    confidence,
    sampleValues: nonEmpty.slice(0, 5),
    nullCount,
  };

  if (inferredType === 'numeric' && numeric.length > 0) {
    profile.stats = {
      min: Math.min(...numeric),
      max: Math.max(...numeric),
      mean: mean(numeric),
      median: median(numeric),
      stdDev: stdDev(numeric),
      negativeCount: numeric.filter((v) => v < 0).length,
      zeroCount: numeric.filter((v) => v === 0).length,
    };
  }
  if (inferredType === 'timestamp' && tsResult) {
    profile.timestampFormat = tsResult.format;
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Interval detection
// ---------------------------------------------------------------------------

function parseSampleToMillis(value: string, format: string, kind: string, zone: string): number | null {
  if (kind === 'epoch_s') return Number(value) * 1000;
  if (kind === 'epoch_ms') return Number(value);
  if (kind === 'iso') {
    const dt = DateTime.fromISO(value, { setZone: true });
    return dt.isValid ? dt.toMillis() : null;
  }
  const dt = DateTime.fromFormat(value, format, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

/** Estimate the sampling interval (minutes) from a timestamp column. */
export function detectIntervalMinutes(
  rows: RawRow[],
  column: string,
  format: string,
  kind: string,
  zone: string
): number {
  const values = stringValues(rows, column, 200);
  const millis = values
    .map((v) => parseSampleToMillis(v, format, kind, zone))
    .filter((v): v is number => v !== null);
  if (millis.length < 2) return 15;

  const deltas: number[] = [];
  for (let i = 1; i < millis.length; i++) {
    const d = (millis[i] as number) - (millis[i - 1] as number);
    if (d > 0) deltas.push(d / 60000);
  }
  if (deltas.length === 0) return 15;
  const med = median(deltas);
  return Math.max(1, Math.round(med));
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

export interface DetectSchemaOptions {
  /** Pre-supplied timezone (from region); default UTC. */
  timezone?: string;
  /** Pre-supplied unit override. */
  unit?: UnitDetection['unit'];
  /** Explicit column overrides (skip heuristics). */
  timestampColumn?: string;
  powerColumn?: string;
}

export function detectSchema(table: ParsedTable, options: DetectSchemaOptions = {}): DetectedSchema {
  const zone = options.timezone ?? 'UTC';
  const warnings: string[] = [];
  const profiles = table.headers.map((h) => profileColumn(table.rows, h));

  const byName = new Map(profiles.map((p) => [p.name, p]));

  // ---- timestamp column --------------------------------------------------
  let timestampColumn = options.timestampColumn ?? null;
  if (!timestampColumn) {
    let bestScore = 0;
    for (const p of profiles) {
      if (p.inferredType !== 'timestamp') continue;
      const score = p.confidence * 10 + scoreNameHint(p.name, TIMESTAMP_HINTS);
      if (score > bestScore) {
        bestScore = score;
        timestampColumn = p.name;
      }
    }
  }
  if (!timestampColumn) {
    // Loosen: any column that parses as ISO even if named oddly.
    const candidate = profiles.find((p) => p.inferredType === 'timestamp');
    timestampColumn = candidate?.name ?? null;
  }

  // ---- power column ------------------------------------------------------
  let powerColumn = options.powerColumn ?? null;
  if (!powerColumn) {
    let bestScore = -Infinity;
    for (const p of profiles) {
      if (p.name === timestampColumn) continue;
      const numericLike = p.inferredType === 'numeric';
      const hasStats = Boolean(p.stats);
      if (!numericLike || !hasStats) continue;
      let score = scoreNameHint(p.name, POWER_HINTS) - scoreNameHint(p.name, NEGATIVE_METER_HINTS);
      // Prefer series with variation (a constant column is unlikely to be load).
      if (p.stats && p.stats.stdDev > 0) score += 1;
      // Penalise near-binary / tiny-integer columns.
      if (p.stats && p.stats.max <= 1) score -= 2;
      if (score > bestScore) {
        bestScore = score;
        powerColumn = p.name;
      }
    }
  }

  // ---- auxiliary columns -------------------------------------------------
  const auxiliaryColumns = profiles
    .filter((p) => p.inferredType === 'numeric' && p.name !== powerColumn && p.name !== timestampColumn)
    .map((p) => p.name);

  // ---- unit --------------------------------------------------------------
  let unit: DetectedSchema['unit'] = options.unit ?? null;
  let isEnergy = false;
  let unitConfidence = 0;
  if (powerColumn) {
    if (options.unit) {
      isEnergy = options.unit === 'Wh' || options.unit === 'kWh' || options.unit === 'MWh';
      unitConfidence = 1;
    } else {
      const headerUnit = detectUnitFromHeader(powerColumn);
      const values = table.rows
        .map((r) => Number((r as RawRow)[powerColumn]))
        .filter((v) => Number.isFinite(v));
      if (headerUnit) {
        unit = headerUnit.unit;
        isEnergy = headerUnit.isEnergy;
        unitConfidence = headerUnit.confidence;
      } else {
        const inferred = inferUnitFromMagnitude(values, false);
        unit = inferred.unit;
        isEnergy = inferred.isEnergy;
        unitConfidence = inferred.confidence;
        warnings.push(
          `No explicit unit found for "${powerColumn}"; assumed ${unit}. Confirm the unit if readings look off.`
        );
      }
    }
  }

  // ---- timestamp format & interval --------------------------------------
  const tsProfile = timestampColumn ? byName.get(timestampColumn) : undefined;
  let format: string | null = tsProfile?.timestampFormat ?? null;
  let kind = 'luxon';
  if (timestampColumn && format) {
    if (format === 'iso') kind = 'iso';
    else if (format === 'epoch_s') kind = 'epoch_s';
    else if (format === 'epoch_ms') kind = 'epoch_ms';
  }

  let intervalMinutes = 15;
  if (timestampColumn && format) {
    intervalMinutes = detectIntervalMinutes(table.rows, timestampColumn, format, kind, zone);
  }

  // ---- confidence --------------------------------------------------------
  const tsScore = tsProfile ? tsProfile.confidence : 0;
  const powerScore = powerColumn && byName.get(powerColumn) ? byName.get(powerColumn)!.confidence : 0;
  const confidence = Math.round(((tsScore * 0.5 + powerScore * 0.3 + unitConfidence * 0.2) * 100)) / 100;

  if (!timestampColumn) warnings.push('No timestamp column detected. Map one manually to continue.');
  if (!powerColumn) warnings.push('No power/energy column detected. Map one manually to continue.');
  if (intervalMinutes !== 15 && intervalMinutes > 0) {
    warnings.push(`Detected a ${intervalMinutes}-minute interval; data will be resampled to 15 minutes.`);
  }

  return {
    timestampColumn,
    powerColumn,
    auxiliaryColumns,
    timestampFormat: format,
    timezone: zone,
    unit,
    isEnergy,
    intervalMinutes,
    confidence,
    columnProfiles: profiles,
    warnings,
  };
}
