# SQLSentinnel - Virtual Remote DBA Dashboard

Production-ready SQL Server remote monitoring platform with a React dashboard, Express API, and TypeScript collector service.

## Stack

- Frontend: React + Vite + Tailwind CSS + shadcn-style UI primitives + Recharts + Lucide + framer-motion + TanStack React Query
- Backend: Node.js + Express + mssql
- Collector: Node.js + TypeScript + node-cron + mssql
- Database: SQLMonitorDB on SQL Server
- Auth: JWT + role-based access (`admin`, `viewer`)

## Monorepo Structure

- `api` - Express API and SQLMonitorDB access
- `collector` - scheduled SQL/OS data collection service
- `web` - monitoring dashboard UI
- `sql` - idempotent schema scripts

## Quick Start (Local)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure env files:

   - Copy `api/.env.example` to `api/.env`
   - Copy `collector/.env.example` to `collector/.env`
   - Copy `web/.env.example` to `web/.env`

3. Create SQLMonitorDB schema:

   - Run `sql/001_sqlmonitor_schema.sql` against SQL Server.

4. Start services in development:

   ```bash
   npm run dev
   ```

   - API: `http://localhost:3001`
   - Web: `http://localhost:5173`

## Docker Deployment

```bash
docker compose up --build
```

Services:

- SQL Server: `localhost:1433`
- API: `http://localhost:3001`
- Web: `http://localhost:5173`
- Collector: internal service posting to API

## API Coverage

Implemented endpoint groups:

- Servers
- Databases
- Alerts
- Events
- Capacity
- Connections
- Dashboard
- Collector ingestion

## Collector Files

- `collector/src/collector/index.ts` scheduler
- `collector/src/collector/sqlConnection.ts` pool manager
- `collector/src/collector/metrics.ts` CPU/memory/disk collection
- `collector/src/collector/databases.ts` DB health/size collection
- `collector/src/collector/blocking.ts` blocking session detection
- `collector/src/collector/logEvents.ts` SQL and Windows event collection
- `collector/src/collector/alertEvaluator.ts` threshold evaluation logic
- `collector/src/collector/apiClient.ts` push to dashboard API

## SQL Service Account Permissions

```sql
CREATE LOGIN [sqlmonitor_svc] WITH PASSWORD = '<strong-password>';
GRANT VIEW SERVER STATE TO [sqlmonitor_svc];
GRANT VIEW ANY DATABASE TO [sqlmonitor_svc];
GRANT VIEW ANY DEFINITION TO [sqlmonitor_svc];
GRANT CONNECT ANY DATABASE TO [sqlmonitor_svc];
-- plus master/msdb user mapping and per-database VIEW DATABASE STATE + db_datareader
-- use scripts/create_sqlmonitor_svc.sql for full idempotent setup
USE msdb;
GRANT SELECT ON backupset TO [sqlmonitor_svc];
GRANT SELECT ON backupmediafamily TO [sqlmonitor_svc];
GRANT SELECT ON sysjobs TO [sqlmonitor_svc];
```

## Default Auth (Dev)

- `admin` / `admin123!`
- `viewer` / `viewer123!`

Use `POST /api/auth/login` to get JWT tokens.

## Datacenter Onboarding (Start Collecting Real Data)

Use this flow to connect SQLSentinnel to a SQL Server in your datacenter.

1. Create monitoring login on target SQL Server

- Run script: `scripts/create_sqlmonitor_svc.sql`
- Replace `<STRONG_PASSWORD>` before execution.

2. Configure API for your central SQLMonitorDB

- Edit `api/.env` and set:
   - `DATABASE_URL` to your central SQLMonitorDB server
   - `MONITOR_API_KEY` to a strong shared value
   - `JWT_SECRET` to a strong secret
   - `CONNECTION_SECRET_KEY` to a strong secret used for encrypting saved connection credentials

3. Start API

From repository root:

`npm run dev -w api`

4. Register datacenter server and generate collector env

Run from `scripts` folder in PowerShell:

SQL login example:

`./onboard-datacenter.ps1 -ApiBaseUrl "http://<dashboard-api-host>:3001" -AdminUsername "admin" -AdminPassword "admin123!" -ServerName "Prod-SQL-01" -Hostname "prod-sql-01.yourdomain.local" -Environment "production" -MonitorApiKey "<same-value-as-api-env>" -SqlServerHost "prod-sql-01.yourdomain.local" -SqlAuthType "sql" -SqlUsername "sqlmonitor_svc" -SqlPassword "<service-account-password>" -SqlEncrypt $true -SqlTrustServerCert $true`

Entra service principal example (Azure SQL):

`./onboard-datacenter.ps1 -ApiBaseUrl "http://<dashboard-api-host>:3001" -AdminUsername "admin" -AdminPassword "admin123!" -ServerName "AzureSql-Prod" -Hostname "<server>.database.windows.net" -Environment "production" -MonitorApiKey "<same-value-as-api-env>" -SqlServerHost "<server>.database.windows.net" -SqlAuthType "entra_sp" -SqlDatabase "master" -SqlEncrypt $true -SqlTrustServerCert $false -SqlEntraTenantId "<tenant-id>" -SqlEntraClientId "<client-id>" -SqlEntraClientSecret "<client-secret>"`

This command:

- Logs in to API
- Creates or reuses server record
- Writes collector config to `collector/.env` with the right `SERVER_ID`

5. Start collector

`npm run dev -w collector`

6. Validate ingestion

- Open dashboard and check `Servers` page status
- Confirm metrics are appearing in `Dashboard` and `Server Detail`
- Optional API checks:
   - `GET /api/dashboard/summary`
   - `GET /api/servers`
   - `GET /api/servers/:id/metrics`

## Recommended Production Topology

- Deploy API + web near SQLMonitorDB (central management network)
- Deploy one collector per monitored SQL Server or per trusted network segment
- Restrict inbound access to API port 3001
- Allow collector outbound HTTPS/HTTP to API only
- Rotate `MONITOR_API_KEY` and service account passwords periodically
