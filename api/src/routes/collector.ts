import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/sql.js";

const sqlGuidSchema = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

const metricSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    databaseId: sqlGuidSchema.optional(),
    metricType: z.string(),
    metricName: z.string().optional(),
    value: z.number(),
    unit: z.string().optional(),
    volumeName: z.string().optional(),
    timestamp: z.string().datetime().optional()
  })
);

const alertSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    databaseId: sqlGuidSchema.nullable().optional(),
    alertType: z.string(),
    severity: z.string(),
    title: z.string(),
    message: z.string().optional(),
    metricValue: z.number().optional(),
    thresholdValue: z.number().optional()
  })
);

const databaseHealthSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    name: z.string().min(1),
    status: z.string().default("online"),
    health: z.string().default("healthy"),
    recoveryModel: z.string().nullable().optional(),
    compatibilityLevel: z.number().nullable().optional(),
    dataSizeMb: z.number().nullable().optional(),
    logSizeMb: z.number().nullable().optional(),
    logUsedPercent: z.number().nullable().optional(),
    lastFullBackup: z.string().nullable().optional(),
    lastDiffBackup: z.string().nullable().optional(),
    lastLogBackup: z.string().nullable().optional(),
    fullBackupName: z.string().nullable().optional(),
    diffBackupName: z.string().nullable().optional(),
    logBackupName: z.string().nullable().optional(),
    fullHeaderFileOnly: z.number().int().nullable().optional(),
    diffHeaderFileOnly: z.number().int().nullable().optional(),
    logHeaderFileOnly: z.number().int().nullable().optional(),
    fullBackupLocation: z.string().nullable().optional(),
    diffBackupLocation: z.string().nullable().optional(),
    logBackupLocation: z.string().nullable().optional(),
    backupStatus: z.string().nullable().optional()
  })
);

const diskVolumeSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    volumeName: z.string().min(1),
    label: z.string().nullable().optional(),
    totalSizeGb: z.number(),
    freeSpaceGb: z.number(),
    usedPercent: z.number().nullable().optional(),
    status: z.string().default("ok"),
    containsDataFiles: z.boolean().default(false),
    containsLogFiles: z.boolean().default(false)
  })
);

const queryStoreSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    databaseName: z.string().min(1),
    queryId: z.number(),
    queryText: z.string().max(4000).nullable().optional(),
    recentAvgMs: z.number().nullable().optional(),
    historicAvgMs: z.number().nullable().optional(),
    regressionRatio: z.number().nullable().optional(),
    recentExecCount: z.number().int().nullable().optional(),
    historicExecCount: z.number().int().nullable().optional(),
    avgLogicalReads: z.number().nullable().optional()
  })
);

const backupFailureSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    databaseName: z.string().min(1),
    backupStartDate: z.string(),
    backupFinishDate: z.string().nullable().optional(),
    backupType: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    backupSize: z.number().nullable().optional()
  })
);

const agentJobSchema = z.array(
  z.object({
    serverId: sqlGuidSchema,
    jobId: z.string(),
    jobName: z.string().min(1),
    lastRunDate: z.string().nullable().optional(),
    lastRunStatus: z.number().int().nullable().optional(),
    lastRunDuration: z.number().int().nullable().optional(),
    isEnabled: z.number().int(),
    nextRunDate: z.string().nullable().optional()
  })
);

export const collectorRouter = Router();

collectorRouter.use((req, res, next) => {
  const apiKey = req.headers["x-monitor-api-key"];
  if (apiKey !== env.MONITOR_API_KEY) {
    res.status(401).json({ message: "Invalid collector API key" });
    return;
  }
  next();
});

function hoursSince(value: string | null | undefined) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function deriveBackupStatus(db: z.infer<typeof databaseHealthSchema>[number]) {
  if (db.name.trim().toLowerCase() === "tempdb") return "n/a";
  if (db.backupStatus && db.backupStatus.trim().length > 0) return db.backupStatus;

  const fullHours = hoursSince(db.lastFullBackup ?? null);
  const logHours = hoursSince(db.lastLogBackup ?? null);
  const recoveryModel = (db.recoveryModel ?? "").toUpperCase();

  if (fullHours === null || fullHours > 48) return "critical";
  if ((recoveryModel === "FULL" || recoveryModel === "BULK_LOGGED") && (logHours === null || logHours > 6)) {
    return "warning";
  }
  return "healthy";
}

collectorRouter.post("/metrics", async (req, res, next) => {
  const parsed = metricSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    for (const metric of parsed.data) {
      let resolvedDatabaseId: string | null = metric.databaseId ?? null;
      if (!resolvedDatabaseId && metric.metricName) {
        const [database] = await query<{ DatabaseId: string }>(
          `SELECT TOP 1 DatabaseId FROM Databases WHERE ServerId = @serverId AND Name = @name`,
          { serverId: metric.serverId, name: metric.metricName }
        );
        resolvedDatabaseId = database?.DatabaseId ?? null;
      }

      await query(
        `INSERT INTO Metrics(ServerId, DatabaseId, MetricType, MetricName, Value, Unit, VolumeName, Timestamp)
         VALUES(@serverId, @databaseId, @metricType, @metricName, @value, @unit, @volumeName, COALESCE(@timestamp, GETUTCDATE()))`,
        {
          serverId: metric.serverId,
          databaseId: resolvedDatabaseId,
          metricType: metric.metricType,
          metricName: metric.metricName ?? null,
          value: metric.value,
          unit: metric.unit ?? null,
          volumeName: metric.volumeName ?? null,
          timestamp: metric.timestamp ?? null
        }
      );
    }

    res.status(201).json({ data: { inserted: parsed.data.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/databases", async (req, res, next) => {
  const parsed = databaseHealthSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    for (const db of parsed.data) {
      await query(
        `MERGE Databases AS target
         USING (SELECT @serverId AS ServerId, @name AS Name) AS source
         ON target.ServerId = source.ServerId AND target.Name = source.Name
         WHEN MATCHED THEN
           UPDATE SET
             Status = @status,
             Health = @health,
             RecoveryModel = @recoveryModel,
             CompatibilityLevel = @compatibilityLevel,
             DataSizeMb = @dataSizeMb,
             LogSizeMb = @logSizeMb,
             LogUsedPercent = @logUsedPercent,
             LastFullBackup = @lastFullBackup,
             LastDiffBackup = @lastDiffBackup,
             LastLogBackup = @lastLogBackup,
             FullBackupName = @fullBackupName,
             DiffBackupName = @diffBackupName,
             LogBackupName = @logBackupName,
             FullHeaderFileOnly = @fullHeaderFileOnly,
             DiffHeaderFileOnly = @diffHeaderFileOnly,
             LogHeaderFileOnly = @logHeaderFileOnly,
             FullBackupLocation = @fullBackupLocation,
             DiffBackupLocation = @diffBackupLocation,
             LogBackupLocation = @logBackupLocation,
             BackupStatus = @backupStatus,
             LastCheck = GETUTCDATE(),
             UpdatedDate = GETUTCDATE()
         WHEN NOT MATCHED THEN
           INSERT (ServerId, Name, Status, Health, RecoveryModel, CompatibilityLevel, DataSizeMb, LogSizeMb, LogUsedPercent, LastFullBackup, LastDiffBackup, LastLogBackup, FullBackupName, DiffBackupName, LogBackupName, FullHeaderFileOnly, DiffHeaderFileOnly, LogHeaderFileOnly, FullBackupLocation, DiffBackupLocation, LogBackupLocation, BackupStatus, LastCheck)
           VALUES (@serverId, @name, @status, @health, @recoveryModel, @compatibilityLevel, @dataSizeMb, @logSizeMb, @logUsedPercent, @lastFullBackup, @lastDiffBackup, @lastLogBackup, @fullBackupName, @diffBackupName, @logBackupName, @fullHeaderFileOnly, @diffHeaderFileOnly, @logHeaderFileOnly, @fullBackupLocation, @diffBackupLocation, @logBackupLocation, @backupStatus, GETUTCDATE());`,
        {
          serverId: db.serverId,
          name: db.name,
          status: db.status,
          health: db.health,
          recoveryModel: db.recoveryModel ?? null,
          compatibilityLevel: db.compatibilityLevel ?? null,
          dataSizeMb: db.dataSizeMb ?? null,
          logSizeMb: db.logSizeMb ?? null,
          logUsedPercent: db.logUsedPercent ?? null,
          lastFullBackup: db.lastFullBackup ?? null,
          lastDiffBackup: db.lastDiffBackup ?? null,
          lastLogBackup: db.lastLogBackup ?? null,
          fullBackupName: db.fullBackupName ?? null,
          diffBackupName: db.diffBackupName ?? null,
          logBackupName: db.logBackupName ?? null,
          fullHeaderFileOnly: db.fullHeaderFileOnly ?? null,
          diffHeaderFileOnly: db.diffHeaderFileOnly ?? null,
          logHeaderFileOnly: db.logHeaderFileOnly ?? null,
          fullBackupLocation: db.fullBackupLocation ?? null,
          diffBackupLocation: db.diffBackupLocation ?? null,
          logBackupLocation: db.logBackupLocation ?? null,
          backupStatus: deriveBackupStatus(db)
        }
      );
    }

    res.status(201).json({ data: { upserted: parsed.data.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/disks", async (req, res, next) => {
  const parsed = diskVolumeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    for (const disk of parsed.data) {
      await query(
        `MERGE DiskVolumes AS target
         USING (SELECT @serverId AS ServerId, @volumeName AS VolumeName) AS source
         ON target.ServerId = source.ServerId AND target.VolumeName = source.VolumeName
         WHEN MATCHED THEN
           UPDATE SET
             Label = @label,
             TotalSizeGb = @totalSizeGb,
             FreeSpaceGb = @freeSpaceGb,
             UsedPercent = @usedPercent,
             Status = @status,
             ContainsDataFiles = @containsDataFiles,
             ContainsLogFiles = @containsLogFiles,
             LastCheck = GETUTCDATE(),
             UpdatedDate = GETUTCDATE()
         WHEN NOT MATCHED THEN
           INSERT (ServerId, VolumeName, Label, TotalSizeGb, FreeSpaceGb, UsedPercent, Status, ContainsDataFiles, ContainsLogFiles, LastCheck)
           VALUES (@serverId, @volumeName, @label, @totalSizeGb, @freeSpaceGb, @usedPercent, @status, @containsDataFiles, @containsLogFiles, GETUTCDATE());`,
        {
          serverId: disk.serverId,
          volumeName: disk.volumeName,
          label: disk.label ?? null,
          totalSizeGb: disk.totalSizeGb,
          freeSpaceGb: disk.freeSpaceGb,
          usedPercent: disk.usedPercent ?? null,
          status: disk.status,
          containsDataFiles: disk.containsDataFiles,
          containsLogFiles: disk.containsLogFiles
        }
      );
    }

    res.status(201).json({ data: { upserted: parsed.data.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/events", async (req, res, next) => {
  try {
    const events = req.body as Array<Record<string, unknown>>;
    for (const event of events) {
      await query(
        `INSERT INTO LogEvents(ServerId, DatabaseName, Source, EventId, Severity, Message, EventTime, Category)
         VALUES(@serverId, @databaseName, @source, @eventId, @severity, @message, @eventTime, @category)`,
        {
          serverId: event.serverId,
          databaseName: event.databaseName ?? null,
          source: event.source,
          eventId: event.eventId ?? null,
          severity: event.severity,
          message: event.message,
          eventTime: event.eventTime,
          category: event.category ?? null
        }
      );
    }

    res.status(201).json({ data: { inserted: events.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/alerts", async (req, res, next) => {
  const parsed = alertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    for (const alert of parsed.data) {
      await query(
        `INSERT INTO Alerts(ServerId, DatabaseId, AlertType, Severity, Title, Message, MetricValue, ThresholdValue, TriggeredAt)
         VALUES(@serverId, @databaseId, @alertType, @severity, @title, @message, @metricValue, @thresholdValue, GETUTCDATE())`,
        {
          serverId: alert.serverId,
          databaseId: alert.databaseId ?? null,
          alertType: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          message: alert.message ?? null,
          metricValue: alert.metricValue ?? null,
          thresholdValue: alert.thresholdValue ?? null
        }
      );
    }

    res.status(201).json({ data: { inserted: parsed.data.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/blocking", async (req, res, next) => {
  try {
    const sessions = req.body as Array<Record<string, unknown>>;
    for (const session of sessions) {
      await query(
        `INSERT INTO BlockingSessions(ServerId, SessionId, BlockingSessionId, DatabaseName, LoginName, HostName, ProgramName, WaitType, WaitTimeMs, WaitResource, QueryText, Status, CpuTimeMs, LogicalReads, IsHeadBlocker, BlockedCount)
         VALUES(@serverId, @sessionId, @blockingSessionId, @databaseName, @loginName, @hostName, @programName, @waitType, @waitTimeMs, @waitResource, @queryText, @status, @cpuTimeMs, @logicalReads, @isHeadBlocker, @blockedCount)`,
        session
      );
    }

    res.status(201).json({ data: { inserted: sessions.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/dbcc", async (req, res, next) => {
  try {
    const results = req.body as Array<Record<string, unknown>>;
    for (const result of results) {
      await query(
        `INSERT INTO DBCCResults(ServerId, DatabaseId, DatabaseName, CheckType, RunDate, DurationSeconds, Status, ErrorsFound, WarningsFound, RepairNeeded, OutputSummary, DetailedResults)
         VALUES(@serverId, @databaseId, @databaseName, @checkType, @runDate, @durationSeconds, @status, @errorsFound, @warningsFound, @repairNeeded, @outputSummary, @detailedResults)`,
        result
      );
    }

    res.status(201).json({ data: { inserted: results.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/heartbeat", async (req, res, next) => {
  try {
    await query(
      `UPDATE Servers
       SET Status = @status,
           UptimeDays = @uptimeDays,
           LastCheck = GETUTCDATE(),
           UpdatedDate = GETUTCDATE()
       WHERE ServerId = @serverId`,
      req.body
    );

    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
});

async function ensureQueryStoreTable() {
  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueryStoreSnapshots' AND schema_id = SCHEMA_ID('dbo'))
    CREATE TABLE dbo.QueryStoreSnapshots (
      SnapshotId        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      DatabaseId        UNIQUEIDENTIFIER NOT NULL,
      CapturedAt        DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      QueryId           BIGINT NOT NULL,
      QueryText         NVARCHAR(MAX) NULL,
      RecentAvgMs       DECIMAL(18,4) NULL,
      HistoricAvgMs     DECIMAL(18,4) NULL,
      RegressionRatio   DECIMAL(10,4) NULL,
      RecentExecCount   INT NULL,
      HistoricExecCount INT NULL,
      AvgLogicalReads   DECIMAL(18,2) NULL
    );
  `);
}

let queryStoreTableReady = false;

collectorRouter.post("/query-store", async (req, res, next) => {
  const parsed = queryStoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    return;
  }

  try {
    if (!queryStoreTableReady) {
      await ensureQueryStoreTable();
      queryStoreTableReady = true;
    }

    let inserted = 0;
    for (const item of parsed.data) {
      const [db] = await query<{ DatabaseId: string }>(
        `SELECT TOP 1 DatabaseId FROM Databases WHERE ServerId = @serverId AND Name = @name`,
        { serverId: item.serverId, name: item.databaseName }
      );

      if (!db) continue;

      await query(
        `DELETE FROM QueryStoreSnapshots WHERE DatabaseId = @databaseId AND CapturedAt < DATEADD(MINUTE, -15, GETUTCDATE())`,
        { databaseId: db.DatabaseId }
      );

      await query(
        `INSERT INTO QueryStoreSnapshots (DatabaseId, QueryId, QueryText, RecentAvgMs, HistoricAvgMs, RegressionRatio, RecentExecCount, HistoricExecCount, AvgLogicalReads)
         VALUES (@databaseId, @queryId, @queryText, @recentAvgMs, @historicAvgMs, @regressionRatio, @recentExecCount, @historicExecCount, @avgLogicalReads)`,
        {
          databaseId: db.DatabaseId,
          queryId: item.queryId,
          queryText: item.queryText ?? null,
          recentAvgMs: item.recentAvgMs ?? null,
          historicAvgMs: item.historicAvgMs ?? null,
          regressionRatio: item.regressionRatio ?? null,
          recentExecCount: item.recentExecCount ?? null,
          historicExecCount: item.historicExecCount ?? null,
          avgLogicalReads: item.avgLogicalReads ?? null
        }
      );
      inserted += 1;
    }

    res.status(201).json({ data: { inserted } });

  // ── Ad-hoc job queue ─────────────────────────────────────────────────────────

  const jobPollSchema = z.object({ serverId: sqlGuidSchema });

  const jobResultSchema = z.object({
    jobId: sqlGuidSchema,
    status: z.enum(["running", "completed", "failed"]),
    durationMs: z.number().int().nonnegative().optional(),
    resultSummary: z.string().max(4000).optional()
  });

  collectorRouter.post("/job-poll", async (req, res, next) => {
    const parsed = jobPollSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid payload" });
      return;
    }
    try {
      const tableExists = await query<{ n: number }>(
        `SELECT COUNT(1) AS n FROM sys.tables WHERE name='AdHocJobs' AND schema_id=SCHEMA_ID('dbo')`, {}
      );
      if (!tableExists[0] || tableExists[0].n === 0) {
        res.json({ data: [] });
        return;
      }
      const jobs = await query(`
        SELECT TOP 5 JobId, DatabaseName, JobType, Params
        FROM dbo.AdHocJobs
        WHERE ServerId = @serverId AND Status = 'pending'
        ORDER BY CreatedAt ASC
      `, { serverId: parsed.data.serverId });
      res.json({ data: jobs });
    } catch (error) {
      next(error);
    }
  });

  collectorRouter.post("/job-result", async (req, res, next) => {
    const parsed = jobResultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid payload" });
      return;
    }
    try {
      const { jobId, status, durationMs, resultSummary } = parsed.data;
      if (status === "running") {
        await query(`
          UPDATE dbo.AdHocJobs
          SET Status = 'running', StartedAt = SYSUTCDATETIME()
          WHERE JobId = @jobId AND Status = 'pending'
        `, { jobId });
      } else {
        await query(`
          UPDATE dbo.AdHocJobs
          SET Status = @status,
              CompletedAt = SYSUTCDATETIME(),
              DurationMs = @durationMs,
              ResultSummary = @resultSummary
          WHERE JobId = @jobId
        `, { jobId, status, durationMs: durationMs ?? null, resultSummary: resultSummary ?? null });
      }
      res.json({ data: { ok: true } });
    } catch (error) {
      next(error);
    }
  });
  } catch (error) {
    next(error);
  }
});

const schemaObjectsSchema = z.object({
  serverId: sqlGuidSchema,
  bufferCacheHitRatio: z.number(),
  databases: z.array(
    z.object({
      databaseName: z.string().min(1),
      tableCnt: z.number().int(),
      viewCnt: z.number().int(),
      procCnt: z.number().int(),
      funcCnt: z.number().int(),
      indexCnt: z.number().int(),
      topProcs: z.array(
        z.object({
          procName: z.string(),
          execCount: z.number().int(),
          totalCpuMs: z.number(),
          avgCpuMs: z.number(),
          totalLogicalReads: z.number()
        })
      ),
      fragIndexes: z.array(
        z.object({
          tableName: z.string(),
          indexName: z.string(),
          indexType: z.string(),
          fragPct: z.number(),
          seeks: z.number().int(),
          scans: z.number().int(),
          updates: z.number().int(),
          pageCount: z.number().int()
        })
      )
    })
  )
});

async function ensureSchemaStatsTables() {
  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DatabaseSchemaStats' AND schema_id = SCHEMA_ID('dbo'))
    CREATE TABLE dbo.DatabaseSchemaStats (
      SchemaStatId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DatabaseSchemaStats PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
      ServerId UNIQUEIDENTIFIER NOT NULL,
      DatabaseId UNIQUEIDENTIFIER NULL,
      DatabaseName NVARCHAR(128) NOT NULL,
      TableCnt INT NOT NULL DEFAULT 0,
      ViewCnt INT NOT NULL DEFAULT 0,
      ProcCnt INT NOT NULL DEFAULT 0,
      FuncCnt INT NOT NULL DEFAULT 0,
      IndexCnt INT NOT NULL DEFAULT 0,
      CapturedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    )
  `, {});

  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DatabaseProcStats' AND schema_id = SCHEMA_ID('dbo'))
    CREATE TABLE dbo.DatabaseProcStats (
      ProcStatId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DatabaseProcStats PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
      ServerId UNIQUEIDENTIFIER NOT NULL,
      DatabaseId UNIQUEIDENTIFIER NULL,
      DatabaseName NVARCHAR(128) NOT NULL,
      ProcName NVARCHAR(256) NOT NULL,
      ExecutionCount BIGINT NOT NULL DEFAULT 0,
      TotalCpuMs DECIMAL(18,2) NOT NULL DEFAULT 0,
      AvgCpuMs DECIMAL(18,4) NOT NULL DEFAULT 0,
      TotalLogicalReads BIGINT NOT NULL DEFAULT 0,
      CapturedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    )
  `, {});

  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DatabaseIndexStats' AND schema_id = SCHEMA_ID('dbo'))
    CREATE TABLE dbo.DatabaseIndexStats (
      IndexStatId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DatabaseIndexStats PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
      ServerId UNIQUEIDENTIFIER NOT NULL,
      DatabaseId UNIQUEIDENTIFIER NULL,
      DatabaseName NVARCHAR(128) NOT NULL,
      TableName NVARCHAR(256) NOT NULL,
      IndexName NVARCHAR(256) NOT NULL,
      IndexType NVARCHAR(60) NOT NULL,
      FragmentationPct DECIMAL(5,1) NOT NULL DEFAULT 0,
      UserSeeks BIGINT NOT NULL DEFAULT 0,
      UserScans BIGINT NOT NULL DEFAULT 0,
      UserUpdates BIGINT NOT NULL DEFAULT 0,
      PageCount INT NOT NULL DEFAULT 0,
      CapturedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    )
  `, {});
}

let schemaTablesEnsured = false;

collectorRouter.post("/schema-objects", async (req, res, next) => {
  const parsed = schemaObjectsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    if (!schemaTablesEnsured) {
      await ensureSchemaStatsTables();
      schemaTablesEnsured = true;
    }

    const { serverId, databases, bufferCacheHitRatio } = parsed.data;
    const now = new Date().toISOString();

    // Store buffer cache hit ratio as a server-level metric
    await query(
      `INSERT INTO Metrics(ServerId, MetricType, MetricName, Value, Unit, Timestamp)
       VALUES(@serverId, 'cache', 'buffer_cache_hit_ratio', @value, 'percent', @timestamp)`,
      { serverId, value: bufferCacheHitRatio, timestamp: now }
    );

    for (const db of databases) {
      // Resolve DatabaseId
      const [dbRecord] = await query<{ DatabaseId: string }>(
        `SELECT TOP 1 DatabaseId FROM Databases WHERE ServerId = @serverId AND Name = @name`,
        { serverId, name: db.databaseName }
      );
      const databaseId = dbRecord?.DatabaseId ?? null;

      // Insert schema stats snapshot
      await query(
        `INSERT INTO DatabaseSchemaStats(ServerId, DatabaseId, DatabaseName, TableCnt, ViewCnt, ProcCnt, FuncCnt, IndexCnt, CapturedAt)
         VALUES(@serverId, @databaseId, @databaseName, @tableCnt, @viewCnt, @procCnt, @funcCnt, @indexCnt, @capturedAt)`,
        {
          serverId, databaseId, databaseName: db.databaseName,
          tableCnt: db.tableCnt, viewCnt: db.viewCnt,
          procCnt: db.procCnt, funcCnt: db.funcCnt, indexCnt: db.indexCnt,
          capturedAt: now
        }
      );

      if (databaseId) {
        // Replace proc stats
        await query(`DELETE FROM DatabaseProcStats WHERE DatabaseId = @databaseId`, { databaseId });
        for (const proc of db.topProcs) {
          await query(
            `INSERT INTO DatabaseProcStats(ServerId, DatabaseId, DatabaseName, ProcName, ExecutionCount, TotalCpuMs, AvgCpuMs, TotalLogicalReads, CapturedAt)
             VALUES(@serverId, @databaseId, @databaseName, @procName, @execCount, @totalCpuMs, @avgCpuMs, @totalLogicalReads, @capturedAt)`,
            {
              serverId, databaseId, databaseName: db.databaseName,
              procName: proc.procName, execCount: proc.execCount,
              totalCpuMs: proc.totalCpuMs, avgCpuMs: proc.avgCpuMs,
              totalLogicalReads: proc.totalLogicalReads, capturedAt: now
            }
          );
        }

        // Replace index stats
        await query(`DELETE FROM DatabaseIndexStats WHERE DatabaseId = @databaseId`, { databaseId });
        for (const idx of db.fragIndexes) {
          await query(
            `INSERT INTO DatabaseIndexStats(ServerId, DatabaseId, DatabaseName, TableName, IndexName, IndexType, FragmentationPct, UserSeeks, UserScans, UserUpdates, PageCount, CapturedAt)
             VALUES(@serverId, @databaseId, @databaseName, @tableName, @indexName, @indexType, @fragPct, @seeks, @scans, @updates, @pageCount, @capturedAt)`,
            {
              serverId, databaseId, databaseName: db.databaseName,
              tableName: idx.tableName, indexName: idx.indexName,
              indexType: idx.indexType, fragPct: idx.fragPct,
              seeks: idx.seeks, scans: idx.scans,
              updates: idx.updates, pageCount: idx.pageCount, capturedAt: now
            }
          );
        }
      }
    }

    res.status(201).json({ data: { processed: databases.length } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/backup-failures", async (req, res, next) => {
  const parsed = backupFailureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    let inserted = 0;
    for (const item of parsed.data) {
      await query(
        `INSERT INTO BackupFailures (ServerId, DatabaseName, BackupStartDate, BackupFinishDate, BackupType, ErrorMessage, BackupSize)
         VALUES (@serverId, @databaseName, @backupStartDate, @backupFinishDate, @backupType, @errorMessage, @backupSize)`,
        {
          serverId: item.serverId,
          databaseName: item.databaseName,
          backupStartDate: item.backupStartDate,
          backupFinishDate: item.backupFinishDate ?? null,
          backupType: item.backupType ?? null,
          errorMessage: item.errorMessage ?? null,
          backupSize: item.backupSize ?? null
        }
      );
      inserted += 1;
    }

    res.status(201).json({ data: { inserted } });
  } catch (error) {
    next(error);
  }
});

collectorRouter.post("/agent-jobs", async (req, res, next) => {
  const parsed = agentJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload" });
    return;
  }

  try {
    let inserted = 0;
    for (const item of parsed.data) {
      await query(
        `MERGE AgentJobs AS target
         USING (SELECT @serverId AS ServerId, @jobId AS SqlAgentJobId) AS source
         ON target.ServerId = source.ServerId AND target.SqlAgentJobId = source.SqlAgentJobId
         WHEN MATCHED THEN
           UPDATE SET
             JobName = @jobName,
             LastRunDate = @lastRunDate,
             LastRunStatus = @lastRunStatus,
             LastRunDuration = @lastRunDuration,
             IsEnabled = @isEnabled,
             NextRunDate = @nextRunDate,
             UpdatedDate = GETUTCDATE()
         WHEN NOT MATCHED THEN
           INSERT (ServerId, SqlAgentJobId, JobName, LastRunDate, LastRunStatus, LastRunDuration, IsEnabled, NextRunDate)
           VALUES (@serverId, @jobId, @jobName, @lastRunDate, @lastRunStatus, @lastRunDuration, @isEnabled, @nextRunDate);`,
        {
          serverId: item.serverId,
          jobId: item.jobId,
          jobName: item.jobName,
          lastRunDate: item.lastRunDate ?? null,
          lastRunStatus: item.lastRunStatus ?? null,
          lastRunDuration: item.lastRunDuration ?? null,
          isEnabled: item.isEnabled,
          nextRunDate: item.nextRunDate ?? null
        }
      );
      inserted += 1;
    }

    res.status(201).json({ data: { inserted } });
  } catch (error) {
    next(error);
  }
});
