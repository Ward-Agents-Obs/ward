# Ward V1 Scope — Architect's Audit

Owner: architect · Status: draft · Date: 2026-05-06

## TL;DR

The plumbing is real. The chrome is fake. End-to-end tenant isolation is wired through SDK → gateway → ClickHouse → dashboard queries, but the dashboard's *navigation surface* and the `/overview` page show **hardcoded seed projects** with no backing entity. There is no `Project` model, no Monitors feature, and the only "real" pages are Traces and per-project Dashboard. V1 is about turning the plumbing into a coherent product on three pages — **Overview**, **Tracing**, **Monitors** — and removing seed data masquerading as real state.

---

## 1. What is actually wired vs. hardcoded

### Wired correctly (don't break it)

- **SDK → Gateway → Collector → ClickHouse** OTLP path. `gateway/internal/auth/auth.go` looks up API key in Redis (`apikey:<sha256>` → tenant_id), `gateway/internal/proxy/proxy.go` `injectTenant()` rewrites OTLP resource attrs with `ward.tenant_id` before forwarding. Gateway forbids unauthenticated `/v1/traces`.
- **Dashboard tenant scoping.** All ClickHouse queries (`dashboard/src/lib/queries/{overview,traces,sessions,costs}.ts`) take a `tenantId` arg and pass it via `requireTenantId()` + parameterised query. No raw string interpolation of tenant id, no leakage paths I can see.
- **Org auto-provisioning.** `dashboard/src/lib/org.ts:getOrCreateOrg()` provisions an Organization + OrgMember + tenantId on first sign-in. Tenant id is `tenant_<16-hex>`, unique per org. Good.
- **API key model.** `prisma/schema.prisma` stores `keyHash` only (sha256), `keyPrefix` for display. Matches gateway lookup. ApiKey is org-scoped via `orgId`.
- **GenAI conventions.** SDK emits `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cost`, `gen_ai.session.id`, plus `deployment.environment`. Cost is calculated SDK-side via `pricing.py`.

### Hardcoded / fake (must change for V1)

| Where | What's fake | Impact |
|---|---|---|
| `dashboard/src/app/(dashboard)/overview/page.tsx` | Renders `getWorkspaceProjects()` — a static list of three projects (`projectname`, `support-copilot`, `eval-lab`). No DB lookup. | The "Overview" page is a fake project picker, not an observability overview. User correctly perceives this as "hardcoded". |
| `dashboard/src/lib/projects.ts` | `getWorkspaceProjects()` returns three hardcoded projects. `getProjectDisplayName()` does title-case fallback. There is **no `Project` model in Prisma**. | Project URLs (`/projects/<slug>`) work for any slug because there's no validation. Sidebar/breadcrumbs show fabricated names. |
| `dashboard/src/components/sidebar.tsx` | Workspace nav links to `/monitors` and `/wardbugger` which **do not exist as routes**. Project nav links to `/projects/<slug>/{monitors,datasets,playground,experiments,ab-tests,evals,prompts}` — all of which fall through to a "Coming soon" placeholder. | UX-breaking: clicks lead to dead pages. |
| `dashboard/src/app/(dashboard)/projects/[projectSlug]/[feature]/page.tsx` | Catch-all renders "Coming soon" for every feature. | Confirmed. |
| `dashboard/src/app/(dashboard)/projects/[projectSlug]/page.tsx` | Project Dashboard shows `getOverviewMetrics(org.tenantId)` — i.e. **org-wide** metrics labeled as project metrics. The "Daily cost / Token usage / Median latency" cards are placeholder divs that say "No data yet" even when there's data. | Project shell exists but doesn't actually scope by project — there is no project to scope by. |
| `dashboard/src/components/sdk-onboarding.tsx` | Onboarding hardcodes `otlpEndpoint = process.env.NODE_ENV === "production" ? "https://api.ward.dev/v1/otlp" : "http://localhost:4318"`. Header is `x-api-key` but gateway expects `Authorization: Bearer <key>`. | Copy-paste sample won't work — wrong header name. |
| `dashboard/src/app/(dashboard)/traces/page.tsx` | Workspace-level Traces actually queries **sessions**, not spans. Confusing — sessions and traces are conflated. | UX inconsistency. Project-level Traces (`/projects/<slug>/traces`) shows raw spans. |
| `setup_test_environment.sh`, `scripts/*` | Scripts seed Redis directly with `apikey:<hash>` for tenant tokens to demo the pipeline. Fine for dev, but documented as the only path. | Acceptable for V1; flag for cleanup. |

---

## 2. What V1 ships

V1 = the user can sign up, copy a working SDK snippet, see traces, see one health overview, and create one monitor that fires on threshold breach. Nothing more.

### V1.A — Tenant chrome cleanup (foundations)
1. **Delete fake project picker** on `/overview`. Replace with a real overview (see V1.B).
2. **Drop project routing from V1 nav.** `/projects/[slug]/*` is hidden behind a feature flag (or simply removed from sidebar). The project shell stays in the codebase but is not surfaced. V1 is **single-org, no projects**. Add `Project` model later when the user actually needs it.
3. **Sidebar** shows only routes that exist: `/overview`, `/traces`, `/monitors`, `/settings`. Remove `/wardbugger` and the entire "Workbench" project group from V1.
4. **Fix SDK onboarding snippet** to use `Authorization: Bearer <key>` header (matching gateway), and source `otlpEndpoint` from a single config constant (`dashboard-config.ts`) rather than inline ternaries.

### V1.B — Overview page (real)
Replace `/overview` with a tenant-scoped health snapshot. Inspired by Traceloop's dashboard but scoped to what we actually have:
- **Header:** workspace name, time-range picker (1h / 24h / 7d / 30d, default 24h), environment filter (populated from distinct values).
- **Top stats row (4 cards):** Total spans, Total cost, Avg latency, Error rate. Compare vs. previous window (delta arrow).
- **Charts row:**
  - Spans-over-time (stacked by model) — line/area
  - Cost-over-time — line
  - Latency p50/p95/p99 — line, three series
  - Error rate over time — line
- **Tables row:** Top 5 models by cost; Top 5 most-recent failed traces (with link to trace detail).
- **Empty state:** if `total_spans = 0`, show condensed SDK onboarding card with copy-paste snippet and link to settings/keys. Re-use existing `SdkOnboarding` after fixing the auth header.

Backing queries: extend `lib/queries/overview.ts` with `getLatencyPercentiles`, `getErrorRateOverTime`, `getRecentFailures`. All tenant-scoped.

### V1.C — Tracing page (real)
Consolidate the two confusing tracing surfaces (`/traces` showing sessions, `/projects/<slug>/traces` showing spans) into one. V1: **`/traces` shows a unified list of LLM calls (top-level GenAI spans) with optional grouping by session.**

- **Header:** time-range picker + environment + model + status (ok/error) + free-text search filters. Filter values come from existing `getDistinctEnvironments` / `getDistinctModels`.
- **Toggle:** "List" view (one row per span) vs "Sessions" view (current `SessionTable`).
- **List view columns:** Timestamp, Model, Latency, Input/Output tokens, Cost, Status, Trace ID (link).
- **Pagination:** keyset/cursor on `Timestamp` instead of `OFFSET` for ClickHouse perf at scale (offset is fine for V1; flag for follow-up).
- **Trace detail page** (`/traces/[traceId]`): existing `getTraceDetail` is solid — just add prompt/completion content panels (`gen_ai.prompt`, `gen_ai.completion`) and a span timeline waterfall (existing data, missing UI). Replace `<details>` JSON dump with structured panes.
- **Session detail** (`/traces/sessions/[sessionId]`): chronological list of spans in that session; reuse `getSessionDetail`.

### V1.D — Monitors page (new)
See section 3 — full design follows in `monitors-design.md` once #4 starts.

V1 monitors at minimum:
- Threshold monitors on three metrics: **cost**, **p95 latency**, **error rate**, with optional model/environment scope.
- Evaluated by a **cron worker** every 5 min over the last N minutes window.
- Fire/recovery state tracked in Postgres.
- One notification channel: **in-app banner + monitor list page badge**. Email is a stretch goal (Supabase magic-link infra makes SMTP doable but not free).
- List page, create/edit modal, detail page with trigger history.

### V1.E — Settings polish
- API keys page already exists — confirm CSRF + ownership checks on create/revoke actions.
- Add "Org name", "Tenant ID (read-only)" sections for clarity.
- Add docs links (real ones, not placeholders).

---

## 3. What V1 explicitly does NOT ship

These are tempting but out of scope. Punt to V1.1+:
- **Projects/sub-tenancy.** No `Project` Prisma model, no project switcher, no per-project tenant suffixing. Single org = single dataset for V1.
- **Datasets, Playgrounds, Experiments, A/B Tests, Evaluators, Prompts.** All in current sidebar — all out of V1.
- **Wardbugger.** Removed from V1 nav.
- **Multiple notification channels.** Slack/PagerDuty/webhook later. Email tentative.
- **Custom evaluators / quality monitors.** Traceloop's headline feature, but blocked on having an eval framework in the SDK. Out of scope.
- **Trace search by content** (full-text in prompts/completions). Sessions page does substring already; we won't extend it for V1.
- **Cost/usage limits, billing, plans.** Tier exists in schema but isn't enforced anywhere except gateway rate limit. Leave as-is.
- **Auth roles beyond owner/member.** `OrgMember.role` exists; UI doesn't expose it. Don't add admin/viewer split for V1.
- **Multi-org switching.** `getOrCreateOrg()` returns the first member row; supports one org per user. OK for V1.
- **Production-grade ingestion.** Direct OTLP, no ingestion buffering, single Redis. Fine for demo.

---

## 4. Traceloop UX inventory (for our reference)

Sourced from traceloop.com & docs.traceloop.com 2026-05-06. We adopt the **shape**, not the brand or feature density.

### Their dashboard surfaces
- **Overview/Dashboard** — prompts/responses, latency, model trends, quality drift.
- **Traces** — raw LLM logs with filters; drill-down into spans.
- **Monitors** (their flagship) — see below.
- **Evaluators** — built-in (faithfulness, relevance, safety) + custom. **Out of scope for us.**
- **Quality Gates** — CI/CD enforcement. **Out of scope.**
- **Experiments / Datasets / Playgrounds / Prompt Registry** — workbench surfaces. **Out of scope.**

### Their Monitors specifically
- **Definition fields:** Span fields → evaluator inputs (or threshold metric). JSON-key extraction (`0.text`) and regex supported.
- **Filter scopes:** Environment, Workflow Name, Service Name, AI Data (model/tokens), arbitrary span attributes.
- **Sample rate:** % of matching spans the monitor evaluates (cost control).
- **Result UI:** Line + bar charts, time-bucket aggregation (avg/median/sum/min/max/count), bucket size, time range (24h/7d/14d/custom).
- **List page:** monitor health + run count + last execution time.
- **Detail page:** Charts + spans table with input/output, completed/error counts, links to trace explorer.

### What we steal for V1
- The list page → detail page → trace drill-down pattern.
- Filter chips: time range, environment, model.
- The "metric + comparator + threshold + window" mental model.
- The "completed runs / error runs" framing in the spans table.

### What we leave
- Evaluator wiring (no eval pipeline).
- JSON key/regex extraction (overkill).
- Workflow name (we don't have workflows; we have sessions).
- Sample rate (premature optimization).

---

## 5. V1 task breakdown (for backend/frontend)

Tasks I'll create immediately after this doc lands. Each one names file paths and acceptance criteria.

### Backend
- **B1 — Remove project chrome from V1 surface.** Delete or feature-flag `dashboard/src/lib/projects.ts` callers; update `sidebar.tsx` to drop project nav and `/wardbugger`. (Cross-cuts with frontend; backend lead on the data side, frontend on UI.)
- **B2 — Real overview queries.** Add `getLatencyPercentiles`, `getErrorRateOverTime`, `getRecentFailures`, `getSpansOverTimeByModel` to `lib/queries/overview.ts`. All tenant-scoped, all parameterised.
- **B3 — Unified traces query.** Add `getSpans()` to `lib/queries/traces.ts` (one row per top-level GenAI span, with status/model/latency/cost). Keep existing `getTraces` as a passthrough or delete after frontend swap.
- **B4 — Monitors data model + worker.** Prisma model `Monitor` + `MonitorTriggerHistory` (see #4 design doc). Worker that runs every 5 min and writes trigger events. Belongs to Postgres because state is mutable; ClickHouse stays read-only for span queries.
- **B5 — SDK onboarding header fix.** `dashboard/src/components/sdk-onboarding.tsx` uses `Authorization: Bearer ${apiKey}` not `x-api-key`. Verify against `gateway/internal/middleware/auth.go bearerToken()`.
- **B6 — Tenant isolation regression test.** End-to-end test: two tenants, two API keys, one queries the other's tenantId via Prisma/ClickHouse — expect zero rows. Goes under `src/tests/` or a new `dashboard/__tests__/`.

### Frontend
- **F1 — Overview redesign.** Implement the new `/overview` page per §V1.B. Components: time-range picker (URL-state), 4-card top row, 4 charts, 2 tables, empty state. Reuse `MetricCard`, `CostChart`. Add new chart components as needed.
- **F2 — Tracing consolidation.** Rebuild `/traces` per §V1.C. List/Session toggle. Filter chips (time, env, model, status). Trace detail with prompt/completion panels and waterfall.
- **F3 — Monitors UI.** List page (`/monitors`), create/edit modal, detail page (`/monitors/[id]`) with trigger history table and condition charts.
- **F4 — Sidebar prune.** Remove project nav and dead links (per B1). Active state for `/overview`, `/traces`, `/monitors`, `/settings`.
- **F5 — In-app monitor banner.** Top-of-app banner if any monitor is currently firing for this tenant. Dismissible per session, not per-user-permanent (V1 simplicity).
- **F6 — Empty/loading/error states.** Each new page must have all three. Skeletons over spinners.

### Acceptance criteria (applies to all)
- Every new query takes `tenantId: string` and calls `requireTenantId()`. **No exceptions.**
- Every new route under `(dashboard)` calls `getOrCreateOrg()` and renders `<TenantContextFallback />` on missing tenant.
- Every new server action validates input.
- No new top-level dependencies without architect sign-off.

---

## 6. Decisions (confirmed by team-lead 2026-05-07)

1. **Project entity → DEFERRED to V1.1.** Single-org, single-dataset for V1. Project routes hidden behind a feature flag; nav pruned.
2. **Wardbugger → DELETE.** Treat as dead scaffolding. Remove from sidebar in #5.
3. **Demo data → no auto-seed for new orgs.** New orgs see truthful empty state with strong onboarding card (the SDK install snippet). Demo seeding stays a separate operator script. The user explicitly wants users to see *their own* LLM call metrics → empty until instrumented.
4. **Monitor notifications → in-app banner only. No email in V1, not even as a stretch.** See `monitors-design.md §4`. Email/Slack/webhook explicitly deferred to V1.1+.

## 6a. Canonical trace drill model (frontend coordination)

Frontend flagged trace-drill ambiguity in `.agents/frontend-inventory.md` (workspace `/traces` queries sessions, project `/traces` queries spans, both detail routes share `[traceId]` param meaning different things). **V1 canonical model, locked:**

- **Top of funnel:** `/traces` shows a list of **spans** (one row per top-level GenAI span) by default, with a toggle to switch to **sessions** view (rows grouped by `gen_ai.session.id`).
- **Drill from spans view:** row → `/traces/[traceId]` (detail page; renders the trace's span tree).
- **Drill from sessions view:** row → `/traces/sessions/[sessionId]` (renders chronological span list for that session).
- **A "trace" = one OTel TraceId**, period. A "session" = a `gen_ai.session.id` attribute spanning N traces. Don't conflate them in route names again.
- **Project-scoped trace routes (`/projects/[slug]/traces/*`)** are removed from V1 nav (per decision #1). Code can stay if the feature flag is wired.

This model unblocks frontend's #11 (F2) and shapes how Monitor "Recent matching spans" deep-links work (#20).

## 6b. Other findings folded in (from teammate grounding passes)

- **Gateway tenant injection is a server-side override** (`gateway/internal/proxy/proxy.go:91`) — clients cannot spoof `ward.tenant_id`. Confirmed in §1 above. The "what's hardcoded" framing throughout this doc is about dashboard chrome and missing entities, NOT data isolation, which is sound.
- **Gateway seed (`gateway/cmd/seed/main.go`) writes Redis-only API keys** — keys created via the seed path do not appear in the dashboard's `/settings/keys` list (Postgres `ApiKey` table is bypassed). Operationally surprising, demo-hostile. New task added: mirror seeded keys to Postgres so the dashboard shows them, OR drop the seed path in favor of in-app key creation only. See task list below.
- **Rate limits live on `Organization`, not `ApiKey`** — no per-key overrides. **Deferred to V1.1.** Documented here so we don't regress: per-key limits exist in many SaaS observability tools, but our V1 demo doesn't need them.
- **#12 (loading/error/not-found scaffolding) and #13 (shadcn-style primitives layer)** are team-lead-owned upstream tasks. They subsume what I had as F6 and are prerequisites for F1, F2, F7, F8, F9, F10. All my frontend tasks are wired to depend on #13.

## 6c. Confirmed deployment posture (V1) `[to-verify-with-product-owner]`

Working assumption locked by team-lead 2026-05-07; pending product-owner confirmation:

| Component | Hosting | Credentials live in |
|---|---|---|
| Dashboard (Next.js) | **Vercel** | Vercel project env |
| Postgres (`Organization`, `OrgMember`, `ApiKey`, `Monitor`, `MonitorTrigger`) | **Supabase** (managed) | Supabase + Vercel `DATABASE_URL` env |
| Supabase Auth | **Supabase** | Vercel `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Gateway, OTel Collector, ClickHouse, Redis | **AWS ECS** (via `infra/*.tf`) | Terraform vars → ECS task env (or Secrets Manager post #35) |

**What this means concretely:**
- `DATABASE_URL` is provisioned by Supabase, set in Vercel env. Not in `infra/*.tf` and shouldn't be.
- `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` for the dashboard live in Vercel env today (will be required-no-fallback after #31 lands).
- `CRON_SECRET` (for #16 monitor worker) lives in Vercel env; Vercel Cron config (per #16's README requirement) drives it.
- The AWS side (`infra/*.tf`) handles the *data plane* (ingest + storage). The dashboard is *control plane* and lives entirely on Vercel + Supabase.

**Why no Postgres / Grafana / dashboard task def is in `infra/*.tf`:** by design — they're not AWS-hosted in V1. Confirmed clean in `.agents/infra-credential-audit.md` §I3.

**Verification checklist before V1 ship:**
- [ ] Confirm with product-owner that Vercel + Supabase is the actual prod posture (not, e.g., self-hosted dashboard).
- [ ] Confirm Vercel project has all required env vars set (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CRON_SECRET`).
- [ ] Confirm Supabase Postgres has Prisma migrations applied (covered by #24).
- [ ] Confirm Vercel Cron is configured per #16's README pattern.

---

## 7. Risks

- **ClickHouse offset pagination.** Current traces query uses `OFFSET`; will degrade past ~10k rows. Switching to keyset is a 1-day fix; defer if user load is small for V1 demo.
- **Monitor worker cardinality.** Cron worker doing 4 queries × N monitors × every 5 min could blow up if a tenant adds 100 monitors. V1: cap monitors per tenant at 10, document limit.
- **Single-Redis API key store.** A Redis flush wipes all auth. V1: live with it; document recovery (re-seed from Postgres `ApiKey.keyHash` if we mirror there). Currently the seed scripts assume Redis is the source of truth — that needs reversing post-V1.
