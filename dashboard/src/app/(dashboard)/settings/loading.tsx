import { Skeleton } from "@/components/ui/skeleton";

/**
 * Settings page loading state. Mirrors the hero + 2-column (main / aside)
 * layout in `settings/page.tsx`. Prisma org lookup is fast in practice but
 * the skeleton avoids a flash on cold connections.
 */
export default function SettingsLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 lg:px-10 lg:py-10">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-[1.75rem] border tech-border bg-panel p-6">
              <Skeleton className="h-4 w-28" />
              <div className="mt-5 space-y-3">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-2/5" />
              </div>
            </div>
          ))}
        </div>
        <aside className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-[1.75rem] border tech-border bg-panel p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-5 h-9 w-32 rounded-xl" />
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}
