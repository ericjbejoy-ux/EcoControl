/**
 * Time-series repository (store/timeseries.repo.ts).
 * Stores canonical 15-minute records per facility. Records are kept sorted and
 * de-duplicated by timestamp; queries support range + resolution downsampling.
 */

import type { TimeseriesRecord } from '../types.js';
import type { LocalDatabase } from '../db/client.js';
import { floorToInterval } from '../utils/time.js';
import { round } from '../utils/stats.js';

export interface TimeseriesQuery {
  from?: string;
  to?: string;
  /** Downsample bucket size in minutes (default: native 15 min). */
  resolutionMinutes?: number;
  limit?: number;
}

export interface TimeseriesStats {
  count: number;
  start: string | null;
  end: string | null;
  totalEnergyKwh: number;
  totalEmissionsKg: number;
  peakKw: number;
}

export class TimeseriesRepository {
  constructor(private readonly db: LocalDatabase) {}

  private bucket(facilityId: string): TimeseriesRecord[] {
    const store = this.db.schema.timeseries;
    if (!store[facilityId]) store[facilityId] = [];
    return store[facilityId] as TimeseriesRecord[];
  }

  /** Replace the full series for a facility (used by the ingestion pipeline). */
  async replaceAll(facilityId: string, records: TimeseriesRecord[]): Promise<number> {
    const sorted = this.sortAndDedupe(records);
    this.db.schema.timeseries[facilityId] = sorted;
    this.db.touch();
    return sorted.length;
  }

  /** Append records, merging by timestamp (latest wins). */
  async insertMany(facilityId: string, records: TimeseriesRecord[]): Promise<number> {
    const bucket = this.bucket(facilityId);
    const merged = this.sortAndDedupe([...bucket, ...records]);
    this.db.schema.timeseries[facilityId] = merged;
    this.db.touch();
    return records.length;
  }

  private sortAndDedupe(records: TimeseriesRecord[]): TimeseriesRecord[] {
    const byTs = new Map<string, TimeseriesRecord>();
    for (const record of records) {
      const key = new Date(record.timestamp).toISOString();
      byTs.set(key, { ...record, timestamp: key });
    }
    return [...byTs.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  async query(facilityId: string, query: TimeseriesQuery = {}): Promise<TimeseriesRecord[]> {
    const bucket = this.bucket(facilityId);
    const fromMs = query.from ? Date.parse(query.from) : -Infinity;
    const toMs = query.to ? Date.parse(query.to) : Infinity;
    const filtered = bucket.filter((r) => {
      const ms = Date.parse(r.timestamp);
      return ms >= fromMs && ms <= toMs;
    });

    const resolution = query.resolutionMinutes ?? 15;
    const output = resolution > 15 ? this.downsample(filtered, resolution) : filtered;
    const limit = query.limit ?? output.length;
    if (output.length <= limit) return output;
    // Return the most recent `limit` points.
    return output.slice(output.length - limit);
  }

  private downsample(records: TimeseriesRecord[], resolutionMinutes: number): TimeseriesRecord[] {
    const buckets = new Map<number, TimeseriesRecord[]>();
    for (const record of records) {
      const key = floorToInterval(new Date(record.timestamp), resolutionMinutes).getTime();
      const bucket = buckets.get(key);
      if (bucket) bucket.push(record);
      else buckets.set(key, [record]);
    }
    const out: TimeseriesRecord[] = [];
    for (const [ms, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const avgPower = bucket.reduce((a, b) => a + b.powerKw, 0) / bucket.length;
      const emissions = bucket.reduce((a, b) => a + (b.emissionsKg ?? 0), 0);
      const ci = bucket.reduce((a, b) => a + (b.carbonIntensity ?? 0), 0) / bucket.length;
      const quality = bucket.some((b) => b.quality === 'synthetic')
        ? 'synthetic'
        : bucket.some((b) => b.quality === 'imputed')
          ? 'imputed'
          : bucket.some((b) => b.quality === 'interpolated')
            ? 'interpolated'
            : 'measured';
      out.push({
        facilityId: bucket[0]!.facilityId,
        timestamp: new Date(ms).toISOString(),
        powerKw: round(avgPower, 4),
        emissionsKg: round(emissions, 4),
        carbonIntensity: round(ci, 2),
        quality,
        flags: [...new Set(bucket.flatMap((b) => b.flags))],
      });
    }
    return out;
  }

  async latest(facilityId: string): Promise<TimeseriesRecord | null> {
    const bucket = this.bucket(facilityId);
    return bucket.length ? (bucket[bucket.length - 1] ?? null) : null;
  }

  async first(facilityId: string): Promise<TimeseriesRecord | null> {
    const bucket = this.bucket(facilityId);
    return bucket[0] ?? null;
  }

  async count(facilityId: string): Promise<number> {
    return this.bucket(facilityId).length;
  }

  async deleteForFacility(facilityId: string): Promise<number> {
    const bucket = this.bucket(facilityId);
    const removed = bucket.length;
    this.db.schema.timeseries[facilityId] = [];
    this.db.touch();
    return removed;
  }

  async stats(facilityId: string): Promise<TimeseriesStats> {
    const bucket = this.bucket(facilityId);
    if (bucket.length === 0) {
      return { count: 0, start: null, end: null, totalEnergyKwh: 0, totalEmissionsKg: 0, peakKw: 0 };
    }
    let totalEnergy = 0;
    let totalEmissions = 0;
    let peak = 0;
    for (const record of bucket) {
      totalEnergy += record.powerKw * 0.25;
      totalEmissions += record.emissionsKg ?? 0;
      if (record.powerKw > peak) peak = record.powerKw;
    }
    return {
      count: bucket.length,
      start: bucket[0]!.timestamp,
      end: bucket[bucket.length - 1]!.timestamp,
      totalEnergyKwh: round(totalEnergy, 3),
      totalEmissionsKg: round(totalEmissions, 3),
      peakKw: round(peak, 3),
    };
  }
}
