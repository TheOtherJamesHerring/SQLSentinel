import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ChartPoint {
  name: string;
  value: number;
}

interface TimeSeriesChartProps {
  data: ChartPoint[];
  color: string;
  /** Draw a dashed amber line at this Y value */
  warnThreshold?: number;
  /** Draw a dashed red line at this Y value */
  criticalThreshold?: number;
  /** Height override in pixels. Default: 256 */
  height?: number;
}

/**
 * Area chart with optional threshold reference lines.
 * Answers: "Is the trend heading toward a threshold breach?"
 */
export function TimeSeriesChart({ data, color, warnThreshold, criticalThreshold, height = 256 }: TimeSeriesChartProps) {
  const gradId = `grad-${color.replace("#", "")}`;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.5} />
              <stop offset="95%" stopColor={color} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="name" stroke="var(--color-border)" tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke="var(--color-border)" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--color-foreground)",
            }}
          />
          {warnThreshold !== undefined && (
            <ReferenceLine y={warnThreshold} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `⚠ ${warnThreshold}`, fill: "#f59e0b", fontSize: 10, position: "insideTopRight" }} />
          )}
          {criticalThreshold !== undefined && (
            <ReferenceLine y={criticalThreshold} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `✕ ${criticalThreshold}`, fill: "#ef4444", fontSize: 10, position: "insideTopRight" }} />
          )}
          <Area type="monotone" dataKey="value" stroke={color} fill={`url(#${gradId})`} strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
