// Copilot endpoint supplies an honest mock answer without calling an external LLM.
import type { FastifyPluginAsync } from "fastify";
import { copilotAskRequestSchema } from "../../../../packages/shared/src/api.schemas.js";
import { askCopilot } from "../services/operations.service.js";

export const copilotRoutes: FastifyPluginAsync = async (app) => {
  app.post("/copilot/ask", async (request) => {
    const { question, facilityId } = copilotAskRequestSchema.parse(request.body);
    return askCopilot(question, facilityId);
  });
};
