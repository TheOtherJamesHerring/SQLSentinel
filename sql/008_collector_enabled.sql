-- Add CollectorEnabled column to Servers table to allow disabling collector per instance
-- Supports stopping collection without deleting the server record

USE SQLMonitorDB;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Servers' AND COLUMN_NAME = 'CollectorEnabled')
BEGIN
    ALTER TABLE dbo.Servers
    ADD CollectorEnabled BIT NOT NULL CONSTRAINT DF_Servers_CollectorEnabled DEFAULT (1);
END
GO

-- Create index on CollectorEnabled for filtering active collectors
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Servers_CollectorEnabled' AND object_id = OBJECT_ID('dbo.Servers'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Servers_CollectorEnabled ON dbo.Servers(CollectorEnabled) WHERE CollectorEnabled = 1;
END
GO
