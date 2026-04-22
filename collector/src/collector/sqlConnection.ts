import sql from "mssql";
import { config } from "./config.js";

let pool: sql.ConnectionPool | null = null;
const databasePools = new Map<string, sql.ConnectionPool>();

function buildBaseConfig(database?: string): sql.config {
  const base: sql.config = {
    server: config.SQL_SERVER_HOST,
    port: config.SQL_SERVER_PORT,
    database: database ?? config.SQL_DATABASE,
    options: {
      encrypt: config.SQL_ENCRYPT,
      trustServerCertificate: config.SQL_TRUST_SERVER_CERT
    }
  };

  if (config.SQL_AUTH_TYPE === "entra_sp") {
    return {
      ...base,
      authentication: {
        type: "azure-active-directory-service-principal-secret",
        options: {
          tenantId: config.SQL_ENTRA_TENANT_ID!,
          clientId: config.SQL_ENTRA_CLIENT_ID!,
          clientSecret: config.SQL_ENTRA_CLIENT_SECRET!
        }
      }
    };
  }

  return {
    ...base,
    user: config.SQL_USERNAME,
    password: config.SQL_PASSWORD
  };
}

export async function getPool() {
  if (!pool) {
    pool = new sql.ConnectionPool(buildBaseConfig());
    await pool.connect();
  }
  return pool;
}

async function getPoolForDatabase(database: string) {
  let dbPool = databasePools.get(database) ?? null;
  if (!dbPool) {
    dbPool = new sql.ConnectionPool({
      ...buildBaseConfig(database),
      pool: { min: 0, max: 2 }
    });
    databasePools.set(database, dbPool);
    await dbPool.connect();
  }
  return dbPool;
}

export async function runQuery<T = unknown>(statement: string) {
  const activePool = await getPool();
  const result = await activePool.request().query<T>(statement);
  return result.recordset;
}

/** Opens a one-shot connection to a specific database, runs the query, then closes. */
export async function runQueryOnDatabase<T = unknown>(dbName: string, statement: string): Promise<T[]> {
  const tempPool = await getPoolForDatabase(dbName);
  try {
    const result = await tempPool.request().query<T>(statement);
    return result.recordset;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`runQueryOnDatabase failed for '${dbName}': ${message}`);
  }
}

export async function closeAllPools() {
  const closers: Array<Promise<unknown>> = [];
  if (pool) {
    closers.push(pool.close().catch(() => {}));
    pool = null;
  }
  for (const dbPool of databasePools.values()) {
    closers.push(dbPool.close().catch(() => {}));
  }
  databasePools.clear();
  await Promise.all(closers);
}
