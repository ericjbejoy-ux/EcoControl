/**
 * Shared Zod schemas for API layer
 * Used by Node.js API gateway and TypeScript frontend
 */

import { z } from 'zod';

export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const FacilityIdSchema = z.string().uuid();
export type FacilityId = z.infer<typeof FacilityIdSchema>;

export const RegionCodeSchema = z.string().regex(/^[A-Z]{2}-[A-Z]{2,3}$/);
export type RegionCode = z.infer<typeof RegionCodeSchema>;

// Health check
export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'down']),
  timestamp: TimestampSchema,
  version: z.string(),
  uptime: z.number(),
  dependencies: z.record(z.string(), z.enum(['healthy', 'degraded', 'down'])),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Error responses
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  timestamp: TimestampSchema,
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: ApiErrorSchema.optional(),
    meta: z.object({
      requestId: z.string(),
      timestamp: TimestampSchema,
      durationMs: z.number(),
    }),
  });

// Pagination
export const PaginationParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    pagination: z.object({
      page: z.number().int().positive(),
      limit: z.number().int().positive(),
      total: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
    }),
  });

// API Schemas for routes
export const ApiSchemas = {
  Timestamp: TimestampSchema,
  FacilityId: FacilityIdSchema,
  RegionCode: RegionCodeSchema,
  HealthResponse: HealthResponseSchema,
  ApiError: ApiErrorSchema,
  PaginationParams: PaginationParamsSchema,
} as const;