/**
 * Route registration for the ingestion layer.
 * Registers facility, carbon and weather routes under the `/api/v1` prefix.
 */

import type { FastifyInstance } from 'fastify';
import type { IngestionService } from '../service.js';
import { facilitiesRoutes } from './facilities.routes.js';
import { carbonRoutes } from './carbon.routes.js';
import { weatherRoutes } from './weather.routes.js';

export async function registerIngestionRoutes(app: FastifyInstance, service: IngestionService): Promise<void> {
  await app.register(
    async (scoped) => {
      await scoped.register(facilitiesRoutes(service));
      await scoped.register(carbonRoutes(service));
      await scoped.register(weatherRoutes(service));

      scoped.get('/ingestion/health', async () => service.health());
    },
    { prefix: '/api/v1' }
  );
}

export { facilitiesRoutes, carbonRoutes, weatherRoutes };
