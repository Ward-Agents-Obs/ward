"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Conditional 30-second poller for the firing-monitor banner.
 *
 * Per `.agents/monitors-design.md` §4 (refresh strategy): this component is
 * mounted ONLY inside the banner's conditional render. When zero monitors
 * are firing the banner doesn't render and this component never mounts, so
 * idle dashboards do not poll. When the banner is visible the poller fires
 * `router.refresh()` every 30s so resolutions (firing → ok) appear within
 * ~30s without a real-time push channel (Realtime / SSE deferred to V1.1+).
 *
 * The "user is idle when a *new* monitor starts firing" case is accepted as
 * V1 — the layout re-renders on next navigation and the banner appears.
 * Polling forever for an event that may never happen is wasteful.
 */
export function BannerRefresher({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const handle = setInterval(() => {
      // router.refresh() re-runs the server components for the current route,
      // which re-queries `getFiringMonitorCount()` and re-evaluates whether
      // the banner should still render.
      router.refresh();
    }, intervalMs);
    return () => clearInterval(handle);
  }, [router, intervalMs]);

  return null;
}
