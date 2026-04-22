USE SQLMonitorDB;
GO

IF OBJECT_ID('dbo.JobRuns', 'U') IS NULL
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
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JobRuns_JobName_StartedAt' AND object_id = OBJECT_ID('dbo.JobRuns'))
BEGIN
    CREATE INDEX IX_JobRuns_JobName_StartedAt ON dbo.JobRuns (JobName, StartedAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JobRuns_Status' AND object_id = OBJECT_ID('dbo.JobRuns'))
BEGIN
    CREATE INDEX IX_JobRuns_Status ON dbo.JobRuns (Status, StartedAt DESC);
END
GO
