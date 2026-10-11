/**
 * Weather routes (M2) — current + forecast weather by location (FR-4).
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { IngestionService } from '../service.js';
import { IngestionError } from '../errors.js';
import { coordsForRegion } from '../connectors/fallbackProvider.js';

const querySchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90).optional(),
  lon: z.coerce.number().gte(-180).lte(180).optional(),
  region: z.string().min(2).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function weatherRoutes(service: IngestionService): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get('/weather', async (request) => {
      const result = querySchema.safeParse(request.query);
      if (!result.success) {
        throw new IngestionError('VALIDATION_ERROR', 'Invalid query parameters.', 400, {
          issues: result.error.issues,
        });
      }
      let { lat, lon } = result.data;
      if ((lat === undefined || lon === undefined) && result.data.region) {
        const coords = coordsForRegion(result.data.region);
        lat = coords.lat;
        lon = coords.lon;
      }
      if (lat === undefined || lon === undefined) {
        const coords = coordsForRegion(service.config.defaultRegion);
        lat = coords.lat;
        lon = coords.lon;
      }
      return service.getWeather(lat, lon, {
        from: result.data.from,
        to: result.data.to,
        region: result.data.region,
      });
    });
  };
}
