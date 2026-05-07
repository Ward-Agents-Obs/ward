"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * URL-state segmented toggle between the spans-list view and the
 * sessions-rolled-up view on `/traces`. Server component picks the active
 * mode from `?view=…`; this client component renders the navigation.
 *
 * Implemented as <Link> elements so each switch is a real navigation that
 * re-runs the server component with the new query params. `replace` keeps
 * history clean.
 */
export type TracesView = "list" | "sessions";

const VIEWS: ReadonlyArray<{ value: TracesView; label: string }> = [
  { value: "list", label: "List" },
  { value: "sessions", label: "Sessions" },
];

export function TracesViewToggle({ active }: { active: TracesView }) {
  const searchParams = useSearchParams();

  const buildHref = (view: TracesView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    // Switching views resets pagination — otherwise a deep page index from
    // the other view becomes nonsensical.
    params.delete("page");
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tracing view"
      className="inline-flex items-center gap-1 rounded-xl border tech-border bg-panel p-1"
    >
      {VIEWS.map((v) => {
        const isActive = v.value === active;
        return (
          <Link
            key={v.value}
            href={buildHref(v.value)}
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
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}
