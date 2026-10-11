/**
 * Shared test fixtures and utilities.
 * Kept out of the `*.test.ts` glob so it is not collected as a suite.
 */

import { loadIngestionConfig, type IngestionConfig } from '../config.js';
import { LocalDatabase } from '../db/client.js';
import { createStoreFromDatabase, type Store } from '../store/index.js';
import type { Logger } from '../logger.js';

/** Config with network calls disabled and in-memory persistence (fast + hermetic). */
export function testConfig(overrides: Partial<IngestionConfig> = {}): IngestionConfig {
  return {
    ...loadIngestionConfig({}),
    useFallbackData: true,
    persistence: 'memory',
    enableScheduler: false,
    ...overrides,
  };
}

/** A fresh, isolated in-memory store. */
export async function memoryStore(): Promise<Store> {
  const db = await LocalDatabase.open({ filePath: null });
  return createStoreFromDatabase(db);
}

/** A logger that swallows everything so tests stay quiet. */
export const silentLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return silentLogger;
  },
};

/** `count` ISO timestamps on a fixed interval starting at `startIso`. */
export function isoSeries(startIso: string, count: number, intervalMinutes = 15): string[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * intervalMinutes * 60_000).toISOString()
  );
}

export type CsvValue = string | number | null | undefined;

/** Build a UTF-8 CSV buffer from ordered headers and row objects. */
export function makeCsv(headers: string[], rows: Array<Record<string, CsvValue>>): Buffer {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const value = row[h];
          return value === null || value === undefined ? '' : String(value);
        })
        .join(',')
    );
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf-8');
}

/** Build a realistic power-series CSV (timestamp + Active Power kW + outdoor temp). */
export function makePowerCsv(options: {
  startIso: string;
  count: number;
  power: (index: number) => number;
  headers?: string[];
  skip?: (index: number) => boolean;
}): { content: Buffer; headers: string[]; timestamps: string[] } {
  const headers = options.headers ?? ['timestamp', 'Active Power (kW)', 'Outdoor Temperature (C)'];
  const timestamps = isoSeries(options.startIso, options.count);
  const rows: Array<Record<string, CsvValue>> = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (options.skip?.(i)) continue;
    rows.push({
      timestamp: timestamps[i] as string,
      'Active Power (kW)': Math.round(options.power(i) * 1000) / 1000,
      'Outdoor Temperature (C)': 20,
    });
  }
  return { content: makeCsv(headers, rows), headers, timestamps };
}
