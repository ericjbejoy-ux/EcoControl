// Fastify application factory registers plugins, shared API routes, and validation errors.
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { carbonRoutes } from "./routes/carbon.routes.js";
import { copilotRoutes } from "./routes/copilot.routes.js";
import { facilitiesRoutes } from "./routes/facilities.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { impactRoutes } from "./routes/impact.routes.js";
import { optimizeRoutes } from "./routes/optimize.routes.js";
import { reportsRoutes } from "./routes/reports.routes.js";
import { scenariosRoutes } from "./routes/scenarios.routes.js";
import { twinRoutes } from "./routes/twin.routes.js";
import { weatherRoutes } from "./routes/weather.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test"
  });

  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Validation failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(facilitiesRoutes);
    await api.register(carbonRoutes);
    await api.register(weatherRoutes);
    await api.register(twinRoutes);
    await api.register(scenariosRoutes);
    await api.register(optimizeRoutes);
    await api.register(reportsRoutes);
    await api.register(impactRoutes);
    await api.register(copilotRoutes);
  }, { prefix: "/api/v1" });

  return app;
}
