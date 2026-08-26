import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { fleetRoutes } from "./routes/fleets.js";
import { vesselRoutes } from "./routes/vessels.js";
import { registerLiveFeed } from "./ws/liveFeed.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(fleetRoutes);
  await app.register(vesselRoutes);
  registerLiveFeed(app);

  return app;
}
