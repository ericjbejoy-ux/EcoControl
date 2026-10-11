/**
 * Carbon routes (M2) — live grid carbon intensity + forecast (FR-3).
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { IngestionService } from '../service.js';
import { IngestionError } from '../errors.js';

const querySchema = z.object({
  region: z.string().min(2).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function carbonRoutes(service: IngestionService): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get('/carbon/intensity', async (request) => {
      const result = querySchema.safeParse(request.query);
      if (!result.success) {
        throw new IngestionError('VALIDATION_ERROR', 'Invalid query parameters.', 400, {
          issues: result.error.issues,
        });
      }
      const region = result.data.region ?? service.config.defaultRegion;
      return service.getCarbonIntensity(region, { from: result.data.from, to: result.data.to });
    });

    app.get('/carbon/regions', async () => {
      // Expose the regions we have profiles/cache for, so the UI can populate a picker.
      const { ANNUAL_AVERAGE_CI, REGION_CENTROIDS } = await import('@carbontwin/shared');
      return {
        regions: Object.keys(ANNUAL_AVERAGE_CI).map((code) => ({
          code,
          annualAverageCi: ANNUAL_AVERAGE_CI[code],
          city: REGION_CENTROIDS[code]?.city ?? code,
          timezone: REGION_CENTROIDS[code]?.timezone ?? 'UTC',
        })),
      };
    });
  };
}
