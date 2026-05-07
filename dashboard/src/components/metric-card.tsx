import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  /** Optional caption rendered below the value (e.g. "last 24h" or "across 3 models"). */
  caption?: string;
  /**
   * Optional percentage delta vs. previous window. Positive numbers render
   * with an up arrow, negative with a down arrow. `goodDirection` controls
   * the colour: when set, an "up" delta is green if `goodDirection==='up'`
   * (e.g. throughput) and red if `goodDirection==='down'` (e.g. error rate).
   */
  delta?: number;
  deltaLabel?: string;
  goodDirection?: "up" | "down";
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  caption,
  delta,
  deltaLabel,
  goodDirection = "up",
}: MetricCardProps) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const isUp = hasDelta && (delta as number) > 0;
  const isDown = hasDelta && (delta as number) < 0;
  // "Good" change colours green; "bad" colours rose. We pick based on
  // goodDirection so a 5% drop in error rate reads green and a 5% drop in
  // throughput reads red without the caller having to invert anything.
  const isGood =
    (goodDirection === "up" && isUp) || (goodDirection === "down" && isDown);
  const isBad =
    (goodDirection === "up" && isDown) || (goodDirection === "down" && isUp);

  return (
    <div className="tech-panel rounded-md p-5 transition-colors duration-200 hover:bg-panel-hover">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <Icon className="h-4 w-4 text-foreground/70" />
      </div>
      <div className="mt-5 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-foreground">
          {value}
        </span>
      </div>
      {hasDelta || caption ? (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                isGood && "text-success",
                isBad && "text-destructive",
                !isGood && !isBad && "text-muted-foreground"
              )}
            >
              {isUp ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : isDown ? (
                <ArrowDownRight className="h-3 w-3" />
              ) : null}
              {Math.abs(delta as number).toFixed(1)}%
            </span>
          ) : null}
          {caption ? (
            <span className="text-muted-foreground">{deltaLabel ?? caption}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
