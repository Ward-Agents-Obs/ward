import { Skeleton } from "@/components/ui/skeleton";

/**
 * Project traces loading state. Hidden from V1 sidebar; F2 (#11) plans to
 * delete this surface once the workspace `/traces` covers the same use
 * case. Until then we ship a matching skeleton so the route is coherent.
 */
export default function ProjectTracesLoading() {
  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-5 h-9 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="overflow-hidden rounded-xl border tech-border bg-panel">
        <Skeleton className="h-12 w-full rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-none border-t tech-border" />
        ))}
      </div>
    </div>
  );
}
