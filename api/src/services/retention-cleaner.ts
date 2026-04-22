import cron from "node-cron";
import { env } from "../config/env.js";
import { query } from "../db/sql.js";
import { finishJobRun, startJobRun, type JobRunType } from "./operations-history.js";

type CleanupResult = {
  table: string;
  deleted: number;
};

async function deleteRows(statement: string, params: Record<string, unknown>, table: string): Promise<CleanupResult> {
  const rows = await query<{ DeletedCount: number }>(statement, params);
  return { table, deleted: Number(rows[0]?.DeletedCount ?? 0) };
}

export async function runRetentionCleanupNow(runType: JobRunType = "manual"): Promise<CleanupResult[]> {
  const { runId } = await startJobRun("retention-cleanup", runType);
  try {
    const days = env.RETENTION_DAYS_MONITORING;
    const params = { days };

    const results: CleanupResult[] = [];

    results.push(
      await deleteRows(
        `DELETE FROM dbo.Metrics
         WHERE [Timestamp] < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "Metrics"
      )
    );

    results.push(
      await deleteRows(
        `DELETE FROM dbo.BlockingSessions
         WHERE CapturedAt < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "BlockingSessions"
      )
    );

    results.push(
      await deleteRows(
        `DELETE FROM dbo.LogEvents
         WHERE EventTime < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "LogEvents"
      )
    );

    results.push(
      await deleteRows(
        `DELETE FROM dbo.DBCCResults
         WHERE RunDate < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "DBCCResults"
      )
    );

    results.push(
      await deleteRows(
        `DELETE FROM dbo.Notifications
         WHERE CreatedDate < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "Notifications"
      )
    );

    results.push(
      await deleteRows(
        `DELETE FROM dbo.BackupFailures
         WHERE DetectedAt < DATEADD(DAY, -@days, GETUTCDATE());
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "BackupFailures"
      )
    );

    results.push(
      await deleteRows(
        `DELETE FROM dbo.Alerts
         WHERE TriggeredAt < DATEADD(DAY, -@days, GETUTCDATE())
           AND Status IN ('resolved', 'acknowledged', 'dispatched', 'suppressed');
         SELECT @@ROWCOUNT AS DeletedCount;`,
        params,
        "Alerts"
      )
    );

    const summary = `retention_days=${days}; ` + results.map((row) => `${row.table}:${row.deleted}`).join(", ");
    await finishJobRun(runId, "success", summary);
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJobRun(runId, "failed", message);
    throw error;
  }
}

export function startRetentionCleaner(): void {
  // Daily at 02:10 UTC
  cron.schedule("10 2 * * *", async () => {
    try {
      const results = await runRetentionCleanupNow("scheduled");
      const summary = results.map((row) => `${row.table}:${row.deleted}`).join(", ");
      console.log(`[retention] Cleanup complete (days=${env.RETENTION_DAYS_MONITORING}) ${summary}`);
    } catch (error) {
      console.error("[retention] Cleanup failed", error);
    }
  });

  console.log(`[retention] Scheduler enabled (daily 02:10 UTC, retention ${env.RETENTION_DAYS_MONITORING} days)`);
}
