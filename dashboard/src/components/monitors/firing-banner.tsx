import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getFiringMonitorCount } from "@/lib/monitors-server";
import { BannerRefresher } from "./banner-refresher";

/**
 * Sticky firing-monitor banner. Server component — re-queries Postgres on
 * every render of the dashboard layout (the layout is already dynamic via
 * `getCurrentUser` + `getOrCreateOrg`), and mounts a 30-second polling
 * client refresher only when at least one monitor is firing.
 *
 * Spec: `.agents/monitors-design.md` §4 (refresh strategy revised
 * 2026-05-07: no cache tags, no `revalidateTag`, conditional polling
 * scoped inside the banner subtree).
 *
 * Render contract:
 *  - count === 0 → returns `null`. The banner doesn't render, the refresher
 *    isn't mounted, idle dashboards stay silent.
 *  - count >= 1  → renders the destructive banner + refresher. Click takes
 *    the user to `/monitors?status=firing` to triage.
 *
 * Sticky and non-dismissible by spec — dismiss-per-tenant requires an ack
 * model that's deferred to V1.1+.
 */
export async function FiringBanner({ orgId }: { orgId: string }) {
  const count = await getFiringMonitorCount(orgId);
  if (count === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-destructive/40 bg-destructive/10 px-6 py-3 text-destructive backdrop-blur"
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="truncate text-sm font-medium">
          {count} monitor{count === 1 ? "" : "s"} firing
        </p>
      </div>
      <Link
        href="/monitors?status=firing"
        className="shrink-0 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Review →
      </Link>
      <BannerRefresher intervalMs={30_000} />
    </div>
  );
}
