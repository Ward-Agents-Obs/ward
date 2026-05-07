"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Generic URL-state segmented control. Used by the overview time-range
 * picker, the traces filter chips, and any future surface that wants a
 * "1h / 24h / 7d / 30d"-shaped selector with bookmarkable state.
 *
 * `paramName` lets each consumer pick its own URL key (the overview uses
 * `?range=`, traces uses `?timeRange=`, monitor detail will use
 * `?range=` with a different option set). Changing the value also drops
 * `?page=` from the URL so paginated tables go back to page 1 instead of
 * stranding on an empty page index for the new filter.
 *
 * Renders as `<Link>` elements rather than buttons so the change is a real
 * navigation — server components re-run with the new value, the URL is
 * shareable, and screen readers announce a list of links rather than a
 * pile of opaque buttons. `replace` keeps history clean.
 *
 * The trailing slash on each href prevents Next from treating an empty
 * query string as `?` (which would render as a malformed URL); we always
 * emit at least the current key.
 */

interface TimeRangeOption<T extends string> {
  value: T;
  label: string;
}

export interface TimeRangePickerProps<T extends string> {
  /** Current value (server-side resolved + validated by the page). */
  value: T;
  options: ReadonlyArray<TimeRangeOption<T>>;
  /** URL search-param key. Defaults to `range`. */
  paramName?: string;
  /** Group label exposed to screen readers. Defaults to "Time range". */
  ariaLabel?: string;
  className?: string;
}

export function TimeRangePicker<T extends string>({
  value,
  options,
  paramName = "range",
  ariaLabel = "Time range",
  className,
}: TimeRangePickerProps<T>) {
  const searchParams = useSearchParams();

  const buildHref = (next: T) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, next);
    // Filter changes always reset `?page=` so users don't land on an empty
    // page index for a smaller filtered set. Keep all other params intact.
    params.delete("page");
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border tech-border bg-panel p-1",
        className
      )}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <Link
            key={opt.value}
            href={buildHref(opt.value)}
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
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Default option set for the V1 surfaces that share the standard
 * 1h / 24h / 7d / 30d range. Exported so callers don't have to duplicate it.
 */
export const DEFAULT_TIME_RANGE_OPTIONS = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const satisfies ReadonlyArray<TimeRangeOption<string>>;
