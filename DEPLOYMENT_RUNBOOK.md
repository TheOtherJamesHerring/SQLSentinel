# SQLSentinnel Deployment Runbook

## 1. Scope
This runbook deploys the latest SQLSentinnel changes for:
- Alert configuration UI
- Slack dispatch configuration and test flow
- Email dispatch configuration and test flow
- Per-server access control admin dashboard
- Backup failure and SQL Agent job collection
- Alert dedup/throttle and operations run-history panel

## 2. Prerequisites
- Node.js 22+
- npm 10+
- SQL Server reachable by API and collector
- SQLMonitorDB already provisioned with baseline schema
- Valid environment files for API, web, and collector

## 3. Pre-Deployment Checklist
1. Confirm clean build from repo root:
   - `npm run build`
2. Confirm deployment SQL login can run DDL and DML on SQLMonitorDB.
3. Confirm collector API key matches on API and collector environments.
4. Confirm Slack webhook URL is available (optional but recommended).

## 4. Database Migration
Run the new migrations in SQLMonitorDB:

- File: sql/002_alert_dispatch_audit.sql
- File: sql/003_job_runs.sql

Command example:

```bash
sqlcmd -S <sql_host> -d SQLMonitorDB -i sql/002_alert_dispatch_audit.sql
sqlcmd -S <sql_host> -d SQLMonitorDB -i sql/003_job_runs.sql
```

This migration adds:
- AlertDispatchConfig
- Notifications
- AuditLog
- BackupFailures
- AgentJobs
- ServerAccess
- JobRuns

## 5. Environment Configuration

### API (.env)
Required keys:
- PORT
- DATABASE_URL
- JWT_SECRET
- MONITOR_API_KEY
- RETENTION_DAYS_MONITORING
- ALERT_DEDUP_MINUTES
- ALERT_BATCH_LIMIT
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USER
- SMTP_PASS
- SMTP_FROM

### Collector (.env)
Required keys:
- MONITOR_API_URL (for example: http://localhost:3001)
- MONITOR_API_KEY (must match API)
- SERVER_ID
- SQL_HOST
- SQL_PORT
- SQL_USER
- SQL_PASSWORD
- SQL_DATABASE

### Web (.env)
Required keys:
- VITE_API_URL (for example: http://localhost:3001/api)

## 6. Build and Deploy
From repo root:

```bash
npm run build
```

If build succeeds, deploy and restart services in this order:

1. API
2. Collector
3. Web static assets (if separately hosted)

## 7. Startup Commands (Local/Single Host)
Open separate terminals:

```bash
npm run dev -w api
npm run dev -w collector
npm run dev -w web
```

Production mode example:

```bash
npm run build
npm run start -w api
npm run start -w collector
# serve web/dist with your web server
```

## 8. Post-Deployment Validation

### 8.1 Health Checks
- API health: `GET /health` and `GET /api/health`
- Web loads and authenticates
- Collector logs show cycle execution without unhandled errors

### 8.2 Settings UI Validation
1. Sign in as admin.
2. Open Settings page.
3. Update at least one threshold and save.
4. Configure Slack webhook and run test.
5. Configure Email SMTP and run test.
6. Use Run Dispatch Now and verify sent/suppressed counters.
7. Use Run Retention Cleanup and verify deleted counters.
8. Grant server access for viewer user and verify listing updates.

### 8.3 RBAC Validation
1. Sign in as viewer.
2. Verify only assigned servers are visible in server list and server details.
3. Verify viewer cannot save settings/admin changes.

### 8.4 Data Pipeline Validation
After collector cycles run:
- BackupFailures table receives records when failures exist.
- AgentJobs table receives upserts for SQL Agent jobs.
- QueryStoreSnapshots continues to ingest normally.

## 9. Rollback Plan
If deployment fails:
1. Stop API and collector.
2. Revert application code to previous known-good commit.
3. Rebuild and restart old version.
4. If needed, disable new features by:
   - Keeping AlertDispatchConfig channels disabled
   - Not using ServerAccess assignments
5. Preserve data in new tables; no destructive rollback is required.

## 10. Known Notes
- Web build may show a non-fatal chunk-size warning from Vite.
- Current users are static (`admin`, `viewer`) unless auth is extended.

## 11. Operational Handoff
- Share Slack webhook ownership and rotation policy with on-call team.
- Define threshold ownership (who can change values and approval process).
- Review access assignments weekly for least-privilege compliance.
