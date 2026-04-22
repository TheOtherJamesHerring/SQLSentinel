/*
  Run this on each monitored SQL Server instance.
  Replace <STRONG_PASSWORD> before execution.

  Permission profile: "remote DBA read" for SQLSentinnel collector.
  This grants broad read/diagnostic visibility without write access.
*/

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sqlmonitor_svc')
BEGIN
    CREATE LOGIN [sqlmonitor_svc] WITH PASSWORD = '<STRONG_PASSWORD>';
END
GO

/* Server-scope visibility for DMVs and database discovery */
GRANT VIEW SERVER STATE TO [sqlmonitor_svc];
GRANT VIEW ANY DATABASE TO [sqlmonitor_svc];
GRANT VIEW ANY DEFINITION TO [sqlmonitor_svc];
GRANT CONNECT ANY DATABASE TO [sqlmonitor_svc];
GO

USE [master];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sqlmonitor_svc')
BEGIN
    CREATE USER [sqlmonitor_svc] FOR LOGIN [sqlmonitor_svc];
END
GO

GRANT EXECUTE ON dbo.sp_readerrorlog TO [sqlmonitor_svc];
GO

USE [msdb];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sqlmonitor_svc')
BEGIN
    CREATE USER [sqlmonitor_svc] FOR LOGIN [sqlmonitor_svc];
END
GO

GRANT SELECT ON dbo.backupset TO [sqlmonitor_svc];
GRANT SELECT ON dbo.backupmediafamily TO [sqlmonitor_svc];
GRANT SELECT ON dbo.sysjobs TO [sqlmonitor_svc];
GO

/* Per-database visibility required by Query Store and DB-level DMVs */
DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql + N'
USE ' + QUOTENAME(d.name) + N';
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N''sqlmonitor_svc'')
BEGIN
  CREATE USER [sqlmonitor_svc] FOR LOGIN [sqlmonitor_svc];
END;
GRANT CONNECT TO [sqlmonitor_svc];
GRANT VIEW DATABASE STATE TO [sqlmonitor_svc];
ALTER ROLE [db_datareader] ADD MEMBER [sqlmonitor_svc];
'
FROM sys.databases AS d
WHERE d.state_desc = 'ONLINE'
  AND d.name <> N'tempdb';

EXEC sys.sp_executesql @sql;
GO
