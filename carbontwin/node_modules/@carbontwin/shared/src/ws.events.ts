/**
 * WebSocket event contracts (SRS §6.2)
 * Emitted by the ingestion replay/live engine and forwarded by the WS hub.
 */

import { z } from 'zod';

export const WsTimestampSchema = z.string().datetime({ offset: true });

export const DataSourceLabelSchema = z.enum(['live', 'cached', 'synthetic']);

/** `tick` — one streaming data frame (replay or live). */
export const TickEventSchema = z.object({
  type: z.literal('tick'),
  facilityId: z.string().uuid(),
  ts: WsTimestampSchema,
  powerKw: z.number().finite(),
  ci: z.number().finite(), // gCO2/kWh
  emissionsKg: z.number().finite(),
  tempIn: z.number().finite().optional(),
  tempOut: z.number().finite().optional(),
  humidityPct: z.number().finite().optional(),
  irradianceWm2: z.number().finite().optional(),
  dataSource: DataSourceLabelSchema,
  isReplay: z.boolean(),
  progressPct: z.number().min(0).max(100),
});
export type TickEvent = z.infer<typeof TickEventSchema>;

/** `anomaly` — a flagged wasteful interval (FR-19). */
export const AnomalyEventSchema = z.object({
  type: z.literal('anomaly'),
  facilityId: z.string().uuid(),
  ts: WsTimestampSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  estWasteKg: z.number().finite(),
  description: z.string(),
});
export type AnomalyEvent = z.infer<typeof AnomalyEventSchema>;

/** `schedule:update` — a new MPC plan (FR-27/28). */
export const ScheduleUpdateEventSchema = z.object({
  type: z.literal('schedule:update'),
  facilityId: z.string().uuid(),
  generatedAt: WsTimestampSchema,
  horizonHours: z.number().int().positive(),
  points: z.array(
    z.object({
      ts: WsTimestampSchema,
      throttle: z.number().min(0).max(1),
      tempInC: z.number().finite(),
      emissionsKg: z.number().finite(),
    })
  ),
  emissionsReductionPct: z.number().finite(),
});
export type ScheduleUpdateEvent = z.infer<typeof ScheduleUpdateEventSchema>;

/** `status` — connection / replay lifecycle. */
export const StatusEventSchema = z.object({
  type: z.literal('status'),
  facilityId: z.string().uuid().optional(),
  state: z.enum(['connected', 'replay_started', 'replay_paused', 'replay_finished', 'error']),
  message: z.string().optional(),
  ts: WsTimestampSchema,
});
export type StatusEvent = z.infer<typeof StatusEventSchema>;

export const WsEventSchema = z.discriminatedUnion('type', [
  TickEventSchema,
  AnomalyEventSchema,
  ScheduleUpdateEventSchema,
  StatusEventSchema,
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

export const WsEventSchemas = {
  Tick: TickEventSchema,
  Anomaly: AnomalyEventSchema,
  ScheduleUpdate: ScheduleUpdateEventSchema,
  Status: StatusEventSchema,
  WsEvent: WsEventSchema,
} as const;
