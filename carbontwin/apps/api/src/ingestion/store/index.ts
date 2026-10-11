/**
 * Store facade — wires the repositories onto a single LocalDatabase instance.
 */

import { getDatabase, type LocalDatabase } from '../db/client.js';
import type { IngestionConfig } from '../config.js';
import { FacilityRepository } from './facility.repo.js';
import { TimeseriesRepository } from './timeseries.repo.js';

export * from './facility.repo.js';
export * from './timeseries.repo.js';

export interface Store {
  db: LocalDatabase;
  facilities: FacilityRepository;
  timeseries: TimeseriesRepository;
}

export function createStoreFromDatabase(db: LocalDatabase): Store {
  return {
    db,
    facilities: new FacilityRepository(db),
    timeseries: new TimeseriesRepository(db),
  };
}

export async function createStore(config: IngestionConfig): Promise<Store> {
  const filePath = config.persistence === 'memory' ? null : config.persistenceFile;
  const db = await getDatabase(filePath);
  return createStoreFromDatabase(db);
}
