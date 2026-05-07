import { Skeleton } from "@/components/ui/skeleton";

/**
 * Trace detail loading state. Mirrors the V1 rebuilt detail layout: hero +
 * 4 stat tiles + prompt/completion panes + waterfall section + per-span
 * attribute disclosure cards.
 */
export default function TraceDetailLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <Skeleton className="h-8 w-32" />

      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-5 h-9 w-72" />
        <Skeleton className="mt-3 h-4 w-96" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-[1.5rem] border tech-border bg-panel p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-44 w-full" />
          </div>
        ))}
      </div>

      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </section>

      <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-72" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    </main>
  );
}
