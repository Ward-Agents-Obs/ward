"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_TIME_RANGE_OPTIONS,
  TimeRangePicker,
} from "@/components/ui/time-range-picker";

/**
 * Filter chip row for `/traces`. URL-state across the board so deep links
 * round-trip the user's exact view. Only filters that the backend queries
 * actually accept are surfaced — the previous version had stub Live/Export
 * buttons that did nothing; those are removed.
 *
 * Filters supported:
 *   - timeRange  (1h / 24h / 7d / 30d, default 24h)
 *   - environment (populated from getDistinctEnvironments)
 *   - model      (populated from getDistinctModels)
 *   - status     (all / ok / error) — drives StatusCode in the spans query
 *   - search     (substring against gen_ai.prompt + gen_ai.completion)
 *
 * Status filter is hidden in the Sessions view because `getSessions` doesn't
 * filter on StatusCode. The toggle component (`<TracesViewToggle>`) lives in
 * the page layout so the parent can pass us `view` and we can hide what
 * doesn't apply.
 */

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ok", label: "Ok" },
  { value: "error", label: "Error" },
] as const;

interface TraceFiltersProps {
  availableEnvironments?: string[];
  availableModels?: string[];
  /** "list" surfaces the status filter; "sessions" hides it. */
  view?: "list" | "sessions";
  className?: string;
}

export function TraceFilters({
  availableEnvironments = [],
  availableModels = [],
  view = "list",
  className,
}: TraceFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = useMemo(
    () => ({
      timeRange: searchParams.get("timeRange") || "24h",
      environment: searchParams.get("environment") || "",
      model: searchParams.get("model") || "",
      status: searchParams.get("status") || "",
      search: searchParams.get("search") || "",
    }),
    [searchParams]
  );

  /**
   * Update one or more filter params at once. Empty values delete the key.
   * Filter changes always reset `?page=` so users don't land on an empty
   * page index for a smaller filtered set.
   */
  const update = (patch: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  /**
   * The search input is uncontrolled — typing doesn't round-trip on every
   * keystroke, only on form submit (Enter or button click). The form is
   * keyed by the URL value so an external clear/reset remounts the input
   * with the new default, avoiding setState-in-effect plumbing.
   */
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const searchValue = String(fd.get("search") ?? "").trim();
    update({ search: searchValue });
  };

  const clearAll = () => {
    // Preserve `view` so clearing filters doesn't kick the user out of the
    // sessions tab. Drop everything else.
    const params = new URLSearchParams();
    const view = searchParams.get("view");
    if (view) params.set("view", view);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  const hasActive =
    current.environment ||
    current.model ||
    current.search ||
    current.status ||
    current.timeRange !== "24h";

  return (
    <div className={cn("space-y-4", className)}>
      {/*
        `current.timeRange` is read raw from `searchParams` for filter UI; the
        page (`traces/page.tsx`) does the canonical validation via `parseRange`
        before any query runs. Passing the unvalidated string here means the
        picker simply highlights no chip if the URL value is junk — same UX
        as our other filters and matches the hand-rolled chips this replaces.
      */}
      <TimeRangePicker
        value={current.timeRange}
        options={DEFAULT_TIME_RANGE_OPTIONS}
        paramName="timeRange"
      />

      {/* Search + dropdowns */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={submitSearch}
          // The key forces a remount when the URL search value changes from
          // outside this component (e.g. Clear button), so the uncontrolled
          // input picks up the new defaultValue without setState-in-effect.
          key={current.search}
          className="flex-1 min-w-[14rem]"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="search"
              placeholder="Search prompts and completions…"
              defaultValue={current.search}
              className="pl-9"
              aria-label="Search prompts and completions"
            />
          </div>
        </form>

        {availableEnvironments.length > 0 ? (
          <Select
            value={current.environment}
            onChange={(event) => update({ environment: event.target.value })}
            aria-label="Filter by environment"
          >
            <option value="">All environments</option>
            {availableEnvironments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </Select>
        ) : null}

        {availableModels.length > 0 ? (
          <Select
            value={current.model}
            onChange={(event) => update({ model: event.target.value })}
            aria-label="Filter by model"
          >
            <option value="">All models</option>
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
        ) : null}

        {view === "list" ? (
          <Select
            value={current.status}
            onChange={(event) => update({ status: event.target.value })}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        ) : null}

        {hasActive ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
