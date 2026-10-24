import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { fleetRoutes } from "./routes/fleets.js";
import { vesselRoutes } from "./routes/vessels.js";
import { adminRoutes, platformAdminRoutes } from "./routes/admin.js";
import { receiverRoutes } from "./routes/receivers.js";
import { registerLiveFeed } from "./ws/liveFeed.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  // Fastify's default JSON parser rejects an empty body sent with
  // "Content-Type: application/json" (FST_ERR_CTP_EMPTY_JSON_BODY) — which
  // bodyless requests like DELETE legitimately send if a client sets that
  // header out of habit. Treat an empty body as {} instead of erroring, so
  // route handlers (which already treat a missing body as "no updates")
  // behave the same regardless of client header hygiene.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "" || body == null) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(fleetRoutes);
  await app.register(vesselRoutes);
  await app.register(adminRoutes);
  await app.register(platformAdminRoutes);
  await app.register(receiverRoutes);
  registerLiveFeed(app);

  return app;
}
