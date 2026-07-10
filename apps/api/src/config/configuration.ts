/**
 * Typed application configuration.
 *
 * Values come from environment variables (validated by env.schema.ts).
 * This factory is registered with ConfigModule.forRoot({ load: [configuration] }).
 */
export const configuration = () => ({
  port: parseInt(process.env.PORT || "3001", 10),

  database: {
    url: process.env.DATABASE_URL || "",
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || "",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  cookies: {
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax",
  },

  cors: {
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  discovery: {
    workerEnabled: process.env.DISCOVERY_WORKER_ENABLED !== "false",
    workerConcurrency:
      parseInt(process.env.DISCOVERY_WORKER_CONCURRENCY || "2", 10) || 2,
  },

  app: {
    nodeEnv: process.env.NODE_ENV || "development",
  },
});
