import { getOrCreateOrg } from "@/lib/org";
import { getSessionDetail } from "@/lib/queries/sessions";
import { TenantContextFallback } from "@/components/tenant-context-fallback";
import { formatLatency } from "@/lib/utils";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ traceId: string }>;
}) {
  const [org, { traceId: sessionId }] = await Promise.all([getOrCreateOrg(), params]);
  if (!org?.tenantId) {
    return <TenantContextFallback />;
  }

  const spans = await getSessionDetail(org.tenantId, sessionId);

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border tech-border bg-panel p-8">
        <span className="inline-flex rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Ward / Session Detail
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">Session detail</h1>
        <p className="mt-2 font-mono text-sm text-muted-foreground">{sessionId}</p>
      </div>

      {(spans as Record<string, unknown>[]).length === 0 ? (
        <div className="rounded-[2rem] border tech-border bg-panel p-12 text-center text-muted-foreground">
          No spans found for this session.
        </div>
      ) : (
        <div className="space-y-3">
          {(spans as Record<string, unknown>[]).map((span: Record<string, unknown>, index: number) => (
            <div key={index} className="rounded-[1.5rem] border tech-border bg-panel p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{span.spanName as string}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(span.timestamp as string).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-background px-3 py-1 text-xs font-mono text-foreground">
                  {formatLatency(span.duration as number)}
                </span>
              </div>
              {span.attributes != null && typeof span.attributes === "object" ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Attributes
                  </summary>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-background p-4 text-xs text-foreground">
                    {JSON.stringify(span.attributes, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
