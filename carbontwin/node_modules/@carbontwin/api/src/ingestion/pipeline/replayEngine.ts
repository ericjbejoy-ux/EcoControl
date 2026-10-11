/**
 * Replay engine (FR-6).
 * Streams a facility's historical 15-minute data as if it were live
 * (1 day ≈ 60 s by default), emitting `tick` events that the WebSocket hub
 * forwards to the UI as `{ts, powerKw, ci, emissionsKg, tempIn, tempOut}`.
 */

import { EventEmitter } from 'node:events';
import type { TickEvent } from '@carbontwin/shared';
import { DEFAULT_REPLAY_SPEED_MULTIPLIER } from '@carbontwin/shared';
import type { IngestionConfig } from '../config.js';
import { getLogger, type Logger } from '../logger.js';
import type { Store } from '../store/index.js';
import { coordsForRegion, syntheticCarbonIntensitySeries, syntheticWeatherSeries } from '../connectors/fallbackProvider.js';
import type { CarbonIntensityService, WeatherService } from '../connectors/index.js';
import type { TimeseriesRecord } from '../types.js';

export interface ReplayOptions {
  facilityId: string;
  from?: string;
  to?: string;
  /** Simulated minutes advanced per real minute (1440 → 1 day ≈ 60 s). */
  speedMultiplier?: number;
  includeCarbonIntensity?: boolean;
  includeWeather?: boolean;
  /** Emit immediately on start (default true). */
  emitOnStart?: boolean;
}

export type ReplayState = 'idle' | 'prepared' | 'playing' | 'paused' | 'finished';

interface ReplayFrame {
  timestamp: string;
  powerKw: number;
  ci: number | null;
  emissionsKg: number;
  tempOut: number | null;
  humidityPct: number | null;
  irradianceWm2: number | null;
}

export interface ReplayStatus {
  state: ReplayState;
  facilityId: string | null;
  index: number;
  total: number;
  progressPct: number;
  speedMultiplier: number;
  from: string | null;
  to: string | null;
}

export class ReplayEngine extends EventEmitter {
  private frames: ReplayFrame[] = [];
  private index = 0;
  private timer: NodeJS.Timeout | null = null;
  private state: ReplayState = 'idle';
  private options: ReplayOptions | null = null;
  private readonly logger: Logger;

  constructor(
    private readonly deps: {
      store: Store;
      config: IngestionConfig;
      carbon?: CarbonIntensityService;
      weather?: WeatherService;
      logger?: Logger;
    }
  ) {
    super();
    this.logger = deps.logger ?? getLogger();
  }

  get status(): ReplayStatus {
    return {
      state: this.state,
      facilityId: this.options?.facilityId ?? null,
      index: this.index,
      total: this.frames.length,
      progressPct: this.frames.length ? Math.round((this.index / this.frames.length) * 100) : 0,
      speedMultiplier: this.currentSpeed(),
      from: this.frames[0]?.timestamp ?? null,
      to: this.frames[this.frames.length - 1]?.timestamp ?? null,
    };
  }

  private currentSpeed(): number {
    return this.options?.speedMultiplier ?? DEFAULT_REPLAY_SPEED_MULTIPLIER;
  }

  /** Load the series and enrich with CI + weather. Idempotent per call. */
  async prepare(options: ReplayOptions): Promise<ReplayStatus> {
    this.stop();
    this.options = { emitOnStart: true, includeCarbonIntensity: true, includeWeather: true, ...options };
    const { store, config } = this.deps;

    const facility = await store.facilities.get(options.facilityId);
    if (!facility) throw new Error(`Facility ${options.facilityId} not found.`);

    let records: TimeseriesRecord[] = await store.timeseries.query(options.facilityId, {
      from: options.from,
      to: options.to,
      limit: 200_000,
    });
    if (records.length === 0) {
      const stats = await store.timeseries.stats(options.facilityId);
      if (stats.start && stats.end) {
        records = await store.timeseries.query(options.facilityId, { limit: 200_000 });
      }
    }
    if (records.length === 0) {
      this.frames = [];
      this.state = 'prepared';
      this.emit('status', { state: 'error', message: `No time-series data for facility ${options.facilityId}.` });
      return this.status;
    }

    const from = new Date(records[0]!.timestamp);
    const to = new Date(records[records.length - 1]!.timestamp);

    // Carbon intensity series (live → cached → synthetic).
    let ciByMs = new Map<number, number>();
    if (this.options.includeCarbonIntensity) {
      try {
        const ciSeries = await this.resolveCarbon(facility.region, from, to);
        ciByMs = new Map(ciSeries.map((c) => [Date.parse(c.timestamp), c.carbonIntensity]));
      } catch (err) {
        this.logger.debug('Replay CI unavailable; using record values.', { error: String(err) });
      }
    }

    // Weather series (live → cached → synthetic).
    let weatherByMs = new Map<number, { temperatureC: number; humidityPct: number; irradianceWm2: number }>();
    if (this.options.includeWeather) {
      try {
        const weatherSeries = await this.resolveWeather(facility.lat, facility.lon, facility.timezone, from, to);
        weatherByMs = new Map(
          weatherSeries.map((w) => [
            Date.parse(w.timestamp),
            { temperatureC: w.temperatureC, humidityPct: w.humidityPct, irradianceWm2: w.irradianceWm2 },
          ])
        );
      } catch (err) {
        this.logger.debug('Replay weather unavailable.', { error: String(err) });
      }
    }

    this.frames = records.map((record) => {
      const ms = Date.parse(record.timestamp);
      const ci = record.carbonIntensity ?? ciByMs.get(ms) ?? null;
      const weather = weatherByMs.get(ms);
      const emissions =
        record.emissionsKg ?? (ci === null ? 0 : (record.powerKw * 0.25 * ci) / 1000);
      return {
        timestamp: record.timestamp,
        powerKw: record.powerKw,
        ci,
        emissionsKg: Math.round(emissions * 1000) / 1000,
        tempOut: weather?.temperatureC ?? null,
        humidityPct: weather?.humidityPct ?? null,
        irradianceWm2: weather?.irradianceWm2 ?? null,
      };
    });

    this.index = 0;
    this.state = 'prepared';
    this.emit('status', { state: 'prepared', message: `Prepared ${this.frames.length} frames.` });
    return this.status;
  }

  private async resolveCarbon(region: string, from: Date, to: Date) {
    if (this.deps.carbon) {
      const result = await this.deps.carbon.getSeries(region, from, to, 15);
      return result.data;
    }
    return syntheticCarbonIntensitySeries(region, from, to, 15);
  }

  private async resolveWeather(lat: number, lon: number, timezone: string, from: Date, to: Date) {
    if (this.deps.weather) {
      const result = await this.deps.weather.getSeries(lat, lon, from, to, timezone, 15);
      return result.data;
    }
    return syntheticWeatherSeries(lat, lon, from, to, 15);
  }

  /** Begin (or resume) emitting ticks. */
  play(): ReplayStatus {
    if (this.state === 'idle') {
      this.emit('status', { state: 'error', message: 'Call prepare() before play().' });
      return this.status;
    }
    if (this.frames.length === 0) {
      this.state = 'finished';
      return this.status;
    }
    this.state = 'playing';
    this.emit('status', { state: 'replay_started', message: 'Replay started.' });
    this.scheduleNext();
    if (this.options?.emitOnStart) this.emitCurrent();
    return this.status;
  }

  pause(): ReplayStatus {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.state === 'playing') {
      this.state = 'paused';
      this.emit('status', { state: 'replay_paused', message: 'Replay paused.' });
    }
    return this.status;
  }

  resume(): ReplayStatus {
    if (this.state === 'paused') return this.play();
    return this.status;
  }

  stop(): ReplayStatus {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.state = this.frames.length ? 'prepared' : 'idle';
    return this.status;
  }

  /** Jump to a progress percentage (0–100). */
  seek(progressPct: number): ReplayStatus {
    const clamped = Math.max(0, Math.min(100, progressPct));
    this.index = Math.round((clamped / 100) * this.frames.length);
    return this.status;
  }

  /** Emit a single tick at the current index and advance. */
  step(): TickEvent | null {
    if (this.index >= this.frames.length) {
      this.finish();
      return null;
    }
    const event = this.buildTick(this.index);
    this.index++;
    return event;
  }

  private emitCurrent(): void {
    if (this.index >= this.frames.length) {
      this.finish();
      return;
    }
    const event = this.buildTick(this.index);
    this.emit('tick', event);
    this.index++;
  }

  private scheduleNext(): void {
    const delayMs = this.tickDelayMs();
    this.timer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this.emitCurrent();
      if (this.index < this.frames.length) this.scheduleNext();
      else this.finish();
    }, delayMs);
  }

  /** Real time between ticks so the whole series maps to `1/speed` of real time. */
  private tickDelayMs(): number {
    const speed = Math.max(1, this.currentSpeed());
    const simulatedMinutesPerTick = 15; // one 15-min data point per tick
    const realMs = (simulatedMinutesPerTick / speed) * 60_000;
    return Math.max(50, Math.round(realMs));
  }

  private buildTick(index: number): TickEvent {
    const frame = this.frames[index] as ReplayFrame;
    const total = this.frames.length || 1;
    return {
      type: 'tick',
      facilityId: this.options?.facilityId ?? '',
      ts: frame.timestamp,
      powerKw: frame.powerKw,
      ci: frame.ci ?? 0,
      emissionsKg: frame.emissionsKg,
      tempOut: frame.tempOut ?? undefined,
      humidityPct: frame.humidityPct ?? undefined,
      irradianceWm2: frame.irradianceWm2 ?? undefined,
      dataSource: 'synthetic',
      isReplay: true,
      progressPct: Math.round((index / total) * 100),
    };
  }

  private finish(): void {
    this.state = 'finished';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emit('status', { state: 'replay_finished', message: 'Replay finished.' });
  }

  /** Collect all remaining ticks synchronously (useful for tests / snapshots). */
  drain(): TickEvent[] {
    const events: TickEvent[] = [];
    while (this.index < this.frames.length) {
      const event = this.step();
      if (event) events.push(event);
    }
    return events;
  }
}
