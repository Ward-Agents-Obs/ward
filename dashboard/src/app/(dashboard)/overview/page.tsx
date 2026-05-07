import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Clock,
  DollarSign,
  ExternalLink,
} from "lucide-react";
import { getOrCreateOrg } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { MetricCard } from "@/components/metric-card";
import { SdkOnboarding } from "@/components/sdk-onboarding";
import {
  getCostByModel,
  getCostOverTime,
  getErrorRateOverTime,
  getLatencyPercentiles,
  getOverviewMetrics,
  getOverviewMetricsDelta,
  getRecentFailures,
  getSpansOverTimeByModel,
  type OverviewTimeRange,
} from "@/lib/queries/overview";
import { getDistinctEnvironments } from "@/lib/queries/sessions";
import { formatCost, formatLatency, formatNumber } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CostOverTimeChart,
  ErrorRateChart,
  LatencyChart,
  SpansByModelChart,
} from "./charts";
import {
  DEFAULT_TIME_RANGE_OPTIONS,
  TimeRangePicker,
} from "@/components/ui/time-range-picker";
import { EnvironmentFilter } from "@/components/ui/environment-filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_RANGES = new Set<OverviewTimeRange>(["1h", "24h", "7d", "30d"]);

/**
 * Validate the `?range=` search param against the OverviewTimeRange union.
 * Anything malformed silently degrades to the default (24h) — never trust
 * route params for behaviour or scoping (AGENTS.MD §6).
 */
function parseRange(raw: string | undefined): OverviewTimeRange {
  if (raw && (VALID_RANGES as Set<string>).has(raw)) {
    return raw as OverviewTimeRange;
  }
  return "24h";
}

/**
 * Map the time-range token to the `days` parameter accepted by
 * `getCostByModel`. The cost query doesn't take a bucketed `OverviewTimeRange`
 * yet — backend follow-up tracked separately. For 1h/24h we use 1 day so the
 * "Top models by cost" panel stays populated; users on 1h get a slightly
 * wider window for that panel only and we surface that in the caption.
 */
function rangeToDays(range: OverviewTimeRange): number {
  switch (range) {
    case "1h":
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
  }
}

const RANGE_LABEL: Record<OverviewTimeRange, string> = {
  "1h": "last hour",
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

/**
 * Validate the `?environment=` filter. The set of valid environments is
 * tenant-specific (whatever values the SDK has emitted), so we accept any
 * non-empty string within a sane length cap and rely on the backend query
 * to return zero rows for nonsense values. Anything malformed degrades to
 * "All environments" silently — same pattern as `parseRange` above.
 */
function parseEnvironment(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return "";
  return trimmed;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; environment?: string }>;
}) {
  const [org, query] = await Promise.all([getOrCreateOrg(), searchParams]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  const range = parseRange(query.range);
  const environment = parseEnvironment(query.environment);
  // Coerce empty string → undefined so each query treats "no filter"
  // uniformly. `parseEnvironment` already returns "" for invalid/missing
  // input, so this is the only place we need to translate.
  const envFilter = environment || undefined;

  /**
   * Parallel fetch. Each query is tenant-scoped via the shared
   * `requireTenantId()` guard inside `lib/queries/overview.ts` and now
   * additionally honours an optional `environment` filter. A single
   * ClickHouse outage takes down the whole page; the route-group
   * `error.tsx` boundary surfaces a recoverable card per AGENTS.MD §5.3.
   */
  const [
    metrics,
    deltas24h,
    deltasRange,
    latency,
    errorRate,
    spansByModel,
    costByModel,
    costOverTime,
    recentFailures,
    environments,
    activeKeyCount,
  ] = await Promise.all([
    getOverviewMetrics(org.tenantId, envFilter),
    // Two delta calls so each KPI's delta matches the window its value
    // describes (architect's design: "delta refers to the same population
    // the KPI tile shows"). The 24h call covers spans/cost/avgLatency
    // because `getOverviewMetrics` is fixed at 24h; the range-driven call
    // covers errorRate because the error-rate KPI is computed from the
    // bucketed `errorRate` aggregate below, which respects the picker.
    // When `range === "24h"` both return identical data — the duplicate
    // round-trip is cheap enough not to dedupe.
    getOverviewMetricsDelta(org.tenantId, "24h", "24h", envFilter),
    getOverviewMetricsDelta(org.tenantId, range, range, envFilter),
    getLatencyPercentiles(org.tenantId, range, envFilter),
    getErrorRateOverTime(org.tenantId, range, envFilter),
    getSpansOverTimeByModel(org.tenantId, range, envFilter),
    getCostByModel(org.tenantId, rangeToDays(range), envFilter),
    getCostOverTime(org.tenantId, range, envFilter),
    getRecentFailures(org.tenantId, 5, envFilter),
    getDistinctEnvironments(org.tenantId),
    prisma.apiKey.count({ where: { orgId: org.id, active: true } }),
  ]);

  // Empty state: no spans at all means the user hasn't sent traces yet.
  // The §V1.B spec gates onboarding on `total_spans=0`. Use the SDK
  // onboarding component (which now takes a boolean signal — F-fix #23).
  if (metrics.totalSpans === 0) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 lg:px-10 lg:py-10">
        <SdkOnboarding hasActiveKey={activeKeyCount > 0} />
      </main>
    );
  }

  // Aggregated error rate across the displayed window — used by the KPI tile.
  const errorTotals = errorRate.reduce(
    (acc, b) => ({ total: acc.total + b.total, errors: acc.errors + b.errors }),
    { total: 0, errors: 0 }
  );
  const errorPct =
    errorTotals.total > 0 ? (errorTotals.errors / errorTotals.total) * 100 : 0;

  const topModels = costByModel
    .map((row) => ({ model: row.model, cost: parseFloat(row.cost) || 0 }))
    .filter((row) => row.model)
    .slice(0, 5);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <div className="rounded-[2rem] border tech-border bg-panel p-8 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Workspace
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground">
              {org.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Tenant health snapshot for the {RANGE_LABEL[range]}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TimeRangePicker
              value={range}
              options={DEFAULT_TIME_RANGE_OPTIONS}
              paramName="range"
            />
            <EnvironmentFilter
              value={environment}
              options={environments}
              paramName="environment"
            />
          </div>
        </div>
      </div>

      {/* KPI tiles. Spans/Cost/AvgLatency reflect a 24h window (since
        * `getOverviewMetrics` is 24h-fixed) and pair with the 24h delta.
        * Error rate is range-aware (computed from the bucketed errorRate
        * aggregate below) and pairs with the range-aware delta so its
        * "vs prior" comparison tracks the picker. `caption` shows when no
        * delta is available (fresh tenant); `deltaLabel` overrides the
        * caption alongside the arrow when one is. */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total spans"
          value={formatNumber(metrics.totalSpans)}
          icon={Activity}
          caption="last 24h"
          delta={deltas24h.totalSpans ?? undefined}
          deltaLabel="vs prior 24h"
        />
        <MetricCard
          title="Total cost"
          value={formatCost(metrics.totalCost)}
          icon={DollarSign}
          caption="last 24h"
          delta={deltas24h.totalCost ?? undefined}
          deltaLabel="vs prior 24h"
          goodDirection="down"
        />
        <MetricCard
          title="Avg latency"
          value={formatLatency(metrics.avgLatencyMs)}
          icon={Clock}
          caption="last 24h"
          delta={deltas24h.avgLatency ?? undefined}
          deltaLabel="vs prior 24h"
          goodDirection="down"
        />
        <MetricCard
          title="Error rate"
          value={`${errorPct.toFixed(2)}%`}
          icon={AlertTriangle}
          caption={RANGE_LABEL[range]}
          delta={deltasRange.errorRate ?? undefined}
          deltaLabel={`vs prior ${RANGE_LABEL[range].replace("last ", "")}`}
          goodDirection="down"
        />
      </section>

      {/* Charts row */}
      <section className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Spans by model"
          description={`Stacked traffic across all GenAI calls — ${RANGE_LABEL[range]}.`}
        >
          <SpansByModelChart data={spansByModel} />
        </ChartCard>
        <ChartCard
          title="Latency p50 / p95 / p99"
          description={`Per-bucket percentiles in ms — ${RANGE_LABEL[range]}.`}
        >
          <LatencyChart data={latency} />
        </ChartCard>
        <ChartCard
          title="Error rate"
          description={`Failed spans as a percentage of all GenAI calls per bucket — ${RANGE_LABEL[range]}.`}
        >
          <ErrorRateChart data={errorRate} />
        </ChartCard>
        <ChartCard
          title="Cost over time"
          description={`Per-bucket spend in USD — ${RANGE_LABEL[range]}.`}
        >
          <CostOverTimeChart data={costOverTime} />
        </ChartCard>
      </section>

      {/* Tables row */}
      <section className="grid gap-6 lg:grid-cols-2">
        <PanelCard
          title="Top 5 models by cost"
          description="Highest spend across the selected window."
        >
          {topModels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spend recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topModels.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell>
                      <span className="rounded bg-background px-2 py-0.5 font-mono text-xs">
                        {row.model}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCost(row.cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelCard>

        <PanelCard
          title="Recent failures"
          description="Latest 5 failed GenAI spans across all environments."
        >
          {recentFailures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No failures recorded — that&apos;s a good thing.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Span</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentFailures.map((row) => (
                  <TableRow key={`${row.traceId}-${row.spanId}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(row.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/traces/${row.traceId}`}
                        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                        title={row.statusMessage || row.spanName}
                      >
                        {row.spanName}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="rounded bg-background px-2 py-0.5 font-mono text-xs">
                        {row.model || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatLatency(row.latencyMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelCard>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Local layout helpers — keep the page declarative without dragging in a full
// Card primitive (deferred to a wider styling sweep).
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.5rem] border tech-border bg-panel p-6">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-[1.5rem] border tech-border bg-panel p-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
