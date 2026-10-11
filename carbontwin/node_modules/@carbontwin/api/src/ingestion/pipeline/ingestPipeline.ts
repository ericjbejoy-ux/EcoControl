/**
 * Ingest pipeline (FR-1, FR-5).
 *   parse → detect schema → map/validate → resample → detect outliers
 *         → impute gaps → (optional) emissions → quality report → store
 * Target: a CSV/Parquet upload becomes a queryable facility with a quality
 * report in well under 10 s for typical demo files.
 */

import type {
  CarbonIntensityPoint,
  CreateFacilityRequest,
  DataQualityReport,
  Facility,
  FacilityType,
  TimeSeriesPoint,
} from '@carbontwin/shared';
import { ANNUAL_AVERAGE_CI } from '@carbontwin/shared';
import type { IngestionConfig } from '../config.js';
import { emptyDataset, parseError, schemaNotDetected } from '../errors.js';
import { getLogger, type Logger } from '../logger.js';
import { parseUpload } from '../parsers/index.js';
import { detectSchema, type DetectSchemaOptions } from '../parsers/schemaDetector.js';
import { mapRows, type ColumnMapping } from '../parsers/columnMapper.js';
import type { Store } from '../store/index.js';
import { DEFAULT_CLEANING_OPTIONS, type CleaningOptions, type GridPoint, type ParsedTable, type TimeseriesRecord } from '../types.js';
import { detectOutliers } from '../cleaning/outlierDetector.js';
import { imputeGaps } from '../cleaning/imputer.js';
import { resample } from '../cleaning/resampler.js';
import { validateIntervals } from '../validators/intervalValidator.js';
import { buildQualityReport, qualityScore } from './qualityReport.js';
import { calculateEmissionsKg, compareDynamicVsStatic } from './emissions.service.js';
import { coordsForRegion } from '../connectors/fallbackProvider.js';
import { resolveTimezone } from '../validators/timezone.js';
import { round } from '../utils/stats.js';

export interface IngestPipelineOptions {
  fileName: string;
  mimeType?: string;
  content: Buffer | ArrayBuffer | Uint8Array;
  /** New facility metadata; ignored when `facilityId` targets an existing one. */
  facility?: {
    name?: string;
    type?: FacilityType;
    region?: string;
    timezone?: string;
    lat?: number;
    lon?: number;
    address?: string;
    floorAreaM2?: number;
    metadata?: Record<string, unknown>;
    isDemo?: boolean;
    dataSource?: Facility['dataSource'];
  };
  /** Update an existing facility instead of creating a new one. */
  facilityId?: string;
  /** Manual column mapping overrides (from the UI mapping step). */
  mapping?: Partial<ColumnMapping>;
  detectOptions?: DetectSchemaOptions;
  cleaning?: Partial<CleaningOptions>;
  /** Pre-fetched carbon-intensity series to attach emissions immediately. */
  carbonIntensity?: CarbonIntensityPoint[];
  store: Store;
  config: IngestionConfig;
  logger?: Logger;
}

export interface IngestResult {
  facilityId: string;
  facility: Facility;
  qualityReport: DataQualityReport;
  qualityScore: number;
  schema: ReturnType<typeof detectSchema>;
  mapping: ColumnMapping;
  series: TimeSeriesPoint[];
  totals: {
    kwh: number;
    emissionsKg: number;
    dynamicVsStaticDifferencePct: number | null;
    peakKw: number;
  };
  timings: Record<string, number>;
  warnings: string[];
}

function mergeMapping(
  detected: ReturnType<typeof detectSchema>,
  override?: Partial<ColumnMapping>
): ColumnMapping {
  const timestampColumn = override?.timestampColumn ?? detected.timestampColumn;
  const powerColumn = override?.powerColumn ?? detected.powerColumn;
  if (!timestampColumn || !powerColumn) throw schemaNotDetected(detected.warnings);
  const isEnergy = override?.isEnergy ?? detected.isEnergy;
  const unit =
    override?.unit ??
    detected.unit ??
    (isEnergy ? 'kWh' : 'kW');
  return {
    timestampColumn,
    powerColumn,
    timestampFormat: override?.timestampFormat ?? detected.timestampFormat,
    timezone: override?.timezone ?? detected.timezone,
    unit,
    isEnergy,
    intervalMinutes: override?.intervalMinutes ?? detected.intervalMinutes ?? 15,
  };
}

function toRecords(
  facilityId: string,
  points: GridPoint[],
  ciByMs: Map<number, number> | null
): TimeseriesRecord[] {
  return points.map((p) => {
    const ms = Date.parse(p.timestampUtc);
    const ci = ciByMs?.get(ms) ?? null;
    const emissions = ci === null ? null : round(calculateEmissionsKg(p.powerKw, ci), 4);
    return {
      facilityId,
      timestamp: p.timestampUtc,
      powerKw: p.powerKw,
      emissionsKg: emissions,
      carbonIntensity: ci,
      quality: p.quality,
      flags: p.flags,
    };
  });
}

export async function runIngestPipeline(options: IngestPipelineOptions): Promise<IngestResult> {
  const logger = options.logger ?? getLogger();
  const t0 = performance.now();
  const warnings: string[] = [];
  const cleaning: CleaningOptions = { ...DEFAULT_CLEANING_OPTIONS, ...options.cleaning };

  // 1. Parse ---------------------------------------------------------------
  const table: ParsedTable = await parseUpload(options.content, {
    fileName: options.fileName,
    mimeType: options.mimeType,
  });
  if (table.rows.length === 0) throw emptyDataset();
  const tParse = performance.now();

  // 2. Detect schema -------------------------------------------------------
  const region = options.facility?.region;
  const timezone =
    options.facility?.timezone ??
    options.detectOptions?.timezone ??
    resolveTimezone({
      region,
      lat: options.facility?.lat,
      lon: options.facility?.lon,
    });
  const schema = detectSchema(table, { timezone, ...options.detectOptions });
  warnings.push(...schema.warnings);
  const tDetect = performance.now();

  // 3. Map + validate ------------------------------------------------------
  const mapping = mergeMapping(schema, options.mapping);
  const mapped = mapRows(table, mapping);
  warnings.push(...mapped.warnings);
  if (mapped.readings.length === 0) {
    throw parseError('No valid rows could be parsed from the uploaded file.', { mapping });
  }
  const tMap = performance.now();

  // Source-level interval validation (before resampling).
  const sourceMs = mapped.readings.map((r) => Date.parse(r.timestampUtc));
  const interval = validateIntervals(sourceMs, mapping.intervalMinutes);

  // 4. Resample to the canonical grid -------------------------------------
  const resampled = resample(mapped.readings, {
    intervalMinutes: cleaning.resampleTo15min ? 15 : mapping.intervalMinutes,
  });
  const values = resampled.slots.map((s) => s.powerKw);
  const tResample = performance.now();

  // 5. Outlier detection ---------------------------------------------------
  let outlierCount = 0;
  if (cleaning.removeOutliers) {
    const outliers = detectOutliers(values, {
      zScoreThreshold: cleaning.outlierZScoreThreshold,
      replaceWithNull: true,
    });
    outlierCount = outliers.outlierCount;
    if (outlierCount > 0) {
      warnings.push(`${outlierCount} outlier(s) detected and replaced by imputation.`);
      resampled.slots.forEach((slot, i) => {
        slot.powerKw = outliers.values[i] ?? null;
        if (outliers.indices.includes(i)) slot.flags = [...slot.flags, 'outlier'];
        if (slot.powerKw === null) slot.quality = 'missing';
      });
    }
  }
  const cleanSlots = resampled.slots.map((slot) =>
    slot.powerKw === null ? { ...slot, quality: 'missing' as const } : slot
  );
  const tOutliers = performance.now();

  // 6. Impute gaps ---------------------------------------------------------
  const imputed = imputeGaps(cleanSlots, {
    maxInterpolationGapMinutes: cleaning.maxInterpolationGapMinutes,
    timezone: mapping.timezone,
  });
  const points = imputed.points;
  const tImpute = performance.now();

  // 7. Emissions (optional) ------------------------------------------------
  let ciByMs: Map<number, number> | null = null;
  let dynamicVsStaticDifferencePct: number | null = null;
  let totalEmissionsKg = 0;
  if (options.carbonIntensity && options.carbonIntensity.length > 0) {
    ciByMs = new Map(options.carbonIntensity.map((c) => [Date.parse(c.timestamp), c.carbonIntensity]));
    const emissionsSeries = points
      .map((p) => {
        const ci = ciByMs!.get(Date.parse(p.timestampUtc));
        if (ci === undefined) return null;
        return {
          timestampUtc: p.timestampUtc,
          powerKw: p.powerKw,
          carbonIntensity: ci,
          emissionsKg: calculateEmissionsKg(p.powerKw, ci),
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    totalEmissionsKg = emissionsSeries.reduce((a, b) => a + b.emissionsKg, 0);
    if (emissionsSeries.length > 0) {
      const cmp = compareDynamicVsStatic(emissionsSeries, {
        region: options.facility?.region,
        annualAverageCi: region ? ANNUAL_AVERAGE_CI[region] : undefined,
      });
      dynamicVsStaticDifferencePct = cmp.totals.differencePct;
    }
  }

  // 8. Quality report ------------------------------------------------------
  const first = points[0];
  const last = points[points.length - 1];
  const powerValues = points.map((p) => p.powerKw);
  const totalKwh = points.reduce((acc, p) => acc + p.powerKw * 0.25, 0);
  const peakKw = powerValues.length ? Math.max(...powerValues) : 0;

  // 9. Persist facility ----------------------------------------------------
  const facility = await upsertFacility(options, mapping, schema);

  const report = buildQualityReport({
    facilityId: facility.id,
    schema,
    mappingStats: mapped.stats,
    mappingWarnings: mapped.warnings,
    interval,
    outlierCount,
    imputedCount: imputed.imputedCount,
    interpolatedCount: imputed.interpolatedCount,
    syntheticCount: imputed.syntheticCount,
    totalRows: table.rows.length,
    validRows: mapped.readings.length,
    dateRange: {
      start: first?.timestampUtc ?? new Date().toISOString(),
      end: last?.timestampUtc ?? new Date().toISOString(),
    },
    values: powerValues,
  });

  await options.store.timeseries.replaceAll(facility.id, toRecords(facility.id, points, ciByMs));
  await options.store.facilities.saveQualityReport(report);
  const tStore = performance.now();

  const series: TimeSeriesPoint[] = points.map((p) => {
    const ms = Date.parse(p.timestampUtc);
    const ci = ciByMs?.get(ms);
    return {
      timestamp: p.timestampUtc,
      powerKw: p.powerKw,
      emissionsKg: ci === undefined ? undefined : round(calculateEmissionsKg(p.powerKw, ci), 4),
      carbonIntensity: ci,
      dataQuality: p.quality,
      flags: p.flags,
    };
  });

  logger.info('Ingestion complete', {
    facilityId: facility.id,
    rows: table.rows.length,
    points: points.length,
    outliers: outlierCount,
    imputed: imputed.filledCount,
    ms: Math.round(tStore - t0),
  });

  return {
    facilityId: facility.id,
    facility,
    qualityReport: report,
    qualityScore: qualityScore(report),
    schema,
    mapping,
    series,
    totals: {
      kwh: round(totalKwh, 3),
      emissionsKg: round(totalEmissionsKg, 3),
      dynamicVsStaticDifferencePct,
      peakKw: round(peakKw, 3),
    },
    timings: {
      parseMs: round(tParse - t0, 2),
      detectMs: round(tDetect - tParse, 2),
      mapMs: round(tMap - tDetect, 2),
      resampleMs: round(tResample - tMap, 2),
      outliersMs: round(tOutliers - tResample, 2),
      imputeMs: round(tImpute - tOutliers, 2),
      storeMs: round(tStore - tImpute, 2),
      totalMs: round(tStore - t0, 2),
    },
    warnings,
  };
}

async function upsertFacility(
  options: IngestPipelineOptions,
  mapping: ColumnMapping,
  schema: ReturnType<typeof detectSchema>
): Promise<Facility> {
  if (options.facilityId) {
    const existing = await options.store.facilities.get(options.facilityId);
    if (existing) return existing;
  }
  const region = options.facility?.region ?? options.config.defaultRegion;
  const coords = coordsForRegion(region);
  const input: CreateFacilityRequest & { metadata: Record<string, unknown> } = {
    name: options.facility?.name ?? `${options.fileName.replace(/\.[^.]+$/, '')} (imported)`,
    type: options.facility?.type ?? 'custom',
    region,
    timezone: mapping.timezone,
    lat: options.facility?.lat ?? coords.lat,
    lon: options.facility?.lon ?? coords.lon,
    address: options.facility?.address,
    floorAreaM2: options.facility?.floorAreaM2,
    metadata: {
      ...(options.facility?.metadata ?? {}),
      sourceFile: options.fileName,
      detectedUnit: schema.unit,
      isEnergy: schema.isEnergy,
    },
  };
  return options.store.facilities.create({
    ...input,
    id: options.facilityId,
    isDemo: options.facility?.isDemo ?? false,
    dataSource: options.facility?.dataSource ?? 'uploaded',
  });
}
