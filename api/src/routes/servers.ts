import { Router } from "express";
import { z } from "zod";
import { query } from "../db/sql.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listAccessibleServerIds, requireServerAccess } from "../middleware/rbac.js";

const createServerSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1),
  instanceName: z.string().optional(),
  port: z.number().default(1433),
  environment: z.enum(["production", "staging", "development", "dr"]).default("production")
});

export const serversRouter = Router();
serversRouter.use(requireAuth);

serversRouter.get("/", async (req, res, next) => {
  try {
    const serverIds = await listAccessibleServerIds(req.user!);
    if (serverIds.length === 0) {
      res.json({ data: [] });
      return;
    }

    const rows = await query(
      `SELECT *
       FROM Servers
       WHERE ServerId IN (SELECT value FROM STRING_SPLIT(@ids, ','))
       ORDER BY Name`,
      { ids: serverIds.join(",") }
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

serversRouter.post("/", requireRole(["admin"]), async (req, res, next) => {
  const parsed = createServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    return;
  }

  try {
    const rows = await query(
      `INSERT INTO Servers(Name, Hostname, InstanceName, Port, Environment)
       OUTPUT INSERTED.*
       VALUES(@name, @hostname, @instanceName, @port, @environment)`,
      {
        ...parsed.data,
        instanceName: parsed.data.instanceName ?? null
      }
    );

    res.status(201).json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id", requireServerAccess, async (req, res, next) => {
  try {
    const [server] = await query(`SELECT * FROM Servers WHERE ServerId = @id`, { id: req.params.id });
    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    res.json({ data: server });
  } catch (error) {
    next(error);
  }
});

serversRouter.patch("/:id", requireRole(["admin"]), async (req, res, next) => {
  try {
    const rows = await query(
      `UPDATE Servers
       SET Notes = COALESCE(@notes, Notes),
           MonitoringEnabled = COALESCE(@monitoringEnabled, MonitoringEnabled),
           UpdatedDate = GETUTCDATE()
       OUTPUT INSERTED.*
       WHERE ServerId = @id`,
      {
        id: req.params.id,
        notes: req.body.notes,
        monitoringEnabled: req.body.monitoringEnabled
      }
    );

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

serversRouter.delete("/:id", requireRole(["admin"]), async (req, res, next) => {
  try {
    await query(`DELETE FROM Servers WHERE ServerId = @id`, { id: req.params.id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/metrics", requireServerAccess, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT Timestamp, MetricType, MetricName, Value, Unit
       FROM Metrics
       WHERE ServerId = @id
         AND (@type IS NULL OR MetricType = @type)
         AND (@from IS NULL OR Timestamp >= @from)
         AND (@to IS NULL OR Timestamp <= @to)
       ORDER BY Timestamp ASC`,
      {
        id: req.params.id,
        type: req.query.type ?? null,
        from: req.query.from ?? null,
        to: req.query.to ?? null
      }
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/blocking", requireServerAccess, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT TOP 100 *
       FROM BlockingSessions
       WHERE ServerId = @id
       ORDER BY CapturedAt DESC`,
      { id: req.params.id }
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/disks", requireServerAccess, async (req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM DiskVolumes WHERE ServerId = @id ORDER BY VolumeName`, { id: req.params.id });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/alerts", requireServerAccess, async (req, res, next) => {
  try {
    const rows = await query(`SELECT TOP 100 * FROM Alerts WHERE ServerId = @id ORDER BY TriggeredAt DESC`, { id: req.params.id });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/databases", requireServerAccess, async (req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM Databases WHERE ServerId = @id ORDER BY Name`, { id: req.params.id });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});
