import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic dashboard fallback skeleton. Shown for any route under
 * `(dashboard)/` that doesn't ship a bespoke `loading.tsx`. Per-route
 * skeletons override this and mirror their final page layout to minimize
 * content-shift on hydration.
 */
export default function DashboardLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-5 h-9 w-64" />
        <Skeleton className="mt-3 h-4 w-96" />
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-[1.5rem]" />
        ))}
      </div>
    </main>
  );
}
