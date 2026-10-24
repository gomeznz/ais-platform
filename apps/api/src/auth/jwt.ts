import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthTokenPayload {
  sub: string; // user id
  tenantId: string;
  role: "owner" | "admin" | "member";
  email: string;
  isPlatformAdmin: boolean;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
}
