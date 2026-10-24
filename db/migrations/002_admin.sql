-- Admin section: platform-wide admin (ASI, the operator) + per-tenant admin
-- (owner/admin role, already existed), user lifecycle management, and
-- DB-backed AIS receiver configuration so receivers can be added/edited
-- without redeploying the ingest service.

ALTER TABLE users
  ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- The first account ever created on this platform is ASI's own — make it
-- the initial platform admin so there's always at least one. Further
-- platform admins are granted from the admin UI.
UPDATE users SET is_platform_admin = true WHERE email = 'alex.gordon@asiltd.co.nz';

-- AIS receiver connections, manageable from the admin UI. Only the two
-- kinds that are safe to start/stop dynamically without touching exposed
-- network ports are supported here:
--   * tcp_client   - ingest dials OUT to the receiver's own host:port
--                    (a hardware receiver or dispatcher with a TCP server,
--                    reachable on a LAN or public IP).
--   * http_polling - ingest polls a satellite/aggregator JSON API on an
--                    interval (Spire, MarineTraffic, exactEarth, AISHub...).
-- Inbound push listeners (a receiver dialing in to us) still require a
-- fixed, deployment-level port and aren't yet per-tenant configurable —
-- those stay controlled by TCP_LISTEN_PORT/UDP_LISTEN_PORT as before.
CREATE TABLE receivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tcp_client', 'http_polling')),
  config jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'connecting', 'connected', 'error', 'disabled')),
  status_message text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_receivers_tenant ON receivers(tenant_id);
