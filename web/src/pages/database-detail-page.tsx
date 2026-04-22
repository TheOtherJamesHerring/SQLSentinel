import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  Minus,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Table2,
  Eye,
  Code2,
  Braces,
  ListOrdered,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  Activity,
  RefreshCw,
  Wrench,
  HardDrive,
  Database,
  XCircle,
  Loader2,
  CircleCheck
} from "lucide-react";
import { api } from "@/lib/api";

const READ_ONLY_QUERY_TEMPLATES = [
  {
    label: "Recent expensive statements",
    sql: "SELECT TOP 50 total_worker_time, execution_count, total_logical_reads FROM sys.dm_exec_query_stats ORDER BY total_worker_time DESC;"
  },
  {
    label: "Current waits",
    sql: "SELECT TOP 50 wait_type, wait_time_ms, waiting_tasks_count FROM sys.dm_os_wait_stats ORDER BY wait_time_ms DESC;"
  },
  {
    label: "Top index usage",
    sql: "SELECT TOP 50 * FROM sys.dm_db_index_usage_stats WHERE database_id = DB_ID() ORDER BY user_seeks DESC;"
  },
  {
    label: "Top active requests",
    sql: "SELECT TOP 50 session_id, status, wait_type, wait_time, cpu_time, logical_reads FROM sys.dm_exec_requests WHERE database_id = DB_ID() ORDER BY cpu_time DESC;"
  }
];

function fmt(value: unknown, suffix = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return `${value.toFixed(2)}${suffix}`;
  return `${value}${suffix}`;
}

function toLocale(value: string | null | undefined) {
  if (!value) return "-";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleString();
}

function defaultBackupPathForVolume(volumeName: string): string {
  const trimmed = String(volumeName ?? "").trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]:\\?$/.test(trimmed)) {
    return trimmed.replace(/\\?$/, "\\") + "Backups";
  }
  if (trimmed.endsWith("/")) return `${trimmed}backups`;
  if (trimmed.endsWith("\\")) return `${trimmed}Backups`;
  return `${trimmed}\\Backups`;
}

function readField(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

/** Returns hours since the given ISO timestamp, or null if unavailable. */
function hoursSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return (Date.now() - dt.getTime()) / 3_600_000;
}

function BackupAgeIndicator({
  label,
  timestamp,
  warnHours,
  criticalHours
}: {
  label: string;
  timestamp: string | null | undefined;
  warnHours: number;
  criticalHours: number;
}) {
  const hours = hoursSince(timestamp);
  const isCritical = hours === null || hours >= criticalHours;
  const isWarn     = !isCritical && hours >= warnHours;
  const Icon = isCritical ? ShieldX : isWarn ? ShieldAlert : ShieldCheck;
  const colorClass = isCritical
    ? "text-danger border-danger/30 bg-danger/5"
    : isWarn
    ? "text-warning border-warning/30 bg-warning/5"
    : "text-success border-success/30 bg-success/5";
  const displayAge = hours === null
    ? "Never"
    : hours < 1
    ? `${Math.round(hours * 60)}m ago`
    : hours < 48
    ? `${hours.toFixed(1)}h ago`
    : `${(hours / 24).toFixed(1)}d ago`;
  return (
    <div className={`flex items-center justify-between rounded-lg border p-3 ${colorClass}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">{displayAge}</p>
        <p className="text-xs opacity-70">{toLocale(timestamp)}</p>
      </div>
    </div>
  );
}

export function DatabaseDetailPage() {
  const { id = "" } = useParams();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [lastManualRefresh, setLastManualRefresh] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState("");
  const [showBackupInput, setShowBackupInput] = useState(false);
  const [showQueryInput, setShowQueryInput] = useState(false);
  const [queryText, setQueryText] = useState("");
  const backupInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const detail = useApiQuery<any>(["db", id], `/databases/${id}`);
  const metrics = useApiQuery<any[]>(["db-metrics", id], `/databases/${id}/metrics`);
  const dbcc = useApiQuery<any[]>(["db-dbcc", id], `/databases/${id}/dbcc`);
  const posture = useApiQuery<any>(["db-posture", id], `/databases/${id}/posture`);
  const queryStore = useApiQuery<any[]>(["db-qs", id], `/databases/${id}/query-store`, { refetchInterval: 60_000 });
  const jobs = useApiQuery<any[]>(["db-adhoc-jobs", id], `/databases/${id}/adhoc-jobs`, { refetchInterval: 8_000 });

  const createJob = useMutation({
    mutationFn: (body: { jobType: string; params?: Record<string, unknown> }) =>
      api<{ JobId: string }>(`/databases/${id}/adhoc-jobs`, {
        method: "POST",
        body: JSON.stringify(body)
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["db-adhoc-jobs", id] })
  });

  const cancelJob = useMutation({
    mutationFn: (jobId: string) =>
      api(`/databases/${id}/adhoc-jobs/${jobId}/cancel`, { method: "PATCH" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["db-adhoc-jobs", id] })
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    try {
      await Promise.all([
        detail.refetch(),
        metrics.refetch(),
        dbcc.refetch(),
        posture.refetch(),
        queryStore.refetch()
      ]);
      setLastManualRefresh(new Date().toISOString());
    } finally {
      setManualRefreshing(false);
    }
  };

  const chartData = (metrics.data ?? [])
    .filter((m) => m.MetricType === "db_size")
    .map((m) => ({
    name: new Date(m.Timestamp).toLocaleString(),
    value: Number(m.Value)
  }));
  const schemaStats = posture.data?.schemaStats ?? null;
  const topProcs: any[] = posture.data?.topProcs ?? [];
  const indexHealth: any[] = posture.data?.indexHealth ?? [];
  const bufferCacheHitRatio: number | null = posture.data?.bufferCacheHitRatio ?? null;
  const dbMeta = posture.data?.database ?? detail.data ?? {};
  const fullBackupName = readField(dbMeta, ["FullBackupName", "fullBackupName", "full_backup_name", "name"]);
  const diffBackupName = readField(dbMeta, ["DiffBackupName", "diffBackupName", "diff_backup_name"]);
  const logBackupName = readField(dbMeta, ["LogBackupName", "logBackupName", "log_backup_name"]);
  const fullHeaderFileOnly = readField(dbMeta, ["FullHeaderFileOnly", "fullHeaderFileOnly", "full_headerfile_only", "headerfile_only"]);
  const diffHeaderFileOnly = readField(dbMeta, ["DiffHeaderFileOnly", "diffHeaderFileOnly", "diff_headerfile_only"]);
  const logHeaderFileOnly = readField(dbMeta, ["LogHeaderFileOnly", "logHeaderFileOnly", "log_headerfile_only"]);
  const fullBackupLocation = readField(dbMeta, ["FullBackupLocation", "fullBackupLocation", "full_backup_location", "backup_location"]);
  const diffBackupLocation = readField(dbMeta, ["DiffBackupLocation", "diffBackupLocation", "diff_backup_location"]);
  const logBackupLocation = readField(dbMeta, ["LogBackupLocation", "logBackupLocation", "log_backup_location"]);
  const backupLocationChoices = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const disk of posture.data?.diskContext ?? []) {
      const candidate = defaultBackupPathForVolume(String(disk?.VolumeName ?? ""));
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
    return result;
  }, [posture.data?.diskContext]);

  // Compute max exec count for relative proc bars
  const maxExecCount = topProcs.reduce((m: number, p: any) => Math.max(m, Number(p.ExecutionCount ?? 0)), 1);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Database: {detail.data?.Name ?? "Detail"}</h1>
            <p className="text-sm text-slate-400">
              {posture.data?.database?.ServerName ?? "-"} ({posture.data?.database?.Hostname ?? "-"})
            </p>
            {lastManualRefresh && (
              <p className="mt-1 text-xs text-muted">Last manual refresh: {toLocale(lastManualRefresh)}</p>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleManualRefresh()}
            disabled={manualRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${manualRefreshing ? "animate-spin" : ""}`} />
            {manualRefreshing ? "Refreshing..." : "Refresh Now"}
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Health</CardTitle></CardHeader>
          <CardContent>
            <Badge
              label={posture.data?.database?.Health ?? detail.data?.Health ?? "unknown"}
              tone={(posture.data?.database?.Health ?? detail.data?.Health) === "healthy" ? "success" : "warning"}
            />
            <p className="mt-3 text-xs text-muted">Status: {posture.data?.database?.Status ?? detail.data?.Status ?? "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recovery Model</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold text-foreground">{posture.data?.database?.RecoveryModel ?? detail.data?.RecoveryModel ?? "-"}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Data Size</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold text-foreground">{fmt(posture.data?.database?.DataSizeMb ?? detail.data?.DataSizeMb, " MB")}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Log Used %</CardTitle></CardHeader>
          <CardContent className="pt-4">
            <RiskGauge
              value={Number(posture.data?.database?.LogUsedPercent ?? detail.data?.LogUsedPercent ?? 0)}
              warn={70}
              critical={90}
            />
          </CardContent>
        </Card>
      </section>

      {/* ── Schema Objects ─────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Schema Objects</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Tables",    icon: Table2,      value: schemaStats?.TableCnt    ?? "-", color: "text-blue-400" },
            { label: "Views",     icon: Eye,         value: schemaStats?.ViewCnt     ?? "-", color: "text-indigo-400" },
            { label: "Procs",     icon: Code2,       value: schemaStats?.ProcCnt     ?? "-", color: "text-violet-400" },
            { label: "Functions", icon: Braces,      value: schemaStats?.FuncCnt     ?? "-", color: "text-purple-400" },
            { label: "Indexes",   icon: ListOrdered, value: schemaStats?.IndexCnt    ?? "-", color: "text-fuchsia-400" },
          ].map(({ label, icon: Icon, value, color }) => (
            <Card key={label} className="flex flex-row items-center gap-4 p-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
              </div>
            </Card>
          ))}
        </div>
        {schemaStats?.CapturedAt && (
          <p className="mt-1.5 text-xs text-muted">Last collected {toLocale(schemaStats.CapturedAt)}</p>
        )}
        {!schemaStats && !posture.isLoading && (
          <p className="mt-1.5 text-xs text-muted">Schema stats not yet collected — collector will populate on next 5-minute cycle.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Size Growth (Data + Log)</CardTitle></CardHeader>
          <CardContent><TimeSeriesChart data={chartData} color="#0080FF" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Backup &amp; Recovery Posture</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <BackupAgeIndicator
              label="Full backup"
              timestamp={posture.data?.database?.LastFullBackup ?? detail.data?.LastFullBackup}
              warnHours={26}
              criticalHours={48}
            />
            <BackupAgeIndicator
              label="Diff backup"
              timestamp={posture.data?.database?.LastDiffBackup ?? detail.data?.LastDiffBackup}
              warnHours={12}
              criticalHours={24}
            />
            <BackupAgeIndicator
              label="Log backup"
              timestamp={posture.data?.database?.LastLogBackup ?? detail.data?.LastLogBackup}
              warnHours={4}
              criticalHours={6}
            />
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
              <p>Recovery: <strong className="text-foreground">{posture.data?.database?.RecoveryModel ?? detail.data?.RecoveryModel ?? "-"}</strong></p>
              <p>Compat: <strong className="text-foreground">{posture.data?.database?.CompatibilityLevel ?? detail.data?.CompatibilityLevel ?? "-"}</strong></p>
              <p>Backup status: <strong className="text-foreground">{posture.data?.database?.BackupStatus ?? detail.data?.BackupStatus ?? "-"}</strong></p>
              <p>DBCC status: <strong className="text-foreground">{posture.data?.database?.DbccStatus ?? detail.data?.DbccStatus ?? "-"}</strong></p>
            </div>
            <div className="mt-3 space-y-2 rounded-lg border border-border p-3 text-xs text-muted">
              <p className="font-semibold text-foreground">Backup metadata</p>
              <div className="grid grid-cols-1 gap-2">
                <p>
                  Full: <strong className="text-foreground">{String(fullBackupName ?? "-")}</strong>
                  {" "}- headerfile_only: <strong className="text-foreground">{String(fullHeaderFileOnly ?? "-")}</strong>
                </p>
                <p className="break-all">Full location: <strong className="text-foreground">{String(fullBackupLocation ?? "-")}</strong></p>
                <p>
                  Diff: <strong className="text-foreground">{String(diffBackupName ?? "-")}</strong>
                  {" "}- headerfile_only: <strong className="text-foreground">{String(diffHeaderFileOnly ?? "-")}</strong>
                </p>
                <p className="break-all">Diff location: <strong className="text-foreground">{String(diffBackupLocation ?? "-")}</strong></p>
                <p>
                  Log: <strong className="text-foreground">{String(logBackupName ?? "-")}</strong>
                  {" "}- headerfile_only: <strong className="text-foreground">{String(logHeaderFileOnly ?? "-")}</strong>
                </p>
                <p className="break-all">Log location: <strong className="text-foreground">{String(logBackupLocation ?? "-")}</strong></p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Performance Intelligence ────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Buffer Cache Hit Ratio */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              Buffer Cache Hit Ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bufferCacheHitRatio === null ? (
              <p className="text-sm text-muted">No data yet — will populate after first collector cycle.</p>
            ) : (() => {
              const ratio = Number(bufferCacheHitRatio);
              const isGood = ratio >= 95;
              const isWarn = !isGood && ratio >= 90;
              const colorClass = isGood ? "text-success" : isWarn ? "text-warning" : "text-danger";
              const Icon = isGood ? CheckCircle2 : AlertTriangle;
              const fill = isGood ? "bg-success" : isWarn ? "bg-warning" : "bg-danger";
              return (
                <div className="space-y-4">
                  <div className="flex items-end gap-3">
                    <span className={`text-5xl font-bold tabular-nums ${colorClass}`}>{ratio.toFixed(1)}<span className="text-2xl">%</span></span>
                    <Icon className={`mb-1 h-6 w-6 ${colorClass}`} />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className={`absolute inset-y-0 left-0 rounded-full transition-all ${fill}`} style={{ width: `${ratio}%`, opacity: 0.85 }} />
                  </div>
                  <p className="text-xs text-muted">
                    {isGood ? "Excellent — data is served from memory efficiently." : isWarn ? "Moderate — consider increasing buffer pool or reviewing large scans." : "Low — high physical I/O load. Check for memory pressure or large table scans."}
                  </p>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Top Stored Procedures */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Top Stored Procedures
              <span className="ml-auto text-xs font-normal text-muted">by execution count since restart</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProcs.length === 0 ? (
              <p className="text-sm text-muted">No procedure execution data yet.</p>
            ) : (
              <div className="space-y-2">
                {topProcs.map((proc: any, idx: number) => {
                  const execCount = Number(proc.ExecutionCount ?? 0);
                  const pct = maxExecCount > 0 ? (execCount / maxExecCount) * 100 : 0;
                  const avgCpu = Number(proc.AvgCpuMs ?? 0);
                  const cpuColor = avgCpu >= 500 ? "text-danger" : avgCpu >= 100 ? "text-warning" : "text-success";
                  return (
                    <div key={`${proc.ProcName}-${idx}`} className="rounded-lg border border-border p-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs font-semibold text-foreground">{proc.ProcName ?? "(unknown)"}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">{execCount.toLocaleString()} calls</span>
                      </div>
                      <div className="relative mb-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                        <span>Avg CPU: <strong className={cpuColor}>{fmt(proc.AvgCpuMs, " ms")}</strong></span>
                        <span>Total CPU: <strong className="text-foreground">{fmt(proc.TotalCpuMs, " ms")}</strong></span>
                        <span>Logical reads: <strong className="text-foreground">{Number(proc.TotalLogicalReads ?? 0).toLocaleString()}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Index Health ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-primary" />
            Index Health &amp; Fragmentation
          </CardTitle>
        </CardHeader>
        <CardContent>
          {indexHealth.length === 0 ? (
            <p className="text-sm text-muted">No index data yet — collector will populate on next cycle.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Table</th>
                    <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Index</th>
                    <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Type</th>
                    <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted">Frag %</th>
                    <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted">Seeks</th>
                    <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted">Scans</th>
                    <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted">Updates</th>
                    <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted">Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {indexHealth.map((idx: any, i: number) => {
                    const frag = Number(idx.FragmentationPct ?? 0);
                    const fragColor = frag >= 30 ? "text-danger font-bold" : frag >= 10 ? "text-warning font-semibold" : "text-success";
                    const fragBg   = frag >= 30 ? "border-l-danger/50 bg-danger/5" : frag >= 10 ? "border-l-warning/50 bg-warning/5" : "";
                    return (
                      <tr key={`${idx.TableName}-${idx.IndexName}-${i}`} className={`border-t border-border/60 border-l-2 ${fragBg}`}>
                        <td className="px-3 py-2 font-mono text-xs text-foreground">{idx.TableName}</td>
                        <td className="px-3 py-2 font-mono text-xs text-foreground/80">{idx.IndexName}</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">{idx.IndexType}</span>
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${fragColor}`}>{frag.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(idx.UserSeeks ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(idx.UserScans ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(idx.UserUpdates ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(idx.PageCount ?? 0).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">Color: <span className="text-success">green</span> &lt;10% · <span className="text-warning">amber</span> 10–30% · <span className="text-danger">red</span> &gt;30% fragmentation. Indexes with &lt;100 pages excluded.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>TempDB Pressure</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Used %</span>
              <RiskGauge value={Number(posture.data?.tempdb?.TempdbUsedPercent ?? 0)} warn={70} critical={90} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted">
              <p>Used: <strong className="text-foreground">{fmt(posture.data?.tempdb?.TempdbUsedMb, " MB")}</strong></p>
              <p>Version store: <strong className="text-foreground">{fmt(posture.data?.tempdb?.TempdbVersionStoreMb, " MB")}</strong></p>
            </div>
            <p className="text-xs text-muted">Captured: {toLocale(posture.data?.tempdb?.Timestamp)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Storage Context</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(posture.data?.diskContext ?? []).slice(0, 8).map((disk: any) => (
              <div key={`${disk.VolumeName}-${disk.LastCheck}`} className={`rounded-lg border p-3 text-sm ${
                Number(disk.UsedPercent) >= 90 ? "border-danger/30 bg-danger/5" :
                Number(disk.UsedPercent) >= 80 ? "border-warning/30 bg-warning/5" : "border-border"
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">{disk.VolumeName}</p>
                  <RiskGauge value={Number(disk.UsedPercent ?? 0)} warn={80} critical={90} compact />
                </div>
                <p className="text-xs text-muted">Free: {fmt(disk.FreeSpaceGb, " GB")} &nbsp;•&nbsp; Role: {disk.ContainsDataFiles ? "Data" : "-"}/{disk.ContainsLogFiles ? "Log" : "-"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-blue-400" />
            Ad-hoc Tools
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-slate-900/30 p-3 text-xs text-muted">
            Choose an action to queue. For backups, select a suggested location from storage context or enter a custom path.
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={createJob.isPending}
              onClick={() => createJob.mutate({ jobType: "dbcc_checkdb" })}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Run DBCC CHECKDB
            </Button>

            {!showQueryInput ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setShowQueryInput(true);
                  if (!queryText) {
                    setQueryText(READ_ONLY_QUERY_TEMPLATES[0].sql);
                  }
                }}
              >
                <Database className="mr-2 h-4 w-4" />
                Run Read-only Query
              </Button>
            ) : (
              <div className="w-full space-y-2 rounded border border-slate-700 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-8 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-[#fff] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    onChange={(e) => {
                      const selected = READ_ONLY_QUERY_TEMPLATES.find((template) => template.label === e.target.value);
                      if (selected) {
                        setQueryText(selected.sql);
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select query template...</option>
                    {READ_ONLY_QUERY_TEMPLATES.map((template) => (
                      <option key={template.label} value={template.label}>{template.label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">SELECT/CTE only. Write operations are blocked.</span>
                </div>
                <textarea
                  className="min-h-[96px] w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-xs text-[#fff] placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="SELECT TOP 100 * FROM sys.objects ORDER BY name;"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!queryText.trim() || createJob.isPending}
                    onClick={() => {
                      createJob.mutate({ jobType: "sql_query", params: { queryText: queryText.trim() } });
                      setShowQueryInput(false);
                      setQueryText("");
                    }}
                  >
                    Queue Query
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowQueryInput(false);
                      setQueryText("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {!showBackupInput ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setShowBackupInput(true);
                  if (!backupPath && backupLocationChoices.length > 0) {
                    setBackupPath(backupLocationChoices[0]);
                  }
                  setTimeout(() => backupInputRef.current?.focus(), 50);
                }}
              >
                <HardDrive className="mr-2 h-4 w-4" />
                Run Backup
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {backupLocationChoices.length > 0 && (
                  <select
                    className="h-8 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-[#fff] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={backupLocationChoices.includes(backupPath) ? backupPath : "__custom__"}
                    onChange={(e) => {
                      if (e.target.value !== "__custom__") {
                        setBackupPath(e.target.value);
                        setTimeout(() => backupInputRef.current?.focus(), 0);
                      }
                    }}
                  >
                    {backupLocationChoices.map((path) => (
                      <option key={path} value={path}>{path}</option>
                    ))}
                    <option value="__custom__">Custom path...</option>
                  </select>
                )}
                <input
                  ref={backupInputRef}
                  className="w-52 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-[#fff] placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder={backupLocationChoices[0] ?? "D:\\Backups"}
                  value={backupPath}
                  onChange={(e) => setBackupPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && backupPath.trim()) {
                      createJob.mutate({ jobType: "backup", params: { backupPath: backupPath.trim() } });
                      setShowBackupInput(false);
                      setBackupPath("");
                    }
                    if (e.key === "Escape") {
                      setShowBackupInput(false);
                      setBackupPath("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!backupPath.trim() || createJob.isPending}
                  onClick={() => {
                    createJob.mutate({ jobType: "backup", params: { backupPath: backupPath.trim() } });
                    setShowBackupInput(false);
                    setBackupPath("");
                  }}
                >
                  Queue
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowBackupInput(false);
                    setBackupPath("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
            {createJob.isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {createJob.isError && (
              <span className="text-xs text-danger">{String(createJob.error)}</span>
            )}
          </div>

          {(jobs.data ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="pb-1 pr-3 font-medium">Type</th>
                    <th className="pb-1 pr-3 font-medium">Status</th>
                    <th className="pb-1 pr-3 font-medium">Queued</th>
                    <th className="pb-1 pr-3 font-medium">Duration</th>
                    <th className="pb-1 font-medium">Result</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(jobs.data ?? []).map((job: any) => {
                    const statusIcon =
                      job.Status === "completed" ? <CircleCheck className="h-3.5 w-3.5 text-success" /> :
                      job.Status === "failed" ? <XCircle className="h-3.5 w-3.5 text-danger" /> :
                      job.Status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" /> :
                      job.Status === "cancelled" ? <XCircle className="h-3.5 w-3.5 text-muted" /> :
                      <Database className="h-3.5 w-3.5 text-slate-400" />;
                    return (
                      <tr key={job.JobId} className="align-top">
                        <td className="py-1.5 pr-3 font-mono text-foreground/80">
                          {job.JobType === "dbcc_checkdb" ? "DBCC CHECKDB" : job.JobType === "sql_query" ? "Read-only Query" : "Backup"}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span className="flex items-center gap-1 capitalize">{statusIcon}{job.Status}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-muted">{toLocale(job.CreatedAt)}</td>
                        <td className="py-1.5 pr-3 text-muted">
                          {job.DurationMs ? `${(job.DurationMs / 1000).toFixed(1)}s` : "-"}
                        </td>
                        <td className="py-1.5 pr-3 max-w-xs break-words text-foreground/70">
                          {job.ResultSummary ?? "-"}
                        </td>
                        <td className="py-1.5">
                          {job.Status === "pending" && (
                            <button
                              onClick={() => cancelJob.mutate(job.JobId)}
                              className="text-muted hover:text-danger"
                              title="Cancel job"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top Blocking SQL (Last 24h)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(posture.data?.topBlockingStatements ?? []).map((row: any, idx: number) => (
              <div key={`${idx}-${row.hitCount}`} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-mono text-xs text-slate-300 break-words">{row.QueryText}</p>
                <p className="mt-2 text-xs text-slate-500">Hits: {row.hitCount} | Max wait: {fmt(row.maxWaitMs, " ms")} | Avg wait: {fmt(row.avgWaitMs, " ms")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Blocking Sessions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(posture.data?.blocking ?? []).slice(0, 20).map((row: any, idx: number) => (
              <div key={`${row.CapturedAt}-${idx}`} className="rounded-lg border border-border p-3 text-sm">
                <p className="text-white">Session {row.SessionId} blocked by {row.BlockingSessionId} ({row.WaitType ?? "-"})</p>
                <p className="text-xs text-slate-500">Wait: {fmt(row.WaitTimeMs, " ms")} | App: {row.ProgramName ?? "-"}</p>
                <p className="mt-1 line-clamp-2 font-mono text-xs text-slate-300">{row.QueryText ?? "-"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Query Store — Top Regressed Queries</span>
            {(queryStore.data?.length ?? 0) === 0 && !queryStore.isLoading && (
              <span className="text-xs font-normal text-muted">Query Store disabled or no data yet</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {queryStore.isLoading && (
            <p className="text-sm text-muted">Loading…</p>
          )}
          {(queryStore.data ?? []).map((row: any, idx: number) => {
            const ratio = row.RegressionRatio;
            const isRegressed = ratio !== null && ratio > 1.3;
            const isImproved = ratio !== null && ratio < 0.8;
            return (
              <div
                key={`${row.QueryId}-${idx}`}
                className={`rounded-lg border p-3 text-sm ${
                  isRegressed ? "border-danger/30 bg-danger/5" : "border-border"
                }`}
              >
                {/* Ratio hero — visually dominant */}
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="shrink-0">
                    {isRegressed ? (
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-danger">{(ratio as number).toFixed(1)}×</span>
                        <span className="flex items-center gap-0.5 text-xs text-danger"><TrendingUp className="h-3 w-3" />slower</span>
                      </div>
                    ) : isImproved ? (
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl font-bold text-success">&darr;</span>
                        <span className="flex items-center gap-0.5 text-xs text-success"><TrendingDown className="h-3 w-3" />improved</span>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted"><Minus className="h-3 w-3" />stable</span>
                    )}
                  </div>
                  <div className="flex-1 text-right">
                    <span className="text-xs text-muted">Recent: <strong className="text-foreground">{fmt(row.RecentAvgMs, " ms")}</strong></span>
                    {row.HistoricAvgMs > 0 && (
                      <span className="ml-3 text-xs text-muted">Baseline: <strong className="text-foreground">{fmt(row.HistoricAvgMs, " ms")}</strong></span>
                    )}
                  </div>
                </div>
                <p className="font-mono text-xs text-foreground/70 break-all line-clamp-2">{row.QueryText ?? "-"}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                  <span>Execs: <strong className="text-foreground">{row.RecentExecCount ?? "-"}</strong></span>
                  {row.AvgLogicalReads > 0 && <span>Logical reads: <strong className="text-foreground">{fmt(row.AvgLogicalReads, "")}</strong></span>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>DBCC History</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(dbcc.data ?? []).slice(0, 20).map((row) => (
            <div key={row.DbccResultId} className="rounded-lg border border-border p-3 text-sm">
              {toLocale(row.RunDate)} - {row.Status} - errors: {row.ErrorsFound}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Related Events</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(posture.data?.recentEvents ?? []).map((row: any, idx: number) => (
            <div key={`${row.EventTime}-${idx}`} className="rounded-lg border border-border p-3 text-sm">
              <p className="text-white">{row.Severity?.toUpperCase() ?? "INFO"} · {row.Source ?? "-"}</p>
              <p className="text-xs text-slate-500">{toLocale(row.EventTime)} · {row.Category ?? "-"}</p>
              <p className="mt-1 text-slate-300">{row.Message}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
