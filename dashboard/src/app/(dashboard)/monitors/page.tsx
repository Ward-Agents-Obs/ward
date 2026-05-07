import { Radar } from "lucide-react";
import { getOrCreateOrg } from "@/lib/org";
import { TenantContextFallback } from "@/components/tenant-context-fallback";

/**
 * V1 Monitors landing page.
 *
 * This is the route stub created alongside the sidebar prune (B1) so the
 * Monitors nav link resolves instead of 404-ing while the full UI lands in
 * task F3. It renders the genuine zero-state of the Monitors feature: when
 * no monitors are configured for the tenant, the user sees this page and
 * the explanation of what monitors do.
 *
 * F3 will extend this file with a Prisma-backed list view, a Create button,
 * and the trigger-history surface — replacing the empty state with a table
 * when monitors exist for the tenant.
 */
export default async function MonitorsPage() {
  const org = await getOrCreateOrg();
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8 shadow-sm">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / Monitors
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">Monitors</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Get alerted when cost, latency, or error rate crosses a threshold for a specific model
          or environment. Monitors evaluate your tenant&apos;s recent spans on a fixed cadence and
          surface a banner in the dashboard when a condition is breached.
        </p>
      </div>

      <div className="mt-8 rounded-[2rem] border tech-border bg-panel p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-foreground">
          <Radar className="h-5 w-5" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-foreground">No monitors configured</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Once monitor creation ships, you&apos;ll be able to track cost, p95 latency, and error
          rate across your traces from this page. For now there is nothing to alert on yet.
        </p>
      </div>
    </main>
  );
}
