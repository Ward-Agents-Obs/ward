import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
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
              {/*
                aria-describedby points at the status pill so screen readers
                announce "Cost spike — production. Described as: Firing." A
                visible-only pill would otherwise be missed by SR users when
                a monitor is actively breaching.
              */}
              <h1
                className="text-3xl font-semibold tracking-tight text-foreground"
                aria-describedby={`monitor-status-${monitor.id}`}
              >
                {monitor.name}
              </h1>
              <MonitorStatusPill
                status={status}
                id={`monitor-status-${monitor.id}`}
              />
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

      {/* Recent matching spans — deep-link into /traces with this monitor's
        * scope filters applied. We don't render spans inline (architect's
        * §V1.D spec calls for it but the value-add over a one-click open is
        * small for V1, and inlining would duplicate the SpanListTable's
        * querying logic). The link uses a 24h window which covers monitor
        * windows from 5m up to 24h; users can adjust on /traces. */}
      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-foreground">
              Recent matching spans
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open the trace explorer with this monitor&apos;s scope filters
              applied —{" "}
              <span className="font-medium text-foreground">{scope}</span>,
              last 24 hours. Useful for triage when a fire is active or to
              verify a quiet monitor is actually quiet.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm" className="shrink-0">
            <Link href={buildMatchingSpansHref(monitor)}>
              Open in /traces
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

/**
 * Build a `/traces` deep-link that pre-applies this monitor's scope filters.
 * Empty scope (env/model both null) yields a link with just `?timeRange=24h`,
 * which is still useful — the user can eyeball whether anything's coming in
 * at all.
 */
function buildMatchingSpansHref(monitor: {
  environment?: string | null;
  model?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("timeRange", "24h");
  if (monitor.environment) params.set("environment", monitor.environment);
  if (monitor.model) params.set("model", monitor.model);
  return `/traces?${params.toString()}`;
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
