import "dotenv/config";

export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 8080,
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ais",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};

if (process.env.NODE_ENV === "production" && config.jwtSecret === "dev-secret-change-me") {
  throw new Error("JWT_SECRET must be set to a real secret in production");
}
