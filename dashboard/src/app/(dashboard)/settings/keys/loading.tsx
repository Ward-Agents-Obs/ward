import { Skeleton } from "@/components/ui/skeleton";

/**
 * API keys loading state. Mirrors `settings/keys/page.tsx`: header row +
 * key table. The Prisma `findMany` is cheap, but the skeleton still pays
 * off the first time after a Prisma cold-start.
 */
export default function ApiKeysLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      <div className="overflow-hidden rounded-xl border tech-border bg-panel">
        <Skeleton className="h-12 w-full rounded-none" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-none border-t tech-border" />
        ))}
      </div>
    </div>
  );
}
