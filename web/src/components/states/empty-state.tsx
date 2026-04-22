import { AlertCircle } from "lucide-react";

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2 p-8 text-center">
      <AlertCircle className="mb-3 h-8 w-8 text-muted" />
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
