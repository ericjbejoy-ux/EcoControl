// Schedule endpoint produces a comfort-aware 96-interval HVAC plan.
import type { FastifyPluginAsync } from "fastify";
import { optimizeScheduleRequestSchema } from "../../../../packages/shared/src/api.schemas.js";
import { optimizeSchedule } from "../services/operations.service.js";

export const optimizeRoutes: FastifyPluginAsync = async (app) => {
  app.post("/optimize/schedule", async (request, reply) => {
    const { facilityId } = optimizeScheduleRequestSchema.parse(request.body);
    const result = optimizeSchedule(facilityId);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });
};
