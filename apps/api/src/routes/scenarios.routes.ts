// Scenario endpoints return modeled annual KPIs and the MACC lever catalog.
import type { FastifyPluginAsync } from "fastify";
import { scenarioRunRequestSchema } from "../../../../packages/shared/src/api.schemas.js";
import { getMarginalAbatementCurve, runScenario } from "../services/scenarios.service.js";

export const scenariosRoutes: FastifyPluginAsync = async (app) => {
  app.post("/scenarios/run", async (request, reply) => {
    const input = scenarioRunRequestSchema.parse(request.body);
    const result = runScenario(input.facilityId);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });

  app.get("/scenarios/macc", async () => getMarginalAbatementCurve());
};
