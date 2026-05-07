import { Skeleton } from "@/components/ui/skeleton";

/**
 * Traces loading state — mirrors the rebuilt page layout (header with
 * view-toggle + filter chips card + table) so layout-shift on hydration is
 * minimal. The `getSpans` / `getSessions` aggregations are the slowest reads
 * in the dashboard so this skeleton is the most likely to be on screen.
 */
export default function TracesLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-5 h-9 w-40" />
            <Skeleton className="mt-2 h-4 w-full max-w-xl" />
          </div>
          <Skeleton className="h-10 w-44 rounded-xl" />
        </div>
      </div>

      <div className="space-y-4 rounded-[2rem] border tech-border bg-panel p-6">
        <Skeleton className="h-10 w-72 rounded-xl" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 flex-1 min-w-[14rem] rounded-lg" />
          <Skeleton className="h-10 w-44 rounded-lg" />
          <Skeleton className="h-10 w-44 rounded-lg" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border tech-border bg-panel">
        <Skeleton className="h-12 w-full rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-14 w-full rounded-none border-t tech-border"
          />
        ))}
      </div>
    </main>
  );
}
