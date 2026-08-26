# AIS Fleet Platform

A multi-tenant server platform for tracking and managing multiple vessel
fleets via AIS (Automatic Identification System). Customers sign up, create
fleets, add vessels by MMSI, and watch them move on a live map — fed by
both terrestrial AIS receivers and satellite/aggregator providers.

## How it's put together

```
packages/ais-decoder   AIVDM/AIVDO NMEA sentence decoder (pure logic, unit tested)
apps/ingest            Terrestrial + satellite/aggregator adapters -> Postgres
apps/api               Auth, fleet/vessel management REST API, live WebSocket feed
apps/web               React + MapLibre live-map dashboard
db/migrations          SQL schema (Postgres, Timescale-ready)
infra/                 Dockerfiles, docker-compose, Railway deployment notes
```

**Why it's shaped this way:** AIS is a broadcast protocol — vessel
identity and position data is shared infrastructure, not owned by any one
tenant. So `vessels` and `positions` are global tables, populated by
whatever the ingest service decodes or receives. `tenants` and `fleets`
are how a customer organizes the subset of vessels they care about. This
mirrors how real AIS aggregators (MarineTraffic, VesselFinder, etc.) work
under the hood.

**Data flow:** a terrestrial receiver or satellite/aggregator adapter
feeds `apps/ingest`, which decodes/normalizes messages, upserts
`vessels`/`positions`/`current_positions`, and does a Postgres `NOTIFY` on
every position update. `apps/api` LISTENs for those notifications and
forwards them over WebSocket to whichever connected dashboards have
subscribed to a fleet containing that vessel. The REST API additionally
serves fleet/vessel CRUD, auth, and position history.

## Quick start (local dev)

Requires Node 20+ and a Postgres 14+ instance (or Docker).

```bash
npm install
npm run build                 # builds packages/ais-decoder before the apps that depend on it

# point these at your own Postgres, or use docker-compose (see below)
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/ais
node db/migrate.js

# terminal 1: ingest (falls back to synthetic demo vessels with no
# real feed configured — see apps/ingest/.env.example)
MOCK_REPLAY=true npm run dev:ingest

# terminal 2: api
JWT_SECRET=dev-secret npm run dev:api

# terminal 3: web dashboard
npm run dev:web    # http://localhost:5173
```

Or bring up the whole backend with Docker:

```bash
docker compose up --build
```

This starts Postgres, runs migrations, and starts `ingest` (with demo
data), `api` (on :8080), and `web` (on :5173, served via nginx).

### Try it

1. Open the dashboard, register an organization.
2. Create a fleet, add vessel MMSI `900000001` (one of the built-in demo
   vessels emitted by `MOCK_REPLAY`).
3. Watch it move on the map in real time.

## Connecting real AIS data

See `apps/ingest/.env.example` for the full list of env vars. In short:

- **Terrestrial receiver / dispatcher speaking raw NMEA over TCP:** set
  `TCP_FEEDS=host:port` (dials out) or `TCP_LISTEN_PORT` (accepts inbound).
- **UDP feed:** set `UDP_LISTEN_PORT`.
- **Satellite/aggregator API** (Spire, MarineTraffic, exactEarth, AISHub,
  etc.) that returns decoded JSON: set `SATELLITE_HTTP_URL` /
  `SATELLITE_HTTP_TOKEN`, and customize `parseResponse` in
  `apps/ingest/src/adapters/httpPollingAdapter.ts` to match that
  provider's actual response schema (every provider's is different — the
  default parser is a reasonable generic guess, not a real integration).
- To add a provider with its own push mechanism (webhook, its own
  WebSocket, a message queue), implement the `SatelliteAdapter` interface
  in `apps/ingest/src/adapters/types.ts` and wire it up in
  `apps/ingest/src/index.ts` next to the existing adapters — the pipeline
  (`handleSatelliteUpdate`) doesn't care how the update arrived.

## Testing

```bash
npm run test -w packages/ais-decoder
```

The decoder tests build synthetic AIVDM sentences from known field values
(rather than relying on remembered "real" example sentences) and assert
the decoder recovers those exact values — covering Class A/B position
reports, static/voyage data, multi-fragment reassembly, and checksum
validation.

## Deploying

See `infra/RAILWAY.md` for a step-by-step Railway deployment (one service
each for Postgres, ingest, api, web).

## What's next (out of scope for v1)

- **History playback** — the schema already stores full position history
  in `positions`; `GET /vessels/:mmsi/history` is there, just no UI yet.
- **Geofencing/alerts** — would want PostGIS for spatial queries (zone
  enter/exit, going dark, speed anomalies).
- **Horizontal scaling of `api`** — the live WebSocket fan-out is
  in-process; multiple replicas need a shared pub/sub bus (Redis) in
  front of it (noted in `infra/RAILWAY.md`).
