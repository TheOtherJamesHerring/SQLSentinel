import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const sqlGuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const schema = z.object({
  MONITOR_API_URL: z.string().url(),
  MONITOR_API_KEY: z.string().min(1),
  SERVER_ID: z.string().regex(sqlGuidRegex, "SERVER_ID must be a SQL uniqueidentifier/GUID"),
  SQL_SERVER_HOST: z.string().min(1),
  SQL_SERVER_PORT: z.coerce.number().default(1433),
  SQL_AUTH_TYPE: z.enum(["sql", "windows", "entra_sp"]).default("sql"),
  SQL_USERNAME: z.string().optional(),
  SQL_PASSWORD: z.string().optional(),
  SQL_ENTRA_TENANT_ID: z.string().optional(),
  SQL_ENTRA_CLIENT_ID: z.string().optional(),
  SQL_ENTRA_CLIENT_SECRET: z.string().optional(),
  SQL_DATABASE: z.string().default("master"),
  SQL_ENCRYPT: z.coerce.boolean().default(true),
  SQL_TRUST_SERVER_CERT: z.coerce.boolean().default(true),
  COLLECTION_INTERVAL_SECONDS: z.coerce.number().default(60),
  COLLECT_QUERY_STORE: z.coerce.boolean().default(true),
  COLLECT_BACKUP_FAILURES: z.coerce.boolean().default(true),
  COLLECT_AGENT_JOBS: z.coerce.boolean().default(true),
  ERROR_LOG_THROTTLE_MINUTES: z.coerce.number().int().min(1).default(30)
}).superRefine((value, ctx) => {
  if (value.SQL_AUTH_TYPE === "sql") {
    if (!value.SQL_USERNAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SQL_USERNAME"],
        message: "SQL_USERNAME is required when SQL_AUTH_TYPE=sql"
      });
    }
    if (!value.SQL_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SQL_PASSWORD"],
        message: "SQL_PASSWORD is required when SQL_AUTH_TYPE=sql"
      });
    }
  }

  if (value.SQL_AUTH_TYPE === "entra_sp") {
    if (!value.SQL_ENTRA_TENANT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SQL_ENTRA_TENANT_ID"],
        message: "SQL_ENTRA_TENANT_ID is required when SQL_AUTH_TYPE=entra_sp"
      });
    }
    if (!value.SQL_ENTRA_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SQL_ENTRA_CLIENT_ID"],
        message: "SQL_ENTRA_CLIENT_ID is required when SQL_AUTH_TYPE=entra_sp"
      });
    }
    if (!value.SQL_ENTRA_CLIENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SQL_ENTRA_CLIENT_SECRET"],
        message: "SQL_ENTRA_CLIENT_SECRET is required when SQL_AUTH_TYPE=entra_sp"
      });
    }
  }
});

export const config = schema.parse(process.env);
