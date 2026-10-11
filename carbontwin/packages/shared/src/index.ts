/**
 * CarbonTwin shared package — public entry point.
 * Zod schemas + TS types shared by web (M4), api (M2/M3) and ml contracts (M1).
 */

export * from './types';
export * from './constants';
export * from './ingestion.schemas';
export * from './ws.events';

// `api.schemas` and `ml.schemas` each re-declare the low-level `Timestamp` /
// `FacilityId` / `RegionCode` contracts, so they are surfaced as namespaces to
// keep the flattened `export *` surface unambiguous for consumers (M2/M3/M4).
export * as ApiSchemas from './api.schemas';
export * as MlSchemas from './ml.schemas';
