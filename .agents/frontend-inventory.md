# Frontend Inventory — Overview & Traces (V1 audit)

Owner: `frontend`
Scope: task #3 — audit current state of the Next.js dashboard, focusing on Overview and Tracing surfaces, before architect publishes Monitors design (#4).

Source files inspected: every file under `dashboard/src/app/(dashboard)/`, every file under `dashboard/src/components/`, all `dashboard/src/lib/queries/*.ts`, the auth surfaces (`middleware.ts`, `app/auth/*`, `app/sign-in/page.tsx`, `app/page.tsx`, `app/layout.tsx`), `lib/org.ts`, `lib/projects.ts`, and `dashboard/package.json`.

> **AGENTS.MD §5.3 violation** sits on top of everything below: there is **no `loading.tsx`, `error.tsx`, or `not-found.tsx`** anywhere under `dashboard/src/app/`. Every async page below ships without the mandatory loading/empty/error UI. Treat this as the cross-cutting deficiency.

---

## 1) Routing map (today)

Auth-gated by `middleware.ts` (Supabase SSR). Dashboard layout (`(dashboard)/layout.tsx`) double-checks `getCurrentUser` and renders the sidebar. `getOrCreateOrg` auto-provisions an org+tenant on first hit.

| Route | File | State |
|---|---|---|
| `/` | `app/page.tsx` | Redirects to `/overview` or `/sign-in`. ✓ |
| `/sign-in` | `app/sign-in/page.tsx` + `components/sign-in-buttons.tsx` | Google/GitHub OAuth via Supabase. ✓ |
| `/auth/callback` | `app/auth/callback/route.ts` | Exchanges code, redirects to `next` or `/overview`. ✓ |
| `/auth/sign-out` | `app/auth/sign-out/route.ts` | POST signs out → `/sign-in`. ✓ |
| `/overview` | `(dashboard)/overview/page.tsx` | **Mostly mock.** Hero + 3 hardcoded "seeded projects" from `getWorkspaceProjects()`. No real metrics. |
| `/traces` | `(dashboard)/traces/page.tsx` | **Real data.** `SessionTable` + `TraceFilters` (timeRange/environment/model/search). |
| `/traces/[traceId]` | `(dashboard)/traces/[traceId]/page.tsx` | Lists spans for a session as cards with `<details>` JSON dump. No waterfall, no prompt view. |
| `/costs` | `(dashboard)/costs/page.tsx` + `client.tsx` | Real data, but legacy `border-zinc-*` styling — inconsistent with the rest of the app. |
| `/projects/[projectSlug]` | `(dashboard)/projects/[projectSlug]/page.tsx` | If `totalSpans === 0` → `SdkOnboarding`. If > 0 → 2 real KPI tiles + 3 placeholder chart panels. |
| `/projects/[projectSlug]/traces` | `(dashboard)/projects/[projectSlug]/traces/page.tsx` | **Different table** (`TraceTable`, span-level) than workspace `/traces` (`SessionTable`). Inconsistency. |
| `/projects/[projectSlug]/traces/[traceId]` | same JSON-dump pattern | Same gaps as workspace detail. |
| `/projects/[projectSlug]/[feature]` | dynamic placeholder | Renders "Coming soon" for `monitors`, `datasets`, `experiments`, `evals`, `ab-tests`, `playground`, `prompts`, `sessions`. |
| `/settings` | `(dashboard)/settings/page.tsx` | Static org card + SDK snippet (hardcoded `https://ingest.ward.dev`). |
| `/settings/keys` | `(dashboard)/settings/keys/{page,client,actions}.tsx` | API key CRUD — best-implemented surface; uses server actions correctly. |
| `/monitors` | **404** | Sidebar links to it (workspace nav, see `components/sidebar.tsx:58`) — route does not exist. |
| `/wardbugger` | **404** | Same — sidebar links it under "True sight". |

V1 scope target (per team-lead): **Overview**, **Tracing**, **Monitors**. Costs and Projects shells are out of scope but the file paths above touch the same components, so changes propagate.

---

## 2) Per-page punch list

### 2.1 `/overview` — Workspace overview

**Mocked vs real**
- ❌ Workspace project list: `getWorkspaceProjects(orgName)` is a hardcoded array of 3 items (`projectname`, `support-copilot`, `eval-lab`). Slugs do not correspond to any DB records — clicking "Open project" on `support-copilot` lands on a project shell that then queries org-wide ClickHouse data and ignores the slug.
- ❌ "Create project" / "Connect existing project" CTAs both link to `/projects/projectname` — not real flows.
- ❌ Status badges ("Active", "Seeded", "Ready") are made up.
- ❌ No KPI tiles for the workspace itself (cost, requests, p50/p95 latency, error rate, active models). For V1 Overview the team-lead will want these — Traceloop-style overviews always lead with KPIs + a trend chart.

**Loading / empty / error**
- ❌ No `overview/loading.tsx`. `getOrCreateOrg()` does Postgres I/O on every render.
- ❌ Empty state for "no traces yet" is missing — page assumes seeded projects always exist.
- ❌ Error boundary missing. `getOrCreateOrg` swallows DB-unavailable errors and returns `null` → renders `TenantContextFallback`. Other failure modes (ClickHouse timeout, prisma connectivity post-create) will surface as raw 500s.

**Visual gaps vs Traceloop / industry standard**
- No time-range selector.
- No spans-over-time area chart at the workspace level.
- No top-models / top-projects panels.
- No "send your first trace" callout for brand-new orgs that bypass project shell entry.

**Reuse vs build**
- Reuse: `MetricCard`, `OverviewCharts` (in `overview/charts.tsx` — currently unused on this page; defined but only `costData`/`spanData` props), `TenantContextFallback`.
- Build: real KPI tiles wired to `getOverviewMetrics`, real trend chart wired to `getSpansOverTime`, an `EmptyState` component, project list hydrated from Prisma (or remove the section entirely until Projects are real).

### 2.2 `/traces` — Workspace tracing (sessions list)

**Mocked vs real**
- ✅ Real ClickHouse data via `getSessions` (tenant-scoped on `ResourceAttributes['ward.tenant_id']`). Good.
- ✅ `getDistinctEnvironments` / `getDistinctModels` populate filter dropdowns.
- ❌ "Live" toggle in `TraceFilters` flips local `useState` only — no SSE/polling.
- ❌ "Export" button is a no-op stub.
- ❌ Secondary "Filters" button is a no-op (the visible env/model selects already cover the implemented filters).
- ❌ "Custom" time-range chip has no UI to pick a range.
- ❌ Pagination is "Load more" via URL param, but page resets all filters on each click only when offset increases; works but jarring vs cursor pagination Traceloop uses.
- ⚠️ `searchFilter` does substring search on `gen_ai.prompt` / `gen_ai.completion`. Those attributes are not consistently populated by the SDK across providers (anthropic streaming finalizes inputs differently from openai sync). May silently miss matches — flag to backend before we promise filterable search in V1.

**Loading / empty / error**
- ❌ No `traces/loading.tsx`. Sessions query is heavy (CTE + group by + dateDiff + 2 substring slices) and will block render.
- ✅ Empty state exists inside `SessionTable` ("No sessions found…"). Good baseline.
- ❌ No `traces/error.tsx`. ClickHouse outages render as a raw exception.
- ⚠️ `parseInt(query.page || "1")` does no validation — `?page=abc` returns `NaN` → `offset = NaN * limit = NaN` → ClickHouse rejects. Per AGENTS.MD §5 "validate all server-action inputs" — extend to route searchParams.

**Visual gaps vs Traceloop / industry standard**
- No spans-over-time mini chart above the table (Traceloop puts a sparkline + filter chips header).
- No status / error indicator column (the data is queried but never rendered).
- No latency distribution / sparkline per row.
- No selectable rows (multi-select for bulk "open in monitor" / "add to dataset").
- Timestamp column shows full `toLocaleString()` — should be relative + tooltip absolute.
- Session ID column truncates by `slice(0,16)` then appends `...` — collision-unsafe for short ids; use a `<MonoEllipsis>` with copy-on-click instead.

**Reuse vs build**
- Reuse: `SessionTable`, `TraceFilters` (need bug fixes), `formatLatency`, `formatCost`.
- Build: `TimeRangeSelector` (extract from `TraceFilters`), `EmptyState`, `Skeleton` rows, `Pagination` primitive, status pill, sparkline cell, custom-range popover.

### 2.3 `/traces/[traceId]` — Session detail

**Mocked vs real**
- ✅ Real spans via `getSessionDetail`.
- ❌ "Trace detail" copy is misleading — this is a **session** detail (`SpanAttributes['gen_ai.session.id']`). Routing param is `traceId` but the query treats it as `sessionId`. Bad naming will bite us in Monitors which references "trace detail" links.
- ❌ No waterfall — spans render as flat cards with raw `JSON.stringify(attributes, null, 2)` inside `<details>`.
- ❌ No structured prompt/completion view, no token/cost/latency rollup, no parent/child reconstruction (we have `ParentSpanId` in the query but ignore it).

**Loading / empty / error**
- ❌ No loading skeleton.
- ✅ Empty state ("No spans found for this session.") is decent.
- ❌ Wrong-tenant access: the query already gates on `ward.tenant_id`, but if a wrong session id is supplied the page renders the empty state silently. Acceptable — but log/notFound() would be cleaner so users don't think their data vanished.

**Visual gaps**
- No timeline. No nested span tree.
- No copy-to-clipboard on session id.
- No links from a span to model docs / prompt registry.

**Reuse vs build**
- Build: `Waterfall` component, `SpanCard`, `PromptCompletionViewer`, `KeyValueGrid` (replace raw JSON).

### 2.4 `/projects/[projectSlug]` — Project dashboard

- ⚠️ `getOverviewMetrics(org.tenantId)` ignores `projectSlug`. There is no "project" entity in ClickHouse data yet — the SDK uses `application_name` but it is not surfaced on this page. Effectively three different project routes show identical numbers.
- ❌ Three of four panels are **explicit placeholders** ("No data yet" hardcoded even when data exists, see `page.tsx:67-100`).
- ❌ No loading/error UI.
- For V1 we either (a) collapse projects until real entity model lands, or (b) start filtering ClickHouse queries by `SpanAttributes['ward.application_name']` (or whatever the SDK emits) — needs confirmation from `backend`/`architect`.

### 2.5 `/projects/[projectSlug]/traces`

- ❌ Uses `TraceTable` (span-level, single-row-per-call) while workspace `/traces` uses `SessionTable` (rolled-up sessions). The two surfaces shouldn't disagree.
- ❌ Filter UX completely different: this page only takes `?model=` query param, no time range, no search.
- For V1: pick one model — recommend converging on the workspace `/traces` UX with project filter applied.

### 2.6 `/projects/[projectSlug]/[feature]` — feature placeholder

- All non-traces project routes (sessions, monitors, datasets, experiments, evals, ab-tests, playground, prompts) hit one placeholder. Good for now. Once Monitors design lands, replace `monitors` from this catch-all with a real route.

### 2.7 Sidebar (`components/sidebar.tsx`)

- ❌ Workspace nav links `/monitors` and `/wardbugger` to **non-existent routes**. Will produce 404s. Either build, hide behind a feature flag, or remove until ready. (V1 plan says we will build Monitors; Wardbugger is unscoped.)
- Workspace vs project nav split is well-structured and worth keeping.
- Logout flow buried under a profile-button toggle — works, but the collapsed-sidebar logout absolute-positioned overlay is fragile.

### 2.8 Auth surfaces

- ✅ Middleware redirects unauthenticated users to `/sign-in?next=…` and pushes signed-in users off `/sign-in`.
- ✅ Callback route validates `next` startsWith `/`. Good.
- ⚠️ `app/sign-in/page.tsx` references `bg-panel` and `border-white/10` — uses both Tailwind theme tokens *and* hardcoded white opacities. Cosmetic, low priority.
- No password / magic-link path. Out of V1 scope unless team-lead asks.

---

## 3) Cross-cutting deficiencies

### 3.1 Loading / empty / error UI (AGENTS.MD §5.3 mandate)

Build a primitives layer:
- `dashboard/src/components/ui/skeleton.tsx`
- `dashboard/src/components/ui/empty-state.tsx`
- `app/(dashboard)/<route>/loading.tsx` for at least `/overview`, `/traces`, `/traces/[traceId]`, `/costs`, `/settings/keys`, `/projects/[projectSlug]`, `/projects/[projectSlug]/traces`, `/projects/[projectSlug]/traces/[traceId]`
- `app/(dashboard)/error.tsx` (route-group level) with a child override for `traces/error.tsx` since ClickHouse failure has its own retry path
- `app/not-found.tsx` for the 404 we will inevitably hit while `/monitors` and `/wardbugger` are dangling

### 3.2 Styling drift

The codebase has two visual languages:
- **New**: `tech-border`, `bg-panel`, `bg-background`, `text-foreground`, `text-muted-foreground`, `text-destructive` (CSS custom-property tokens). Used in newer surfaces (overview, traces, settings).
- **Legacy**: `border-zinc-800`, `bg-zinc-900/50`, `text-zinc-400`. Used in `cost-chart.tsx`, `trace-table.tsx`, `session-table.tsx`, `api-key-table.tsx`, `create-key-dialog.tsx`, `costs/client.tsx`. These break in light mode.

Cleanup is mechanical but should be one focused PR per component family, not a monorepo sweep.

### 3.3 Missing UI primitive layer

`package.json` does **not** include any shadcn-style packages (`@radix-ui/*`, `cmdk`, etc.). Every button, dialog, select, and input is hand-rolled. Recommendation: add minimal shadcn-style primitives (Button, Input, Select, Dialog, Badge, Tooltip, Skeleton, EmptyState) before Monitors lands so we are not re-implementing them under deadline. Defer to architect for sign-off — listed in §5 below.

### 3.4 Input validation

`searchParams` are coerced via `parseInt(query.page || "1")` etc., with no bounds checks (negative offset, NaN). Same in project trace route. AGENTS.MD §5.3 + §6.6 says "treat externally supplied strings as untrusted." Add a small `parsePage`/`parseLimit` helper.

### 3.5 Trace surface inconsistency

Workspace `/traces` is session-rolled-up; project `/traces` is span-level. The detail route is named `[traceId]` but receives a session id at the workspace level and a trace id at the project level. We need to converge on one mental model before Monitors uses these as drill-down targets. Recommend: workspace and project both show sessions, drill-down resolves session → list of traces → list of spans (waterfall).

---

## 4) Visual gaps vs Traceloop UX (best-effort)

WebFetch on `traceloop.com` and `traceloop.com/docs` returned mostly marketing copy, not enough to copy concrete component shapes. From general LLM-observability convention (Traceloop, Langfuse, Helicone, Arize) the V1 Overview/Tracing surfaces should hit:

1. **Overview**
   - Persistent time-range selector (sticky, top-right).
   - 4–6 KPI tiles: total spans, total cost, p50 latency, p95 latency, error rate, active models.
   - Spans-over-time area chart (already have `getSpansOverTime`).
   - Cost-by-model donut (already have `getCostByModel`).
   - Top errors list, top slowest spans list.
2. **Tracing**
   - Time-range selector + live tail (genuine SSE/poll, not the current local `useState`).
   - Filter chips: env, model, status, search.
   - Mini-chart of throughput above the table (Traceloop convention).
   - Waterfall drill-down with prompt/completion side-by-side.
   - Copy-curl / re-run from session detail (post-V1, but design now so detail layout has the slot).
3. **Monitors** — wait for architect (#4).

I will request screenshots from the team-lead before the Monitors implementation pass so we are not guessing at exact panel composition.

---

## 5) Recommended build order before Monitors

Sequencing the work below keeps each PR small (AGENTS.MD §4):

1. **UI primitives + loading/error/empty** — unblocks every following PR.
2. **Styling sweep** — migrate legacy zinc components to design tokens.
3. **Search-param validation helper** (3-line utility, shared).
4. **Overview real data** — kill the seeded project list, wire KPIs to `getOverviewMetrics` + `getSpansOverTime`.
5. **Tracing fixes** — make Live/Export/Filters either work or be removed; converge workspace/project surfaces on sessions.
6. **Trace detail v2** — waterfall + prompt/completion viewer, drop the JSON `<details>` dump.
7. **Sidebar dead-link cleanup** — hide `/monitors` and `/wardbugger` until they exist (or scaffold `/monitors` route to be ready for the architect's design).
8. **Monitors UI** — gated on task #4.

Each item maps to a separate task in TaskCreate when we are ready to execute; not creating them yet to avoid clutter while #4 is still pending.

---

## 6) Open questions for team-lead / architect / backend

- `architect`: does V1 Projects mean a real DB-backed entity, or does the workspace remain single-project and the `/projects/*` shell get hidden?
- `backend`: are SDK spans guaranteed to carry `ward.application_name` (or equivalent) so per-project filtering is even possible? If not, project-scoped queries are a lie.
- `backend`: are `gen_ai.prompt` / `gen_ai.completion` reliably populated across openai sync/streaming and anthropic sync/streaming? The `/traces` search filter assumes yes.
- `team-lead`: keep `/wardbugger` in the sidebar as a roadmap signpost, or remove until built?
- `team-lead`: any Traceloop screenshots you can drop into `.agents/` so I am matching, not guessing?
