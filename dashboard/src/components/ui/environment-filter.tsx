"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

/**
 * URL-state environment filter for the overview page (and any future surface
 * that needs the same shape). Sister to `<TimeRangePicker>`: same URL-state
 * model, same `?page=` reset on change, but renders as a `<Select>` because
 * the option set (distinct environments from `otel_traces`) is dynamic and
 * can be longer than a chip group is comfortable with.
 *
 * Behaviour:
 *  - Empty string in the dropdown means "All environments" — written to the
 *    URL as deletion of the param so deep-links don't carry empty values.
 *  - Filter changes always drop `?page=` so paginated views go back to
 *    page 1 instead of stranding on an empty page index for the new filter.
 *  - `paramName` defaults to `environment` to match the convention used by
 *    `getSessions` / `getSpans` and the existing trace filters.
 */
export interface EnvironmentFilterProps {
  /** Currently selected environment, or empty string for "All". */
  value: string;
  /** Distinct environments fetched server-side from `getDistinctEnvironments`. */
  options: ReadonlyArray<string>;
  /** URL search-param key. Defaults to `environment`. */
  paramName?: string;
  /** Group label for screen readers. Defaults to "Filter by environment". */
  ariaLabel?: string;
  className?: string;
}

export function EnvironmentFilter({
  value,
  options,
  paramName = "environment",
  ariaLabel = "Filter by environment",
  className,
}: EnvironmentFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set(paramName, next);
    } else {
      params.delete(paramName);
    }
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={className}
    >
      <option value="">All environments</option>
      {options.map((env) => (
        <option key={env} value={env}>
          {env}
        </option>
      ))}
    </Select>
  );
}
