<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

The conventions below are load-bearing in this codebase. Each entry points at a canonical implementation file so you can copy-paste rather than guess. Full drift audit lives at `.agents/dashboard-conventions-drift.md`.

## Tenant scoping is sacred

Every page under `app/(dashboard)/` opens with:

```ts
const org = await getOrCreateOrg();
if (!org?.tenantId) return <TenantContextFallback />;
```

Every query in `src/lib/queries/*.ts` and `src/lib/*-server.ts` calls `requireTenantId(tenantId)` before any I/O. Every Prisma write filters by compound `(id, orgId)` — use `updateMany` / `deleteMany` / `findFirst({where:{id,orgId}})`, never `findUnique({where:{id}})`. Add a tsx script under `__tests__/` for any new query that proves the IDOR property.

Canonical examples: `src/app/(dashboard)/monitors/actions.ts`, `src/lib/monitors-server.ts`.

## Split server-only modules from client-importable ones

A `lib/<feature>.ts` module imported by client components (for constants / types / pure validators) must NOT import `@prisma/client`, `@clickhouse/client`, or other server-only deps — those would leak into the client bundle. When you need server-side async helpers for the same feature, put them in a sibling `lib/<feature>-server.ts` marked `"use server"`.

Canonical pair: `src/lib/monitors.ts` (types, constants, `validateMonitorInput`) ↔ `src/lib/monitors-server.ts` (Prisma reads, `"use server"`).

## Stub-then-swap for cross-domain features

When the frontend ships ahead of backend (or vice versa):

1. Define the function signature against the spec.
2. Stub the body with mock data + a `// TODO(#NN-backend|frontend):` comment showing the exact replacement code.
3. Wire the consumer at the call site as if real data existed.

The receiving side swaps the body; the consumer doesn't change. Used 5+ times during V1 (#19 modal stubs, #21 banner, #18/#20 page scaffolds, #39/#40/#41 overview wiring). Marker grep: `git grep "TODO(#"`.

## Loading / error / not-found are mandatory

Every async route ships a `loading.tsx` mirroring the page layout. The route-group `(dashboard)/error.tsx` uses **Next 16's `unstable_retry`**, NOT `reset` — the latter only clears state, the former re-fetches. (Common training-data trap; verify against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`.) `app/global-error.tsx` uses inline styles since it replaces the root layout. `app/not-found.tsx` is design-system-styled.

## Tests are tsx scripts under `__tests__/`

No vitest / jest installed. Tests run via `scripts/run-tenant-isolation-tests.sh` against the docker-compose stack. Each file's top docblock has copy-paste run instructions. Add a script for every new query that crosses a tenant boundary; the runner auto-discovers `*-tenant-isolation.ts` files.

## Server actions return discriminated unions

`{ ok: true, ... } | { ok: false, errors } | { ok: false, error: 'tag' }`. Never throw for expected validation / auth / not-found / cap-reached errors — return the typed envelope. Throw only for infra exceptions; the route-group `error.tsx` boundary handles those. Consumer narrows the union and maps tags to user copy.

Canonical: `src/app/(dashboard)/monitors/actions.ts`.

## UI primitives + design tokens

Import primitives from `@/components/ui/*`. No hex literals, no `zinc-*` / `emerald-*` / `rose-*` / `bg-red-500` etc. — those are the legacy palette. Use design tokens from `globals.css`: `--background`, `--foreground`, `--panel`, `--border`, `--accent`, `--muted`, `--muted-foreground`, `--destructive`, `--success`, `--ring`. Variants via `class-variance-authority`.

See `src/components/ui/README.md` for the full primitive table, deliberate-omissions list, and migration order.
