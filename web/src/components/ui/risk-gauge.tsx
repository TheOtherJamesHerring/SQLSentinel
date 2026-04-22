import { cn } from "@/lib/cn";

interface RiskGaugeProps {
  value: number;       // 0–100
  warn?: number;       // default 75
  critical?: number;   // default 90
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
}

function gaugeColor(value: number, warn: number, critical: number) {
  if (value >= critical) return "bg-danger";
  if (value >= warn)     return "bg-warning";
  return "bg-success";
}

function labelColor(value: number, warn: number, critical: number) {
  if (value >= critical) return "text-danger";
  if (value >= warn)     return "text-warning";
  return "text-success";
}

/**
 * Inline risk gauge — a slim labeled progress bar with threshold-aware coloring.
 * Answers: "Is this value safe, borderline, or critical?"
 * Visual-only component; no business logic.
 */
export function RiskGauge({
  value,
  warn = 75,
  critical = 90,
  showLabel = true,
  compact = false,
  className
}: RiskGaugeProps) {
  const pct = Math.min(100, Math.max(0, value));
  const barColor = gaugeColor(pct, warn, critical);
  const textColor = labelColor(pct, warn, critical);

  return (
    <div className={cn("flex items-center gap-2", compact ? "w-20" : "w-28", className)}>
      <div className="relative flex-1 rounded-full" style={{ height: compact ? 4 : 6, backgroundColor: "var(--color-gauge-track)" }}>
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-300", barColor)}
          style={{ width: `${pct}%`, opacity: 0.85 }}
        />
      </div>
      {showLabel && (
        <span className={cn("shrink-0 text-xs font-semibold tabular-nums", textColor)}>
          {pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
