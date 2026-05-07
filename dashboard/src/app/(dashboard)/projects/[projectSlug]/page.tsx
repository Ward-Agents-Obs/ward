import { getOrCreateOrg } from "@/lib/org";
import { getProjectDescription, getProjectDisplayName } from "@/lib/projects";
import { getOverviewMetrics } from "@/lib/queries/overview";
import { formatCost, formatLatency, formatNumber } from "@/lib/utils";
import { SdkOnboarding } from "@/components/sdk-onboarding";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { prisma } from "@/lib/prisma";

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const [org, { projectSlug }] = await Promise.all([getOrCreateOrg(), params]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  // We only need to know whether the tenant already has an active key —
  // never the value. Plaintext exists only at creation; the DB stores a hash
  // plus a truncated 12-char prefix that won't authenticate. Embedding the
  // prefix in the onboarding snippet would silently break copy-paste setup.
  const [metrics, hasActiveKey] = await Promise.all([
    getOverviewMetrics(org.tenantId),
    prisma.apiKey.count({ where: { orgId: org.id, active: true } }).then((n) => n > 0),
  ]);

  const projectName = getProjectDisplayName(projectSlug);
  const projectDescription = getProjectDescription(projectSlug);
  const hasData = metrics.totalSpans > 0;

  // If no data, show only the SDK onboarding
  if (!hasData) {
    return <SdkOnboarding hasActiveKey={hasActiveKey} />;
  }

  // If has data, show the full dashboard
  return (
    <div className="space-y-8">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / Dashboard
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground">{projectName}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">{projectDescription}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Row - Large Metric Cards */}
        <div className="rounded-xl border tech-border bg-panel p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total cost</h3>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-foreground tracking-tight">{formatCost(metrics.totalCost)}</span>
          </div>
        </div>

        <div className="rounded-xl border tech-border bg-panel p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total requests</h3>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-foreground tracking-tight">{formatNumber(metrics.totalSpans)}</span>
          </div>
        </div>

        {/* Second Row - Charts */}
        <div className="rounded-xl border tech-border bg-panel p-6">
          <h3 className="mb-4 text-sm font-medium text-muted-foreground">Daily cost</h3>
          <div className="h-48">
            {/* This would be a chart showing daily cost over time */}
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="text-2xl font-semibold">$0</div>
                <div className="text-sm">No data yet</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border tech-border bg-panel p-6">
          <h3 className="mb-4 text-sm font-medium text-muted-foreground">Token usage</h3>
          <div className="h-48">
            {/* This would be a chart showing token usage */}
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="text-2xl font-semibold">0</div>
                <div className="text-sm">No data yet</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border tech-border bg-panel p-6">
          <h3 className="mb-4 text-sm font-medium text-muted-foreground">Median latency</h3>
          <div className="h-48">
            {/* This would be a chart showing latency over time */}
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <div className="text-2xl font-semibold">{formatLatency(metrics.avgLatencyMs)}</div>
                <div className="text-sm">Average latency</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
