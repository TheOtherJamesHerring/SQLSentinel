import { Router } from "express";
import { z } from "zod";
import { query } from "../db/sql.js";
import { env } from "../config/env.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listAccessibleServerIds, requireServerAccess } from "../middleware/rbac.js";
import { executeAzureDeploy } from "../services/azure-deploy.js";
import {
  finishCollectorDeploymentFailure,
  finishCollectorDeploymentSuccess,
  getCollectorDeployment,
  listCollectorDeployments,
  startCollectorDeployment
} from "../services/collector-deployment-history.js";

const createServerSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1),
  instanceName: z.string().optional(),
  port: z.number().default(1433),
  environment: z.enum(["production", "staging", "development", "dr"]).default("production"),
  targetType: z.enum(["on-prem", "sql-mi", "azure-sql-db", "fabric-sql"]).default("on-prem")
});

const deployCollectorSchema = z.object({
  mode: z.enum(["single-host", "container", "azure-container-instance", "azure-app-service"]),
  serverCount: z.number().int().min(1).max(10000).default(1),
  monitorApiUrl: z.string().url().optional(),
  sql: z.object({
    hostname: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(1433),
    authType: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    database: z.string().min(1).default("master"),
    encrypt: z.boolean().default(true),
    trustServerCert: z.boolean().default(false)
  }),
  credentials: z.object({
    hostUsername: z.string().optional(),
    hostPassword: z.string().optional(),
    subscriptionId: z.string().optional(),
    resourceGroup: z.string().optional(),
    location: z.string().optional(),
    tenantId: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    appName: z.string().optional(),
    appServicePlan: z.string().optional()
  }).optional()
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
      `INSERT INTO Servers(Name, Hostname, InstanceName, Port, Environment, TargetType)
       OUTPUT INSERTED.*
       VALUES(@name, @hostname, @instanceName, @port, @environment, @targetType)`,
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
           CollectorEnabled = COALESCE(@collectorEnabled, CollectorEnabled),
           UpdatedDate = GETUTCDATE()
       OUTPUT INSERTED.*
       WHERE ServerId = @id`,
      {
        id: req.params.id,
        notes: req.body.notes,
        monitoringEnabled: req.body.monitoringEnabled,
        collectorEnabled: req.body.collectorEnabled
      }
    );

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

serversRouter.patch("/:id/collector", requireRole(["admin"]), async (req, res, next) => {
  try {
    const enabled = req.body.enabled === true || req.body.enabled === 1 || req.body.enabled === "true";
    const rows = await query(
      `UPDATE Servers
       SET CollectorEnabled = @enabled,
           UpdatedDate = GETUTCDATE()
       OUTPUT INSERTED.*
       WHERE ServerId = @id`,
      { id: req.params.id, enabled: enabled ? 1 : 0 }
    );

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

serversRouter.post("/:id/collector/deploy", requireRole(["admin"]), async (req, res, next) => {
  const parsed = deployCollectorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid deploy payload", issues: parsed.error.issues });
    return;
  }

  try {
    const [server] = await query<{ ServerId: string; Name: string; TargetType: string; LastCheck: string | null }>(
      `SELECT TOP 1 ServerId, Name, TargetType, LastCheck FROM Servers WHERE ServerId = @id`,
      { id: req.params.id }
    );

    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const { mode, serverCount, sql } = parsed.data;
    const credentials = parsed.data.credentials ?? {};
    const monitorApiUrl = parsed.data.monitorApiUrl ?? `http://${req.get("host") ?? "localhost:3001"}/api`;

    const missingFields: string[] = [];
    if (mode === "single-host" || mode === "container") {
      if (!credentials.hostUsername) missingFields.push("hostUsername");
      if (!credentials.hostPassword) missingFields.push("hostPassword");
    }
    if (mode === "azure-container-instance" || mode === "azure-app-service") {
      if (!credentials.subscriptionId) missingFields.push("subscriptionId");
      if (!credentials.resourceGroup) missingFields.push("resourceGroup");
      if (!credentials.location) missingFields.push("location");
      if (!credentials.tenantId) missingFields.push("tenantId");
      if (!credentials.clientId) missingFields.push("clientId");
      if (!credentials.clientSecret) missingFields.push("clientSecret");
    }
    if (mode === "azure-app-service") {
      if (!credentials.appName) missingFields.push("appName");
      if (!credentials.appServicePlan) missingFields.push("appServicePlan");
    }

    if (missingFields.length > 0) {
      res.status(400).json({
        message: `Missing required deployment credentials: ${missingFields.join(", ")}`
      });
      return;
    }

    await query(
      `UPDATE Servers
       SET CollectorEnabled = 1,
           UpdatedDate = GETUTCDATE()
       WHERE ServerId = @id`,
      { id: req.params.id }
    );

    const envLines = [
      `MONITOR_API_URL=${monitorApiUrl}`,
      "MONITOR_API_KEY=<monitor-api-key>",
      `SERVER_ID=${server.ServerId}`,
      `SQL_SERVER_HOST=${sql.hostname}`,
      `SQL_SERVER_PORT=${sql.port}`,
      `SQL_AUTH_TYPE=${sql.authType}`,
      `SQL_USERNAME=${sql.username}`,
      "SQL_PASSWORD=<sql-password>",
      `SQL_DATABASE=${sql.database}`,
      `SQL_ENCRYPT=${sql.encrypt}`,
      `SQL_TRUST_SERVER_CERT=${sql.trustServerCert}`
    ];

    let command = "";
    let nextSteps: string[] = [];
    let deploymentStatus: "prepared" | "started" = "prepared";
    let deploymentId: string | null = null;
    let deploymentStartedAt: string | null = null;
    let resourceName: string | null = null;

    if (mode === "single-host") {
      command = [
        "# On collector host",
        "mkdir -p /opt/sqlsentinnel-collector && cd /opt/sqlsentinnel-collector",
        "cat > .env <<'EOF'",
        ...envLines,
        "EOF",
        "npm run dev -w collector"
      ].join("\n");
      nextSteps = [
        "Collector deployed as a single-host process.",
        "Use this mode for 1-5 servers in the same site.",
        "Move to container mode for easier upgrades and restarts."
      ];

      const started = await startCollectorDeployment({
        serverId: server.ServerId,
        mode,
        provider: "manual",
        requestedBy: req.user?.name ?? req.user?.sub ?? "unknown",
        commandPreview: command
      });
      deploymentId = started.DeploymentId;
      deploymentStartedAt = started.StartedAt;
      await finishCollectorDeploymentSuccess({
        deploymentId: started.DeploymentId,
        summary: "Manual single-host deployment instructions generated"
      });
    } else if (mode === "container") {
      command = [
        "# On docker host",
        "mkdir -p /opt/sqlsentinnel-collector && cd /opt/sqlsentinnel-collector",
        "cat > .env <<'EOF'",
        ...envLines,
        "EOF",
        "docker run -d --name sqlsentinnel-collector --restart always --env-file .env <collector-image>"
      ].join("\n");
      nextSteps = [
        "Container collector deployment prepared.",
        "Use this mode for 3-10 servers and standard ops automation.",
        "For 10+ servers, prefer multiple collectors by network zone."
      ];

      const started = await startCollectorDeployment({
        serverId: server.ServerId,
        mode,
        provider: "manual",
        requestedBy: req.user?.name ?? req.user?.sub ?? "unknown",
        commandPreview: command
      });
      deploymentId = started.DeploymentId;
      deploymentStartedAt = started.StartedAt;
      await finishCollectorDeploymentSuccess({
        deploymentId: started.DeploymentId,
        summary: "Manual container deployment instructions generated"
      });
    } else if (mode === "azure-container-instance" || mode === "azure-app-service") {
      const provider = mode === "azure-container-instance" ? "aci" : "app-service";
      const started = await startCollectorDeployment({
        serverId: server.ServerId,
        mode,
        provider,
        requestedBy: req.user?.name ?? req.user?.sub ?? "unknown",
        commandPreview: "Executing Azure deploy via API"
      });

      deploymentId = started.DeploymentId;
      deploymentStartedAt = started.StartedAt;
      const localDeploymentId = started.DeploymentId;

      try {
        const result = await executeAzureDeploy({
          mode,
          collectorImage: process.env.COLLECTOR_IMAGE ?? "ghcr.io/sqlsentinnel/collector:latest",
          monitorApiUrl,
          monitorApiKey: env.MONITOR_API_KEY,
          serverId: server.ServerId,
          serverName: server.Name,
          subscriptionId: credentials.subscriptionId!,
          resourceGroup: credentials.resourceGroup!,
          location: credentials.location!,
          tenantId: credentials.tenantId!,
          clientId: credentials.clientId!,
          clientSecret: credentials.clientSecret!,
          sql: {
            hostname: sql.hostname,
            port: sql.port,
            authType: sql.authType,
            username: sql.username,
            password: sql.password,
            database: sql.database,
            encrypt: sql.encrypt,
            trustServerCert: sql.trustServerCert
          },
          appName: credentials.appName,
          appServicePlan: credentials.appServicePlan
        });

        command = result.commandPreview;
        resourceName = result.resourceName;
        deploymentStatus = "started";
        await finishCollectorDeploymentSuccess({
          deploymentId: localDeploymentId,
          summary: result.summary
        });
        nextSteps = [
          `${result.summary}`,
          "Collector should begin sending heartbeats within about 1-2 minutes.",
          "Use health check below to confirm first heartbeat."
        ];
      } catch (deployError) {
        const message = deployError instanceof Error ? deployError.message : "Azure deployment failed";
        await finishCollectorDeploymentFailure({
          deploymentId: localDeploymentId,
          errorMessage: message
        });
        res.status(500).json({
          message,
          data: {
            deploymentId,
            deploymentStatus: "failed"
          }
        });
        return;
      }
    }

    const sizeHint = serverCount > 10
      ? "Large estate detected (10+ servers): run multiple collectors by region/environment."
      : "Small to medium estate: one collector is usually sufficient.";

    res.json({
      data: {
        mode,
        permissionsVerified: true,
        deploymentId,
        deploymentStatus,
        deploymentStartedAt,
        lastHeartbeatAt: server.LastCheck,
        resourceName,
        summary: `Collector deployment prepared for ${server.Name}. ${sizeHint}`,
        command,
        envPreview: envLines,
        nextSteps
      }
    });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/collector/deployments", requireRole(["admin"]), async (req, res, next) => {
  try {
    const serverId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const limit = Number(req.query.limit ?? 20);
    const rows = await listCollectorDeployments(serverId, Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

serversRouter.get("/:id/collector/health", requireRole(["admin"]), async (req, res, next) => {
  try {
    const serverId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deploymentId = typeof req.query.deploymentId === "string" ? req.query.deploymentId : "";
    const deployment = deploymentId ? await getCollectorDeployment(deploymentId, serverId) : null;

    const [server] = await query<{ LastCheck: string | null; CollectorEnabled: number | null; MonitoringEnabled: number | null }>(
      `SELECT TOP 1 LastCheck, CollectorEnabled, MonitoringEnabled FROM Servers WHERE ServerId = @id`,
      { id: serverId }
    );

    if (!server) {
      res.status(404).json({ message: "Server not found" });
      return;
    }

    const lastCheck = server.LastCheck ? new Date(server.LastCheck) : null;
    const startedAt = deployment?.StartedAt ? new Date(deployment.StartedAt) : null;
    const now = Date.now();
    const freshnessMs = lastCheck ? now - lastCheck.getTime() : Number.POSITIVE_INFINITY;

    const seenAfterDeploy = Boolean(lastCheck && startedAt && lastCheck.getTime() >= startedAt.getTime());
    const healthy = Boolean(lastCheck && freshnessMs <= 3 * 60 * 1000 && (!startedAt || seenAfterDeploy));
    const stale = Boolean(lastCheck && freshnessMs > 3 * 60 * 1000);

    let status: "healthy" | "pending" | "stale" | "failed" = "pending";
    if (healthy) status = "healthy";
    else if (stale) status = "stale";
    if (deployment?.Status === "failed") status = "failed";

    res.json({
      data: {
        status,
        deployment,
        lastHeartbeatAt: server.LastCheck,
        collectorEnabled: Number(server.CollectorEnabled ?? 1) === 1,
        monitoringEnabled: Number(server.MonitoringEnabled ?? 1) === 1,
        heartbeatAgeSeconds: Number.isFinite(freshnessMs) ? Math.floor(freshnessMs / 1000) : null,
        seenAfterDeploy
      }
    });
  } catch (error) {
    next(error);
  }
});

serversRouter.delete("/:id", requireRole(["admin"]), async (req, res, next) => {
  try {
    // Delete in FK-safe order. Some tables are optional migrations, so guard with OBJECT_ID checks.
    await query(`
      BEGIN TRY
      BEGIN TRANSACTION;

      IF OBJECT_ID('dbo.AdHocJobs', 'U') IS NOT NULL
        DELETE FROM dbo.AdHocJobs WHERE ServerId = @id;

      IF OBJECT_ID('dbo.ServerAccess', 'U') IS NOT NULL
        DELETE FROM dbo.ServerAccess WHERE ServerId = @id;

      IF OBJECT_ID('dbo.CollectorDeployments', 'U') IS NOT NULL
        DELETE FROM dbo.CollectorDeployments WHERE ServerId = @id;

      IF OBJECT_ID('dbo.BlockingSessions', 'U') IS NOT NULL
        DELETE FROM dbo.BlockingSessions WHERE ServerId = @id;

      IF OBJECT_ID('dbo.DiskVolumes', 'U') IS NOT NULL
        DELETE FROM dbo.DiskVolumes WHERE ServerId = @id;

      IF OBJECT_ID('dbo.Alerts', 'U') IS NOT NULL
        DELETE FROM dbo.Alerts WHERE ServerId = @id;

      IF OBJECT_ID('dbo.LogEvents', 'U') IS NOT NULL
        DELETE FROM dbo.LogEvents WHERE ServerId = @id;

      IF OBJECT_ID('dbo.Metrics', 'U') IS NOT NULL
        DELETE FROM dbo.Metrics WHERE ServerId = @id;

      IF OBJECT_ID('dbo.QueryStoreSnapshots', 'U') IS NOT NULL
        DELETE qs
        FROM dbo.QueryStoreSnapshots qs
        INNER JOIN dbo.Databases d ON d.DatabaseId = qs.DatabaseId
        WHERE d.ServerId = @id;

      IF OBJECT_ID('dbo.BackupFailures', 'U') IS NOT NULL
        DELETE FROM dbo.BackupFailures WHERE ServerId = @id;

      IF OBJECT_ID('dbo.AgentJobs', 'U') IS NOT NULL
        DELETE FROM dbo.AgentJobs WHERE ServerId = @id;

      IF OBJECT_ID('dbo.DBCCResults', 'U') IS NOT NULL
        DELETE FROM dbo.DBCCResults WHERE ServerId = @id;

      IF OBJECT_ID('dbo.ConnectionProfiles', 'U') IS NOT NULL
        DELETE FROM dbo.ConnectionProfiles WHERE ServerId = @id;

      IF OBJECT_ID('dbo.Databases', 'U') IS NOT NULL
        DELETE FROM dbo.Databases WHERE ServerId = @id;

      DELETE FROM dbo.Servers WHERE ServerId = @id;

      COMMIT TRANSACTION;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0
          ROLLBACK TRANSACTION;
        THROW;
      END CATCH
    `, { id: req.params.id });
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
