-- Core schema for the AIS multi-tenant fleet platform.
--
-- Design notes:
--   * AIS is a broadcast protocol: vessel identity/position data is shared
--     infrastructure, not owned per-tenant. `vessels` and `positions` are
--     global. `tenants` and `fleets` are how a customer organizes the
--     subset of vessels they care about.
--   * `current_positions` mirrors the latest row per vessel so the live map
--     can fetch "where is everyone right now" in one indexed lookup
--     instead of scanning history.
--   * `positions` is a plain table by default (works on any Postgres,
--     including Railway's managed Postgres plugin). If you outgrow it,
--     convert it to a TimescaleDB hypertable:
--       CREATE EXTENSION IF NOT EXISTS timescaledb;
--       SELECT create_hypertable('positions', 'ts', migrate_data => true);
--     No application code changes required.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);

CREATE TABLE fleets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#2563eb', -- map marker color for this fleet
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_fleets_tenant ON fleets(tenant_id);

-- Global vessel registry, keyed by MMSI. Populated/upserted by the ingest
-- pipeline whenever a static/voyage message (types 5, 19, 24) is decoded.
-- A row may also be created as a stub (mmsi only) when a user adds a
-- vessel to a fleet before any static data has been seen for it yet.
CREATE TABLE vessels (
  mmsi bigint PRIMARY KEY,
  imo bigint,
  ship_name text,
  call_sign text,
  ship_type smallint,
  ship_type_text text,
  dim_to_bow smallint,
  dim_to_stern smallint,
  dim_to_port smallint,
  dim_to_starboard smallint,
  destination text,
  draught numeric(5, 1),
  eta_month smallint,
  eta_day smallint,
  eta_hour smallint,
  eta_minute smallint,
  last_static_update timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fleet_vessels (
  fleet_id uuid NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  mmsi bigint NOT NULL REFERENCES vessels(mmsi) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  label text, -- optional tenant-specific nickname for the vessel
  PRIMARY KEY (fleet_id, mmsi)
);

CREATE INDEX idx_fleet_vessels_mmsi ON fleet_vessels(mmsi);

-- Full position history. One row per decoded position report.
CREATE TABLE positions (
  mmsi bigint NOT NULL,
  ts timestamptz NOT NULL,
  lon double precision,
  lat double precision,
  sog real, -- speed over ground, knots
  cog real, -- course over ground, degrees
  true_heading smallint,
  nav_status smallint,
  position_accuracy boolean,
  source text NOT NULL, -- e.g. "terrestrial:receiver-1", "satellite:spire"
  PRIMARY KEY (mmsi, ts)
);

CREATE INDEX idx_positions_mmsi_ts ON positions(mmsi, ts DESC);

-- Latest known position per vessel, upserted on every ingested position.
-- This is what the live map and fleet list actually query.
CREATE TABLE current_positions (
  mmsi bigint PRIMARY KEY REFERENCES vessels(mmsi) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  lon double precision,
  lat double precision,
  sog real,
  cog real,
  true_heading smallint,
  nav_status smallint,
  source text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
