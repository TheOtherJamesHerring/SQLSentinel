-- Migration 005: Backup metadata columns for Databases
-- Stores latest backup name, location, and headerfile_only (mapped from is_copy_only)

IF COL_LENGTH('dbo.Databases', 'FullBackupName') IS NULL
  ALTER TABLE dbo.Databases ADD FullBackupName NVARCHAR(256) NULL;
GO

IF COL_LENGTH('dbo.Databases', 'DiffBackupName') IS NULL
  ALTER TABLE dbo.Databases ADD DiffBackupName NVARCHAR(256) NULL;
GO

IF COL_LENGTH('dbo.Databases', 'LogBackupName') IS NULL
  ALTER TABLE dbo.Databases ADD LogBackupName NVARCHAR(256) NULL;
GO

IF COL_LENGTH('dbo.Databases', 'FullHeaderFileOnly') IS NULL
  ALTER TABLE dbo.Databases ADD FullHeaderFileOnly BIT NULL;
GO

IF COL_LENGTH('dbo.Databases', 'DiffHeaderFileOnly') IS NULL
  ALTER TABLE dbo.Databases ADD DiffHeaderFileOnly BIT NULL;
GO

IF COL_LENGTH('dbo.Databases', 'LogHeaderFileOnly') IS NULL
  ALTER TABLE dbo.Databases ADD LogHeaderFileOnly BIT NULL;
GO

IF COL_LENGTH('dbo.Databases', 'FullBackupLocation') IS NULL
  ALTER TABLE dbo.Databases ADD FullBackupLocation NVARCHAR(1024) NULL;
GO

IF COL_LENGTH('dbo.Databases', 'DiffBackupLocation') IS NULL
  ALTER TABLE dbo.Databases ADD DiffBackupLocation NVARCHAR(1024) NULL;
GO

IF COL_LENGTH('dbo.Databases', 'LogBackupLocation') IS NULL
  ALTER TABLE dbo.Databases ADD LogBackupLocation NVARCHAR(1024) NULL;
GO
