# Monitors Implementation Risks (#14–#17)

**For:** backend, before starting #15. **From:** architect, 2026-05-07.

Three integration points most likely to ship subtle bugs:

1. **State-transition race** (#16). Two overlapping cron runs both observe `state='ok' AND breached=true` and both insert MonitorTrigger rows + flip state. Fix: wrap per-monitor eval in `prisma.$transaction` + `SELECT ... FOR UPDATE` on the Monitor row, OR take a Postgres advisory lock on `monitor.id`. Vercel Cron + local `pnpm worker:monitors` can coexist — don't assume singleton.

2. **Window-boundary drift** (#16 ↔ #17). Preview and worker MUST compute identical windows for identical `(metric, windowMinutes, env, model)`. Floor-to-minute mismatch → user sees one value at create-time, another at fire-time. Fix: one `buildMetricQuery()` in a shared module, imported by both routes.

3. **Allowlist drift** (#14/#15/#16/#17). zod enum, worker allowlist, preview allowlist must agree. Define `MONITOR_METRICS`, `MONITOR_COMPARATORS`, `MONITOR_WINDOWS_MIN` as `const` in one module; import everywhere. Drift = accept-on-create / error-on-eval.
