/**
 * Tiny JSON file cache for external provider responses (NFR-2, FR-3).
 * Survives restarts, ships as part of the offline demo pack, and is the second
 * tier of the Live → Cached → Synthetic fallback ladder.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface CacheEntry<T> {
  value: T;
  savedAt: string; // ISO
}

export interface CacheSetOptions {
  /** TTL in ms; entries older than this are treated as stale reads unless staleOk. */
  ttlMs?: number;
}

export class JsonFileCache {
  constructor(private readonly dir: string) {}

  private filePath(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  async get<T>(key: string, options: { allowStale?: boolean; ttlMs?: number } = {}): Promise<CacheEntry<T> | null> {
    try {
      const raw = await fs.readFile(this.filePath(key), 'utf-8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (!entry || typeof entry.savedAt !== 'string') return null;
      const age = Date.now() - Date.parse(entry.savedAt);
      const ttl = options.ttlMs ?? null;
      const stale = ttl !== null && age > ttl;
      if (stale && !options.allowStale) return null;
      return entry;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const entry: CacheEntry<T> = { value, savedAt: new Date().toISOString() };
    const tmp = `${this.filePath(key)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry, null, 2), 'utf-8');
    await fs.rename(tmp, this.filePath(key));
  }

  async getValue<T>(key: string, options: { allowStale?: boolean; ttlMs?: number } = {}): Promise<T | null> {
    const entry = await this.get<T>(key, options);
    return entry ? entry.value : null;
  }

  async has(key: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** In-memory cache with the same shape, for tests and ephemeral mode. */
export class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string, options: { allowStale?: boolean; ttlMs?: number } = {}): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (options.ttlMs !== undefined && !options.allowStale) {
      if (Date.now() - Date.parse(entry.savedAt) > options.ttlMs) return null;
    }
    return entry;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, { value, savedAt: new Date().toISOString() });
  }

  async getValue<T>(key: string, options: { allowStale?: boolean; ttlMs?: number } = {}): Promise<T | null> {
    const entry = await this.get<T>(key, options);
    return entry ? entry.value : null;
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export type CacheLike = Pick<JsonFileCache, 'get' | 'set' | 'getValue' | 'has'>;
