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
