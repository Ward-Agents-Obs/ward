import { Skeleton } from "@/components/ui/skeleton";

/**
 * Monitors list loading state. Mirrors the rebuilt page layout (hero with
 * Create CTA + status filter chips + table) so layout-shift on hydration
 * is minimal. Once backend's #14 lands the real Prisma query the table
 * skeleton row count can be tuned to a typical-tenant count, but 5 is a
 * reasonable median.
 */
export default function MonitorsLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-5 h-9 w-40" />
            <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
          </div>
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-10 w-72 rounded-xl" />
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="overflow-hidden rounded-xl border tech-border bg-panel">
        <Skeleton className="h-12 w-full rounded-none" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-14 w-full rounded-none border-t tech-border"
          />
        ))}
      </div>
    </main>
  );
}
