"use client";

import { useState } from "react";
import { Copy, Check, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Create API key" CTA + modal flow. The modal has two states:
 *   1. Form state — user names the key and submits.
 *   2. Reveal state — server returns the plaintext exactly once and the
 *      user copies it. The key is never persisted in client state outside
 *      this dialog instance; closing drops it.
 *
 * Migrated to the V1 ui primitives (Dialog / Button / Input / Label) as part
 * of #43 (styling-drift sweep). Behaviour is unchanged from the V1.0 inline
 * modal — only the markup and tokens differ.
 */
export function CreateKeyDialog({
  onCreate,
}: {
  onCreate: (name: string) => Promise<{ plain: string } | null>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    const result = await onCreate(name.trim());
    setLoading(false);
    if (result) {
      setCreatedKey(result.plain);
    }
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset on close so reopening returns to the form state. Drops the
      // plaintext key from memory at the same time.
      setName("");
      setCreatedKey(null);
      setCopied(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create Key
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          // Misclicks shouldn't drop the plaintext key — Esc + the close
          // button stay enabled so users always have explicit dismissals.
          disableOverlayClose
        >
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>API key created</DialogTitle>
                <DialogDescription>
                  Copy this key now. You will not be able to see it again.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex items-center gap-2 rounded-lg border tech-border bg-background p-3">
                <code className="flex-1 break-all text-sm text-foreground">
                  {createdKey}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopy}
                  aria-label="Copy key to clipboard"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => handleOpenChange(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  Give your key a name so you can identify it later.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Production, Staging"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleCreate();
                  }}
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => handleOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!name.trim() || loading}
                >
                  {loading ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
