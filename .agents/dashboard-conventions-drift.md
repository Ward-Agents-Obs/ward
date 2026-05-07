# Dashboard Conventions Drift — V1 audit

Owner: `frontend` · Date: 2026-05-07 · Status: flag list, not a refresh PR

## Scope

`dashboard/AGENTS.md` today is 5 lines: a warning that Next.js APIs may differ from training data and a pointer to `node_modules/next/dist/docs/`. That's the entire dashboard-specific contract. Everything else lives in:

- The root `AGENTS.MD` (§5.3 has 4 lines on TypeScript/Next.js, §6 has 6 lines on tenant guardrails — appropriate for a multi-subsystem doc).
- `dashboard/src/components/ui/README.md` (primitives table + omissions list).
- Inline JSDoc + `TODO(...)` comments throughout the codebase.

This file flags conventions that **emerged during V1** and are now load-bearing but not findable in the agent-facing docs. Each is one paragraph: what the convention is, where it's enforced, and why a future contributor would trip on it without docs.

The intent is for team-lead (or whoever) to decide which of these are worth **consolidating into `dashboard/AGENTS.md`** vs. left as tribal knowledge / inline comments.

---

## Category 1 — explicitly called out by team-lead

### 1.1 Primitives layer (`@/components/ui/*`)

The dashboard now has a shadcn-style primitives layer at `dashboard/src/components/ui/`. Every new V1 surface uses it; the migration sweep (#43) cleared every legacy zinc/emerald/rose hex literal from `src/components/` and `src/app/(dashboard)/` (`grep -rn "emerald-\|rose-\|zinc-" src/components src/app/\(dashboard\)` returns zero hits).

- **Source of truth**: `components/ui/README.md` lists every primitive, the deliberate-omissions vs Radix, and a migration plan.
- **Convention**: import primitives from `@/components/ui/<name>`. Do NOT roll new buttons / dialogs / tables / inputs inline. New variants → extend the CVA system in the existing primitive, don't build a parallel one.
- **Drift risk for new contributors**: nothing in `dashboard/AGENTS.md` or root `AGENTS.MD` points at the primitives layer. A new agent could easily reach for hand-rolled markup again.
- **Suggested AGENTS.md line**: "UI primitives live at `@/components/ui/*`. Read `components/ui/README.md` before adding a new component or variant."

### 1.2 Server-only helpers in `lib/*.ts` without `"use server"`

`lib/monitors.ts` introduced a pattern that **doesn't** match the older `lib/queries/*.ts` files: it exports types + constants (`MONITOR_METRICS`, `MonitorMetric`, etc.) alongside async helpers, and is **deliberately NOT** marked `"use server"`. The directive forbids non-async exports, so a file that mixes the two has to live without it.

- **Source of truth**: top-of-file comment in `lib/monitors.ts:1-4`.
- **Convention**: `lib/queries/*.ts` (async-only) → `"use server"`. `lib/<feature>.ts` (mixed types + helpers) → no directive; consumed only by server components and the `actions.ts` files. Server actions exposed to client components live in `app/(dashboard)/<route>/actions.ts`, which IS marked `"use server"`.
- **Drift risk**: a contributor adding `lib/monitors.ts`-shaped helpers might either add `"use server"` (build error on type exports) or expose them directly to client components (no boundary).
- **Suggested AGENTS.md guidance**: a 3-line rule mapping file kind → directive convention.

### 1.3 No test runner — `npx tsx` scripts under `__tests__/`

The dashboard has **no vitest / jest** install. Tests live at `dashboard/__tests__/*.ts` and run as standalone scripts via `npx tsx <path>` against a live ClickHouse stack (instructions in each file's top comment). Existing examples: `getspans-tenant-isolation.ts`, `dashboard-queries-tenant-isolation.ts`, `overview-tenant-isolation.ts`.

- **Source of truth**: each file's top docblock + `dashboard/scripts/run-tenant-isolation-tests.sh`.
- **Convention**: every new query gets a tenant-isolation script test alongside the implementation. Tests insert synthetic spans with `wardtest_<runid>` tenant ids, assert the property, then `ALTER TABLE ... DELETE`. No mocking; the tests run against the docker-compose stack.
- **Drift risk**: a contributor with vitest reflexes might add `*.test.ts` files that nothing runs. Or skip tests entirely thinking there's no test infra.
- **Suggested AGENTS.md guidance**: one line saying "tests are tsx scripts under `__tests__/`, run via `scripts/run-tenant-isolation-tests.sh`. Add a script for every new query."

### 1.4 URL-state filter pattern

Every filter on every page round-trips through the URL. Established by `<TimeRangePicker>` + `<EnvironmentFilter>` + `<TracesViewToggle>` + the time-chips inside `<TraceFilters>`. The shared invariants:
- Server-side: page parses + validates the param via a `parse<Name>(raw: string | undefined)` helper that silently degrades to a default. Never trust route params (root §6).
- Client-side: filter components use `useSearchParams()` to read; navigate via `<Link replace scroll={false}>` (for stateless picks like time range) or `router.replace(href, { scroll: false })` (for form-shaped pickers).
- **Pagination invariant**: every filter change deletes `?page=` from the URL so users don't strand on an empty page index after the filter narrows the result set.
- Empty filter values delete the param rather than carrying empty strings.

- **Source of truth**: `components/ui/time-range-picker.tsx:54-61` (`buildHref` deletes `page`), `components/ui/environment-filter.tsx:42-50` (same), `components/traces/trace-filters.tsx:81-89`.
- **Drift risk**: a new filter that doesn't delete `?page=` quietly breaks pagination. A new filter that uses client-only state instead of URL state breaks deep-linking and SSR.
- **Suggested AGENTS.md guidance**: a 4-line "URL-state filter pattern" section pointing at `time-range-picker.tsx` as the canonical example.

---

## Category 2 — drift I noticed while writing this audit

### 2.1 Tenant-scoped page guard

Every page under `(dashboard)/` opens with the same shape:
```ts
const [org, query] = await Promise.all([getOrCreateOrg(), searchParams]);
if (!org?.tenantId) return <TenantContextFallback />;
```
Then every downstream query call passes `org.tenantId` (ClickHouse) or `org.id` (Prisma).

- **Drift risk**: a new page that forgets the guard either crashes on null tenant or silently leaks across orgs (depends on which query throws first).
- **Suggested AGENTS.md guidance**: cite this pattern explicitly. AGENTS.MD §6 covers the rule but not the canonical implementation.

### 2.2 Tenant-scoped query helper

Every query in `lib/queries/*.ts` opens with `const resolvedTenantId = requireTenantId(tenantId);`. This is the *single* place tenant isolation is enforced — if a query forgets the call, the WHERE clause's `{tenantId:String}` placeholder receives undefined and the query throws (or worse). The `__tests__/overview-tenant-isolation.ts` "requireTenantId guard" assertion is the regression check.

- **Drift risk**: a new query function that omits `requireTenantId` and just trusts the caller passes a valid string. Hard to catch in code review without a structured rule.
- **Suggested AGENTS.md guidance**: "every query function takes `tenantId: string` as the first arg and immediately calls `requireTenantId(tenantId)` before any I/O." Pair with the §6 rule.

### 2.3 Server-component-with-client-island pattern

V1 surfaces consistently use a **server component for the page** + small **client islands** for interactivity. Examples:
- `monitors/page.tsx` (server) + `<CreateMonitorButton>` (client) wrapping the F8 dialog.
- `monitors/[monitorId]/page.tsx` (server) + `<EditMonitorButton>` (client).
- `(dashboard)/layout.tsx` (server) + `<FiringBanner>` (server) + `<BannerRefresher>` (client) — three layers because the polling-only-when-firing invariant requires conditional client mount.

- **Drift risk**: a contributor making the entire page a `"use client"` component to "make the dialog work" — losing SSR and the tenant-scoping guarantees that depend on server-side `getOrCreateOrg()`.
- **Suggested AGENTS.md guidance**: "server components fetch + render; client islands handle interactivity. Pages should not be `"use client"`."

### 2.4 Loading / error / not-found scaffolding

Per AGENTS.MD §5.3 every async route ships with loading + empty + error UI. The V1 implementation pattern:
- `loading.tsx` per major route, mirroring the page layout (panel skeletons, not generic blobs) to minimise content-shift.
- `(dashboard)/error.tsx` route-group boundary using Next 16's `unstable_retry()` (NOT `reset()` — verified against `node_modules/next/dist/docs/.../error.md`).
- `app/global-error.tsx` with inline styles (the css pipeline isn't guaranteed when this replaces the root layout).
- `app/not-found.tsx` design-system-styled, links back to `/overview`.

- **Drift risk**: a new contributor copying an old `error.tsx` they remember from training data and using `reset()`. Or skipping `loading.tsx` because the page renders fast in dev.
- **Suggested AGENTS.md guidance**: callout that Next 16's error props are `{ error, unstable_retry }`, not `{ error, reset }`, and a one-liner that every async route must ship the trio.

### 2.5 Routing semantics — trace vs. session drill

After F2 (#11) and the architect's §6a clarification, the canonical model is:
- `/traces/[traceId]` — trace detail, queried by `TraceId` (one OTel trace).
- `/traces/sessions/[sessionId]` — session detail, queried by `gen_ai.session.id` (cross-trace conversation).
- The legacy `/traces/[traceId]` page that confusingly queried by `gen_ai.session.id` was the V1.0 artefact F2 fixed.

- **Drift risk**: a new contributor adding a "trace" route and conflating the two ids again. The two pages even share a parameter name (`[traceId]` vs `[sessionId]`) by URL but have different keys upstream.
- **Suggested AGENTS.md guidance**: 2-line glossary distinguishing trace vs. session, point at `.agents/v1-scope.md` §6a as the long form.

### 2.6 Stub-then-swap convention for cross-domain blocks

`lib/monitors.ts` and `app/(dashboard)/monitors/actions.ts` codify a pattern for shipping the frontend half of a cross-domain feature ahead of the backend half:
1. Define the function signature against the spec (Prisma model, zod schema, etc.).
2. Stub the body with mock or trivial data, plus a `// TODO(#NN-backend):` comment showing the exact replacement code.
3. Wire the consumer at the call site as if real data existed.
4. When backend lands, the swap is body-only — no consumer changes.

Used by F8 (#19), F10 (#21), F7 scaffold (#18), F9 scaffold (#20), and the pre-#41 `// TODO(#41-backend):` markers on `overview/page.tsx`.

- **Drift risk**: a contributor not aware of the convention may either (a) wait for backend (slow), (b) inline mock data without the swap-marker (becomes permanent), or (c) write a parallel "real" function that diverges from the eventual signature.
- **Suggested AGENTS.md guidance**: 3-line rule documenting the pattern + the `TODO(#NN-backend|frontend):` marker convention. Lots of leverage for cross-domain work.

### 2.7 Design tokens are the single source of truth

`globals.css` defines `--background` / `--foreground` / `--panel` / `--panel-hover` / `--border` / `--accent` / `--accent-hover` / `--muted` / `--muted-foreground` / `--destructive` / `--destructive-foreground` / `--success` / `--success-foreground` / `--ring`. Every primitive uses these via Tailwind 4's `bg-*` / `text-*` / `border-*` mapping. No hex literals in components; no zinc/emerald/rose Tailwind classes.

- **Source of truth**: `globals.css:3-39` + the Conventions section of `components/ui/README.md`.
- **Drift risk**: a contributor using `bg-zinc-900` or `text-emerald-500` because their muscle memory says so. The styling-drift sweep (#43) burned cycles on exactly this.
- **Suggested AGENTS.md guidance**: a single sentence rule + pointer to the README. The grep one-liner above is a useful CI check (or just a pre-commit `grep -rn "emerald-\|rose-\|zinc-" src/components src/app/\(dashboard\) && exit 1`).

### 2.8 Server-action result-envelope shape

Server actions in V1 return a discriminated `{ ok: true, ... } | { ok: false, message?, errors? }` shape. Examples: `monitors/actions.ts:MonitorActionResult`, `settings/keys/actions.ts:createApiKey`. The form layer reads `errors` for field-level highlighting and `message` for top-level error rows.

- **Drift risk**: a new action that throws on validation failure (instead of returning `{ ok: false, errors }`) breaks the form's per-field error UI.
- **Suggested AGENTS.md guidance**: "server actions return a discriminated `{ ok: boolean, ... }` shape; throw only for unexpected exceptions, return `{ ok: false }` for expected validation/auth/cap errors."

---

## Category 3 — conventions documented but worth surfacing

### 3.1 V1 dep budget — no `@radix-ui/*` except Slot

Documented in `components/ui/README.md` § "Deliberate omissions in V1". Worth a sentence in AGENTS.md so a contributor doesn't burn time auditing whether they can install `@radix-ui/react-dialog`. The current rule: ask before adding any `@radix-ui/*` other than `react-slot` (which is in deps). V1.1 task #38 plans the swap.

### 3.2 Skeleton loading vs. spinners

Skeletons mirror page layouts; spinners are reserved for in-flight button states (`<Loader2 className="animate-spin" />` inside `<Button disabled>`). README mentions `<Skeleton>`; AGENTS.md doesn't reflect the spinner-vs-skeleton split.

---

## What I'd put in `dashboard/AGENTS.md` (proposal)

The current 5-line "this is not the Next.js you know" warning should stay, **prepended** with a contents-style preamble that links to the items above. Concretely, I'd grow the file to roughly 60 lines: 3-line headers per convention, with pointers to the canonical implementation file. Not a tutorial — a discovery surface.

Happy to write the refresh PR if you greenlight which items make the cut. If you'd prefer to keep AGENTS.md minimal and instead expand `components/ui/README.md` into a broader `dashboard/CONVENTIONS.md`, that's also reasonable — just say which.
