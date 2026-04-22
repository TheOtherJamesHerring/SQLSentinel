import { Router } from "express";
import { z } from "zod";
import { query } from "../db/sql.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { runRetentionCleanupNow } from "../services/retention-cleaner.js";
import { listRecentJobRuns } from "../services/operations-history.js";
import { runAlertDispatchCycle } from "../services/alert-dispatcher.js";

const thresholdUpdateSchema = z.object({
  warningValue: z.number(),
  criticalValue: z.number(),
  isEnabled: z.boolean().optional()
});

const serverAccessSchema = z.object({
  userId: z.string().min(1),
  serverId: z.string().uuid(),
  role: z.enum(["admin", "viewer"])
});

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/thresholds", async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT ThresholdId, Name, MetricType, WarningValue, CriticalValue, Unit, Description, IsEnabled
       FROM dbo.Thresholds
       ORDER BY Name`
    );
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch("/thresholds/:id", requireRole(["admin"]), async (req, res, next) => {
  const parsed = thresholdUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  try {
    const rows = await query(
      `UPDATE dbo.Thresholds
       SET WarningValue = @warningValue,
           CriticalValue = @criticalValue,
           IsEnabled = COALESCE(@isEnabled, IsEnabled),
           UpdatedDate = GETUTCDATE()
       OUTPUT INSERTED.ThresholdId, INSERTED.Name, INSERTED.MetricType, INSERTED.WarningValue, INSERTED.CriticalValue, INSERTED.Unit, INSERTED.Description, INSERTED.IsEnabled
       WHERE ThresholdId = @id`,
      {
        id: req.params.id,
        warningValue: parsed.data.warningValue,
        criticalValue: parsed.data.criticalValue,
        isEnabled: parsed.data.isEnabled ?? null
      }
    );

    if (!rows[0]) {
      res.status(404).json({ message: "Threshold not found" });
      return;
    }

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

settingsRouter.get("/servers-lite", async (_req, res, next) => {
  try {
    const rows = await query(`SELECT ServerId, Name, Hostname, Environment FROM dbo.Servers ORDER BY Name`);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

settingsRouter.get("/users-lite", (_req, res) => {
  res.json({
    data: [
      { userId: "admin", displayName: "SQL Admin", role: "admin" },
      { userId: "viewer", displayName: "Read Only", role: "viewer" }
    ]
  });
});

settingsRouter.get("/server-access", async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT sa.AccessId, sa.UserId, sa.ServerId, sa.Role, sa.GrantedBy, sa.GrantedAt,
              s.Name AS ServerName, s.Environment
       FROM dbo.ServerAccess sa
       JOIN dbo.Servers s ON s.ServerId = sa.ServerId
       ORDER BY sa.UserId, s.Name`
    );
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post("/server-access", requireRole(["admin"]), async (req, res, next) => {
  const parsed = serverAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  try {
    const existing = await query(
      `SELECT AccessId FROM dbo.ServerAccess WHERE UserId = @userId AND ServerId = @serverId`,
      { userId: parsed.data.userId, serverId: parsed.data.serverId }
    );

    if (existing.length > 0) {
      await query(
        `UPDATE dbo.ServerAccess
         SET Role = @role,
             GrantedBy = @grantedBy,
             GrantedAt = GETUTCDATE()
         WHERE UserId = @userId AND ServerId = @serverId`,
        {
          userId: parsed.data.userId,
          serverId: parsed.data.serverId,
          role: parsed.data.role,
          grantedBy: req.user?.sub ?? "admin"
        }
      );
    } else {
      await query(
        `INSERT INTO dbo.ServerAccess (UserId, ServerId, Role, GrantedBy)
         VALUES (@userId, @serverId, @role, @grantedBy)`,
        {
          userId: parsed.data.userId,
          serverId: parsed.data.serverId,
          role: parsed.data.role,
          grantedBy: req.user?.sub ?? "admin"
        }
      );
    }

    res.status(201).json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
});

settingsRouter.delete("/server-access", requireRole(["admin"]), async (req, res, next) => {
  const userId = String(req.query.userId ?? "");
  const serverId = String(req.query.serverId ?? "");

  if (!userId || !serverId) {
    res.status(400).json({ message: "userId and serverId are required" });
    return;
  }

  try {
    await query(`DELETE FROM dbo.ServerAccess WHERE UserId = @userId AND ServerId = @serverId`, { userId, serverId });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

settingsRouter.post("/retention/run-now", requireRole(["admin"]), async (_req, res, next) => {
  try {
    const results = await runRetentionCleanupNow();
    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post("/dispatch/run-now", requireRole(["admin"]), async (_req, res, next) => {
  try {
    const result = await runAlertDispatchCycle("manual");
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

settingsRouter.get("/job-runs", requireRole(["admin"]), async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const runs = await listRecentJobRuns(Number.isFinite(limit) ? limit : 50);
    res.json({ data: runs });
  } catch (error) {
    next(error);
  }
});
