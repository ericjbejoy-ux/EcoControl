// Facility endpoints expose the demo portfolio, aligned meter data, forecasts, and explanations.
import type { FastifyPluginAsync } from "fastify";
import {
  explainQuerySchema,
  facilityIdParamsSchema,
  facilityTimeseriesQuerySchema
} from "../../../../packages/shared/src/api.schemas.js";
import { explainFacility, getFacilityForecast } from "../services/energy.service.js";
import { getFacilityTimeseries, listFacilities } from "../services/facilities.service.js";

export const facilitiesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/facilities", async () => listFacilities());

  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; res?: "15m" | "1h" };
  }>("/facilities/:id/timeseries", async (request, reply) => {
    const { id } = facilityIdParamsSchema.parse(request.params);
    const query = facilityTimeseriesQuerySchema.parse(request.query);
    const result = getFacilityTimeseries(id, query);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });

  app.get<{ Params: { id: string } }>("/facilities/:id/forecast", async (request, reply) => {
    const { id } = facilityIdParamsSchema.parse(request.params);
    const result = getFacilityForecast(id);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });

  app.get<{ Params: { id: string }; Querystring: { ts?: string } }>("/facilities/:id/explain", async (request, reply) => {
    const { id } = facilityIdParamsSchema.parse(request.params);
    const { ts } = explainQuerySchema.parse(request.query);
    const result = explainFacility(id, ts);
    if (!result) return reply.code(404).send({ error: "Facility not found" });
    return result;
  });
};
