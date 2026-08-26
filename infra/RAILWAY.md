# Deploying to Railway

This platform is four deployable pieces: a Postgres database, the `ingest`
worker, the `api` service, and the `web` dashboard. Each maps to one
Railway service in the same project.

## 1. Database

- Add a **Postgres** plugin from Railway's template gallery.
- Copy its connection string — Railway exposes it as `DATABASE_URL` and
  also lets other services reference it directly via a variable
  reference (`${{Postgres.DATABASE_URL}}`).
- Run migrations once, from your machine or a Railway one-off shell:
  ```
  DATABASE_URL=<railway postgres url> node db/migrate.js
  ```
  Re-run this after pulling any future migration file — it's idempotent
  (tracks applied versions in `schema_migrations`).

## 2. `ingest` service

- New service → **Deploy from repo**, root directory `/`, Dockerfile
  path `infra/Dockerfile.ingest`.
- Environment variables:
  - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
  - Configure at least one real source once you have receiver/provider
    access (see `apps/ingest/.env.example` for the full list):
    `TCP_FEEDS`, `TCP_LISTEN_PORT`, `UDP_LISTEN_PORT`, or
    `SATELLITE_HTTP_URL` / `SATELLITE_HTTP_TOKEN`.
  - Until then, leave everything else unset — it automatically falls
    back to `MOCK_REPLAY` synthetic vessels so the rest of the stack has
    something to show.
- If you're accepting inbound TCP/UDP from a hardware receiver
  (`TCP_LISTEN_PORT` / `UDP_LISTEN_PORT`), generate a public domain/TCP
  proxy for this service under its Settings → Networking tab, and point
  the receiver at that address.

## 3. `api` service

- New service → Dockerfile path `infra/Dockerfile.api`.
- Environment variables:
  - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
  - `JWT_SECRET` = a long random string (required — the process refuses
    to start with the default dev secret when `NODE_ENV=production`,
    which Railway sets automatically)
  - `CORS_ORIGIN` = the web service's public URL once you have it (or
    `*` while you're still wiring things up)
- Generate a public domain for this service (Settings → Networking →
  Generate Domain). Both HTTP and the `/ws/live` WebSocket endpoint are
  served on the same port, so one domain covers both.

## 4. `web` service

- New service → Dockerfile path `infra/Dockerfile.web`.
- Build-time variables (set these as **build args**, not runtime env —
  Vite bakes them into the static bundle at build time):
  - `VITE_API_URL` = the api service's public HTTPS URL
  - `VITE_WS_URL` = the same host with `wss://` (optional — defaults to
    `VITE_API_URL` with the scheme swapped, which is correct unless
    they're served from different domains)
- Generate a public domain for this service too; that's the URL you
  give your users.

## Notes on scaling past v1

- `positions` is a plain Postgres table. If history volume grows large,
  convert it to a TimescaleDB hypertable with zero application changes
  (see the comment at the top of `db/migrations/001_init.sql`).
- The live WebSocket fan-out in `apps/api/src/ws/pgListener.ts` is
  in-process. Running more than one `api` replica needs that replaced
  with a shared pub/sub bus (Redis is the natural choice) so a
  notification reaches whichever replica holds the relevant connection.
- Vessel geofencing/alerting would want PostGIS (`CREATE EXTENSION
  postgis`) for spatial queries — not needed for the v1 live-map/fleet
  scope this repo covers.
