/**
 * Parser facade — picks the right parser from the file name / MIME type.
 */

import { invalidFileType } from '../errors.js';
import { parseCsv, type CsvParseOptions } from './csv.parser.js';
import { parseParquet, type ParquetParseOptions } from './parquet.parser.js';
import type { ParsedTable } from '../types.js';

export * from './csv.parser.js';
export * from './parquet.parser.js';
export * from './schemaDetector.js';
export * from './columnMapper.js';

export type FileKind = 'csv' | 'parquet';

export function detectFileKind(fileName: string, mimeType?: string): FileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || mimeType === 'text/csv') return 'csv';
  if (lower.endsWith('.parquet') || lower.endsWith('.pq') || mimeType === 'application/vnd.apache.parquet') {
    return 'parquet';
  }
  return null;
}

export interface ParseUploadOptions extends CsvParseOptions, ParquetParseOptions {
  fileName: string;
  mimeType?: string;
}

/** Parse an uploaded buffer into a neutral table. */
export async function parseUpload(
  content: Buffer | ArrayBuffer | Uint8Array,
  options: ParseUploadOptions
): Promise<ParsedTable> {
  const kind = detectFileKind(options.fileName, options.mimeType);
  if (!kind) throw invalidFileType(options.mimeType ?? options.fileName);

  if (kind === 'csv') {
    return parseCsv(content as Buffer, options);
  }
  return parseParquet(content, options);
}
