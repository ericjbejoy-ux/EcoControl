// Twin route validates simulation input before delegating to the deterministic mock model.
import type { FastifyPluginAsync } from "fastify";
import { twinSimulationRequestSchema } from "../../../../packages/shared/src/api.schemas.js";
import { simulateTwin } from "../services/twin.service.js";

export const twinRoutes: FastifyPluginAsync = async (app) => {
  app.post("/twin/simulate", async (request, reply) => {
    const input = twinSimulationRequestSchema.parse(request.body);
    const result = simulateTwin(input);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });
};
