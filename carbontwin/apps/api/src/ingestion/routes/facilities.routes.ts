/**
 * Facility routes (M2) — upload, list, time-series, quality, emissions, replay.
 * Registered under `/api/v1` by `routes/index.ts`.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES, type FacilityType } from '@carbontwin/shared';
import type { IngestionService } from '../service.js';
import { IngestionError, fileTooLarge, invalidFileType } from '../errors.js';
import { detectFileKind } from '../parsers/index.js';

const TIMESTAMP = z.string().datetime({ offset: true });

const timeseriesQuery = z.object({
  from: TIMESTAMP.optional(),
  to: TIMESTAMP.optional(),
  resolution: z.enum(['15m', '30m', '1h', '1d']).default('15m'),
  limit: z.coerce.number().int().positive().max(100000).optional(),
});

const emissionsQuery = z.object({
  from: TIMESTAMP.optional(),
  to: TIMESTAMP.optional(),
  annualAverageCi: z.coerce.number().positive().optional(),
});

const replayBody = z.object({
  action: z.enum(['start', 'pause', 'resume', 'stop', 'seek']).default('start'),
  from: TIMESTAMP.optional(),
  to: TIMESTAMP.optional(),
  speedMultiplier: z.number().positive().max(100000).default(1440),
  includeCarbonIntensity: z.boolean().default(true),
  includeWeather: z.boolean().default(true),
  progressPct: z.number().min(0).max(100).optional(),
});

const createFacilityBody = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['office', 'hospital', 'campus', 'data_center', 'retail', 'industrial', 'custom']),
  region: z.string().min(2),
  timezone: z.string().min(1).default('UTC'),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  address: z.string().optional(),
  floorAreaM2: z.number().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const resolutionToMinutes: Record<string, number> = { '15m': 15, '30m': 30, '1h': 60, '1d': 1440 };

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new IngestionError('VALIDATION_ERROR', 'Invalid request payload.', 400, {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export function facilitiesRoutes(service: IngestionService): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    // ---------------------------------------------------------------- upload
    app.post('/facilities/upload', async (request, reply) => {
      const parts = request.parts();
      let content: Buffer | null = null;
      let fileName = 'upload.csv';
      let mimeType: string | undefined;
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === 'file') {
          fileName = part.filename || fileName;
          mimeType = part.mimetype;
          const buffer = await part.toBuffer();
          if (buffer.length > MAX_UPLOAD_BYTES) throw fileTooLarge(buffer.length, MAX_UPLOAD_BYTES);
          content = buffer;
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }

      if (!content) throw new IngestionError('NO_FILE', 'No file was uploaded.', 400);
      if (!detectFileKind(fileName, mimeType)) throw invalidFileType(mimeType ?? fileName);

      const facility: Record<string, unknown> = {};
      if (fields.name) facility.name = fields.name;
      if (fields.type) facility.type = fields.type as FacilityType;
      if (fields.region) facility.region = fields.region;
      if (fields.timezone) facility.timezone = fields.timezone;
      if (fields.lat) facility.lat = Number(fields.lat);
      if (fields.lon) facility.lon = Number(fields.lon);
      if (fields.address) facility.address = fields.address;
      if (fields.floorAreaM2) facility.floorAreaM2 = Number(fields.floorAreaM2);

      const result = await service.upload({
        content,
        fileName,
        mimeType,
        facilityId: fields.facilityId,
        facility,
      });

      reply.code(201);
      return {
        success: true,
        facilityId: result.facilityId,
        facility: result.facility,
        detectedSchema: {
          timestampColumn: result.schema.timestampColumn,
          powerColumn: result.schema.powerColumn,
          timestampFormat: result.mapping.timestampFormat,
          timezone: result.mapping.timezone,
          unit: result.mapping.unit,
          isEnergy: result.mapping.isEnergy,
          intervalMinutes: result.schema.intervalMinutes,
          confidence: result.schema.confidence,
        },
        qualityReport: result.qualityReport,
        qualityScore: result.qualityScore,
        totals: result.totals,
        timings: result.timings,
        preview: result.series.slice(0, 10),
        warnings: result.warnings,
      };
    });

    // --------------------------------------------------------------- list/get
    app.get('/facilities', async () => {
      const facilities = await service.listFacilities();
      return { facilities, total: facilities.length };
    });

    app.get('/facilities/demo', async () => ({
      facilities: service.demoFacilitySpecs.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        region: f.region,
        description: f.description,
        tags: f.tags,
        file: f.file,
      })),
    }));

    app.post('/facilities/seed', async (request) => {
      const body = parseOrThrow(
        z.object({ force: z.boolean().default(false), only: z.array(z.string()).optional() }),
        request.body ?? {}
      );
      const result = await service.seed(body);
      return { success: true, ...result };
    });

    app.post('/facilities', async (request, reply) => {
      const body = parseOrThrow(createFacilityBody, request.body);
      const facility = await service.store.facilities.create({
        ...body,
        metadata: body.metadata ?? {},
      });
      reply.code(201);
      return { success: true, facility };
    });

    app.get<{ Params: { id: string } }>('/facilities/:id', async (request) => {
      const facility = await service.getFacility(request.params.id);
      return { facility };
    });

    app.delete<{ Params: { id: string } }>('/facilities/:id', async (request, reply) => {
      const deleted = await service.deleteFacility(request.params.id);
      if (!deleted) throw new IngestionError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
      reply.code(204);
      return null;
    });

    // ------------------------------------------------------------- timeseries
    app.get<{ Params: { id: string } }>('/facilities/:id/timeseries', async (request) => {
      const query = parseOrThrow(timeseriesQuery, request.query);
      return service.getTimeseries(request.params.id, {
        from: query.from,
        to: query.to,
        resolutionMinutes: resolutionToMinutes[query.resolution] ?? 15,
        limit: query.limit,
      });
    });

    app.get<{ Params: { id: string } }>('/facilities/:id/stats', async (request) => {
      return service.getStats(request.params.id);
    });

    app.get<{ Params: { id: string } }>('/facilities/:id/quality', async (request) => {
      const report = await service.getQualityReport(request.params.id);
      return { qualityReport: report };
    });

    // -------------------------------------------------------------- emissions
    app.get<{ Params: { id: string } }>('/facilities/:id/emissions', async (request) => {
      const query = parseOrThrow(emissionsQuery, request.query);
      return service.getEmissionsComparison(request.params.id, query);
    });

    // ----------------------------------------------------------------- replay
    app.post<{ Params: { id: string } }>('/facilities/:id/replay', async (request) => {
      const body = parseOrThrow(replayBody, request.body ?? {});
      if (body.action === 'start') {
        await service.prepareReplay({
          facilityId: request.params.id,
          from: body.from,
          to: body.to,
          speedMultiplier: body.speedMultiplier,
          includeCarbonIntensity: body.includeCarbonIntensity,
          includeWeather: body.includeWeather,
        });
        return service.replay.play();
      }
      if (body.action === 'pause') return service.replay.pause();
      if (body.action === 'resume') return service.replay.resume();
      if (body.action === 'stop') return service.replay.stop();
      return service.replay.seek(body.progressPct ?? 0);
    });

    app.get('/facilities/replay/status', async () => service.replay.status);
  };
}
