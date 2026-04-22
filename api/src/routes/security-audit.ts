import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { query } from "../db/sql.js";
import { requireAuth } from "../middleware/auth.js";

type RiskFlag = "CRITICAL" | "HIGH_RISK" | "MEDIUM_RISK" | "BLIND_SPOT" | "OK";

interface SecurityAuditFinding {
  server_name: string;
  audit_timestamp_utc: string;
  check_name: string;
  finding: string;
  detail: string;
  risk_flag: RiskFlag;
}

interface SecurityAuditRunSummary {
  runId: string;
  ranAtUtc: string;
  targetLabel: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  counts: Record<RiskFlag, number>;
  exportStatus: "skipped" | "success" | "failed";
  exportMessage: string;
}

interface SecurityAuditRunDetail extends SecurityAuditRunSummary {
  findings: SecurityAuditFinding[];
}

const runSchema = z.object({
  sqlTarget: z.object({
    targetLabel: z.string().min(1).max(120),
    environment: z.string().max(80).optional(),
    notes: z.string().max(200).optional()
  }),
  fabric: z.object({
    enabled: z.boolean().default(false),
    tenantId: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    workspaceId: z.string().optional(),
    lakehouseId: z.string().optional(),
    filePrefix: z.string().optional(),
    scope: z.string().optional(),
    baseUrl: z.string().optional()
  })
});

const MAX_HISTORY = 50;
const runHistory: SecurityAuditRunDetail[] = [];

const RISK_WEIGHT: Record<RiskFlag, number> = {
  CRITICAL: 25,
  HIGH_RISK: 15,
  MEDIUM_RISK: 8,
  BLIND_SPOT: 10,
  OK: 0
};

const remediationByCheck: Record<string, string> = {
  sysadmin_membership:
    "Restrict sysadmin to dedicated break-glass principals only. Remove broad group membership and enforce just-in-time elevation.",
  login_state_and_type:
    "Disable unused logins, prefer integrated identities where possible, and enforce least-privilege role assignments.",
  impersonate_permissions:
    "Review and revoke broad IMPERSONATE grants. Keep impersonation scoped to explicit operational requirements.",
  trustworthy_owner:
    "Disable TRUSTWORTHY for user databases unless strictly required. Never pair TRUSTWORTHY with high-privilege ownership.",
  cross_db_ownership_chaining:
    "Turn off cross-database ownership chaining unless there is a documented dependency and compensating controls.",
  xp_cmdshell:
    "Keep xp_cmdshell disabled. If temporary enablement is required, tightly control execution and disable immediately after use.",
  clr_assemblies:
    "Review user-defined CLR assemblies and remove UNSAFE/EXTERNAL_ACCESS permissions unless formally approved.",
  linked_servers:
    "Review linked server trust boundaries, credential mappings, and remove stale or unnecessary linked server definitions.",
  sql_server_audit:
    "Enable and validate SQL Server Audit coverage for login changes, permission changes, and privileged activity paths.",
  db_owner_proliferation:
    "Restrict db_owner role to a single dedicated principal per database. Remove excess owners to limit blast radius.",
  orphaned_users:
    "Identify and remove orphaned database users that lack a corresponding server login. Prevents account hijacking and clarifies permissions.",
  db_role_membership_excess:
    "Audit and restrict membership in db_securityadmin and db_ddladmin roles. Replace broad roles with explicit object-level permissions.",
  db_dangerous_permissions:
    "Remove broad CONTROL, ALTER, or TAKE OWNERSHIP grants at the database scope. Replace them with narrowly scoped object-level permissions.",
  db_access_blind_spot:
    "Grant the audit principal access to the target database or explicitly exclude that database from posture scope. Inaccessible databases are blind spots and reduce audit completeness.",
  cross_db_chaining_per_db:
    "Disable database-level cross-database ownership chaining. Use explicit GRANT statements or certificate signing for cross-database access.",
  trustworthy_clr_combo:
    "Eliminate combinations of TRUSTWORTHY + CLR + sysadmin-class database owner. Use certificate signing and SAFE assemblies instead."
};

function countByRisk(findings: SecurityAuditFinding[]): Record<RiskFlag, number> {
  // Score and summary operate at check granularity (highest-risk instance per check),
  // so one noisy check across many rows does not zero out the entire posture score.
  const byCheck = new Map<string, SecurityAuditFinding>();
  for (const finding of findings) {
    const existing = byCheck.get(finding.check_name);
    if (!existing || RISK_WEIGHT[finding.risk_flag] > RISK_WEIGHT[existing.risk_flag]) {
      byCheck.set(finding.check_name, finding);
    }
  }

  const normalized = [...byCheck.values()];
  return normalized.reduce(
    (acc, finding) => {
      acc[finding.risk_flag] += 1;
      return acc;
    },
    {
      CRITICAL: 0,
      HIGH_RISK: 0,
      MEDIUM_RISK: 0,
      BLIND_SPOT: 0,
      OK: 0
    } as Record<RiskFlag, number>
  );
}

function computeScore(findings: SecurityAuditFinding[]): { score: number; grade: "A" | "B" | "C" | "D" | "F" } {
  const counts = countByRisk(findings);
  const deductions =
    counts.CRITICAL * 25 +
    counts.HIGH_RISK * 15 +
    counts.MEDIUM_RISK * 8 +
    counts.BLIND_SPOT * 10;
  const score = Math.max(0, 100 - deductions);

  if (score >= 90) return { score, grade: "A" };
  if (score >= 75) return { score, grade: "B" };
  if (score >= 60) return { score, grade: "C" };
  if (score >= 40) return { score, grade: "D" };
  return { score, grade: "F" };
}

function pushHistory(entry: SecurityAuditRunDetail) {
  runHistory.unshift(entry);
  if (runHistory.length > MAX_HISTORY) {
    runHistory.length = MAX_HISTORY;
  }
}

function parseAuditJson(raw: string): SecurityAuditFinding[] {
  try {
    const parsed = JSON.parse(raw) as { sql_security_audit?: SecurityAuditFinding[] };
    return (parsed.sql_security_audit ?? []).map((row) => ({
      server_name: row.server_name,
      audit_timestamp_utc: row.audit_timestamp_utc,
      check_name: row.check_name,
      finding: row.finding,
      detail: row.detail,
      risk_flag: row.risk_flag
    }));
  } catch {
    return [];
  }
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function exportToFabric(runId: string, payload: unknown, config: z.infer<typeof runSchema>["fabric"]) {
  if (!config.enabled) {
    return { status: "skipped" as const, message: "Fabric export disabled" };
  }

  const required = [config.tenantId, config.clientId, config.clientSecret, config.workspaceId, config.lakehouseId];
  if (required.some((value) => !value)) {
    return { status: "failed" as const, message: "Fabric export configuration is incomplete" };
  }

  try {
    const tokenBody = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      scope: config.scope && config.scope.trim().length > 0 ? config.scope : "https://storage.azure.com/.default"
    });

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId!)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString()
      }
    );

    if (!tokenResponse.ok) {
      const message = await tokenResponse.text();
      return { status: "failed" as const, message: `Fabric token request failed: ${message}` };
    }

    const tokenJson = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      return { status: "failed" as const, message: "Fabric token response missing access_token" };
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const prefix = (config.filePrefix ?? "SQLSentinnel/security-audit").replace(/^\/+|\/+$/g, "");
    const relativePath = `${prefix}/${day}/${runId}.json`;
    const baseUrl = (config.baseUrl ?? "https://onelake.dfs.fabric.microsoft.com").replace(/\/+$/, "");
    const fileUrl = `${baseUrl}/${encodeURIComponent(config.workspaceId!)}/${encodeURIComponent(config.lakehouseId!)}.Lakehouse/Files/${encodePath(relativePath)}`;

    const createResponse = await fetch(`${fileUrl}?resource=file`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "x-ms-version": "2021-12-02"
      }
    });

    if (!createResponse.ok && createResponse.status !== 409) {
      const message = await createResponse.text();
      return { status: "failed" as const, message: `Fabric file create failed: ${message}` };
    }

    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const bytes = Buffer.byteLength(content);

    const appendResponse = await fetch(`${fileUrl}?action=append&position=0`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "Content-Type": "application/json",
        "x-ms-version": "2021-12-02"
      },
      body: content
    });

    if (!appendResponse.ok) {
      const message = await appendResponse.text();
      return { status: "failed" as const, message: `Fabric append failed: ${message}` };
    }

    const flushResponse = await fetch(`${fileUrl}?action=flush&position=${bytes}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "x-ms-version": "2021-12-02"
      }
    });

    if (!flushResponse.ok) {
      const message = await flushResponse.text();
      return { status: "failed" as const, message: `Fabric flush failed: ${message}` };
    }

    return { status: "success" as const, message: `Exported to ${relativePath}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Fabric export error";
    return { status: "failed" as const, message };
  }
}

const auditSql = `
DECLARE @audit_timestamp_utc DATETIME2(0) = GETUTCDATE();
DECLARE @server_name NVARCHAR(128) = CAST(SERVERPROPERTY('ServerName') AS NVARCHAR(128));

CREATE TABLE #findings (
  check_name NVARCHAR(128) NOT NULL,
  finding NVARCHAR(512) NOT NULL,
  detail NVARCHAR(MAX) NOT NULL,
  risk_flag NVARCHAR(32) NOT NULL
);

INSERT INTO #findings (check_name, finding, detail, risk_flag)
SELECT check_name, finding, detail, risk_flag
FROM (
    SELECT
      'sysadmin_membership' AS check_name,
      p.name AS finding,
      CONCAT('Principal ', p.name, ' is a member of sysadmin.') AS detail,
      CASE WHEN p.name IN ('sa', 'NT AUTHORITY\\SYSTEM') THEN 'HIGH_RISK' ELSE 'CRITICAL' END AS risk_flag
    FROM sys.server_role_members srm
    JOIN sys.server_principals r ON r.principal_id = srm.role_principal_id
    JOIN sys.server_principals p ON p.principal_id = srm.member_principal_id
    WHERE r.name = 'sysadmin'

    UNION ALL
    SELECT
      'login_state_and_type',
      p.name,
      CONCAT('type=', p.type_desc, '; is_disabled=', p.is_disabled),
      CASE
        WHEN p.is_disabled = 1 THEN 'OK'
        WHEN p.type_desc = 'SQL_LOGIN' THEN 'MEDIUM_RISK'
        ELSE 'OK'
      END
    FROM sys.server_principals p
    WHERE p.type IN ('S', 'U', 'G') AND p.name NOT LIKE '##%'

    UNION ALL
    SELECT
      'impersonate_permissions',
      grantor.name,
      CONCAT('IMPERSONATE on ', ISNULL(grantee.name, 'unknown principal')),
      'CRITICAL'
    FROM sys.server_permissions perm
    JOIN sys.server_principals grantor ON grantor.principal_id = perm.grantee_principal_id
    LEFT JOIN sys.server_principals grantee ON grantee.principal_id = perm.major_id
    WHERE perm.permission_name = 'IMPERSONATE' AND perm.state_desc IN ('GRANT', 'GRANT_WITH_GRANT_OPTION')

    UNION ALL
    SELECT
      'impersonate_permissions',
      'none',
      'No explicit IMPERSONATE grants detected.',
      'OK'
    WHERE NOT EXISTS (
      SELECT 1 FROM sys.server_permissions
      WHERE permission_name = 'IMPERSONATE' AND state_desc IN ('GRANT', 'GRANT_WITH_GRANT_OPTION')
    )

    UNION ALL
    SELECT
      'trustworthy_owner',
      d.name,
      CONCAT('TRUSTWORTHY=ON; owner=', ISNULL(SUSER_SNAME(d.owner_sid), 'unknown')),
      CASE WHEN SUSER_SNAME(d.owner_sid) = 'sa' THEN 'CRITICAL' ELSE 'HIGH_RISK' END
    FROM sys.databases d
    WHERE d.database_id > 4 AND d.is_trustworthy_on = 1

    UNION ALL
    SELECT
      'trustworthy_owner',
      'none',
      'No user databases with TRUSTWORTHY enabled.',
      'OK'
    WHERE NOT EXISTS (
      SELECT 1 FROM sys.databases WHERE database_id > 4 AND is_trustworthy_on = 1
    )

    UNION ALL
    SELECT
      'cross_db_ownership_chaining',
      d.name,
      'Cross-database ownership chaining is enabled.',
      'MEDIUM_RISK'
    FROM sys.databases d
    WHERE d.database_id > 4 AND d.is_db_chaining_on = 1

    UNION ALL
    SELECT
      'cross_db_ownership_chaining',
      'none',
      'No user databases with cross-database ownership chaining enabled.',
      'OK'
    WHERE NOT EXISTS (
      SELECT 1 FROM sys.databases WHERE database_id > 4 AND is_db_chaining_on = 1
    )

    UNION ALL
    SELECT
      'xp_cmdshell',
      c.name,
      CONCAT('value_in_use=', CONVERT(NVARCHAR(10), c.value_in_use)),
      CASE WHEN c.value_in_use = 1 THEN 'CRITICAL' ELSE 'OK' END
    FROM sys.configurations c
    WHERE c.name = 'xp_cmdshell'

    UNION ALL
    SELECT
      'clr_assemblies',
      a.name,
      CONCAT('permission_set_desc=', a.permission_set_desc),
      CASE WHEN a.permission_set_desc = 'UNSAFE_ACCESS' THEN 'CRITICAL' ELSE 'HIGH_RISK' END
    FROM sys.assemblies a
    WHERE a.is_user_defined = 1 AND a.permission_set_desc IN ('UNSAFE_ACCESS', 'EXTERNAL_ACCESS')

    UNION ALL
    SELECT
      'clr_assemblies',
      'none',
      'No user-defined UNSAFE/EXTERNAL CLR assemblies detected.',
      'OK'
    WHERE NOT EXISTS (
      SELECT 1 FROM sys.assemblies
      WHERE is_user_defined = 1 AND permission_set_desc IN ('UNSAFE_ACCESS', 'EXTERNAL_ACCESS')
    )

    UNION ALL
    SELECT
      'linked_servers',
      s.name,
      CONCAT('data_source=', ISNULL(s.data_source, 'n/a'), '; product=', ISNULL(s.product, 'n/a')),
      'HIGH_RISK'
    FROM sys.servers s
    WHERE s.is_linked = 1

    UNION ALL
    SELECT
      'linked_servers',
      'none',
      'No linked servers detected.',
      'OK'
    WHERE NOT EXISTS (
      SELECT 1 FROM sys.servers WHERE is_linked = 1
    )

    UNION ALL
    SELECT
      'sql_server_audit',
      CASE WHEN EXISTS (SELECT 1 FROM sys.server_audits WHERE is_state_enabled = 1) THEN 'enabled' ELSE 'disabled' END,
      CASE
        WHEN EXISTS (SELECT 1 FROM sys.server_audits WHERE is_state_enabled = 1)
          THEN 'At least one SQL Server Audit is enabled.'
        ELSE 'No enabled SQL Server Audit objects found.'
      END,
      CASE
        WHEN EXISTS (SELECT 1 FROM sys.server_audits WHERE is_state_enabled = 1)
          THEN 'OK'
        ELSE 'BLIND_SPOT'
      END
) AS server_findings;

DECLARE @dbName sysname;
DECLARE @dbSql NVARCHAR(MAX);

INSERT INTO #findings (check_name, finding, detail, risk_flag)
SELECT
  'db_access_blind_spot',
  d.name,
  CONCAT('Database ', d.name, ' is online but the current login cannot access it. Database-level posture checks were skipped for this database.'),
  'BLIND_SPOT'
FROM sys.databases d
WHERE d.database_id > 4
  AND d.state = 0
  AND ISNULL(HAS_DBACCESS(d.name), 0) = 0;

DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
SELECT name
FROM sys.databases
WHERE database_id > 4
  AND state = 0
  AND HAS_DBACCESS(name) = 1;

OPEN dbs;
FETCH NEXT FROM dbs INTO @dbName;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @dbSql = N'
USE ' + QUOTENAME(@dbName) + N';

INSERT INTO #findings (check_name, finding, detail, risk_flag)
SELECT check_name, finding, detail, risk_flag
FROM (
    SELECT
      ''db_owner_proliferation'' AS check_name,
      DB_NAME() AS finding,
      CONCAT(''Database '', DB_NAME(), '' has '', COUNT(*), '' db_owner members: '', STRING_AGG(member_principal.name, ''; '')) AS detail,
      ''HIGH_RISK'' AS risk_flag
    FROM sys.database_role_members drm
    JOIN sys.database_principals role_principal ON role_principal.principal_id = drm.role_principal_id
    JOIN sys.database_principals member_principal ON member_principal.principal_id = drm.member_principal_id
    WHERE role_principal.name = ''db_owner''
      AND member_principal.principal_id > 4
    GROUP BY role_principal.name
    HAVING COUNT(*) > 1

    UNION ALL
    SELECT
      ''db_role_membership_excess'',
      member_principal.name,
      CONCAT(''Database '', DB_NAME(), '': principal '', member_principal.name, '' is a member of '', role_principal.name, ''.''),
      CASE WHEN role_principal.name = ''db_securityadmin'' THEN ''HIGH_RISK'' ELSE ''MEDIUM_RISK'' END
    FROM sys.database_role_members drm
    JOIN sys.database_principals role_principal ON role_principal.principal_id = drm.role_principal_id
    JOIN sys.database_principals member_principal ON member_principal.principal_id = drm.member_principal_id
    WHERE role_principal.name IN (''db_securityadmin'', ''db_ddladmin'')
      AND member_principal.principal_id > 4
      AND member_principal.name NOT IN (''dbo'', ''guest'', ''INFORMATION_SCHEMA'', ''sys'')

    UNION ALL
    SELECT
      ''db_dangerous_permissions'',
      grantee.name,
      CONCAT(''Database '', DB_NAME(), '': principal '', grantee.name, '' has '', perm.permission_name, '' on DATABASE.''),
      CASE WHEN perm.permission_name IN (''CONTROL'', ''TAKE OWNERSHIP'') THEN ''HIGH_RISK'' ELSE ''MEDIUM_RISK'' END
    FROM sys.database_permissions perm
    JOIN sys.database_principals grantee ON grantee.principal_id = perm.grantee_principal_id
    WHERE perm.class = 0
      AND perm.state_desc IN (''GRANT'', ''GRANT_WITH_GRANT_OPTION'')
      AND perm.permission_name IN (''CONTROL'', ''ALTER'', ''TAKE OWNERSHIP'')
      AND grantee.principal_id > 4
      AND grantee.name NOT IN (''dbo'', ''guest'', ''INFORMATION_SCHEMA'', ''sys'')

    UNION ALL
    SELECT
      ''orphaned_users'',
      principal.name,
      CONCAT(''Database '', DB_NAME(), '': user '', principal.name, '' has no matching server login.''),
      ''HIGH_RISK''
    FROM sys.database_principals principal
    WHERE principal.principal_id > 4
      AND principal.type IN (''S'', ''U'', ''G'')
      AND principal.sid IS NOT NULL
      AND principal.sid <> 0x00
      AND NOT EXISTS (
        SELECT 1
        FROM master.sys.server_principals sp
        WHERE sp.sid = principal.sid
      )

    UNION ALL
    SELECT
      ''cross_db_chaining_per_db'',
      DB_NAME(),
      CONCAT(''Database '', DB_NAME(), '' has cross-database ownership chaining enabled.''),
      ''MEDIUM_RISK''
    WHERE EXISTS (
      SELECT 1
      FROM sys.databases d
      WHERE d.name = DB_NAME() AND d.is_db_chaining_on = 1
    )

    UNION ALL
    SELECT
      ''trustworthy_clr_combo'',
      DB_NAME(),
      CONCAT(''Database '', DB_NAME(), '' is TRUSTWORTHY=ON with '', COUNT(*), '' user CLR assemblies; owner='', ISNULL(SUSER_SNAME(DATABASEPROPERTYEX(DB_NAME(), ''OwnerSid'')), ''unknown'')),
      CASE
        WHEN ISNULL(SUSER_SNAME(DATABASEPROPERTYEX(DB_NAME(), ''OwnerSid'')), '''') = ''sa'' THEN ''CRITICAL''
        ELSE ''HIGH_RISK''
      END
    FROM sys.assemblies a
    WHERE a.is_user_defined = 1
      AND EXISTS (
        SELECT 1
        FROM sys.databases d
        WHERE d.name = DB_NAME() AND d.is_trustworthy_on = 1
      )
    GROUP BY DB_NAME()
) AS db_findings;';

  BEGIN TRY
    EXEC sys.sp_executesql @dbSql;
  END TRY
  BEGIN CATCH
    INSERT INTO #findings (check_name, finding, detail, risk_flag)
    VALUES (
      'db_access_blind_spot',
      @dbName,
      CONCAT('Database ', @dbName, ' could not be assessed under the current security context: ', ERROR_MESSAGE()),
      'BLIND_SPOT'
    );
  END CATCH;

  FETCH NEXT FROM dbs INTO @dbName;
END;

CLOSE dbs;
DEALLOCATE dbs;

SELECT (
  SELECT
    @server_name AS server_name,
    CONVERT(VARCHAR(33), @audit_timestamp_utc, 127) + 'Z' AS audit_timestamp_utc,
    check_name,
    finding,
    detail,
    risk_flag
  FROM #findings
  FOR JSON PATH, ROOT('sql_security_audit')
) AS json_payload;
`;

export const securityAuditRouter = Router();

// INTEGRATION POINT — provided by existing platform
securityAuditRouter.use(requireAuth);

securityAuditRouter.post("/run", async (req, res, next) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid security audit payload" });
    return;
  }

  try {
    // INTEGRATION POINT — provided by existing platform
    const rows = await query<{ json_payload: string }>(auditSql);
    const rawJson = rows[0]?.json_payload ?? '{"sql_security_audit": []}';
    const findings = parseAuditJson(rawJson);

    const scored = computeScore(findings);
    const counts = countByRisk(findings);
    const runId = randomUUID();
    const ranAtUtc = new Date().toISOString();

    const runPayload = {
      runId,
      ranAtUtc,
      target: {
        targetLabel: parsed.data.sqlTarget.targetLabel,
        environment: parsed.data.sqlTarget.environment ?? null,
        notes: parsed.data.sqlTarget.notes ?? null
      },
      findings,
      scoring: {
        score: scored.score,
        grade: scored.grade,
        counts
      }
    };

    const fabricResult = await exportToFabric(runId, runPayload, parsed.data.fabric);

    const detail: SecurityAuditRunDetail = {
      runId,
      ranAtUtc,
      targetLabel: parsed.data.sqlTarget.targetLabel,
      score: scored.score,
      grade: scored.grade,
      counts,
      exportStatus: fabricResult.status,
      exportMessage: fabricResult.message,
      findings
    };

    pushHistory(detail);

    res.json({
      data: {
        summary: {
          runId: detail.runId,
          ranAtUtc: detail.ranAtUtc,
          targetLabel: detail.targetLabel,
          score: detail.score,
          grade: detail.grade,
          counts: detail.counts,
          exportStatus: detail.exportStatus,
          exportMessage: detail.exportMessage
        },
        findings: detail.findings,
        remediation: detail.findings.map((finding) => ({
          checkName: finding.check_name,
          recommendation:
            remediationByCheck[finding.check_name] ??
            "Validate this finding against your hardening baseline and close with documented least-privilege controls."
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

securityAuditRouter.get("/history", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(50, limit)) : 20;
    const data: SecurityAuditRunSummary[] = runHistory.slice(0, bounded).map((entry) => ({
      runId: entry.runId,
      ranAtUtc: entry.ranAtUtc,
      targetLabel: entry.targetLabel,
      score: entry.score,
      grade: entry.grade,
      counts: entry.counts,
      exportStatus: entry.exportStatus,
      exportMessage: entry.exportMessage
    }));
    res.json({ data });
  } catch (error) {
    next(error);
  }
});
