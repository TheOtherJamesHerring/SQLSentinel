import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface BarPoint {
  name: string;
  value: number;
}

interface BarComparisonChartProps {
  data: BarPoint[];
  /** Percentage value at which bars turn amber. Default: 75 */
  warnThreshold?: number;
  /** Percentage value at which bars turn red. Default: 90 */
  criticalThreshold?: number;
  /** Show a dashed reference line at the warn threshold. Default: false */
  showThresholdLine?: boolean;
}

function barColor(value: number, warn: number, critical: number) {
  if (value >= critical) return "#ef4444";
  if (value >= warn)     return "#f59e0b";
  return "#22c55e";
}

/**
 * Bar chart that encodes risk via color.
 * Answers: "Which of these is in danger zone vs. healthy?"
 */
export function BarComparisonChart({
  data,
  warnThreshold,
  criticalThreshold,
  showThresholdLine = false
}: BarComparisonChartProps) {
  // If no thresholds provided, fall back to neutral blue (original look)
  const useThresholds = warnThreshold !== undefined || criticalThreshold !== undefined;
  const warn = warnThreshold ?? 75;
  const critical = criticalThreshold ?? 90;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="30%">
          {!useThresholds && (
            <defs>
              <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0080FF" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#0080FF" stopOpacity={0.3} />
              </linearGradient>
            </defs>
          )}
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
            cursor={{ fill: "var(--color-table-hover)" }}
          />
          {showThresholdLine && useThresholds && (
            <ReferenceLine y={warn} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `warn ${warn}%`, fill: "#f59e0b", fontSize: 10, position: "insideTopRight" }} />
          )}
          <Bar dataKey="value" radius={[6, 6, 0, 0]} fill={useThresholds ? undefined : "url(#barGrad)"}>
            {useThresholds && data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={barColor(entry.value, warn, critical)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
