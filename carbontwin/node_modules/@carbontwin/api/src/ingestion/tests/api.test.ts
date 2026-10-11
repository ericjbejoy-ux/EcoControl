/**
 * HTTP integration tests for the M2 ingestion app (Fastify).
 * Exercises upload → query → emissions → carbon/weather → replay end to end
 * against an in-memory service (no network, no disk).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEMO_FACILITY_IDS } from '@carbontwin/shared';
import { buildIngestionApp } from '../app.js';
import { IngestionService } from '../service.js';
import { MemoryCache, createConnectors } from '../connectors/index.js';
import { makePowerCsv, memoryStore, silentLogger, testConfig } from './helpers.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const BOUNDARY = '----carbontwinTestBoundary';

interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

function multipartBody(fields: Record<string, string>, file: MultipartFile): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf-8'
      )
    );
  }
  chunks.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf-8'
    )
  );
  chunks.push(file.content);
  chunks.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf-8'));
  return Buffer.concat(chunks);
}

async function buildService(): Promise<IngestionService> {
  const config = testConfig();
  const store = await memoryStore();
  const connectors = createConnectors(config, new MemoryCache());
  return IngestionService.create({
    config,
    store,
    carbon: connectors.carbon,
    weather: connectors.weather,
    logger: silentLogger,
  });
}

describe('ingestion API', () => {
  let app: FastifyInstance;
  let facilityId: string;

  beforeAll(async () => {
    const service = await buildService();
    app = await buildIngestionApp({ service, seedDemo: false, enableScheduler: false });
    await app.ready();

    const { content } = makePowerCsv({
      startIso: '2024-03-01T00:00:00Z',
      count: 24,
      power: (i) => 80 + i,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/facilities/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipartBody(
        {
          name: 'API Upload',
          type: 'office',
          region: 'IN-MH',
          timezone: 'Asia/Kolkata',
          lat: '19.076',
          lon: '72.8777',
        },
        { field: 'file', filename: 'meter.csv', contentType: 'text/csv', content }
      ),
    });
    expect(res.statusCode).toBe(201);
    facilityId = res.json().facilityId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
    expect(body.facilities).toBe(1);
  });

  it('accepts a multipart CSV upload and detects the schema', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/facilities/${facilityId}` });
    expect(res.statusCode).toBe(200);
    const facility = res.json().facility;
    expect(facility.name).toBe('API Upload');
    expect(facility.region).toBe('IN-MH');
    expect(facility.timezone).toBe('Asia/Kolkata');
  });

  it('lists the uploaded facility', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/facilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.facilities[0].id).toBe(facilityId);
  });

  it('returns the 15-minute time-series', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/facilities/${facilityId}/timeseries`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(24);
    expect(body.meta.count).toBe(24);
    expect(body.meta.dataSource).toBe('uploaded');
  });

  it('returns summary stats', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/facilities/${facilityId}/stats` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(24);
    expect(body.totalEnergyKwh).toBeGreaterThan(0);
    expect(body.peakKw).toBeGreaterThan(0);
  });

  it('returns the data-quality report', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/facilities/${facilityId}/quality` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.qualityReport.facilityId).toBe(facilityId);
    expect(body.qualityReport.summary.totalRows).toBeGreaterThan(0);
  });

  it('returns the dynamic-vs-static emissions comparison', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/facilities/${facilityId}/emissions`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comparison).toHaveLength(24);
    expect(body.totals.dynamicEmissionsKg).toBeGreaterThan(0);
    expect(body.totals.annualAverageCiUsed).toBe(700); // IN-MH
  });

  it('creates a facility from JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/facilities',
      payload: {
        name: 'Manual Facility',
        type: 'hospital',
        region: 'GB-LND',
        timezone: 'Europe/London',
        lat: 51.5074,
        lon: -0.1278,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().facility.name).toBe('Manual Facility');
  });

  it('rejects an invalid create payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/facilities',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown facility', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/facilities/${UNKNOWN_ID}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('FACILITY_NOT_FOUND');
  });

  it('rejects an unsupported upload type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/facilities/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipartBody(
        { name: 'Bad' },
        {
          field: 'file',
          filename: 'notes.txt',
          contentType: 'text/plain',
          content: Buffer.from('hello'),
        }
      ),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('INVALID_FILE_TYPE');
  });

  it('serves carbon intensity with the fallback ladder metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/carbon/intensity?region=IN-MH' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.region).toBe('IN-MH');
    expect(body.current.dataSource).toBe('synthetic');
    expect(body.meta.provider).toBe('fallback');
    expect(Array.isArray(body.forecast)).toBe(true);
  });

  it('serves weather for a region', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/weather?region=IN-MH' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lat).toBeCloseTo(19.076, 3);
    expect(body.current.temperatureC).toBeGreaterThan(-60);
    expect(body.meta.dataSource).toBe('synthetic');
  });

  it('drives the replay engine through the API', async () => {
    const idle = await app.inject({ method: 'GET', url: '/api/v1/facilities/replay/status' });
    expect(idle.statusCode).toBe(200);
    expect(idle.json().state).toBe('idle');

    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/facilities/${facilityId}/replay`,
      payload: { action: 'start', speedMultiplier: 100000 },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().state).toBe('playing');
    expect(start.json().total).toBe(24);

    const stop = await app.inject({
      method: 'POST',
      url: `/api/v1/facilities/${facilityId}/replay`,
      payload: { action: 'stop' },
    });
    expect(stop.statusCode).toBe(200);
    expect(stop.json().state).toBe('prepared');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('demo seeding (real CSV files)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const service = await buildService();
    app = await buildIngestionApp({ service, seedDemo: true, enableScheduler: false });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('seeds all five demo facilities on boot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/facilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(5);
    const ids = body.facilities.map((f: { id: string }) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        DEMO_FACILITY_IDS.officeTower,
        DEMO_FACILITY_IDS.hospital,
        DEMO_FACILITY_IDS.campus,
        DEMO_FACILITY_IDS.dataCenter,
        DEMO_FACILITY_IDS.chennaiPark,
      ])
    );
    expect(body.facilities.every((f: { isDemo: boolean }) => f.isDemo)).toBe(true);
  });

  it('serves the office-tower series and quality report', async () => {
    const ts = await app.inject({
      method: 'GET',
      url: `/api/v1/facilities/${DEMO_FACILITY_IDS.officeTower}/timeseries?limit=5`,
    });
    expect(ts.statusCode).toBe(200);
    expect(ts.json().data).toHaveLength(5);

    const quality = await app.inject({
      method: 'GET',
      url: `/api/v1/facilities/${DEMO_FACILITY_IDS.officeTower}/quality`,
    });
    expect(quality.statusCode).toBe(200);
    expect(quality.json().qualityReport.facilityId).toBe(DEMO_FACILITY_IDS.officeTower);
  });

  it('lists the curated demo catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/facilities/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.json().facilities).toHaveLength(5);
  });
});
