/**
 * Timezone handling (FR-1, validators/timezone.ts).
 * Resolves the correct IANA zone (explicit → region centroid → longitude →
 * UTC) and parses wall-clock timestamps into UTC ISO strings, DST-aware.
 */

import { REGION_CENTROIDS } from '@carbontwin/shared';
import { DateTime } from 'luxon';
import { isValidZone } from '../utils/time.js';
import type { RawRow } from '../types.js';

export interface ResolveTimezoneInput {
  explicit?: string | null;
  region?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** Crude longitude → UTC offset (hours), rounded to the nearest whole hour. */
export function offsetHoursFromLongitude(lon: number): number {
  return Math.max(-12, Math.min(14, Math.round(lon / 15)));
}

export function timezoneFromLongitude(lon: number): string {
  const offset = offsetHoursFromLongitude(lon);
  if (offset === 0) return 'UTC';
  // First matching Etc/GMT zone (sign is inverted by POSIX convention).
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

export function resolveTimezone(input: ResolveTimezoneInput): string {
  if (input.explicit && isValidZone(input.explicit)) return input.explicit;
  if (input.region && REGION_CENTROIDS[input.region]) return REGION_CENTROIDS[input.region]!.timezone;
  if (typeof input.lon === 'number' && Number.isFinite(input.lon)) return timezoneFromLongitude(input.lon);
  return 'UTC';
}

const PARSE_FORMATS = [
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

export interface ParsedTimestamp {
  utcIso: string;
  /** Local wall-clock ISO (no zone) for reference/UI. */
  localIso: string;
  convertedFromDst: boolean;
}

/**
 * Parse a single timestamp value.
 * @param value raw string/number
 * @param format detected format ('iso' | 'epoch_s' | 'epoch_ms' | luxon format)
 * @param zone IANA timezone for naive (zoneless) inputs
 */
export function parseTimestamp(value: unknown, format: string | null, zone: string): ParsedTimestamp | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();

  if (format === 'epoch_s' || /^\d{10}$/.test(raw)) {
    const ms = Number(raw) * 1000;
    const dt = DateTime.fromMillis(ms, { zone: 'utc' });
    if (!dt.isValid) return null;
    return { utcIso: dt.toISO()!, localIso: dt.setZone(zone).toISO()!, convertedFromDst: false };
  }
  if (format === 'epoch_ms' || /^\d{13}$/.test(raw)) {
    const dt = DateTime.fromMillis(Number(raw), { zone: 'utc' });
    if (!dt.isValid) return null;
    return { utcIso: dt.toISO()!, localIso: dt.setZone(zone).toISO()!, convertedFromDst: false };
  }

  // ISO with an explicit offset — trust it.
  const isoWithZone = DateTime.fromISO(raw, { setZone: true });
  if (isoWithZone.isValid && /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return {
      utcIso: isoWithZone.toUTC().toISO()!,
      localIso: isoWithZone.setZone(zone).toISO()!,
      convertedFromDst: false,
    };
  }

  const formatsToTry = format && format !== 'iso' ? [format, ...PARSE_FORMATS] : PARSE_FORMATS;
  for (const fmt of formatsToTry) {
    const dt = DateTime.fromFormat(raw, fmt, { zone });
    if (dt.isValid) {
      return {
        utcIso: dt.toUTC().toISO()!,
        localIso: dt.toISO()!,
        convertedFromDst: dt.isInDST,
      };
    }
  }
  // Last resort: naive ISO (assume already UTC) or plain ISO parse.
  const naive = DateTime.fromISO(raw, { zone });
  if (naive.isValid) {
    return { utcIso: naive.toUTC().toISO()!, localIso: naive.toISO()!, convertedFromDst: naive.isInDST };
  }
  return null;
}

export interface TimestampParseResult {
  value: string | null;
  utcIso: string | null;
  index: number;
}

/** Parse every value of a timestamp column; returns per-row results + success rate. */
export function parseTimestampColumn(
  rows: RawRow[],
  column: string,
  format: string | null,
  zone: string
): { parsed: TimestampParseResult[]; successRate: number; dstCount: number } {
  const parsed: TimestampParseResult[] = [];
  let ok = 0;
  let dstCount = 0;
  rows.forEach((row, index) => {
    const result = parseTimestamp((row as RawRow)[column], format, zone);
    if (result) {
      ok++;
      if (result.convertedFromDst) dstCount++;
      parsed.push({ value: String((row as RawRow)[column]), utcIso: result.utcIso, index });
    } else {
      parsed.push({ value: (row as RawRow)[column] == null ? null : String((row as RawRow)[column]), utcIso: null, index });
    }
  });
  return { parsed, successRate: rows.length ? ok / rows.length : 0, dstCount };
}

/** Format a UTC instant for a given zone, for display. */
export function formatInZone(utcIso: string, zone: string, format = 'yyyy-MM-dd HH:mm'): string {
  return DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(zone).toFormat(format);
}
