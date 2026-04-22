/*
  SQLSentinnel: Elevate sqlmonitor_api for blue-team security interrogation

  Usage:
    1) Review and set @GrantSysadmin.
    2) Execute on the SQL Server instance used by the app for security posture queries.

  Modes:
    - @GrantSysadmin = 0 (default): broad read-only blue-team visibility
    - @GrantSysadmin = 1: full sysadmin (strongest coverage, highest privilege)
*/

DECLARE @LoginName SYSNAME = N'sqlmonitor_api';
DECLARE @GrantSysadmin BIT = 0;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @LoginName)
BEGIN
  THROW 50001, 'Login sqlmonitor_api does not exist. Run scripts/create_sqlmonitor_api_login.sql first.', 1;
END;

/* Server-level visibility for posture interrogation */
GRANT VIEW SERVER STATE TO [sqlmonitor_api];
GRANT VIEW ANY DATABASE TO [sqlmonitor_api];
GRANT CONNECT ANY DATABASE TO [sqlmonitor_api];
GRANT VIEW ANY DEFINITION TO [sqlmonitor_api];

/* SQL Server 2022+ permission; ignored safely on older versions */
BEGIN TRY
  GRANT VIEW SERVER SECURITY STATE TO [sqlmonitor_api];
END TRY
BEGIN CATCH
  PRINT 'VIEW SERVER SECURITY STATE is unavailable on this version; continuing.';
END CATCH;

/* Optional full elevation */
IF @GrantSysadmin = 1
BEGIN
  IF IS_SRVROLEMEMBER('sysadmin', @LoginName) <> 1
  BEGIN
    ALTER SERVER ROLE [sysadmin] ADD MEMBER [sqlmonitor_api];
  END;
END;

/* Database-level visibility across online databases */
DECLARE @db SYSNAME;
DECLARE @sql NVARCHAR(MAX);

DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
SELECT name
FROM sys.databases
WHERE state_desc = 'ONLINE'
  AND name <> N'tempdb';

OPEN dbs;
FETCH NEXT FROM dbs INTO @db;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'
USE ' + QUOTENAME(@db) + N';

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N''' + REPLACE(@LoginName, '''', '''''') + N''')
BEGIN
  CREATE USER ' + QUOTENAME(@LoginName) + N' FOR LOGIN ' + QUOTENAME(@LoginName) + N';
END;

GRANT CONNECT TO ' + QUOTENAME(@LoginName) + N';
GRANT VIEW DEFINITION TO ' + QUOTENAME(@LoginName) + N';
GRANT VIEW DATABASE STATE TO ' + QUOTENAME(@LoginName) + N';

IF NOT EXISTS (
  SELECT 1
  FROM sys.database_role_members drm
  JOIN sys.database_principals r ON r.principal_id = drm.role_principal_id
  JOIN sys.database_principals m ON m.principal_id = drm.member_principal_id
  WHERE r.name = N''db_datareader''
    AND m.name = N''' + REPLACE(@LoginName, '''', '''''') + N'''
)
BEGIN
  ALTER ROLE [db_datareader] ADD MEMBER ' + QUOTENAME(@LoginName) + N';
END;';

  BEGIN TRY
    EXEC sys.sp_executesql @sql;
  END TRY
  BEGIN CATCH
    PRINT CONCAT('Skipped database ', @db, ': ', ERROR_MESSAGE());
  END CATCH;

  FETCH NEXT FROM dbs INTO @db;
END;

CLOSE dbs;
DEALLOCATE dbs;

PRINT 'sqlmonitor_api blue-team elevation complete.';
PRINT 'Set @GrantSysadmin = 1 if you need full unrestricted posture coverage.';
