import Link from "next/link";
import { cn } from "@/lib/utils";
import { getOrCreateOrg } from "@/lib/org";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { SessionTable } from "@/components/traces/session-table";
import { SpanListTable } from "@/components/traces/span-list-table";
import { TraceFilters } from "@/components/traces/trace-filters";
import {
  TracesViewToggle,
  type TracesView,
} from "@/components/traces/view-toggle";
import { buttonVariants } from "@/components/ui/button";
import {
  getDistinctEnvironments,
  getSessions,
} from "@/lib/queries/sessions";
import {
  getDistinctModels,
  getSpans,
  type SpansFilters,
  type SpansTimeRange,
} from "@/lib/queries/traces";

// ---------------------------------------------------------------------------
// Search-param parsing — every external string is treated as untrusted
// (AGENTS.MD §6). Anything malformed silently falls back to a default so a
// junk URL doesn't blow up the page.
// ---------------------------------------------------------------------------

const VIEWS = new Set<TracesView>(["list", "sessions"]);
const RANGES = new Set<SpansTimeRange>(["1h", "24h", "7d", "30d"]);
const STATUSES = new Set<NonNullable<SpansFilters["status"]>>(["ok", "error"]);

function parseView(raw: string | undefined): TracesView {
  if (raw && (VIEWS as Set<string>).has(raw)) return raw as TracesView;
  return "list";
}

function parseRange(raw: string | undefined): SpansTimeRange {
  if (raw && (RANGES as Set<string>).has(raw)) return raw as SpansTimeRange;
  return "24h";
}

function parseStatus(raw: string | undefined): SpansFilters["status"] | undefined {
  if (raw && (STATUSES as Set<string>).has(raw)) {
    return raw as NonNullable<SpansFilters["status"]>;
  }
  return undefined;
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000); // hard ceiling so OFFSET stays bounded
}

const PAGE_SIZE = 50;

const RANGE_LABEL: Record<SpansTimeRange, string> = {
  "1h": "last hour",
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

interface TracesSearchParams {
  view?: string;
  timeRange?: string;
  environment?: string;
  model?: string;
  status?: string;
  search?: string;
  page?: string;
}

export default async function TracesPage({
  searchParams,
}: {
  searchParams: Promise<TracesSearchParams>;
}) {
  const [org, query] = await Promise.all([getOrCreateOrg(), searchParams]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  const view = parseView(query.view);
  const timeRange = parseRange(query.timeRange);
  const status = parseStatus(query.status);
  const page = parsePage(query.page);
  const offset = (page - 1) * PAGE_SIZE;
  // Optional string filters — empty strings should not bind to the SQL.
  const environment = query.environment?.trim() || undefined;
  const model = query.model?.trim() || undefined;
  const search = query.search?.trim() || undefined;

  // Filter dropdowns share the same source-of-truth as the queries below.
  const [environments, models] = await Promise.all([
    getDistinctEnvironments(org.tenantId),
    getDistinctModels(org.tenantId),
  ]);

  // Branch on view — the two surfaces hit different queries, so we don't pay
  // for both. Each query is tenant-scoped via `requireTenantId()` upstream.
  let listSpans: Awaited<ReturnType<typeof getSpans>> = [];
  let sessions: Awaited<ReturnType<typeof getSessions>> = [];
  if (view === "list") {
    listSpans = await getSpans(org.tenantId, {
      timeRange,
      environment,
      model,
      status,
      search,
      limit: PAGE_SIZE,
      offset,
    });
  } else {
    sessions = await getSessions(org.tenantId, {
      timeRange,
      environment,
      model,
      search,
      limit: PAGE_SIZE,
      offset,
    });
  }

  const rowsForCurrentView =
    view === "list" ? listSpans.length : sessions.length;

  // Build the "Load more" href by bumping the page param while preserving
  // every other filter the user has set. URLSearchParams keeps the encoding
  // honest (no manual `&` glue).
  const nextParams = new URLSearchParams();
  if (view !== "list") nextParams.set("view", view);
  if (timeRange !== "24h") nextParams.set("timeRange", timeRange);
  if (environment) nextParams.set("environment", environment);
  if (model) nextParams.set("model", model);
  if (status) nextParams.set("status", status);
  if (search) nextParams.set("search", search);
  nextParams.set("page", String(page + 1));
  const loadMoreHref = `?${nextParams.toString()}`;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Ward / Tracing
            </span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
              Tracing
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {view === "list"
                ? `Every GenAI call instrumented by Ward over the ${RANGE_LABEL[timeRange]}.`
                : `Conversations and multi-step interactions over the ${RANGE_LABEL[timeRange]}.`}
            </p>
          </div>
          <TracesViewToggle active={view} />
        </div>
      </div>

      <TraceFilters
        availableEnvironments={environments}
        availableModels={models}
        view={view}
        className="rounded-[2rem] border tech-border bg-panel p-6"
      />

      {/*
        Empty-state copy is CTA-ish per AGENTS.MD §5.3 / team-lead direction —
        guide the user from "no data" to "set up the SDK" without a dead-end
        message. We surface it inside a panel so the filter chips above stay
        usable for tenants that just have no rows under the current filter.
      */}
      {rowsForCurrentView === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed tech-border bg-panel p-10 text-center">
          <p className="text-sm font-medium text-foreground">
            No {view === "list" ? "spans" : "sessions"} matched your filters.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Try widening the time range, clearing filters, or installing the SDK
            in a new app to start sending traces.
          </p>
          <Link
            href="/settings"
            className={cn(
              "mt-5",
              buttonVariants({ variant: "secondary", size: "sm" })
            )}
          >
            View SDK setup
          </Link>
        </div>
      ) : view === "list" ? (
        <SpanListTable spans={listSpans} />
      ) : (
        <SessionTable sessions={sessions} />
      )}

      {rowsForCurrentView === PAGE_SIZE ? (
        <div className="flex justify-center">
          <Link
            href={loadMoreHref}
            scroll={false}
            className={buttonVariants({ variant: "secondary" })}
          >
            Load more
          </Link>
        </div>
      ) : null}

      {page > 1 ? (
        <div className="flex justify-center">
          <Link
            href={(() => {
              const params = new URLSearchParams(nextParams);
              params.delete("page");
              const qs = params.toString();
              return qs ? `?${qs}` : "?";
            })()}
            scroll={false}
            className={buttonVariants({ variant: "link", size: "sm" })}
          >
            ← Back to first page
          </Link>
        </div>
      ) : null}
    </main>
  );
}
