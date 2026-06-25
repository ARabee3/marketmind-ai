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
    secret: process.env.JWT_SECRET || "",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  app: {
    nodeEnv: process.env.NODE_ENV || "development",
  },
});
