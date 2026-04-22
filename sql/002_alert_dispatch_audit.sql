-- Phase 1 Quick Wins: Alert Dispatch, Audit, and Operational Monitoring
-- This migration adds infrastructure for alerting, compliance, and operational features

USE SQLMonitorDB;
GO

-- ============================================================================
-- 1. ALERT DISPATCH CONFIGURATION
-- ============================================================================

IF OBJECT_ID('dbo.AlertDispatchConfig', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AlertDispatchConfig (
        ConfigId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AlertDispatchConfig PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        Channel NVARCHAR(50) NOT NULL,  -- 'email', 'slack', 'webhook', 'pagerduty'
        IsEnabled BIT NOT NULL CONSTRAINT DF_AlertDispatchConfig_IsEnabled DEFAULT (1),
        ConfigData NVARCHAR(MAX) NOT NULL,  -- JSON: {webhookUrl, targetEmail, slackChannel, etc}
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_AlertDispatchConfig_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_AlertDispatchConfig_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

-- ============================================================================
-- 2. NOTIFICATION HISTORY (for audit trail)
-- ============================================================================

IF OBJECT_ID('dbo.Notifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Notifications (
        NotificationId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Notifications PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        AlertId UNIQUEIDENTIFIER NOT NULL,
        Channel NVARCHAR(50) NOT NULL,
        Target NVARCHAR(500) NOT NULL,
        Status NVARCHAR(50) NOT NULL,  -- 'pending', 'sent', 'failed', 'bounced'
        ErrorMessage NVARCHAR(MAX) NULL,
        SentAt DATETIME2 NULL,
        AttemptCount INT NOT NULL CONSTRAINT DF_Notifications_AttemptCount DEFAULT (1),
        LastAttemptAt DATETIME2 NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_Notifications_CreatedDate DEFAULT (GETUTCDATE())
    );
END
GO

-- ============================================================================
-- 3. AUDIT LOG (SOC2/PCI-DSS compliance)
-- ============================================================================

IF OBJECT_ID('dbo.AuditLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLog (
        AuditId BIGINT NOT NULL CONSTRAINT PK_AuditLog PRIMARY KEY IDENTITY(1,1),
        UserId NVARCHAR(256) NULL,
        Action NVARCHAR(50) NOT NULL,  -- 'CREATE', 'UPDATE', 'DELETE', 'ACKNOWLEDGE_ALERT', 'LOGIN', 'CONFIG_CHANGE'
        TableName NVARCHAR(100) NULL,
        RecordId NVARCHAR(MAX) NULL,
        OldValue NVARCHAR(MAX) NULL,
        NewValue NVARCHAR(MAX) NULL,
        IpAddress NVARCHAR(50) NULL,
        UserAgent NVARCHAR(MAX) NULL,
        Timestamp DATETIME2 NOT NULL CONSTRAINT DF_AuditLog_Timestamp DEFAULT (GETUTCDATE())
    );
END
GO

-- ============================================================================
-- 4. BACKUP FAILURES (for quick failure detection)
-- ============================================================================

IF OBJECT_ID('dbo.BackupFailures', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BackupFailures (
        FailureId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_BackupFailures PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        DatabaseName NVARCHAR(128) NOT NULL,
        BackupStartDate DATETIME2 NOT NULL,
        BackupFinishDate DATETIME2 NULL,
        BackupType NVARCHAR(50) NULL,  -- 'D' = full, 'I' = diff, 'L' = log
        ErrorMessage NVARCHAR(MAX) NULL,
        BackupSize BIGINT NULL,
        DetectedAt DATETIME2 NOT NULL CONSTRAINT DF_BackupFailures_DetectedAt DEFAULT (GETUTCDATE()),
        IsResolved BIT NOT NULL CONSTRAINT DF_BackupFailures_IsResolved DEFAULT (0)
    );
END
GO

-- ============================================================================
-- 5. AGENT JOB STATUS
-- ============================================================================

IF OBJECT_ID('dbo.AgentJobs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AgentJobs (
        JobId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AgentJobs PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        SqlAgentJobId UNIQUEIDENTIFIER NOT NULL,  -- from msdb.sysjobs
        JobName NVARCHAR(256) NOT NULL,
        LastRunDate DATETIME2 NULL,
        LastRunStatus INT NULL,  -- 0=failed, 1=succeeded, 2=retry, 3=cancelled
        LastRunDuration INT NULL,  -- in seconds
        LastRunStep INT NULL,
        LastRunStepMessage NVARCHAR(MAX) NULL,
        NextRunDate DATETIME2 NULL,
        IsEnabled BIT NOT NULL,
        Category NVARCHAR(100) NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_AgentJobs_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_AgentJobs_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

-- ============================================================================
-- 6. SERVER ACCESS CONTROL (for per-server RBAC)
-- ============================================================================

IF OBJECT_ID('dbo.ServerAccess', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ServerAccess (
        AccessId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ServerAccess PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        UserId NVARCHAR(256) NOT NULL,
        ServerId UNIQUEIDENTIFIER NOT NULL,
        Role NVARCHAR(50) NOT NULL,  -- 'admin', 'viewer'
        GrantedBy NVARCHAR(256) NOT NULL,
        GrantedAt DATETIME2 NOT NULL CONSTRAINT DF_ServerAccess_GrantedAt DEFAULT (GETUTCDATE()),
        CONSTRAINT UQ_ServerAccess_UserServer UNIQUE (UserId, ServerId)
    );
END
GO

-- ============================================================================
-- 7. FOREIGN KEYS
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Notifications_Alerts')
BEGIN
    ALTER TABLE dbo.Notifications ADD CONSTRAINT FK_Notifications_Alerts FOREIGN KEY (AlertId) REFERENCES dbo.Alerts(AlertId) ON DELETE CASCADE;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BackupFailures_Servers')
BEGIN
    ALTER TABLE dbo.BackupFailures ADD CONSTRAINT FK_BackupFailures_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AgentJobs_Servers')
BEGIN
    ALTER TABLE dbo.AgentJobs ADD CONSTRAINT FK_AgentJobs_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ServerAccess_Servers')
BEGIN
    ALTER TABLE dbo.ServerAccess ADD CONSTRAINT FK_ServerAccess_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

-- ============================================================================
-- 8. INDEXES
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Notifications_AlertId_Status')
BEGIN
    CREATE INDEX IX_Notifications_AlertId_Status ON dbo.Notifications (AlertId, Status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_Timestamp')
BEGIN
    CREATE INDEX IX_AuditLog_Timestamp ON dbo.AuditLog ([Timestamp] DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_UserId')
BEGIN
    CREATE INDEX IX_AuditLog_UserId ON dbo.AuditLog (UserId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BackupFailures_ServerId_Timestamp')
BEGIN
    CREATE INDEX IX_BackupFailures_ServerId_Timestamp ON dbo.BackupFailures (ServerId, DetectedAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AgentJobs_ServerId_UpdatedDate')
BEGIN
    CREATE INDEX IX_AgentJobs_ServerId_UpdatedDate ON dbo.AgentJobs (ServerId, UpdatedDate DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ServerAccess_UserId')
BEGIN
    CREATE INDEX IX_ServerAccess_UserId ON dbo.ServerAccess (UserId);
END
GO

-- ============================================================================
-- 9. INITIALIZE DEFAULT ALERT DISPATCH CONFIG (Slack)
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM dbo.AlertDispatchConfig WHERE Channel = 'slack')
BEGIN
    INSERT INTO dbo.AlertDispatchConfig (Channel, IsEnabled, ConfigData)
    VALUES (
        'slack',
        0,  -- disabled by default, needs webhook URL
        N'{"webhookUrl": "", "channel": "#sql-monitoring", "mentionUsers": false}'
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AlertDispatchConfig WHERE Channel = 'email')
BEGIN
    INSERT INTO dbo.AlertDispatchConfig (Channel, IsEnabled, ConfigData)
    VALUES (
        'email',
        0,  -- disabled by default, needs SMTP config
        N'{"smtpServer": "smtp.company.com", "port": 587, "fromAddress": "sqlmonitoring@company.com", "toAddresses": []}'
    );
END
GO

PRINT 'Migration 002 completed successfully';
GO
