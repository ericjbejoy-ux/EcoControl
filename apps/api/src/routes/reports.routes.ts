// ESG report endpoint returns a mock-ready report ID and a clearly non-production URL.
import type { FastifyPluginAsync } from "fastify";
import { esgReportRequestSchema } from "../../../../packages/shared/src/api.schemas.js";
import { generateEsgReport } from "../services/operations.service.js";

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/reports/esg", async (request, reply) => {
    const input = esgReportRequestSchema.parse(request.body);
    const result = generateEsgReport(input.facilityId, input.period);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });
};
