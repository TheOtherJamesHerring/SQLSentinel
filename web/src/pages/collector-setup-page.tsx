import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiExplorer, type ApiGroup } from "@/components/api-explorer";

const sqlScript = `-- Run scripts/create_sqlmonitor_svc.sql for full setup.
CREATE LOGIN [sqlmonitor_svc] WITH PASSWORD = '<strong-password>';
GRANT VIEW SERVER STATE TO [sqlmonitor_svc];
GRANT VIEW ANY DATABASE TO [sqlmonitor_svc];
GRANT VIEW ANY DEFINITION TO [sqlmonitor_svc];
GRANT CONNECT ANY DATABASE TO [sqlmonitor_svc];

USE [master];
CREATE USER [sqlmonitor_svc] FOR LOGIN [sqlmonitor_svc];
GRANT EXECUTE ON dbo.sp_readerrorlog TO [sqlmonitor_svc];

USE [msdb];
CREATE USER [sqlmonitor_svc] FOR LOGIN [sqlmonitor_svc];
GRANT SELECT ON dbo.backupset TO [sqlmonitor_svc];
GRANT SELECT ON dbo.backupmediafamily TO [sqlmonitor_svc];
GRANT SELECT ON dbo.sysjobs TO [sqlmonitor_svc];

-- Also grant CONNECT, VIEW DATABASE STATE, and db_datareader
-- in each monitored database.`;

const envTemplate = `MONITOR_API_URL=http://dashboard-host:3001
MONITOR_API_KEY=<shared-secret>
SERVER_ID=<server-guid>
SQL_SERVER_HOST=<target>
SQL_SERVER_PORT=1433
SQL_AUTH_TYPE=sql
SQL_USERNAME=sqlmonitor_svc
SQL_PASSWORD=<password>
SQL_ENTRA_TENANT_ID=<tenant-id-or-empty>
SQL_ENTRA_CLIENT_ID=<client-id-or-empty>
SQL_ENTRA_CLIENT_SECRET=<client-secret-or-empty>
SQL_DATABASE=master
SQL_ENCRYPT=true
SQL_TRUST_SERVER_CERT=false`;

const architecture = `+-----------------------+        +------------------------+
| SQL Server Instance   | -----> | Collector Agent (Node) |
| DMVs / Error Logs     |        | Scheduled Queries      |
+-----------------------+        +-----------+------------+
                                           |
                                           v
                                +----------+-----------+
                                | SQLSentinnel API     |
                                | /api/collect/*       |
                                +----------+-----------+
                                           |
                                           v
                                +----------+-----------+
                                | SQLMonitorDB         |
                                +----------+-----------+
                                           |
                                           v
                                +----------+-----------+
                                | React Dashboard UI   |
                                +----------------------+`;

const API_SPEC: ApiGroup[] = [
  {
    label: "Authentication",
    description: "Obtain a JWT token used by all dashboard endpoints.",
    endpoints: [
      {
        method: "POST",
        path: "/api/auth/login",
        summary: "Obtain JWT access token",
        auth: "none",
        description: "Exchange username + password for a signed JWT. Pass the returned token as Authorization: Bearer <token> on all dashboard endpoints.",
        requestBody: [
          { name: "username", type: "string", required: true,  description: "Admin or viewer account name" },
          { name: "password", type: "string", required: true,  description: "Account password" },
        ],
        responseFields: [
          { name: "token",    type: "string",  description: "Signed JWT — expires in 8 h by default" },
          { name: "user",     type: "object",  description: "{ username, role }" },
        ]
      }
    ]
  },
  {
    label: "Collector Ingest  (POST /api/collect/*)",
    description: "Push-only endpoints called by the collector agent on each monitored SQL Server. Authenticated with x-monitor-api-key header — no JWT required.",
    endpoints: [
      {
        method: "POST",
        path: "/api/collect/heartbeat",
        summary: "Collector liveness heartbeat",
        auth: "api-key",
        description: "Called every minute to confirm the collector is online and update server uptime.",
        requestBody: [
          { name: "serverId",   type: "uuid",   required: true },
          { name: "status",     type: "string", required: true, description: "e.g. online | preflight" },
          { name: "uptimeDays", type: "number", required: true },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/metrics",
        summary: "CPU / memory / disk / tempdb metrics",
        auth: "api-key",
        description: "Array of time-series metric samples. Accepts db_size, cpu, memory, disk, tempdb, cache, and collector_warning metric types.",
        requestBody: [
          { name: "serverId",   type: "uuid",            required: true },
          { name: "metricType", type: "string",          required: true,  description: "cpu | memory | disk | db_size | tempdb | cache | collector_warning" },
          { name: "metricName", type: "string",          description: "Sub-key, e.g. volume mount point or database name" },
          { name: "value",      type: "number",          required: true },
          { name: "unit",       type: "string",          description: "percent | mb | gb | count" },
          { name: "volumeName", type: "string | null",   description: "Disk label (disk metrics only)" },
          { name: "databaseId", type: "uuid | null",     description: "Resolved DB GUID (optional)" },
          { name: "timestamp",  type: "ISO 8601 string", description: "Defaults to server GETUTCDATE()" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/databases",
        summary: "Database health snapshot",
        auth: "api-key",
        description: "Upserts one row per database — recovery model, size, backup timestamps, and health classification.",
        requestBody: [
          { name: "serverId",          type: "uuid",        required: true },
          { name: "name",              type: "string",      required: true },
          { name: "status",            type: "string",      description: "online | restoring | …" },
          { name: "health",            type: "string",      description: "healthy | warning | critical" },
          { name: "recoveryModel",     type: "string|null", description: "FULL | SIMPLE | BULK_LOGGED" },
          { name: "compatibilityLevel",type: "number|null" },
          { name: "dataSizeMb",        type: "number|null" },
          { name: "logSizeMb",         type: "number|null" },
          { name: "logUsedPercent",    type: "number|null" },
          { name: "lastFullBackup",    type: "string|null" },
          { name: "lastDiffBackup",    type: "string|null" },
          { name: "lastLogBackup",     type: "string|null" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/disks",
        summary: "Disk volume inventory",
        auth: "api-key",
        description: "Upserts disk volumes for the server including size, free space, and which volumes host data/log files.",
        requestBody: [
          { name: "serverId",        type: "uuid",    required: true },
          { name: "volumeName",      type: "string",  required: true, description: "Mount point, e.g. C:\\ or /data" },
          { name: "label",           type: "string",  description: "Friendly volume label" },
          { name: "totalSizeGb",     type: "number",  required: true },
          { name: "freeSpaceGb",     type: "number",  required: true },
          { name: "usedPercent",     type: "number" },
          { name: "containsDataFiles", type: "boolean" },
          { name: "containsLogFiles",  type: "boolean" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/blocking",
        summary: "Active blocking session snapshot",
        auth: "api-key",
        description: "Records a point-in-time blocking chain from sys.dm_exec_requests. Duplicate rows are expected as blocking is sampled every minute.",
        requestBody: [
          { name: "serverId",          type: "uuid",        required: true },
          { name: "sessionId",         type: "number",      required: true },
          { name: "blockingSessionId", type: "number",      required: true, description: "0 = head blocker" },
          { name: "databaseName",      type: "string|null" },
          { name: "loginName",         type: "string|null" },
          { name: "hostName",          type: "string|null" },
          { name: "programName",       type: "string|null" },
          { name: "waitType",          type: "string|null" },
          { name: "waitTimeMs",        type: "number|null" },
          { name: "waitResource",      type: "string|null" },
          { name: "queryText",         type: "string|null" },
          { name: "isHeadBlocker",     type: "boolean" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/events",
        summary: "SQL error log / Windows events",
        auth: "api-key",
        requestBody: [
          { name: "serverId",     type: "uuid",        required: true },
          { name: "source",       type: "string",      required: true, description: "sql_error_log | windows_event | collector" },
          { name: "severity",     type: "string",      required: true, description: "info | warning | error | critical" },
          { name: "message",      type: "string",      required: true },
          { name: "eventTime",    type: "ISO 8601",    required: true },
          { name: "databaseName", type: "string|null" },
          { name: "category",     type: "string|null" },
          { name: "eventId",      type: "number|null" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/alerts",
        summary: "Threshold breach alerts",
        auth: "api-key",
        requestBody: [
          { name: "serverId",       type: "uuid",        required: true },
          { name: "alertType",      type: "string",      required: true, description: "cpu | memory | disk | …" },
          { name: "severity",       type: "string",      required: true, description: "warning | critical" },
          { name: "title",          type: "string",      required: true },
          { name: "message",        type: "string" },
          { name: "metricValue",    type: "number" },
          { name: "thresholdValue", type: "number" },
          { name: "databaseId",     type: "uuid|null" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/dbcc",
        summary: "DBCC CHECKDB results",
        auth: "api-key",
        requestBody: [
          { name: "serverId",        type: "uuid",   required: true },
          { name: "databaseName",    type: "string", required: true },
          { name: "checkType",       type: "string", description: "CHECKDB | CHECKTABLE | …" },
          { name: "runDate",         type: "string", required: true },
          { name: "durationSeconds", type: "number" },
          { name: "status",          type: "string", description: "clean | errors | warnings" },
          { name: "errorsFound",     type: "number" },
          { name: "warningsFound",   type: "number" },
          { name: "repairNeeded",    type: "boolean" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/query-store",
        summary: "Query Store regression snapshots",
        auth: "api-key",
        description: "Latest regressed/top queries per Query Store enabled database. Rows older than 15 minutes are automatically purged.",
        requestBody: [
          { name: "serverId",          type: "uuid",        required: true },
          { name: "databaseName",      type: "string",      required: true },
          { name: "queryId",           type: "integer",     required: true },
          { name: "queryText",         type: "string|null", description: "Truncated to 4000 chars" },
          { name: "recentAvgMs",       type: "number|null" },
          { name: "historicAvgMs",     type: "number|null" },
          { name: "regressionRatio",   type: "number|null", description: "recent / historic avg" },
          { name: "recentExecCount",   type: "integer|null" },
          { name: "historicExecCount", type: "integer|null" },
          { name: "avgLogicalReads",   type: "number|null" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/schema-objects",
        summary: "Per-DB schema counts, proc stats, index health",
        auth: "api-key",
        description: "Collected every 5 minutes. Sends table/view/proc/function/index counts, top stored procedures by execution, and fragmented index list.",
        requestBody: [
          { name: "serverId",              type: "uuid",    required: true },
          { name: "bufferCacheHitRatio",   type: "number",  required: true, description: "Server-wide buffer cache hit %" },
          { name: "databases",             type: "array",   required: true, description: "One entry per online user database" },
          { name: "databases[].databaseName", type: "string",  required: true },
          { name: "databases[].tableCnt",  type: "integer", required: true },
          { name: "databases[].viewCnt",   type: "integer", required: true },
          { name: "databases[].procCnt",   type: "integer", required: true },
          { name: "databases[].funcCnt",   type: "integer", required: true },
          { name: "databases[].indexCnt",  type: "integer", required: true },
          { name: "databases[].topProcs",  type: "array",   description: "Top 10 procs by exec count from dm_exec_procedure_stats" },
          { name: "databases[].fragIndexes", type: "array", description: "Top 15 indexes by fragmentation ≥ 100 pages" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/backup-failures",
        summary: "Backup failure records from msdb",
        auth: "api-key",
        requestBody: [
          { name: "serverId",        type: "uuid",        required: true },
          { name: "databaseName",    type: "string",      required: true },
          { name: "backupStartDate", type: "ISO 8601",    required: true },
          { name: "backupType",      type: "string|null", description: "D = Full · I = Diff · L = Log" },
          { name: "errorMessage",    type: "string|null" },
          { name: "backupSize",      type: "number|null", description: "Bytes" },
        ]
      },
      {
        method: "POST",
        path: "/api/collect/agent-jobs",
        summary: "SQL Agent job status",
        auth: "api-key",
        requestBody: [
          { name: "serverId",        type: "uuid",        required: true },
          { name: "jobId",           type: "string",      required: true, description: "SQL Agent job GUID" },
          { name: "jobName",         type: "string",      required: true },
          { name: "lastRunStatus",   type: "number|null", description: "0=failed 1=succeeded 2=retry 3=cancelled" },
          { name: "lastRunDuration", type: "number|null", description: "Seconds" },
          { name: "isEnabled",       type: "0|1",         required: true },
          { name: "nextRunDate",     type: "string|null" },
        ]
      },
    ]
  },
  {
    label: "Servers  (GET /api/servers/*)",
    description: "Dashboard read endpoints. Require Authorization: Bearer <jwt>.",
    endpoints: [
      {
        method: "GET",
        path: "/api/servers",
        summary: "List all monitored servers",
        auth: "bearer",
        responseFields: [
          { name: "ServerId",   type: "uuid" },
          { name: "Name",       type: "string" },
          { name: "Hostname",   type: "string" },
          { name: "Status",     type: "string" },
          { name: "Health",     type: "string" },
          { name: "LastCheck",  type: "datetime" },
        ]
      },
      {
        method: "POST",
        path: "/api/servers",
        summary: "Register a new server",
        auth: "bearer",
        role: "admin",
        requestBody: [
          { name: "name",     type: "string", required: true },
          { name: "hostname", type: "string", required: true },
          { name: "port",     type: "number", description: "Default 1433" },
          { name: "tags",     type: "string" },
        ]
      },
      {
        method: "GET",
        path: "/api/servers/:id",
        summary: "Server detail",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true, description: "Server GUID" }]
      },
      {
        method: "GET",
        path: "/api/servers/:id/metrics",
        summary: "Recent metric time series",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }],
        responseFields: [
          { name: "Timestamp",  type: "datetime" },
          { name: "MetricType", type: "string" },
          { name: "MetricName", type: "string" },
          { name: "Value",      type: "number" },
          { name: "Unit",       type: "string" },
        ]
      },
      {
        method: "GET",
        path: "/api/servers/:id/blocking",
        summary: "Recent blocking session history",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
      {
        method: "GET",
        path: "/api/servers/:id/disks",
        summary: "Disk volume inventory",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
      {
        method: "GET",
        path: "/api/servers/:id/alerts",
        summary: "Active and recent alerts for a server",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
      {
        method: "GET",
        path: "/api/servers/:id/databases",
        summary: "Database list for a server",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
    ]
  },
  {
    label: "Databases  (GET /api/databases/*)",
    description: "Per-database diagnostics — posture, posture metrics, DBCC, Query Store.",
    endpoints: [
      {
        method: "GET",
        path: "/api/databases/:id",
        summary: "Database detail row",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true, description: "Database GUID" }]
      },
      {
        method: "GET",
        path: "/api/databases/:id/posture",
        summary: "Full DB posture — schema, procs, indexes, cache, tempdb, blocking",
        auth: "bearer",
        description: "Main diagnostic payload for the database detail page. Includes schema object counts, top stored procs, index fragmentation, buffer cache hit ratio, tempdb snapshot, disk context, blocking history, and recent events.",
        params: [{ name: "id", in: "path", required: true }],
        responseFields: [
          { name: "database",            type: "object",  description: "Core DB row + server name" },
          { name: "schemaStats",         type: "object|null", description: "TableCnt, ViewCnt, ProcCnt, FuncCnt, IndexCnt, CapturedAt" },
          { name: "topProcs",            type: "array",   description: "From DatabaseProcStats — sorted by ExecutionCount DESC" },
          { name: "indexHealth",         type: "array",   description: "From DatabaseIndexStats — sorted by FragmentationPct DESC" },
          { name: "bufferCacheHitRatio", type: "number|null" },
          { name: "tempdb",             type: "object|null" },
          { name: "diskContext",        type: "array" },
          { name: "blocking",           type: "array" },
          { name: "topBlockingStatements", type: "array" },
          { name: "recentEvents",       type: "array" },
        ]
      },
      {
        method: "GET",
        path: "/api/databases/:id/metrics",
        summary: "Database size time series",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
      {
        method: "GET",
        path: "/api/databases/:id/dbcc",
        summary: "DBCC CHECKDB history",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
      {
        method: "GET",
        path: "/api/databases/:id/query-store",
        summary: "Query Store regression top-20",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true }]
      },
    ]
  },
  {
    label: "Capacity  (/api/capacity/*)",
    endpoints: [
      {
        method: "GET",
        path: "/api/capacity/disks",
        summary: "All disk volumes across all servers",
        auth: "bearer",
      },
      {
        method: "GET",
        path: "/api/capacity/databases",
        summary: "All database sizes across all servers",
        auth: "bearer",
      },
      {
        method: "GET",
        path: "/api/capacity/forecast",
        summary: "Growth forecast for top databases",
        auth: "bearer",
      },
    ]
  },
  {
    label: "Alerts & Events  (/api/alerts, /api/events)",
    endpoints: [
      {
        method: "GET",
        path: "/api/alerts",
        summary: "Active alerts across all servers",
        auth: "bearer",
      },
      {
        method: "PATCH",
        path: "/api/alerts/:id",
        summary: "Acknowledge an alert",
        auth: "bearer",
        params: [{ name: "id", in: "path", required: true, description: "Alert GUID" }]
      },
      {
        method: "GET",
        path: "/api/alerts/dispatch-config",
        summary: "Alert dispatch channel configuration",
        auth: "bearer",
      },
      {
        method: "PATCH",
        path: "/api/alerts/dispatch-config/:channel",
        summary: "Update dispatch config for a channel",
        auth: "bearer",
        role: "admin",
        params: [{ name: "channel", in: "path", required: true, description: "email | slack | webhook" }]
      },
      {
        method: "POST",
        path: "/api/alerts/dispatch-config/test/:channel",
        summary: "Send a test notification",
        auth: "bearer",
        role: "admin",
        params: [{ name: "channel", in: "path", required: true }]
      },
      {
        method: "POST",
        path: "/api/alerts/acknowledge/:alertId",
        summary: "Acknowledge alert (alternative route)",
        auth: "bearer",
        params: [{ name: "alertId", in: "path", required: true }]
      },
      {
        method: "GET",
        path: "/api/events",
        summary: "SQL error log and event feed",
        auth: "bearer",
      },
    ]
  },
  {
    label: "Dashboard  (/api/dashboard)",
    endpoints: [
      {
        method: "GET",
        path: "/api/dashboard",
        summary: "Aggregate summary — server count, alert counts, top issues",
        auth: "bearer",
      },
    ]
  },
  {
    label: "Settings  (/api/settings)",
    endpoints: [
      {
        method: "GET",
        path: "/api/settings/thresholds",
        summary: "Alert threshold definitions",
        auth: "bearer",
      },
      {
        method: "PATCH",
        path: "/api/settings/thresholds/:id",
        summary: "Update a threshold",
        auth: "bearer",
        role: "admin",
        params: [{ name: "id", in: "path", required: true }]
      },
    ]
  },
];

export function CollectorSetupPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Collector Deployment Steps</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-300">
          <p>1. Create least-privilege SQL login.</p>
          <pre className="code-block overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs">{sqlScript}</pre>
          <p>2. Prepare environment variables.</p>
          <pre className="code-block overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs">{envTemplate}</pre>
          <p>3. Start collector via Docker or node process manager.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Architecture Diagram</CardTitle></CardHeader>
        <CardContent>
          <pre className="code-block overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs">{architecture}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>API Reference</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-slate-500">
            Click any endpoint to expand request / response schema.
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">🔑 x-monitor-api-key</span> = collector push.
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">🔒 JWT</span> = dashboard read.
          </p>
          <ApiExplorer groups={API_SPEC} />
        </CardContent>
      </Card>
    </div>
  );
}
