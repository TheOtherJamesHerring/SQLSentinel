import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { ServerSummary } from "@/lib/types";

const statusTone = {
  online: "success",
  warning: "warning",
  critical: "danger",
  offline: "muted",
  unknown: "muted"
} as const;

type SortKey = "Name" | "CpuUsage" | "MemoryUsage" | "DiskUsage";

interface MetricPoint {
  Timestamp: string;
  MetricType: string;
  MetricName: string | null;
  Value: number | string;
  Unit: string | null;
}

interface SystemContext {
  role: string;
  businessHours: string;
  workloadProfile: string;
  sensitiveData: string;
}

interface ReducedPoint {
  timestamp: string;
  value: number;
}

interface StatsSummary {
  mean: number;
  stdDev: number;
  latest: number;
}

interface FindingItem {
  summary: string;
  timestamp: string;
  magnitude: string;
  durationMinutes: number;
  evidence: Record<string, string | number | boolean | null>;
  recommendedAction: "MONITOR" | "INVESTIGATE" | "ESCALATE";
}

interface TrendItem {
  summary: string;
  observedFrom: string;
  observedTo: string;
  slopePerHour: number;
  projectedThresholdBreach: string | null;
  evidence: Record<string, string | number | boolean | null>;
  recommendedAction: "MONITOR" | "INVESTIGATE" | "ESCALATE";
}

interface RiskSignalItem {
  pattern: string;
  rationale: string;
  evidence: Record<string, string | number | boolean | null>;
  recommendedAction: "MONITOR" | "INVESTIGATE" | "ESCALATE";
}

function toIsoHoursAgo(hoursAgo: number) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeStats(points: ReducedPoint[]): StatsSummary {
  const values = points.map((point) => point.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(values.length, 1);
  return {
    mean: round(mean),
    stdDev: round(Math.max(Math.sqrt(variance), 0.01)),
    latest: round(values.at(-1) ?? 0)
  };
}

function groupMetrics(points: MetricPoint[], metricType: string): ReducedPoint[] {
  const grouped = new Map<string, number[]>();
  for (const point of points) {
    if (point.MetricType !== metricType) continue;
    const value = Number(point.Value);
    if (!Number.isFinite(value)) continue;
    const bucket = grouped.get(point.Timestamp) ?? [];
    bucket.push(value);
    grouped.set(point.Timestamp, bucket);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime())
    .map(([timestamp, values]) => ({
      timestamp,
      value: round(metricType === "disk"
        ? Math.max(...values)
        : values.reduce((sum, value) => sum + value, 0) / values.length)
    }));
}

function actionForSeverity(severity: number): "MONITOR" | "INVESTIGATE" | "ESCALATE" {
  if (severity >= 8) return "ESCALATE";
  if (severity >= 4) return "INVESTIGATE";
  return "MONITOR";
}

function detectAnomalies(points: ReducedPoint[], metricLabel: string): FindingItem[] {
  if (points.length < 6) return [];

  const stats = computeStats(points);
  const threshold = stats.mean + (2 * stats.stdDev);
  const lowerThreshold = stats.mean - (2 * stats.stdDev);
  const flagged = points.filter((point) => point.value > threshold || point.value < lowerThreshold);
  if (flagged.length === 0) return [];

  const groups: ReducedPoint[][] = [];
  for (const point of flagged) {
    const lastGroup = groups.at(-1);
    const previous = lastGroup?.at(-1);
    const withinGap = previous
      ? new Date(point.timestamp).getTime() - new Date(previous.timestamp).getTime() <= 15 * 60 * 1000
      : false;
    if (!lastGroup || !withinGap) {
      groups.push([point]);
    } else {
      lastGroup.push(point);
    }
  }

  return groups.slice(0, 4).map((group) => {
    const start = group[0];
    const end = group[group.length - 1];
    const peak = group.reduce((selected, point) =>
      Math.abs(point.value - stats.mean) > Math.abs(selected.value - stats.mean) ? point : selected,
    group[0]);
    const durationMinutes = Math.max(0, Math.round((new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime()) / 60000));
    const sigma = Math.abs(peak.value - stats.mean) / Math.max(stats.stdDev, 0.01);
    return {
      summary: `${metricLabel} deviated beyond 2σ from its 24-hour baseline.`,
      timestamp: start.timestamp,
      magnitude: `${round(peak.value - stats.mean)} vs baseline ${stats.mean} (${round(sigma, 1)}σ)`,
      durationMinutes,
      evidence: {
        peakValue: peak.value,
        baselineMean: stats.mean,
        standardDeviation: stats.stdDev,
        upperThreshold: round(threshold),
        lowerThreshold: round(lowerThreshold)
      },
      recommendedAction: actionForSeverity(sigma >= 4 || durationMinutes >= 45 ? 8 : sigma >= 3 ? 5 : 3)
    };
  });
}

function detectTrend(points: ReducedPoint[], metricLabel: string, warnThreshold: number): TrendItem[] {
  if (points.length < 6) return [];

  const lastWindow = points.filter((point) => new Date(point.timestamp).getTime() >= Date.now() - (45 * 60 * 1000));
  if (lastWindow.length < 4) return [];

  const start = lastWindow[0];
  const end = lastWindow[lastWindow.length - 1];
  const hours = Math.max((new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime()) / 3600000, 0.01);
  const delta = end.value - start.value;
  const slopePerHour = round(delta / hours);
  const stats = computeStats(points);
  if (Math.abs(delta) < Math.max(5, stats.stdDev * 1.25)) return [];

  let projectedThresholdBreach: string | null = null;
  if (slopePerHour > 0 && end.value < warnThreshold) {
    const hoursToThreshold = (warnThreshold - end.value) / slopePerHour;
    if (hoursToThreshold > 0 && hoursToThreshold <= 4) {
      projectedThresholdBreach = `${round(hoursToThreshold, 2)}h to ${warnThreshold}%`;
    }
  }

  const severity = projectedThresholdBreach ? 7 : end.value >= warnThreshold ? 6 : 3;
  return [{
    summary: `${metricLabel} has moved ${delta > 0 ? "upward" : "downward"} for at least 30 minutes.`,
    observedFrom: start.timestamp,
    observedTo: end.timestamp,
    slopePerHour,
    projectedThresholdBreach,
    evidence: {
      startValue: start.value,
      endValue: end.value,
      delta: round(delta),
      baselineMean: stats.mean,
      threshold: warnThreshold
    },
    recommendedAction: actionForSeverity(severity)
  }];
}

function baselineDeviationScore(points: ReducedPoint[], warnThreshold: number, criticalThreshold: number) {
  if (points.length === 0) return 1;
  const stats = computeStats(points);
  const latest = stats.latest;
  const zScore = Math.abs(latest - stats.mean) / Math.max(stats.stdDev, 0.01);
  let score = 1 + Math.min(6, Math.round(zScore * 1.5));
  if (latest >= warnThreshold) score += 1;
  if (latest >= criticalThreshold) score += 2;
  return Math.max(1, Math.min(10, score));
}

function buildRiskSignals(cpu: ReducedPoint[], memory: ReducedPoint[], disk: ReducedPoint[], cpuTrend: TrendItem[], memoryTrend: TrendItem[], diskTrend: TrendItem[], cpuAnomalies: FindingItem[], memoryAnomalies: FindingItem[], diskAnomalies: FindingItem[], context: SystemContext): RiskSignalItem[] {
  const signals: RiskSignalItem[] = [];
  const cpuStats = computeStats(cpu);
  const memoryStats = computeStats(memory);
  const diskStats = computeStats(disk);
  const cpuFlat = cpu.slice(-6).every((point) => Math.abs(point.value - cpuStats.latest) <= 2);
  const memoryFlat = memory.slice(-6).every((point) => Math.abs(point.value - memoryStats.latest) <= 2);
  const diskFlat = disk.slice(-6).every((point) => Math.abs(point.value - diskStats.latest) <= 2);
  const cpuHigh = cpuStats.latest >= 80 || cpuTrend.some((trend) => trend.slopePerHour > 0 && (trend.evidence.endValue as number) >= 75);
  const diskHigh = diskStats.latest >= 80 || diskTrend.some((trend) => trend.slopePerHour > 0 && (trend.evidence.endValue as number) >= 75);
  const memoryRising = memoryTrend.some((trend) => trend.slopePerHour >= 3);
  const memoryDropping = memoryTrend.some((trend) => trend.slopePerHour <= -3) || memoryAnomalies.some((item) => item.magnitude.includes("-"));

  if (cpuHigh && diskHigh && memoryFlat) {
    signals.push({
      pattern: "possible_exfiltration_or_crypto_mining",
      rationale: "CPU and disk are elevated while memory remains flat, matching a common sustained compute-plus-I/O abuse pattern.",
      evidence: {
        cpuLatest: cpuStats.latest,
        diskLatest: diskStats.latest,
        memoryLatest: memoryStats.latest,
        memoryFlat
      },
      recommendedAction: "INVESTIGATE"
    });
  }

  if (memoryRising && cpuFlat) {
    signals.push({
      pattern: "possible_memory_leak_or_agent_accumulation",
      rationale: "Memory is rising steadily while CPU remains flat, consistent with a leak or persistent process accumulation.",
      evidence: {
        memoryLatest: memoryStats.latest,
        cpuLatest: cpuStats.latest,
        cpuFlat,
        memoryTrendPerHour: memoryTrend[0]?.slopePerHour ?? null
      },
      recommendedAction: memoryStats.latest >= 85 ? "ESCALATE" : "INVESTIGATE"
    });
  }

  if (cpuAnomalies.length > 0 && diskAnomalies.length > 0 && memoryDropping) {
    signals.push({
      pattern: "possible_data_deletion_or_ransomware_staging",
      rationale: "Disk and CPU spiked while memory dropped, which aligns with bursty destructive or staging activity.",
      evidence: {
        cpuAnomalyAt: cpuAnomalies[0]?.timestamp ?? null,
        diskAnomalyAt: diskAnomalies[0]?.timestamp ?? null,
        memoryLatest: memoryStats.latest,
        memoryDropping
      },
      recommendedAction: "ESCALATE"
    });
  }

  const currentHour = new Date().getHours();
  const likelyActiveWindow = /24x7|always|follow-the-sun|business/i.test(context.businessHours)
    ? true
    : currentHour >= 8 && currentHour <= 18;

  if (likelyActiveWindow && cpuFlat && memoryFlat && diskFlat) {
    signals.push({
      pattern: "possible_monitoring_gap_or_dead_sensor",
      rationale: "All three metrics are unnaturally flat during an expected activity window.",
      evidence: {
        cpuLatest: cpuStats.latest,
        memoryLatest: memoryStats.latest,
        diskLatest: diskStats.latest,
        businessHours: context.businessHours
      },
      recommendedAction: "INVESTIGATE"
    });
  }

  return signals;
}

function buildAnalysis(server: ServerSummary | null, metrics: MetricPoint[], context: SystemContext) {
  const cpu = groupMetrics(metrics, "cpu");
  const memory = groupMetrics(metrics, "memory");
  const disk = groupMetrics(metrics, "disk");
  const cpuAnomalies = detectAnomalies(cpu, "CPU");
  const memoryAnomalies = detectAnomalies(memory, "Memory");
  const diskAnomalies = detectAnomalies(disk, "Disk I/O");
  const cpuTrend = detectTrend(cpu, "CPU", 80);
  const memoryTrend = detectTrend(memory, "Memory", 85);
  const diskTrend = detectTrend(disk, "Disk I/O", 80);
  const riskSignals = buildRiskSignals(cpu, memory, disk, cpuTrend, memoryTrend, diskTrend, cpuAnomalies, memoryAnomalies, diskAnomalies, context);

  return {
    server: {
      serverId: server?.ServerId ?? null,
      name: server?.Name ?? null,
      hostname: server?.Hostname ?? null,
      generatedAtUtc: new Date().toISOString()
    },
    systemContext: context,
    findings: {
      anomalies: {
        cpu: cpuAnomalies,
        memory: memoryAnomalies,
        disk_io: diskAnomalies
      },
      trends: {
        cpu: cpuTrend,
        memory: memoryTrend,
        disk_io: diskTrend
      },
      riskSignal: riskSignals,
      baselineDeviationScore: {
        cpu: baselineDeviationScore(cpu, 80, 90),
        memory: baselineDeviationScore(memory, 85, 95),
        disk_io: baselineDeviationScore(disk, 80, 90)
      }
    }
  };
}

export function ServersPage() {
  const { data } = useApiQuery<ServerSummary[]>(["servers"], "/servers");
  const [sortBy, setSortBy] = useState<SortKey>("Name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [systemContext, setSystemContext] = useState<SystemContext>({
    role: "Production SQL Server for line-of-business workloads",
    businessHours: "Business hours 08:00-18:00 local time, Monday-Friday",
    workloadProfile: "Steady daytime transactional workload with lower overnight activity",
    sensitiveData: "Handles regulated operational and customer data"
  });

  const selectedServer = useMemo(
    () => (data ?? []).find((server) => server.ServerId === selectedServerId) ?? null,
    [data, selectedServerId]
  );
  const metricsPath = selectedServerId
    ? `/servers/${selectedServerId}/metrics?from=${encodeURIComponent(toIsoHoursAgo(24))}`
    : "";
  const metricsQuery = useApiQuery<MetricPoint[]>(
    ["server-analysis-metrics", selectedServerId],
    metricsPath,
    { enabled: Boolean(selectedServerId) }
  );

  const sorted = useMemo(() => {
    const rows = [...(data ?? [])];
    rows.sort((a, b) => {
      const aValue = a[sortBy] ?? 0;
      const bValue = b[sortBy] ?? 0;
      if (typeof aValue === "string" && typeof bValue === "string") {
        return direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }
      return direction === "asc" ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue);
    });
    return rows;
  }, [data, sortBy, direction]);

  const analysis = useMemo(() => {
    if (!selectedServer || !metricsQuery.data) return null;
    return buildAnalysis(selectedServer, metricsQuery.data, systemContext);
  }, [metricsQuery.data, selectedServer, systemContext]);

  const analysisJson = useMemo(
    () => (analysis ? JSON.stringify(analysis, null, 2) : ""),
    [analysis]
  );

  function sortableHeader(label: string, key: SortKey) {
    return (
      <button
        className="text-left text-xs uppercase tracking-wide text-slate-400"
        onClick={() => {
          if (sortBy === key) {
            setDirection((d) => (d === "asc" ? "desc" : "asc"));
          } else {
            setSortBy(key);
            setDirection("asc");
          }
        }}
      >
        {label}
      </button>
    );
  }

  function copyAnalysis() {
    if (!analysisJson) return;
    navigator.clipboard.writeText(analysisJson).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Monitored SQL Servers</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>{sortableHeader("Server", "Name")}</TH>
                <TH>Version</TH>
                <TH>Uptime</TH>
                <TH>{sortableHeader("CPU%", "CpuUsage")}</TH>
                <TH>{sortableHeader("Memory%", "MemoryUsage")}</TH>
                <TH>{sortableHeader("Disk%", "DiskUsage")}</TH>
                <TH>Connections</TH>
                <TH>Status</TH>
                <TH>Analysis</TH>
              </TR>
            </THead>
            <tbody>
              {sorted.map((server) => {
                const cpu = server.CpuUsage ?? 0;
                const mem = server.MemoryUsage ?? 0;
                const disk = server.DiskUsage ?? 0;
                const isRisk = cpu >= 80 || mem >= 85 || disk >= 85;
                return (
                  <TR key={server.ServerId} className={isRisk ? "bg-warning/5" : ""}>
                    <TD>
                      <Link to={`/servers/${server.ServerId}`} className="font-semibold text-blue-300 hover:text-blue-200">
                        {server.Name}
                      </Link>
                      <p className="text-xs text-slate-400">{server.Hostname}</p>
                    </TD>
                    <TD>{server.SqlVersion ?? "-"}</TD>
                    <TD>{server.UptimeDays?.toFixed(1) ?? "-"}d</TD>
                    <TD>
                      <RiskGauge value={cpu} warn={80} critical={90} />
                    </TD>
                    <TD>
                      <RiskGauge value={mem} warn={85} critical={95} />
                    </TD>
                    <TD>
                      <RiskGauge value={disk} warn={80} critical={90} />
                    </TD>
                    <TD>{server.ActiveConnections ?? 0}</TD>
                    <TD>
                      <Badge label={server.Status} tone={statusTone[server.Status]} />
                    </TD>
                    <TD>
                      <button
                        type="button"
                        onClick={() => setSelectedServerId(server.ServerId)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${selectedServerId === server.ServerId ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-border"}`}
                      >
                        {selectedServerId === server.ServerId ? "Analyzing" : "Analyze JSON"}
                      </button>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CIO / SOC Telemetry Findings JSON</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted">System role</span>
              <input
                value={systemContext.role}
                onChange={(event) => setSystemContext((current) => ({ ...current, role: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Normal business hours</span>
              <input
                value={systemContext.businessHours}
                onChange={(event) => setSystemContext((current) => ({ ...current, businessHours: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Expected workload profile</span>
              <input
                value={systemContext.workloadProfile}
                onChange={(event) => setSystemContext((current) => ({ ...current, workloadProfile: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Sensitive data handling</span>
              <input
                value={systemContext.sensitiveData}
                onChange={(event) => setSystemContext((current) => ({ ...current, sensitiveData: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>

          {!selectedServerId && (
            <div className="rounded-lg border border-border bg-card/40 px-3 py-3 text-sm text-muted">
              Select a server above to generate 24-hour CPU, memory, and disk I/O findings JSON.
            </div>
          )}

          {selectedServerId && metricsQuery.isLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-3 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the last 24 hours of telemetry...
            </div>
          )}

          {selectedServerId && metricsQuery.error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
              Failed to load telemetry for analysis.
            </div>
          )}

          {analysis && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{selectedServer?.Name}</p>
                  <p className="text-xs text-muted">Structured findings only. No raw telemetry returned.</p>
                </div>
                <button
                  type="button"
                  onClick={copyAnalysis}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-border"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? "Copied" : "Copy JSON"}
                </button>
              </div>

              <pre className="max-h-[40rem] overflow-auto rounded-lg border border-border bg-background p-4 text-xs leading-6 text-foreground">
                {analysisJson}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
