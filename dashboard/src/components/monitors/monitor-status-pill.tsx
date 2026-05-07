import { cn } from "@/lib/utils";
import type { MonitorRenderStatus } from "./monitor-format";

/**
 * Status pill for the monitors list and detail header. Shows one of three
 * states — firing / ok / disabled — using the `--destructive`,
 * `--success`, and `--muted-foreground` design tokens.
 */
const STYLES: Record<MonitorRenderStatus, string> = {
  firing: "bg-destructive/10 text-destructive",
  ok: "bg-success/10 text-success",
  disabled: "bg-muted text-muted-foreground",
};

const LABELS: Record<MonitorRenderStatus, string> = {
  firing: "Firing",
  ok: "Ok",
  disabled: "Disabled",
};

const DOT_STYLES: Record<MonitorRenderStatus, string> = {
  firing: "bg-destructive",
  ok: "bg-success",
  disabled: "bg-muted-foreground/60",
};

export function MonitorStatusPill({
  status,
  className,
}: {
  status: MonitorRenderStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", DOT_STYLES[status])}
      />
      {LABELS[status]}
    </span>
  );
}
