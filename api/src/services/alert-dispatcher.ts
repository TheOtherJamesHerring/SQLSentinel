import cron from "node-cron";
import { env } from "../config/env.js";
import { query } from "../db/sql.js";
import { dispatchAlert } from "../routes/alert-dispatch.js";
import { finishJobRun, startJobRun, type JobRunType } from "./operations-history.js";

let isRunning = false;

interface PendingAlertRow {
  AlertId: string;
  ServerId: string;
  DatabaseId: string | null;
  AlertType: string;
  Title: string;
  TriggeredAt: string;
}

function dedupKey(row: PendingAlertRow) {
  return [row.ServerId, row.DatabaseId ?? "", row.AlertType, row.Title.trim().toLowerCase()].join("|");
}

async function isRecentDuplicate(row: PendingAlertRow): Promise<boolean> {
  const rows = await query<{ ExistsFlag: number }>(
    `SELECT TOP 1 1 AS ExistsFlag
     FROM dbo.Alerts
     WHERE AlertId <> @alertId
       AND ServerId = @serverId
       AND ((DatabaseId IS NULL AND @databaseId IS NULL) OR DatabaseId = @databaseId)
       AND AlertType = @alertType
       AND Title = @title
       AND TriggeredAt >= DATEADD(MINUTE, -@dedupMinutes, GETUTCDATE())
       AND Status IN ('new', 'dispatched', 'acknowledged')`,
    {
      alertId: row.AlertId,
      serverId: row.ServerId,
      databaseId: row.DatabaseId,
      alertType: row.AlertType,
      title: row.Title,
      dedupMinutes: env.ALERT_DEDUP_MINUTES
    }
  );

  return rows.length > 0;
}

export async function runAlertDispatchCycle(runType: JobRunType = "manual"): Promise<{ pending: number; sent: number; failed: number; suppressed: number }> {
  if (isRunning) {
    return { pending: 0, sent: 0, failed: 0, suppressed: 0 };
  }

  isRunning = true;
  const { runId } = await startJobRun("alert-dispatch", runType);

  try {
    const pending = await query<PendingAlertRow>(
      `SELECT TOP (@limit) AlertId, ServerId, DatabaseId, AlertType, Title, TriggeredAt
       FROM dbo.Alerts
       WHERE Status = 'new'
       ORDER BY TriggeredAt ASC`,
      { limit: env.ALERT_BATCH_LIMIT }
    );

    let sent = 0;
    let failed = 0;
    let suppressed = 0;

    // In-cycle dedup to avoid dispatching duplicates within same batch.
    const seen = new Set<string>();

    for (const row of pending) {
      const key = dedupKey(row);

      if (seen.has(key) || (await isRecentDuplicate(row))) {
        suppressed += 1;
        await query(
          `UPDATE dbo.Alerts
           SET Status = 'suppressed'
           WHERE AlertId = @alertId`,
          { alertId: row.AlertId }
        );
        continue;
      }

      seen.add(key);

      try {
        const outcome = await dispatchAlert(row.AlertId);
        sent += outcome.sent;
        failed += outcome.failed;

        await query(
          `UPDATE dbo.Alerts
           SET Status = CASE WHEN @failedCount > 0 THEN 'new' ELSE 'dispatched' END
           WHERE AlertId = @alertId`,
          {
            alertId: row.AlertId,
            failedCount: outcome.failed
          }
        );
      } catch (error) {
        failed += 1;
        console.error(`[alert-dispatcher] Failed alert ${row.AlertId}`, error);
      }
    }

    const summary = `pending=${pending.length}; sent=${sent}; failed=${failed}; suppressed=${suppressed}; dedup_minutes=${env.ALERT_DEDUP_MINUTES}`;
    await finishJobRun(runId, "success", summary);

    return { pending: pending.length, sent, failed, suppressed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJobRun(runId, "failed", message);
    throw error;
  } finally {
    isRunning = false;
  }
}

export function startAlertDispatcher(): void {
  console.log("[alert-dispatcher] Starting alert dispatch scheduler");

  runAlertDispatchCycle("startup").catch((err) => {
    console.error("[alert-dispatcher] Startup dispatch failed:", err);
  });

  cron.schedule("* * * * *", () => {
    runAlertDispatchCycle("scheduled").catch((err) => {
      console.error("[alert-dispatcher] Scheduled dispatch failed:", err);
    });
  });
}
