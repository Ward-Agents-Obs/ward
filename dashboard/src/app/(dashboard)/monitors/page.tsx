import { Radar } from "lucide-react";
import { getOrCreateOrg } from "@/lib/org";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { getMonitors } from "@/lib/monitors";
import { getDistinctEnvironments } from "@/lib/queries/sessions";
import { getDistinctModels } from "@/lib/queries/traces";
import { TimeRangePicker } from "@/components/ui/time-range-picker";
import { CreateMonitorButton } from "@/components/monitors/create-monitor-button";
import {
  resolveMonitorStatus,
  type MonitorRenderStatus,
} from "@/components/monitors/monitor-format";
import { MonitorListTable } from "@/components/monitors/monitor-list-table";

/**
 * V1 Monitors list page (F7 / task #18). Scaffolded against mock data via
 * `getMonitors()` — backend's #14 lands the Prisma model and #15 wires the
 * server actions, at which point the list helper swaps to a real Prisma
 * query (see TODO inside `lib/monitors.ts`).
 *
 * Behaviour today:
 *  - Renders 3 mock monitors (firing / ok / disabled) so every status pill
 *    code path renders without backend.
 *  - Status filter chips are URL-state via the shared `<TimeRangePicker>`
 *    primitive (renamed in spirit to "URL-state segmented picker" — same
 *    component, different option set + paramName).
 *  - "Create monitor" button mounts `<MonitorFormDialog>` and uses the
 *    existing stub server actions; submit currently returns
 *    `{ ok: false, message: "...waiting on B7/B8..." }` so the user sees a
 *    clear error message inside the modal until backend lands.
 *
 * NOT marked completed in the task list — this is the scaffold half of
 * #18; the swap-in to real data closes it out.
 */

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "firing", label: "Firing" },
  { value: "ok", label: "Ok" },
  { value: "disabled", label: "Disabled" },
] as const;
type StatusFilterValue = (typeof STATUS_FILTERS)[number]["value"];

function parseStatus(raw: string | undefined): StatusFilterValue {
  const allowed = STATUS_FILTERS.map((f) => f.value) as readonly string[];
  if (raw && allowed.includes(raw)) return raw as StatusFilterValue;
  return "all";
}

function matchesFilter(
  status: MonitorRenderStatus,
  filter: StatusFilterValue,
): boolean {
  return filter === "all" || filter === status;
}

export default async function MonitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [org, query] = await Promise.all([getOrCreateOrg(), searchParams]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  const statusFilter = parseStatus(query.status);

  // Parallel fetch — env/model lists for the dialog dropdowns, monitor list
  // from the stub. Distinct queries are tenant-scoped via `requireTenantId`
  // upstream; the monitor stub takes `orgId` so the swap-in to Prisma
  // already has the right argument.
  const [monitors, environments, models] = await Promise.all([
    getMonitors(org.id),
    getDistinctEnvironments(org.tenantId),
    getDistinctModels(org.tenantId),
  ]);

  const filtered = monitors.filter((m) =>
    matchesFilter(
      resolveMonitorStatus({ enabled: m.enabled, state: m.state }),
      statusFilter,
    ),
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Ward / Monitors
            </span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
              Monitors
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Get alerted when cost, latency, or error rate crosses a threshold
              for a specific model or environment.
            </p>
          </div>
          <CreateMonitorButton
            availableEnvironments={environments}
            availableModels={models}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <TimeRangePicker
          value={statusFilter}
          options={STATUS_FILTERS}
          paramName="status"
          ariaLabel="Filter by status"
        />
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {monitors.length}{" "}
          {monitors.length === 1 ? "monitor" : "monitors"}
        </p>
      </div>

      {monitors.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed tech-border bg-panel p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-foreground">
            <Radar className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-foreground">
            No monitors yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Create a monitor to get notified when costs spike, latency degrades,
            or error rates climb. You can scope each monitor to a single
            environment or model.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed tech-border bg-panel p-10 text-center">
          <p className="text-sm font-medium text-foreground">
            No monitors match the {STATUS_FILTERS.find((f) => f.value === statusFilter)?.label.toLowerCase()} filter.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Try clearing the filter or creating a monitor with a different
            scope.
          </p>
        </div>
      ) : (
        <MonitorListTable monitors={filtered} />
      )}
    </main>
  );
}

