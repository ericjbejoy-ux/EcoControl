/**
 * Column mapping (FR-1, parsers/columnMapper.ts).
 * Turns a `ParsedTable` + a confirmed mapping into canonical
 * `NormalizedReading[]` (UTC timestamp + average kW), collecting per-row flags.
 */

import { normalizeToKw, type AnyUnit } from '../validators/unitNormalizer.js';
import { parseTimestamp } from '../validators/timezone.js';
import { round } from '../utils/stats.js';
import type { NormalizedReading, ParsedTable, RawRow } from '../types.js';

export interface ColumnMapping {
  timestampColumn: string;
  powerColumn: string;
  /** Detected format: 'iso' | 'epoch_s' | 'epoch_ms' | luxon pattern. */
  timestampFormat: string | null;
  timezone: string;
  unit: AnyUnit;
  isEnergy: boolean;
  intervalMinutes: number;
}

export interface MapRowsOptions {
  /** Discard rows that fail timestamp or power parsing (default: keep flagged). */
  dropInvalid?: boolean;
}

export interface MapRowsResult {
  readings: NormalizedReading[];
  stats: {
    totalRows: number;
    validRows: number;
    droppedRows: number;
    invalidTimestampRows: number;
    invalidPowerRows: number;
    negativePowerRows: number;
    dstAdjusted: number;
  };
  warnings: string[];
}

/** Map raw rows into normalised readings. */
export function mapRows(
  table: ParsedTable,
  mapping: ColumnMapping,
  options: MapRowsOptions = {}
): MapRowsResult {
  const readings: NormalizedReading[] = [];
  const warnings: string[] = [];
  const stats = {
    totalRows: table.rows.length,
    validRows: 0,
    droppedRows: 0,
    invalidTimestampRows: 0,
    invalidPowerRows: 0,
    negativePowerRows: 0,
    dstAdjusted: 0,
  };

  let dstSeen = false;

  for (const row of table.rows) {
    const flags: string[] = [];

    const ts = parseTimestamp((row as RawRow)[mapping.timestampColumn], mapping.timestampFormat, mapping.timezone);
    if (!ts) {
      stats.invalidTimestampRows++;
      if (options.dropInvalid) {
        stats.droppedRows++;
        continue;
      }
      flags.push('invalid_timestamp');
      continue; // a reading needs a timestamp — always skip if unparseable
    }
    if (ts.convertedFromDst) {
      stats.dstAdjusted++;
      dstSeen = true;
    }

    const rawValue = Number((row as RawRow)[mapping.powerColumn]);
    if (!Number.isFinite(rawValue)) {
      stats.invalidPowerRows++;
      if (options.dropInvalid) {
        stats.droppedRows++;
        continue;
      }
      flags.push('invalid_power');
      continue;
    }

    const powerKw = normalizeToKw(rawValue, {
      unit: mapping.unit,
      isEnergy: mapping.isEnergy,
      intervalMinutes: mapping.intervalMinutes,
    });
    if (!Number.isFinite(powerKw)) {
      stats.invalidPowerRows++;
      if (options.dropInvalid) {
        stats.droppedRows++;
        continue;
      }
      flags.push('invalid_power');
      continue;
    }

    if (powerKw < 0) {
      stats.negativePowerRows++;
      flags.push('negative_power');
    }

    readings.push({
      timestampUtc: ts.utcIso,
      powerKw: round(powerKw, 6),
      flags,
    });
    stats.validRows++;
  }

  if (dstSeen) {
    warnings.push(
      `Detected ${stats.dstAdjusted} timestamp(s) inside a daylight-saving transition in ${mapping.timezone}; ` +
        'they were normalised to UTC.'
    );
  }
  if (stats.negativePowerRows > 0) {
    warnings.push(`${stats.negativePowerRows} reading(s) had negative power (e.g. on-site generation or export).`);
  }
  if (stats.invalidTimestampRows > 0) {
    warnings.push(`${stats.invalidTimestampRows} row(s) had an unparseable timestamp and were skipped.`);
  }
  if (stats.invalidPowerRows > 0) {
    warnings.push(`${stats.invalidPowerRows} row(s) had a non-numeric power value and were skipped.`);
  }

  return { readings, stats, warnings };
}

/** Quick readiness check — a mapping is usable when both columns are present. */
export function isMappingComplete(mapping: Partial<ColumnMapping>): mapping is ColumnMapping {
  return Boolean(mapping.timestampColumn && mapping.powerColumn && mapping.unit);
}
