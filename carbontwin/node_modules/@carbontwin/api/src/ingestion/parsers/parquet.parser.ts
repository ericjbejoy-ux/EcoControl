/**
 * Parquet parser (FR-1).
 * Uses the pure-JS `hyparquet` reader (no native build step) so it runs
 * everywhere, including the offline demo pack. Imported lazily so that a
 * missing optional dependency never breaks the rest of the ingestion layer.
 */

import { parseError } from '../errors.js';
import type { ParsedTable, RawRow } from '../types.js';

export interface ParquetParseOptions {
  fileName?: string;
  maxRows?: number;
  previewRows?: number;
}

function toArrayBuffer(content: Buffer | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (content instanceof ArrayBuffer) return content;
  const view = content instanceof Uint8Array ? content : new Uint8Array(content);
  // Return a copy so detached/shared buffers are safe.
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/** Normalise exotic Parquet scalar types (Date, BigInt, Decimal) to primitives. */
function normaliseValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') {
    // int64 timestamps in ms/µs are common — keep magnitude, callers detect.
    return Number(value);
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // hyparquet represents some numerics as { value, scale } / { days, ... }
    if ('value' in obj) return Number(obj.value);
    if ('days' in obj) return Number(obj.days);
    if ('milliseconds' in obj) return Number(obj.milliseconds);
    if ('microseconds' in obj) return Number(obj.microseconds);
    return JSON.stringify(value);
  }
  return String(value);
}

export async function parseParquet(
  content: Buffer | ArrayBuffer | Uint8Array,
  options: ParquetParseOptions = {}
): Promise<ParsedTable> {
  let parquetReadObjects: (args: { file: ArrayBuffer }) => Promise<Record<string, unknown>[]>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('hyparquet');
    parquetReadObjects = mod.parquetReadObjects;
    if (typeof parquetReadObjects !== 'function') {
      throw new Error('hyparquet.parquetReadObjects is not a function');
    }
  } catch (err) {
    throw parseError(
      'Parquet support is unavailable. Install the optional dependency "hyparquet" or upload a CSV file.',
      { fileName: options.fileName, cause: err instanceof Error ? err.message : String(err) }
    );
  }

  let objects: Record<string, unknown>[];
  try {
    objects = await parquetReadObjects({ file: toArrayBuffer(content) });
  } catch (err) {
    throw parseError(
      `Failed to read Parquet file: ${err instanceof Error ? err.message : String(err)}`,
      { fileName: options.fileName }
    );
  }

  if (objects.length === 0) {
    return { headers: [], rows: [], delimiter: '', encoding: 'binary', rowCount: 0 };
  }

  const headers = Object.keys(objects[0] as Record<string, unknown>);
  const maxRows = options.maxRows ?? 2_000_000;
  const limit = options.previewRows ?? Math.min(objects.length, maxRows);

  const rows: RawRow[] = [];
  for (let i = 0; i < limit; i++) {
    const src = objects[i] as Record<string, unknown>;
    const row: RawRow = {};
    for (const header of headers) row[header] = normaliseValue(src[header]);
    rows.push(row);
  }

  return { headers, rows, delimiter: '', encoding: 'binary', rowCount: rows.length };
}

/** Build the column-preview payload used by the upload/schema-detection step. */
export function parquetPreview(table: ParsedTable, limit = 10): RawRow[] {
  return table.rows.slice(0, limit);
}
