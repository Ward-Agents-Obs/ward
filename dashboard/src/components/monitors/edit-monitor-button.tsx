"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonitorFormDialog } from "./monitor-form-dialog";
import type { Monitor } from "@/lib/monitors";

/**
 * Client wrapper for "Edit" on the monitor detail page. Unlike Create, this
 * mounts the dialog with `initial` populated so the form pre-fills.
 */
export function EditMonitorButton({
  monitor,
  availableEnvironments,
  availableModels,
}: {
  monitor: Monitor;
  availableEnvironments: string[];
  availableModels: string[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
        Edit
      </Button>
      <MonitorFormDialog
        open={open}
        onOpenChange={setOpen}
        initial={monitor}
        availableEnvironments={availableEnvironments}
        availableModels={availableModels}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
