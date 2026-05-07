import { Skeleton } from "@/components/ui/skeleton";

/**
 * Project dashboard loading state. The route is hidden from the V1 sidebar
 * (single-org, no projects in V1.0) but stays mounted in case the projects
 * feature flag is on or the URL is hit directly. Mirrors the KPI grid.
 */
export default function ProjectDashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-5 h-10 w-56" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border tech-border bg-panel p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-5 h-10 w-32" />
            {i >= 2 ? <Skeleton className="mt-4 h-44 w-full" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
