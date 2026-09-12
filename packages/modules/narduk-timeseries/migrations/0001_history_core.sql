-- 0001_history_core.sql -- the history store's core schema.
--
-- Source of truth: mybo-at-v2 docs/04-data-model.md § History (TimescaleDB +
-- PostGIS), which this file follows column for column. The deliberate
-- additions are marked below; there are no silent ones.
--
-- TARGET: TimescaleDB 2.30.0 on PostgreSQL 17 (narduk-infrastructure#155).
-- This file uses the current APIs, not the deprecated ones: `by_range()` for
-- the time dimension (the positional `create_hypertable` form is deprecated
-- since 2.13) and the columnstore API (`timescaledb.enable_columnstore`,
-- `timescaledb.segmentby`, `add_columnstore_policy`) which superseded
-- `timescaledb.compress` / `add_compression_policy` in 2.18.
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
--
-- The UNIQUE constraint is the point of this table's shape. The upload path is
-- an at-least-once queue consumer, so the same batch can legitimately arrive
-- twice; without a natural key the second delivery doubles every point it
-- carries and no read can tell. (vessel_id, series_id, ts, installation_role)
-- is that key -- one reading per series per instant per installation role --
-- and it lets the writer say `ON CONFLICT DO NOTHING` and mean it. A
-- hypertable's unique index must include the partitioning column, which `ts`
-- is.
CREATE TABLE IF NOT EXISTS telemetry_numeric (
  ts                TIMESTAMPTZ NOT NULL,
  vessel_id         UUID NOT NULL,
  series_id         BIGINT NOT NULL,
  installation_role SMALLINT NOT NULL DEFAULT 0,
  value             DOUBLE PRECISION NOT NULL,
  quality           SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (vessel_id, series_id, ts, installation_role)
);

COMMENT ON COLUMN telemetry_numeric.installation_role IS '0 primary, 1 shadow';

SELECT create_hypertable(
  'telemetry_numeric',
  by_range('ts', INTERVAL '1 day'),
  if_not_exists => TRUE
);

-- Columnstore (2.18+ API). `segmentby` matches the read pattern -- one vessel,
-- a series set -- so a compressed chunk is read one segment at a time instead
-- of decompressed whole.
--
-- `installation_role` is in `segmentby` because it is in the UNIQUE key above.
-- TimescaleDB refuses to enable the columnstore on a table whose unique
-- constraint covers a column that is neither a segmentby nor an orderby column
-- -- it cannot enforce uniqueness inside a compressed chunk otherwise -- so
-- with the natural key added and `segmentby = 'vessel_id, series_id'` this
-- ALTER TABLE fails and takes the whole migration down with it. Its cardinality
-- is 2 (0 primary, 1 shadow), so it costs at most a doubling of the segment
-- count and no read path loses a segment it was using.
ALTER TABLE telemetry_numeric SET (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'vessel_id, series_id, installation_role',
  timescaledb.orderby   = 'ts DESC'
);

SELECT add_columnstore_policy('telemetry_numeric', after => INTERVAL '3 days', if_not_exists => TRUE);

-- ADDITION (not in docs/04): the read index is the UNIQUE constraint above.
-- Every read this library issues filters on vessel_id and a series set and
-- orders by time; the hypertable's own index is on ts alone, so without a
-- (vessel_id, series_id, ts) index a one-vessel rollup query scans every
-- vessel's rows in each chunk it touches. The unique index has exactly that
-- prefix and PostgreSQL scans it backwards for `ORDER BY ts DESC`, so a
-- separate index would only double the write amplification.

-- Position track (PostGIS).
--
-- (vessel_id, ts) is this table's natural key: one recorded position per
-- vessel per instant. The table carries no installation_role column -- docs/04
-- does not shadow the track -- so two rows at the same instant for the same
-- vessel are a duplicate delivery, not two distinct facts.
CREATE TABLE IF NOT EXISTS track_points (
  ts        TIMESTAMPTZ NOT NULL,
  vessel_id UUID NOT NULL,
  geom      GEOGRAPHY(POINT, 4326) NOT NULL,
  sog       REAL,
  cog       REAL,
  heading   REAL,
  depth     REAL,
  UNIQUE (vessel_id, ts)
);

SELECT create_hypertable(
  'track_points',
  by_range('ts', INTERVAL '7 days'),
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS track_points_geom_idx ON track_points USING GIST (geom);

-- ADDITION (not in docs/04), same reasoning as above: the track read is always
-- "one vessel, one time range", which the UNIQUE (vessel_id, ts) index serves.
