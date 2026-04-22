import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { Select } from "@/components/ui/select";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";


interface ForecastRow {
  MetricName: string;
  Value: number | string;
  Timestamp: string;
}

interface DatabaseRow {
  DatabaseId: string;
  Name: string;
  DataSizeMb: number | string;
  LogSizeMb: number | string;
  RecoveryModel?: string;
  CompatibilityLevel?: number | string;
  LastBackupDate?: string;
  ServerName?: string;
}

interface DiskRow {
  VolumeName: string;
  UsedPercent: number | string;
}

type CapacityUnit = "GB" | "TB";

interface TrendPoint {
  x: string;
  label: string;
  actual: number | null;
  projected: number | null;
}

interface CapacityTrendModel {
  metricName: string;
  points: TrendPoint[];
  currentPoint: TrendPoint;
  currentValue: number;
  projectedValue: number;
  projectedCrossStep: number | null;
  avgStepDays: number;
  daysToCeiling: number | null;
  trajectoryNote: string;
  lowThreshold: number;
  highThreshold: number;
  ceilingValue: number;
  yMin: number;
  yMax: number;
  isPercentScale: boolean;
}

function toDisplayDate(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return input;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function pickBestSeries(rows: ForecastRow[]): { metricName: string; values: Array<{ t: number; v: number; rawTs: string }> } | null {
  const grouped = new Map<string, Array<{ t: number; v: number; rawTs: string }>>();

  for (const row of rows) {
    const v = Number(row.Value);
    const t = Date.parse(row.Timestamp);
    if (!Number.isFinite(v) || !Number.isFinite(t)) continue;
    const key = String(row.MetricName || "(unknown)");
    const bucket = grouped.get(key) ?? [];
    bucket.push({ t, v, rawTs: row.Timestamp });
    grouped.set(key, bucket);
  }

  if (!grouped.size) return null;

  let winner: { metricName: string; values: Array<{ t: number; v: number; rawTs: string }>; score: number } | null = null;
  for (const [metricName, rawValues] of grouped) {
    const values = [...rawValues].sort((a, b) => a.t - b.t);
    if (values.length < 3) continue;

    const max = Math.max(...values.map((p) => p.v));
    const min = Math.min(...values.map((p) => p.v));
    const isPercentScale = min >= 0 && max <= 100;
    const keywordBoost = /(used|pct|percent|capacity|disk|util)/i.test(metricName) ? 15 : 0;
    const score = values.length * 10 + (isPercentScale ? 20 : 0) + keywordBoost;

    if (!winner || score > winner.score) {
      winner = { metricName, values, score };
    }
  }

  if (!winner) return null;
  return { metricName: winner.metricName, values: winner.values };
}

function buildTrendModel(rows: ForecastRow[]): CapacityTrendModel | null {
  const selected = pickBestSeries(rows);
  if (!selected) return null;

  const actual = selected.values.slice(-12);
  const first = actual[0];
  const last = actual[actual.length - 1];
  const slope = actual.length > 1 ? (last.v - first.v) / (actual.length - 1) : 0;
  const avgStepMs =
    actual.length > 1
      ? (actual[actual.length - 1].t - actual[0].t) / (actual.length - 1)
      : 24 * 60 * 60 * 1000;
  const avgStepDays = Math.max(1, Math.round(avgStepMs / (24 * 60 * 60 * 1000)));

  const projectedSteps = 6;
  const points: TrendPoint[] = actual.map((p, i) => ({
    x: `actual-${i}`,
    label: toDisplayDate(p.rawTs),
    actual: p.v,
    projected: null
  }));

  for (let step = 1; step <= projectedSteps; step += 1) {
    const projected = Math.max(0, last.v + slope * step);
    points.push({
      x: `future-${step}`,
      label: `+${step}`,
      actual: null,
      projected
    });
  }

  // Keep the projection line connected from "now" into future.
  points[points.length - projectedSteps - 1].projected = last.v;

  const allValues = points.flatMap((p) => [p.actual ?? NaN, p.projected ?? NaN]).filter(Number.isFinite) as number[];
  const max = Math.max(...allValues);
  const min = Math.min(...allValues);
  const range = Math.max(max - min, 1);
  const isPercentScale = min >= 0 && max <= 100;
  const lowThreshold = isPercentScale ? 60 : min + range * 0.35;
  const highThreshold = isPercentScale ? 85 : min + range * 0.75;
  const ceilingValue = isPercentScale ? 100 : highThreshold;
  const projectedCross = points.find((p) => p.x.startsWith("future-") && (p.projected ?? -Infinity) >= ceilingValue);
  const projectedCrossStep = projectedCross ? Number(projectedCross.x.replace("future-", "")) : null;
  const stepsToCeiling =
    slope > 0 && last.v < ceilingValue
      ? (ceilingValue - last.v) / slope
      : null;
  const daysToCeiling = stepsToCeiling !== null && Number.isFinite(stepsToCeiling)
    ? Math.max(1, Math.round(stepsToCeiling * avgStepDays))
    : null;
  const trajectoryNote =
    slope <= 0
      ? "Stable utilization"
      : daysToCeiling === null
      ? "Linear growth continuing"
      : isPercentScale
      ? `~${daysToCeiling} days to capacity`
      : `~${daysToCeiling} days to high-pressure ceiling`;

  const yMin = isPercentScale ? 0 : Math.max(0, min - range * 0.1);
  const yMax = isPercentScale ? 100 : max + range * 0.15;

  return {
    metricName: selected.metricName,
    points,
    currentPoint: points[actual.length - 1],
    currentValue: last.v,
    projectedValue: points[points.length - 1].projected ?? last.v,
    projectedCrossStep,
    avgStepDays,
    daysToCeiling,
    trajectoryNote,
    lowThreshold,
    highThreshold,
    ceilingValue,
    yMin,
    yMax,
    isPercentScale
  };
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[idx];
}

function convertSize(mb: number, unit: CapacityUnit): number {
  if (unit === "TB") return mb / (1024 * 1024);
  return mb / 1024;
}

function formatSize(value: number, unit: CapacityUnit): string {
  const decimals = unit === "TB" ? 2 : 1;
  return `${value.toFixed(decimals)} ${unit}`;
}

function saturationColor(percent: number): string {
  if (percent >= 95) return "#8f2d2d";
  if (percent >= 85) return "#ad6f2f";
  if (percent >= 70) return "#68788f";
  return "#8a97a8";
}

/** Bars for systems under pressure are fully opaque; healthy systems recede via opacity. */
function saturationOpacity(percent: number): number {
  if (percent >= 95) return 1;
  if (percent >= 85) return 0.92;
  if (percent >= 70) return 0.75;
  return 0.42;
}

/** Track background: darker for critical rows to increase figure/ground contrast. */
function trackColor(percent: number): string {
  if (percent >= 95) return "#e8d0d0";
  if (percent >= 85) return "#ecddd0";
  return "#e6e9ee";
}

/** Y-axis label color: constrained systems are fully foreground; stable systems are muted. */
function labelColor(percent: number): string {
  if (percent >= 85) return "#1a1a1a";
  if (percent >= 70) return "#4a5568";
  return "#94a3b8";
}

function utilizationStatus(percent: number): string {
  if (percent >= 95) return "Near full";
  if (percent >= 85) return "High pressure";
  if (percent >= 70) return "Watch";
  return "Stable";
}

export function CapacityPage() {
  const [databaseView, setDatabaseView] = useState<"all" | "single">("all");
  const [selectedDatabaseId, setSelectedDatabaseId] = useState("");
  const [serverFilter, setServerFilter] = useState("all");
  const [unit, setUnit] = useState<CapacityUnit>("GB");

  const disks = useApiQuery<DiskRow[]>(["capacity-disks"], "/capacity/disks");
  const databases = useApiQuery<DatabaseRow[]>(["capacity-databases"], "/capacity/databases");
  const forecast = useApiQuery<ForecastRow[]>(["capacity-forecast"], "/capacity/forecast");
  const trend = buildTrendModel(forecast.data ?? []);

  const databaseRows = useMemo(() => {
    return [...(databases.data ?? [])]
      .map((db) => {
        const dataMb = Number(db.DataSizeMb) || 0;
        const logMb = Number(db.LogSizeMb) || 0;
        const totalMb = dataMb + logMb;
        return {
          ...db,
          dataMb,
          logMb,
          totalMb
        };
      })
      .sort((a, b) => b.totalMb - a.totalMb);
  }, [databases.data]);

  const serverOptions = useMemo(() => {
    const names = Array.from(new Set(databaseRows.map((db) => db.ServerName).filter(Boolean) as string[]));
    return names.sort((a, b) => a.localeCompare(b));
  }, [databaseRows]);

  const filteredDatabaseRows = useMemo(() => {
    if (serverFilter === "all") return databaseRows;
    return databaseRows.filter((db) => (db.ServerName ?? "") === serverFilter);
  }, [databaseRows, serverFilter]);

  const selectedDatabase =
    filteredDatabaseRows.find((db) => db.DatabaseId === selectedDatabaseId) ?? filteredDatabaseRows[0] ?? null;

  const allDatabaseChartData = filteredDatabaseRows.slice(0, 15).map((db) => ({
    id: db.DatabaseId,
    name: db.Name,
    dataSize: convertSize(db.dataMb, unit),
    logSize: convertSize(db.logMb, unit),
    totalSize: convertSize(db.totalMb, unit)
  }));

  const totals = allDatabaseChartData.map((db) => db.totalSize);
  const maxTotal = Math.max(...totals, 1);
  // Sort high→low so the most-constrained databases appear at top of the chart
  const databaseSaturationData = allDatabaseChartData
    .map((db) => ({
      ...db,
      usedPercent: (db.totalSize / maxTotal) * 100,
      status: utilizationStatus((db.totalSize / maxTotal) * 100)
    }))
    .sort((a, b) => b.usedPercent - a.usedPercent);
  // Sort disk volumes high→low for the same reason
  const diskChartData = (disks.data ?? [])
    .slice(0, 10)
    .map((row) => ({
      name: row.VolumeName,
      usedPercent: Number(row.UsedPercent) || 0,
      status: utilizationStatus(Number(row.UsedPercent) || 0)
    }))
    .sort((a, b) => b.usedPercent - a.usedPercent);

  const detailBreakdown = selectedDatabase
    ? [
        { name: "Data", value: convertSize(selectedDatabase.dataMb, unit), color: "#54657a" },
        { name: "Log", value: convertSize(selectedDatabase.logMb, unit), color: "#8d98a6" }
      ]
    : [];
  const disksAbove85 = diskChartData.filter((d) => d.usedPercent >= 85).length;
  const disksAbove95 = diskChartData.filter((d) => d.usedPercent >= 95).length;
  const projectedWithin60 = trend?.daysToCeiling !== null && trend?.daysToCeiling !== undefined && trend.daysToCeiling <= 60;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Database Capacity Explorer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[220px,220px,160px,1fr]">
            <Select value={databaseView} onChange={(e) => setDatabaseView(e.target.value as "all" | "single")}>
              <option value="all">All databases at once</option>
              <option value="single">Single database details</option>
            </Select>

            <Select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
              <option value="all">All servers</option>
              {serverOptions.map((server) => (
                <option key={server} value={server}>
                  {server}
                </option>
              ))}
            </Select>

            <Select value={unit} onChange={(e) => setUnit(e.target.value as CapacityUnit)}>
              <option value="GB">Units: GB</option>
              <option value="TB">Units: TB</option>
            </Select>

            {databaseView === "single" ? (
              <Select value={selectedDatabase?.DatabaseId ?? ""} onChange={(e) => setSelectedDatabaseId(e.target.value)}>
                {filteredDatabaseRows.map((db) => (
                  <option key={db.DatabaseId} value={db.DatabaseId}>
                    {db.Name}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="flex items-center rounded-lg border border-border px-3 text-xs text-muted">
                Click any bar to pin and open Single database details.
              </div>
            )}
          </div>

          {databaseView === "all" ? (
            <>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={databaseSaturationData}
                    layout="vertical"
                    margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
                    onClick={(state: any) => {
                      const payload = state?.activePayload?.[0]?.payload as { id?: string } | undefined;
                      if (!payload?.id) return;
                      setSelectedDatabaseId(payload.id);
                      setDatabaseView("single");
                    }}
                  >
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" horizontal={true} vertical={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(value) => `${Number(value)}%`} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={(props: any) => {
                        const entry = databaseSaturationData[props.index];
                        return (
                          <text
                            x={props.x}
                            y={props.y}
                            textAnchor="end"
                            dominantBaseline="middle"
                            fontSize={11}
                            fontWeight={entry && entry.usedPercent >= 85 ? 700 : 400}
                            fill={labelColor(entry?.usedPercent ?? 0)}
                          >
                            {props.payload.value}
                          </text>
                        );
                      }}
                    />
                    <Tooltip
                      formatter={(value, name, item: any) => {
                        if (name === "usedPercent") return [`${Number(value ?? 0).toFixed(1)}%`, "Relative saturation"];
                        return [formatSize(Number(item?.payload?.totalSize ?? 0), unit), "Current total size"];
                      }}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--color-foreground)"
                      }}
                    />
                    <ReferenceLine
                      x={70}
                      stroke="#7a8898"
                      strokeDasharray="4 3"
                      label={{ value: "70%", fill: "#7a8898", fontSize: 10, position: "insideTopLeft" }}
                    />
                    <ReferenceLine
                      x={85}
                      stroke="#ad6f2f"
                      strokeDasharray="4 3"
                      label={{ value: "85%", fill: "#ad6f2f", fontSize: 10, position: "insideTop" }}
                    />
                    <ReferenceLine
                      x={95}
                      stroke="#8f2d2d"
                      strokeDasharray="4 3"
                      label={{ value: "95%", fill: "#8f2d2d", fontSize: 10, position: "insideTopRight" }}
                    />
                    <Bar
                      dataKey="usedPercent"
                      radius={[0, 6, 6, 0]}
                      cursor="pointer"
                      background={(props: any) => (
                        <rect
                          x={props.x} y={props.y}
                          width={props.width} height={props.height}
                          fill={trackColor(props.value as number ?? props?.usedPercent ?? 0)}
                          rx={6}
                        />
                      )}
                    >
                      {databaseSaturationData.map((entry) => (
                        <Cell
                          key={entry.id}
                          fill={saturationColor(entry.usedPercent)}
                          fillOpacity={saturationOpacity(entry.usedPercent)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted">
                Saturation bars show each database as a percentage of the largest footprint in the filtered scope. Color intensity increases as saturation pressure rises through 70%, 85%, and 95%.
              </p>
            </>
          ) : selectedDatabase ? (
            <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
              <div className="h-72 w-full rounded-lg border border-border bg-surface-2/40 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={detailBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} innerRadius={56}>
                      {detailBreakdown.map((slice) => (
                        <Cell key={slice.name} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatSize(Number(value ?? 0), unit)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-4 text-sm">
                <div>
                  <p className="text-xs text-muted">Database</p>
                  <p className="font-semibold text-foreground">{selectedDatabase.Name}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-card p-3">
                    <p className="text-xs text-muted">Data size</p>
                    <p className="text-base font-semibold text-foreground">{formatSize(convertSize(selectedDatabase.dataMb, unit), unit)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-card p-3">
                    <p className="text-xs text-muted">Log size</p>
                    <p className="text-base font-semibold text-foreground">{formatSize(convertSize(selectedDatabase.logMb, unit), unit)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-card p-3">
                    <p className="text-xs text-muted">Total size</p>
                    <p className="text-base font-semibold text-foreground">{formatSize(convertSize(selectedDatabase.totalMb, unit), unit)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-card p-3">
                    <p className="text-xs text-muted">Server</p>
                    <p className="text-base font-semibold text-foreground">{selectedDatabase.ServerName ?? "-"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-muted">
                  <p>Recovery model: {selectedDatabase.RecoveryModel ?? "-"}</p>
                  <p>Compatibility level: {selectedDatabase.CompatibilityLevel ?? "-"}</p>
                  <p className="col-span-2">Last backup: {selectedDatabase.LastBackupDate ? toDisplayDate(String(selectedDatabase.LastBackupDate)) : "-"}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border p-3 text-sm text-muted">
              No database size data is available yet.
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Disk Volumes Quick Scan</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={diskChartData} layout="vertical" margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" horizontal={true} vertical={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(value) => `${Number(value)}%`} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={(props: any) => {
                      const entry = diskChartData[props.index];
                      return (
                        <text
                          x={props.x}
                          y={props.y}
                          textAnchor="end"
                          dominantBaseline="middle"
                          fontSize={11}
                          fontWeight={entry && entry.usedPercent >= 85 ? 700 : 400}
                          fill={labelColor(entry?.usedPercent ?? 0)}
                        >
                          {props.payload.value}
                        </text>
                      );
                    }}
                  />
                  <Tooltip
                    formatter={(value) => [`${Number(value ?? 0).toFixed(1)}%`, "Used capacity"]}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--color-foreground)"
                    }}
                  />
                  <ReferenceLine x={70} stroke="#7a8898" strokeDasharray="4 3" />
                  <ReferenceLine x={85} stroke="#ad6f2f" strokeDasharray="4 3" />
                  <ReferenceLine x={95} stroke="#8f2d2d" strokeDasharray="4 3" />
                  <Bar
                    dataKey="usedPercent"
                    radius={[0, 6, 6, 0]}
                    background={(props: any) => (
                      <rect
                        x={props.x} y={props.y}
                        width={props.width} height={props.height}
                        fill={trackColor(props.value as number ?? 0)}
                        rx={6}
                      />
                    )}
                  >
                    {diskChartData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={saturationColor(entry.usedPercent)}
                        fillOpacity={saturationOpacity(entry.usedPercent)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Capacity Position & Linear Forecast</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {trend ? (
              <>
                <div
                  className="rounded-lg border p-3"
                  style={{
                    background:
                      trend.currentValue >= trend.highThreshold
                        ? "rgba(173,111,47,0.08)"
                        : "var(--color-surface-2)",
                    borderColor:
                      trend.currentValue >= trend.highThreshold
                        ? "#ad6f2f"
                        : "var(--color-border)"
                  }}
                >
                  <p className="text-xs text-muted">Tracking metric</p>
                  <p className="text-sm font-medium text-foreground">{trend.metricName}</p>
                  <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted">
                    <span>
                      Now: <strong className="text-foreground">{trend.currentValue.toFixed(1)}{trend.isPercentScale ? "%" : ""}</strong>
                    </span>
                    <span>
                      Projected (+6): <strong className="text-foreground">{trend.projectedValue.toFixed(1)}{trend.isPercentScale ? "%" : ""}</strong>
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">{trend.trajectoryNote}</p>
                  {trend.isPercentScale ? (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-muted">Risk</span>
                      <RiskGauge value={trend.currentValue} warn={trend.lowThreshold} critical={trend.highThreshold} className="w-40" />
                    </div>
                  ) : null}
                </div>

                {/* Future risk metrics: days to exhaustion + distance to ceiling */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div
                    className="rounded-lg border p-3"
                    style={{
                      background:
                        trend.daysToCeiling !== null && trend.daysToCeiling <= 30
                          ? "rgba(143,45,45,0.08)"
                          : trend.daysToCeiling !== null && trend.daysToCeiling <= 60
                          ? "rgba(173,111,47,0.08)"
                          : "var(--color-surface-2)",
                      borderColor:
                        trend.daysToCeiling !== null && trend.daysToCeiling <= 30
                          ? "#8f2d2d"
                          : trend.daysToCeiling !== null && trend.daysToCeiling <= 60
                          ? "#ad6f2f"
                          : "var(--color-border)"
                    }}
                  >
                    <p className="text-xs text-muted">Days to exhaustion</p>
                    <p
                      className="mt-1 text-xl font-semibold"
                      style={{
                        color:
                          trend.daysToCeiling === null
                            ? "var(--color-muted)"
                            : trend.daysToCeiling <= 30
                            ? "#8f2d2d"
                            : trend.daysToCeiling <= 60
                            ? "#ad6f2f"
                            : "var(--color-foreground)"
                      }}
                    >
                      {trend.daysToCeiling === null ? "Stable" : `~${trend.daysToCeiling}d`}
                    </p>
                    {trend.daysToCeiling !== null && trend.daysToCeiling <= 60 && (
                      <p className="mt-1 text-xs font-semibold" style={{ color: trend.daysToCeiling <= 30 ? "#8f2d2d" : "#ad6f2f" }}>
                        {trend.daysToCeiling <= 30 ? "⚠ CRITICAL" : "⚠ HIGH"}
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                    <p className="text-xs text-muted">Distance to ceiling</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">
                      {trend.isPercentScale
                        ? `${Math.max(0, (trend.ceilingValue - trend.currentValue)).toFixed(1)}%`
                        : `${Math.max(0, (trend.ceilingValue - trend.currentValue)).toFixed(0)} units`}
                    </p>
                    <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        style={{
                          width: `${Math.min(100, (trend.currentValue / trend.ceilingValue) * 100)}%`,
                          background:
                            trend.currentValue >= trend.highThreshold
                              ? "#ad6f2f"
                              : trend.currentValue >= trend.lowThreshold
                              ? "#68788f"
                              : "#8a97a8",
                          transition: "width 0.3s ease"
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {Math.max(0, (trend.ceilingValue - trend.currentValue)).toFixed(1)}{trend.isPercentScale ? "%" : ""} runway
                    </p>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trend.points} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="x" tickFormatter={(_value, index) => trend.points[index]?.label ?? ""} tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis domain={[trend.yMin, trend.yMax]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        labelFormatter={(value) => {
                          const item = trend.points.find((p) => p.x === value);
                          return item ? item.label : String(value);
                        }}
                        formatter={(value, name) => {
                          const numeric = Number(value ?? 0);
                          const suffix = trend.isPercentScale ? "%" : "";
                          if (name === "actual") return [`${numeric.toFixed(1)}${suffix}`, "Current trend"];
                          if (name === "projected") return [`${numeric.toFixed(1)}${suffix}`, "Linear projection"];
                          return [String(value ?? ""), String(name)];
                        }}
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "var(--color-foreground)"
                        }}
                      />

                      <ReferenceArea
                        x1={trend.currentPoint.x}
                        x2={
                          trend.projectedCrossStep ? `future-${trend.projectedCrossStep}` : trend.points[trend.points.length - 1]?.x
                        }
                        fill="#ad6f2f"
                        fillOpacity={0.25}
                      />
                      <ReferenceLine
                        y={trend.ceilingValue}
                        stroke="#8f2d2d"
                        strokeDasharray="4 3"
                        label={{
                          value: trend.isPercentScale ? "Capacity ceiling" : "High-pressure ceiling",
                          fill: "#8f2d2d",
                          fontSize: 10,
                          position: "insideTopRight"
                        }}
                      />
                      {/* Milestone markers at 80% and 90% for percent-based metrics */}
                      {trend.isPercentScale && (
                        <>
                          <ReferenceLine
                            y={80}
                            stroke="#94a3b8"
                            strokeDasharray="3 2"
                            label={{ value: "80%", fill: "#94a3b8", fontSize: 9, position: "insideTopLeft" }}
                          />
                          <ReferenceLine
                            y={90}
                            stroke="#c9915a"
                            strokeDasharray="3 2"
                            label={{ value: "90%", fill: "#c9915a", fontSize: 9, position: "insideTopLeft" }}
                          />
                        </>
                      )}
                      {trend.projectedCrossStep ? (
                        <>
                          <ReferenceLine
                            x={`future-${trend.projectedCrossStep}`}
                            stroke="#ad6f2f"
                            strokeDasharray="4 3"
                            label={{
                              value: trend.daysToCeiling ? `~${trend.daysToCeiling}d to full` : "Projected saturation",
                              fill: "#ad6f2f",
                              fontSize: 10,
                              position: "insideTop"
                            }}
                          />
                          <ReferenceDot
                            x={`future-${trend.projectedCrossStep}`}
                            y={trend.ceilingValue}
                            r={6}
                            fill="#ad6f2f"
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        </>
                      ) : null}

                      <Line
                        type="monotone"
                        dataKey="actual"
                        name="actual"
                        stroke="#4f5f72"
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                      />
                      <Line
                        type="linear"
                        dataKey="projected"
                        name="projected"
                        stroke="#7f8ea0"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        connectNulls
                      />
                      <ReferenceDot
                        x={trend.currentPoint.x}
                        y={trend.currentValue}
                        r={5}
                        fill="#4f5f72"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        label={{ value: "Now", position: "top", fill: "var(--color-foreground)", fontSize: 11 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <p className="text-xs text-muted">
                  The solid line shows actual utilization. The dashed line shows linear projection. The shaded band marks the runway between now and projected saturation.
                </p>
              </>
            ) : (
              <div className="rounded-lg border border-border p-3 text-sm text-muted">
                Not enough time-series points yet to render a forecast view.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capacity Risk Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          {/* Tint non-zero alert tiles amber/red so they visually advance over zero/stable tiles */}
          <div
            className="rounded-lg border p-3"
            style={{
              background: disksAbove85 > 0 ? "rgba(173,111,47,0.08)" : "var(--color-surface-2)",
              borderColor: disksAbove85 > 0 ? "#ad6f2f" : "var(--color-border)"
            }}
          >
            <p className="text-xs text-muted">Volumes at/above 85%</p>
            <p
              className="mt-1 text-xl font-semibold"
              style={{ color: disksAbove85 > 0 ? "#ad6f2f" : "var(--color-foreground)" }}
            >
              {disksAbove85}
            </p>
          </div>
          <div
            className="rounded-lg border p-3"
            style={{
              background: disksAbove95 > 0 ? "rgba(143,45,45,0.08)" : "var(--color-surface-2)",
              borderColor: disksAbove95 > 0 ? "#8f2d2d" : "var(--color-border)"
            }}
          >
            <p className="text-xs text-muted">Volumes at/above 95%</p>
            <p
              className="mt-1 text-xl font-semibold"
              style={{ color: disksAbove95 > 0 ? "#8f2d2d" : "var(--color-foreground)" }}
            >
              {disksAbove95}
            </p>
          </div>
          <div
            className="rounded-lg border p-3"
            style={{
              background: projectedWithin60 ? "rgba(143,45,45,0.08)" : "var(--color-surface-2)",
              borderColor: projectedWithin60 ? "#8f2d2d" : "var(--color-border)"
            }}
          >
            <p className="text-xs text-muted">Projection signal</p>
            <p
              className="mt-1 font-semibold"
              style={{ color: projectedWithin60 ? "#8f2d2d" : "var(--color-foreground)" }}
            >
              {projectedWithin60 ? "Exhaustion projected within 60 days" : trend ? trend.trajectoryNote : "Awaiting trend data"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
