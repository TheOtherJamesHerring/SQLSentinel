import * as React from "react";
import { cn } from "@/lib/cn";

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn("h-10 w-full rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground focus:border-primary focus:outline-none", props.className)}
    />
  );
}
