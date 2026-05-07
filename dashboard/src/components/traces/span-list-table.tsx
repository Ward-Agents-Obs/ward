import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { SpanRow } from "@/lib/queries/traces";
import { formatCost, formatLatency, formatNumber } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * One row per top-level GenAI span. Drives the `?view=list` mode of `/traces`.
 *
 * Server component (no `"use client"`) — pure presentation that takes already
 * tenant-scoped data from `getSpans()` and renders. Click on the span name
 * navigates to the trace detail page (`/traces/[traceId]`).
 *
 * Empty state lives at the page level so it can render the SDK onboarding
 * copy when there are no spans for the entire tenant; here we only render
 * when the caller has rows in hand.
 */
export function SpanListTable({ spans }: { spans: SpanRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Timestamp</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Environment</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Latency</TableHead>
          <TableHead>Trace</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {spans.map((span) => {
          const isError = span.status === "Error";
          const totalTokens = span.inputTokens + span.outputTokens;
          return (
            <TableRow key={span.spanId}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {new Date(span.timestamp).toLocaleString()}
              </TableCell>
              <TableCell>
                <span className="rounded bg-background px-2 py-0.5 font-mono text-xs">
                  {span.model || "—"}
                </span>
              </TableCell>
              <TableCell>
                <StatusPill status={span.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {span.environment || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {totalTokens > 0
                  ? `${formatNumber(span.inputTokens)} → ${formatNumber(span.outputTokens)}`
                  : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {span.cost > 0 ? formatCost(span.cost) : "—"}
              </TableCell>
              <TableCell
                className={
                  "text-right tabular-nums" + (isError ? " text-destructive" : "")
                }
              >
                {formatLatency(span.latencyMs)}
              </TableCell>
              <TableCell>
                <Link
                  href={`/traces/${span.traceId}`}
                  className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:underline"
                  title={span.traceId}
                >
                  {span.traceId.slice(0, 12)}…
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "Error") {
    return (
      <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        Error
      </span>
    );
  }
  // ClickHouse stores OK as "Unset" or "Ok" depending on the OTel SDK; both
  // mean "no error reported", so we collapse them under one label.
  return (
    <span className="inline-flex items-center rounded-full border tech-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Ok
    </span>
  );
}
