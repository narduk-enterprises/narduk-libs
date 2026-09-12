-- 0001_history_core.sql -- the history store's core schema.
--
-- Source of truth: mybo-at-v2 docs/04-data-model.md § History (TimescaleDB +
-- PostGIS), which this file follows column for column. Two deliberate additions
-- are marked below; there are no silent ones.
--
-- APPLIED MIGRATIONS ARE IMMUTABLE. Once a database has run this file, editing
-- it forks the schema: every environment that already applied it keeps the old
-- bytes, the next fresh environment gets the new ones, and nothing reports the
-- difference. The runner's checksum column turns that into a failed deploy.
-- Change the schema by adding 000N+1, never by editing this file.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Dimension. Raw SignalK path strings are stored once per (vessel, path), not
-- once per point: the inherited storage contract is low-cardinality tags only.
CREATE TABLE IF NOT EXISTS series (
  series_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vessel_id  UUID NOT NULL,
  path       TEXT NOT NULL,
  unit       TEXT,
  value_kind TEXT NOT NULL,
  UNIQUE (vessel_id, path)
);

COMMENT ON COLUMN series.value_kind IS 'numeric | position | attitude | text | bool | json';

-- Numeric telemetry: the bulk of the store.
CREATE TABLE IF NOT EXISTS telemetry_numeric (
  ts                TIMESTAMPTZ NOT NULL,
  vessel_id         UUID NOT NULL,
  series_id         BIGINT NOT NULL,
  installation_role SMALLINT NOT NULL DEFAULT 0,
  value             DOUBLE PRECISION NOT NULL,
  quality           SMALLINT NOT NULL DEFAULT 0
);

COMMENT ON COLUMN telemetry_numeric.installation_role IS '0 primary, 1 shadow';

SELECT create_hypertable(
  'telemetry_numeric',
  'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

ALTER TABLE telemetry_numeric SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vessel_id, series_id',
  timescaledb.compress_orderby   = 'ts DESC'
);

SELECT add_compression_policy('telemetry_numeric', INTERVAL '3 days', if_not_exists => TRUE);

-- ADDITION (not in docs/04): an index on (vessel_id, series_id, ts DESC).
-- Every read this library issues filters on vessel_id and a series set and
-- orders by time; the hypertable's own index is on ts alone, so without this
-- a one-vessel rollup query scans every vessel's rows in each chunk it
-- touches. The compression segmentby above covers the same columns for
-- compressed chunks only.
CREATE INDEX IF NOT EXISTS telemetry_numeric_vessel_series_ts_idx
  ON telemetry_numeric (vessel_id, series_id, ts DESC);

-- Position track (PostGIS).
CREATE TABLE IF NOT EXISTS track_points (
  ts        TIMESTAMPTZ NOT NULL,
  vessel_id UUID NOT NULL,
  geom      GEOGRAPHY(POINT, 4326) NOT NULL,
  sog       REAL,
  cog       REAL,
  heading   REAL,
  depth     REAL
);

SELECT create_hypertable(
  'track_points',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS track_points_geom_idx ON track_points USING GIST (geom);

-- ADDITION (not in docs/04), same reasoning as above: the track read is always
-- "one vessel, one time range".
CREATE INDEX IF NOT EXISTS track_points_vessel_ts_idx ON track_points (vessel_id, ts DESC);
