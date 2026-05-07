import { Skeleton } from "@/components/ui/skeleton";

/**
 * Overview loading state — mirrors the rebuilt page layout (header with
 * time-range picker + 4 KPI tiles + 2×2 chart grid + 2-column table row)
 * so layout-shift on hydration is minimal. The chart panels are the heavy
 * loads (each runs its own ClickHouse aggregation).
 */
export default function OverviewLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:px-10 lg:py-10">
      {/* Header card with time-range picker placeholder */}
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl flex-1">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-5 h-9 w-72" />
            <Skeleton className="mt-3 h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-44 rounded-xl" />
        </div>
      </div>

      {/* 4 KPI tiles */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-md" />
        ))}
      </section>

      {/* 2×2 chart grid */}
      <section className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[1.5rem] border tech-border bg-panel p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-64" />
            <Skeleton className="mt-4 h-64 w-full" />
          </div>
        ))}
      </section>

      {/* Tables row */}
      <section className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-4 rounded-[1.5rem] border tech-border bg-panel p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((__, j) => (
                <Skeleton key={j} className="h-10 w-full" />
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
