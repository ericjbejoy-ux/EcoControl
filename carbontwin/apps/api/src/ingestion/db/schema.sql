-- ============================================================================
-- CarbonTwin — ingestion schema (PostgreSQL + TimescaleDB)
-- Owned by M2 (Data Ingestion & Data Engineering).
--
-- The dev/demo backend uses the JSON-file store in `db/client.ts`; this schema
-- is the production target and mirrors those tables 1:1 so the repository
-- interfaces in `store/*.repo.ts` stay identical between the two.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Facilities
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT        NOT NULL,
    type              TEXT        NOT NULL CHECK (type IN
                        ('office','hospital','campus','data_center','retail','industrial','custom')),
    region            TEXT        NOT NULL,
    timezone          TEXT        NOT NULL DEFAULT 'UTC',
    lat               DOUBLE PRECISION NOT NULL,
    lon               DOUBLE PRECISION NOT NULL,
    address           TEXT,
    floor_area_m2     DOUBLE PRECISION,
    operating_hours   JSONB,
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_demo           BOOLEAN     NOT NULL DEFAULT FALSE,
    data_source       TEXT        NOT NULL DEFAULT 'uploaded'
                        CHECK (data_source IN ('uploaded','demo','synthetic')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facilities_region ON facilities (region);
CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities (type);

-- ----------------------------------------------------------------------------
-- Time series (hypertable) — canonical 15-minute kWh/kW readings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timeseries (
    facility_id       UUID        NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
    timestamp         TIMESTAMPTZ NOT NULL,
    power_kw          DOUBLE PRECISION NOT NULL,
    emissions_kg      DOUBLE PRECISION,
    carbon_intensity  DOUBLE PRECISION,          -- gCO2/kWh
    quality           TEXT        NOT NULL DEFAULT 'measured'
                        CHECK (quality IN ('measured','imputed','interpolated','synthetic')),
    flags             TEXT[]      NOT NULL DEFAULT '{}',
    PRIMARY KEY (facility_id, timestamp)
);

SELECT create_hypertable('timeseries', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_timeseries_facility_ts ON timeseries (facility_id, timestamp DESC);

-- Continuous aggregate: hourly rollups (optional, for fast dashboards)
CREATE MATERIALIZED VIEW IF NOT EXISTS timeseries_hourly
WITH (timescaledb.continuous) AS
SELECT
    facility_id,
    time_bucket('1 hour', timestamp) AS bucket,
    avg(power_kw)          AS avg_power_kw,
    max(power_kw)          AS peak_power_kw,
    sum(emissions_kg)      AS emissions_kg,
    avg(carbon_intensity)  AS avg_carbon_intensity
FROM timeseries
GROUP BY facility_id, bucket
WITH NO DATA;

-- ----------------------------------------------------------------------------
-- Data-quality reports (one latest per facility)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quality_reports (
    facility_id   UUID PRIMARY KEY REFERENCES facilities (id) ON DELETE CASCADE,
    report        JSONB       NOT NULL,
    quality_score INTEGER     NOT NULL DEFAULT 0,
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Auxiliary series (weather, carbon intensity, tariffs) keyed by kind
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auxiliary_series (
    facility_id   UUID        NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL,   -- 'weather' | 'carbon' | 'tariff'
    timestamp     TIMESTAMPTZ NOT NULL,
    payload       JSONB       NOT NULL,
    PRIMARY KEY (facility_id, kind, timestamp)
);

SELECT create_hypertable('auxiliary_series', 'timestamp', if_not_exists => TRUE);
