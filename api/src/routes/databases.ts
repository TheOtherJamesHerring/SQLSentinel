import { Router } from "express";
import { z } from "zod";
import { query } from "../db/sql.js";
import { requireAuth } from "../middleware/auth.js";

export const databasesRouter = Router();
databasesRouter.use(requireAuth);

databasesRouter.get("/:id", async (req, res, next) => {
  try {
    const [db] = await query(`SELECT * FROM Databases WHERE DatabaseId = @id`, { id: req.params.id });
    if (!db) {
      res.status(404).json({ message: "Database not found" });
      return;
    }
    res.json({ data: db });
  } catch (error) {
    next(error);
  }
});

databasesRouter.get("/:id/metrics", async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT Timestamp, MetricType, MetricName, Value, Unit
      FROM Metrics
      WHERE DatabaseId = @id
      ORDER BY Timestamp ASC
    `, { id: req.params.id });
    res.json({ data: rows });

  // ── Ad-hoc DBA jobs ─────────────────────────────────────────────────────────

  async function ensureAdHocJobsTable() {
    await query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='AdHocJobs' AND schema_id=SCHEMA_ID('dbo'))
      BEGIN
        CREATE TABLE dbo.AdHocJobs (
          JobId         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
          ServerId      UNIQUEIDENTIFIER NOT NULL,
          DatabaseId    UNIQUEIDENTIFIER NULL,
          DatabaseName  NVARCHAR(128)    NULL,
          JobType       NVARCHAR(64)     NOT NULL,
          Params        NVARCHAR(MAX)    NULL,
          Status        NVARCHAR(32)     NOT NULL DEFAULT 'pending',
          RequestedBy   NVARCHAR(128)    NULL,
          CreatedAt     DATETIME2(3)     NOT NULL DEFAULT SYSUTCDATETIME(),
          StartedAt     DATETIME2(3)     NULL,
          CompletedAt   DATETIME2(3)     NULL,
          DurationMs    INT              NULL,
          ResultSummary NVARCHAR(MAX)    NULL,
          CONSTRAINT PK_AdHocJobs PRIMARY KEY (JobId),
          CONSTRAINT FK_AdHocJobs_Server FOREIGN KEY (ServerId)
            REFERENCES dbo.Servers(ServerId) ON DELETE CASCADE
        );
        CREATE INDEX IX_AdHocJobs_Server_Status
          ON dbo.AdHocJobs (ServerId, Status, CreatedAt DESC);
      END
    `, {});
  }

  const createJobSchema = z.object({
    jobType: z.enum(["backup", "dbcc_checkdb", "sql_query"]),
    params: z.record(z.string(), z.unknown()).optional()
  });

  databasesRouter.get("/:id/adhoc-jobs", async (req, res, next) => {
    try {
      await ensureAdHocJobsTable();
      const rows = await query(`
        SELECT TOP 30
          JobId, ServerId, DatabaseName, JobType, Params, Status,
          RequestedBy, CreatedAt, StartedAt, CompletedAt, DurationMs, ResultSummary
        FROM dbo.AdHocJobs
        WHERE DatabaseId = @id
        ORDER BY CreatedAt DESC
      `, { id: req.params.id });
      res.json({ data: rows });
    } catch (error) {
      next(error);
    }
  });

  databasesRouter.post("/:id/adhoc-jobs", async (req, res, next) => {
    try {
      const parsed = createJobSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid job payload", errors: parsed.error.flatten() });
        return;
      }
      const { jobType, params } = parsed.data;
      const requestedBy = req.user?.name ?? req.user?.sub ?? "unknown";

      const [db] = await query<{ ServerId: string; Name: string }>(
        `SELECT ServerId, Name FROM Databases WHERE DatabaseId = @id`, { id: req.params.id }
      );
      if (!db) {
        res.status(404).json({ message: "Database not found" });
        return;
      }

      await ensureAdHocJobsTable();
      const [inserted] = await query<{ JobId: string }>(`
        INSERT INTO dbo.AdHocJobs (ServerId, DatabaseId, DatabaseName, JobType, Params, RequestedBy)
        OUTPUT INSERTED.JobId
        VALUES (@serverId, @dbId, @dbName, @jobType, @params, @requestedBy)
      `, {
        serverId: db.ServerId,
        dbId: req.params.id,
        dbName: db.Name,
        jobType,
        params: params ? JSON.stringify(params) : null,
        requestedBy
      });

      res.status(201).json({ data: inserted });
    } catch (error) {
      next(error);
    }
  });

  databasesRouter.patch("/:id/adhoc-jobs/:jobId/cancel", async (req, res, next) => {
    try {
      await ensureAdHocJobsTable();
      await query(`
        UPDATE dbo.AdHocJobs
        SET Status = 'cancelled', CompletedAt = SYSUTCDATETIME()
        WHERE JobId = @jobId AND DatabaseId = @dbId AND Status = 'pending'
      `, { jobId: req.params.jobId, dbId: req.params.id });
      res.json({ data: { ok: true } });
    } catch (error) {
      next(error);
    }
  });
  } catch (error) {
    next(error);
  }
});

databasesRouter.get("/:id/dbcc", async (req, res, next) => {
  try {
    const rows = await query(`SELECT TOP 100 * FROM DBCCResults WHERE DatabaseId = @id ORDER BY RunDate DESC`, { id: req.params.id });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

databasesRouter.get("/:id/posture", async (req, res, next) => {
  try {
    const [db] = await query<{
      DatabaseId: string;
      ServerId: string;
      Name: string;
      Status: string;
      Health: string;
      RecoveryModel: string | null;
      CompatibilityLevel: number | null;
      DataSizeMb: number | null;
      LogSizeMb: number | null;
      LogUsedPercent: number | null;
      BackupStatus: string;
      DbccStatus: string;
      LastFullBackup: string | null;
      LastDiffBackup: string | null;
      LastLogBackup: string | null;
      LastDbccCheck: string | null;
      ServerName: string;
      Hostname: string;
    }>(`
      SELECT
        d.*,
        s.Name AS ServerName,
        s.Hostname
      FROM Databases d
      JOIN Servers s ON s.ServerId = d.ServerId
      WHERE d.DatabaseId = @id
    `, { id: req.params.id });

    if (!db) {
      res.status(404).json({ message: "Database not found" });
      return;
    }

    const blocking = await query(`
      SELECT TOP 30
        CapturedAt,
        SessionId,
        BlockingSessionId,
        WaitType,
        WaitTimeMs,
        WaitResource,
        LoginName,
        HostName,
        ProgramName,
        QueryText
      FROM BlockingSessions
      WHERE ServerId = @serverId
        AND DatabaseName = @databaseName
      ORDER BY CapturedAt DESC
    `, {
      serverId: db.ServerId,
      databaseName: db.Name
    });

    const topBlockingStatements = await query(`
      SELECT TOP 10
        QueryText,
        COUNT(*) AS hitCount,
        MAX(WaitTimeMs) AS maxWaitMs,
        AVG(CAST(WaitTimeMs AS FLOAT)) AS avgWaitMs
      FROM BlockingSessions
      WHERE ServerId = @serverId
        AND DatabaseName = @databaseName
        AND QueryText IS NOT NULL
        AND LEN(QueryText) > 0
        AND CapturedAt >= DATEADD(HOUR, -24, GETUTCDATE())
      GROUP BY QueryText
      ORDER BY COUNT(*) DESC, MAX(WaitTimeMs) DESC
    `, {
      serverId: db.ServerId,
      databaseName: db.Name
    });

    const [tempdbLatest] = await query<{
      Timestamp: string;
      TempdbUsedMb: number | null;
      TempdbVersionStoreMb: number | null;
      TempdbUsedPercent: number | null;
    }>(`
      SELECT TOP 1
        m1.Timestamp,
        m1.Value AS TempdbUsedMb,
        m2.Value AS TempdbVersionStoreMb,
        m3.Value AS TempdbUsedPercent
      FROM Metrics m1
      LEFT JOIN Metrics m2
        ON m2.ServerId = m1.ServerId
       AND m2.Timestamp = m1.Timestamp
       AND m2.MetricType = 'tempdb'
       AND m2.MetricName = 'tempdb_version_store_mb'
      LEFT JOIN Metrics m3
        ON m3.ServerId = m1.ServerId
       AND m3.Timestamp = m1.Timestamp
       AND m3.MetricType = 'tempdb'
       AND m3.MetricName = 'tempdb_used_percent'
      WHERE m1.ServerId = @serverId
        AND m1.MetricType = 'tempdb'
        AND m1.MetricName = 'tempdb_used_mb'
      ORDER BY m1.Timestamp DESC
    `, { serverId: db.ServerId });

    const diskContext = await query(`
      SELECT TOP 20
        VolumeName,
        Label,
        TotalSizeGb,
        FreeSpaceGb,
        UsedPercent,
        Status,
        ContainsDataFiles,
        ContainsLogFiles,
        LastCheck
      FROM DiskVolumes
      WHERE ServerId = @serverId
      ORDER BY UsedPercent DESC, VolumeName ASC
    `, { serverId: db.ServerId });

    const recentEvents = await query(`
      SELECT TOP 20
        EventTime,
        Severity,
        Source,
        Category,
        Message
      FROM LogEvents
      WHERE ServerId = @serverId
        AND (
          DatabaseName = @databaseName
          OR Message LIKE '%' + @databaseName + '%'
        )
      ORDER BY EventTime DESC
    `, {
      serverId: db.ServerId,
      databaseName: db.Name
    });

    // Schema object counts (latest snapshot)
    const schemaTableExists = await query<{ n: number }>(
      `SELECT COUNT(1) AS n FROM sys.tables WHERE name = 'DatabaseSchemaStats' AND schema_id = SCHEMA_ID('dbo')`, {}
    );
    const schemaStats = schemaTableExists[0]?.n
      ? (await query(`SELECT TOP 1 TableCnt, ViewCnt, ProcCnt, FuncCnt, IndexCnt, CapturedAt FROM DatabaseSchemaStats WHERE DatabaseId = @id ORDER BY CapturedAt DESC`, { id: req.params.id }))[0] ?? null
      : null;

    // Top stored procedures by execution count
    const procTableExists = await query<{ n: number }>(
      `SELECT COUNT(1) AS n FROM sys.tables WHERE name = 'DatabaseProcStats' AND schema_id = SCHEMA_ID('dbo')`, {}
    );
    const topProcs = procTableExists[0]?.n
      ? await query(`SELECT ProcName, ExecutionCount, TotalCpuMs, AvgCpuMs, TotalLogicalReads, CapturedAt FROM DatabaseProcStats WHERE DatabaseId = @id ORDER BY ExecutionCount DESC`, { id: req.params.id })
      : [];

    // Index fragmentation
    const indexTableExists = await query<{ n: number }>(
      `SELECT COUNT(1) AS n FROM sys.tables WHERE name = 'DatabaseIndexStats' AND schema_id = SCHEMA_ID('dbo')`, {}
    );
    const indexHealth = indexTableExists[0]?.n
      ? await query(`SELECT TableName, IndexName, IndexType, FragmentationPct, UserSeeks, UserScans, UserUpdates, PageCount, CapturedAt FROM DatabaseIndexStats WHERE DatabaseId = @id ORDER BY FragmentationPct DESC`, { id: req.params.id })
      : [];

    // Buffer cache hit ratio (server-level, latest)
    const [cacheMetric] = await query<{ BufferCacheHitRatio: number }>(
      `SELECT TOP 1 Value AS BufferCacheHitRatio FROM Metrics WHERE ServerId = @serverId AND MetricType = 'cache' AND MetricName = 'buffer_cache_hit_ratio' ORDER BY Timestamp DESC`,
      { serverId: db.ServerId }
    );

    res.json({
      data: {
        database: db,
        blocking,
        topBlockingStatements,
        tempdb: tempdbLatest ?? null,
        diskContext,
        recentEvents,
        schemaStats: schemaStats ?? null,
        topProcs,
        indexHealth,
        bufferCacheHitRatio: cacheMetric?.BufferCacheHitRatio ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

databasesRouter.get("/:id/query-store", async (req, res, next) => {
  try {
    // Return empty array gracefully if the table hasn't been created yet
    const tableExists = await query<{ n: number }>(`
      SELECT COUNT(1) AS n FROM sys.tables WHERE name = 'QueryStoreSnapshots' AND schema_id = SCHEMA_ID('dbo')
    `, {});
    if (!tableExists[0] || tableExists[0].n === 0) {
      res.json({ data: [] });
      return;
    }

    const rows = await query(`
      SELECT TOP 20
        QueryId,
        LEFT(QueryText, 2000) AS QueryText,
        RecentAvgMs,
        HistoricAvgMs,
        RegressionRatio,
        RecentExecCount,
        HistoricExecCount,
        AvgLogicalReads,
        CapturedAt
      FROM QueryStoreSnapshots
      WHERE DatabaseId = @id
      ORDER BY
        CASE WHEN RegressionRatio IS NOT NULL THEN RegressionRatio ELSE RecentAvgMs END DESC,
        RecentAvgMs DESC
    `, { id: req.params.id });

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});
