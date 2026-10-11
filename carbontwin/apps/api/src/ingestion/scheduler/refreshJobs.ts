/**
 * Refresh jobs (FR-3, FR-4).
 * Cron jobs that keep grid carbon intensity + weather caches warm so that the
 * dashboard always has fresh data and the fallback layer is always populated
 * before a demo. Uses `node-cron`; jobs can also be run once via `runOnce`.
 */

import cron, { type ScheduledTask } from 'node-cron';
import type { IngestionConfig } from '../config.js';
import { getLogger, type Logger } from '../logger.js';
import type { CarbonIntensityService, WeatherService } from '../connectors/index.js';
import { coordsForRegion } from '../connectors/fallbackProvider.js';
import { DEMO_FACILITIES } from '../db/seed.js';

export interface RefreshJobsDeps {
  config: IngestionConfig;
  carbon: CarbonIntensityService;
  weather: WeatherService;
  logger?: Logger;
  /** Regions to keep warm (defaults to all demo-facility regions + default region). */
  regions?: string[];
}

export interface RefreshResult {
  regions: number;
  carbonOk: number;
  carbonFailed: number;
  weatherOk: number;
  weatherFailed: number;
  durationMs: number;
}

/**
 * Regions to keep warm on every refresh cycle. Derived from the seeded demo
 * facilities (not a hardcoded list) so new facilities — e.g. Chennai IT Park on
 * IN-TN — are automatically refreshed.
 */
const WARM_REGIONS = [...new Set(DEMO_FACILITIES.map((f) => f.region))];

export class RefreshJobs {
  private tasks: ScheduledTask[] = [];
  private readonly logger: Logger;
  private running = false;

  constructor(private readonly deps: RefreshJobsDeps) {
    this.logger = deps.logger ?? getLogger();
  }

  private get regions(): string[] {
    return this.deps.regions ?? [...new Set([this.deps.config.defaultRegion, ...WARM_REGIONS])];
  }

  /** Start the cron schedules. */
  start(): void {
    if (!this.deps.config.enableScheduler) {
      this.logger.info('Scheduler disabled (ENABLE_SCHEDULER=false).');
      return;
    }
    this.tasks.push(
      cron.schedule(this.deps.config.ciRefreshCron, () => {
        void this.refreshCarbonIntensity();
      })
    );
    this.tasks.push(
      cron.schedule(this.deps.config.weatherRefreshCron, () => {
        void this.refreshWeather();
      })
    );
    this.logger.info('Refresh jobs scheduled.', {
      ciCron: this.deps.config.ciRefreshCron,
      weatherCron: this.deps.config.weatherRefreshCron,
      regions: this.regions,
    });
  }

  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
  }

  /** Warm both caches once (call on startup / before a demo). */
  async runOnce(): Promise<RefreshResult> {
    if (this.running) {
      this.logger.warn('Refresh already running; skipping.');
      return { regions: 0, carbonOk: 0, carbonFailed: 0, weatherOk: 0, weatherFailed: 0, durationMs: 0 };
    }
    this.running = true;
    const start = Date.now();
    const result: RefreshResult = {
      regions: this.regions.length,
      carbonOk: 0,
      carbonFailed: 0,
      weatherOk: 0,
      weatherFailed: 0,
      durationMs: 0,
    };

    try {
      for (const region of this.regions) {
        // Carbon intensity — latest + a 2-day window.
        try {
          await this.deps.carbon.getLatest(region);
          const now = new Date();
          const from = new Date(now.getTime() - 2 * 86_400_000);
          const to = new Date(now.getTime() + 86_400_000);
          await this.deps.carbon.getSeries(region, from, to, 15);
          result.carbonOk++;
        } catch (err) {
          result.carbonFailed++;
          this.logger.warn('Carbon refresh failed.', { region, error: String(err) });
        }

        // Weather.
        try {
          const coords = coordsForRegion(region);
          const now = new Date();
          const from = new Date(now.getTime() - 86_400_000);
          const to = new Date(now.getTime() + 2 * 86_400_000);
          await this.deps.weather.getSeries(coords.lat, coords.lon, from, to, 'UTC', 15);
          result.weatherOk++;
        } catch (err) {
          result.weatherFailed++;
          this.logger.warn('Weather refresh failed.', { region, error: String(err) });
        }
      }
    } finally {
      this.running = false;
      result.durationMs = Date.now() - start;
      this.logger.info('Refresh cycle complete.', { ...result });
    }

    return result;
  }

  async refreshCarbonIntensity(): Promise<RefreshResult> {
    return this.runOnce();
  }

  async refreshWeather(): Promise<RefreshResult> {
    return this.runOnce();
  }
}
