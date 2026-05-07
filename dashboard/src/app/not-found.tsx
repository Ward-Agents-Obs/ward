import Link from "next/link";

/**
 * Root 404. Shown when a route doesn't match or a server component calls
 * `notFound()`. Kept stand-alone (no dashboard layout) so it works for both
 * authenticated and anonymous users — middleware redirects anonymous users
 * away from protected routes before the page resolves anyway.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md rounded-[2rem] border tech-border bg-panel p-8 text-center shadow-sm">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / 404
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          We couldn&apos;t find what you were looking for. The link may be out
          of date or the resource may have been removed.
        </p>
        <Link
          href="/overview"
          className="mt-6 inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent-hover"
        >
          Back to Overview
        </Link>
      </div>
    </main>
  );
}
