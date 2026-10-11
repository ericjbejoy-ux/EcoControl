/**
 * Demo-facility seeding (FR-2).
 * Ingests the five curated demo datasets (office tower, hospital, campus,
 * data centre, Chennai IT park) through the real pipeline so the demo path
 * exercises production code. Idempotent: existing demo facilities are skipped
 * unless `force`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DEMO_FACILITY_IDS, type FacilityType } from '@carbontwin/shared';
import type { IngestionConfig } from '../config.js';
import { getLogger, type Logger } from '../logger.js';
import type { Store } from '../store/index.js';
import type { CarbonIntensityService } from '../connectors/index.js';
import { runIngestPipeline } from '../pipeline/ingestPipeline.js';

export interface DemoFacilitySpec {
  id: string;
  file: string;
  name: string;
  type: FacilityType;
  region: string;
  timezone: string;
  lat: number;
  lon: number;
  description: string;
  tags: string[];
}

export const DEMO_FACILITIES: DemoFacilitySpec[] = [
  {
    id: DEMO_FACILITY_IDS.officeTower,
    file: 'office_tower.csv',
    name: 'Office Tower A',
    type: 'office',
    region: 'IN-MH',
    timezone: 'Asia/Kolkata',
    lat: 19.076,
    lon: 72.8777,
    description: '18-storey Grade-A office tower, 26,000 m², 5-day occupancy with weekend setback.',
    tags: ['commercial', 'weekday-peak', 'mumbai'],
  },
  {
    id: DEMO_FACILITY_IDS.hospital,
    file: 'hospital.csv',
    name: 'City General Hospital',
    type: 'hospital',
    region: 'GB-LND',
    timezone: 'Europe/London',
    lat: 51.5074,
    lon: -0.1278,
    description: '600-bed teaching hospital, 24/7 operation, high baseload and strict comfort requirements.',
    tags: ['24/7', 'critical', 'london'],
  },
  {
    id: DEMO_FACILITY_IDS.campus,
    file: 'campus.csv',
    name: 'Tech Campus West',
    type: 'campus',
    region: 'US-CA',
    timezone: 'America/Los_Angeles',
    lat: 37.7749,
    lon: -122.4194,
    description: 'Multi-block research campus with PV on-site and aggressive load-shifting potential.',
    tags: ['campus', 'solar', 'california'],
  },
  {
    id: DEMO_FACILITY_IDS.dataCenter,
    file: 'data_center.csv',
    name: 'HyperScale DC-1',
    type: 'data_center',
    region: 'DE-BE',
    timezone: 'Europe/Berlin',
    lat: 52.52,
    lon: 13.405,
    description: 'Colocation data centre with a flat critical baseload and large cooling demand.',
    tags: ['datacenter', 'flat-load', 'berlin'],
  },
  {
    id: DEMO_FACILITY_IDS.chennaiPark,
    file: 'chennai_it_park.csv',
    name: 'Chennai IT Park',
    type: 'office',
    region: 'IN-TN',
    timezone: 'Asia/Kolkata',
    lat: 13.0827,
    lon: 80.2707,
    description:
      'Technology park in Chennai, Tamil Nadu. Outdoor conditions are the real Open-Meteo 2024 archive and the load is calibrated to CEA Tamil Nadu daily demand.',
    tags: ['commercial', 'weekday-peak', 'chennai', 'real-weather'],
  },
];

export interface SeedOptions {
  store: Store;
  config: IngestionConfig;
  carbon?: CarbonIntensityService;
  logger?: Logger;
  /** Re-ingest even when the facility already exists. */
  force?: boolean;
  /** Restrict to specific facility ids. */
  only?: string[];
}

export interface SeedResult {
  seeded: string[];
  skipped: string[];
  failed: Array<{ id: string; error: string }>;
  durationMs: number;
}

export async function seedDemoFacilities(options: SeedOptions): Promise<SeedResult> {
  const logger = options.logger ?? getLogger();
  const start = Date.now();
  const result: SeedResult = { seeded: [], skipped: [], failed: [], durationMs: 0 };

  const specs = options.only
    ? DEMO_FACILITIES.filter((f) => options.only!.includes(f.id))
    : DEMO_FACILITIES;

  for (const spec of specs) {
    const existing = await options.store.facilities.get(spec.id);
    if (existing && !options.force) {
      result.skipped.push(spec.id);
      continue;
    }

    const filePath = path.join(options.config.demoDir, spec.file);
    let content: Buffer;
    try {
      content = await fs.readFile(filePath);
    } catch (err) {
      result.failed.push({ id: spec.id, error: `Demo file missing: ${filePath}` });
      logger.warn('Demo file not found.', { filePath, error: String(err) });
      continue;
    }

    try {
      // Fetch carbon intensity for the dataset window to attach emissions.
      const range = await peekCsvRange(content);
      let carbonIntensity;
      if (options.carbon && range) {
        const series = await options.carbon.getSeries(spec.region, range.from, range.to, 15);
        carbonIntensity = series.data;
      }

      const ingest = await runIngestPipeline({
        fileName: spec.file,
        mimeType: 'text/csv',
        content,
        facilityId: spec.id,
        facility: {
          name: spec.name,
          type: spec.type,
          region: spec.region,
          timezone: spec.timezone,
          lat: spec.lat,
          lon: spec.lon,
          isDemo: true,
          dataSource: 'demo',
          metadata: { description: spec.description, tags: spec.tags, demo: true },
        },
        carbonIntensity,
        store: options.store,
        config: options.config,
        logger,
      });
      result.seeded.push(ingest.facilityId);
    } catch (err) {
      result.failed.push({ id: spec.id, error: err instanceof Error ? err.message : String(err) });
      logger.error('Demo seeding failed.', { id: spec.id, error: String(err) });
    }
  }

  result.durationMs = Date.now() - start;
  logger.info('Demo seeding complete.', {
    seeded: result.seeded.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
    ms: result.durationMs,
  });
  return result;
}

/** Cheaply read the first and last timestamps from a demo CSV. */
async function peekCsvRange(content: Buffer): Promise<{ from: Date; to: Date } | null> {
  const text = content.toString('utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = (lines[0] as string).split(',').map((h) => h.trim().toLowerCase());
  let tsIndex = header.findIndex((h) => h.includes('time') || h.includes('date'));
  if (tsIndex < 0) tsIndex = 0;
  const first = (lines[1] as string).split(',')[tsIndex]?.replace(/"/g, '').trim();
  const last = (lines[lines.length - 1] as string).split(',')[tsIndex]?.replace(/"/g, '').trim();
  const from = first ? new Date(first) : null;
  const to = last ? new Date(last) : null;
  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
  return { from, to };
}

/** CLI entry: `tsx src/ingestion/db/seed.ts` */
async function main(): Promise<void> {
  const { getIngestionConfig } = await import('../config.js');
  const { createStore } = await import('../store/index.js');
  const { createConnectors } = await import('../connectors/index.js');

  const config = getIngestionConfig();
  const store = await createStore(config);
  const connectors = createConnectors(config);
  const force = process.argv.includes('--force');
  const result = await seedDemoFacilities({ store, config, carbon: connectors.carbon, force });
  await store.db.flush();
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('db/seed');
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
