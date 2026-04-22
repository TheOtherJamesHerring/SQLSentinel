import { cn } from "@/lib/cn";

interface BadgeProps {
  label: string;
  tone?: "success" | "warning" | "danger" | "muted" | "primary";
}

const toneClass: Record<string, string> = {
  success: "badge-success",
  warning: "badge-warning",
  danger:  "badge-danger",
  muted:   "badge-muted",
  primary: "badge-primary",
};

export function Badge({ label, tone = "muted" }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", toneClass[tone])}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
    </span>
  );
}
