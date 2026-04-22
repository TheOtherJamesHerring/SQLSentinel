import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarComparisonChart } from "@/components/charts/bar-comparison-chart";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { Select } from "@/components/ui/select";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
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
  lowThreshold: number;
  highThreshold: number;
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

  const yMin = isPercentScale ? 0 : Math.max(0, min - range * 0.1);
  const yMax = isPercentScale ? 100 : max + range * 0.15;

  return {
    metricName: selected.metricName,
    points,
    currentPoint: points[actual.length - 1],
    currentValue: last.v,
    projectedValue: points[points.length - 1].projected ?? last.v,
    lowThreshold,
    highThreshold,
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
  const lowMarker = percentile(totals, 0.35);
  const highMarker = percentile(totals, 0.8);
  const maxTotal = Math.max(...totals, 1);

  const detailBreakdown = selectedDatabase
    ? [
        { name: "Data", value: convertSize(selectedDatabase.dataMb, unit), color: "#0ea5e9" },
        { name: "Log", value: convertSize(selectedDatabase.logMb, unit), color: "#8b5cf6" }
      ]
    : [];

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
                    data={allDatabaseChartData}
                    layout="vertical"
                    margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
                    onClick={(state: any) => {
                      const payload = state?.activePayload?.[0]?.payload as { id?: string } | undefined;
                      if (!payload?.id) return;
                      setSelectedDatabaseId(payload.id);
                      setDatabaseView("single");
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={true} vertical={false} />
                    <XAxis type="number" domain={[0, maxTotal * 1.15]} tick={{ fontSize: 11 }} tickFormatter={(value) => formatSize(Number(value), unit)} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value, name) => {
                        const label = name === "dataSize" ? "Data" : name === "logSize" ? "Log" : String(name);
                        return [formatSize(Number(value ?? 0), unit), label];
                      }}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--color-foreground)"
                      }}
                    />
                    <Legend formatter={(value) => (value === "dataSize" ? "Data file size" : "Log file size")} />

                    <ReferenceArea x1={0} x2={lowMarker} fill="#22c55e" fillOpacity={0.12} />
                    <ReferenceArea x1={highMarker} x2={maxTotal * 1.15} fill="#ef4444" fillOpacity={0.12} />
                    <ReferenceLine
                      x={lowMarker}
                      stroke="#22c55e"
                      strokeDasharray="4 3"
                      label={{ value: "Low", fill: "#22c55e", fontSize: 10, position: "insideTopLeft" }}
                    />
                    <ReferenceLine
                      x={highMarker}
                      stroke="#ef4444"
                      strokeDasharray="4 3"
                      label={{ value: "High", fill: "#ef4444", fontSize: 10, position: "insideTopRight" }}
                    />

                    <Bar dataKey="dataSize" stackId="size" fill="#0ea5e9" radius={[0, 0, 0, 0]} cursor="pointer" />
                    <Bar dataKey="logSize" stackId="size" fill="#8b5cf6" radius={[0, 6, 6, 0]} cursor="pointer" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted">
                Green area marks smaller database footprints. Red area highlights the largest databases to prioritize for growth planning. Unit and server filters apply live.
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
                    <Legend />
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
            <BarComparisonChart
              warnThreshold={80}
              criticalThreshold={90}
              showThresholdLine
              data={(disks.data ?? []).slice(0, 10).map((row) => ({ name: row.VolumeName, value: Number(row.UsedPercent) || 0 }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Capacity Position & Linear Forecast</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {trend ? (
              <>
                <div className="rounded-lg border border-border bg-surface-2/40 p-3">
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
                  {trend.isPercentScale ? (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-muted">Risk</span>
                      <RiskGauge value={trend.currentValue} warn={trend.lowThreshold} critical={trend.highThreshold} className="w-40" />
                    </div>
                  ) : null}
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trend.points} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
                      <Legend formatter={(value) => (value === "actual" ? "Current trend" : "Linear projection")} />

                      <ReferenceArea y1={trend.yMin} y2={trend.lowThreshold} fill="#22c55e" fillOpacity={0.12} />
                      <ReferenceArea y1={trend.highThreshold} y2={trend.yMax} fill="#ef4444" fillOpacity={0.12} />
                      <ReferenceLine
                        y={trend.lowThreshold}
                        stroke="#22c55e"
                        strokeDasharray="4 3"
                        label={{ value: "Low zone", fill: "#22c55e", fontSize: 10, position: "insideTopLeft" }}
                      />
                      <ReferenceLine
                        y={trend.highThreshold}
                        stroke="#ef4444"
                        strokeDasharray="4 3"
                        label={{ value: "High zone", fill: "#ef4444", fontSize: 10, position: "insideTopRight" }}
                      />

                      <Line
                        type="monotone"
                        dataKey="actual"
                        name="actual"
                        stroke="#0ea5e9"
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                      />
                      <Line
                        type="linear"
                        dataKey="projected"
                        name="projected"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        connectNulls
                      />
                      <ReferenceDot
                        x={trend.currentPoint.x}
                        y={trend.currentValue}
                        r={5}
                        fill="#0ea5e9"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        label={{ value: "Now", position: "top", fill: "var(--color-foreground)", fontSize: 11 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <p className="text-xs text-muted">
                  Green area indicates lower pressure. Red area indicates high pressure where you are likely to hit capacity sooner.
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
    </div>
  );
}
