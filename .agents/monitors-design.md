# Monitors — V1 Design

Owner: architect · Depends on: `.agents/v1-scope.md` · Date: 2026-05-06

## Goal

Let a tenant define rules of the form "alert me when **metric** for my LLM calls **comparator** **threshold** over the last **window**, optionally filtered by **scope**." Surface firing monitors in the dashboard. Track history. Don't ship anything fancy.

This is **not** Traceloop's evaluator-grade monitoring. We're shipping threshold monitors over already-collected ClickHouse metrics. Custom evals come later.

---

## 1. Scope

### V1 metrics (3)
| Metric key | Definition | ClickHouse expression |
|---|---|---|
| `cost` | Total cost of matching spans in window | `sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']))` |
| `latency_p95` | p95 of span Duration in window (ms) | `quantile(0.95)(Duration) / 1000000` |
| `error_rate` | Errors / total in window (0..1) | `countIf(StatusCode = 'Error') / count()` |

That's it. No quality, no token-rate, no custom eval. Three metrics covers ~80% of "the thing broke" alerts.

### V1 comparators
`>`, `>=`, `<`, `<=`. No equality (noisy on continuous values).

### V1 windows
Fixed set: `5m`, `15m`, `1h`, `6h`, `24h`. No custom intervals.

### V1 scope filters (optional)
- `environment` (e.g., `production`, `staging`) — single value, or null = all
- `model` (e.g., `gpt-4o`, `claude-3-5-sonnet`) — single value, or null = all

No regex, no JSON-key extraction, no workflow names, no sample rates. Punt all of it.

### V1 limits
- Max **10 monitors per tenant.** Hard cap, return 422 on create.
- Min window = 5m (avoid hammering ClickHouse).

### Not in V1
- Custom evaluator monitors
- Monitors over span attributes other than the three metrics above
- Multi-condition (AND/OR) monitors
- Anomaly / trend monitors (e.g. "2x baseline")
- Slack, PagerDuty, webhooks
- Per-monitor recipient list (V1 = all org members see in-app banner)

---

## 2. Data model (Prisma, Postgres)

Add to `dashboard/prisma/schema.prisma`:

```prisma
model Monitor {
  id            String   @id @default(uuid())
  orgId         String   @map("org_id")
  org           Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  name          String
  description   String?
  metric        String   // 'cost' | 'latency_p95' | 'error_rate'
  comparator    String   // 'gt' | 'gte' | 'lt' | 'lte'
  threshold     Float
  windowMinutes Int      @map("window_minutes")  // 5, 15, 60, 360, 1440
  environment   String?  // null = all envs
  model         String?  // null = all models
  enabled       Boolean  @default(true)
  state         String   @default("ok")          // 'ok' | 'firing'
  lastEvaluatedAt DateTime? @map("last_evaluated_at")
  lastValue     Float?   @map("last_value")
  createdBy     String?  @map("created_by")      // auth_user_id
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  triggers      MonitorTrigger[]

  @@index([orgId, state])
  @@map("monitors")
}

model MonitorTrigger {
  id          String   @id @default(uuid())
  monitorId   String   @map("monitor_id")
  monitor     Monitor  @relation(fields: [monitorId], references: [id], onDelete: Cascade)
  firedAt     DateTime @default(now()) @map("fired_at")
  resolvedAt  DateTime? @map("resolved_at")
  triggerValue Float   @map("trigger_value")
  threshold   Float
  comparator  String

  @@index([monitorId, firedAt])
  @@map("monitor_triggers")
}
```

Add to `Organization`:
```prisma
monitors    Monitor[]
```

### Why this shape

- **One row per monitor**, not per fire. `state` field tracks current status; `triggers` table tracks history. This makes "monitor list page" a single Prisma query and "monitor detail" trivially indexed.
- **`state` rather than computed-from-history**: makes "show banner if any monitor firing" a single `count where state='firing'` instead of a join.
- **`environment` and `model` nullable**: V1 supports unscoped or single-scope; widening to lists later means a join table, not a column change.
- **`orgId`, not `tenantId`**: Postgres entity, reachable via `org → tenantId` for ClickHouse queries. Tenant id is for the data plane; org id is for the control plane. Keep them on opposite sides of the boundary.
- **`createdBy` nullable** because we don't currently track auth_user_id on org-scoped writes. Frontend should pass it; if missing, leave null.
- **Index `[orgId, state]`** chosen over `[orgId, enabled]` because the hottest read is the banner's `count(orgId, state='firing')` — fires on every dashboard render plus every 30s poll from the F10 polling refresher. The list page's status filter chip (`state in {firing, ok}` plus disabled-via-`enabled=false`) also benefits from this index. The cron worker's `WHERE enabled = true` query (every 5min, all orgs) is fine on a sequential scan at V1 cardinality (≤10 monitors/org × small N orgs); add a partial index `WHERE enabled = true` later if it matters.
- **`metric`, `comparator`, `windowMinutes` are `String`/`Int` not Prisma enums**: enum migrations are painful when we widen the allowlist (add `latency_p99`, `8h` window, etc.). zod at the action layer (§5) is the source of truth. Trade-off accepted.

### Migration

`npx prisma migrate dev --name add_monitors`. Backfill: none (new tables, no data).

---

## 3. Evaluation strategy

### Decision: **cron worker.** Reject on-write and ClickHouse MV.

| Option | Verdict | Why |
|---|---|---|
| **On-write (in OTel collector pipeline)** | ✗ | Requires a custom collector processor + state somewhere; collector is not the place for tenant business logic. |
| **ClickHouse materialized view + ALERT** | ✗ | ClickHouse has no native alert dispatch. Would need a polling job anyway. MV would only optimize the read query — premature for V1 cardinality. |
| **Cron worker (poll ClickHouse + write Postgres)** | ✓ | Matches existing dashboard topology. Postgres is already the control-plane store. Worker code is ~200 lines, easy to test, easy to scale later. |

### Worker shape

A Next.js route handler triggered by an external cron (`/api/cron/evaluate-monitors`), authenticated by a shared secret header (`x-cron-token`). For dev, a `pnpm run worker:monitors` script. For prod, Vercel Cron or a small EC2 cron job.

```ts
// pseudo
async function evaluateMonitors() {
  const monitors = await prisma.monitor.findMany({
    where: { enabled: true },
    include: { org: true },
  });
  for (const m of monitors) {
    const value = await queryClickHouse(m); // tenant-scoped via m.org.tenantId
    const breached = compare(value, m.comparator, m.threshold);
    await reconcile(m, value, breached); // updates state, writes MonitorTrigger on transitions
  }
}
```

**Cadence:** every 5 minutes. Window is per-monitor; we recompute on each tick regardless of window length. (5m windows refresh constantly; 24h windows are sliding 24h every 5min — fine.)

**Per-monitor cost ceiling:** with ≤10 monitors × ≤(say) 100 tenants × 1 ClickHouse query each = 1k queries / 5min = ~3 qps. ClickHouse will not notice.

**State machine:**
- Currently `ok`, breached now → set `state=firing`, insert `MonitorTrigger {firedAt: now, resolvedAt: null}`, fire notification.
- Currently `firing`, still breached → no-op (one event per fire window). Do not re-notify.
- Currently `firing`, no longer breached → set `state=ok`, update most recent `MonitorTrigger.resolvedAt = now`.
- Always update `lastEvaluatedAt` and `lastValue`.

### Tenant safety in the worker

Each query is built with the monitor's org's `tenantId`, parameterised:

```sql
SELECT {METRIC_EXPR} AS value
FROM otel_traces
WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
  AND Timestamp >= now() - INTERVAL {window:UInt32} MINUTE
  {ENV_FILTER}
  {MODEL_FILTER}
```

The worker constructs `METRIC_EXPR`, `ENV_FILTER`, `MODEL_FILTER` from a fixed allowlist. **Never interpolate user input.** Acceptance test: backend should add a unit test that supplying `metric='cost; DROP TABLE'` is rejected at validation time before the SQL is built.

---

## 4. Notification channel for V1

### Decision (locked by team-lead 2026-05-07): **in-app banner only.**

No email in V1, not even as a stretch goal. Backend will not write any notification-delivery code beyond the banner data path. Reasoning:

- We have no SMTP infra wired. Supabase auth's SMTP is for magic links, not arbitrary mail. SES needs DNS + verification + AWS access. None of that is V1 work.
- The dashboard is the user's primary surface for V1 (demo product, not a 24/7 ops tool).
- A persistent red banner across all dashboard pages when something is firing is loud enough.

### Banner spec
- Rendered in `(dashboard)/layout.tsx` above the main content area.
- Server component; queries `prisma.monitor.count({ where: { orgId, state: 'firing' }})`.
- If count > 0: `🚨 N monitor(s) firing — Review` with link to `/monitors?status=firing`.
- Sticky, not dismissible (dismiss-per-tenant requires a separate ack model, deferred).
- **Refresh strategy (revised 2026-05-07 after debug-expert audit + team-lead refinement):** the dashboard's queries do not use `unstable_cache` / tag-based caching anywhere, so `revalidateTag` would have nothing to invalidate. Instead:
  - The layout is already dynamically rendered (it calls `getCurrentUser()` + `getOrCreateOrg()`), so the banner re-queries Postgres on every page navigation — fresh by default.
  - **Conditional polling** (team-lead refinement): the `<MonitorBannerRefresher />` client component lives *inside* the banner's conditional render. When `count === 0` the banner does NOT render, the refresher is NOT mounted, **no polling happens at all** — idle dashboards stay completely quiet. When `count > 0` the banner mounts, the refresher mounts, and `router.refresh()` fires every 30 seconds so resolutions (firing → ok) are visible within ~30s.
  - The "user idle on a page when a NEW fire happens" case is accepted: the layout re-renders on next nav, and they'll see the banner then. We do not run a heartbeat for the idle-no-fires case — polling forever for an event that may never happen is wasteful.
  - When state flips from 0 → N during a layout re-render (any nav), the refresher mounts fresh; React's reconciliation handles this naturally — no explicit `key` needed because the entire banner subtree is conditionally rendered.
  - Cron worker (B9) **does not** call `revalidateTag` or `revalidatePath`. State lives in Postgres; banner reads Postgres on render. No cache layer to invalidate.

This is a deliberate V1 punt on real-time push (Supabase Realtime / SSE / WebSocket). Banner is **eventually consistent within ~30s** of a state transition once a fire is active, and **eventually consistent on next-navigation** for an idle-no-fires dashboard. Both bounds are well within "demo good enough" for monitor windows of 5min minimum.

### V1.1+ (out of V1 scope, do not build)
- **Email alerts** — would need an `OrgSettings.alertEmail` field, SES (or equivalent) integration, suppress/unsubscribe handling. Explicitly out of V1.
- **Slack / PagerDuty / webhook channels** — out of V1.
- **Per-monitor recipient lists** — out of V1.
- **Mute / silence / acknowledge** — out of V1; banner is sticky-while-firing, period.

These are noted so backend's #16 (cron worker) stays tight: no SMTP, no email templates, no third-party HTTP clients in the worker. State transitions + Postgres writes + `revalidateTag` only.

---

## 5. API surface

All routes under `dashboard/src/app/(dashboard)/monitors/` and `dashboard/src/app/api/monitors/` use `getOrCreateOrg()` for auth/tenant scoping. Server actions for mutations.

| Route / Action | Method | Returns / Effect |
|---|---|---|
| `/monitors` (page) | GET | List page; `prisma.monitor.findMany({ where: { orgId } })` |
| `/monitors/[id]` (page) | GET | Detail page; monitor + last 50 triggers + last 24h metric chart |
| `createMonitor(input)` (action) | mutation | Validates, enforces ≤10 cap, inserts, returns id |
| `updateMonitor(id, input)` (action) | mutation | Validates, scope-checks `monitor.orgId === currentOrg.id` |
| `deleteMonitor(id)` (action) | mutation | Scope-check, cascade deletes triggers |
| `toggleMonitor(id, enabled)` (action) | mutation | Scope-check, toggles enabled |
| `/api/cron/evaluate-monitors` (route) | POST | Header-authed (`x-cron-token`), evaluates all enabled monitors, returns summary |

### Validation (`zod`)

```ts
const MonitorInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  metric: z.enum(['cost', 'latency_p95', 'error_rate']),
  comparator: z.enum(['gt', 'gte', 'lt', 'lte']),
  threshold: z.number().finite(),
  windowMinutes: z.union([z.literal(5), z.literal(15), z.literal(60), z.literal(360), z.literal(1440)]),
  environment: z.string().max(40).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
});
```

---

## 6. UI sketch

### `/monitors` (list page)
- Header: "Monitors" + count + "Create monitor" button → opens modal.
- Filter chips: status (all / firing / ok / disabled).
- Table columns:
  - **Status dot** (red firing / green ok / grey disabled)
  - **Name**
  - **Condition** ("p95 latency > 1500ms over 15m")
  - **Scope** ("production · gpt-4o" or "all envs · all models")
  - **Last value** (numeric, color-coded vs threshold)
  - **Last evaluated** (relative time)
  - Row click → detail page; row kebab → enable/disable, edit, delete.
- Empty state: "No monitors yet. Create one to get notified when costs spike or latency degrades." with primary CTA.

### Create/Edit modal
Sheet or dialog. Form:
1. **Name** (required, 80 chars)
2. **Description** (optional, 280 chars, helper text "Notes for your team")
3. **Metric** (segmented control: Cost · p95 latency · Error rate)
4. **Comparator + Threshold** ("greater than", "less than", etc. + numeric input; unit hint based on metric — `$`, `ms`, `%`)
5. **Window** (segmented: 5m · 15m · 1h · 6h · 24h)
6. **Scope** (collapsible "Filters" section): environment select (populated from `getDistinctEnvironments`), model select (from `getDistinctModels`). Both optional.
7. **Preview** (live-fetched on field change, debounced 500ms): shows the current value of the metric over the window — gives the user immediate sense of "is my threshold realistic?". One ClickHouse query, tenant-scoped.
8. Footer: Cancel · Create / Save.

### `/monitors/[id]` (detail page)
- Header: name + status pill + condition string + Edit / Delete / Toggle.
- Card: condition restated; current value vs threshold with delta.
- Chart: line of metric value over last 24h (from ClickHouse, tenant-scoped, same expression as eval), with horizontal threshold line. Red shaded regions where breached.
- Section: "Trigger history" table — Fired at · Resolved at (or "still firing") · Peak value · Duration.
- Section: "Recent matching spans" — links into `/traces` filtered by env/model/window of last fire.

### Banner (global)
Rendered in `(dashboard)/layout.tsx`. See §4.

---

## 7. Tenant isolation checklist

- [ ] All Prisma reads/writes scoped by `orgId`.
- [ ] All ClickHouse reads scoped by `tenantId` via `requireTenantId()`.
- [ ] Cron worker resolves `tenantId` per monitor from `monitor.org.tenantId`.
- [ ] Mutation actions verify `monitor.orgId === currentOrg.id` before update/delete (no IDOR).
- [ ] No `tenantId` accepted from request body — always derived from session.
- [ ] Cron endpoint requires `x-cron-token` matching `process.env.CRON_SECRET`.

---

## 8. Risks and follow-ups

- **Time-zone drift in windows.** ClickHouse `now()` is UTC. We rely on it. Fine.
- **Worker missed runs.** If cron is down for 30min, we just resume — no catch-up. State eventually-correct. Acceptable.
- **Banner staleness.** Server component + cache tag should keep it within ~5min of truth, matching cron cadence. Don't over-engineer.
- **Threshold tuning.** No "auto-suggest" in V1. The Preview field in the modal is the entire UX for "what should I set?". Document this.
- **Per-org notification fan-out.** V1 = banner is per-org-implicit (every member sees it). When email lands, we'll need an `OrgSettings` table.

---

## 9. Implementation tasks

Tasks I'll create on top of the V1 batch (#5–#11):

### Backend
- **B7 — Add Monitor + MonitorTrigger Prisma models, migrate.** Per §2. Acceptance: `npx prisma migrate dev` runs clean; `Organization → monitors` relation works; cascade delete tested.
- **B8 — Server actions: create/update/delete/toggle monitor.** Per §5 + zod schema. Org-scoped, idempotent, ≤10 cap. Acceptance: actions reject cross-org IDOR (test included).
- **B9 — Monitor evaluation worker (cron route).** Per §3 state machine. `POST /api/cron/evaluate-monitors`, `x-cron-token` auth. Acceptance: unit test for state transitions (ok→firing, firing→firing no-op, firing→ok); SQL injection test for metric/comparator/scope inputs.
- **B10 — Tenant-scoped Monitor preview query.** `previewMetric(tenantId, { metric, window, env, model })` for the create modal. Same allowlist as worker.

### Frontend
- **F7 — Monitors list page (`/monitors`).** Per §6 list spec. Status filter, table, kebab menu, empty state. Blocked by B7 + B8.
- **F8 — Create/Edit Monitor modal.** Per §6 modal spec. zod-validated form, live preview (debounced 500ms via B10), accessible. Blocked by B7 + B8 + B10.
- **F9 — Monitor detail page (`/monitors/[id]`).** Per §6 detail spec. Threshold-line chart, trigger history table. Blocked by B7.
- **F10 — Firing-monitor banner in dashboard layout.** Per §4 banner spec. Server component, cache-tagged. Blocked by B7.

Acceptance criteria carry forward from §V1 doc: every async path goes through `getOrCreateOrg() + requireTenantId()`; every mutation validates input + checks org ownership.
