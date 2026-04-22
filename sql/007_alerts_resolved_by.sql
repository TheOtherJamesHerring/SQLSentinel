-- ============================================================================
-- Migration: Add ResolvedBy column to Alerts table
-- Purpose: Track who resolved each alert
-- ============================================================================

IF OBJECT_ID('dbo.Alerts', 'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Alerts', 'U') AND name = 'ResolvedBy')
BEGIN
  ALTER TABLE dbo.Alerts ADD ResolvedBy NVARCHAR(200) NULL;
  PRINT 'Added ResolvedBy column to Alerts table';
END
ELSE IF OBJECT_ID('dbo.Alerts', 'U') IS NULL
BEGIN
  PRINT 'Alerts table does not exist; skipping migration.';
END
ELSE
BEGIN
  PRINT 'ResolvedBy column already exists; no changes made.';
END
GO
