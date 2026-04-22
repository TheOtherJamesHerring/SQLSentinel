import { Router } from "express";
import sql from "mssql";
import { query } from "../db/sql.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { decryptConnectionSecret, encryptConnectionSecret } from "../utils/connection-secret.js";

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

function sanitizeProfile<T extends Record<string, unknown>>(row: T) {
  const { EncryptedSecret, ...safe } = row;
  return safe;
}

function normalizeAuthType(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "entra_sp" || (text.includes("entra") && text.includes("service"))) {
    return "entra_sp" as const;
  }
  if (text.includes("windows")) {
    return "windows" as const;
  }
  return "sql" as const;
}

function getSecretFromProfile(profile: Record<string, unknown>) {
  const encrypted = profile.EncryptedSecret == null ? "" : String(profile.EncryptedSecret);
  if (encrypted) {
    return decryptConnectionSecret(encrypted);
  }
  const envKey = profile.SecretEnvKey == null ? "" : String(profile.SecretEnvKey);
  return envKey ? (process.env[envKey] ?? "") : "";
}

function getSubmittedSecret(body: Record<string, unknown>) {
  const password = body.password == null ? "" : String(body.password);
  if (password) return password;
  const clientSecret = body.clientSecret == null ? "" : String(body.clientSecret);
  if (clientSecret) return clientSecret;
  return "";
}

connectionsRouter.get("/", async (_req, res, next) => {
  try {
    const rows = await query<Record<string, unknown>>(`
      SELECT
        ProfileId,
        Name,
        ServerId,
        Hostname,
        Port,
        InstanceName,
        AuthType,
        Username,
        PasswordHint,
        TenantId,
        ClientId,
        SecretEnvKey,
        [Database],
        Encrypt,
        TrustServerCert,
        ConnectionTimeout,
        Environment,
        IsActive,
        LastTested,
        LastTestStatus,
        Notes,
        CreatedDate,
        UpdatedDate
      FROM ConnectionProfiles
      ORDER BY Name
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.post("/", requireRole(["admin"]), async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const submittedSecret = getSubmittedSecret(body);
    const encryptedSecret = submittedSecret ? encryptConnectionSecret(submittedSecret) : null;

    const rows = await query<Record<string, unknown>>(`
      INSERT INTO ConnectionProfiles(Name, Hostname, Port, InstanceName, AuthType, Username, SecretEnvKey, TenantId, ClientId, EncryptedSecret, [Database], Encrypt, TrustServerCert, ConnectionTimeout, Environment, Notes)
      OUTPUT INSERTED.*
      VALUES(@name, @hostname, @port, @instanceName, @authType, @username, @secretEnvKey, @tenantId, @clientId, @encryptedSecret, @database, @encrypt, @trustServerCert, @connectionTimeout, @environment, @notes)
    `, { ...body, encryptedSecret });
    res.status(201).json({ data: sanitizeProfile(rows[0]) });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.patch("/:id", requireRole(["admin"]), async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const submittedSecret = getSubmittedSecret(body);
    const encryptedSecret = submittedSecret ? encryptConnectionSecret(submittedSecret) : null;

    const rows = await query<Record<string, unknown>>(`
      UPDATE ConnectionProfiles
      SET Name = COALESCE(@name, Name),
          Hostname = COALESCE(@hostname, Hostname),
          Port = COALESCE(@port, Port),
          AuthType = COALESCE(@authType, AuthType),
          Username = COALESCE(@username, Username),
          SecretEnvKey = COALESCE(@secretEnvKey, SecretEnvKey),
          TenantId = COALESCE(@tenantId, TenantId),
          ClientId = COALESCE(@clientId, ClientId),
          EncryptedSecret = COALESCE(@encryptedSecret, EncryptedSecret),
          [Database] = COALESCE(@database, [Database]),
          Encrypt = COALESCE(@encrypt, Encrypt),
          TrustServerCert = COALESCE(@trustServerCert, TrustServerCert),
          ConnectionTimeout = COALESCE(@connectionTimeout, ConnectionTimeout),
          Environment = COALESCE(@environment, Environment),
          Notes = COALESCE(@notes, Notes),
          UpdatedDate = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE ProfileId = @id
    `, { ...body, encryptedSecret, id: req.params.id });
    res.json({ data: sanitizeProfile(rows[0]) });
  } catch (error) {
    next(error);
  }
});

connectionsRouter.delete("/:id", requireRole(["admin"]), async (req, res, next) => {
  try {
    await query(`DELETE FROM ConnectionProfiles WHERE ProfileId = @id`, { id: req.params.id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Test a connection using raw credentials (no saved profile needed — used during onboarding wizard)
connectionsRouter.post("/test-inline", requireAuth, async (req, res, next) => {
  try {
    const { hostname, port, instanceName, username, password, database, encrypt, trustServerCert } = req.body as {
      hostname: string;
      port?: number;
      instanceName?: string;
      username: string;
      password: string;
      database?: string;
      encrypt?: boolean;
      trustServerCert?: boolean;
    };
    if (!hostname || !username || password === undefined) {
      res.status(400).json({ message: "hostname, username, and password are required" });
      return;
    }
    const config: sql.config = {
      server: hostname,
      port: port ?? 1433,
      ...(instanceName ? { options: { instanceName } } : {}),
      user: username,
      password,
      database: database ?? "master",
      options: {
        ...(instanceName ? { instanceName } : {}),
        encrypt: encrypt ?? true,
        trustServerCertificate: trustServerCert ?? true
      },
      connectionTimeout: 15000
    };
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT @@VERSION AS [version], @@SERVERNAME AS [serverName], DB_NAME() AS [dbName]");
    await pool.close();
    res.json({ data: { status: "online", ...result.recordset[0] } });
  } catch (error: any) {
    res.status(400).json({ message: error?.message ?? "Connection failed" });
  }
});

connectionsRouter.post("/:id/test", requireRole(["admin"]), async (req, res, next) => {
  try {
    const [profile] = await query<any>(`SELECT * FROM ConnectionProfiles WHERE ProfileId = @id`, { id: req.params.id });
    if (!profile) {
      res.status(404).json({ message: "Connection profile not found" });
      return;
    }

    const authType = normalizeAuthType(profile.AuthType);
    const secret = getSecretFromProfile(profile);
    if (!secret) {
      res.status(400).json({ message: "No secret available for this profile. Save a password/client secret or provide a valid SecretEnvKey." });
      return;
    }

    const baseConfig: sql.config = {
      server: profile.Hostname,
      port: profile.Port,
      database: profile.Database ?? "master",
      options: {
        encrypt: Boolean(profile.Encrypt),
        trustServerCertificate: Boolean(profile.TrustServerCert),
        ...(profile.InstanceName ? { instanceName: profile.InstanceName } : {})
      },
      connectionTimeout: profile.ConnectionTimeout * 1000
    };

    const config: sql.config = authType === "entra_sp"
      ? {
          ...baseConfig,
          authentication: {
            type: "azure-active-directory-service-principal-secret",
            options: {
              tenantId: String(profile.TenantId ?? ""),
              clientId: String(profile.ClientId ?? ""),
              clientSecret: secret
            }
          }
        }
      : {
          ...baseConfig,
          user: profile.Username,
          password: secret
        };

    const pool = await sql.connect(config);
    await pool.request().query("SELECT 1 AS ok");
    await pool.close();
    await query(`UPDATE ConnectionProfiles SET LastTested = GETUTCDATE(), LastTestStatus = 'online' WHERE ProfileId = @id`, { id: req.params.id });
    res.json({ data: { status: "online" } });
  } catch (error) {
    await query(`UPDATE ConnectionProfiles SET LastTested = GETUTCDATE(), LastTestStatus = 'failed' WHERE ProfileId = @id`, { id: req.params.id });
    next(error);
  }
});
