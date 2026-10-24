-- Adds "websocket" as a third receiver kind, for push-based live-data APIs
-- like aisstream.io (as opposed to tcp_client's raw NMEA dial-out, or
-- http_polling's periodic REST polling).

ALTER TABLE receivers DROP CONSTRAINT receivers_kind_check;
ALTER TABLE receivers ADD CONSTRAINT receivers_kind_check
  CHECK (kind IN ('tcp_client', 'http_polling', 'websocket'));
