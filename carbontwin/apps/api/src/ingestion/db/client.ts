/**
 * Local persistence client (dev/demo backend).
 * A dependency-free, JSON-file-backed store that models the TimescaleDB tables
 * (facilities, timeseries, quality_reports) so the ingestion layer can run and
 * be tested anywhere. In production the same repository interfaces are backed
 * by Postgres/TimescaleDB — see `schema.sql` and `store/*.repo.ts`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DataQualityReport, Facility } from '@carbontwin/shared';
import type { TimeseriesRecord } from '../types.js';

export const SCHEMA_VERSION = 1;

export interface DatabaseShape {
  version: number;
  updatedAt: string;
  facilities: Facility[];
  /** facilityId → chronologically sorted records. */
  timeseries: Record<string, TimeseriesRecord[]>;
  /** facilityId → latest quality report. */
  qualityReports: Record<string, DataQualityReport>;
  /** facilityId → auxiliary series (weather, CI) keyed by kind. */
  auxiliary: Record<string, Record<string, unknown>>;
}

function emptyDatabase(): DatabaseShape {
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    facilities: [],
    timeseries: {},
    qualityReports: {},
    auxiliary: {},
  };
}

export interface LocalDatabaseOptions {
  /** Absolute path to the JSON file, or null for pure in-memory. */
  filePath?: string | null;
  /** Debounce window for writes (ms). */
  persistDebounceMs?: number;
}

export class LocalDatabase {
  private data: DatabaseShape = emptyDatabase();
  private readonly filePath: string | null;
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly persistDebounceMs: number;

  constructor(options: LocalDatabaseOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.persistDebounceMs = options.persistDebounceMs ?? 100;
  }

  /** Open (loading from disk when a path is configured). */
  static async open(options: LocalDatabaseOptions = {}): Promise<LocalDatabase> {
    const db = new LocalDatabase(options);
    await db.load();
    return db;
  }

  get schema(): DatabaseShape {
    return this.data;
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as DatabaseShape;
      this.data = {
        ...emptyDatabase(),
        ...parsed,
        facilities: parsed.facilities ?? [],
        timeseries: parsed.timeseries ?? {},
        qualityReports: parsed.qualityReports ?? {},
        auxiliary: parsed.auxiliary ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Corrupt file — start fresh rather than crash the whole service.
        this.data = emptyDatabase();
      }
    }
  }

  touch(): void {
    this.data.updatedAt = new Date().toISOString();
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (!this.filePath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.persist();
    }, this.persistDebounceMs);
    // Do not keep the process alive on this timer.
    this.persistTimer.unref?.();
  }

  async persist(): Promise<void> {
    if (!this.filePath) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data), 'utf-8');
    await fs.rename(tmp, this.filePath);
  }

  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persist();
  }

  async reset(): Promise<void> {
    this.data = emptyDatabase();
    await this.flush();
  }
}

/** Singleton per process, keyed by file path, for convenient route wiring. */
const registry = new Map<string, Promise<LocalDatabase>>();

export function getDatabase(filePath: string | null): Promise<LocalDatabase> {
  const key = filePath ?? ':memory:';
  const existing = registry.get(key);
  if (existing) return existing;
  const created = LocalDatabase.open({ filePath });
  registry.set(key, created);
  return created;
}

export async function resetDatabaseRegistry(): Promise<void> {
  registry.clear();
}
