import { Router } from "express";
import sql from "mssql";
import { query } from "../db/sql.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { decryptConnectionSecret, encryptConnectionSecret } from "../utils/connection-secret.js";

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

const DEFAULT_ENTRA_PUBLIC_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const e = error as {
      message?: unknown;
      code?: unknown;
      name?: unknown;
      originalError?: { message?: unknown; info?: { message?: unknown } };
      errors?: Array<{ message?: unknown }>;
      precedingErrors?: Array<{ message?: unknown }>;
    };

    const candidates: unknown[] = [
      e.originalError?.message,
      e.originalError?.info?.message,
      e.errors?.[0]?.message,
      e.precedingErrors?.[0]?.message,
      e.message
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }

    const code = typeof e.code === "string" ? e.code : "";
    const name = typeof e.name === "string" ? e.name : "";
    if (code || name) {
      return `Connection failed (${[name, code].filter(Boolean).join(": ")})`;
    }
  }

  return "Connection failed. The server returned an empty error payload.";
}

function getConnectionTestErrorMessage(
  error: unknown,
  context: { targetType?: string; authType?: string }
): string {
  const base = getErrorMessage(error);
  const normalized = normalizeAuthType(context.authType);
  const targetType = String(context.targetType ?? "").toLowerCase();

  const isGenericConnectionError =
    base === "Connection failed. The server returned an empty error payload." ||
    base.includes("ConnectionError") ||
    base === "Connection failed";

  if (isGenericConnectionError && targetType === "fabric-sql" && normalized === "entra_password") {
    return "Fabric SQL login failed with a generic connection error. This usually means username/password auth is blocked by MFA or Conditional Access. Try Microsoft Entra Service Principal auth, or test interactive MFA with SSMS/Azure Data Studio. If Entra Password must be used, verify tenant allows non-interactive password flow for this account.";
  }

  if (isGenericConnectionError && normalized === "entra_password") {
    return "Microsoft Entra Password login failed with a generic connection error. Verify tenant ID, username/password, and that non-interactive password auth is allowed by tenant policy (no MFA/Conditional Access block).";
  }

  return base;
}

function sanitizeProfile<T extends Record<string, unknown>>(row: T) {
  const { EncryptedSecret, ...safe } = row;
  return safe;
}

function normalizeAuthType(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "entra_password" || (text.includes("entra") && text.includes("password"))) {
    return "entra_password" as const;
  }
  if (text === "entra_sp" || (text.includes("entra") && text.includes("service"))) {
    return "entra_sp" as const;
  }
  if (text === "entra_mfa" || (text.includes("entra") && text.includes("mfa"))) {
    return "entra_mfa" as const;
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
    const params = {
      name: body.name ?? null,
      hostname: body.hostname ?? null,
      port: body.port ?? null,
      instanceName: body.instanceName ?? null,
      authType: body.authType ?? null,
      username: body.username ?? null,
      secretEnvKey: body.secretEnvKey ?? null,
      tenantId: body.tenantId ?? null,
      clientId: body.clientId ?? null,
      encryptedSecret,
      database: body.database ?? null,
      encrypt: body.encrypt ?? null,
      trustServerCert: body.trustServerCert ?? null,
      connectionTimeout: body.connectionTimeout ?? null,
      environment: body.environment ?? null,
      notes: body.notes ?? null
    };

    const rows = await query<Record<string, unknown>>(`
      INSERT INTO ConnectionProfiles(Name, Hostname, Port, InstanceName, AuthType, Username, SecretEnvKey, TenantId, ClientId, EncryptedSecret, [Database], Encrypt, TrustServerCert, ConnectionTimeout, Environment, Notes)
      OUTPUT INSERTED.*
      VALUES(@name, @hostname, @port, @instanceName, @authType, @username, @secretEnvKey, @tenantId, @clientId, @encryptedSecret, @database, @encrypt, @trustServerCert, @connectionTimeout, @environment, @notes)
    `, params);
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
    const params = {
      id: req.params.id,
      name: body.name ?? null,
      hostname: body.hostname ?? null,
      port: body.port ?? null,
      authType: body.authType ?? null,
      username: body.username ?? null,
      secretEnvKey: body.secretEnvKey ?? null,
      tenantId: body.tenantId ?? null,
      clientId: body.clientId ?? null,
      encryptedSecret,
      database: body.database ?? null,
      encrypt: body.encrypt ?? null,
      trustServerCert: body.trustServerCert ?? null,
      connectionTimeout: body.connectionTimeout ?? null,
      environment: body.environment ?? null,
      notes: body.notes ?? null
    };

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
    `, params);
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
  let requestContext: { targetType?: string; authType?: string } = {};
  try {
    const { 
      targetType, authType, hostname, port, instanceName, username, password, tenantId, clientId, database, encrypt, trustServerCert 
    } = req.body as {
      targetType?: string;
      authType?: string;
      hostname: string;
      port?: number;
      instanceName?: string;
      username: string;
      password: string;
      tenantId?: string;
      clientId?: string;
      database?: string;
      encrypt?: boolean;
      trustServerCert?: boolean;
    };

    if (!hostname) {
      res.status(400).json({ message: "hostname is required" });
      return;
    }

    // Platform-specific validation
    const dbTargetType = targetType || "on-prem";
    const normalizedAuthType = normalizeAuthType(authType);
    requestContext = { targetType: dbTargetType, authType: normalizedAuthType };
    if (dbTargetType === "azure-sql-db" && !hostname.toLowerCase().includes(".database.windows.net")) {
      res.status(400).json({ message: "Azure SQL Database hostname must contain '.database.windows.net'" });
      return;
    }
    if (dbTargetType === "fabric-sql" && !hostname.toLowerCase().includes(".datawarehouse.fabric.microsoft.com")) {
      res.status(400).json({ message: "Fabric SQL hostname must contain '.datawarehouse.fabric.microsoft.com'" });
      return;
    }

    // For Azure SQL DB and Fabric SQL, ignore instanceName (database-level scope only)
    const normalizedInstanceName = (dbTargetType === "azure-sql-db" || dbTargetType === "fabric-sql") ? undefined : instanceName;

    const baseConfig: sql.config = {
      server: hostname,
      port: port ?? 1433,
      ...(normalizedInstanceName ? { options: { instanceName: normalizedInstanceName } } : {}),
      database: database ?? "master",
      options: {
        ...(normalizedInstanceName ? { instanceName: normalizedInstanceName } : {}),
        encrypt: encrypt ?? true,
        trustServerCertificate: trustServerCert ?? true
      },
      connectionTimeout: 15000
    };

    if (normalizedAuthType === "entra_mfa") {
      res.status(400).json({
        message: "Interactive Microsoft Entra MFA is not supported by this server-side test flow. Use Entra Password, Entra Service Principal, or test with SSMS/Azure Data Studio."
      });
      return;
    }

    const config: sql.config = normalizedAuthType === "entra_sp"
      ? {
          ...baseConfig,
          authentication: {
            type: "azure-active-directory-service-principal-secret",
            options: {
              tenantId: String(tenantId ?? ""),
              clientId: String(clientId || username || ""),
              clientSecret: String(password ?? "")
            }
          }
        }
      : normalizedAuthType === "entra_password"
        ? {
            ...baseConfig,
            authentication: {
              type: "azure-active-directory-password",
              options: {
                userName: String(username ?? ""),
                password: String(password ?? ""),
                clientId: String(clientId ?? DEFAULT_ENTRA_PUBLIC_CLIENT_ID),
                tenantId: String(tenantId ?? "")
              }
            }
          }
        : {
            ...baseConfig,
            user: username,
            password
          };

    if ((normalizedAuthType === "sql" || normalizedAuthType === "windows" || normalizedAuthType === "entra_password") && (!username || password === undefined)) {
      res.status(400).json({ message: "username and password are required for this authentication type" });
      return;
    }

    if (normalizedAuthType === "entra_password" && !tenantId) {
      res.status(400).json({ message: "tenantId is required for Microsoft Entra Password authentication" });
      return;
    }

    if (normalizedAuthType === "entra_sp" && (!password || !(clientId || username))) {
      res.status(400).json({ message: "client ID (or username) and client secret are required for Entra service principal authentication" });
      return;
    }
    
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT @@VERSION AS [version], @@SERVERNAME AS [serverName], DB_NAME() AS [dbName]");
    await pool.close();
    res.json({ data: { status: "online", targetType: dbTargetType, ...result.recordset[0] } });
  } catch (error: unknown) {
    res.status(400).json({ message: getConnectionTestErrorMessage(error, requestContext) });
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

    if (authType === "entra_mfa") {
      res.status(400).json({
        message: "Interactive Microsoft Entra MFA is not supported by this API test route. Use Entra Password or Entra Service Principal credentials."
      });
      return;
    }

    if (authType === "entra_password" && !profile.TenantId) {
      res.status(400).json({
        message: "Connection profile is missing TenantId required for Microsoft Entra Password authentication."
      });
      return;
    }

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
      : authType === "entra_password"
        ? {
            ...baseConfig,
            authentication: {
              type: "azure-active-directory-password",
              options: {
                userName: String(profile.Username ?? ""),
                password: secret,
                clientId: String(profile.ClientId ?? DEFAULT_ENTRA_PUBLIC_CLIENT_ID),
                tenantId: String(profile.TenantId ?? "")
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
