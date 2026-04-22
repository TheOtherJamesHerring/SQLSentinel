IF COL_LENGTH('dbo.ConnectionProfiles', 'EncryptedSecret') IS NULL
BEGIN
    ALTER TABLE dbo.ConnectionProfiles
    ADD EncryptedSecret NVARCHAR(MAX) NULL;
END
GO
