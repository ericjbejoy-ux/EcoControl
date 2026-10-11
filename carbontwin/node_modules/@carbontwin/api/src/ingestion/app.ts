/**
 * Ingestion-scoped Fastify application (M2).
 * A self-contained, runnable HTTP surface for the data-ingestion layer so M2's
 * work can be developed, tested and demoed before M3 wires the full gateway.
 * M3 can import `buildIngestionApp` and register these routes in `app.ts`.
 */

import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@carbontwin/shared';
import { IngestionService, type IngestionServiceDeps } from './service.js';
import { IngestionError } from './errors.js';
import { registerIngestionRoutes } from './routes/index.js';
import { getLogger } from './logger.js';

export interface BuildAppOptions extends IngestionServiceDeps {
  /** Seed the four demo facilities on boot (default true). */
  seedDemo?: boolean;
  /** Start the CI/weather refresh cron jobs (default: from config). */
  enableScheduler?: boolean;
  /** Inject a pre-built service (mainly for tests). */
  service?: IngestionService;
}

export async function buildIngestionApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const logger = options.logger ?? getLogger();
  const app = Fastify({
    logger: false,
    bodyLimit: MAX_UPLOAD_BYTES,
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 30 },
  });

  const service = options.service ?? (await IngestionService.create(options));
  app.decorate('ingestion', service);
  app.addHook('onClose', async () => {
    service.replay.stop();
    await service.flush();
  });

  // ------------------------------------------------------------- error handler
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof IngestionError) {
      logger.warn('Ingestion error', { code: error.code, message: error.message, url: request.url });
      reply.code(error.statusCode).send({ success: false, error: error.toJSON() });
      return;
    }
    if ((error as { statusCode?: number }).statusCode === 413) {
      reply.code(413).send({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: `File exceeds the ${MAX_UPLOAD_MB} MB limit.` },
      });
      return;
    }
    if (error.validation) {
      reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message, details: { validation: error.validation } },
      });
      return;
    }
    logger.error('Unhandled error', { message: error.message, stack: error.stack, url: request.url });
    reply.code(error.statusCode ?? 500).send({
      success: false,
      error: { code: error.code ?? 'INTERNAL_ERROR', message: error.message },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found.` },
    });
  });

  // --------------------------------------------------------------- root/health
  app.get('/health', async () => service.health());
  app.get('/api/v1/health', async () => service.health());

  await registerIngestionRoutes(app, service);

  // --------------------------------------------------------------- demo seeding
  // Idempotent reconciliation (FR-2): the seeder skips facilities that already
  // exist and ingests any demo facility that's missing from the store. Running
  // it on every boot — instead of gating on an empty store — means upgrades that
  // add new demo facilities (e.g. Chennai IT Park) self-heal existing stores.
  const shouldSeed = options.seedDemo ?? true;
  if (shouldSeed) {
    logger.info('Seeding demo facilities… (missing only, idempotent)');
    const result = await service.seed({});
    logger.info(
      result.seeded.length > 0 ? 'Demo seed result' : 'Demo facilities already present',
      { ...result },
    );
  }

  // ----------------------------------------------------------------- scheduler
  const enableScheduler = options.enableScheduler ?? service.config.enableScheduler;
  if (enableScheduler) {
    const { RefreshJobs } = await import('./scheduler/refreshJobs.js');
    const jobs = new RefreshJobs({
      config: service.config,
      carbon: service.carbon,
      weather: service.weather,
      logger,
    });
    jobs.start();
    app.addHook('onClose', async () => jobs.stop());
    // Warm caches in the background (don't block boot).
    void jobs.runOnce().catch((err) => logger.warn('Initial refresh failed.', { error: String(err) }));
  }

  return app;
}
