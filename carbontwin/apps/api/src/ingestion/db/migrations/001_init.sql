-- ============================================================================
-- Migration 001 — initial ingestion schema
-- Apply with: psql "$DATABASE_URL" -f 001_init.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS facilities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT        NOT NULL,
    type              TEXT        NOT NULL,
    region            TEXT        NOT NULL,
    timezone          TEXT        NOT NULL DEFAULT 'UTC',
    lat               DOUBLE PRECISION NOT NULL,
    lon               DOUBLE PRECISION NOT NULL,
    address           TEXT,
    floor_area_m2     DOUBLE PRECISION,
    operating_hours   JSONB,
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_demo           BOOLEAN     NOT NULL DEFAULT FALSE,
    data_source       TEXT        NOT NULL DEFAULT 'uploaded',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeseries (
    facility_id       UUID        NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
    timestamp         TIMESTAMPTZ NOT NULL,
    power_kw          DOUBLE PRECISION NOT NULL,
    emissions_kg      DOUBLE PRECISION,
    carbon_intensity  DOUBLE PRECISION,
    quality           TEXT        NOT NULL DEFAULT 'measured',
    flags             TEXT[]      NOT NULL DEFAULT '{}',
    PRIMARY KEY (facility_id, timestamp)
);

SELECT create_hypertable('timeseries', 'timestamp', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS quality_reports (
    facility_id   UUID PRIMARY KEY REFERENCES facilities (id) ON DELETE CASCADE,
    report        JSONB       NOT NULL,
    quality_score INTEGER     NOT NULL DEFAULT 0,
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auxiliary_series (
    facility_id   UUID        NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL,
    payload       JSONB       NOT NULL,
    PRIMARY KEY (facility_id, kind, timestamp)
);

SELECT create_hypertable('auxiliary_series', 'timestamp', if_not_exists => TRUE);
