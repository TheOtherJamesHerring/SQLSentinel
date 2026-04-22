import { Router } from "express";
import { query } from "../db/sql.js";
import { requireAuth } from "../middleware/auth.js";

export const capacityRouter = Router();
capacityRouter.use(requireAuth);

capacityRouter.get("/disks", async (_req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM DiskVolumes ORDER BY DaysUntilFull ASC, UsedPercent DESC`);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

capacityRouter.get("/databases", async (_req, res, next) => {
  try {
    const rows = await query(`
      SELECT d.*, s.Name AS ServerName
      FROM Databases d
      JOIN Servers s ON d.ServerId = s.ServerId
      ORDER BY (ISNULL(DataSizeMb, 0) + ISNULL(LogSizeMb, 0)) DESC
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

capacityRouter.get("/forecast", async (_req, res, next) => {
  try {
    const rows = await query(`
      WITH Recent AS (
        SELECT TOP 2000 ServerId, MetricName, Value, Timestamp
        FROM Metrics
        WHERE MetricType IN ('disk','db_size')
        ORDER BY Timestamp DESC
      )
      SELECT * FROM Recent ORDER BY Timestamp ASC
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});
