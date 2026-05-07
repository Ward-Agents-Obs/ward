-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT NOT NULL,
    "comparator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "environment" TEXT,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "last_evaluated_at" TIMESTAMP(3),
    "last_value" DOUBLE PRECISION,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_triggers" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "trigger_value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "comparator" TEXT NOT NULL,

    CONSTRAINT "monitor_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitors_org_id_state_idx" ON "monitors"("org_id", "state");

-- CreateIndex
CREATE INDEX "monitor_triggers_monitor_id_fired_at_idx" ON "monitor_triggers"("monitor_id", "fired_at");

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_triggers" ADD CONSTRAINT "monitor_triggers_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
