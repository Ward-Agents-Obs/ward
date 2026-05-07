# UI Primitives

Shadcn-style UI primitives for the Ward dashboard. Import from
`@/components/ui/<name>`.

These components are **opt-in** — they exist so future features (Monitors,
Overview rebuild, Trace detail polish) can compose against a consistent
design system. The legacy hand-rolled components (`trace-table.tsx`,
`session-table.tsx`, `api-key-table.tsx`, `create-key-dialog.tsx`,
`costs/client.tsx`) still work and will be migrated in a focused styling-drift
sweep, not a flag-day rewrite.

## Available

| Primitive | File | Notes |
|---|---|---|
| `Skeleton` | `skeleton.tsx` | Loading placeholder. Tailwind `animate-pulse` + `bg-muted`. |
| `Button` | `button.tsx` | CVA variants: `default`, `secondary`, `ghost`, `destructive`, `link`. Sizes: `sm`, `default`, `lg`, `icon`. Supports `asChild` (via `@radix-ui/react-slot`) for projecting variant styles onto `<Link>` / `<a>`. |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `card.tsx` | Panel container. Variants: `panel` (default chart/section), `hero` (page-top header), `inset` (nested KPI/sub-panel). |
| `Input` | `input.tsx` | Single input shape with focus ring on `--ring`. |
| `Textarea` | `textarea.tsx` | Multi-line `<Input>`. Same tokens; manual resize, no autoresize in V1. |
| `Label` | `label.tsx` | Plain `<label>`; pair with `Input`/`Textarea` via `htmlFor`. |
| `Select` | `select.tsx` | Native `<select>` wrapped with chevron + tokens. |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | `table.tsx` | Tokens-driven table set. |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `tabs.tsx` | Controlled-only API matching Radix. |
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` | `dialog.tsx` | Portal modal with focus trap, Escape, overlay close. |
| `TimeRangePicker`, `DEFAULT_TIME_RANGE_OPTIONS` | `time-range-picker.tsx` | URL-state segmented selector. Generic over option-value type, configurable `paramName`, resets `?page=` on change. |
| `ToastProvider`, `Toaster`, `useToast` | `toast.tsx` | Context-driven; mount `Toaster` at the dashboard layout root. |

## Conventions

- Every primitive uses the design tokens from `globals.css`
  (`--background`, `--foreground`, `--panel`, `--border`, `--accent`,
  `--muted`, `--destructive`, `--success`, `--ring`). No hex literals, no
  zinc/neutral Tailwind classes — those are the legacy palette and shouldn't
  appear in new code. Status pills use `bg-destructive/10 text-destructive`
  for danger / `bg-success/10 text-success` for ok.
- Variant systems use `class-variance-authority` (already a top-level dep).
  Do not introduce variant logic via inline ternaries in callers.
- Forwarded refs everywhere we expose an HTML element. shadcn parity.
- All client-only components carry `"use client"` at the top. Server components
  (Skeleton, Input, Label, Table) do not.

## Deliberate omissions in V1

V1 ships with the minimum viable subset of the shadcn surface — anything
heavy that isn't load-bearing for the demo stays out. Specifically:

- **`Dialog`** — rolled focus trap and Escape handling by hand. Missing
  versus Radix: inert background tree, screen-reader announcer, controlled
  portal container. Good enough for V1; swap to `@radix-ui/react-dialog`
  later by replacing the implementation, the consumer API matches. Tracked
  as #38 (V1.1).
- **`Select`** — native `<select>` for V1. The popover-style searchable
  Select needs `@radix-ui/react-select`. Once approved, ship a richer
  `Select` alongside the native one.
- **`Tabs`** — keyboard navigation is Tab/Shift+Tab only; missing arrow-key
  roving tabindex.
- **`Toast`** — local context + portal. No deduplication of identical
  toasts, no swipe-to-dismiss, no animation. Deliberately tiny.

`@radix-ui/react-slot` IS installed (used by `Button asChild`). When V1.1
swaps the others to Radix, no schema change to the consumer call sites.
The primitive APIs above are deliberately shaped like shadcn so the swap is
a one-shot rewrite of the file, not a caller migration.

## Usage examples

### Button

```tsx
import { Button } from "@/components/ui/button";

<Button onClick={save}>Save</Button>
<Button variant="secondary" size="sm">Cancel</Button>
<Button variant="destructive">Delete</Button>
```

To wrap a `<Link>` (or any other element) with button styling, prefer
`asChild` — it preserves the child's semantics:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

<Button asChild variant="secondary">
  <Link href="/settings/keys">Manage keys</Link>
</Button>
```

`buttonVariants(...)` applied directly to a `className` is the older
pattern and still works:

```tsx
import { buttonVariants } from "@/components/ui/button";

<Link href="/settings/keys" className={buttonVariants({ variant: "secondary" })}>
  Manage keys
</Link>
```

### Dialog

```tsx
"use client";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ExampleDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm</DialogTitle>
            <DialogDescription>This will revoke the API key.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive">Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### Toast

Place `<ToastProvider>` and `<Toaster />` once at the dashboard layout root,
then call the hook from any client component:

```tsx
"use client";
import { useToast } from "@/components/ui/toast";

export function SaveButton() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast({ title: "Saved", variant: "success" })}>
      Save
    </button>
  );
}
```

`<ToastProvider>` is **not** wired into the layout yet — it'll be added in
the first feature PR that needs to surface a toast (likely F8, the
Create/Edit Monitor modal).

### Tabs

```tsx
"use client";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function TraceModeToggle() {
  const [mode, setMode] = useState("list");
  return (
    <Tabs value={mode} onValueChange={setMode}>
      <TabsList>
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
      </TabsList>
      <TabsContent value="list">…</TabsContent>
      <TabsContent value="sessions">…</TabsContent>
    </Tabs>
  );
}
```

### TimeRangePicker

```tsx
import {
  TimeRangePicker,
  DEFAULT_TIME_RANGE_OPTIONS,
} from "@/components/ui/time-range-picker";

// Standard 1h / 24h / 7d / 30d range, writes to ?range=
<TimeRangePicker value={range} options={DEFAULT_TIME_RANGE_OPTIONS} />

// Custom param name + option set (e.g. monitor windows)
<TimeRangePicker
  value={window}
  paramName="window"
  ariaLabel="Window"
  options={[
    { value: "5m", label: "5m" },
    { value: "15m", label: "15m" },
    { value: "1h", label: "1h" },
    { value: "6h", label: "6h" },
    { value: "24h", label: "24h" },
  ]}
/>
```

The component is a server-friendly Link-based segmented control. The page
validates the URL value before passing it as `value`; the picker just
highlights or doesn't, never throws.

### Card

```tsx
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card";

<Card variant="hero">
  <CardHeader>
    <CardTitle>Tracing</CardTitle>
    <CardDescription>All LLM calls instrumented by Ward.</CardDescription>
  </CardHeader>
</Card>

<Card>
  <CardHeader>
    <CardTitle>Spans by model</CardTitle>
  </CardHeader>
  <CardContent>{/* chart */}</CardContent>
</Card>

<Card variant="inset">
  <CardTitle>Spans</CardTitle>
  <p className="mt-2 text-2xl font-semibold">1,204</p>
</Card>
```

## Migration plan

Existing components that should adopt these primitives, in priority order
(active in #43, the styling-drift sweep):

1. `create-key-dialog.tsx` → `Dialog` + `Button` + `Input` + `Label`.
2. `trace-table.tsx` → `Table` set.
3. `api-key-table.tsx` → `Table` set + destructive `Button`.
4. `cost-chart.tsx` → swap legacy zinc hex literals for design tokens.
5. `costs/client.tsx` → `Card` + `Table` set.

Skipped intentionally: `sdk-onboarding.tsx` (design hasn't settled),
`traces/trace-filters.tsx` (already uses primitives from F2),
`session-table.tsx` (was rewritten in F2).

Each migration is its own focused diff per AGENTS.MD §4.
