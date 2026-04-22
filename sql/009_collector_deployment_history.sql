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
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CollectorDeployments_Servers')
BEGIN
    ALTER TABLE dbo.CollectorDeployments
    ADD CONSTRAINT FK_CollectorDeployments_Servers
    FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId) ON DELETE CASCADE;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CollectorDeployments_ServerId_StartedAt')
BEGIN
    CREATE INDEX IX_CollectorDeployments_ServerId_StartedAt
    ON dbo.CollectorDeployments (ServerId, StartedAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CollectorDeployments_Status_StartedAt')
BEGIN
    CREATE INDEX IX_CollectorDeployments_Status_StartedAt
    ON dbo.CollectorDeployments (Status, StartedAt DESC);
END
GO
