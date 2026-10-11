/**
 * End-to-end ingest pipeline test (FR-1 → FR-5).
 * A messy CSV (deliberate gap + spike) must become a cleaning, quality-scored
 * facility with a stored 15-minute series and a quality report.
 */

import { describe, it, expect } from 'vitest';
import { runIngestPipeline } from '../pipeline/ingestPipeline.js';
import { memoryStore, silentLogger, testConfig, makePowerCsv } from './helpers.js';

describe('ingest pipeline (e2e)', () => {
  it('turns a messy CSV into a stored facility with a quality report', async () => {
    const store = await memoryStore();
    const { content } = makePowerCsv({
      startIso: '2024-03-01T00:00:00Z',
      count: 96, // one full day of 15-minute samples
      power: (i) => (i === 60 ? 900 : 100 + 20 * Math.sin(i / 8)),
      skip: (i) => i >= 40 && i < 44, // 1-hour gap
    });

    const result = await runIngestPipeline({
      fileName: 'meter.csv',
      mimeType: 'text/csv',
      content,
      facility: { name: 'E2E Meter', type: 'office', region: 'IN-MH' },
      store,
      config: testConfig(),
      logger: silentLogger,
    });

    expect(result.facilityId).toBeTruthy();
    expect(result.facility.name).toBe('E2E Meter');
    expect(result.facility.isDemo).toBe(false);
    expect(result.mapping.unit).toBe('kW');
    expect(result.totals.kwh).toBeGreaterThan(0);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);

    // Grid is fully reconstructed (missing slots imputed).
    const stored = await store.timeseries.query(result.facilityId, {});
    expect(stored).toHaveLength(96);
    expect(stored[0]?.timestamp).toBe('2024-03-01T00:00:00.000Z');
    expect(stored.every((r) => Number.isFinite(r.powerKw))).toBe(true);

    const report = await store.facilities.getQualityReport(result.facilityId);
    expect(report).not.toBeNull();
    const types = report!.issues.map((issue) => issue.type);
    expect(types).toContain('missing_interval');
    expect(types).toContain('outlier');
    expect(report!.summary.validRows).toBeGreaterThan(0);
    // The quality profile describes the cleaned series (the spike was replaced).
    expect(report!.columnProfile.power.max).toBeGreaterThan(0);
    expect(report!.columnProfile.power.max).toBeLessThan(900);
  });

  it('records emissions when a carbon-intensity series is supplied', async () => {
    const store = await memoryStore();
    const { content, timestamps } = makePowerCsv({
      startIso: '2024-03-01T00:00:00Z',
      count: 96,
      power: () => 100,
    });
    const carbonIntensity = timestamps.map((timestamp) => ({
      timestamp,
      carbonIntensity: 500,
      isForecast: false,
      dataSource: 'synthetic' as const,
      region: 'IN-MH',
    }));

    const result = await runIngestPipeline({
      fileName: 'meter.csv',
      mimeType: 'text/csv',
      content,
      facility: { name: 'Emissions Meter', type: 'office', region: 'IN-MH' },
      carbonIntensity,
      store,
      config: testConfig(),
      logger: silentLogger,
    });

    expect(result.totals.emissionsKg).toBeGreaterThan(0);
    expect(result.totals.dynamicVsStaticDifferencePct).not.toBeNull();
    const stored = await store.timeseries.query(result.facilityId, {});
    expect(stored[0]?.carbonIntensity).toBe(500);
    expect(stored[0]?.emissionsKg).toBeCloseTo(12.5, 3);
  });

  it('rejects an unsupported file type', async () => {
    const store = await memoryStore();
    await expect(
      runIngestPipeline({
        fileName: 'notes.txt',
        content: Buffer.from('hello world'),
        store,
        config: testConfig(),
        logger: silentLogger,
      })
    ).rejects.toThrow(/only csv and parquet/i);
  });

  it('rejects a dataset with no detectable power column', async () => {
    const store = await memoryStore();
    const content = Buffer.from('timestamp,note\n2024-01-01T00:00:00Z,hello\n');
    await expect(
      runIngestPipeline({
        fileName: 'x.csv',
        mimeType: 'text/csv',
        content,
        store,
        config: testConfig(),
        logger: silentLogger,
      })
    ).rejects.toThrow();
  });
});
