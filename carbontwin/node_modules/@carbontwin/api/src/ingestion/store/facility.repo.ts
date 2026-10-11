/**
 * Facility repository (store/facility.repo.ts).
 * CRUD over facilities + their latest data-quality report.
 */

import { randomUUID } from 'node:crypto';
import type { CreateFacilityRequest, DataQualityReport, Facility } from '@carbontwin/shared';
import type { LocalDatabase } from '../db/client.js';

export type CreateFacilityInput = Omit<CreateFacilityRequest, 'metadata'> & {
  id?: string;
  isDemo?: boolean;
  dataSource?: Facility['dataSource'];
  metadata?: Record<string, unknown>;
};

export class FacilityRepository {
  constructor(private readonly db: LocalDatabase) {}

  async create(input: CreateFacilityInput): Promise<Facility> {
    const now = new Date().toISOString();
    const facility: Facility = {
      id: input.id ?? randomUUID(),
      name: input.name,
      type: input.type,
      region: input.region,
      timezone: input.timezone,
      lat: input.lat,
      lon: input.lon,
      address: input.address,
      floorAreaM2: input.floorAreaM2,
      operatingHours: input.operatingHours,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      isDemo: input.isDemo ?? false,
      dataSource: input.dataSource ?? 'uploaded',
    };
    const existing = this.db.schema.facilities.findIndex((f) => f.id === facility.id);
    if (existing >= 0) this.db.schema.facilities[existing] = facility;
    else this.db.schema.facilities.push(facility);
    if (!this.db.schema.timeseries[facility.id]) this.db.schema.timeseries[facility.id] = [];
    this.db.touch();
    return facility;
  }

  async upsert(facility: Facility): Promise<Facility> {
    const index = this.db.schema.facilities.findIndex((f) => f.id === facility.id);
    if (index >= 0) this.db.schema.facilities[index] = { ...facility, updatedAt: new Date().toISOString() };
    else this.db.schema.facilities.push(facility);
    if (!this.db.schema.timeseries[facility.id]) this.db.schema.timeseries[facility.id] = [];
    this.db.touch();
    return facility;
  }

  async get(id: string): Promise<Facility | null> {
    return this.db.schema.facilities.find((f) => f.id === id) ?? null;
  }

  async list(filter: { type?: Facility['type']; region?: string; isDemo?: boolean } = {}): Promise<Facility[]> {
    return this.db.schema.facilities.filter((f) => {
      if (filter.type && f.type !== filter.type) return false;
      if (filter.region && f.region !== filter.region) return false;
      if (filter.isDemo !== undefined && f.isDemo !== filter.isDemo) return false;
      return true;
    });
  }

  async update(id: string, patch: Partial<Facility>): Promise<Facility | null> {
    const facility = await this.get(id);
    if (!facility) return null;
    const updated: Facility = { ...facility, ...patch, id: facility.id, updatedAt: new Date().toISOString() };
    const index = this.db.schema.facilities.findIndex((f) => f.id === id);
    this.db.schema.facilities[index] = updated;
    this.db.touch();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const before = this.db.schema.facilities.length;
    this.db.schema.facilities = this.db.schema.facilities.filter((f) => f.id !== id);
    delete this.db.schema.timeseries[id];
    delete this.db.schema.qualityReports[id];
    delete this.db.schema.auxiliary[id];
    const changed = this.db.schema.facilities.length !== before;
    if (changed) this.db.touch();
    return changed;
  }

  async exists(id: string): Promise<boolean> {
    return this.db.schema.facilities.some((f) => f.id === id);
  }

  async count(): Promise<number> {
    return this.db.schema.facilities.length;
  }

  async saveQualityReport(report: DataQualityReport): Promise<void> {
    this.db.schema.qualityReports[report.facilityId] = report;
    this.db.touch();
  }

  async getQualityReport(facilityId: string): Promise<DataQualityReport | null> {
    return this.db.schema.qualityReports[facilityId] ?? null;
  }

  async setAuxiliary(facilityId: string, kind: string, payload: unknown): Promise<void> {
    const bucket = this.db.schema.auxiliary[facilityId] ?? {};
    bucket[kind] = payload;
    this.db.schema.auxiliary[facilityId] = bucket;
    this.db.touch();
  }

  async getAuxiliary<T>(facilityId: string, kind: string): Promise<T | null> {
    const bucket = this.db.schema.auxiliary[facilityId];
    if (!bucket) return null;
    return (bucket[kind] as T) ?? null;
  }
}
