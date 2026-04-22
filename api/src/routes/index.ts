import { Router } from "express";
import { authRouter } from "./auth.js";
import { connectionsRouter } from "./connections.js";
import { dashboardRouter } from "./dashboard.js";
import { serversRouter } from "./servers.js";
import { databasesRouter } from "./databases.js";
import { alertsRouter } from "./alerts.js";
import { eventsRouter } from "./events.js";
import { capacityRouter } from "./capacity.js";
import { collectorRouter } from "./collector.js";
import alertDispatchRouter from "./alert-dispatch.js";
import { settingsRouter } from "./settings.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/servers", serversRouter);
apiRouter.use("/databases", databasesRouter);
apiRouter.use("/alerts", alertsRouter);
apiRouter.use("/events", eventsRouter);
apiRouter.use("/capacity", capacityRouter);
apiRouter.use("/connections", connectionsRouter);
apiRouter.use("/collect", collectorRouter);
apiRouter.use("/alerts", alertDispatchRouter);
apiRouter.use("/settings", settingsRouter);
