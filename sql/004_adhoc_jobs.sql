-- Migration 004: Ad-hoc DBA jobs queue
-- Run once against SQLMonitorDB

IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'AdHocJobs' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.AdHocJobs (
    JobId         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    ServerId      UNIQUEIDENTIFIER NOT NULL,
    DatabaseId    UNIQUEIDENTIFIER NULL,
    DatabaseName  NVARCHAR(128)    NULL,
    JobType       NVARCHAR(64)     NOT NULL,   -- backup | dbcc_checkdb
    Params        NVARCHAR(MAX)    NULL,        -- JSON params (e.g. {"backupPath":"D:\\Backups"})
    Status        NVARCHAR(32)     NOT NULL DEFAULT 'pending',
                                               -- pending | running | completed | failed | cancelled
    RequestedBy   NVARCHAR(128)    NULL,
    CreatedAt     DATETIME2(3)     NOT NULL DEFAULT SYSUTCDATETIME(),
    StartedAt     DATETIME2(3)     NULL,
    CompletedAt   DATETIME2(3)     NULL,
    DurationMs    INT              NULL,
    ResultSummary NVARCHAR(MAX)    NULL,
    CONSTRAINT PK_AdHocJobs PRIMARY KEY (JobId),
    CONSTRAINT FK_AdHocJobs_Server
      FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId) ON DELETE CASCADE
  );

  CREATE INDEX IX_AdHocJobs_Server_Status
    ON dbo.AdHocJobs (ServerId, Status, CreatedAt DESC);

  PRINT 'Created dbo.AdHocJobs';
END
ELSE
  PRINT 'dbo.AdHocJobs already exists, skipping.';
GO
