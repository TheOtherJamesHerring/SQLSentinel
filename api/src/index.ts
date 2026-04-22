import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";
import { startAlertDispatcher } from "./services/alert-dispatcher.js";
import { startRetentionCleaner } from "./services/retention-cleaner.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", apiRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ message });
});

app.listen(env.PORT, () => {
  console.log(`SQLSentinnel API listening on ${env.PORT}`);
});

startAlertDispatcher();
startRetentionCleaner();