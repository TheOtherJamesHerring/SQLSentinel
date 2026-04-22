import * as React from "react";
import { cn } from "@/lib/cn";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none",
        props.className
      )}
    />
  );
}
