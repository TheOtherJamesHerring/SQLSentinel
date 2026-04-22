import { Router, type Request } from "express";
import { query } from "../db/sql.js";
import { requireAuth } from "../middleware/auth.js";

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

async function writeAlertAudit(req: Request, action: string, recordId: string) {
  await query(
    `INSERT INTO AuditLog (UserId, Action, RecordId, IpAddress, [Timestamp])
     VALUES (@userId, @action, @recordId, @ipAddress, GETUTCDATE())`,
    {
      userId: req.user?.sub ?? "unknown",
      action,
      recordId,
      ipAddress: req.ip ?? "unknown"
    }
  ).catch(() => {});
}

alertsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT TOP (@limit) *
      FROM Alerts
      WHERE (@status IS NULL OR Status = @status)
      AND (@severity IS NULL OR Severity = @severity)
      AND (@server_id IS NULL OR ServerId = @server_id)
      ORDER BY TriggeredAt DESC
    `, {
      limit: Number(req.query.limit ?? 100),
      status: req.query.status ?? null,
      severity: req.query.severity ?? null,
      server_id: req.query.server_id ?? null
    });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

alertsRouter.patch("/:id", async (req, res, next) => {
  try {
    const status = req.body?.status;
    const userName = req.user?.name ?? "system";

    if (status !== "acknowledged" && status !== "resolved") {
      res.status(400).json({ message: "Invalid alert status" });
      return;
    }

    const rows = await query(`
      UPDATE Alerts
      SET Status = @status,
          AcknowledgedBy = CASE WHEN @status = 'acknowledged' THEN @user ELSE AcknowledgedBy END,
          AcknowledgedAt = CASE WHEN @status = 'acknowledged' THEN GETUTCDATE() ELSE AcknowledgedAt END,
          ResolvedBy = CASE WHEN @status = 'resolved' THEN @user ELSE ResolvedBy END,
          ResolvedAt = CASE WHEN @status = 'resolved' THEN GETUTCDATE() ELSE ResolvedAt END
      OUTPUT INSERTED.*
      WHERE AlertId = @id
    `, {
      id: req.params.id,
      status,
      user: userName
    });

    if (rows[0]) {
      await writeAlertAudit(req, status === "acknowledged" ? "ACKNOWLEDGE_ALERT" : "RESOLVE_ALERT", req.params.id);
    }

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

alertsRouter.post("/:id/acknowledge", async (req, res, next) => {
  try {
    const userName = req.user?.name ?? "system";
    const rows = await query(`
      UPDATE Alerts
      SET Status = 'acknowledged',
          AcknowledgedBy = @user,
          AcknowledgedAt = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE AlertId = @id
    `, {
      id: req.params.id,
      user: userName
    });

    if (rows[0]) {
      await writeAlertAudit(req, "ACKNOWLEDGE_ALERT", req.params.id);
    }

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

alertsRouter.post("/:id/resolve", async (req, res, next) => {
  try {
    const userName = req.user?.name ?? "system";
    const rows = await query(`
      UPDATE Alerts
      SET Status = 'resolved',
          ResolvedBy = @user,
          ResolvedAt = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE AlertId = @id
    `, {
      id: req.params.id,
      user: userName
    });

    if (rows[0]) {
      await writeAlertAudit(req, "RESOLVE_ALERT", req.params.id);
    }

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});
