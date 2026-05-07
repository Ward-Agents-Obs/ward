"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * API key list table for `/settings/keys`. Migrated to V1 ui primitives as
 * part of #43 (styling-drift sweep). Status pills use the `--destructive`
 * and `--success` design tokens from `globals.css` — both resolve correctly
 * in light and dark mode.
 */
export function ApiKeyTable({
  keys,
  onRevoke,
}: {
  keys: ApiKeyRow[];
  onRevoke: (id: string) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);

  async function handleRevoke(id: string) {
    setRevoking(id);
    await onRevoke(id);
    setRevoking(null);
  }

  if (keys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed tech-border bg-panel p-12 text-center">
        <p className="text-sm font-medium text-foreground">No API keys yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Create one to start sending traces from your app. The plaintext is
          shown once at creation; copy it then.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell className="font-medium text-foreground">
              {key.name}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {key.keyPrefix}
            </TableCell>
            <TableCell>
              {key.active ? (
                <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  Revoked
                </span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {new Date(key.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              {key.active ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRevoke(key.id)}
                  disabled={revoking === key.id}
                >
                  {revoking === key.id ? "Revoking…" : "Revoke"}
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
