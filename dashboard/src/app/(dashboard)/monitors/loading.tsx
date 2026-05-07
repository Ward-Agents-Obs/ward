import { Skeleton } from "@/components/ui/skeleton";

/**
 * Monitors loading state. Currently mirrors the empty-state landing page;
 * F7 (#18) will replace this with a list-table skeleton once the Prisma
 * Monitor model lands (B7).
 */
export default function MonitorsLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-5 h-9 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      </div>
      <div className="mt-8 rounded-[2rem] border tech-border bg-panel p-12">
        <Skeleton className="mx-auto h-12 w-12 rounded-2xl" />
        <Skeleton className="mx-auto mt-5 h-5 w-48" />
        <Skeleton className="mx-auto mt-2 h-4 w-72" />
      </div>
    </main>
  );
}
