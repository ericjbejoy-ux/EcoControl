// Weather route accepts geographic coordinates and returns a 24-hour synthetic outlook.
import type { FastifyPluginAsync } from "fastify";
import { weatherQuerySchema } from "../../../../packages/shared/src/api.schemas.js";
import { getWeather } from "../services/energy.service.js";

export const weatherRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { lat: string; lon: string } }>("/weather", async (request) => {
    const { lat, lon } = weatherQuerySchema.parse(request.query);
    return getWeather(lat, lon);
  });
};
