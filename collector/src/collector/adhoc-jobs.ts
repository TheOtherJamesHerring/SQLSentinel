import sql from "mssql";
import { getPool } from "./sqlConnection.js";

export interface PendingJob {
  JobId: string;
  DatabaseName: string | null;
  JobType: "backup" | "dbcc_checkdb" | "sql_query";
  Params: string | null;
}

export interface JobResult {
  jobId: string;
  status: "completed" | "failed";
  durationMs: number;
  resultSummary: string;
}

// Only allow standard Windows drive paths or UNC paths for backup destinations
const SAFE_BACKUP_PATH_RE = /^([A-Za-z]:\\[\w\s\-\\]*|\\\\[\w\-.]+\\[\w\-. \\]*)$/;
const DISALLOWED_SQL_RE = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|CREATE|EXEC(?:UTE)?|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|KILL|SHUTDOWN|USE)\b/i;

// Escape SQL identifier brackets — prevents name injection in dynamic statements
function escapeSqlName(name: string): string {
  return name.replace(/]/g, "]]");
}

export async function executeAdHocJob(job: PendingJob): Promise<JobResult> {
  const start = Date.now();
  let params: Record<string, unknown> = {};
  try {
    params = job.Params ? (JSON.parse(job.Params) as Record<string, unknown>) : {};
  } catch {
    return { jobId: job.JobId, status: "failed", durationMs: 0, resultSummary: "Invalid Params JSON" };
  }

  try {
    switch (job.JobType) {
      case "backup":
        return await runBackup(job, params, start);
      case "dbcc_checkdb":
        return await runDbccCheckDb(job, params, start);
      case "sql_query":
        return await runReadOnlyQuery(job, params, start);
      default:
        throw new Error(`Unknown job type: ${String((job as PendingJob).JobType)}`);
    }
  } catch (err) {
    return {
      jobId: job.JobId,
      status: "failed",
      durationMs: Date.now() - start,
      resultSummary: err instanceof Error ? err.message : String(err)
    };
  }
}

async function runReadOnlyQuery(
  job: PendingJob,
  params: Record<string, unknown>,
  start: number
): Promise<JobResult> {
  if (!job.DatabaseName) throw new Error("DatabaseName is required for SQL query");

  const queryText = String(params.queryText ?? "").trim();
  if (!queryText) throw new Error("queryText param is required");
  if (queryText.length > 4000) throw new Error("queryText exceeds 4000 characters");

  const normalized = queryText.replace(/\s+/g, " ").trim();
  const startsReadOnly = /^SELECT\b/i.test(normalized) || /^WITH\b/i.test(normalized);
  if (!startsReadOnly) {
    throw new Error("Only read-only SELECT/CTE queries are allowed");
  }
  if (DISALLOWED_SQL_RE.test(normalized) || /\bGO\b/i.test(normalized)) {
    throw new Error("Query contains disallowed SQL keywords");
  }

  const safeDb = escapeSqlName(job.DatabaseName);
  const pool = await getPool();
  const result = await pool.request().query(
    `SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; USE [${safeDb}]; ${queryText}`
  );

  const recordset = Array.isArray(result.recordset) ? result.recordset : [];
  const rowCount = typeof result.rowsAffected?.[0] === "number" ? result.rowsAffected[0] : recordset.length;
  const preview = JSON.stringify(recordset.slice(0, 3));
  const summary = `Read-only query completed — rows: ${rowCount}; preview: ${preview}`;

  return {
    jobId: job.JobId,
    status: "completed",
    durationMs: Date.now() - start,
    resultSummary: summary.length > 3900 ? `${summary.slice(0, 3900)}...` : summary
  };
}

async function runBackup(
  job: PendingJob,
  params: Record<string, unknown>,
  start: number
): Promise<JobResult> {
  if (!job.DatabaseName) throw new Error("DatabaseName is required for backup");

  const backupPath = String(params.backupPath ?? "").trim();
  if (!backupPath) throw new Error("backupPath param is required (e.g. D:\\Backups)");
  if (!SAFE_BACKUP_PATH_RE.test(backupPath)) {
    throw new Error(`backupPath contains disallowed characters: ${backupPath}`);
  }

  const safeDb = escapeSqlName(job.DatabaseName);
  const ts = new Date().toISOString().replace(/[T:.-]/g, "").substring(0, 15);
  // Build the final path — strip trailing slash then append file name
  const dir = backupPath.replace(/[\\/]+$/, "");
  const fileName = `${dir}\\${job.DatabaseName}_adhoc_${ts}.bak`;

  const pool = await getPool();
  await pool.request().query(
    `BACKUP DATABASE [${safeDb}] TO DISK = N'${fileName.replace(/'/g, "''")}' WITH COMPRESSION, STATS = 10, NAME = N'Ad-hoc backup - ${safeDb}'`
  );

  return {
    jobId: job.JobId,
    status: "completed",
    durationMs: Date.now() - start,
    resultSummary: `Backup completed → ${fileName}`
  };
}

async function runDbccCheckDb(
  job: PendingJob,
  params: Record<string, unknown>,
  start: number
): Promise<JobResult> {
  if (!job.DatabaseName) throw new Error("DatabaseName is required for DBCC CHECKDB");

  const physOnly = params.physicalOnly === true || params.physicalOnly === "true";
  const safeDb = escapeSqlName(job.DatabaseName);
  const option = physOnly ? "PHYSICAL_ONLY" : "NO_INFOMSGS, ALL_ERRORMSGS";

  const pool = await getPool();
  const req = pool.request();

  const messages: string[] = [];
  req.on("info", (info: { message: string }) => {
    if (info.message) messages.push(info.message.trim());
  });

  let dbccFailed = false;
  try {
    await req.query(`DBCC CHECKDB ([${safeDb}]) WITH ${option}`);
  } catch (err) {
    dbccFailed = true;
    messages.push(err instanceof Error ? err.message : String(err));
  }

  const errorLines = messages.filter((m) => /error|corrupt|inconsisten/i.test(m));
  const status = dbccFailed || errorLines.length > 0 ? "failed" : "completed";

  const summary =
    status === "completed"
      ? `DBCC CHECKDB passed — database is clean${physOnly ? " (physical only)" : ""}`
      : `DBCC found ${errorLines.length} issue(s): ${errorLines.slice(0, 3).join("; ")}`;

  return {
    jobId: job.JobId,
    status,
    durationMs: Date.now() - start,
    resultSummary: summary
  };
}
