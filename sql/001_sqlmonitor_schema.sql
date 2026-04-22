IF DB_ID('SQLMonitorDB') IS NULL
BEGIN
    CREATE DATABASE SQLMonitorDB;
END
GO

USE SQLMonitorDB;
GO

IF OBJECT_ID('dbo.Servers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Servers (
        ServerId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Servers PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        Name NVARCHAR(100) NOT NULL,
        Hostname NVARCHAR(255) NOT NULL,
        InstanceName NVARCHAR(100) NULL,
        Port INT NOT NULL CONSTRAINT DF_Servers_Port DEFAULT (1433),
        Environment NVARCHAR(20) NOT NULL CONSTRAINT CK_Servers_Environment CHECK (Environment IN ('production', 'staging', 'development', 'dr')),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Servers_Status DEFAULT ('unknown'),
        SqlVersion NVARCHAR(200) NULL,
        SqlEdition NVARCHAR(100) NULL,
        PatchLevel NVARCHAR(100) NULL,
        LastRestart DATETIME2 NULL,
        UptimeDays DECIMAL(10,2) NULL,
        CpuUsage DECIMAL(5,2) NULL,
        MemoryUsage DECIMAL(5,2) NULL,
        DiskUsage DECIMAL(5,2) NULL,
        ActiveConnections INT NULL,
        BlockedProcesses INT NOT NULL CONSTRAINT DF_Servers_BlockedProcesses DEFAULT (0),
        DatabaseCount INT NULL,
        LastBackupStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Servers_LastBackupStatus DEFAULT ('unknown'),
        LastDbccStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Servers_LastDbccStatus DEFAULT ('unknown'),
        MonitoringEnabled BIT NOT NULL CONSTRAINT DF_Servers_MonitoringEnabled DEFAULT (1),
        Notes NVARCHAR(MAX) NULL,
        LastCheck DATETIME2 NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_Servers_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_Servers_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.Databases', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Databases (
        DatabaseId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Databases PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        Name NVARCHAR(128) NOT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Databases_Status DEFAULT ('online'),
        Health NVARCHAR(20) NOT NULL CONSTRAINT DF_Databases_Health DEFAULT ('unknown'),
        RecoveryModel NVARCHAR(20) NULL,
        CompatibilityLevel INT NULL,
        DataSizeMb DECIMAL(18,2) NULL,
        LogSizeMb DECIMAL(18,2) NULL,
        LogUsedPercent DECIMAL(5,2) NULL,
        DataGrowthMbDay DECIMAL(10,2) NULL,
        LogGrowthMbDay DECIMAL(10,2) NULL,
        LastFullBackup DATETIME2 NULL,
        LastDiffBackup DATETIME2 NULL,
        LastLogBackup DATETIME2 NULL,
        FullBackupName NVARCHAR(256) NULL,
        DiffBackupName NVARCHAR(256) NULL,
        LogBackupName NVARCHAR(256) NULL,
        FullHeaderFileOnly BIT NULL,
        DiffHeaderFileOnly BIT NULL,
        LogHeaderFileOnly BIT NULL,
        FullBackupLocation NVARCHAR(1024) NULL,
        DiffBackupLocation NVARCHAR(1024) NULL,
        LogBackupLocation NVARCHAR(1024) NULL,
        BackupStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Databases_BackupStatus DEFAULT ('unknown'),
        LastDbccCheck DATETIME2 NULL,
        DbccStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Databases_DbccStatus DEFAULT ('unknown'),
        IndexFragAvg DECIMAL(5,2) NULL,
        FragmentedIndexCount INT NOT NULL CONSTRAINT DF_Databases_FragmentedIndexCount DEFAULT (0),
        LastCheck DATETIME2 NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_Databases_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_Databases_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.Metrics', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Metrics (
        MetricId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Metrics PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        DatabaseId UNIQUEIDENTIFIER NULL,
        MetricType NVARCHAR(50) NOT NULL,
        MetricName NVARCHAR(100) NULL,
        Value DECIMAL(18,4) NOT NULL,
        Unit NVARCHAR(20) NULL,
        VolumeName NVARCHAR(100) NULL,
        Timestamp DATETIME2 NOT NULL CONSTRAINT DF_Metrics_Timestamp DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.Alerts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Alerts (
        AlertId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Alerts PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        DatabaseId UNIQUEIDENTIFIER NULL,
        AlertType NVARCHAR(50) NOT NULL,
        Severity NVARCHAR(20) NOT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Alerts_Status DEFAULT ('new'),
        Title NVARCHAR(200) NOT NULL,
        Message NVARCHAR(MAX) NULL,
        MetricValue DECIMAL(18,4) NULL,
        ThresholdValue DECIMAL(18,4) NULL,
        AiSummary NVARCHAR(MAX) NULL,
        AiRecommendation NVARCHAR(MAX) NULL,
        AcknowledgedBy NVARCHAR(200) NULL,
        AcknowledgedAt DATETIME2 NULL,
        ResolvedBy NVARCHAR(200) NULL,
        ResolvedAt DATETIME2 NULL,
        TriggeredAt DATETIME2 NOT NULL CONSTRAINT DF_Alerts_TriggeredAt DEFAULT (GETUTCDATE()),
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_Alerts_CreatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.LogEvents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LogEvents (
        LogEventId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_LogEvents PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        DatabaseName NVARCHAR(128) NULL,
        Source NVARCHAR(50) NOT NULL,
        EventId INT NULL,
        Severity NVARCHAR(20) NOT NULL,
        Message NVARCHAR(MAX) NOT NULL,
        EventTime DATETIME2 NOT NULL,
        Category NVARCHAR(100) NULL,
        IsNew BIT NOT NULL CONSTRAINT DF_LogEvents_IsNew DEFAULT (1),
        IsAcknowledged BIT NOT NULL CONSTRAINT DF_LogEvents_IsAcknowledged DEFAULT (0),
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_LogEvents_CreatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.DiskVolumes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DiskVolumes (
        VolumeId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DiskVolumes PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        VolumeName NVARCHAR(50) NOT NULL,
        Label NVARCHAR(100) NULL,
        TotalSizeGb DECIMAL(10,2) NOT NULL,
        FreeSpaceGb DECIMAL(10,2) NOT NULL,
        UsedPercent DECIMAL(5,2) NULL,
        GrowthGbPerDay DECIMAL(10,4) NULL,
        DaysUntilFull INT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_DiskVolumes_Status DEFAULT ('ok'),
        ContainsDataFiles BIT NOT NULL CONSTRAINT DF_DiskVolumes_ContainsDataFiles DEFAULT (0),
        ContainsLogFiles BIT NOT NULL CONSTRAINT DF_DiskVolumes_ContainsLogFiles DEFAULT (0),
        LastCheck DATETIME2 NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_DiskVolumes_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_DiskVolumes_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.BlockingSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BlockingSessions (
        BlockingId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_BlockingSessions PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        SessionId INT NOT NULL,
        BlockingSessionId INT NULL,
        DatabaseName NVARCHAR(128) NULL,
        LoginName NVARCHAR(128) NULL,
        HostName NVARCHAR(128) NULL,
        ProgramName NVARCHAR(256) NULL,
        WaitType NVARCHAR(60) NULL,
        WaitTimeMs BIGINT NULL,
        WaitResource NVARCHAR(256) NULL,
        QueryText NVARCHAR(MAX) NULL,
        Status NVARCHAR(30) NULL,
        CpuTimeMs BIGINT NULL,
        LogicalReads BIGINT NULL,
        IsHeadBlocker BIT NOT NULL CONSTRAINT DF_BlockingSessions_IsHeadBlocker DEFAULT (0),
        BlockedCount INT NOT NULL CONSTRAINT DF_BlockingSessions_BlockedCount DEFAULT (0),
        CapturedAt DATETIME2 NOT NULL CONSTRAINT DF_BlockingSessions_CapturedAt DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.DBCCResults', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DBCCResults (
        DbccResultId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DBCCResults PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        ServerId UNIQUEIDENTIFIER NOT NULL,
        DatabaseId UNIQUEIDENTIFIER NULL,
        DatabaseName NVARCHAR(128) NOT NULL,
        CheckType NVARCHAR(20) NOT NULL,
        RunDate DATETIME2 NOT NULL,
        DurationSeconds INT NULL,
        Status NVARCHAR(20) NOT NULL,
        ErrorsFound INT NOT NULL CONSTRAINT DF_DBCCResults_ErrorsFound DEFAULT (0),
        WarningsFound INT NOT NULL CONSTRAINT DF_DBCCResults_WarningsFound DEFAULT (0),
        RepairNeeded BIT NOT NULL CONSTRAINT DF_DBCCResults_RepairNeeded DEFAULT (0),
        OutputSummary NVARCHAR(MAX) NULL,
        DetailedResults NVARCHAR(MAX) NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_DBCCResults_CreatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.Thresholds', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Thresholds (
        ThresholdId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Thresholds PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        Name NVARCHAR(100) NOT NULL,
        MetricType NVARCHAR(50) NOT NULL,
        WarningValue DECIMAL(10,2) NOT NULL,
        CriticalValue DECIMAL(10,2) NOT NULL,
        Unit NVARCHAR(20) NULL,
        Description NVARCHAR(500) NULL,
        IsEnabled BIT NOT NULL CONSTRAINT DF_Thresholds_IsEnabled DEFAULT (1),
        AppliesToServers NVARCHAR(MAX) NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_Thresholds_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_Thresholds_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.ConnectionProfiles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConnectionProfiles (
        ProfileId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ConnectionProfiles PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        Name NVARCHAR(100) NOT NULL,
        ServerId UNIQUEIDENTIFIER NULL,
        Hostname NVARCHAR(255) NOT NULL,
        Port INT NOT NULL CONSTRAINT DF_ConnectionProfiles_Port DEFAULT (1433),
        InstanceName NVARCHAR(100) NULL,
        AuthType NVARCHAR(40) NOT NULL,
        Username NVARCHAR(200) NULL,
        PasswordHint NVARCHAR(100) NULL,
        TenantId NVARCHAR(100) NULL,
        ClientId NVARCHAR(100) NULL,
        SecretEnvKey NVARCHAR(100) NULL,
        EncryptedSecret NVARCHAR(MAX) NULL,
        [Database] NVARCHAR(128) NULL,
        Encrypt BIT NOT NULL CONSTRAINT DF_ConnectionProfiles_Encrypt DEFAULT (1),
        TrustServerCert BIT NOT NULL CONSTRAINT DF_ConnectionProfiles_TrustServerCert DEFAULT (0),
        ConnectionTimeout INT NOT NULL CONSTRAINT DF_ConnectionProfiles_ConnectionTimeout DEFAULT (30),
        Environment NVARCHAR(20) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_ConnectionProfiles_IsActive DEFAULT (1),
        LastTested DATETIME2 NULL,
        LastTestStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_ConnectionProfiles_LastTestStatus DEFAULT ('untested'),
        Notes NVARCHAR(MAX) NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_ConnectionProfiles_CreatedDate DEFAULT (GETUTCDATE()),
        UpdatedDate DATETIME2 NOT NULL CONSTRAINT DF_ConnectionProfiles_UpdatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Users PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        Username NVARCHAR(100) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(255) NOT NULL,
        Role NVARCHAR(20) NOT NULL,
        DisplayName NVARCHAR(100) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedDate DEFAULT (GETUTCDATE())
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Databases_Servers')
BEGIN
    ALTER TABLE dbo.Databases ADD CONSTRAINT FK_Databases_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Metrics_Servers')
BEGIN
    ALTER TABLE dbo.Metrics ADD CONSTRAINT FK_Metrics_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Metrics_Databases')
BEGIN
    ALTER TABLE dbo.Metrics ADD CONSTRAINT FK_Metrics_Databases FOREIGN KEY (DatabaseId) REFERENCES dbo.Databases(DatabaseId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Alerts_Servers')
BEGIN
    ALTER TABLE dbo.Alerts ADD CONSTRAINT FK_Alerts_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Alerts_Databases')
BEGIN
    ALTER TABLE dbo.Alerts ADD CONSTRAINT FK_Alerts_Databases FOREIGN KEY (DatabaseId) REFERENCES dbo.Databases(DatabaseId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_LogEvents_Servers')
BEGIN
    ALTER TABLE dbo.LogEvents ADD CONSTRAINT FK_LogEvents_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DiskVolumes_Servers')
BEGIN
    ALTER TABLE dbo.DiskVolumes ADD CONSTRAINT FK_DiskVolumes_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BlockingSessions_Servers')
BEGIN
    ALTER TABLE dbo.BlockingSessions ADD CONSTRAINT FK_BlockingSessions_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DBCCResults_Servers')
BEGIN
    ALTER TABLE dbo.DBCCResults ADD CONSTRAINT FK_DBCCResults_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DBCCResults_Databases')
BEGIN
    ALTER TABLE dbo.DBCCResults ADD CONSTRAINT FK_DBCCResults_Databases FOREIGN KEY (DatabaseId) REFERENCES dbo.Databases(DatabaseId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ConnectionProfiles_Servers')
BEGIN
    ALTER TABLE dbo.ConnectionProfiles ADD CONSTRAINT FK_ConnectionProfiles_Servers FOREIGN KEY (ServerId) REFERENCES dbo.Servers(ServerId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Metrics_ServerId_Timestamp' AND object_id = OBJECT_ID('dbo.Metrics'))
BEGIN
    CREATE INDEX IX_Metrics_ServerId_Timestamp ON dbo.Metrics (ServerId, [Timestamp] DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Alerts_ServerId_TriggeredAt' AND object_id = OBJECT_ID('dbo.Alerts'))
BEGIN
    CREATE INDEX IX_Alerts_ServerId_TriggeredAt ON dbo.Alerts (ServerId, TriggeredAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LogEvents_ServerId_EventTime' AND object_id = OBJECT_ID('dbo.LogEvents'))
BEGIN
    CREATE INDEX IX_LogEvents_ServerId_EventTime ON dbo.LogEvents (ServerId, EventTime DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Thresholds)
BEGIN
    INSERT INTO dbo.Thresholds (Name, MetricType, WarningValue, CriticalValue, Unit, Description)
    VALUES
      ('CPU Usage', 'cpu', 80, 90, 'percent', 'CPU threshold'),
      ('Memory Usage', 'memory', 85, 95, 'percent', 'Memory threshold'),
      ('Disk Usage', 'disk', 80, 90, 'percent', 'Disk threshold'),
      ('Log Space Usage', 'log_space', 70, 85, 'percent', 'Log space threshold'),
      ('Backup Age', 'backup_age', 26, 48, 'hours', 'Backup age threshold'),
      ('DBCC Age', 'dbcc_age', 14, 30, 'days', 'DBCC age threshold'),
      ('Blocking Time', 'blocking_ms', 5000, 30000, 'ms', 'Blocking threshold');
END
GO
