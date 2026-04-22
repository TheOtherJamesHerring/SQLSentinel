import { runQuery, runQueryOnDatabase } from "./sqlConnection.js";

export async function collectDatabaseHealth() {
  try {
    return await runQuery<{
    DatabaseName: string;
    DatabaseStatus: string;
    RecoveryModel: string;
    CompatibilityLevel: number;
    DataSizeMb: number;
    LogSizeMb: number;
    LogUsedPercent: number;
    LastFullBackup: string | null;
    LastDiffBackup: string | null;
    LastLogBackup: string | null;
    FullBackupName: string | null;
    DiffBackupName: string | null;
    LogBackupName: string | null;
    FullHeaderFileOnly: number | null;
    DiffHeaderFileOnly: number | null;
    LogHeaderFileOnly: number | null;
    FullBackupLocation: string | null;
    DiffBackupLocation: string | null;
    LogBackupLocation: string | null;
    BackupStatus: string;
    }>(`
    SELECT
      d.name AS DatabaseName,
      d.state_desc AS DatabaseStatus,
      d.recovery_model_desc AS RecoveryModel,
      d.compatibility_level AS CompatibilityLevel,
      CAST(SUM(CASE WHEN mf.type_desc = 'ROWS' THEN mf.size END) * 8.0 / 1024 AS DECIMAL(18,2)) AS DataSizeMb,
      CAST(SUM(CASE WHEN mf.type_desc = 'LOG' THEN mf.size END) * 8.0 / 1024 AS DECIMAL(18,2)) AS LogSizeMb,
      CAST(0 AS DECIMAL(5,2)) AS LogUsedPercent,
      MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date END) AS LastFullBackup,
      MAX(CASE WHEN bs.type = 'I' THEN bs.backup_finish_date END) AS LastDiffBackup,
      MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date END) AS LastLogBackup,
      (
        SELECT TOP 1 bsd.name
        FROM msdb.dbo.backupset bsd
        WHERE bsd.database_name = d.name AND bsd.type = 'D'
        ORDER BY bsd.backup_finish_date DESC
      ) AS FullBackupName,
      (
        SELECT TOP 1 bsi.name
        FROM msdb.dbo.backupset bsi
        WHERE bsi.database_name = d.name AND bsi.type = 'I'
        ORDER BY bsi.backup_finish_date DESC
      ) AS DiffBackupName,
      (
        SELECT TOP 1 bsl.name
        FROM msdb.dbo.backupset bsl
        WHERE bsl.database_name = d.name AND bsl.type = 'L'
        ORDER BY bsl.backup_finish_date DESC
      ) AS LogBackupName,
      (
        SELECT TOP 1 CAST(bsd.is_copy_only AS INT)
        FROM msdb.dbo.backupset bsd
        WHERE bsd.database_name = d.name AND bsd.type = 'D'
        ORDER BY bsd.backup_finish_date DESC
      ) AS FullHeaderFileOnly,
      (
        SELECT TOP 1 CAST(bsi.is_copy_only AS INT)
        FROM msdb.dbo.backupset bsi
        WHERE bsi.database_name = d.name AND bsi.type = 'I'
        ORDER BY bsi.backup_finish_date DESC
      ) AS DiffHeaderFileOnly,
      (
        SELECT TOP 1 CAST(bsl.is_copy_only AS INT)
        FROM msdb.dbo.backupset bsl
        WHERE bsl.database_name = d.name AND bsl.type = 'L'
        ORDER BY bsl.backup_finish_date DESC
      ) AS LogHeaderFileOnly,
      (
        SELECT TOP 1 bmf.physical_device_name
        FROM msdb.dbo.backupset bsd
        JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bsd.media_set_id
        WHERE bsd.database_name = d.name AND bsd.type = 'D'
        ORDER BY bsd.backup_finish_date DESC
      ) AS FullBackupLocation,
      (
        SELECT TOP 1 bmf.physical_device_name
        FROM msdb.dbo.backupset bsi
        JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bsi.media_set_id
        WHERE bsi.database_name = d.name AND bsi.type = 'I'
        ORDER BY bsi.backup_finish_date DESC
      ) AS DiffBackupLocation,
      (
        SELECT TOP 1 bmf.physical_device_name
        FROM msdb.dbo.backupset bsl
        JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bsl.media_set_id
        WHERE bsl.database_name = d.name AND bsl.type = 'L'
        ORDER BY bsl.backup_finish_date DESC
      ) AS LogBackupLocation,
      CASE
        WHEN d.name = 'tempdb' THEN 'n/a'
        WHEN MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date END) IS NULL THEN 'critical'
        WHEN DATEDIFF(HOUR, MAX(CASE WHEN bs.type = 'D' THEN bs.backup_finish_date END), GETDATE()) > 48 THEN 'critical'
        WHEN d.recovery_model_desc IN ('FULL', 'BULK_LOGGED')
          AND (
            MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date END) IS NULL
            OR DATEDIFF(HOUR, MAX(CASE WHEN bs.type = 'L' THEN bs.backup_finish_date END), GETDATE()) > 6
          ) THEN 'warning'
        ELSE 'healthy'
      END AS BackupStatus
    FROM sys.databases d
    JOIN sys.master_files mf ON d.database_id = mf.database_id
    LEFT JOIN msdb.dbo.backupset bs ON bs.database_name = d.name
    GROUP BY d.name, d.state_desc, d.recovery_model_desc, d.compatibility_level;
    `);
  } catch {
    // Azure SQL Database fallback: collect current-database posture without msdb dependencies.
    return runQuery<{
      DatabaseName: string;
      DatabaseStatus: string;
      RecoveryModel: string;
      CompatibilityLevel: number;
      DataSizeMb: number;
      LogSizeMb: number;
      LogUsedPercent: number;
      LastFullBackup: string | null;
      LastDiffBackup: string | null;
      LastLogBackup: string | null;
      FullBackupName: string | null;
      DiffBackupName: string | null;
      LogBackupName: string | null;
      FullHeaderFileOnly: number | null;
      DiffHeaderFileOnly: number | null;
      LogHeaderFileOnly: number | null;
      FullBackupLocation: string | null;
      DiffBackupLocation: string | null;
      LogBackupLocation: string | null;
      BackupStatus: string;
    }>(`
      SELECT
        DB_NAME() AS DatabaseName,
        CAST(DATABASEPROPERTYEX(DB_NAME(), 'Status') AS NVARCHAR(60)) AS DatabaseStatus,
        CAST(DATABASEPROPERTYEX(DB_NAME(), 'Recovery') AS NVARCHAR(60)) AS RecoveryModel,
        d.compatibility_level AS CompatibilityLevel,
        CAST(SUM(CASE WHEN df.type_desc = 'ROWS' THEN df.size END) * 8.0 / 1024 AS DECIMAL(18,2)) AS DataSizeMb,
        CAST(SUM(CASE WHEN df.type_desc = 'LOG' THEN df.size END) * 8.0 / 1024 AS DECIMAL(18,2)) AS LogSizeMb,
        CAST(ISNULL(lsu.used_log_space_in_percent, 0) AS DECIMAL(5,2)) AS LogUsedPercent,
        CAST(NULL AS DATETIME2) AS LastFullBackup,
        CAST(NULL AS DATETIME2) AS LastDiffBackup,
        CAST(NULL AS DATETIME2) AS LastLogBackup,
        CAST(NULL AS NVARCHAR(256)) AS FullBackupName,
        CAST(NULL AS NVARCHAR(256)) AS DiffBackupName,
        CAST(NULL AS NVARCHAR(256)) AS LogBackupName,
        CAST(NULL AS INT) AS FullHeaderFileOnly,
        CAST(NULL AS INT) AS DiffHeaderFileOnly,
        CAST(NULL AS INT) AS LogHeaderFileOnly,
        CAST(NULL AS NVARCHAR(1024)) AS FullBackupLocation,
        CAST(NULL AS NVARCHAR(1024)) AS DiffBackupLocation,
        CAST(NULL AS NVARCHAR(1024)) AS LogBackupLocation,
        CAST('unknown' AS NVARCHAR(20)) AS BackupStatus
      FROM sys.database_files df
      JOIN sys.databases d ON d.name = DB_NAME()
      OUTER APPLY (SELECT used_log_space_in_percent FROM sys.dm_db_log_space_usage) lsu
      GROUP BY d.compatibility_level, lsu.used_log_space_in_percent;
    `).catch(() => []);
  }
}

export async function collectQueryStoreEnabledDatabases(): Promise<string[]> {
  const rows = await runQuery<{ name: string }>(`
    SELECT name
    FROM sys.databases
    WHERE is_query_store_on = 1
      AND state_desc = 'ONLINE'
      AND HAS_DBACCESS(name) = 1
      AND name NOT IN ('master','tempdb','model','msdb')
  `);
  return rows.map((row) => row.name);
}

export interface QueryStoreRegressedRow {
  QueryId: number;
  QueryText: string;
  RecentAvgMs: number;
  HistoricAvgMs: number;
  RegressionRatio: number | null;
  RecentExecCount: number;
  HistoricExecCount: number;
  AvgLogicalReads: number;
}

export async function collectQueryStoreRegressed(dbName: string): Promise<QueryStoreRegressedRow[]> {
  return runQueryOnDatabase<QueryStoreRegressedRow>(dbName, `
    WITH RecentPeriod AS (
      SELECT
        q.query_id,
        qst.query_sql_text,
        AVG(CAST(rs.avg_duration AS FLOAT)) / 1000.0 AS recent_avg_ms,
        SUM(rs.count_executions) AS recent_exec_count,
        AVG(CAST(rs.avg_logical_io_reads AS FLOAT)) AS avg_logical_reads
      FROM sys.query_store_query q
      JOIN sys.query_store_query_text qst ON q.query_text_id = qst.query_text_id
      JOIN sys.query_store_plan p ON q.query_id = p.query_id
      JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
      JOIN sys.query_store_runtime_stats_interval rsi ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
      WHERE rsi.start_time >= DATEADD(HOUR, -2, GETUTCDATE())
      GROUP BY q.query_id, qst.query_sql_text
    ),
    HistoricPeriod AS (
      SELECT
        q.query_id,
        AVG(CAST(rs.avg_duration AS FLOAT)) / 1000.0 AS historic_avg_ms,
        SUM(rs.count_executions) AS historic_exec_count
      FROM sys.query_store_query q
      JOIN sys.query_store_plan p ON q.query_id = p.query_id
      JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
      JOIN sys.query_store_runtime_stats_interval rsi ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
      WHERE rsi.start_time >= DATEADD(HOUR, -24, GETUTCDATE())
        AND rsi.start_time < DATEADD(HOUR, -2, GETUTCDATE())
      GROUP BY q.query_id
    )
    SELECT TOP 10
      r.query_id AS QueryId,
      LEFT(r.query_sql_text, 2000) AS QueryText,
      CAST(r.recent_avg_ms AS DECIMAL(18,4)) AS RecentAvgMs,
      CAST(COALESCE(h.historic_avg_ms, 0) AS DECIMAL(18,4)) AS HistoricAvgMs,
      CAST(
        CASE
          WHEN COALESCE(h.historic_avg_ms, 0) > 0 THEN r.recent_avg_ms / h.historic_avg_ms
          ELSE NULL
        END AS DECIMAL(10,4)
      ) AS RegressionRatio,
      r.recent_exec_count AS RecentExecCount,
      COALESCE(h.historic_exec_count, 0) AS HistoricExecCount,
      CAST(r.avg_logical_reads AS DECIMAL(18,2)) AS AvgLogicalReads
    FROM RecentPeriod r
    LEFT JOIN HistoricPeriod h ON r.query_id = h.query_id
    WHERE r.recent_exec_count >= 2
      AND r.recent_avg_ms > 5
    ORDER BY
      CASE
        WHEN COALESCE(h.historic_avg_ms, 0) > 0 THEN r.recent_avg_ms / h.historic_avg_ms
        ELSE r.recent_avg_ms
      END DESC;
  `);
}

export interface BackupFailureRow {
  DatabaseName: string;
  BackupStartDate: string;
  BackupFinishDate: string | null;
  BackupType: string;
  ErrorMessage: string | null;
  BackupSize: number | null;
}

export async function collectBackupFailures(): Promise<BackupFailureRow[]> {
  return runQuery<BackupFailureRow>(`
    IF OBJECT_ID('msdb.dbo.backupset', 'U') IS NULL
    BEGIN
      SELECT TOP 0
        CAST('' AS NVARCHAR(128)) AS DatabaseName,
        CAST(NULL AS DATETIME2) AS BackupStartDate,
        CAST(NULL AS DATETIME2) AS BackupFinishDate,
        CAST('' AS NVARCHAR(10)) AS BackupType,
        CAST(NULL AS NVARCHAR(MAX)) AS ErrorMessage,
        CAST(NULL AS BIGINT) AS BackupSize;
    END
    ELSE
    BEGIN
      SELECT TOP 50
        bs.database_name AS DatabaseName,
        bs.backup_start_date AS BackupStartDate,
        bs.backup_finish_date AS BackupFinishDate,
        bs.type AS BackupType,
        CASE
          WHEN bs.is_damaged = 1 THEN 'Backup marked damaged in backupset'
          WHEN bs.backup_finish_date IS NULL THEN 'Backup did not complete'
          ELSE NULL
        END AS ErrorMessage,
        bs.backup_size AS BackupSize
      FROM msdb.dbo.backupset bs
      WHERE bs.backup_start_date > DATEADD(DAY, -1, GETDATE())
        AND (bs.is_damaged = 1 OR bs.backup_finish_date IS NULL)
      ORDER BY bs.backup_start_date DESC;
    END
  `).catch(() => []);
}

export interface AgentJobRow {
  JobId: string;
  JobName: string;
  LastRunDate: string | null;
  LastRunStatus: number | null;
  LastRunDuration: number | null;
  IsEnabled: number;
  NextRunDate: string | null;
}

export async function collectAgentJobs(): Promise<AgentJobRow[]> {
  return runQuery<AgentJobRow>(`
    SELECT TOP 100
      CONVERT(varchar(36), j.job_id) AS JobId,
      j.name AS JobName,
      NULL AS LastRunDate,
      NULL AS LastRunStatus,
      NULL AS LastRunDuration,
      j.enabled AS IsEnabled,
      NULL AS NextRunDate
    FROM msdb.dbo.sysjobs j
    ORDER BY j.name ASC;
  `).catch(() => []);
}

export interface SchemaObjectCounts {
  TableCount: number;
  ViewCount: number;
  ProcCount: number;
  FunctionCount: number;
  IndexCount: number;
}

export interface ProcStatRow {
  ProcName: string;
  ExecutionCount: number;
  TotalCpuMs: number;
  AvgCpuMs: number;
  TotalLogicalReads: number;
}

export interface IndexStatRow {
  TableName: string;
  IndexName: string;
  IndexType: string;
  FragmentationPct: number;
  UserSeeks: number;
  UserScans: number;
  UserUpdates: number;
  PageCount: number;
}

export async function collectDatabaseSchemaObjects(dbName: string): Promise<{
  counts: SchemaObjectCounts;
  topProcs: ProcStatRow[];
  fragIndexes: IndexStatRow[];
}> {
  const [counts] = await runQueryOnDatabase<SchemaObjectCounts>(dbName, `
    SELECT
      SUM(CASE WHEN type = 'U' THEN 1 ELSE 0 END) AS TableCount,
      SUM(CASE WHEN type = 'V' THEN 1 ELSE 0 END) AS ViewCount,
      SUM(CASE WHEN type IN ('P', 'PC') THEN 1 ELSE 0 END) AS ProcCount,
      SUM(CASE WHEN type IN ('FN', 'IF', 'TF', 'AF') THEN 1 ELSE 0 END) AS FunctionCount,
      (SELECT COUNT(*) FROM sys.indexes WHERE type > 0 AND OBJECTPROPERTY(object_id, 'IsUserTable') = 1) AS IndexCount
    FROM sys.objects
    WHERE is_ms_shipped = 0
  `);

  // DMV access can be restricted; treat proc and index stats as optional so counts still flow.
  let topProcs: ProcStatRow[] = [];
  try {
    topProcs = await runQueryOnDatabase<ProcStatRow>(dbName, `
      SELECT TOP 10
        OBJECT_NAME(object_id) AS ProcName,
        execution_count AS ExecutionCount,
        CAST(total_worker_time / 1000.0 AS DECIMAL(18,2)) AS TotalCpuMs,
        CAST(total_worker_time / NULLIF(execution_count, 0) / 1000.0 AS DECIMAL(18,4)) AS AvgCpuMs,
        total_logical_reads AS TotalLogicalReads
      FROM sys.dm_exec_procedure_stats
      WHERE database_id = DB_ID()
      ORDER BY execution_count DESC
    `);
  } catch {
    topProcs = [];
  }

  let fragIndexes: IndexStatRow[] = [];
  try {
    fragIndexes = await runQueryOnDatabase<IndexStatRow>(dbName, `
      SELECT TOP 15
        OBJECT_NAME(i.object_id) AS TableName,
        ISNULL(i.name, 'HEAP') AS IndexName,
        i.type_desc AS IndexType,
        CAST(s.avg_fragmentation_in_percent AS DECIMAL(5,1)) AS FragmentationPct,
        ISNULL(ius.user_seeks, 0) AS UserSeeks,
        ISNULL(ius.user_scans, 0) AS UserScans,
        ISNULL(ius.user_updates, 0) AS UserUpdates,
        CAST(s.page_count AS INT) AS PageCount
      FROM sys.indexes i
      JOIN sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') s
        ON s.object_id = i.object_id AND s.index_id = i.index_id
      LEFT JOIN sys.dm_db_index_usage_stats ius
        ON ius.object_id = i.object_id AND ius.index_id = i.index_id
        AND ius.database_id = DB_ID()
      WHERE i.type > 0
        AND s.page_count >= 100
        AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
      ORDER BY s.avg_fragmentation_in_percent DESC
    `);
  } catch {
    fragIndexes = [];
  }

  return {
    counts: counts ?? { TableCount: 0, ViewCount: 0, ProcCount: 0, FunctionCount: 0, IndexCount: 0 },
    topProcs,
    fragIndexes
  };
}

export async function collectBufferCacheHitRatio(): Promise<number> {
  const [row] = await runQuery<{ ratio: number }>(`
    SELECT CAST(
      CASE WHEN b.cntr_value > 0
        THEN a.cntr_value * 100.0 / b.cntr_value
        ELSE 0
      END AS DECIMAL(5,1)) AS ratio
    FROM sys.dm_os_performance_counters a
    JOIN sys.dm_os_performance_counters b
      ON b.object_name = a.object_name
      AND b.counter_name = 'Buffer cache hit ratio base'
    WHERE a.counter_name = 'Buffer cache hit ratio'
      AND a.object_name LIKE '%Buffer Manager%'
  `);
  return row?.ratio ?? 0;
}
