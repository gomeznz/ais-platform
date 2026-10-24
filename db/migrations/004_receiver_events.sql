-- Per-receiver diagnostic event log, so "is this receiver actually seeing
-- traffic" is answerable from the Admin UI instead of needing someone to
-- pull the ingest service's logs by hand.
--
-- Written by the ingest service (same sampling it already used for console
-- logging: every message for the first 20, then every 50th, so a busy
-- receiver can't turn this into unbounded write volume) and read by the
-- API for the admin UI. Capped per-receiver (pruned on write — see
-- apps/ingest/src/db.ts) rather than time-based, since a quiet receiver
-- should keep its most recent events rather than losing them to a TTL.
CREATE TABLE receiver_events (
  id BIGSERIAL PRIMARY KEY,
  receiver_id UUID NOT NULL REFERENCES receivers(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL CHECK (kind IN ('connect', 'message', 'error', 'close')),
  status TEXT NOT NULL CHECK (status IN ('ok', 'dropped', 'error', 'info')),
  message_type TEXT,
  mmsi BIGINT,
  detail TEXT
);

CREATE INDEX receiver_events_receiver_id_ts_idx ON receiver_events (receiver_id, ts DESC);
