import { Skeleton } from "@/components/ui/skeleton";

/**
 * Costs page loading state. Mirrors the page layout: header, two-column
 * chart grid, then the per-model table. This page is out of V1 scope but
 * still mounted, so providing the skeleton keeps it coherent on slow loads.
 */
export default function CostsLoading() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-4 w-28" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border tech-border bg-panel p-6">
            <Skeleton className="mb-4 h-4 w-32" />
            <Skeleton className="h-72 w-full" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border tech-border bg-panel">
        <Skeleton className="h-12 w-full rounded-none" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-none border-t tech-border" />
        ))}
      </div>
    </div>
  );
}
