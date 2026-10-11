/**
 * Standalone ingestion server entry point (M2).
 * Run with: `npm run dev:ingestion` (watch) or `npm run start:ingestion`.
 *
 * Env:
 *   PORT, HOST, LOG_LEVEL
 *   ELECTRICITY_MAPS_TOKEN, CO2SIGNAL_TOKEN, OPENWEATHER_KEY
 *   USE_FALLBACK_DATA=true      → never call upstream APIs
 *   INGESTION_PERSISTENCE=memory|file   (default file)
 *   ENABLE_SCHEDULER=true|false
 *   SEED_ON_START=true|false
 */

import { loadIngestionConfig } from './config.js';
import { buildIngestionApp } from './app.js';
import { getLogger } from './logger.js';

async function main(): Promise<void> {
  const config = loadIngestionConfig();
  const logger = getLogger();

  const app = await buildIngestionApp({
    config,
    seedDemo: process.env.SEED_ON_START !== 'false',
    enableScheduler: config.enableScheduler && process.env.SCHEDULER_OFF !== 'true',
    logger,
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info('Ingestion API listening', {
      url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
      persistence: config.persistence,
      useFallbackData: config.useFallbackData,
    });
  } catch (err) {
    logger.fatal('Failed to start ingestion API', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info('Shutting down…', { signal });
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
