# Monitor Server Actions Design (#15)

**For:** backend, before #15. **From:** architect, 2026-05-07.

Frontend's #19 already shipped most of the contract at `dashboard/src/lib/monitors.ts`. **Reuse it, don't duplicate.**

## 1. Reuse what's there

Import `MONITOR_METRICS`, `MONITOR_COMPARATORS`, `MONITOR_WINDOWS`, plus types `MonitorInput` / `Monitor` / `MonitorListRow` / `MonitorTrigger` / `ValidationErrors` / `ValidationResult` from `dashboard/src/lib/monitors.ts`. Do NOT redefine these — form dialog and banner bind to them. A parallel zod enum is the #1 way for accept-on-create / error-on-eval drift to come back.

#15 swaps **bodies, not signatures**:
- Replace `validateMonitorInput()`'s body with `MonitorInputSchema.safeParse()`. **Return shape `{ ok, errors, value }` must not change** — modal breaks otherwise.
- Replace the read stubs (`getMonitors` / `getMonitor` / `getMonitorTriggers` / `getFiringMonitorCount`) with the Prisma calls already documented in their JSDoc.

## 2. Action shape (locked)

```ts
createMonitor(input): { ok: true; id } | { ok: false; errors } | { ok: false; error: 'limit_reached' | 'no_tenant' }
updateMonitor(id, input): { ok: true } | { ok: false; errors } | { ok: false; error: 'not_found' | 'no_tenant' }
deleteMonitor / toggleMonitor: { ok: true } | { ok: false; error: 'not_found' | 'no_tenant' }
```

**Discriminated unions, never throw** for expected failures (validation, not-found, cap). Throw only for infra. Matches `ValidationResult`'s `ok` discriminator.

## 3. Tenant scoping (sacred)

Every action begins with `const org = await getOrCreateOrg(); if (!org) return { ok: false, error: 'no_tenant' };`. Derive `orgId` from session — **never accept `orgId` or `tenantId` from input.**

## 4. ≤10 cap

Inside `createMonitor`, after validation: `prisma.monitor.count({ where: { orgId } })`. If `>= 10`, return `{ ok: false, error: 'limit_reached' }`. **No DB unique constraint** — awkward to migrate when V1.1 widens the cap.

## 5. IDOR guard

`updateMonitor` / `deleteMonitor` / `toggleMonitor` use `prisma.monitor.findFirst({ where: { id, orgId } })`, NOT `findUnique({ where: { id } })`. Wrong-tenant lookups return `null` → `{ ok: false, error: 'not_found' }`. Never reveal whether the id exists under another tenant.
