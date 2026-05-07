import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getOrCreateOrg } from "@/lib/org";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { getMonitor, getMonitorTriggers } from "@/lib/monitors";
import { getDistinctEnvironments } from "@/lib/queries/sessions";
import { getDistinctModels } from "@/lib/queries/traces";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { EditMonitorButton } from "@/components/monitors/edit-monitor-button";
import { MonitorStatusPill } from "@/components/monitors/monitor-status-pill";
import {
  formatCondition,
  formatMetricLabel,
  formatMetricValue,
  formatRelativeTime,
  formatScope,
  resolveMonitorStatus,
} from "@/components/monitors/monitor-format";
import { formatLatency } from "@/lib/utils";

/**
 * V1 Monitor detail page (F9 / task #20). Three sections per team-lead's
 * scope direction:
 *  1. Configuration — read-only summary of metric / comparator / threshold /
 *     window / scope, plus current value.
 *  2. History — the most recent triggers (via `getMonitorTriggers` stub).
 *  3. Edit — opens the existing F8 `<MonitorFormDialog>` in edit mode.
 *
 * Architect's full §V1.D detail spec also calls for a metric chart with a
 * threshold line + breached regions and a "recent matching spans" link-out.
 * Both need ClickHouse queries that don't exist yet — flagged inline as
 * TODO(#20) so the next pass knows where to graft them in.
 *
 * NOT marked completed in the task list — this is the scaffold half of
 * #20; the swap-in to real data + the chart panel close it out.
 */
export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ monitorId: string }>;
}) {
  const [org, { monitorId }] = await Promise.all([getOrCreateOrg(), params]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  // The compound `(id, orgId)` lookup inside `getMonitor` is the IDOR guard
  // — a monitor that belongs to another org returns null, not throws. Map
  // null to a 404 so the user sees a real not-found page rather than an
  // ambiguous error.
  const monitor = await getMonitor(org.id, monitorId);
  if (!monitor) {
    notFound();
  }

  // Triggers + filter dropdown values fetched in parallel; the dialog
  // (rendered by `<EditMonitorButton>`) needs the env/model lists.
  const [triggers, environments, models] = await Promise.all([
    getMonitorTriggers(org.id, monitor.id, 50),
    getDistinctEnvironments(org.tenantId),
    getDistinctModels(org.tenantId),
  ]);

  const status = resolveMonitorStatus({
    enabled: monitor.enabled,
    state: monitor.state,
  });
  const condition = formatCondition({
    metric: monitor.metric,
    comparator: monitor.comparator,
    threshold: monitor.threshold,
    windowMinutes: monitor.windowMinutes,
  });
  const scope = formatScope({
    environment: monitor.environment,
    model: monitor.model,
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <div>
        <Link
          href="/monitors"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Back to monitors
        </Link>
      </div>

      <div className="rounded-[2rem] border tech-border bg-panel p-8 shadow-sm">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / Monitor detail
        </span>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {monitor.name}
              </h1>
              <MonitorStatusPill status={status} />
            </div>
            <p className="mt-2 text-sm font-mono text-muted-foreground">
              {monitor.id}
            </p>
            {monitor.description ? (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {monitor.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <EditMonitorButton
              monitor={monitor}
              availableEnvironments={environments}
              availableModels={models}
            />
            {/*
              Toggle/Delete deferred until backend's #15 wires the actions
              through. The form's stubbed actions cover create/update; we
              don't have a "toggle from detail page" call site yet because
              there's nothing to toggle against. TODO(#20): add `<Button
              variant="secondary">Disable</Button>` + `<Button
              variant="destructive">Delete</Button>` once #15 lands.
            */}
          </div>
        </div>
      </div>

      {/* Configuration */}
      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-foreground">Configuration</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only summary of the rule. Use Edit to change any field.
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Metric" value={formatMetricLabel(monitor.metric)} />
          <DetailField label="Condition" value={condition} mono />
          <DetailField label="Scope" value={scope} />
          <DetailField
            label="Current value"
            value={
              monitor.lastValue !== null
                ? formatMetricValue(monitor.metric, monitor.lastValue)
                : "—"
            }
            mono
          />
          <DetailField
            label="Last evaluated"
            value={formatRelativeTime(monitor.lastEvaluatedAt)}
          />
          <DetailField
            label="Last triggered"
            value={formatRelativeTime(monitor.lastTriggeredAt)}
          />
        </dl>
      </section>

      {/* TODO(#20): metric value chart with threshold line + breached
        * regions, per architect's §V1.D detail spec. Needs a ClickHouse
        * query that aggregates the monitor's metric expression bucketed
        * over the last 24h. Backend's #16 (cron worker) builds the same
        * SQL fragment server-side; refactor into a shared helper when
        * landing this. */}

      {/* History */}
      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-foreground">Trigger history</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Most recent fires for this monitor. A row with no resolution time
            is currently firing.
          </p>
        </div>
        {triggers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No triggers yet. {status === "ok"
              ? "Things look healthy."
              : "Once this monitor fires it will appear here."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fired at</TableHead>
                <TableHead>Resolved at</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Peak value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {triggers.map((t) => {
                const fired = new Date(t.firedAt).getTime();
                const resolved = t.resolvedAt
                  ? new Date(t.resolvedAt).getTime()
                  : null;
                const durationMs = resolved !== null ? resolved - fired : null;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(t.firedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t.resolvedAt ? (
                        <span className="text-muted-foreground">
                          {new Date(t.resolvedAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className="font-medium text-destructive">
                          Still firing
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {durationMs !== null ? formatLatency(durationMs) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMetricValue(monitor.metric, t.triggerValue)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {/* TODO(#20): "Recent matching spans" panel linking into /traces
        * filtered by env/model/window-of-last-fire — per architect's §V1.D
        * detail spec. Reuses the existing `<SpanListTable>`; query is
        * `getSpans({ environment, model, timeRange })` already available. */}
    </main>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border tech-border bg-background p-4">
      <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          "mt-2 text-sm text-foreground" + (mono ? " font-mono" : " font-medium")
        }
      >
        {value}
      </dd>
    </div>
  );
}
