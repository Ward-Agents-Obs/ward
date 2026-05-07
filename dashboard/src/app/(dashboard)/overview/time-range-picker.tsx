"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { OverviewTimeRange } from "@/lib/queries/overview";

/**
 * Segmented control for the overview time range. URL-state only — the value
 * lives in `?range=…` so the server component can read it without hydration
 * drift, and bookmarking a state is free.
 *
 * Renders as <Link> elements rather than buttons so the change behaves like
 * a navigation: the server re-runs with the new range and Next streams the
 * new HTML. We use `replace` to avoid polluting history with each click.
 */

const RANGES: ReadonlyArray<{ value: OverviewTimeRange; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function TimeRangePicker({ active }: { active: OverviewTimeRange }) {
  const searchParams = useSearchParams();

  const buildHref = (range: OverviewTimeRange) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex items-center gap-1 rounded-xl border tech-border bg-panel p-1"
    >
      {RANGES.map((r) => {
        const isActive = r.value === active;
        return (
          <Link
            key={r.value}
            href={buildHref(r.value)}
            replace
            scroll={false}
            role="radio"
            aria-checked={isActive}
            className={cn(
              "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:bg-panel-hover hover:text-foreground"
            )}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}
