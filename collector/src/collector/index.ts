import cron from "node-cron";
import { setMaxListeners } from "node:events";
import { config } from "./config.js";
import {
  pushAgentJobs,
  pushAlerts,
  pushBackupFailures,
  pushBlocking,
  pushDatabases,
  pushDiskVolumes,
  pushEvents,
  pushHeartbeat,
  pushMetrics,
  pushQueryStoreSnapshots,
  pushSchemaObjects,
  pollAdHocJobs,
  postJobResult
} from "./apiClient.js";
import { executeAdHocJob, type PendingJob } from "./adhoc-jobs.js";
import { closeAllPools, runQuery } from "./sqlConnection.js";
import { evaluateMetric } from "./alertEvaluator.js";
import { collectBlockingSessions } from "./blocking.js";
import {
  collectAgentJobs,
  collectBackupFailures,
  collectDatabaseHealth,
  collectQueryStoreEnabledDatabases,
  collectQueryStoreRegressed
} from "./databases.js";
import {
  collectBufferCacheHitRatio,
  collectDatabaseSchemaObjects
} from "./databases.js";
import { collectSqlErrorLogEntries, collectWindowsEventsStub } from "./logEvents.js";
import { collectCpuMemoryConnections, collectDiskMetrics, collectTempdbUsage } from "./metrics.js";

type BlockingRow = Awaited<ReturnType<typeof collectBlockingSessions>>[number];
type DiskRow = Awaited<ReturnType<typeof collectDiskMetrics>>[number];
type DatabaseRow = Awaited<ReturnType<typeof collectDatabaseHealth>>[number];
type SqlLogRow = Awaited<ReturnType<typeof collectSqlErrorLogEntries>>[number];

// Collector can keep multiple SQL/database pools and HTTP sockets open concurrently.
// Increase listener ceiling to avoid false-positive leak warnings in this long-lived process.
setMaxListeners(50);

const errorLogState = new Map<string, number>();

function ts() {
  return new Date().toISOString();
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value: unknown, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function printStartupSummary() {
  const on = (v: boolean) => (v ? "enabled" : "DISABLED");
  const authDescriptor =
    config.SQL_AUTH_TYPE === "entra_sp"
      ? `${config.SQL_AUTH_TYPE} (${config.SQL_ENTRA_CLIENT_ID ?? "client-id-missing"})`
      : `${config.SQL_AUTH_TYPE}${config.SQL_USERNAME ? ` (${config.SQL_USERNAME})` : ""}`;
  console.log("[collector] ─────────────────────────────────────────────");
  console.log(`[collector] Server ID  : ${config.SERVER_ID}`);
  console.log(`[collector] SQL Host   : ${config.SQL_SERVER_HOST}:${config.SQL_SERVER_PORT}`);
  console.log(`[collector] Auth type  : ${authDescriptor}`);
  console.log(`[collector] API URL    : ${config.MONITOR_API_URL}`);
  console.log(`[collector] Collectors :`);
  console.log(`[collector]   query_store     : ${on(config.COLLECT_QUERY_STORE)}`);
  console.log(`[collector]   backup_failures : ${on(config.COLLECT_BACKUP_FAILURES)}`);
  console.log(`[collector]   agent_jobs      : ${on(config.COLLECT_AGENT_JOBS)}`);
  console.log(`[collector]   error_throttle  : ${config.ERROR_LOG_THROTTLE_MINUTES} min`);
  console.log("[collector] ─────────────────────────────────────────────");
}

async function runPreflightChecks() {
  console.log("[collector] Running preflight checks...");

  try {
    await runQuery("SELECT 1 AS ok");
    console.log("[collector]   SQL connection   : OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[collector]   SQL connection   : FAILED — ${msg}`);
    throw new Error(`Preflight: SQL unreachable — ${msg}`);
  }

  try {
    const rows = await runQuery<{ has_msdb: number }>("SELECT HAS_DBACCESS('msdb') AS has_msdb");
    const ok = rows[0]?.has_msdb === 1;
    console.log(`[collector]   msdb access      : ${ok ? "OK" : "DENIED (agent jobs / backup collection may skip)"}`);
  } catch {
    console.warn("[collector]   msdb access      : CHECK FAILED (non-fatal)");
  }

  try {
    const rows = await runQuery<{ exists: number }>(
      "SELECT CASE WHEN OBJECT_ID('msdb.dbo.backupset', 'U') IS NOT NULL THEN 1 ELSE 0 END AS [exists]"
    );
    const exists = rows[0]?.exists === 1;
    console.log(`[collector]   backupset table  : ${exists ? "available" : "not available (backup failures will be skipped)"}`);
  } catch {
    console.warn("[collector]   backupset table  : CHECK FAILED (non-fatal)");
  }

  try {
    await pushHeartbeat({ serverId: config.SERVER_ID, status: "preflight", uptimeDays: 0 });
    console.log("[collector]   API reachability : OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[collector]   API reachability : WARN — ${msg}`);
  }

  console.log("[collector] Preflight complete.");
}

async function safeRun(name: string, runner: () => Promise<void>) {
  try {
    await runner();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${name}:${message}`;
    const now = Date.now();
    const throttleMs = config.ERROR_LOG_THROTTLE_MINUTES * 60_000;
    const lastLogged = errorLogState.get(key) ?? 0;

    if (now - lastLogged >= throttleMs) {
      errorLogState.set(key, now);
      console.error(`[collector] ${name} failed: ${message}`);
    }
  }
}

async function runOneMinuteCycle() {
  const cpuMemory = await collectCpuMemoryConnections().catch(() => ({
    cpuUsage: 0,
    memoryUsage: 0,
    activeConnections: 0
  }));
  const blocking = await collectBlockingSessions().catch(() => []);

  await pushMetrics([
    { serverId: config.SERVER_ID, metricType: "cpu", metricName: "cpu_usage", value: cpuMemory.cpuUsage, unit: "percent", timestamp: ts() },
    { serverId: config.SERVER_ID, metricType: "memory", metricName: "memory_usage", value: cpuMemory.memoryUsage, unit: "percent", timestamp: ts() },
    { serverId: config.SERVER_ID, metricType: "connections", metricName: "active_connections", value: cpuMemory.activeConnections, unit: "count", timestamp: ts() }
  ]);

  await pushBlocking(
    blocking.map((item: BlockingRow) => ({
      serverId: config.SERVER_ID,
      sessionId: item.session_id,
      blockingSessionId: item.blocking_session_id,
      databaseName: item.DatabaseName,
      loginName: item.login_name,
      hostName: item.host_name,
      programName: item.program_name,
      waitType: item.wait_type,
      waitTimeMs: item.wait_time,
      waitResource: item.wait_resource,
      queryText: item.QueryText,
      status: item.status,
      cpuTimeMs: item.cpu_time,
      logicalReads: item.logical_reads,
      isHeadBlocker: item.blocking_session_id === 0,
      blockedCount: 0
    }))
  );

  const cpuAlert = evaluateMetric("cpu", cpuMemory.cpuUsage, { metricType: "cpu", warningValue: 80, criticalValue: 90 });
  const memAlert = evaluateMetric("memory", cpuMemory.memoryUsage, { metricType: "memory", warningValue: 85, criticalValue: 95 });
  const activeAlerts = [cpuAlert, memAlert].filter(Boolean);

  if (activeAlerts.length > 0) {
    await pushAlerts(
      activeAlerts.map((alert) => ({
        serverId: config.SERVER_ID,
        databaseId: null,
        alertType: alert!.alertType,
        severity: alert!.severity,
        title: alert!.title,
        message: alert!.message,
        metricValue: alert!.metricValue,
        thresholdValue: alert!.thresholdValue
      }))
    );

    await pushEvents(
      activeAlerts.map((alert) => ({
        serverId: config.SERVER_ID,
        source: "collector",
        eventId: 0,
        severity: alert!.severity,
        message: `${alert!.title}: ${alert!.message}`,
        eventTime: ts(),
        category: alert!.alertType
      }))
    );
  }

  await pushHeartbeat({
    serverId: config.SERVER_ID,
    status: "online",
    uptimeDays: 0
  });
}

async function runFiveMinuteCycle() {
  const diskRows = await collectDiskMetrics().catch(() => []);
  const dbRows = await collectDatabaseHealth().catch(() => []);
  const tempdb = await collectTempdbUsage().catch(() => ({
    TotalMb: 0,
    UsedMb: 0,
    VersionStoreMb: 0,
    UserObjectMb: 0,
    InternalObjectMb: 0
  }));

  if (config.COLLECT_BACKUP_FAILURES) {
    const backupFailures = await collectBackupFailures();
    if (backupFailures.length > 0) {
      await pushBackupFailures(
        backupFailures.map((row) => ({
          serverId: config.SERVER_ID,
          databaseName: row.DatabaseName,
          backupStartDate: row.BackupStartDate,
          backupFinishDate: row.BackupFinishDate,
          backupType: row.BackupType,
          errorMessage: row.ErrorMessage,
          backupSize: row.BackupSize
        }))
      );
    }
  }

  await pushDatabases(
    dbRows.map((db: DatabaseRow) => ({
      serverId: config.SERVER_ID,
      name: db.DatabaseName,
      status: String(db.DatabaseStatus || "online").toLowerCase(),
      health: String(db.DatabaseStatus || "ONLINE").toUpperCase() === "ONLINE" ? "healthy" : "warning",
      recoveryModel: db.RecoveryModel,
      compatibilityLevel: db.CompatibilityLevel,
      dataSizeMb: Number(db.DataSizeMb),
      logSizeMb: Number(db.LogSizeMb),
      logUsedPercent: Number(db.LogUsedPercent),
      lastFullBackup: db.LastFullBackup,
      lastDiffBackup: db.LastDiffBackup,
      lastLogBackup: db.LastLogBackup,
      fullBackupName: db.FullBackupName,
      diffBackupName: db.DiffBackupName,
      logBackupName: db.LogBackupName,
      fullHeaderFileOnly: db.FullHeaderFileOnly,
      diffHeaderFileOnly: db.DiffHeaderFileOnly,
      logHeaderFileOnly: db.LogHeaderFileOnly,
      fullBackupLocation: db.FullBackupLocation,
      diffBackupLocation: db.DiffBackupLocation,
      logBackupLocation: db.LogBackupLocation,
      backupStatus: db.BackupStatus
    }))
  );

  await pushDiskVolumes(
    diskRows.map((row: DiskRow) => {
      const mountPoint = row.volume_mount_point || "unknown";
      const volumeName = mountPoint.endsWith("\\") ? mountPoint.slice(0, -1) : mountPoint;
      const totalSizeGb = Number(row.TotalGb);
      const freeSpaceGb = Number(row.FreeGb);
      const usedPercent = Number(row.UsedPct);

      return {
        serverId: config.SERVER_ID,
        volumeName,
        label: row.logical_volume_name || volumeName,
        totalSizeGb,
        freeSpaceGb,
        usedPercent,
        status: usedPercent >= 90 ? "critical" : usedPercent >= 80 ? "warning" : "ok",
        containsDataFiles: true,
        containsLogFiles: true
      };
    })
  );

  await pushMetrics([
    ...diskRows.map((row: DiskRow) => ({
      serverId: config.SERVER_ID,
      metricType: "disk",
      metricName: row.volume_mount_point,
      value: row.UsedPct,
      unit: "percent",
      volumeName: row.logical_volume_name,
      timestamp: ts()
    })),
    ...dbRows.map((db: DatabaseRow) => ({
      serverId: config.SERVER_ID,
      metricType: "db_size",
      metricName: db.DatabaseName,
      value: Number(db.DataSizeMb) + Number(db.LogSizeMb),
      unit: "mb",
      timestamp: ts()
    })),
    {
      serverId: config.SERVER_ID,
      metricType: "tempdb",
      metricName: "tempdb_used_mb",
      value: Number(tempdb.UsedMb),
      unit: "mb",
      timestamp: ts()
    },
    {
      serverId: config.SERVER_ID,
      metricType: "tempdb",
      metricName: "tempdb_version_store_mb",
      value: Number(tempdb.VersionStoreMb),
      unit: "mb",
      timestamp: ts()
    },
    {
      serverId: config.SERVER_ID,
      metricType: "tempdb",
      metricName: "tempdb_used_percent",
      value: Number(tempdb.TotalMb) > 0 ? (Number(tempdb.UsedMb) / Number(tempdb.TotalMb)) * 100 : 0,
      unit: "percent",
      timestamp: ts()
    }
  ]);
}

async function runQueryStoreCycle() {
  if (!config.COLLECT_QUERY_STORE) {
    return;
  }

  const enabledDbs = await collectQueryStoreEnabledDatabases();
  let skippedDbs = 0;

  for (const dbName of enabledDbs) {
    try {
      const rows = await collectQueryStoreRegressed(dbName);
      if (rows.length > 0) {
        await pushQueryStoreSnapshots(
          rows.map((row) => ({
            serverId: config.SERVER_ID,
            databaseName: dbName,
            queryId: toInt(row.QueryId),
            queryText: row.QueryText,
            recentAvgMs: toNumber(row.RecentAvgMs),
            historicAvgMs: toNumber(row.HistoricAvgMs),
            regressionRatio: row.RegressionRatio === null ? null : toNumber(row.RegressionRatio),
            recentExecCount: toInt(row.RecentExecCount),
            historicExecCount: toInt(row.HistoricExecCount),
            avgLogicalReads: toNumber(row.AvgLogicalReads)
          }))
        );
      }
    } catch (error) {
      skippedDbs++;
      const msg = error instanceof Error ? error.message : String(error);
      const key = `query-store-db:${dbName}:${msg}`;
      const now = Date.now();
      const throttleMs = config.ERROR_LOG_THROTTLE_MINUTES * 60_000;
      const lastLogged = errorLogState.get(key) ?? 0;
      if (now - lastLogged >= throttleMs) {
        errorLogState.set(key, now);
        console.warn(`[collector] Query Store skipped for '${dbName}': ${msg}`);
      }
    }
  }

  // Push skip-count as a collector_warning metric so the dashboard can surface it
  await pushMetrics([{
    serverId: config.SERVER_ID,
    metricType: "collector_warning",
    metricName: "query_store_skipped_dbs",
    value: skippedDbs,
    unit: "count",
    timestamp: ts()
  }]);
}

async function runFifteenMinuteCycle() {
  const logs = await collectSqlErrorLogEntries().catch(() => []);
  await pushEvents(
    logs.slice(0, 100).map((entry: SqlLogRow) => ({
      serverId: config.SERVER_ID,
      source: "sql_error_log",
      severity: "error",
      message: entry.Text,
      eventTime: entry.LogDate,
      category: entry.ProcessInfo
    }))
  );

  if (config.COLLECT_AGENT_JOBS) {
    const agentJobs = await collectAgentJobs();
    if (agentJobs.length > 0) {
      await pushAgentJobs(
        agentJobs.map((row) => ({
          serverId: config.SERVER_ID,
          jobId: row.JobId,
          jobName: row.JobName,
          lastRunDate: row.LastRunDate,
          lastRunStatus: row.LastRunStatus,
          lastRunDuration: row.LastRunDuration,
          isEnabled: row.IsEnabled,
          nextRunDate: row.NextRunDate
        }))
      );
    }
  }
}

async function runHourlyCycle() {
  const windowsEvents = await collectWindowsEventsStub();
  await pushEvents(
    windowsEvents.map((event) => ({
      serverId: config.SERVER_ID,
      source: event.source,
      severity: event.severity,
      message: event.message,
      eventTime: event.eventTime,
      category: event.category
    }))
  );
}

async function runAdHocJobCycle() {
  const rawJobs = await pollAdHocJobs(config.SERVER_ID);
  const jobs: PendingJob[] = rawJobs
    .map<PendingJob>((row) => ({
      JobId: String(row.JobId ?? ""),
      DatabaseName: row.DatabaseName == null ? null : String(row.DatabaseName),
      JobType:
        row.JobType === "backup"
          ? "backup"
          : row.JobType === "sql_query"
          ? "sql_query"
          : "dbcc_checkdb",
      Params: row.Params == null ? null : String(row.Params)
    }))
    .filter((row) => row.JobId.length > 0);
  if (jobs.length === 0) return;

  for (const job of jobs) {
    // Signal running immediately so the UI updates
    await postJobResult({ jobId: job.JobId, status: "running" }).catch(() => {});

    console.log(`[collector] ad-hoc job starting: ${job.JobType} on ${job.DatabaseName ?? "server"} (${job.JobId})`);
    const result = await executeAdHocJob(job);
    console.log(`[collector] ad-hoc job ${result.status}: ${result.resultSummary} (${result.durationMs}ms)`);

    await postJobResult({
      jobId: result.jobId,
      status: result.status,
      durationMs: result.durationMs,
      resultSummary: result.resultSummary
    });
  }
}

async function start() {
  printStartupSummary();
  await runPreflightChecks();

  await safeRun("bootstrap cycle", runOneMinuteCycle);
  await safeRun("bootstrap five-minute cycle", runFiveMinuteCycle);
  await safeRun("bootstrap query store cycle", runQueryStoreCycle);

  cron.schedule("* * * * *", () => void safeRun("1-minute cycle", runOneMinuteCycle));
  cron.schedule("*/5 * * * *", () => void safeRun("5-minute cycle", runFiveMinuteCycle));
  cron.schedule("*/10 * * * *", () => void safeRun("query store cycle", runQueryStoreCycle));
  cron.schedule("*/15 * * * *", () => void safeRun("15-minute cycle", runFifteenMinuteCycle));
  cron.schedule("0 * * * *", () => void safeRun("hourly cycle", runHourlyCycle));
  await safeRun("bootstrap schema objects cycle", runSchemaObjectsCycle);
  cron.schedule("*/5 * * * *", () => void safeRun("schema objects cycle", runSchemaObjectsCycle));
  cron.schedule("* * * * *", () => void safeRun("ad-hoc jobs cycle", runAdHocJobCycle));

  console.log("[collector] SQLSentinnel collector started.");
}

let shuttingDown = false;
async function shutdownCollector(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[collector] ${signal} received, closing SQL pools...`);
  await closeAllPools().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdownCollector("SIGINT"));
process.on("SIGTERM", () => void shutdownCollector("SIGTERM"));

async function runSchemaObjectsCycle() {
  const dbs = await runQuery<{ name: string }>(`
    SELECT name FROM sys.databases
    WHERE state_desc = 'ONLINE'
      AND HAS_DBACCESS(name) = 1
      AND name NOT IN ('master', 'tempdb', 'model', 'msdb')
  `);

  let bufferCacheHitRatio = 0;
  try {
    bufferCacheHitRatio = await collectBufferCacheHitRatio();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const key = `schema-objects:buffer-cache:${msg}`;
    const now = Date.now();
    const throttleMs = config.ERROR_LOG_THROTTLE_MINUTES * 60_000;
    const lastLogged = errorLogState.get(key) ?? 0;
    if (now - lastLogged >= throttleMs) {
      errorLogState.set(key, now);
      console.warn(`[collector] Buffer cache ratio unavailable: ${msg}`);
    }
  }
  const dbResults: Array<Record<string, unknown>> = [];

  for (const db of dbs) {
    try {
      const { counts, topProcs, fragIndexes } = await collectDatabaseSchemaObjects(db.name);
      dbResults.push({
        databaseName: db.name,
        tableCnt: toInt(counts.TableCount),
        viewCnt: toInt(counts.ViewCount),
        procCnt: toInt(counts.ProcCount),
        funcCnt: toInt(counts.FunctionCount),
        indexCnt: toInt(counts.IndexCount),
        topProcs: topProcs.map((p) => ({
          procName: p.ProcName,
          execCount: toInt(p.ExecutionCount),
          totalCpuMs: toNumber(p.TotalCpuMs),
          avgCpuMs: toNumber(p.AvgCpuMs),
          totalLogicalReads: toNumber(p.TotalLogicalReads)
        })),
        fragIndexes: fragIndexes.map((i) => ({
          tableName: i.TableName,
          indexName: i.IndexName,
          indexType: i.IndexType,
          fragPct: toNumber(i.FragmentationPct),
          seeks: toInt(i.UserSeeks),
          scans: toInt(i.UserScans),
          updates: toInt(i.UserUpdates),
          pageCount: toInt(i.PageCount)
        }))
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const key = `schema-objects:${db.name}:${msg}`;
      const now = Date.now();
      const throttleMs = config.ERROR_LOG_THROTTLE_MINUTES * 60_000;
      const lastLogged = errorLogState.get(key) ?? 0;
      if (now - lastLogged >= throttleMs) {
        errorLogState.set(key, now);
        console.warn(`[collector] Schema objects skipped for '${db.name}': ${msg}`);
      }
    }
  }

  if (dbResults.length > 0) {
    await pushSchemaObjects({
      serverId: config.SERVER_ID,
      databases: dbResults,
      bufferCacheHitRatio
    });
  }
}

start().catch((error) => {
  console.error("Collector failed to start", error);
});
