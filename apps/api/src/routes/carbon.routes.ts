// Carbon intensity route validates its region selector before building a 96-step forecast.
import type { FastifyPluginAsync } from "fastify";
import { carbonIntensityQuerySchema } from "../../../../packages/shared/src/api.schemas.js";
import { getCarbonIntensity } from "../services/energy.service.js";

export const carbonRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { region: string } }>("/carbon/intensity", async (request) => {
    const { region } = carbonIntensityQuerySchema.parse(request.query);
    return getCarbonIntensity(region);
  });
};
