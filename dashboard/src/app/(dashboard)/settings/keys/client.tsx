"use client";

import { ApiKeyTable } from "@/components/api-key-table";
import { CreateKeyDialog } from "@/components/create-key-dialog";
import { useToast } from "@/components/ui/toast";
import { createApiKey, revokeApiKey } from "./actions";
import { useRouter } from "next/navigation";

interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Client wrapper for the keys page. Both `createApiKey` and `revokeApiKey`
 * return discriminated `{ ok }` envelopes (see `dashboard-conventions-drift.md`
 * §2.8). On `ok: false` we surface a destructive toast; the dialog/table
 * still react to the result so they don't show a "succeeded" UI on partial
 * failure.
 */
export function KeysClient({ keys }: { keys: KeyRow[] }) {
  const router = useRouter();
  const { toast } = useToast();

  async function handleCreate(name: string) {
    const result = await createApiKey(name);
    if (!result.ok) {
      toast({
        title: "Couldn't create key",
        description: result.message,
        variant: "destructive",
      });
      // Returning null preserves the dialog's existing "stay in form state"
      // contract on failure — the user can edit the name and retry.
      return null;
    }
    router.refresh();
    return { plain: result.plain };
  }

  async function handleRevoke(id: string) {
    const result = await revokeApiKey(id);
    router.refresh();
    if (!result.ok) {
      toast({
        title: "Couldn't fully revoke key",
        description: result.message,
        variant: "destructive",
        // Partial-failure messages are higher-stakes than a generic info
        // toast — keep them visible longer than the 5s default.
        duration: 10_000,
      });
    } else {
      toast({
        title: "API key revoked",
        variant: "success",
      });
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <CreateKeyDialog onCreate={handleCreate} />
      </div>
      <ApiKeyTable keys={keys} onRevoke={handleRevoke} />
    </>
  );
}
