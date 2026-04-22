import sql from "mssql";
import { env } from "../config/env.js";

let pool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

function isPoolUsable(current: sql.ConnectionPool | null): current is sql.ConnectionPool {
  return Boolean(current && current.connected && !current.connecting);
}

async function createPool(): Promise<sql.ConnectionPool> {
  const nextPool = new sql.ConnectionPool(env.DATABASE_URL);
  nextPool.on("error", () => {
    pool = null;
  });
  await nextPool.connect();
  pool = nextPool;
  return nextPool;
}

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("connection is closed") ||
    message.includes("failed to connect") ||
    message.includes("econn") ||
    message.includes("socket")
  );
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (isPoolUsable(pool)) {
    return pool;
  }

  if (!connecting) {
    connecting = createPool().finally(() => {
      connecting = null;
    });
  }

  return connecting;
}

export async function query<T = unknown>(statement: string, params?: Record<string, unknown>) {
  const run = async () => {
    const activePool = await getPool();
    const request = activePool.request();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value as never);
      }
    }
    const result = await request.query<T>(statement);
    return result.recordset;
  };

  try {
    return await run();
  } catch (error) {
    if (!isRetryableConnectionError(error)) {
      throw error;
    }

    pool = null;
    return run();
  }
}
