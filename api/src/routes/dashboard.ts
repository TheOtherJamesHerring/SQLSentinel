import { Router } from "express";
import { query } from "../db/sql.js";
import { requireAuth } from "../middleware/auth.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", async (_req, res, next) => {
  try {
    const [row] = await query<{
      totalServers: number;
      online: number;
      offline: number;
      criticalAlerts: number;
      blockedProcesses: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM Servers) AS totalServers,
        (SELECT COUNT(*) FROM Servers WHERE Status = 'online') AS online,
        (SELECT COUNT(*) FROM Servers WHERE Status = 'offline') AS offline,
        (SELECT COUNT(*) FROM Alerts WHERE Severity = 'critical' AND Status IN ('new','acknowledged')) AS criticalAlerts,
        (SELECT ISNULL(SUM(BlockedProcesses), 0) FROM Servers) AS blockedProcesses
    `);
    res.json({ data: row });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/metrics/recent", async (_req, res, next) => {
  try {
    const rows = await query(`
      SELECT s.ServerId, s.Name, s.Status, s.CpuUsage, s.MemoryUsage, s.DiskUsage, s.LastCheck
      FROM Servers s
      ORDER BY s.Name
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/alerts/recent", async (_req, res, next) => {
  try {
    const rows = await query(`
      SELECT TOP 10
        a.AlertId,
        a.ServerId,
        a.DatabaseId,
        s.Name AS ServerName,
        d.Name AS DatabaseName,
        a.AlertType,
        a.Severity,
        a.Status,
        a.Title,
        a.Message,
        a.TriggeredAt
      FROM Alerts a
      LEFT JOIN Servers s ON s.ServerId = a.ServerId
      LEFT JOIN Databases d ON d.DatabaseId = a.DatabaseId
      ORDER BY TriggeredAt DESC
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/hotspots", async (_req, res, next) => {
  try {
    const topBlockedDatabases = await query(`
      SELECT TOP 8
        b.ServerId,
        s.Name AS ServerName,
        b.DatabaseName,
        MIN(d.DatabaseId) AS DatabaseId,
        COUNT(*) AS BlockedSamples,
        MAX(ISNULL(b.WaitTimeMs, 0)) AS MaxWaitMs,
        AVG(CAST(ISNULL(b.WaitTimeMs, 0) AS FLOAT)) AS AvgWaitMs
      FROM BlockingSessions b
      LEFT JOIN Servers s ON s.ServerId = b.ServerId
      LEFT JOIN Databases d ON d.ServerId = b.ServerId AND d.Name = b.DatabaseName
      WHERE b.CapturedAt >= DATEADD(HOUR, -6, GETUTCDATE())
        AND b.DatabaseName IS NOT NULL
      GROUP BY b.ServerId, s.Name, b.DatabaseName
      ORDER BY COUNT(*) DESC, MAX(ISNULL(b.WaitTimeMs, 0)) DESC
    `);

    const waitTypeBreakdown = await query(`
      SELECT TOP 8
        ISNULL(WaitType, 'unknown') AS WaitType,
        COUNT(*) AS Samples,
        MAX(ISNULL(WaitTimeMs, 0)) AS MaxWaitMs
      FROM BlockingSessions
      WHERE CapturedAt >= DATEADD(HOUR, -6, GETUTCDATE())
      GROUP BY ISNULL(WaitType, 'unknown')
      ORDER BY COUNT(*) DESC, MAX(ISNULL(WaitTimeMs, 0)) DESC
    `);

    const diskPressure = await query(`
      SELECT TOP 8
        dv.ServerId,
        s.Name AS ServerName,
        dv.VolumeName,
        dv.UsedPercent,
        dv.FreeSpaceGb,
        dv.Status,
        dv.LastCheck
      FROM DiskVolumes dv
      JOIN Servers s ON s.ServerId = dv.ServerId
      ORDER BY ISNULL(dv.UsedPercent, 0) DESC
    `);

    const tempdbPressure = await query(`
      WITH latest AS (
        SELECT
          m.ServerId,
          m.Value,
          m.Timestamp,
          ROW_NUMBER() OVER (PARTITION BY m.ServerId ORDER BY m.Timestamp DESC) AS rn
        FROM Metrics m
        WHERE m.MetricType = 'tempdb'
          AND m.MetricName = 'tempdb_used_percent'
      )
      SELECT TOP 8
        l.ServerId,
        s.Name AS ServerName,
        l.Value AS TempdbUsedPercent,
        l.Timestamp
      FROM latest l
      JOIN Servers s ON s.ServerId = l.ServerId
      WHERE l.rn = 1
      ORDER BY ISNULL(l.Value, 0) DESC
    `);

    res.json({
      data: {
        topBlockedDatabases,
        waitTypeBreakdown,
        diskPressure,
        tempdbPressure
      }
    });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/continuity", async (_req, res, next) => {
  try {
    const [summary] = await query<{
      totalDatabases: number;
      backupCritical: number;
      backupWarning: number;
      loginFailures24h: number;
      lastFullBackupAt: string | null;
      lastLogBackupAt: string | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM Databases) AS totalDatabases,
        (SELECT COUNT(*) FROM Databases WHERE BackupStatus = 'critical') AS backupCritical,
        (SELECT COUNT(*) FROM Databases WHERE BackupStatus = 'warning') AS backupWarning,
        (
          SELECT COUNT(*)
          FROM LogEvents
          WHERE EventTime >= DATEADD(HOUR, -24, GETUTCDATE())
            AND (Message LIKE '%Error: 18456%' OR Category = 'Logon')
        ) AS loginFailures24h,
        (SELECT MAX(LastFullBackup) FROM Databases) AS lastFullBackupAt,
        (SELECT MAX(LastLogBackup) FROM Databases) AS lastLogBackupAt
    `);

    const backupGaps = await query(`
      SELECT TOP 12
        d.DatabaseId,
        d.ServerId,
        s.Name AS ServerName,
        d.Name,
        d.RecoveryModel,
        d.BackupStatus,
        d.LastFullBackup,
        d.LastLogBackup
      FROM Databases d
      LEFT JOIN Servers s ON s.ServerId = d.ServerId
      WHERE d.BackupStatus IN ('critical', 'warning')
      ORDER BY
        CASE d.BackupStatus WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        d.LastFullBackup ASC
    `);

    const loginFailureSamples = await query(`
      SELECT TOP 20
        LogEventId,
        ServerId,
        EventTime,
        Severity,
        Source,
        Category,
        Message
      FROM LogEvents
      WHERE EventTime >= DATEADD(HOUR, -24, GETUTCDATE())
        AND (Message LIKE '%Error: 18456%' OR Category = 'Logon')
      ORDER BY EventTime DESC
    `);

    res.json({
      data: {
        summary,
        backupGaps,
        loginFailureSamples
      }
    });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/ingestion/heartbeat", async (_req, res, next) => {
  try {
    const [row] = await query<{
      totalServers: number;
      staleServers: number;
      lastHeartbeatAt: string | null;
      lastMetricAt: string | null;
      lastEventAt: string | null;
      lastBlockingAt: string | null;
      lastIngestionAt: string | null;
    }>(`
      WITH agg AS (
        SELECT
          (SELECT COUNT(*) FROM Servers) AS totalServers,
          (SELECT COUNT(*) FROM Servers WHERE LastCheck IS NULL OR LastCheck < DATEADD(MINUTE, -3, GETUTCDATE())) AS staleServers,
          (SELECT MAX(LastCheck) FROM Servers) AS lastHeartbeatAt,
          (SELECT MAX([Timestamp]) FROM Metrics) AS lastMetricAt,
          (SELECT MAX(EventTime) FROM LogEvents) AS lastEventAt,
          (SELECT MAX(CapturedAt) FROM BlockingSessions) AS lastBlockingAt
      )
      SELECT
        totalServers,
        staleServers,
        lastHeartbeatAt,
        lastMetricAt,
        lastEventAt,
        lastBlockingAt,
        (
          SELECT MAX(dt)
          FROM (VALUES (lastHeartbeatAt), (lastMetricAt), (lastEventAt), (lastBlockingAt)) AS candidate(dt)
        ) AS lastIngestionAt
      FROM agg
    `);

    res.json({ data: row });
  } catch (error) {
    next(error);
  }
});
