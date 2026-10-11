/**
 * Tests for the data-quality report builder + score (FR-5).
 */

import { describe, it, expect } from 'vitest';
import { buildQualityReport, qualityScore, type QualityReportInput } from '../pipeline/qualityReport.js';
import { validateIntervals } from '../validators/intervalValidator.js';
import type { DetectedSchema } from '../types.js';
import type { MapRowsResult } from '../parsers/columnMapper.js';

const FACILITY_ID = '11111111-1111-4111-8111-111111111111';

function schema(): DetectedSchema {
  return {
    timestampColumn: 'timestamp',
    powerColumn: 'Active Power (kW)',
    auxiliaryColumns: [],
    timestampFormat: 'iso',
    timezone: 'UTC',
    unit: 'kW',
    isEnergy: false,
    intervalMinutes: 15,
    confidence: 0.95,
    columnProfiles: [],
    warnings: [],
  };
}

function mappingStats(overrides: Partial<MapRowsResult['stats']> = {}): MapRowsResult['stats'] {
  return {
    totalRows: 40,
    validRows: 40,
    droppedRows: 0,
    invalidTimestampRows: 0,
    invalidPowerRows: 0,
    negativePowerRows: 0,
    dstAdjusted: 0,
    ...overrides,
  };
}

const at = (minutes: number) => Date.parse('2024-01-01T00:00:00.000Z') + minutes * 60_000;

function baseInput(overrides: Partial<QualityReportInput> = {}): QualityReportInput {
  const timestamps = Array.from({ length: 40 }, (_, i) => at(i * 15));
  const interval = validateIntervals(timestamps, 15);
  return {
    facilityId: FACILITY_ID,
    schema: schema(),
    mappingStats: mappingStats({ totalRows: timestamps.length, validRows: timestamps.length }),
    mappingWarnings: [],
    interval,
    outlierCount: 0,
    imputedCount: 0,
    interpolatedCount: 0,
    syntheticCount: 0,
    totalRows: timestamps.length,
    validRows: timestamps.length,
    dateRange: { start: new Date(at(0)).toISOString(), end: new Date(at(39 * 15)).toISOString() },
    values: timestamps.map((_, i) => 100 + i),
    ...overrides,
  };
}

describe('buildQualityReport', () => {
  it('summarises a clean series with no issues', () => {
    const report = buildQualityReport(baseInput());
    expect(report.facilityId).toBe(FACILITY_ID);
    expect(report.summary.totalRows).toBe(40);
    expect(report.summary.missingIntervals).toBe(0);
    expect(report.summary.expectedIntervalMinutes).toBe(15);
    expect(report.summary.regularityScore).toBe(1);
    expect(report.issues).toHaveLength(0);
    expect(report.columnProfile.power.unit).toBe('kW');
    expect(report.columnProfile.power.max).toBe(139);
    expect(report.columnProfile.timestamp.parsedSuccessfully).toBe(40);
    expect(report.recommendations).toContain('Data quality looks good — no action required.');
  });

  it('reports missing intervals, duplicates and outliers', () => {
    const timestamps = [at(0), at(0), at(15), at(75)]; // duplicate + 1 h gap
    const interval = validateIntervals(timestamps, 15);
    const report = buildQualityReport(
      baseInput({
        interval,
        outlierCount: 2,
        imputedCount: 1,
        interpolatedCount: 3,
        mappingStats: mappingStats({ negativePowerRows: 1 }),
      })
    );
    const types = report.issues.map((issue) => issue.type);
    expect(types).toContain('missing_interval');
    expect(types).toContain('duplicate_timestamp');
    expect(types).toContain('outlier');
    expect(types).toContain('negative_power');
    expect(report.summary.missingIntervals).toBeGreaterThan(0);
    expect(report.summary.duplicateTimestamps).toBe(1);
    expect(report.summary.outliersDetected).toBe(2);
    expect(report.summary.imputedRows).toBe(4);
  });

  it('escalates unparseable timestamps to an error issue', () => {
    const report = buildQualityReport(
      baseInput({ mappingStats: mappingStats({ invalidTimestampRows: 5, validRows: 35 }) })
    );
    const issue = report.issues.find((i) => i.type === 'timezone_ambiguity');
    expect(issue?.severity).toBe('error');
    expect(issue?.count).toBe(5);
    expect(report.columnProfile.timestamp.parseErrors).toBe(5);
  });

  it('adds an imputation recommendation when >20% was filled', () => {
    const report = buildQualityReport(baseInput({ imputedCount: 20, validRows: 40 }));
    expect(report.recommendations.some((r) => r.includes('20%'))).toBe(true);
  });
});

describe('qualityScore', () => {
  it('returns 100 for a perfectly clean report', () => {
    expect(qualityScore(buildQualityReport(baseInput()))).toBe(100);
  });

  it('penalises error and warning issues', () => {
    const timestamps = [at(0), at(0), at(15), at(75)];
    const report = buildQualityReport(
      baseInput({
        interval: validateIntervals(timestamps, 15),
        outlierCount: 1,
        mappingStats: mappingStats({ invalidTimestampRows: 3, validRows: 37 }),
      })
    );
    const score = qualityScore(report);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
  });
});
