import type { Response } from "express";

export function ok<T>(res: Response, data: T) {
  return res.json({ data });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ data });
}
