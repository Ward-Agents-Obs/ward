"use client";

import Link from "next/link";
import type { TraceRow } from "@/lib/queries/traces";
import { formatCost, formatLatency } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Span-level trace table consumed by the (still-mounted-but-unlinked)
 * `/projects/[slug]/traces` route. Migrated to the V1 Table primitives as
 * part of #43 (styling-drift sweep). Behaviour is unchanged from V1.0; only
 * markup + tokens differ. The newer workspace `/traces` page uses
 * `<SpanListTable>` (a different component) — they don't share rendering.
 */
export function TraceTable({
  traces,
  traceHrefBase = "/traces",
}: {
  traces: TraceRow[];
  traceHrefBase?: string;
}) {
  if (traces.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed tech-border bg-panel p-12 text-center">
        <p className="text-sm font-medium text-foreground">No traces yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Install the SDK with the snippet on the Settings page and run one
          instrumented call. Traces appear here within seconds.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Timestamp</TableHead>
          <TableHead>Span</TableHead>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Latency</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {traces.map((trace) => {
          const totalTokens = trace.inputTokens + trace.outputTokens;
          return (
            <TableRow key={trace.spanId}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {new Date(trace.timestamp).toLocaleString()}
              </TableCell>
              <TableCell>
                <Link
                  href={`${traceHrefBase}/${trace.traceId}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {trace.spanName}
                </Link>
              </TableCell>
              <TableCell>
                <span className="rounded bg-background px-2 py-0.5 font-mono text-xs">
                  {trace.model || "—"}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {totalTokens > 0
                  ? `${trace.inputTokens} → ${trace.outputTokens}`
                  : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {trace.cost > 0 ? formatCost(trace.cost) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatLatency(trace.duration)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
