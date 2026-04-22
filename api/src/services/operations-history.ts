import { query } from "../db/sql.js";

let ensured = false;

export type JobRunStatus = "running" | "success" | "failed";
export type JobRunType = "manual" | "scheduled" | "startup";

export async function ensureJobRunsTable(): Promise<void> {
  if (ensured) return;

  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobRuns' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.JobRuns (
        JobRunId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_JobRuns PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        JobName NVARCHAR(100) NOT NULL,
        RunType NVARCHAR(20) NOT NULL,
        Status NVARCHAR(20) NOT NULL,
        StartedAt DATETIME2 NOT NULL,
        FinishedAt DATETIME2 NULL,
        DurationMs INT NULL,
        Summary NVARCHAR(MAX) NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_JobRuns_CreatedDate DEFAULT (GETUTCDATE())
      );

      CREATE INDEX IX_JobRuns_JobName_StartedAt ON dbo.JobRuns (JobName, StartedAt DESC);
      CREATE INDEX IX_JobRuns_Status ON dbo.JobRuns (Status, StartedAt DESC);
    END
  `);

  ensured = true;
}

export async function startJobRun(jobName: string, runType: JobRunType): Promise<{ runId: string; startedAt: Date }> {
  await ensureJobRunsTable();
  const startedAt = new Date();

  const rows = await query<{ JobRunId: string }>(
    `INSERT INTO dbo.JobRuns (JobName, RunType, Status, StartedAt)
     OUTPUT INSERTED.JobRunId
     VALUES (@jobName, @runType, 'running', @startedAt)`,
    { jobName, runType, startedAt: startedAt.toISOString() }
  );

  return { runId: rows[0].JobRunId, startedAt };
}

export async function finishJobRun(runId: string, status: Exclude<JobRunStatus, "running">, summary: string): Promise<void> {
  const finishedAt = new Date();

  await query(
    `UPDATE dbo.JobRuns
     SET Status = @status,
         FinishedAt = @finishedAt,
         DurationMs = DATEDIFF(MILLISECOND, StartedAt, @finishedAt),
         Summary = @summary
     WHERE JobRunId = @runId`,
    {
      runId,
      status,
      finishedAt: finishedAt.toISOString(),
      summary
    }
  );
}

export interface JobRunRow {
  JobRunId: string;
  JobName: string;
  RunType: string;
  Status: string;
  StartedAt: string;
  FinishedAt: string | null;
  DurationMs: number | null;
  Summary: string | null;
}

export async function listRecentJobRuns(limit = 50): Promise<JobRunRow[]> {
  await ensureJobRunsTable();

  return query<JobRunRow>(
    `SELECT TOP (@limit)
        JobRunId,
        JobName,
        RunType,
        Status,
        StartedAt,
        FinishedAt,
        DurationMs,
        Summary
     FROM dbo.JobRuns
     ORDER BY StartedAt DESC`,
    { limit }
  );
}
