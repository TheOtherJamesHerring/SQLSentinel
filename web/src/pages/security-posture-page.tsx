import { AlertTriangle, CheckCircle2, Clock, FileText, ShieldAlert, ShieldCheck, User2 } from "lucide-react";
import { useState } from "react";
import { SecurityAuditConfig } from "@/components/security/security-audit-config";
import { SecurityPostureDashboard } from "@/components/security/security-posture-dashboard";
import { SecurityRemediationModal } from "@/components/security/security-remediation-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/lib/api";
import type {
  RemediationRole,
  RemediationScope,
  RemediationTask,
  RemediationWorkstream,
  SecurityAuditFinding,
  SecurityAuditRunRequest,
  SecurityAuditRunResponse,
  SecurityAuditRunSummary,
} from "@/lib/types";

interface CheckKnowledge {
  role: RemediationRole;
  whyItMatters: string;
  remediationSteps: string[];
  verificationSteps: string[];
  effortHours: number;
}

const SCORE_BY_FLAG: Record<string, number> = {
  CRITICAL: 25,
  HIGH_RISK: 15,
  MEDIUM_RISK: 8,
  BLIND_SPOT: 10,
};

const DB_SCOPED_CHECKS = new Set([
  "db_owner_proliferation",
  "orphaned_users",
  "db_role_membership_excess",
  "db_dangerous_permissions",
  "cross_db_chaining_per_db",
  "trustworthy_clr_combo",
  "db_access_blind_spot",
  "trustworthy_owner",
  "cross_db_ownership_chaining",
]);

function toSortedList(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function extractDatabaseNames(f: SecurityAuditFinding): string[] {
  const names = new Set<string>();

  const detailMatch = f.detail.match(/Database\s+"?([A-Za-z0-9_\-.\[\]]+)"?/i);
  if (detailMatch?.[1]) names.add(detailMatch[1]);

  if (f.check_name === "db_access_blind_spot" && f.finding && f.finding !== "none") {
    names.add(f.finding);
  }

  if (
    DB_SCOPED_CHECKS.has(f.check_name) &&
    f.finding &&
    f.finding !== "none" &&
    !f.finding.includes(":") &&
    !f.finding.includes(" ")
  ) {
    names.add(f.finding);
  }

  if (f.finding.includes(":")) {
    const [prefix] = f.finding.split(":");
    if (prefix && !prefix.includes(" ")) names.add(prefix);
  }

  return toSortedList(names);
}

const CHECK_KNOWLEDGE: Record<string, CheckKnowledge> = {
  sysadmin_membership: {
    role: "DBA",
    whyItMatters:
      "Any login in sysadmin has unrestricted access to every database, file, and OS feature. A compromised sysadmin account can drop databases, exfiltrate all data, and plant persistent backdoors in seconds — bypassing every row-level or schema-level control.",
    remediationSteps: [
      "Enumerate current members: SELECT name FROM sys.server_principals WHERE IS_SRVROLEMEMBER('sysadmin', name) = 1;",
      "For each non-SA principal, evaluate whether sysadmin is required or whether db_owner / a custom server role suffices.",
      "Remove unnecessary members: ALTER SERVER ROLE sysadmin DROP MEMBER [<login>];",
      "If a Windows group is granted sysadmin, enumerate its members in Active Directory and restrict or replace with named accounts.",
      "Implement a break-glass account pattern and JIT elevation process for emergency DBA access.",
      "Document all retained sysadmin principals with a business justification in your CMDB.",
    ],
    verificationSteps: [
      "SELECT name, type_desc FROM sys.server_principals WHERE IS_SRVROLEMEMBER('sysadmin', name) = 1 AND name NOT IN ('sa'); — expect zero undocumented accounts.",
      "Confirm service accounts use least-privilege roles (db_owner or custom), not sysadmin.",
    ],
    effortHours: 4,
  },

  login_state_and_type: {
    role: "DBA",
    whyItMatters:
      "Disabled or orphaned logins with residual permissions are a persistence mechanism. An attacker with sysadmin access can re-enable a dormant account and resume access post-remediation, silently bypassing monitoring that only watches active logins.",
    remediationSteps: [
      "List all active SQL logins: SELECT name, is_disabled, type_desc FROM sys.server_principals WHERE type IN ('S','G','U') AND is_disabled = 0;",
      "Cross-reference against your authorised account list (HR / CMDB). Flag every account without a live owner.",
      "Disable stale logins: ALTER LOGIN [<login>] DISABLE;",
      "Remove logins with no current need: DROP LOGIN [<login>]; (resolve dependent database users first).",
      "Replace SQL authentication logins with Windows / Entra integrated identities wherever possible.",
      "Establish a 90-day recurring review cadence for all SQL Server logins.",
    ],
    verificationSteps: [
      "SELECT name, is_disabled, type_desc FROM sys.server_principals WHERE type = 'S' AND is_disabled = 0; — SQL logins should be minimal and documented.",
      "Confirm each active login maps to a known service account or named individual.",
    ],
    effortHours: 3,
  },

  impersonate_permissions: {
    role: "Security Engineer",
    whyItMatters:
      "IMPERSONATE grants let a lower-privilege principal execute code as a high-privilege principal — a built-in escalation path. A user who can IMPERSONATE a sysadmin or dbo bypasses every permission check without triggering conventional login audit events.",
    remediationSteps: [
      "Enumerate grants: SELECT pr.name AS grantee, l.name AS target, p.permission_name FROM sys.server_permissions p JOIN sys.server_principals l ON p.major_id = l.principal_id JOIN sys.server_principals pr ON p.grantee_principal_id = pr.principal_id WHERE p.permission_name = 'IMPERSONATE';",
      "For each grant: confirm it is operationally required, documented, and scoped to a least-privilege target.",
      "Revoke unnecessary grants: REVOKE IMPERSONATE ON LOGIN::[<target>] FROM [<grantee>];",
      "Ensure no service account or application login holds IMPERSONATE rights over a higher-privilege principal.",
      "Require security team approval and a change-ticket reference for any future IMPERSONATE grant.",
    ],
    verificationSteps: [
      "Re-run the enumeration query above — zero undocumented grants expected.",
      "Confirm retained grants have a ticket reference and an expiry review date.",
      "Configure SQL Server Audit action group SERVER_PERMISSION_CHANGE_GROUP to alert on future grants.",
    ],
    effortHours: 2,
  },

  trustworthy_owner: {
    role: "DBA",
    whyItMatters:
      "When TRUSTWORTHY is ON and the database owner is sa, CLR assemblies and EXECUTE AS context inside that database can reach server-level resources. This is a well-known escalation path: any user with ALTER ANY ASSEMBLY or EXECUTE permission in the database gains effective sysadmin capability.",
    remediationSteps: [
      "Identify affected databases: SELECT name FROM sys.databases WHERE is_trustworthy_on = 1 AND owner_sid != 0x01;",
      "Disable TRUSTWORTHY: ALTER DATABASE [<dbname>] SET TRUSTWORTHY OFF;",
      "If CLR or cross-database EXECUTE AS is required, replace TRUSTWORTHY with certificate-based or asymmetric key signing.",
      "Transfer ownership away from sa: ALTER AUTHORIZATION ON DATABASE::[<dbname>] TO [<low_priv_login>];",
    ],
    verificationSteps: [
      "SELECT name, is_trustworthy_on FROM sys.databases WHERE is_trustworthy_on = 1; — should return only msdb.",
      "Run application integration tests to confirm no functionality broke after disabling TRUSTWORTHY.",
    ],
    effortHours: 1,
  },

  cross_db_ownership_chaining: {
    role: "DBA",
    whyItMatters:
      "Cross-database ownership chaining bypasses permission checks when objects with the same owner span databases. A user with limited rights in Database A can silently read data in Database B, defeating schema-level isolation without any explicit GRANT.",
    remediationSteps: [
      "Check server level: SELECT value_in_use FROM sys.configurations WHERE name = 'cross db ownership chaining';",
      "Disable at server level: EXEC sp_configure 'cross db ownership chaining', 0; RECONFIGURE;",
      "Check database level: SELECT name FROM sys.databases WHERE is_db_chaining_on = 1;",
      "Disable per database: ALTER DATABASE [<dbname>] SET DB_CHAINING OFF;",
      "Identify and refactor any cross-database stored procedures or views that break, using explicit GRANT or certificate signing instead.",
    ],
    verificationSteps: [
      "SELECT value_in_use FROM sys.configurations WHERE name = 'cross db ownership chaining'; — expect 0.",
      "SELECT name, is_db_chaining_on FROM sys.databases; — expect all 0 except formally justified databases.",
      "Run application smoke tests to verify no silent data access failures.",
    ],
    effortHours: 2,
  },

  xp_cmdshell: {
    role: "DBA",
    whyItMatters:
      "xp_cmdshell executes OS commands directly from T-SQL under the SQL Server service account. Any SQL principal who can call it — or any sysadmin who re-enables it — gains full OS command execution, enabling data exfiltration, lateral movement, and ransomware deployment entirely through a T-SQL session.",
    remediationSteps: [
      "Disable immediately: EXEC sp_configure 'xp_cmdshell', 0; RECONFIGURE;",
      "Suppress the advanced options surface: EXEC sp_configure 'show advanced options', 0; RECONFIGURE;",
      "Audit who holds EXECUTE on xp_cmdshell: SELECT pr.name FROM sys.server_permissions p JOIN sys.server_principals pr ON p.grantee_principal_id = pr.principal_id WHERE p.permission_name = 'EXECUTE' AND OBJECT_NAME(p.major_id) = 'xp_cmdshell';",
      "Revoke any explicit grants: REVOKE EXECUTE ON xp_cmdshell FROM [<login>];",
      "Replace operational use of xp_cmdshell with SQL Agent CmdExec steps running under a least-privilege proxy account.",
    ],
    verificationSteps: [
      "SELECT value_in_use FROM sys.configurations WHERE name = 'xp_cmdshell'; — expect 0.",
      "Attempt EXEC xp_cmdshell 'whoami'; as a non-sysadmin — expect permission denied.",
      "Confirm no SQL Agent jobs invoke xp_cmdshell via an ad-hoc T-SQL step type.",
    ],
    effortHours: 1,
  },

  clr_assemblies: {
    role: "DBA",
    whyItMatters:
      "UNSAFE or EXTERNAL_ACCESS CLR assemblies execute managed code with the trust level of the SQL Server process. A compromised or malicious assembly can read the file system, make outbound network calls, access Windows credentials, and bypass all T-SQL permission boundaries.",
    remediationSteps: [
      "List non-SAFE assemblies: SELECT name, permission_set_desc FROM sys.assemblies WHERE permission_set_desc != 'SAFE_ACCESS' AND is_user_defined = 1;",
      "For each UNSAFE / EXTERNAL_ACCESS assembly: validate the business requirement, confirm the code is reviewed and signed, and obtain formal security approval.",
      "Drop unapproved assemblies: DROP ASSEMBLY [<name>];",
      "For required assemblies, downgrade to SAFE where possible: ALTER ASSEMBLY [<name>] WITH PERMISSION_SET = SAFE;",
      "Establish a CLR assembly deployment policy requiring security sign-off and code signing for any new CLR object.",
    ],
    verificationSteps: [
      "SELECT name, permission_set_desc FROM sys.assemblies WHERE is_user_defined = 1; — expect all SAFE_ACCESS.",
      "Run application tests to confirm no functionality regressed after assembly changes.",
      "Enable SQL Server Audit ASSEMBLY_CHANGE_GROUP to alert on future CLR deployments.",
    ],
    effortHours: 3,
  },

  linked_servers: {
    role: "DBA",
    whyItMatters:
      "Linked servers create implicit trust relationships between SQL instances. An attacker who compromises the local server can use OPENQUERY or four-part names to query or modify data on all linked servers, often using a highly privileged mapped credential, achieving lateral movement at the database layer.",
    remediationSteps: [
      "Enumerate linked servers and credential mappings: SELECT ls.name, ll.remote_name, ll.uses_self_credential FROM sys.servers ls JOIN sys.linked_logins ll ON ls.server_id = ll.server_id WHERE ls.is_linked = 1;",
      "For each linked server: validate it is actively used (cross-reference query history via Extended Events or sys.dm_exec_query_stats).",
      "Remove stale or unused linked servers: EXEC sp_dropserver '<name>', 'droplogins';",
      "For required linked servers: replace sysadmin-class mapped credentials with a least-privilege dedicated service account.",
      "Disable 'uses self credential' mappings wherever possible.",
      "Document all retained linked servers with owning team, business justification, and next review date.",
    ],
    verificationSteps: [
      "SELECT name FROM sys.servers WHERE is_linked = 1; — count should match documented inventory.",
      "Confirm no linked server credential maps to a sysadmin-class account.",
      "Test connectivity for all retained servers; verify removed servers are inaccessible.",
    ],
    effortHours: 3,
  },

  sql_server_audit: {
    role: "Security Engineer",
    whyItMatters:
      "Without a configured SQL Server Audit, privileged actions — permission grants, login changes, schema modifications — leave no durable forensic trail. An attacker can escalate, operate, and cover tracks with no log evidence surviving past the SQL error log rotation cycle.",
    remediationSteps: [
      "Create a Server Audit to a secured location: CREATE SERVER AUDIT [SQLSentinel_Audit] TO FILE (FILEPATH = 'D:\\Audits\\') WITH (ON_FAILURE = CONTINUE);",
      "Enable the audit: ALTER SERVER AUDIT [SQLSentinel_Audit] WITH (STATE = ON);",
      "Create a Server Audit Specification with required action groups: FAILED_LOGIN_GROUP, SUCCESSFUL_LOGIN_GROUP, SERVER_PERMISSION_CHANGE_GROUP, SERVER_ROLE_MEMBER_CHANGE_GROUP, SCHEMA_OBJECT_PERMISSION_CHANGE_GROUP.",
      "For sensitive databases, add a Database Audit Specification covering: DATABASE_PERMISSION_CHANGE_GROUP, DATABASE_OBJECT_PERMISSION_CHANGE_GROUP, and SELECT / INSERT / UPDATE / DELETE on critical tables.",
      "Forward the audit log destination to your SIEM or centralised log aggregation platform.",
      "Validate the audit is writing: trigger a deliberate failed login and confirm the entry appears in the audit log.",
    ],
    verificationSteps: [
      "SELECT name, status_desc FROM sys.server_audits; — expect at least one audit in STARTED state.",
      "SELECT audit_action_name FROM sys.server_audit_specification_details; — confirm all required action groups are present.",
      "Generate a test event and verify it appears in the audit log within 60 seconds.",
    ],
    effortHours: 4,
  },

  // ─── DATABASE-LEVEL SECURITY CHECKS ────────────────────────────────────

  db_owner_proliferation: {
    role: "DBA",
    whyItMatters:
      "When multiple principals hold db_owner role in a database, the blast radius of a single compromised account expands. Each db_owner can change data, drop objects, alter permissions, and execute any T-SQL in that database. Database ownership should be restricted to a single dedicated principal (typically a service account or DBA group).",
    remediationSteps: [
      "Identify all db_owner members per database: USE [<dbname>]; EXEC sp_helprolemember 'db_owner';",
      "For each database, designate a single authoritative owner (e.g., DBA group or dedicated service account).",
      "Remove excess members: USE [<dbname>]; EXEC sp_droprolemember 'db_owner', [<user>];",
      "Ensure the retained db_owner is documented in your CMDB with business justification.",
      "Require security approval for any future db_owner assignments.",
    ],
    verificationSteps: [
      "FOR EACH user database: SELECT * FROM sys.database_principals WHERE name = 'db_owner'; — verify exactly one member.",
      "Confirm the sole db_owner is a known DBA group or service account, not an individual developer.",
    ],
    effortHours: 3,
  },

  orphaned_users: {
    role: "DBA",
    whyItMatters:
      "Orphaned database users (principals with no matching server login) can be re-mapped to a different login by a DBA, allowing an attacker to hijack residual permissions. Orphaned users also indicate stale access provisioning and clutter the permission model.",
    remediationSteps: [
      "Identify orphaned users per database: USE [<dbname>]; EXEC sp_change_users_login 'Report';",
      "For each orphaned user: confirm it is no longer needed (check job/application history).",
      "Drop unused orphaned users: USE [<dbname>]; DROP USER [<user>];",
      "For required orphaned users, re-map to an existing login: EXEC sp_change_users_login 'Update_One', [<dbuser>], [<login>];",
      "Establish a quarterly review process to catch newly orphaned users.",
    ],
    verificationSteps: [
      "FOR EACH database: EXEC sp_change_users_login 'Report'; — expect no orphaned users.",
      "Confirm all remaining database users map to valid server logins: SELECT dp.name FROM sys.database_principals dp WHERE dp.principal_id > 4 AND NOT EXISTS (SELECT 1 FROM sys.server_principals sp WHERE sp.name = dp.name);",
    ],
    effortHours: 2,
  },

  db_role_membership_excess: {
    role: "DBA",
    whyItMatters:
      "Broad database role membership (especially db_securityadmin and db_ddladmin) allows non-DBA users to modify schema, grant/revoke permissions, or create triggers that persist data modifications. Excessive role holders dilute accountability and increase the surface area for insider threats or lateral movement.",
    remediationSteps: [
      "Enumerate role membership per database: USE [<dbname>]; EXEC sp_helprolemember 'db_securityadmin'; EXEC sp_helprolemember 'db_ddladmin';",
      "For each member: validate that the role assignment is operationally required and documented.",
      "Remove unnecessary members: USE [<dbname>]; EXEC sp_droprolemember 'db_securityadmin', [<user>];",
      "Replace broad role grants with explicit object-level permissions using GRANT / DENY on stored procedures and functions.",
      "Require security team sign-off on all db_ddladmin and db_securityadmin assignments.",
    ],
    verificationSteps: [
      "FOR EACH database: verify no unexpected users hold db_securityadmin or db_ddladmin roles.",
      "Confirm role members are documented with a business justification and a renewal/review date.",
    ],
    effortHours: 3,
  },

  db_dangerous_permissions: {
    role: "DBA",
    whyItMatters:
      "Database-level CONTROL, ALTER, and TAKE OWNERSHIP grants let a principal bypass ordinary object-level boundaries. A compromised account with these rights can rewrite schema, reassign ownership, or grant itself persistent access paths without needing db_owner membership.",
    remediationSteps: [
      "Enumerate broad database grants: USE [<dbname>]; SELECT pr.name, pe.permission_name, pe.state_desc FROM sys.database_permissions pe JOIN sys.database_principals pr ON pr.principal_id = pe.grantee_principal_id WHERE pe.class = 0 AND pe.permission_name IN ('CONTROL', 'ALTER', 'TAKE OWNERSHIP');",
      "For each grantee: confirm whether the permission is still operationally required and documented.",
      "Revoke unnecessary grants: USE [<dbname>]; REVOKE CONTROL, ALTER, TAKE OWNERSHIP TO [<principal>];",
      "Replace broad database-level grants with explicit schema or object-level permissions wherever possible.",
      "Require change control and security approval before any future database-scope CONTROL or TAKE OWNERSHIP grant is issued.",
    ],
    verificationSteps: [
      "FOR EACH database: confirm no unexpected principals hold CONTROL, ALTER, or TAKE OWNERSHIP at the database scope.",
      "Validate that retained grants are documented with business owner, justification, and review date.",
    ],
    effortHours: 2,
  },

  db_access_blind_spot: {
    role: "DBA",
    whyItMatters:
      "An inaccessible database is a visibility gap in the posture assessment. If the audit principal cannot open a database, the platform cannot verify ownership, role memberships, explicit grants, or orphaned users inside that database, leaving unknown escalation paths unassessed.",
    remediationSteps: [
      "Confirm whether the database is in scope for the SQL Security Posture assessment.",
      "If it is in scope, grant the audit principal CONNECT access to the database and sufficient metadata visibility to inspect principals, permissions, roles, and assemblies.",
      "If full least-privilege visibility is required, grant VIEW DEFINITION on the database to the audit principal or a role it inherits.",
      "Re-run the posture assessment and confirm the blind spot finding no longer appears for that database.",
      "If the database is intentionally out of scope, document the exclusion in the audit notes and ownership register.",
    ],
    verificationSteps: [
      "Confirm the audit run no longer reports db_access_blind_spot for in-scope databases.",
      "Validate the audit principal can connect to the database and enumerate database principals, role memberships, permissions, and assemblies.",
    ],
    effortHours: 1,
  },

  cross_db_chaining_per_db: {
    role: "DBA",
    whyItMatters:
      "When cross-database ownership chaining is enabled at the database level, a user in one database can access objects in another database without explicit GRANT, silently bypassing row-level security or schema-level isolation. This is a lateral movement risk, especially in multi-tenant or segregated database architectures.",
    remediationSteps: [
      "Check per-database chaining status: SELECT name, is_db_chaining_on FROM sys.databases WHERE is_db_chaining_on = 1;",
      "For each database with chaining enabled, evaluate whether the feature is required for a documented cross-database view/procedure.",
      "Disable chaining: ALTER DATABASE [<dbname>] SET DB_CHAINING OFF;",
      "For legitimate cross-database access needs, replace ownership chaining with explicit GRANT statements or certificate-based signing.",
      "Document and version control all cross-database dependencies.",
    ],
    verificationSteps: [
      "SELECT name, is_db_chaining_on FROM sys.databases; — expect all FALSE (or only formally justified databases).",
      "Test application queries post-remediation to confirm no silent data access failures.",
    ],
    effortHours: 2,
  },

  trustworthy_clr_combo: {
    role: "Security Engineer",
    whyItMatters:
      "TRUSTWORTHY databases with CLR assemblies or EXECUTE AS dbo context allow those CLR functions or stored procedures to reach server-level resources or assume elevated database roles. Combined with a sysadmin-class database owner, this is a direct escalation vector: any user who can CREATE ASSEMBLY or EXECUTE a procedure gains effective sysadmin privilege.",
    remediationSteps: [
      "Identify TRUSTWORTHY user databases: SELECT name FROM sys.databases WHERE database_id > 4 AND is_trustworthy_on = 1;",
      "For each TRUSTWORTHY database, enumerate CLR assemblies: USE [<dbname>]; SELECT name, permission_set_desc FROM sys.assemblies WHERE is_user_defined = 1;",
      "Verify the database owner: SELECT SUSER_SNAME(owner_sid) FROM sys.databases WHERE name = '<dbname>';",
      "Disable TRUSTWORTHY if CLR is not strictly required: ALTER DATABASE [<dbname>] SET TRUSTWORTHY OFF;",
      "If CLR is required, downgrade CLR assemblies to SAFE and use certificate signing instead of TRUSTWORTHY: ALTER ASSEMBLY [<name>] WITH PERMISSION_SET = SAFE;",
      "Transfer database ownership away from 'sa' to a dedicated, lower-privilege DBA principal.",
    ],
    verificationSteps: [
      "SELECT name, is_trustworthy_on FROM sys.databases; — confirm only msdb and utility databases have TRUSTWORTHY ON.",
      "FOR EACH application-owned database: confirm the owner is NOT 'sa' and is NOT a highly privileged principal.",
      "Run CLR functionality tests post-change to ensure no regressions.",
    ],
    effortHours: 3,
  },
};

// ─── Derivation: build RemediationScope from audit output ────────────────────

function buildRemediationScope(run: SecurityAuditRunResponse): RemediationScope {
  const { summary, findings } = run;
  const { score: currentScore, grade: currentGrade } = summary;
  const targetScore = 75;
  const targetGrade = "B" as const;
  const nonOkFindings = findings.filter((f) => f.risk_flag !== "OK");

  const affectedServers = toSortedList(
    new Set(nonOkFindings.map((f) => f.server_name).filter(Boolean)),
  );
  const affectedDatabases = toSortedList(
    new Set(nonOkFindings.flatMap((f) => extractDatabaseNames(f))),
  );

  const findingsByCheck = new Map<string, SecurityAuditFinding[]>();
  for (const f of nonOkFindings) {
    const bucket = findingsByCheck.get(f.check_name) ?? [];
    bucket.push(f);
    findingsByCheck.set(f.check_name, bucket);
  }

  // Deduplicate by check_name — highest risk flag wins when the same check fires multiple times
  const byCheck = new Map<string, SecurityAuditFinding>();
  for (const f of nonOkFindings) {
    const existing = byCheck.get(f.check_name);
    if (!existing || (SCORE_BY_FLAG[f.risk_flag] ?? 0) > (SCORE_BY_FLAG[existing.risk_flag] ?? 0)) {
      byCheck.set(f.check_name, f);
    }
  }

  // Sort by descending impact so blocking determination is greedy-optimal
  const actionable = [...byCheck.values()].sort(
    (a, b) => (SCORE_BY_FLAG[b.risk_flag] ?? 0) - (SCORE_BY_FLAG[a.risk_flag] ?? 0),
  );

  // Determine which checks are blocking (minimum set required to close deficit to targetScore)
  const deficit = Math.max(0, targetScore - currentScore);
  let accumulated = 0;
  const blockingChecks = new Set<string>();
  for (const f of actionable) {
    if (accumulated >= deficit) break;
    blockingChecks.add(f.check_name);
    accumulated += SCORE_BY_FLAG[f.risk_flag] ?? 0;
  }

  // Build tasks grouped by role
  const dbaTasks: RemediationTask[] = [];
  const seTasks: RemediationTask[] = [];

  for (const f of actionable) {
    const relatedFindings = findingsByCheck.get(f.check_name) ?? [];
    const impactedServers = toSortedList(new Set(relatedFindings.map((x) => x.server_name).filter(Boolean)));
    const impactedDatabases = toSortedList(new Set(relatedFindings.flatMap((x) => extractDatabaseNames(x))));

    const k: CheckKnowledge =
      CHECK_KNOWLEDGE[f.check_name] ?? {
        role: "Security Engineer",
        whyItMatters:
          "This finding is not yet mapped to a specialized remediation playbook. Treat it as actionable until triaged and formally mapped.",
        remediationSteps: [
          `Review finding details for ${f.check_name.replace(/_/g, " ")} and identify principal/database scope impacted.`,
          "Apply least-privilege controls and remove unnecessary elevated permissions or unsafe configuration state.",
          "Document remediation owner, change ticket, and validation evidence.",
        ],
        verificationSteps: [
          `Re-run the posture audit and confirm ${f.check_name.replace(/_/g, " ")} no longer appears as non-OK.`,
          "Attach evidence of the control change and peer/security review.",
        ],
        effortHours: 1,
      };

    const effortMultiplier = impactedDatabases.length > 0 ? impactedDatabases.length : 1;
    const estimatedEffortHours = Math.max(1, Math.ceil(k.effortHours * effortMultiplier));

    const task: RemediationTask = {
      taskId: `TASK-${f.check_name.toUpperCase().replace(/_/g, "-")}`,
      relatedCheck: f.check_name,
      riskLevel: f.risk_flag as RemediationTask["riskLevel"],
      impactedServers,
      impactedDatabases,
      whyItMatters: k.whyItMatters,
      remediationSteps: k.remediationSteps,
      verificationSteps: k.verificationSteps,
      estimatedEffortHours,
      scoreImprovementIfResolved: SCORE_BY_FLAG[f.risk_flag] ?? 0,
      blocking: blockingChecks.has(f.check_name),
    };
    if (k.role === "DBA") dbaTasks.push(task);
    else seTasks.push(task);
  }

  const dbaHours = dbaTasks.reduce((s, t) => s + t.estimatedEffortHours, 0);
  const seHours = seTasks.reduce((s, t) => s + t.estimatedEffortHours, 0);

  const workstreams: RemediationWorkstream[] = [];
  if (dbaTasks.length > 0) {
    workstreams.push({
      role: "DBA",
      objective: "Harden SQL Server configuration and access control to eliminate exploitable privilege paths.",
      tasks: dbaTasks,
    });
  }
  if (seTasks.length > 0) {
    workstreams.push({
      role: "Security Engineer",
      objective: "Establish audit visibility and close privilege escalation paths requiring security policy enforcement.",
      tasks: seTasks,
    });
  }

  const scoreGainFromBlocking = actionable
    .filter((f) => blockingChecks.has(f.check_name))
    .reduce((s, f) => s + (SCORE_BY_FLAG[f.risk_flag] ?? 0), 0);

  const requiredConditions = [
    `Server(s) in scope: ${affectedServers.length ? affectedServers.join(", ") : "(unknown)"}.`,
    `Database(s) requiring remediation: ${affectedDatabases.length ? affectedDatabases.join(", ") : "None identified"}.`,
    ...actionable
      .filter((f) => blockingChecks.has(f.check_name))
      .map(
        (f) =>
          `Resolve ${f.check_name.replace(/_/g, " ")} (${f.risk_flag.replace(/_/g, " ")}, +${SCORE_BY_FLAG[f.risk_flag] ?? 0} pts)`,
      ),
    "Re-run the SQL Security Posture audit and confirm score ≥ 75 (Grade B).",
    "All verification queries for blocking tasks return expected results.",
  ];

  return {
    currentScore,
    targetScore,
    currentGrade,
    targetGrade,
    affectedServers,
    affectedDatabases,
    effortEstimateHours: { dba: dbaHours, securityEngineer: seHours },
    workstreams,
    acceptanceCriteria: {
      requiredConditions,
      reRunAuditRequired: true,
      expectedScoreAfterRemediation: Math.min(100, currentScore + scoreGainFromBlocking),
    },
  };
}

// ─── Remediation Scope display ────────────────────────────────────────────────

const RISK_BADGE_TONE: Record<string, "danger" | "warning" | "primary" | "muted"> = {
  CRITICAL: "danger",
  HIGH_RISK: "warning",
  MEDIUM_RISK: "primary",
  BLIND_SPOT: "muted",
};

const RISK_BORDER_STYLE: Record<string, string> = {
  CRITICAL: "4px solid #ef4444",
  HIGH_RISK: "4px solid #f97316",
  MEDIUM_RISK: "4px solid #6366f1",
  BLIND_SPOT: "4px solid #94a3b8",
};

function TaskCard({ task }: { task: RemediationTask }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-lg border bg-card text-foreground"
      style={{ borderLeft: RISK_BORDER_STYLE[task.riskLevel] }}
    >
      <button
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted">{task.taskId}</span>
            <Badge label={task.riskLevel.replace(/_/g, " ")} tone={RISK_BADGE_TONE[task.riskLevel]} />
            {task.blocking && (
              <Badge label="BLOCKING" tone="danger" />
            )}
          </div>
          <span className="text-sm font-medium">{task.relatedCheck.replace(/_/g, " ")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {task.estimatedEffortHours}h
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            +{task.scoreImprovementIfResolved} pts
          </span>
          <span className="text-muted">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t px-4 py-4 text-sm">
          {(task.impactedServers?.length || task.impactedDatabases?.length) ? (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted">
              {task.impactedServers?.length ? (
                <p><strong className="text-foreground">Server(s):</strong> {task.impactedServers.join(", ")}</p>
              ) : null}
              {task.impactedDatabases?.length ? (
                <p><strong className="text-foreground">Database(s):</strong> {task.impactedDatabases.join(", ")}</p>
              ) : null}
            </div>
          ) : null}

          <div>
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" />
              Why it matters
            </p>
            <p className="text-muted">{task.whyItMatters}</p>
          </div>

          <div>
            <p className="mb-2 font-semibold">Remediation steps</p>
            <ol className="space-y-1.5 pl-1">
              {task.remediationSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-muted">
                  <span className="shrink-0 font-mono text-xs text-foreground">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="mb-2 font-semibold">Verification</p>
            <ul className="space-y-1.5 pl-1">
              {task.verificationSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-muted">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function RemediationScopeView({ scope, onOpenModal }: { scope: RemediationScope; onOpenModal: () => void }) {
  const gradeColor =
    scope.currentGrade === "A"
      ? "text-success"
      : scope.currentGrade === "B"
        ? "text-primary"
        : scope.currentGrade === "C"
          ? "text-warning"
          : "text-danger";

  if (scope.workstreams.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-success" />
          No actionable findings. No remediation scope required.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Remediation Scope of Work
            </CardTitle>
            <Button variant="secondary" size="sm" onClick={onOpenModal}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              View Full SoW
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted">
            <p><strong className="text-foreground">Server(s):</strong> {scope.affectedServers.join(", ") || "(unknown)"}</p>
            <p><strong className="text-foreground">Database(s) requiring remediation:</strong> {scope.affectedDatabases.length ? scope.affectedDatabases.join(", ") : "None identified"}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <p className="text-xs text-muted">Current Score</p>
              <p className={`text-2xl font-bold ${gradeColor}`}>{scope.currentScore}</p>
              <p className={`text-xs font-semibold ${gradeColor}`}>Grade {scope.currentGrade}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <p className="text-xs text-muted">Target Score</p>
              <p className="text-2xl font-bold text-primary">{scope.targetScore}</p>
              <p className="text-xs font-semibold text-primary">Grade {scope.targetGrade}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <p className="text-xs text-muted">DBA Effort</p>
              <p className="text-2xl font-bold">{scope.effortEstimateHours.dba}h</p>
              <p className="text-xs text-muted">estimated</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <p className="text-xs text-muted">Security Eng. Effort</p>
              <p className="text-2xl font-bold">{scope.effortEstimateHours.securityEngineer}h</p>
              <p className="text-xs text-muted">estimated</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workstreams */}
      {scope.workstreams.map((ws) => (
        <div key={ws.role} className="space-y-3">
          <div className="flex items-center gap-2">
            <User2 className="h-4 w-4 text-muted" />
            <h3 className="font-semibold">{ws.role}</h3>
            <span className="text-sm text-muted">— {ws.objective}</span>
          </div>
          {ws.tasks.map((task) => (
            <TaskCard key={task.taskId} task={task} />
          ))}
        </div>
      ))}

      {/* Acceptance criteria */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acceptance Criteria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {scope.acceptanceCriteria.requiredConditions.map((condition, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {condition}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/20 px-4 py-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-success" />
            <span>
              Expected score after remediation:{" "}
              <strong>{scope.acceptanceCriteria.expectedScoreAfterRemediation}</strong> — re-audit
              required to confirm.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Copilot: generate derived output only — no new architecture

export function SecurityPosturePage() {
  const historyQuery = useApiQuery<SecurityAuditRunSummary[]>(["security-audit-history"], "/security-audit/history?limit=20");
  const [latestRun, setLatestRun] = useState<SecurityAuditRunResponse | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function runAudit(payload: SecurityAuditRunRequest) {
    // INTEGRATION POINT — provided by existing platform
    return api<SecurityAuditRunResponse>("/security-audit/run", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  function handleRunComplete(result: SecurityAuditRunResponse) {
    setLatestRun(result);
    const exportText =
      result.summary.exportStatus === "success"
        ? "Fabric export completed."
        : result.summary.exportStatus === "failed"
        ? `Fabric export failed (non-blocking): ${result.summary.exportMessage}`
        : "Fabric export skipped.";
    setBannerMessage(`Security audit complete. Score ${result.summary.score}, Grade ${result.summary.grade}. ${exportText}`);
    void historyQuery.refetch();
  }

  const history = historyQuery.data ?? [];
  const latestSummary = latestRun?.summary ?? history[0] ?? null;
  const findings = latestRun?.findings ?? [];
  const remediationScope = latestRun ? buildRemediationScope(latestRun) : null;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-2 text-danger">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">SQL Security Posture</h1>
          <p className="text-muted">
            Internal authorized read-only security assessment from an inside-out perspective.
          </p>
        </div>
      </header>

      {bannerMessage && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 text-sm text-foreground">{bannerMessage}</CardContent>
        </Card>
      )}

      <SecurityAuditConfig onRun={runAudit} onRunComplete={handleRunComplete} />

      <SecurityPostureDashboard latest={latestSummary} history={history} findings={findings} />

      {remediationScope && (
        <RemediationScopeView scope={remediationScope} onOpenModal={() => setModalOpen(true)} />
      )}

      {modalOpen && remediationScope && (
        <SecurityRemediationModal scope={remediationScope} onClose={() => setModalOpen(false)} targetLabel={latestRun?.summary.targetLabel} />
      )}
    </div>
  );
}
