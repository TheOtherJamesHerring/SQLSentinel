import type { NextFunction, Request, Response } from "express";
import { query } from "../db/sql.js";

export async function listAccessibleServerIds(user: { sub: string; role: string }) {
  if (user.role === "admin") {
    const rows = await query<{ ServerId: string }>(`SELECT ServerId FROM dbo.Servers`);
    return rows.map((row) => row.ServerId);
  }

  const rows = await query<{ ServerId: string }>(
    `SELECT ServerId FROM dbo.ServerAccess WHERE UserId = @userId`,
    { userId: user.sub }
  );
  return rows.map((row) => row.ServerId);
}

export async function requireServerAccess(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    const serverId = String(req.params.id ?? req.params.serverId ?? "");
    if (!serverId) {
      res.status(400).json({ message: "Missing server id" });
      return;
    }

    if (req.user.role === "admin") {
      next();
      return;
    }

    const [row] = await query<{ ServerId: string }>(
      `SELECT TOP 1 ServerId
       FROM dbo.ServerAccess
       WHERE UserId = @userId AND ServerId = @serverId`,
      { userId: req.user.sub, serverId }
    );

    if (!row) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
