import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken, type AuthTokenPayload } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthTokenPayload;
  }
}

/** preHandler: require a valid Bearer JWT, attach its payload to request.user. */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing or malformed Authorization header" });
  }
  try {
    request.user = verifyToken(header.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

/** Same as `authenticate`, but also usable to authenticate a WebSocket upgrade via ?token=. */
export function verifyTokenString(token: string): AuthTokenPayload {
  return verifyToken(token);
}
