import { cn, formatLatency } from "@/lib/utils";

/**
 * Span waterfall. Reconstructs the parent/child tree from `parentSpanId`
 * pointers and renders one row per span with a horizontal bar showing its
 * (start-offset, duration) within the trace's wall-clock window.
 *
 * Server component — pure presentation. The caller owns parsing the raw
 * `getTraceDetail()` rows into the shape this component expects.
 */

export interface WaterfallSpan {
  spanId: string;
  parentSpanId: string | null;
  spanName: string;
  /** Epoch milliseconds. */
  startMs: number;
  /** Duration in ms. */
  durationMs: number;
  status: string;
  statusMessage?: string;
}

interface WaterfallProps {
  spans: WaterfallSpan[];
}

interface TreeNode {
  span: WaterfallSpan;
  depth: number;
}

/**
 * Build a flat depth-first traversal of the span tree so that children are
 * rendered immediately under their parent with the right indentation.
 * Orphans (parent missing in this trace, common when ParentSpanId points at
 * a span outside the queried tenant scope) become roots.
 */
function flatten(spans: WaterfallSpan[]): TreeNode[] {
  if (spans.length === 0) return [];
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const childrenOf = new Map<string | null, WaterfallSpan[]>();

  for (const span of spans) {
    const parentId =
      span.parentSpanId && byId.has(span.parentSpanId) ? span.parentSpanId : null;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId)!.push(span);
  }

  // Sort each sibling group by start time so the timeline reads left-to-right.
  for (const [, kids] of childrenOf) {
    kids.sort((a, b) => a.startMs - b.startMs);
  }

  const out: TreeNode[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const kids = childrenOf.get(parentId);
    if (!kids) return;
    for (const span of kids) {
      out.push({ span, depth });
      visit(span.spanId, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export function Waterfall({ spans }: WaterfallProps) {
  if (spans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No spans found for this trace.</p>
    );
  }

  const traceStart = Math.min(...spans.map((s) => s.startMs));
  const traceEnd = Math.max(...spans.map((s) => s.startMs + s.durationMs));
  const total = Math.max(1, traceEnd - traceStart); // guard against div-by-zero

  const ordered = flatten(spans);

  return (
    <div className="space-y-1.5">
      {ordered.map(({ span, depth }) => {
        const startPct = ((span.startMs - traceStart) / total) * 100;
        const widthPct = Math.max(0.5, (span.durationMs / total) * 100);
        const isError = span.status === "Error";
        return (
          <div
            key={span.spanId}
            className="grid items-center gap-3 text-xs"
            style={{ gridTemplateColumns: "minmax(10rem, 16rem) 1fr 5rem" }}
          >
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: `${depth * 12}px` }}
            >
              {depth > 0 ? (
                <span
                  aria-hidden="true"
                  className="h-px w-2 shrink-0 bg-[color:var(--border)]"
                />
              ) : null}
              <span
                className={cn(
                  "truncate font-medium",
                  isError ? "text-destructive" : "text-foreground"
                )}
                title={span.statusMessage || span.spanName}
              >
                {span.spanName}
              </span>
            </div>
            <div className="relative h-4 overflow-hidden rounded bg-background">
              <div
                style={{
                  marginLeft: `${startPct}%`,
                  width: `${widthPct}%`,
                  background: isError ? "var(--destructive)" : "#22d3ee",
                }}
                className={cn("h-full opacity-80")}
                aria-label={`${span.spanName} ${formatLatency(span.durationMs)}`}
              />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">
              {formatLatency(span.durationMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
