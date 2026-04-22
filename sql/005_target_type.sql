-- Add TargetType column to Servers table to support multi-platform SQL targets
-- Supports: on-prem, sql-mi, azure-sql-db, fabric-sql

USE SQLMonitorDB;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Servers' AND COLUMN_NAME = 'TargetType')
BEGIN
    ALTER TABLE dbo.Servers
    ADD TargetType NVARCHAR(20) NOT NULL CONSTRAINT DF_Servers_TargetType DEFAULT ('on-prem')
        CONSTRAINT CK_Servers_TargetType CHECK (TargetType IN ('on-prem', 'sql-mi', 'azure-sql-db', 'fabric-sql'));
END
GO

-- Create index on TargetType for filtering queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Servers_TargetType' AND object_id = OBJECT_ID('dbo.Servers'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Servers_TargetType ON dbo.Servers(TargetType);
END
GO
