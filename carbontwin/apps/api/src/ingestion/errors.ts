/**
 * Typed errors for the ingestion layer.
 * Every error carries a stable `code` (shared INGESTION_ERROR_CODES) plus an
 * HTTP status so route handlers can map failures to responses uniformly.
 */

import { INGESTION_ERROR_CODES, type IngestionErrorCode } from '@carbontwin/shared';

export class IngestionError extends Error {
  readonly code: IngestionErrorCode | string;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: IngestionErrorCode | string,
    message: string,
    statusCode = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export const invalidFileType = (mime: string) =>
  new IngestionError(
    INGESTION_ERROR_CODES.INVALID_FILE_TYPE,
    `Unsupported file type: ${mime}. Only CSV and Parquet are accepted.`,
    415,
    { mime }
  );

export const fileTooLarge = (bytes: number, maxBytes: number) =>
  new IngestionError(
    INGESTION_ERROR_CODES.FILE_TOO_LARGE,
    `File is too large (${(bytes / 1024 / 1024).toFixed(1)} MB). Maximum is ${(
      maxBytes /
      1024 /
      1024
    ).toFixed(0)} MB.`,
    413,
    { bytes, maxBytes }
  );

export const parseError = (message: string, details: Record<string, unknown> = {}) =>
  new IngestionError(INGESTION_ERROR_CODES.PARSE_ERROR, message, 422, details);

export const schemaNotDetected = (warnings: string[]) =>
  new IngestionError(
    INGESTION_ERROR_CODES.SCHEMA_NOT_DETECTED,
    'Could not auto-detect a timestamp and power column. Please map columns manually.',
    422,
    { warnings }
  );

export const emptyDataset = () =>
  new IngestionError(INGESTION_ERROR_CODES.EMPTY_DATASET, 'The uploaded dataset contains no data rows.', 422);

export const facilityNotFound = (id: string) =>
  new IngestionError(
    INGESTION_ERROR_CODES.FACILITY_NOT_FOUND,
    `Facility ${id} was not found.`,
    404,
    { facilityId: id }
  );

export const upstreamUnavailable = (provider: string, cause?: unknown) =>
  new IngestionError(
    INGESTION_ERROR_CODES.UPSTREAM_UNAVAILABLE,
    `Upstream data provider "${provider}" is unavailable.`,
    502,
    { provider, cause: cause instanceof Error ? cause.message : String(cause ?? '') }
  );
