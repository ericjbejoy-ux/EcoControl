/**
 * CSV parser (FR-1).
 * - Sniffs the delimiter (`,` `;` `\t` `|`)
 * - Strips a UTF-8 BOM
 * - Streams large files (csv-parse) with a row cap for safety
 * - Returns a neutral `ParsedTable`
 */

import { parse as parseSync } from 'csv-parse/sync';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { parse as parseStream } from 'csv-parse';
import { parseError } from '../errors.js';
import type { ParsedTable, RawRow } from '../types.js';

export const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

/** Guess the delimiter by counting candidates in the first few lines. */
export function sniffDelimiter(text: string, candidates: readonly string[] = DELIMITER_CANDIDATES): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 8);
  if (lines.length === 0) return ',';

  let best = candidates[0] as string;
  let bestScore = -1;

  for (const candidate of candidates) {
    const counts = lines.map((line) => line.split(candidate).length - 1);
    const minCount = Math.min(...counts);
    // A good delimiter appears a consistent, non-zero number of times.
    if (minCount <= 0) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((acc, c) => acc + (c - avg) ** 2, 0) / counts.length;
    const score = avg - variance; // reward frequency, penalise inconsistency
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/** Normalise a raw csv-parse row object (keeps original headers, coerces to primitives). */
function coerceRow(row: Record<string, string>, headers: string[]): RawRow {
  const out: RawRow = {};
  for (const header of headers) {
    const raw = row[header];
    if (raw === undefined || raw === null || raw === '') {
      out[header] = null;
      continue;
    }
    const trimmed = raw.trim();
    // Preserve as string; numeric/timestamp coercion happens in the detector.
    out[header] = trimmed;
  }
  return out;
}

export interface CsvParseOptions {
  fileName?: string;
  delimiter?: string;
  hasHeader?: boolean;
  /** Hard cap on parsed rows to protect memory (default 2,000,000). */
  maxRows?: number;
  /** Preview mode returns only the first N rows. */
  previewRows?: number;
}

/** Parse an in-memory CSV string/buffer. */
export function parseCsv(content: string | Buffer, options: CsvParseOptions = {}): ParsedTable {
  const text = stripBom(typeof content === 'string' ? content : content.toString('utf-8'));
  if (text.trim().length === 0) throw parseError('CSV file is empty.', { fileName: options.fileName });

  const delimiter = options.delimiter ?? sniffDelimiter(text);
  const hasHeader = options.hasHeader ?? true;
  const maxRows = options.maxRows ?? 2_000_000;

  let records: Record<string, string>[];
  try {
    records = parseSync(text, {
      columns: hasHeader ? true : undefined,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: false,
      bom: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw parseError(
      `Failed to parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      { fileName: options.fileName, delimiter }
    );
  }

  let headers: string[];
  if (hasHeader) {
    headers = extractHeaders(records);
  } else {
    const count = records.length > 0 ? Object.keys(records[0] as Record<string, string>).length : 0;
    headers = Array.from({ length: count }, (_, i) => `col_${i + 1}`);
  }

  const limit = options.previewRows ?? Math.min(records.length, maxRows);
  const rows: RawRow[] = [];
  for (let i = 0; i < limit; i++) {
    rows.push(coerceRow(records[i] as Record<string, string>, headers));
  }

  return {
    headers,
    rows,
    delimiter,
    encoding: 'utf-8',
    rowCount: rows.length,
  };
}

function extractHeaders(records: Record<string, string>[]): string[] {
  if (records.length === 0) return [];
  return Object.keys(records[0] as Record<string, string>);
}

/** Streaming parse for very large files on disk. */
export async function parseCsvFile(filePath: string, options: CsvParseOptions = {}): Promise<ParsedTable> {
  const maxRows = options.maxRows ?? 2_000_000;
  const hasHeader = options.hasHeader ?? true;

  return new Promise<ParsedTable>((resolve, reject) => {
    const headers: string[] = [];
    const rows: RawRow[] = [];
    let delimiter = options.delimiter;
    let rowCount = 0;

    const parser = parseStream({
      ...(hasHeader ? { columns: (header: string[]) => { headers.length = 0; headers.push(...header); return header; } } : {}),
      delimiter: delimiter ?? undefined,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      bom: true,
    });

    const source = createReadStream(filePath, 'utf-8');
    source.on('error', (err) => reject(parseError(err.message, { filePath })));

    parser.on('readable', () => {
      let record: string[] | Record<string, string>;
      while ((record = parser.read()) !== null) {
        if (rowCount >= maxRows) break;
        if (!hasHeader) {
          if (headers.length === 0) {
            const width = Array.isArray(record) ? record.length : Object.keys(record).length;
            for (let i = 0; i < width; i++) headers.push(`col_${i + 1}`);
          }
          const arr = record as string[];
          const obj: RawRow = {};
          headers.forEach((h, i) => { obj[h] = arr[i] ?? null; });
          rows.push(obj);
        } else {
          rows.push(coerceRow(record as Record<string, string>, headers));
        }
        rowCount++;
      }
    });

    parser.on('error', (err) => reject(parseError(err.message, { filePath })));
    parser.on('end', () => {
      resolve({
        headers: [...headers],
        rows,
        delimiter: delimiter ?? ',',
        encoding: 'utf-8',
        rowCount: rows.length,
      });
    });

    source.pipe(parser);
  });
}

/** Stream-parse a Web/Node Readable (used by the multipart upload route). */
export async function parseCsvStream(
  stream: Readable | NodeJS.ReadableStream,
  options: CsvParseOptions = {}
): Promise<ParsedTable> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return parseCsv(Buffer.concat(chunks), options);
}
