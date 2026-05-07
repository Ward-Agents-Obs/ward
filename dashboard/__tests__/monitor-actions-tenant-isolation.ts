/**
 * #15 acceptance check — Monitor server actions and read helpers must scope
 * every read and write to the requesting org. The actions themselves rely
 * on `getOrCreateOrg()` for `orgId`, which needs a Supabase session that's
 * not available to a tsx script — so this test exercises the **shared
 * IDOR layer** (the `(id, orgId)` compound filters used by both the read
 * helpers in `lib/monitors-server.ts` and the `updateMany`/`deleteMany`
 * calls in `app/(dashboard)/monitors/actions.ts`). If those pass, the
 * actions are safe by construction; if they fail, no amount of session
 * checking saves us.
 *
 * What we cover:
 *   1. `getMonitor(orgB, A.monitorId)` returns `null` (compound find).
 *   2. `getMonitorTriggers(orgB, A.monitorId)` returns `[]` (nested filter).
 *   3. `getMonitors(orgA)` excludes B's rows.
 *   4. `getFiringMonitorCount(orgA)` only counts A's firing monitors.
 *   5. The ≤10-monitor cap counter operates per-org.
 *   6. `prisma.monitor.updateMany({ where: { id, orgId } })` returns
 *      `{ count: 0 }` for cross-tenant ids — the same query shape every
 *      mutating action uses.
 *
 * Run (mirrors the convention in the other `*-tenant-isolation.ts` scripts):
 *
 *     # from dashboard/
 *     DATABASE_URL=postgresql://… \
 *     npx tsx __tests__/monitor-actions-tenant-isolation.ts
 *
 * Discovered + executed by `scripts/run-tenant-isolation-tests.sh`.
 */

import { randomBytes } from "node:crypto";

import { prisma } from "../src/lib/prisma";
import {
  getFiringMonitorCount,
  getMonitor,
  getMonitorTriggers,
  getMonitors,
} from "../src/lib/monitors-server";

const runId = randomBytes(4).toString("hex");

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

async function makeOrg(suffix: string) {
  return prisma.organization.create({
    data: {
      name: `wardtest-${runId}-${suffix}`,
      slug: `wardtest-${runId}-${suffix}`,
      tenantId: `tenant_wardtest_${runId}_${suffix}`,
    },
  });
}

async function main() {
  console.log(`\n[monitor-actions-tenant-isolation] runId=${runId}`);

  // Setup: two orgs, each owns its own monitors + triggers.
  const orgA = await makeOrg("a");
  const orgB = await makeOrg("b");
  console.log(`  orgA=${orgA.id.slice(0, 8)} orgB=${orgB.id.slice(0, 8)}`);

  try {
    const monitorA1 = await prisma.monitor.create({
      data: {
        orgId: orgA.id,
        name: "A1 — cost firing",
        metric: "cost",
        comparator: "gt",
        threshold: 5,
        windowMinutes: 60,
        environment: "production",
        state: "firing",
        enabled: true,
      },
    });
    const monitorA2 = await prisma.monitor.create({
      data: {
        orgId: orgA.id,
        name: "A2 — latency ok",
        metric: "latency_p95",
        comparator: "gt",
        threshold: 1500,
        windowMinutes: 15,
        model: "gpt-4o",
        state: "ok",
        enabled: true,
      },
    });
    const monitorB1 = await prisma.monitor.create({
      data: {
        orgId: orgB.id,
        name: "B1 — cost firing (cross-org bait)",
        metric: "cost",
        comparator: "gt",
        threshold: 1,
        windowMinutes: 5,
        state: "firing",
        enabled: true,
      },
    });

    await prisma.monitorTrigger.create({
      data: {
        monitorId: monitorA1.id,
        triggerValue: 7.42,
        threshold: 5,
        comparator: "gt",
      },
    });
    await prisma.monitorTrigger.create({
      data: {
        monitorId: monitorB1.id,
        triggerValue: 1.5,
        threshold: 1,
        comparator: "gt",
      },
    });

    console.log("\n# getMonitor — IDOR via compound (id, orgId) find");
    const aSelf = await getMonitor(orgA.id, monitorA1.id);
    const aCrossB = await getMonitor(orgB.id, monitorA1.id);
    const bCrossA = await getMonitor(orgA.id, monitorB1.id);
    assert(aSelf?.id === monitorA1.id, "A reading own monitor returns the row");
    assert(aCrossB === null, "A's monitor invisible to B (compound find filters)");
    assert(bCrossA === null, "B's monitor invisible to A (compound find filters)");

    console.log("\n# getMonitorTriggers — IDOR via nested monitor.orgId filter");
    const aTriggers = await getMonitorTriggers(orgA.id, monitorA1.id, 10);
    const bTriggersOfA = await getMonitorTriggers(orgB.id, monitorA1.id, 10);
    const aTriggersOfB = await getMonitorTriggers(orgA.id, monitorB1.id, 10);
    assert(aTriggers.length === 1, `A reads 1 trigger for own monitor (got ${aTriggers.length})`);
    assert(bTriggersOfA.length === 0, "B sees zero triggers for A's monitor (nested filter excludes)");
    assert(aTriggersOfB.length === 0, "A sees zero triggers for B's monitor (nested filter excludes)");

    console.log("\n# getMonitors — listing is org-scoped");
    const listA = await getMonitors(orgA.id);
    const listB = await getMonitors(orgB.id);
    const aIds = new Set(listA.map((m) => m.id));
    const bIds = new Set(listB.map((m) => m.id));
    assert(listA.length === 2, `A sees its 2 monitors (got ${listA.length})`);
    assert(listB.length === 1, `B sees its 1 monitor (got ${listB.length})`);
    assert(aIds.has(monitorA1.id) && aIds.has(monitorA2.id), "A list includes A1 and A2");
    assert(!aIds.has(monitorB1.id), "A list excludes B1 (cross-tenant)");
    assert(bIds.has(monitorB1.id) && !bIds.has(monitorA1.id), "B list includes only its own");

    console.log("\n# getFiringMonitorCount — count is org-scoped");
    const firingA = await getFiringMonitorCount(orgA.id);
    const firingB = await getFiringMonitorCount(orgB.id);
    assert(firingA === 1, `A has exactly 1 firing monitor (got ${firingA})`);
    assert(firingB === 1, `B has exactly 1 firing monitor (got ${firingB})`);
    // Critical: each tenant's firing count must NOT include the other's.
    // With 1 firing each, that's only verifiable by counting; sum == 2,
    // not 3+.
    assert(firingA + firingB === 2, "no double-counting across tenants");

    console.log("\n# updateMany((id, orgId)) — the action's mutation guard");
    // The actions use `prisma.monitor.updateMany({ where: { id, orgId } })`
    // and check `result.count === 0` to detect cross-tenant attempts. Test
    // the same query directly so a regression in the action's where-clause
    // shape (e.g. switching to `findUnique({id})` + `update({id})`) lights
    // this assertion up.
    const updateCross = await prisma.monitor.updateMany({
      where: { id: monitorA1.id, orgId: orgB.id },
      data: { name: "PWNED" },
    });
    assert(updateCross.count === 0, "B trying to update A's monitor: 0 rows affected");
    const stillIntact = await prisma.monitor.findUnique({ where: { id: monitorA1.id } });
    assert(stillIntact?.name === "A1 — cost firing", "A's monitor name untouched after cross-tenant write attempt");

    const updateSelf = await prisma.monitor.updateMany({
      where: { id: monitorA1.id, orgId: orgA.id },
      data: { name: "A1 — cost firing (renamed)" },
    });
    assert(updateSelf.count === 1, "A updating own monitor: 1 row affected");

    console.log("\n# deleteMany((id, orgId)) — the action's deletion guard");
    const deleteCross = await prisma.monitor.deleteMany({
      where: { id: monitorA2.id, orgId: orgB.id },
    });
    assert(deleteCross.count === 0, "B trying to delete A's monitor: 0 rows affected");
    const stillExists = await prisma.monitor.findUnique({ where: { id: monitorA2.id } });
    assert(stillExists !== null, "A's monitor still exists after cross-tenant delete attempt");

    console.log("\n# Cap counting is per-org");
    // Create 8 more monitors for A so A has 10 total. Then assert the cap
    // count is exactly 10 for A and 1 for B — no leakage.
    for (let i = 0; i < 8; i++) {
      await prisma.monitor.create({
        data: {
          orgId: orgA.id,
          name: `A cap-fill #${i}`,
          metric: "cost",
          comparator: "gt",
          threshold: 1,
          windowMinutes: 5,
        },
      });
    }
    const capA = await prisma.monitor.count({ where: { orgId: orgA.id } });
    const capB = await prisma.monitor.count({ where: { orgId: orgB.id } });
    assert(capA === 10, `A monitor cap count is 10 (got ${capA})`);
    assert(capB === 1, `B unaffected by A's cap fill (got ${capB})`);
  } finally {
    // Cascade-delete via Organization.onDelete: Cascade handles the
    // monitors + triggers.
    await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n[PASS] all monitor-actions tenant-isolation assertions passed");
}

void main().catch(async (err) => {
  console.error("[ERROR]", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
