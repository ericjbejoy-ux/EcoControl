// Impact route converts a requested emissions quantity into familiar equivalencies.
import type { FastifyPluginAsync } from "fastify";
import { impactQuerySchema } from "../../../../packages/shared/src/api.schemas.js";
import { getImpactEquivalents } from "../services/operations.service.js";

export const impactRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { tco2e: string } }>("/impact/equivalents", async (request) => {
    const { tco2e } = impactQuerySchema.parse(request.query);
    return getImpactEquivalents(tco2e);
  });
};
