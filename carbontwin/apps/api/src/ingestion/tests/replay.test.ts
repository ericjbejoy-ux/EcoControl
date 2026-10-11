/**
 * Tests for the replay engine (FR-6).
 * Verifies frame preparation, schema-valid ticks, progress/seek and lifecycle.
 */

import { describe, it, expect } from 'vitest';
import { TickEventSchema, type TickEvent } from '@carbontwin/shared';
import { ReplayEngine } from '../pipeline/replayEngine.js';
import type { TimeseriesRecord } from '../types.js';
import { isoSeries, memoryStore, silentLogger, testConfig } from './helpers.js';

const FRAME_COUNT = 96;

async function seedFacility() {
  const store = await memoryStore();
  const facility = await store.facilities.create({
    name: 'Replay Test Facility',
    type: 'office',
    region: 'IN-MH',
    timezone: 'Asia/Kolkata',
    lat: 19.076,
    lon: 72.8777,
  });

  const timestamps = isoSeries('2024-01-01T00:00:00Z', FRAME_COUNT);
  const records: TimeseriesRecord[] = timestamps.map((timestamp, i) => {
    const powerKw = 100 + (i % 48);
    return {
      facilityId: facility.id,
      timestamp,
      powerKw,
      emissionsKg: Math.round(powerKw * 0.25 * 500) / 1000,
      carbonIntensity: 500,
      quality: 'measured',
      flags: [],
    };
  });
  await store.timeseries.replaceAll(facility.id, records);
  return { store, facility };
}

function engineFor(store: Awaited<ReturnType<typeof memoryStore>>): ReplayEngine {
  return new ReplayEngine({ store, config: testConfig(), logger: silentLogger });
}

describe('ReplayEngine', () => {
  it('prepares one frame per stored interval', async () => {
    const { store, facility } = await seedFacility();
    const engine = engineFor(store);
    const status = await engine.prepare({ facilityId: facility.id });

    expect(status.state).toBe('prepared');
    expect(status.total).toBe(FRAME_COUNT);
    expect(status.facilityId).toBe(facility.id);
    expect(status.from).toBe('2024-01-01T00:00:00.000Z');
    expect(status.progressPct).toBe(0);
    engine.stop();
  });

  it('emits schema-valid tick events via drain()', async () => {
    const { store, facility } = await seedFacility();
    const engine = engineFor(store);
    await engine.prepare({ facilityId: facility.id });

    const ticks: TickEvent[] = engine.drain();
    expect(ticks).toHaveLength(FRAME_COUNT);

    const first = ticks[0]!;
    expect(first.type).toBe('tick');
    expect(first.facilityId).toBe(facility.id);
    expect(first.isReplay).toBe(true);
    expect(first.powerKw).toBe(100);
    expect(first.ci).toBe(500);
    expect(first.emissionsKg).toBe(12.5);
    expect(TickEventSchema.safeParse(first).success).toBe(true);
    expect(TickEventSchema.safeParse(ticks[FRAME_COUNT - 1]).success).toBe(true);
    engine.stop();
  });

  it('advances progress and supports seeking', async () => {
    const { store, facility } = await seedFacility();
    const engine = engineFor(store);
    await engine.prepare({ facilityId: facility.id });

    expect(engine.step()).not.toBeNull();
    expect(engine.status.index).toBe(1);

    const seeked = engine.seek(50);
    expect(seeked.index).toBe(FRAME_COUNT / 2);
    expect(seeked.progressPct).toBe(50);

    const bounded = engine.seek(999);
    expect(bounded.index).toBe(FRAME_COUNT);
    expect(bounded.progressPct).toBe(100);
    engine.stop();
  });

  it('emits at least one tick when played and is stoppable', async () => {
    const { store, facility } = await seedFacility();
    const engine = engineFor(store);
    await engine.prepare({ facilityId: facility.id });

    const ticks: TickEvent[] = [];
    engine.on('tick', (tick: TickEvent) => ticks.push(tick));

    engine.play();
    engine.pause();
    engine.stop();

    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(engine.status.state).toBe('prepared');
  });

  it('rejects an unknown facility', async () => {
    const { store } = await seedFacility();
    const engine = engineFor(store);
    await expect(
      engine.prepare({ facilityId: '00000000-0000-4000-8000-000000000000' })
    ).rejects.toThrow(/not found/i);
    engine.stop();
  });

  it('prepares an empty replay when a facility has no data', async () => {
    const store = await memoryStore();
    const facility = await store.facilities.create({
      name: 'Empty',
      type: 'office',
      region: 'IN-MH',
      timezone: 'Asia/Kolkata',
      lat: 19.076,
      lon: 72.8777,
    });
    const engine = engineFor(store);
    const status = await engine.prepare({ facilityId: facility.id });
    expect(status.total).toBe(0);
    expect(engine.drain()).toHaveLength(0);
    engine.stop();
  });
});
