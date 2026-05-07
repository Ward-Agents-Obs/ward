"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
  const { toast } = useToast();

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
        onSaved={() => {
          router.refresh();
          // Use the snapshotted name from the moment the dialog opened —
          // the user might have renamed the monitor in this same edit and
          // we want the "before" name in the toast for clarity. (Updating
          // to "after" would require capturing the form value or refetching.)
          toast({
            title: `Updated "${monitor.name}"`,
            variant: "success",
          });
        }}
      />
    </>
  );
}
