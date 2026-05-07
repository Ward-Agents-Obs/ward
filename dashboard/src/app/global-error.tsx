"use client";

/**
 * Root-level error boundary. Replaces the root layout when active, so it must
 * include its own <html>/<body>. Catches errors that escape the route-group
 * boundaries (e.g. sign-in/auth routes, root layout failures).
 *
 * Per Next.js 16 docs (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md),
 * the recovery prop is `unstable_retry()` — it re-fetches and re-renders the
 * boundary's children. `reset()` only clears state; we want the re-fetch.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Errors forwarded from server components are already redacted in prod.
    // Logging on the client is only useful in dev; drop the digest in prod
    // logs so we have an id to grep server logs by.
    console.error("[ward.global-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
          fontFamily:
            "'SF Pro Display', 'Inter Tight', 'Segoe UI', sans-serif",
          background: "#000",
          color: "#f5f5f5",
        }}
      >
        <div
          style={{
            maxWidth: "32rem",
            width: "100%",
            padding: "2rem",
            border: "1px solid #2a2a2a",
            borderRadius: "1.5rem",
            background: "#0f0f0f",
          }}
        >
          <p
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "#a3a3a3",
              margin: 0,
            }}
          >
            Ward
          </p>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              marginTop: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            Something went wrong loading the dashboard.
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              lineHeight: 1.5,
              color: "#a3a3a3",
              margin: 0,
            }}
          >
            Try again — the cause may have been transient. If it persists,
            include this id when contacting support:{" "}
            <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
              {error.digest ?? "unknown"}
            </code>
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#f5f5f5",
              color: "#000",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
