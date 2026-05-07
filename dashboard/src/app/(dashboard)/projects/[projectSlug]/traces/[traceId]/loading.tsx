import { Skeleton } from "@/components/ui/skeleton";

/**
 * Project trace detail loading state. Mirrors the span card list. Will
 * be retired alongside the project trace surface in F2 (#11).
 */
export default function ProjectTraceDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-5 h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-72" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[1.5rem] border tech-border bg-panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-4 w-1/4" />
              </div>
              <Skeleton className="h-7 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
