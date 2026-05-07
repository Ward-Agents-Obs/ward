import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getOrCreateOrg } from "@/lib/org";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { getSessionDetail } from "@/lib/queries/sessions";
import { formatCost, formatLatency, formatNumber } from "@/lib/utils";
import { Waterfall, type WaterfallSpan } from "@/components/traces/waterfall";
import { AttributesTable } from "@/components/traces/attributes-table";
import { buttonVariants } from "@/components/ui/button";

/**
 * Session detail page — the multi-trace counterpart to `/traces/[traceId]`.
 *
 * Shows every span associated with `gen_ai.session.id = {sessionId}` in
 * chronological order, with a waterfall reconstructed from parent/child
 * pointers (sessions can span multiple traces, but parent links only resolve
 * within the same trace; orphans become roots in `<Waterfall>`).
 *
 * V1 scope: aggregate stats + waterfall + per-span attribute drilldown.
 * Doesn't surface a structured prompt/completion timeline (would require
 * cross-span message stitching across providers); per AGENTS.MD §4 we keep
 * the session detail focused and let users drill into each underlying trace
 * if they want the full conversation.
 */
export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const [org, { sessionId }] = await Promise.all([getOrCreateOrg(), params]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  const rawSpans = (await getSessionDetail(org.tenantId, sessionId)) as RawSpan[];
  const spans = rawSpans.map(parseSpan);

  // Aggregates
  const totals = spans.reduce(
    (acc, span) => ({
      cost: acc.cost + (span.cost ?? 0),
      inputTokens: acc.inputTokens + (span.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (span.outputTokens ?? 0),
    }),
    { cost: 0, inputTokens: 0, outputTokens: 0 }
  );
  const totalLatencyMs =
    spans.length > 0
      ? Math.max(...spans.map((s) => s.startMs + s.durationMs)) -
        Math.min(...spans.map((s) => s.startMs))
      : 0;
  const uniqueTraces = new Set(rawSpans.map((s) => s.traceId)).size;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
      <div>
        <Link
          href="/traces?view=sessions"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back to sessions
        </Link>
      </div>

      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / Session detail
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
          Session
        </h1>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {sessionId}
        </p>

        {spans.length > 0 ? (
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Spans" value={formatNumber(spans.length)} />
            <Stat label="Traces" value={formatNumber(uniqueTraces)} />
            <Stat label="Total latency" value={formatLatency(totalLatencyMs)} />
            <Stat
              label="Cost"
              value={totals.cost > 0 ? formatCost(totals.cost) : "—"}
            />
          </dl>
        ) : null}
      </div>

      {spans.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed tech-border bg-panel p-12 text-center">
          <p className="text-sm font-medium text-foreground">
            No spans found for this session.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            The session id may belong to another tenant, or the data may have
            aged out of the retention window.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
            <div className="mb-4">
              <h2 className="text-sm font-medium text-foreground">Span timeline</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                All spans across traces in this session.
              </p>
            </div>
            <Waterfall spans={spans} />
          </section>

          <section className="rounded-[1.5rem] border tech-border bg-panel p-6">
            <div className="mb-4">
              <h2 className="text-sm font-medium text-foreground">Span attributes</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Inspect any span for prompts, completions, and OTel metadata.
                Use the link to open its trace in isolation.
              </p>
            </div>
            <div className="space-y-3">
              {spans.map((span) => (
                <details
                  key={span.spanId}
                  className="rounded-2xl border tech-border bg-background p-4"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-foreground">
                    <span className="truncate">{span.spanName}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatLatency(span.durationMs)}
                    </span>
                  </summary>
                  <div className="mt-4 space-y-4">
                    <Link
                      href={`/traces/${span.traceId}`}
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                    >
                      Open trace
                    </Link>
                    <AttributesTable attributes={span.attributes} />
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers — separate from the trace-detail page so the two surfaces can
// evolve independently. Some duplication is fine here per AGENTS.MD §1
// (correctness > cleverness); a shared helper module is V1.1 work once we
// see how the two pages diverge.
// ---------------------------------------------------------------------------

interface RawSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  spanName: string;
  timestamp: string;
  duration: number;
  attributes?: Record<string, unknown> | null;
  status: string;
  statusMessage?: string | null;
}

interface ParsedSpan extends WaterfallSpan {
  traceId: string;
  attributes: Record<string, unknown> | null;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function parseSpan(raw: RawSpan): ParsedSpan {
  const attrs = raw.attributes ?? null;
  const parsedDate = new Date(String(raw.timestamp).replace(" ", "T") + "Z");
  const startMs = Number.isNaN(parsedDate.getTime())
    ? Date.parse(String(raw.timestamp))
    : parsedDate.getTime();
  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    parentSpanId: raw.parentSpanId || null,
    spanName: raw.spanName,
    startMs,
    durationMs: Number(raw.duration) || 0,
    status: raw.status,
    statusMessage: raw.statusMessage ?? undefined,
    attributes: attrs,
    cost: toNumberOrUndefined(attrs?.["gen_ai.usage.cost"]),
    inputTokens: toIntOrUndefined(attrs?.["gen_ai.usage.input_tokens"]),
    outputTokens: toIntOrUndefined(attrs?.["gen_ai.usage.output_tokens"]),
  };
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toIntOrUndefined(value: unknown): number | undefined {
  const n = toNumberOrUndefined(value);
  return n === undefined ? undefined : Math.trunc(n);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border tech-border bg-background p-4">
      <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}
