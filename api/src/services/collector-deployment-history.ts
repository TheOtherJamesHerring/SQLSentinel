import { query } from "../db/sql.js";

export type CollectorDeploymentStatus = "running" | "success" | "failed";

let ensured = false;

export interface CollectorDeploymentRow {
  DeploymentId: string;
  ServerId: string;
  Mode: string;
  Provider: string;
  ResourceName: string | null;
  RequestedBy: string;
  Status: CollectorDeploymentStatus;
  StartedAt: string;
  FinishedAt: string | null;
  DurationMs: number | null;
  CommandPreview: string | null;
  Summary: string | null;
  ErrorMessage: string | null;
  CreatedDate: string;
}

export async function ensureCollectorDeploymentHistoryTable() {
  if (ensured) return;

  await query(`
    IF OBJECT_ID('dbo.CollectorDeployments', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.CollectorDeployments (
        DeploymentId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_CollectorDeployments PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        Mode NVARCHAR(60) NOT NULL,
        Provider NVARCHAR(30) NOT NULL,
        ResourceName NVARCHAR(128) NULL,
        RequestedBy NVARCHAR(200) NOT NULL,
        Status NVARCHAR(20) NOT NULL,
        StartedAt DATETIME2 NOT NULL,
        FinishedAt DATETIME2 NULL,
        DurationMs INT NULL,
        CommandPreview NVARCHAR(MAX) NULL,
        Summary NVARCHAR(MAX) NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_CollectorDeployments_CreatedDate DEFAULT (GETUTCDATE())
      );

      IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CollectorDeployments_Servers')
        ALTER TABLE dbo.CollectorDeployments
          ADD CONSTRAINT FK_CollectorDeployments_Servers
          FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId) ON DELETE CASCADE;

      CREATE INDEX IX_CollectorDeployments_ServerId_StartedAt
        ON dbo.CollectorDeployments (ServerId, StartedAt DESC);

      CREATE INDEX IX_CollectorDeployments_Status_StartedAt
        ON dbo.CollectorDeployments (Status, StartedAt DESC);
    END
  `);

  ensured = true;
}

export async function startCollectorDeployment(params: {
  serverId: string;
  mode: string;
  provider: string;
  resourceName?: string | null;
  requestedBy: string;
  commandPreview?: string | null;
}) {
  await ensureCollectorDeploymentHistoryTable();

  const startedAt = new Date().toISOString();
  const rows = await query<{ DeploymentId: string; StartedAt: string }>(
    `INSERT INTO dbo.CollectorDeployments
      (ServerId, Mode, Provider, ResourceName, RequestedBy, Status, StartedAt, CommandPreview)
     OUTPUT INSERTED.DeploymentId, INSERTED.StartedAt
     VALUES
      (@serverId, @mode, @provider, @resourceName, @requestedBy, 'running', @startedAt, @commandPreview)`,
    {
      serverId: params.serverId,
      mode: params.mode,
      provider: params.provider,
      resourceName: params.resourceName ?? null,
      requestedBy: params.requestedBy,
      startedAt,
      commandPreview: params.commandPreview ?? null
    }
  );

  return rows[0];
}

export async function finishCollectorDeploymentSuccess(params: {
  deploymentId: string;
  summary: string;
}) {
  const finishedAt = new Date().toISOString();
  await query(
    `UPDATE dbo.CollectorDeployments
     SET Status = 'success',
         FinishedAt = @finishedAt,
         DurationMs = DATEDIFF(MILLISECOND, StartedAt, @finishedAt),
         Summary = @summary,
         ErrorMessage = NULL
     WHERE DeploymentId = @deploymentId`,
    {
      deploymentId: params.deploymentId,
      finishedAt,
      summary: params.summary
    }
  );
}

export async function finishCollectorDeploymentFailure(params: {
  deploymentId: string;
  errorMessage: string;
}) {
  const finishedAt = new Date().toISOString();
  await query(
    `UPDATE dbo.CollectorDeployments
     SET Status = 'failed',
         FinishedAt = @finishedAt,
         DurationMs = DATEDIFF(MILLISECOND, StartedAt, @finishedAt),
         ErrorMessage = @errorMessage
     WHERE DeploymentId = @deploymentId`,
    {
      deploymentId: params.deploymentId,
      finishedAt,
      errorMessage: params.errorMessage
    }
  );
}

export async function listCollectorDeployments(serverId: string, limit = 50) {
  await ensureCollectorDeploymentHistoryTable();
  return query<CollectorDeploymentRow>(
    `SELECT TOP (@limit)
        DeploymentId,
        ServerId,
        Mode,
        Provider,
        ResourceName,
        RequestedBy,
        Status,
        StartedAt,
        FinishedAt,
        DurationMs,
        CommandPreview,
        Summary,
        ErrorMessage,
        CreatedDate
     FROM dbo.CollectorDeployments
     WHERE ServerId = @serverId
     ORDER BY StartedAt DESC`,
    { serverId, limit }
  );
}

export async function getCollectorDeployment(deploymentId: string, serverId: string) {
  await ensureCollectorDeploymentHistoryTable();
  const rows = await query<CollectorDeploymentRow>(
    `SELECT TOP 1
        DeploymentId,
        ServerId,
        Mode,
        Provider,
        ResourceName,
        RequestedBy,
        Status,
        StartedAt,
        FinishedAt,
        DurationMs,
        CommandPreview,
        Summary,
        ErrorMessage,
        CreatedDate
     FROM dbo.CollectorDeployments
     WHERE DeploymentId = @deploymentId
       AND ServerId = @serverId`,
    { deploymentId, serverId }
  );
  return rows[0] ?? null;
}
