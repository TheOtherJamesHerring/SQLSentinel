/*
  Run this on the SQL Server instance hosting SQLMonitorDB.
  Replace <STRONG_PASSWORD> before execution.
  This is the API service login, separate from monitored-server collector logins.
*/

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sqlmonitor_api')
BEGIN
    CREATE LOGIN [sqlmonitor_api] WITH PASSWORD = '<STRONG_PASSWORD>';
END
GO

IF DB_ID('SQLMonitorDB') IS NULL
BEGIN
    THROW 50000, 'SQLMonitorDB does not exist on this SQL Server instance.', 1;
END
GO

USE SQLMonitorDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sqlmonitor_api')
BEGIN
    CREATE USER [sqlmonitor_api] FOR LOGIN [sqlmonitor_api];
END
GO

ALTER ROLE db_owner ADD MEMBER [sqlmonitor_api];
GO