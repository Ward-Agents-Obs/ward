"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { MonitorFormDialog } from "./monitor-form-dialog";

/**
 * Client wrapper for the "Create monitor" CTA. The list page is a server
 * component (so monitors render as SSR HTML), but the dialog needs client
 * state and the form needs to dispatch a server action — so this thin
 * island sits in the page header.
 *
 * `availableEnvironments` and `availableModels` come from the server-side
 * distinct-value queries the page already runs for the trace filters; the
 * page passes them down so the dialog's scope dropdowns are populated.
 */
export function CreateMonitorButton({
  availableEnvironments,
  availableModels,
}: {
  availableEnvironments: string[];
  availableModels: string[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create monitor
      </Button>
      <MonitorFormDialog
        open={open}
        onOpenChange={setOpen}
        availableEnvironments={availableEnvironments}
        availableModels={availableModels}
        onSaved={() => {
          // Refresh so the new row shows up in the list, then toast for
          // explicit success feedback (the modal closes immediately, so
          // without a toast there's no acknowledgement that the create
          // landed).
          router.refresh();
          toast({
            title: "Monitor created",
            description:
              "It will be evaluated on the next cron tick (within 5 minutes).",
            variant: "success",
          });
        }}
      />
    </>
  );
}
