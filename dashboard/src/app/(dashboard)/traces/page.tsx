import Link from "next/link";
import { getOrCreateOrg } from "@/lib/org";
import { getSessions, getDistinctEnvironments } from "@/lib/queries/sessions";
import { getDistinctModels as getTraceModels } from "@/lib/queries/traces";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { SessionTable } from "@/components/traces/session-table";
import { TraceFilters } from "@/components/traces/trace-filters";

export default async function TracesPage({
  searchParams,
}: {
  searchParams: Promise<{
    timeRange?: string;
    environment?: string;
    model?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const [org, query] = await Promise.all([getOrCreateOrg(), searchParams]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  const page = parseInt(query.page || "1");
  const limit = 50;
  const offset = (page - 1) * limit;

  const [sessions, environments, models] = await Promise.all([
    getSessions(org.tenantId, {
      timeRange: query.timeRange,
      environment: query.environment,
      model: query.model,
      search: query.search,
      limit,
      offset,
    }),
    getDistinctEnvironments(org.tenantId),
    getTraceModels(org.tenantId),
  ]);

  const loadMoreHref = `/traces?page=${page + 1}${query.timeRange ? `&timeRange=${query.timeRange}` : ""}${
    query.environment ? `&environment=${query.environment}` : ""
  }${query.model ? `&model=${query.model}` : ""}${query.search ? `&search=${query.search}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / Traces
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">Traces</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          All LLM conversations and sessions instrumented by Ward across your workspace.
        </p>
      </div>

      <TraceFilters
        availableEnvironments={environments}
        availableModels={models}
        className="rounded-[2rem] border tech-border bg-panel p-6"
      />

      <SessionTable sessions={sessions} />

      {sessions.length === limit ? (
        <div className="flex justify-center">
          <Link
            href={loadMoreHref}
            className="rounded-xl border tech-border bg-panel px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-hover"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </div>
  );
}
