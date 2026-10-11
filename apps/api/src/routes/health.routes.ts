// Liveness endpoint reports the status of the mock-backed gateway dependencies.
import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: { api: "ok", mockData: "ok", ml: "mock", database: "not-configured" }
  }));
};
