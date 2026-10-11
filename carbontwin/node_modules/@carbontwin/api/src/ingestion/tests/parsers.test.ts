/**
 * Tests for the parser layer: delimiter sniffing, CSV/Parquet parsing,
 * schema auto-detection, unit inference and column mapping (FR-1).
 */

import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  sniffDelimiter,
  parseCsvStream,
  detectFileKind,
  parseUpload,
  detectUnitFromHeader,
  inferUnitFromMagnitude,
  profileColumn,
  detectSchema,
  detectTimestampFormat,
  detectIntervalMinutes,
  mapRows,
  isMappingComplete,
  type ColumnMapping,
} from '../parsers/index.js';
import type { ParsedTable, RawRow } from '../types.js';
import { isoSeries, makeCsv, makePowerCsv } from './helpers.js';

function table(rows: RawRow[], headers: string[]): ParsedTable {
  return { headers, rows, delimiter: ',', encoding: 'utf-8', rowCount: rows.length };
}

describe('csv parser', () => {
  it('sniffs common delimiters', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('parses a BOM-prefixed CSV and strips the BOM', () => {
    const parsed = parseCsv('\uFEFFtimestamp,power\n2024-01-01T00:00:00Z,100\n');
    expect(parsed.headers).toEqual(['timestamp', 'power']);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows[0]).toEqual({ timestamp: '2024-01-01T00:00:00Z', power: '100' });
  });

  it('handles semicolon-delimited files', () => {
    const parsed = parseCsv('a;b\n1;2\n3;4');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('respects quoted fields containing the delimiter', () => {
    const parsed = parseCsv('a,b\n"x,y",2\n');
    expect(parsed.rows[0]?.a).toBe('x,y');
    expect(parsed.rows[0]?.b).toBe('2');
  });

  it('maps empty cells to null', () => {
    const parsed = parseCsv('a,b\n1,\n');
    expect(parsed.rows[0]?.b).toBeNull();
  });

  it('throws on an empty file', () => {
    expect(() => parseCsv('   \n')).toThrow();
  });

  it('caps rows when previewRows is supplied', () => {
    const parsed = parseCsv('a\n1\n2\n3\n4\n', { previewRows: 2 });
    expect(parsed.rowCount).toBe(2);
  });

  it('parses a stream into the same neutral table shape', async () => {
    const stream = Readable.from([makeCsv(['t', 'p'], [{ t: '2024-01-01T00:00:00Z', p: 1 }])]);
    const parsed = await parseCsvStream(stream);
    expect(parsed.headers).toEqual(['t', 'p']);
    expect(parsed.rows[0]?.p).toBe('1');
  });

  it('detects the file kind from name or mime type', () => {
    expect(detectFileKind('meter.csv')).toBe('csv');
    expect(detectFileKind('meter.parquet')).toBe('parquet');
    expect(detectFileKind('meter.pq')).toBe('parquet');
    expect(detectFileKind('meter.txt')).toBeNull();
    expect(detectFileKind('x', 'text/csv')).toBe('csv');
    expect(detectFileKind('x', 'application/vnd.apache.parquet')).toBe('parquet');
  });

  it('routes an upload to the CSV parser', async () => {
    const { content } = makePowerCsv({ startIso: '2024-01-01T00:00:00Z', count: 4, power: () => 100 });
    const parsed = await parseUpload(content, { fileName: 'meter.csv', mimeType: 'text/csv' });
    expect(parsed.rowCount).toBe(4);
    expect(parsed.headers).toContain('Active Power (kW)');
  });

  it('rejects unsupported upload types', async () => {
    await expect(parseUpload(Buffer.from('x'), { fileName: 'notes.txt' })).rejects.toThrow();
  });
});

describe('unit detection', () => {
  it('reads the unit from the column header', () => {
    expect(detectUnitFromHeader('Active Power (kW)')).toMatchObject({ unit: 'kW', isEnergy: false });
    expect(detectUnitFromHeader('energy_kwh')).toMatchObject({ unit: 'kWh', isEnergy: true });
    expect(detectUnitFromHeader('Consumption (MWh)')).toMatchObject({ unit: 'MWh', isEnergy: true });
    expect(detectUnitFromHeader('load_watts')).toMatchObject({ unit: 'W', isEnergy: false });
    expect(detectUnitFromHeader('temperature_c')).toBeNull();
  });

  it('infers a unit from magnitude when the header is silent', () => {
    expect(inferUnitFromMagnitude([100, 200, 300], false).unit).toBe('kW');
    expect(inferUnitFromMagnitude([8000, 9000], false).unit).toBe('W');
    expect(inferUnitFromMagnitude([0.2, 0.5], false).unit).toBe('MW');
    expect(inferUnitFromMagnitude([30_000, 40_000], true).unit).toBe('Wh');
  });
});

describe('schema detection', () => {
  it('detects a timestamp format for ISO samples', () => {
    const result = detectTimestampFormat(['2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z']);
    expect(result?.format).toBe('iso');
    expect(result?.parseRate).toBe(1);
  });

  it('profiles a numeric column with stats', () => {
    const rows: RawRow[] = [{ p: '10' }, { p: '20' }, { p: '30' }];
    const profile = profileColumn(rows, 'p');
    expect(profile.inferredType).toBe('numeric');
    expect(profile.stats?.min).toBe(10);
    expect(profile.stats?.max).toBe(30);
    expect(profile.stats?.mean).toBe(20);
  });

  it('detects a timestamp column, a power column and a 15-minute interval', () => {
    const { headers, timestamps } = makePowerCsv({
      startIso: '2024-01-01T00:00:00Z',
      count: 20,
      power: (i) => 100 + i,
    });
    const rows: RawRow[] = timestamps.map((ts, i) => ({
      timestamp: ts,
      'Active Power (kW)': 100 + i,
      'Outdoor Temperature (C)': 20,
    }));
    const detected = detectSchema(table(rows, headers), { timezone: 'UTC' });
    expect(detected.timestampColumn).toBe('timestamp');
    expect(detected.powerColumn).toBe('Active Power (kW)');
    expect(detected.unit).toBe('kW');
    expect(detected.isEnergy).toBe(false);
    expect(detected.intervalMinutes).toBe(15);
    expect(detected.confidence).toBeGreaterThan(0.7);
    expect(detected.columnProfiles).toHaveLength(3);
  });

  it('estimates the sampling interval from the timestamps', () => {
    const rows: RawRow[] = isoSeries('2024-01-01T00:00:00Z', 5, 30).map((ts) => ({ t: ts }));
    expect(detectIntervalMinutes(rows, 't', 'iso', 'iso', 'UTC')).toBe(30);
  });
});

describe('column mapping', () => {
  const mapping: ColumnMapping = {
    timestampColumn: 'timestamp',
    powerColumn: 'Active Power (kW)',
    timestampFormat: 'iso',
    timezone: 'UTC',
    unit: 'kW',
    isEnergy: false,
    intervalMinutes: 15,
  };

  it('maps rows to UTC-kW readings', () => {
    const { content } = makePowerCsv({ startIso: '2024-01-01T00:00:00Z', count: 3, power: () => 50 });
    const parsed = parseCsv(content);
    const result = mapRows(parsed, mapping);
    expect(result.readings).toHaveLength(3);
    expect(result.readings[0]?.timestampUtc).toBe('2024-01-01T00:00:00.000Z');
    expect(result.readings[0]?.powerKw).toBe(50);
    expect(result.stats.validRows).toBe(3);
  });

  it('converts energy (kWh) to average kW using the interval', () => {
    const parsed = parseCsv(makeCsv(['timestamp', 'energy_kwh'], [
      { timestamp: '2024-01-01T00:00:00Z', energy_kwh: 25 },
    ]));
    const result = mapRows(parsed, {
      ...mapping,
      powerColumn: 'energy_kwh',
      unit: 'kWh',
      isEnergy: true,
      intervalMinutes: 15,
    });
    // 25 kWh over a 0.25 h interval = 100 kW average.
    expect(result.readings[0]?.powerKw).toBe(100);
  });

  it('flags negative power but keeps the reading', () => {
    const parsed = parseCsv(makeCsv(['timestamp', 'Active Power (kW)'], [
      { timestamp: '2024-01-01T00:00:00Z', 'Active Power (kW)': -12 },
    ]));
    const result = mapRows(parsed, mapping);
    expect(result.stats.negativePowerRows).toBe(1);
    expect(result.readings[0]?.flags).toContain('negative_power');
  });

  it('drops unparseable timestamps and counts them', () => {
    const parsed = parseCsv(makeCsv(['timestamp', 'Active Power (kW)'], [
      { timestamp: 'not-a-time', 'Active Power (kW)': 10 },
      { timestamp: '2024-01-01T00:15:00Z', 'Active Power (kW)': 11 },
    ]));
    const result = mapRows(parsed, mapping);
    expect(result.readings).toHaveLength(1);
    expect(result.stats.invalidTimestampRows).toBe(1);
  });

  it('validates mapping completeness', () => {
    expect(isMappingComplete(mapping)).toBe(true);
    expect(isMappingComplete({ timestampColumn: 'a' })).toBe(false);
  });
});
