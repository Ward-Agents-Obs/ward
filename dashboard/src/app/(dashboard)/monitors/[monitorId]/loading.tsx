import { Skeleton } from "@/components/ui/skeleton";

/**
 * Monitor detail loading state. Mirrors the rebuilt detail layout: back
 * link, hero with status pill + Edit button, configuration grid, and
 * trigger history table.
 */
export default function MonitorDetailLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <Skeleton className="h-8 w-36" />

      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-44" />
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-72" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      </div>

      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      </section>

      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-4 overflow-hidden rounded-xl border tech-border">
          <Skeleton className="h-12 w-full rounded-none" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-12 w-full rounded-none border-t tech-border"
            />
          ))}
        </div>
      </section>
    </main>
  );
}
