/**
 * Data-quality report builder (FR-5).
 * Assembles the JSON consumed by the UI's QualityReportPanel and stored with
 * every facility. All numbers are derived from the cleaning stage results.
 */

import type { DataQualityReport, QualityIssue } from '@carbontwin/shared';
import { mean, median, stdDev } from '../utils/stats.js';
import type { ColumnProfile, DetectedSchema } from '../types.js';
import type { IntervalValidationResult } from '../validators/intervalValidator.js';
import type { MapRowsResult } from '../parsers/columnMapper.js';

export interface QualityReportInput {
  facilityId: string;
  schema: DetectedSchema;
  mappingStats: MapRowsResult['stats'];
  mappingWarnings: string[];
  interval: IntervalValidationResult;
  outlierCount: number;
  imputedCount: number;
  interpolatedCount: number;
  syntheticCount: number;
  totalRows: number;
  validRows: number;
  dateRange: { start: string; end: string };
  values: number[];
}

function powerProfile(values: number[]): DataQualityReport['columnProfile']['power'] {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    min: finite.length ? Math.min(...finite) : 0,
    max: finite.length ? Math.max(...finite) : 0,
    mean: finite.length ? mean(finite) : 0,
    median: finite.length ? median(finite) : 0,
    stdDev: finite.length ? stdDev(finite) : 0,
    unit: 'kW',
    negativeCount: finite.filter((v) => v < 0).length,
    zeroCount: finite.filter((v) => v === 0).length,
  };
}

function timestampProfile(schema: DetectedSchema, parsed: number, errors: number): DataQualityReport['columnProfile']['timestamp'] {
  return {
    parsedSuccessfully: parsed,
    parseErrors: errors,
    format: schema.timestampFormat ?? 'unknown',
    timezone: schema.timezone,
  };
}

/** Build the issues list with severities and actionable suggestions. */
function collectIssues(input: QualityReportInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const { interval, mappingStats, outlierCount } = input;

  if (interval.missingIntervals > 0) {
    const pct = input.totalRows > 0 ? (interval.missingIntervals / (input.totalRows + interval.missingIntervals)) * 100 : 0;
    issues.push({
      type: 'missing_interval',
      severity: pct > 10 ? 'error' : 'warning',
      count: interval.missingIntervals,
      affectedTimestamps: interval.gaps.slice(0, 3).map((g) => g.start),
      description: `${interval.missingIntervals} missing interval(s) found (${pct.toFixed(1)}% of the expected grid).`,
      suggestion: 'Gaps were filled using interpolation where short and a learned daily profile for longer gaps.',
    });
  }

  if (interval.duplicateCount > 0) {
    issues.push({
      type: 'duplicate_timestamp',
      severity: 'warning',
      count: interval.duplicateCount,
      affectedTimestamps: interval.duplicates.slice(0, 3),
      description: `${interval.duplicateCount} duplicate timestamp(s) were detected and merged by averaging.`,
      suggestion: 'Check the source export for overlapping meter reads.',
    });
  }

  if (interval.irregularCount > 0) {
    issues.push({
      type: 'irregular_interval',
      severity: 'info',
      count: interval.irregularCount,
      description: `${interval.irregularCount} reading(s) were off the expected ${interval.dominantIntervalMinutes}-minute cadence.`,
      suggestion: 'Readings were snapped to the nearest 15-minute slot.',
    });
  }

  if (outlierCount > 0) {
    issues.push({
      type: 'outlier',
      severity: 'warning',
      count: outlierCount,
      description: `${outlierCount} statistical outlier(s) were detected (robust z-score / rate-of-change).`,
      suggestion: 'Outliers were replaced with interpolated values so they do not distort forecasting.',
    });
  }

  if (mappingStats.negativePowerRows > 0) {
    issues.push({
      type: 'negative_power',
      severity: 'info',
      count: mappingStats.negativePowerRows,
      description: `${mappingStats.negativePowerRows} negative reading(s) — likely on-site generation exporting to the grid.`,
      suggestion: 'Confirm whether the meter is bidirectional; negatives are preserved but flagged.',
    });
  }

  if (mappingStats.invalidTimestampRows > 0) {
    issues.push({
      type: 'timezone_ambiguity',
      severity: 'error',
      count: mappingStats.invalidTimestampRows,
      description: `${mappingStats.invalidTimestampRows} row(s) had unparseable timestamps and were dropped.`,
      suggestion: `Confirm the timestamp format and timezone (${input.schema.timezone}).`,
    });
  }

  if (mappingStats.invalidPowerRows > 0) {
    issues.push({
      type: 'unit_mismatch',
      severity: 'warning',
      count: mappingStats.invalidPowerRows,
      description: `${mappingStats.invalidPowerRows} row(s) had a non-numeric power value and were dropped.`,
      suggestion: 'Ensure missing values are blank rather than text such as "N/A".',
    });
  }

  return issues;
}

function recommendationsFor(input: QualityReportInput): string[] {
  const recs: string[] = [];
  const { interval, schema, mappingStats } = input;

  if (schema.confidence < 0.7) {
    recs.push('Schema detection confidence is low — please verify the detected columns and unit in the mapping step.');
  }
  if (interval.regularityScore < 0.9) {
    recs.push('Consider exporting the meter data on a fixed 15-minute schedule to improve forecast accuracy.');
  }
  if (input.imputedCount + input.syntheticCount > input.validRows * 0.2) {
    recs.push('More than 20% of intervals were filled. Results are still usable but treat forecasts with added caution.');
  }
  if (mappingStats.dstAdjusted > 0) {
    recs.push('Daylight-saving transitions were detected and normalised to UTC — verify a sample of timestamps.');
  }
  if (recs.length === 0) recs.push('Data quality looks good — no action required.');
  return recs;
}

export function buildQualityReport(input: QualityReportInput): DataQualityReport {
  const issues = collectIssues(input);
  const profile = powerProfile(input.values);

  return {
    facilityId: input.facilityId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRows: input.totalRows,
      validRows: input.validRows,
      missingIntervals: input.interval.missingIntervals,
      duplicateTimestamps: input.interval.duplicateCount,
      outliersDetected: input.outlierCount,
      imputedRows: input.imputedCount + input.interpolatedCount + input.syntheticCount,
      dateRange: input.dateRange,
      actualIntervalMinutes: input.interval.dominantIntervalMinutes,
      expectedIntervalMinutes: 15,
      regularityScore: Number(input.interval.regularityScore.toFixed(4)),
    },
    issues,
    columnProfile: {
      timestamp: timestampProfile(
        input.schema,
        input.totalRows - input.mappingStats.invalidTimestampRows,
        input.mappingStats.invalidTimestampRows
      ),
      power: profile,
    },
    recommendations: recommendationsFor(input),
  };
}

/** Compact 0–100 score for at-a-glance UI badges. */
export function qualityScore(report: DataQualityReport): number {
  const completeness = report.summary.totalRows + report.summary.missingIntervals > 0
    ? report.summary.validRows / (report.summary.totalRows + report.summary.missingIntervals)
    : 1;
  const errorPenalty = report.issues.filter((i) => i.severity === 'error').length * 0.1;
  const warningPenalty = report.issues.filter((i) => i.severity === 'warning').length * 0.03;
  const score = completeness * 0.6 + report.summary.regularityScore * 0.4 - errorPenalty - warningPenalty;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}
