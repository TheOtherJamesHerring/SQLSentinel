import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(16).default("replace-this-dev-secret"),
  CONNECTION_SECRET_KEY: z.string().min(16).default("replace-this-connection-secret"),
  DATABASE_URL: z.string().min(1),
  MONITOR_API_KEY: z.string().default("local-monitor-key"),
  RETENTION_DAYS_MONITORING: z.coerce.number().int().min(7).default(90),
  ALERT_DEDUP_MINUTES: z.coerce.number().int().min(1).default(10),
  ALERT_BATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(200),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default("sqlsentinnel@localhost")
});

export const env = envSchema.parse(process.env);
