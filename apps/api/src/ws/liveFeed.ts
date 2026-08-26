import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { pool } from "../db/client.js";
import { verifyTokenString } from "../auth/plugin.js";
import { positionListener, type PositionNotification } from "./pgListener.js";

interface ClientMessage {
  type: "subscribe" | "unsubscribe";
  fleetId: string;
}

interface ConnectionState {
  tenantId: string;
  mmsis: Set<number>;
}

/**
 * WebSocket endpoint for the live map: `GET /ws/live?token=<jwt>`.
 *
 * Protocol: client sends {type:"subscribe", fleetId} for each fleet it
 * wants live updates for; server verifies the fleet belongs to the
 * caller's tenant, resolves its current vessel membership, and starts
 * forwarding {type:"position", data} messages for those MMSIs as
 * position_update notifications arrive. Re-send "subscribe" after adding
 * a vessel to a fleet to pick it up (membership is snapshotted, not
 * live-tracked, in this v1).
 */
export function registerLiveFeed(app: FastifyInstance): void {
  app.get("/ws/live", { websocket: true }, (socket: WebSocket, request) => {
    const token = (request.query as Record<string, string>)?.token;
    let tenantId: string;
    try {
      if (!token) throw new Error("missing token");
      tenantId = verifyTokenString(token).tenantId;
    } catch {
      socket.close(4001, "unauthorized");
      return;
    }

    const state: ConnectionState = { tenantId, mmsis: new Set() };

    const unsubscribeFromBus = positionListener.subscribe((update: PositionNotification) => {
      if (!state.mmsis.has(update.mmsi)) return;
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "position", data: update }));
      }
    });

    socket.on("message", async (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (!msg.fleetId) return;

      const { rows: fleetRows } = await pool.query(
        "SELECT id FROM fleets WHERE id = $1 AND tenant_id = $2",
        [msg.fleetId, state.tenantId]
      );
      if (fleetRows.length === 0) return; // silently ignore fleets outside this tenant

      if (msg.type === "subscribe") {
        const { rows } = await pool.query(
          "SELECT mmsi FROM fleet_vessels WHERE fleet_id = $1",
          [msg.fleetId]
        );
        for (const row of rows) state.mmsis.add(Number(row.mmsi));
        socket.send(
          JSON.stringify({ type: "subscribed", fleetId: msg.fleetId, mmsis: rows.map((r) => Number(r.mmsi)) })
        );
      } else if (msg.type === "unsubscribe") {
        const { rows } = await pool.query(
          "SELECT mmsi FROM fleet_vessels WHERE fleet_id = $1",
          [msg.fleetId]
        );
        for (const row of rows) state.mmsis.delete(Number(row.mmsi));
      }
    });

    socket.on("close", () => {
      unsubscribeFromBus();
    });
  });
}
