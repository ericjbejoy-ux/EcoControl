// Shared WebSocket event shapes are ready for a later live-stream implementation.
import { z } from "zod";

export const tickEventSchema = z.object({
  ts: z.string().datetime(),
  powerKw: z.number().min(50).max(300),
  ci: z.number().min(200).max(800),
  emissionsKg: z.number().nonnegative(),
  tempIn: z.number().min(15).max(35),
  tempOut: z.number().min(15).max(35)
});

export const anomalyEventSchema = z.object({
  ts: z.string().datetime(),
  severity: z.enum(["low", "medium", "high"]),
  estWasteKg: z.number().nonnegative()
});

export const scheduleUpdateEventSchema = z.object({
  schedule: z.array(z.object({
    ts: z.string().datetime(),
    hvacPct: z.number().min(0).max(100)
  }))
});

export const wsEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("tick"), payload: tickEventSchema }),
  z.object({ event: z.literal("anomaly"), payload: anomalyEventSchema }),
  z.object({ event: z.literal("schedule:update"), payload: scheduleUpdateEventSchema })
]);

export type WsEvent = z.infer<typeof wsEventSchema>;
