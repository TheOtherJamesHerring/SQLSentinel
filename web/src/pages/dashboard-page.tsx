import { Activity, AlertTriangle, ArrowRight, Database, HardDrive, PlusCircle, Server, SplitSquareVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarComparisonChart } from "@/components/charts/bar-comparison-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { useApiQuery } from "@/hooks/useApiQuery";

interface Summary {
  totalServers: number;
  online: number;
  offline: number;
  criticalAlerts: number;
  blockedProcesses: number;
}

interface IngestionHeartbeat {
  totalServers: number;
  staleServers: number;
  lastHeartbeatAt: string | null;
  lastMetricAt: string | null;
  lastEventAt: string | null;
  lastBlockingAt: string | null;
  lastIngestionAt: string | null;
}

interface RecentAlert {
  AlertId: string;
  ServerId: string | null;
  DatabaseId: string | null;
  ServerName: string | null;
  DatabaseName: string | null;
  Severity: "critical" | "warning" | "info";
  Title: string;
}

interface Hotspots {
  topBlockedDatabases: Array<{
    ServerId: string;
    ServerName: string | null;
    DatabaseName: string;
    DatabaseId: string | null;
    BlockedSamples: number;
    MaxWaitMs: number;
    AvgWaitMs: number;
  }>;
  waitTypeBreakdown: Array<{ WaitType: string; Samples: number; MaxWaitMs: number }>;
  diskPressure: Array<{
    ServerId: string;
    ServerName: string;
    VolumeName: string;
    UsedPercent: number;
    FreeSpaceGb: number;
    Status: string;
  }>;
  tempdbPressure: Array<{ ServerId: string; ServerName: string; TempdbUsedPercent: number; Timestamp: string }>;
}

interface Continuity {
  summary: {
    totalDatabases: number;
    backupCritical: number;
    backupWarning: number;
    loginFailures24h: number;
    lastFullBackupAt: string | null;
    lastLogBackupAt: string | null;
  };
  backupGaps: Array<{
    DatabaseId: string;
    ServerId: string;
    ServerName: string | null;
    Name: string;
    RecoveryModel: string | null;
    BackupStatus: string;
    LastFullBackup: string | null;
    LastLogBackup: string | null;
  }>;
  loginFailureSamples: Array<{
    LogEventId: string;
    ServerId: string;
    EventTime: string;
    Severity: string;
    Message: string;
  }>;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "No data yet";
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return "No data yet";
  }
  return dt.toLocaleString();
}

function toneForBackup(status: string) {
  if (status === "critical") return "danger" as const;
  if (status === "warning") return "warning" as const;
  return "success" as const;
}

export function DashboardPage() {
  const summary = useApiQuery<Summary>(["summary"], "/dashboard/summary", { refetchInterval: 30_000 });
  const recent = useApiQuery<Array<{ ServerId: string; Name: string; Status: string; CpuUsage: number; MemoryUsage: number; DiskUsage: number }>>(
    ["recent"],
    "/dashboard/metrics/recent",
    { refetchInterval: 30_000 }
  );
  const alerts = useApiQuery<RecentAlert[]>(["recent-alerts"], "/dashboard/alerts/recent", { refetchInterval: 30_000 });
  const heartbeat = useApiQuery<IngestionHeartbeat>(["ingestion-heartbeat"], "/dashboard/ingestion/heartbeat", { refetchInterval: 30_000 });
  const hotspots = useApiQuery<Hotspots>(["hotspots"], "/dashboard/hotspots", { refetchInterval: 30_000 });
  const continuity = useApiQuery<Continuity>(["continuity"], "/dashboard/continuity", { refetchInterval: 60_000 });

  const noServers = !summary.isLoading && (summary.data?.totalServers ?? 0) === 0;

  const metrics = [
    { label: "Total Servers", value: summary.data?.totalServers ?? 0, icon: Server, border: "border-l-blue-500", isRisk: false },
    {
      label: "Online / Offline",
      value: `${summary.data?.online ?? 0} / ${summary.data?.offline ?? 0}`,
      icon: Activity,
      border: (summary.data?.offline ?? 0) > 0 ? "border-l-danger" : "border-l-success",
      isRisk: (summary.data?.offline ?? 0) > 0
    },
    {
      label: "Critical Alerts",
      value: summary.data?.criticalAlerts ?? 0,
      icon: AlertTriangle,
      border: (summary.data?.criticalAlerts ?? 0) > 0 ? "border-l-danger" : "border-l-slate-500",
      isRisk: (summary.data?.criticalAlerts ?? 0) > 0
    },
    {
      label: "Blocked Processes",
      value: summary.data?.blockedProcesses ?? 0,
      icon: SplitSquareVertical,
      border: (summary.data?.blockedProcesses ?? 0) > 0 ? "border-l-warning" : "border-l-slate-500",
      isRisk: (summary.data?.blockedProcesses ?? 0) > 0
    }
  ];

  const onlinePct = summary.data?.totalServers
    ? Math.round(((summary.data.online ?? 0) / summary.data.totalServers) * 100)
    : 0;

  const riskServers = (recent.data ?? []).filter((s) =>
    Number(s.CpuUsage ?? 0) >= 80 || Number(s.MemoryUsage ?? 0) >= 85 || Number(s.DiskUsage ?? 0) >= 85
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Virtual Remote DBA Dashboard</h1>
        <p className="text-muted">Real-time SQL Server remote monitoring and preventive analytics.</p>
      </header>

      {/* First-run empty state */}
      {noServers && (
        <Card className="border-blue-500/30 bg-blue-600/5">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center sm:flex-row sm:text-left sm:items-start sm:gap-6">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400">
              <Server className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">No servers connected yet</h3>
              <p className="mt-1 text-sm text-muted">
                Use the setup wizard to connect your first SQL Server. It takes about 2 minutes and
                walks you through the connection, credentials, and collector deployment.
              </p>
              <Link
                to="/servers/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-[#fff] shadow transition hover:bg-blue-500"
              >
                <PlusCircle className="h-4 w-4" /> Add Your First Server
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card
            key={metric.label}
            className={`border-l-4 ${metric.border} transition-shadow ${
              metric.isRisk ? "bg-danger/5 shadow-sm shadow-danger/20" : ""
            }`}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{metric.label}</p>
                <p
                  className={`mt-1 font-semibold ${
                    metric.isRisk ? "text-3xl text-danger" : "text-2xl text-foreground"
                  }`}
                >
                  {metric.value}
                </p>
              </div>
              <metric.icon
                className={`h-6 w-6 ${metric.isRisk ? "text-danger/60" : "text-muted"}`}
              />
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <Card className={heartbeat.data && heartbeat.data.staleServers > 0 ? "border-red-500/40" : "border-emerald-500/40"}>
          <CardHeader>
            <CardTitle>Collector Ingestion Heartbeat</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Status</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {heartbeat.data
                  ? heartbeat.data.staleServers === 0
                    ? "Healthy"
                    : `${heartbeat.data.staleServers}/${heartbeat.data.totalServers} stale`
                  : "Loading..."}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Last Ingestion</p>
              <p className="mt-1 text-sm text-foreground">{formatTimestamp(heartbeat.data?.lastIngestionAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Last Event Write</p>
              <p className="mt-1 text-sm text-foreground">{formatTimestamp(heartbeat.data?.lastEventAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Last Blocking Write</p>
              <p className="mt-1 text-sm text-foreground">{formatTimestamp(heartbeat.data?.lastBlockingAt)}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>CPU Pressure by Server</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <TimeSeriesChart
                color="#0080FF"
                warnThreshold={80}
                criticalThreshold={90}
                data={(recent.data ?? []).map((row) => ({ name: row.Name, value: row.CpuUsage ?? 0 }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fleet Health Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Online coverage</span>
                <span className="font-semibold text-foreground">{onlinePct}%</span>
              </div>
              <div className="h-2 rounded-full bg-gauge-track">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${onlinePct}%` }} />
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Servers with active risk signals</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{riskServers.length}</p>
              <Link to="/servers" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200">
                Open fleet list <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Critical open alerts</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{summary.data?.criticalAlerts ?? 0}</p>
              <Link to="/alerts" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200">
                Investigate alerts <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Blocked Databases (Last 6h)</CardTitle>
          </CardHeader>
          <CardContent>
            {hotspots.isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <BarComparisonChart
                data={(hotspots.data?.topBlockedDatabases ?? []).map((row) => ({
                  name: row.DatabaseName,
                  value: Number(row.BlockedSamples ?? 0)
                }))}
              />
            )}
            <div className="mt-4 space-y-2">
              {(hotspots.data?.topBlockedDatabases ?? []).slice(0, 5).map((row) => (
                <div key={`${row.ServerId}-${row.DatabaseName}`} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">{row.DatabaseName}</p>
                    <span className="text-amber-300">{row.BlockedSamples} blocks</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{row.ServerName ?? "Unknown server"} • max wait {Math.round(Number(row.MaxWaitMs ?? 0))} ms</p>
                  <div className="mt-2 flex items-center gap-3">
                    {row.DatabaseId ? (
                      <Link to={`/databases/${row.DatabaseId}`} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                        <Database className="h-3.5 w-3.5" /> DB posture
                      </Link>
                    ) : null}
                    <Link to={`/servers/${row.ServerId}`} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                      <Server className="h-3.5 w-3.5" /> Server detail
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wait Type Breakdown (Last 6h)</CardTitle>
          </CardHeader>
          <CardContent>
            {hotspots.isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <BarComparisonChart
                data={(hotspots.data?.waitTypeBreakdown ?? []).map((row) => ({
                  name: row.WaitType,
                  value: Number(row.Samples ?? 0)
                }))}
              />
            )}
            <Link to="/events" className="mt-4 inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200">
              Drill into related events <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage Pressure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(hotspots.data?.diskPressure ?? []).slice(0, 6).map((disk) => (
              <div key={`${disk.ServerId}-${disk.VolumeName}`} className={`rounded-lg border p-3 text-sm ${
                Number(disk.UsedPercent ?? 0) >= 90
                  ? "border-danger/40 bg-danger/5"
                  : Number(disk.UsedPercent ?? 0) >= 80
                  ? "border-warning/40 bg-warning/5"
                  : "border-border"
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-foreground">{disk.ServerName} &bull; {disk.VolumeName}</p>
                  <RiskGauge value={Number(disk.UsedPercent ?? 0)} warn={80} critical={90} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  Free: <strong>{Number(disk.FreeSpaceGb ?? 0).toFixed(1)} GB</strong>
                </p>
                <Link to={`/servers/${disk.ServerId}`} className="mt-2 inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                  <HardDrive className="h-3.5 w-3.5" /> Inspect storage on server
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Alerts With Drill-Through</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(alerts.data ?? []).slice(0, 10).map((alert) => (
              <div
                key={alert.AlertId}
                className={`rounded-lg border-l-4 border border-border p-3 ${
                  alert.Severity === "critical"
                    ? "border-l-danger bg-danger/5"
                    : alert.Severity === "warning"
                    ? "border-l-warning bg-warning/5"
                    : "border-l-primary"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className={`text-sm font-semibold ${
                    alert.Severity === "critical" ? "text-danger" : "text-foreground"
                  }`}>{alert.Title}</p>
                  <Badge label={alert.Severity} tone={alert.Severity === "critical" ? "danger" : alert.Severity === "warning" ? "warning" : "primary"} />
                </div>
                <p className="text-xs text-muted">{alert.ServerName ?? "Unknown server"}{alert.DatabaseName ? ` • ${alert.DatabaseName}` : ""}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {alert.DatabaseId ? (
                    <Link to={`/databases/${alert.DatabaseId}`} className="text-xs text-blue-300 hover:text-blue-200">Open database posture</Link>
                  ) : null}
                  {alert.ServerId ? (
                    <Link to={`/servers/${alert.ServerId}`} className="text-xs text-blue-300 hover:text-blue-200">Open server details</Link>
                  ) : null}
                  <Link to="/events" className="text-xs text-blue-300 hover:text-blue-200">Related logs</Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Continuity: Backups and Restore Readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">DBs monitored</p>
                <p className="mt-1 text-xl font-semibold text-white">{continuity.data?.summary.totalDatabases ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Backup critical</p>
                <p className="mt-1 text-xl font-semibold text-red-400">{continuity.data?.summary.backupCritical ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Backup warning</p>
                <p className="mt-1 text-xl font-semibold text-amber-400">{continuity.data?.summary.backupWarning ?? 0}</p>
              </div>
            </div>
            <div className="space-y-2">
              {(continuity.data?.backupGaps ?? []).slice(0, 6).map((db) => (
                <div key={db.DatabaseId} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{db.Name}</p>
                    <Badge label={db.BackupStatus} tone={toneForBackup(db.BackupStatus)} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{db.ServerName ?? "Unknown server"} • Recovery: {db.RecoveryModel ?? "-"}</p>
                  <p className="text-xs text-slate-500">Full: {formatTimestamp(db.LastFullBackup)} • Log: {formatTimestamp(db.LastLogBackup)}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Link to={`/databases/${db.DatabaseId}`} className="text-xs text-blue-300 hover:text-blue-200">Database posture</Link>
                    <Link to={`/servers/${db.ServerId}`} className="text-xs text-blue-300 hover:text-blue-200">Server details</Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Continuity: Login Sync Risk (24h)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Failed logins detected</p>
              <p className="mt-1 text-2xl font-semibold text-white">{continuity.data?.summary.loginFailures24h ?? 0}</p>
              <Link to="/events?source=sql_error_log&severity=error" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200">
                Open authentication-related event trail <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-2">
              {(continuity.data?.loginFailureSamples ?? []).slice(0, 6).map((event) => (
                <div key={event.LogEventId} className="rounded-lg border border-border p-3 text-sm">
                  <p className="text-xs text-slate-500">{formatTimestamp(event.EventTime)}</p>
                  <p className="mt-1 line-clamp-2 text-slate-300">{event.Message}</p>
                  <Link to={`/servers/${event.ServerId}`} className="mt-2 inline-flex text-xs text-blue-300 hover:text-blue-200">Go to server</Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
