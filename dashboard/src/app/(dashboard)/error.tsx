"use client";

/**
 * Dashboard route-group error boundary. Wraps every page under
 * `app/(dashboard)/` (overview, traces, costs, monitors, settings, projects)
 * so a thrown error during render — typically a ClickHouse or Prisma
 * connectivity issue — surfaces as a recoverable card instead of a blank page.
 *
 * Recovery uses `unstable_retry()` (Next.js 16.2+) which re-fetches and
 * re-renders the boundary's children, vs `reset()` which only clears state.
 * For our case (transient DB failures), retry is the right default.
 *
 * Note: this boundary does NOT cover the root `app/layout.tsx` or the
 * `(dashboard)/layout.tsx` itself — failures in those bubble to
 * `app/global-error.tsx`.
 */
import { useEffect } from "react";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The digest is the join key with server logs in production; the message
    // is only the original error in development.
    console.error("[ward.dashboard-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-12 lg:px-10 lg:py-16">
      <div className="rounded-[2rem] border tech-border bg-panel p-8 shadow-sm">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-destructive">
          Ward / Error
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
          We hit a snag rendering this page.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          This usually clears on a retry. If it keeps happening, include the
          reference id when contacting support so we can match it to server
          logs.
        </p>

        <dl className="mt-6 rounded-2xl border tech-border bg-background p-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Reference id
            </dt>
            <dd className="font-mono text-xs text-foreground">
              {error.digest ?? "unknown"}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
          >
            Try again
          </button>
          <a
            href="/overview"
            className="inline-flex items-center rounded-xl border tech-border bg-panel px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-hover"
          >
            Back to Overview
          </a>
        </div>
      </div>
    </main>
  );
}
