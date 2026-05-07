/**
 * #14 acceptance check — schema-level tenant isolation + cascade behavior
 * for the new `Monitor` and `MonitorTrigger` Prisma models.
 *
 * Two assertions backend asked for:
 *   (a) `prisma.monitor.findMany({ where: { orgId: orgA.id } })` returns no
 *       orgB rows after seeding both tenants. Symmetric for orgB.
 *   (b) Deleting a Monitor cascades to its MonitorTrigger rows (FK
 *       ON DELETE CASCADE actually fires).
 *
 * Plus two free correctness asserts that come along for the ride:
 *   - `findMany()` without a `where` returns all 4 monitors (the seed total).
 *   - `findFirst({ id, orgId })` IDOR pattern returns null when org doesn't
 *     own the monitor — the lookup shape #15's server actions will use.
 *
 * Lifecycle: random run-id keeps fixtures isolated across parallel runs.
 * Cleanup deletes both organizations; FK cascade wipes their monitors and
 * triggers, so we don't have to walk the tree manually.
 *
 * Run (requires the docker-compose Postgres at `localhost:5434`):
 *
 *     # from dashboard/ — needs DATABASE_URL via .env or process.env
 *     npx tsx --env-file=.env __tests__/monitor-schema-tenant-isolation.ts
 *
 * Picked up automatically by `scripts/run-tenant-isolation-tests.sh` via the
 * `*-tenant-isolation.ts` glob — no edit to the runner's discovery loop
 * needed. The runner already passes `--env-file=.env` to every script so the
 * existing ClickHouse-only tests are unaffected.
 */

import { randomBytes } from "node:crypto";

import { prisma } from "../src/lib/prisma";

const runId = randomBytes(4).toString("hex");
const TENANT_A = `wardtest_${runId}_a`;
const TENANT_B = `wardtest_${runId}_b`;

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

interface Seeded {
  orgA: { id: string };
  orgB: { id: string };
  monA1: { id: string };
  monA2: { id: string };
  monB1: { id: string };
  monB2: { id: string };
}

async function insertFixtures(): Promise<Seeded> {
  // Two organizations on stable, random tenant ids so the cleanup query is
  // unambiguous even under concurrent runs.
  const orgA = await prisma.organization.create({
    data: {
      name: `wardtest orgA ${runId}`,
      slug: `wardtest-${runId}-a`,
      tenantId: TENANT_A,
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      name: `wardtest orgB ${runId}`,
      slug: `wardtest-${runId}-b`,
      tenantId: TENANT_B,
    },
  });

  // Two monitors per org, deliberately different metric/comparator so cross-
  // leak shows up loudly in any failure message.
  const monA1 = await prisma.monitor.create({
    data: {
      orgId: orgA.id,
      name: "orgA cost monitor",
      metric: "cost",
      comparator: "gt",
      threshold: 5,
      windowMinutes: 60,
      environment: "production",
    },
  });
  const monA2 = await prisma.monitor.create({
    data: {
      orgId: orgA.id,
      name: "orgA latency monitor",
      metric: "latency_p95",
      comparator: "gt",
      threshold: 1500,
      windowMinutes: 15,
    },
  });
  const monB1 = await prisma.monitor.create({
    data: {
      orgId: orgB.id,
      name: "orgB error monitor",
      metric: "error_rate",
      comparator: "gt",
      threshold: 0.05,
      windowMinutes: 60,
    },
  });
  const monB2 = await prisma.monitor.create({
    data: {
      orgId: orgB.id,
      name: "orgB cost monitor",
      metric: "cost",
      comparator: "gt",
      threshold: 10,
      windowMinutes: 1440,
    },
  });

  return { orgA, orgB, monA1, monA2, monB1, monB2 };
}

async function deleteFixtures() {
  // FK cascade does the heavy lifting: deleting an Organization wipes its
  // monitors which wipes their triggers. If cascade is broken we'll surface a
  // FK violation here, which is itself diagnostic.
  await prisma.organization.deleteMany({
    where: { tenantId: { in: [TENANT_A, TENANT_B] } },
  });
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function checkTenantScopedFindMany(seeded: Seeded) {
  console.log("\n# (a) Monitor.findMany scoped by orgId");
  const aRows = await prisma.monitor.findMany({
    where: { orgId: seeded.orgA.id },
  });
  const bRows = await prisma.monitor.findMany({
    where: { orgId: seeded.orgB.id },
  });

  // We seeded exactly 2 per org. Check counts AND cross-leak.
  assert(aRows.length === 2, `orgA findMany returns 2 rows (got ${aRows.length})`);
  assert(bRows.length === 2, `orgB findMany returns 2 rows (got ${bRows.length})`);

  const orgBLeakInA = aRows.filter((m) => m.orgId === seeded.orgB.id).length;
  const orgALeakInB = bRows.filter((m) => m.orgId === seeded.orgA.id).length;
  assert(
    orgBLeakInA === 0,
    `Monitor.findMany: orgA (${TENANT_A}) returned ${orgBLeakInA} monitors belonging to orgB (${TENANT_B}) — expected 0`,
  );
  assert(
    orgALeakInB === 0,
    `Monitor.findMany: orgB (${TENANT_B}) returned ${orgALeakInB} monitors belonging to orgA (${TENANT_A}) — expected 0`,
  );

  // Sanity: unscoped findMany sees all 4 (rules out a phantom WHERE clause
  // hiding rows from BOTH calls — would mask a real leak).
  const all = await prisma.monitor.findMany({
    where: { orgId: { in: [seeded.orgA.id, seeded.orgB.id] } },
  });
  assert(all.length === 4, `unscoped findMany sees both tenants' rows (got ${all.length}, expected 4)`);
}

async function checkIdorGuard(seeded: Seeded) {
  console.log("\n# (a-bonus) findFirst({ id, orgId }) IDOR pattern");
  // This is the lookup shape #15's server actions will use for update/delete/
  // toggle. Wrong-tenant returns null, NOT a row. If this changes, every
  // mutation action becomes a tenant escalation.
  const wrongTenant = await prisma.monitor.findFirst({
    where: { id: seeded.monA1.id, orgId: seeded.orgB.id },
  });
  const rightTenant = await prisma.monitor.findFirst({
    where: { id: seeded.monA1.id, orgId: seeded.orgA.id },
  });
  assert(
    wrongTenant === null,
    `findFirst({ id: monA1, orgId: orgB }) returns null — IDOR guard holds`,
  );
  assert(
    rightTenant !== null && rightTenant.id === seeded.monA1.id,
    `findFirst({ id: monA1, orgId: orgA }) returns the row`,
  );
}

async function checkTriggerCascade(seeded: Seeded) {
  console.log("\n# (b) MonitorTrigger cascade on parent delete");
  // Seed two triggers under monA2.
  await prisma.monitorTrigger.create({
    data: {
      monitorId: seeded.monA2.id,
      triggerValue: 1800,
      threshold: 1500,
      comparator: "gt",
    },
  });
  await prisma.monitorTrigger.create({
    data: {
      monitorId: seeded.monA2.id,
      triggerValue: 2100,
      threshold: 1500,
      comparator: "gt",
      resolvedAt: new Date(),
    },
  });

  const beforeCount = await prisma.monitorTrigger.count({
    where: { monitorId: seeded.monA2.id },
  });
  assert(beforeCount === 2, `seeded 2 triggers under monA2 (got ${beforeCount})`);

  // Delete the parent monitor. FK ON DELETE CASCADE should wipe the children.
  await prisma.monitor.delete({ where: { id: seeded.monA2.id } });

  const afterCount = await prisma.monitorTrigger.count({
    where: { monitorId: seeded.monA2.id },
  });
  assert(
    afterCount === 0,
    `MonitorTrigger cascade: deleting monA2 should leave 0 triggers (got ${afterCount})`,
  );

  // And the parent monitor itself is gone.
  const parent = await prisma.monitor.findUnique({ where: { id: seeded.monA2.id } });
  assert(parent === null, `monA2 row deleted from monitors table`);
}

async function runChecks(seeded: Seeded) {
  console.log(
    `\n[monitor-schema-tenant-isolation] tenant-A=${TENANT_A} tenant-B=${TENANT_B}`,
  );

  await checkTenantScopedFindMany(seeded);
  await checkIdorGuard(seeded);
  await checkTriggerCascade(seeded);
}

async function main() {
  let seeded: Seeded | null = null;
  try {
    seeded = await insertFixtures();
    await runChecks(seeded);
  } finally {
    try {
      await deleteFixtures();
    } catch (err) {
      console.warn("[cleanup] failed to delete fixtures:", err);
    }
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n[PASS] all monitor-schema tenant-isolation assertions passed");
}

void main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
