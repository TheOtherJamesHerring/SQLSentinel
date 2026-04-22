import { Router } from "express";
import { query } from "../db/sql.js";
import { requireAuth } from "../middleware/auth.js";

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

eventsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT TOP 500 *
      FROM LogEvents
      WHERE (@source IS NULL OR Source = @source)
      AND (@severity IS NULL OR Severity = @severity)
      AND (@server_id IS NULL OR ServerId = @server_id)
      AND (@from IS NULL OR EventTime >= @from)
      AND (@to IS NULL OR EventTime <= @to)
      ORDER BY EventTime DESC
    `, {
      source: req.query.source ?? null,
      severity: req.query.severity ?? null,
      server_id: req.query.server_id ?? null,
      from: req.query.from ?? null,
      to: req.query.to ?? null
    });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

eventsRouter.patch("/:id", async (req, res, next) => {
  try {
    const rows = await query(`
      UPDATE LogEvents
      SET IsAcknowledged = 1, IsNew = 0
      OUTPUT INSERTED.*
      WHERE LogEventId = @id
    `, { id: req.params.id });
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});
